// The database split (Nov 21, 2026 audit): the business tables are copied into their own database, Gates HQ's stay
// where they are, and the rows that arrive between the copy and the switch are caught up once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const S = await import('../src/dbsplit.js');

const empty = join(mkdtempSync(join(tmpdir(), 'split-')), 'empty.sql');
writeFileSync(empty, '');
const one = async (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const n = async (db, t) => +(await one(db, 'SELECT COUNT(*) AS n FROM ' + t)).n;
const tables = async db => ((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results || []).map(r => r.name);

async function seeded() {
  const src = H.makeDB(), dst = H.makeDB(empty);
  await src.prepare("INSERT INTO leads (at, name, business, phone, status) VALUES ('2026-11-20T10:00:00Z', 'Dana', 'Sinclair Plumbing', '+14785550101', 'new')").run();
  await src.prepare("INSERT INTO leads (at, name, business, phone, status) VALUES ('2026-11-20T11:00:00Z', 'Sam', 'Quillen Plumbing', '+14785550102', 'new')").run();
  await src.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('webhook_id', 'we_old')").run();
  for (let i = 0; i < 450; i++) await src.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'drill', 'x')").bind('2026-11-20T00:00:' + String(i % 60).padStart(2, '0') + 'Z').run().catch(() => {});
  await src.prepare('CREATE TABLE IF NOT EXISTS hq_kv (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  await src.prepare('CREATE TABLE IF NOT EXISTS hqb_items (id TEXT PRIMARY KEY, at TEXT)').run();
  await src.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('textpilot', '2026-11-20', '{\"mode\":\"on\"}')").run();
  await src.prepare("INSERT INTO hqb_items (id, at) VALUES ('x', '2026-11-20')").run();
  await src.prepare("CREATE TABLE IF NOT EXISTS push_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, title TEXT, body TEXT, status TEXT)").run();
  await src.prepare("INSERT INTO push_queue (at, title, body, status) VALUES ('2026-11-20T08:00:00Z', 'x', 'y', 'queued')").run();
  return { src, dst };
}

test('step 1 copies every business table with its rows and ids, and nothing of Gates HQ', async () => {
  const { src, dst } = await seeded();
  const r = await S.copySync({ DB: src, BIZ: dst });
  assert.match(r, /all done/, r);
  const have = await tables(dst);
  assert.ok(have.includes('leads') && have.includes('billing_config') && have.includes('voice_log') && have.includes('app_clients'));
  assert.deepEqual(have.filter(t => /^hq/.test(t)), [], 'no Gates HQ table in the business database');
  assert.ok(!have.includes('push_queue'), 'each side keeps its own push queue');
  assert.equal(await n(dst, 'leads'), 2);
  assert.equal(await n(dst, 'voice_log'), await n(src, 'voice_log'));
  assert.deepEqual(await one(dst, "SELECT id, name FROM leads WHERE name = 'Sam'"), await one(src, "SELECT id, name FROM leads WHERE name = 'Sam'"), 'same ids');
  assert.equal((await one(dst, "SELECT v FROM billing_config WHERE k = 'webhook_id'")).v, 'we_old');
  // every table's count is kept, and a second run does nothing
  const bad = ((await dst.prepare("SELECT t FROM _split WHERE t NOT LIKE '\\_\\_%' ESCAPE '\\' AND (err != '' OR rows != src_rows)").all()).results || []);
  assert.deepEqual(bad, []);
  assert.match(await S.copySync({ DB: src, BIZ: dst }), /^copied /);
  assert.equal(await n(src, 'hq_kv') > 0, true, 'the shared database is untouched');
});

test('a run out of time goes on from where it stopped', async () => {
  const { src, dst } = await seeded();
  const r1 = await S.copySync({ DB: src, BIZ: dst }, Date.now() - 25000);   // its time is already up
  assert.match(r1, /to go/);
  let r = r1;
  for (let i = 0; i < 5 && !/all done|^copied/.test(r); i++) r = await S.copySync({ DB: src, BIZ: dst });
  assert.match(r, /all done|^copied/);
  assert.equal(await n(dst, 'voice_log'), await n(src, 'voice_log'));
  assert.equal(await n(dst, 'leads'), 2);
});

test('step 2 catches up rows that came in before the switch, once, and settings as they last stood', async () => {
  const { src, dst } = await seeded();
  await S.copySync({ DB: src, BIZ: dst });
  // between the copy and the switch, the shared database still takes business writes
  await src.prepare("INSERT INTO leads (at, name, business, phone, status) VALUES ('2026-11-21T09:00:00Z', 'Pat', 'Lane Electric', '+14785550103', 'new')").run();
  await src.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('webhook_id', 'we_new')").run();
  await src.prepare("UPDATE leads SET status = 'handled' WHERE name = 'Dana'").run();
  // after the switch the business database is DB and takes its own new rows
  await dst.prepare("INSERT INTO leads (at, name, business, phone, status) VALUES ('2026-11-21T09:30:00Z', 'Lee', 'Lee HVAC', '+14785550104', 'new')").run();
  const env = { DB: dst, HQDB: src };
  assert.match(await S.catchUp(env), /^caught up/);
  const names = ((await dst.prepare('SELECT name FROM leads ORDER BY id').all()).results || []).map(r => r.name);
  assert.ok(names.includes('Pat') && names.includes('Lee'), names.join());
  assert.equal((await one(dst, "SELECT v FROM billing_config WHERE k = 'webhook_id'")).v, 'we_new', 'a setting is taken as it last stood');
  assert.match(await S.catchUp(env), /^done /, 'once');
  assert.equal(await S.catchUp({ DB: dst }), 'no HQDB binding');
});

test('Gates HQ tables are told apart from business ones', async () => {
  const src = H.makeDB();
  const names = (await S.businessTables(src)).map(t => t.name);
  assert.ok(names.includes('app_calls') && names.includes('billing') && names.includes('call_optout'));
  assert.ok(!names.some(t => /^hq_|^hqb_/.test(t)));
});
