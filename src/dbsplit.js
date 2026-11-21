// The database split (Nov 21, 2026 audit). Always Open's business data moves out of the database it shared with Gates
// HQ (texts answered as Christopher, his location, home sensing, his money) into a database of its own, so nothing on
// the business side can read Gates HQ's tables, and a copy of the business database holds none of his private life.
// Gates HQ keeps the old database (its brain, its page, the Failsafe and its scheduled tasks all point at it).
//
// Step 1, copy (wrangler.toml: DB = the shared database, BIZ = the new one). The 10-minute job runs copySync(), which
// copies every business table, schema and rows with their rowids, from DB into BIZ, once (a run that runs out of its
// share of the tick goes on from where it stopped next time). It reads DB and writes only BIZ.
// Step 2, switch (wrangler.toml: DB = the new database, HQDB = the shared one), pushed once the copy is checked.
// catchUp() then brings over, once, the rows the business tables gained in the shared database between the copy and
// the switch, and the settings tables as they last stood there.
// Progress and counts are kept in BIZ's own _split table, so the copy can be checked table by table.
// D1 counts a batch as one query against a run's limit, so both steps read and write in batches.

export const HQ_TABLE = /^(hq_|hqb_)/;
// Not copied: Gates HQ's tables, SQLite's and Cloudflare's own, the push queue (each side drains its own; anything waiting
// in the old one is still sent from there) and the national Do Not Call slices (reloaded from the FTC).
const SKIP = /^(sqlite_|_cf_|_split$|push_queue$|dnc_slices$)/;
// Settings tables, changed in place rather than by new rows: at the switch they're taken as they last stood.
const SETTINGS = new Set(['billing_config', 'launch', 'app_settings', 'voice_lines', 'app_clients', 'biz_prefs', 'push_meta', 'social_state', 'storm_meta', 'checks_meta', 'drill_meta', 'connection_health', 'health_slow']);
const PAGE = 1000, BATCH = 500, BUDGET_MS = 20000, MAX_CALLS = 200;

const q = name => '"' + String(name).replace(/"/g, '""') + '"';
const now_ = () => new Date().toISOString();
async function ensureState(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS _split (t TEXT PRIMARY KEY, rid INTEGER DEFAULT 0, rows INTEGER DEFAULT 0, src_rows INTEGER DEFAULT 0, at TEXT, err TEXT DEFAULT '')").run();
}
export async function businessTables(src) {
  const rows = ((await src.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).results) || [];
  return rows.filter(r => r.sql && !SKIP.test(r.name) && !HQ_TABLE.test(r.name));
}
// Every table and index in the target, made from the source's own CREATE statements, safe to run again. One batch.
async function makeTables(src, dst, tables) {
  const names = new Set(tables.map(t => t.name));
  const idx = (((await src.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()).results) || []).filter(i => names.has(i.tbl_name));
  const stmts = tables.map(t => String(t.sql).replace(/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS '))
    .concat(idx.map(i => String(i.sql).replace(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i, (m, u) => 'CREATE ' + (u || '') + 'INDEX IF NOT EXISTS ')));
  if (stmts.length) await dst.batch(stmts.map(s => dst.prepare(s)));
}
// Row counts of many tables, 60 to a statement (D1 caps the columns of one result at 100).
async function counts(db, names) {
  const out = {};
  for (let i = 0; i < names.length; i += 60) {
    const part = names.slice(i, i + 60);
    const r = await db.prepare('SELECT ' + part.map((n, j) => '(SELECT COUNT(*) FROM ' + q(n) + ') AS c' + j).join(', ')).first();
    part.forEach((n, j) => { out[n] = +((r || {})['c' + j] || 0); });
  }
  return out;
}
const insertSql = (name, cols, mode) => 'INSERT OR ' + mode + ' INTO ' + q(name) + ' (rowid, ' + cols.map(q).join(', ') + ') VALUES (' + cols.concat(['_']).map((_, i) => '?' + (i + 1)).join(', ') + ')';
const vals = (r, cols) => cols.map(c => r[c] === undefined ? null : r[c]);

// Step 1. src = the shared database, dst = the new one.
export async function copySync(env, now) {
  const src = env.DB, dst = env.BIZ;
  if (!dst || dst === src) return 'no BIZ binding';
  await ensureState(dst);
  const all = await dst.prepare("SELECT at FROM _split WHERE t = '__copy' AND err = ''").first().catch(() => null);
  if (all) return 'copied ' + all.at;
  const until = (now || Date.now()) + BUDGET_MS;
  let calls = 6;
  const st = Object.fromEntries((((await dst.prepare('SELECT t, rid, err FROM _split').all()).results) || []).map(r => [r.t, r]));
  const tables = await businessTables(src);
  await makeTables(src, dst, tables);
  const n = await counts(src, tables.map(t => t.name));
  const notes = [];
  let done = 0, left = 0, rows = 0;
  for (const t of tables) {
    const was = st[t.name];
    if (was && was.err === '') { done++; continue; }
    if (!n[t.name]) { notes.push([t.name, 0, 0, 0, '']); done++; continue; }
    if (Date.now() > until || calls > MAX_CALLS) { left++; continue; }
    try {
      let rid = was ? +was.rid || 0 : 0, finished = false;
      while (Date.now() < until && calls < MAX_CALLS) {
        const page = ((await src.prepare('SELECT rowid AS "__rid", * FROM ' + q(t.name) + ' WHERE rowid > ?1 ORDER BY rowid LIMIT ' + PAGE).bind(rid).all()).results) || [];
        calls++;
        if (!page.length) { finished = true; break; }
        const cols = Object.keys(page[0]).filter(c => c !== '__rid');
        if (cols.length > 98) throw new Error(t.name + ' has ' + cols.length + ' columns, more than one statement can carry');
        const sql = insertSql(t.name, cols, 'REPLACE');
        for (let i = 0; i < page.length; i += BATCH) { await dst.batch(page.slice(i, i + BATCH).map(r => dst.prepare(sql).bind(r.__rid, ...vals(r, cols)))); calls++; }
        rid = page[page.length - 1].__rid; rows += page.length;
        if (page.length < PAGE) { finished = true; break; }
      }
      notes.push([t.name, rid, finished ? n[t.name] : 0, n[t.name], finished ? '' : 'part way']);
      if (finished) done++; else left++;
    } catch (e) {
      left++;
      notes.push([t.name, was ? +was.rid || 0 : 0, 0, n[t.name], String((e && e.message) || e).slice(0, 300)]);
    }
  }
  notes.push(['__copy', 0, done, tables.length, left ? left + ' tables to go' : '']);
  await dst.batch(notes.map(x => dst.prepare('INSERT OR REPLACE INTO _split (t, rid, rows, src_rows, at, err) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(x[0], x[1], x[2], x[3], now_(), x[4])));
  return done + ' of ' + tables.length + ' tables copied' + (left ? ', ' + left + ' to go' : ', all done') + ' (' + rows + ' rows this run)';
}

// Step 2. src = the shared database (now HQDB), dst = the business database (now DB). Once: rows that came into the
// shared business tables after the copy, and the settings tables as they last stood there. A row whose id the business
// database has meanwhile given to a row of its own is added under a new id, so neither is lost; a row it already has
// (the same key) stays as it is.
export async function catchUp(env) {
  const src = env.HQDB, dst = env.DB;
  if (!src || src === dst) return 'no HQDB binding';
  await ensureState(dst);
  const done = await dst.prepare("SELECT at FROM _split WHERE t = '__caughtup'").first().catch(() => null);
  if (done) return 'done ' + done.at;
  const st = Object.fromEntries((((await dst.prepare('SELECT t, rid FROM _split').all()).results) || []).map(r => [r.t, +r.rid || 0]));
  if (!Object.keys(st).length) return 'nothing was copied before the switch';
  const tables = await businessTables(src);
  await makeTables(src, dst, tables);
  // what each table gained after the copy (settings tables: all of them), and its rowid alias, in two batched reads
  const got = await src.batch(tables.map(t => src.prepare('SELECT rowid AS "__rid", * FROM ' + q(t.name) + ' WHERE rowid > ?1 ORDER BY rowid LIMIT 2000').bind(SETTINGS.has(t.name) ? 0 : (st[t.name] || 0))));
  const info = await src.batch(tables.map(t => src.prepare('PRAGMA table_info(' + q(t.name) + ')')));
  let rows = 0, moved = 0;
  const later = [];
  for (let k = 0; k < tables.length; k++) {
    const t = tables[k], page = (got[k] && got[k].results) || [];
    if (!page.length) continue;
    const cols = Object.keys(page[0]).filter(c => c !== '__rid');
    const res = await dst.batch(page.map(r => dst.prepare(insertSql(t.name, cols, SETTINGS.has(t.name) ? 'REPLACE' : 'IGNORE')).bind(r.__rid, ...vals(r, cols))));
    const pks = ((info[k] && info[k].results) || []).filter(c => +c.pk > 0);
    const alias = pks.length === 1 && /^integer$/i.test(pks[0].type || '') ? pks[0].name : '';
    page.forEach((r, i) => { if ((res[i] && res[i].meta && res[i].meta.changes) > 0) rows++; else later.push({ t: t.name, r, cols, alias }); });
  }
  // not added: the same row is there already (its key), or its id was taken by a new row; then it goes in under a new id
  if (later.length) {
    const taken = await dst.batch(later.map(x => dst.prepare('SELECT 1 AS x FROM ' + q(x.t) + ' WHERE rowid = ?1').bind(x.r.__rid)));
    const again = later.filter((x, i) => taken[i] && taken[i].results && taken[i].results.length);
    if (again.length) {
      const res = await dst.batch(again.map(x => { const c2 = x.cols.filter(c => c !== x.alias); return dst.prepare('INSERT OR IGNORE INTO ' + q(x.t) + ' (' + c2.map(q).join(', ') + ') VALUES (' + c2.map((_, i) => '?' + (i + 1)).join(', ') + ')').bind(...vals(x.r, c2)); }));
      res.forEach(r => { if ((r && r.meta && r.meta.changes) > 0) { rows++; moved++; } });
    }
  }
  await dst.prepare("INSERT OR REPLACE INTO _split (t, rid, rows, src_rows, at, err) VALUES ('__caughtup', 0, ?1, ?2, ?3, '')").bind(rows, moved, now_()).run();
  return 'caught up: ' + rows + ' rows' + (moved ? ' (' + moved + ' under a new id)' : '');
}
