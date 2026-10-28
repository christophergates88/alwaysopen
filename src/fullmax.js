// Full Max: optional automation. Everything is a draft until approved, unless the owner turns this on, in which case the
// categories they chose send on their own, but ONLY when Compliance Guard passes them. Anything flagged, and anything
// sensitive, drops back to the approval list. The server enforces all of it; the app is never trusted.
// Off by default. Regulated clients cannot turn it on. "Pause everything" takes effect on the next pass (within 10 minutes).
// Loaded late so the rules here can be tested without the worker's own imports.
const A = () => import('./app.js');
const approveItem = async (...a) => (await A()).approveItem(...a);
const guard = async (...a) => (await A()).guard(...a);
const pushClient = async (...a) => (await A()).pushClient(...a);
const mailTo = async (...a) => (await A()).mailTo(...a);
const approveRevive = async (...a) => (await import('./past.js')).approveRevive(...a);
const logAct = async (...a) => { try { return await (await import('./biz.js')).logAct(...a); } catch (e) {} };
const textingOn = async () => (await import('./sms.js')).TEXTING_ON;

export const CATS = ['reminders', 'reviewreq', 'past'];   // invoice reminders, review requests, past-customer messages
export const CAT_LABELS = { reminders: 'Invoice reminders', reviewreq: 'Review requests', past: 'Past-customer messages' };
const DEFAULT_DAILY = 20, DEFAULT_GAP_DAYS = 7;
// Never automatic, whatever the switches say.
const SENSITIVE_RE = /\b(refund|chargeback|dispute|lawyer|attorney|sue|lawsuit|court|complaint|unhappy|angry|furious|terrible|worst|scam|fraud|damage|injur|hurt|unsafe|police|threat)\w*/i;

let ready = false;
export async function ensureFullMax(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fullmax (client_id TEXT PRIMARY KEY, on_ INTEGER DEFAULT 0, paused INTEGER DEFAULT 0, agreed_at TEXT DEFAULT '', agreed_by TEXT DEFAULT '', cats TEXT DEFAULT '{}', daily_cap INTEGER DEFAULT 20, gap_days INTEGER DEFAULT 7, digest_day TEXT DEFAULT '', updated TEXT DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fullmax_log (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT, cat TEXT, ref TEXT DEFAULT '', who TEXT DEFAULT '', result TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fullmax_log_at ON fullmax_log (client_id, at)'),
  ]);
  ready = true;
}

export const AGREEMENT = 'Full Max sends the categories you pick without waiting for your tap. It is your choice and you stay responsible for what goes out in your name. Compliance Guard checks every message first and is a safeguard, not legal advice; anything it flags, and anything sensitive, waits for you. You can pause everything at any time.';

async function row(env, cid) {
  await ensureFullMax(env);
  const r = await env.DB.prepare('SELECT * FROM fullmax WHERE client_id = ?1').bind(cid).first().catch(() => null);
  let cats = {}; try { cats = JSON.parse((r && r.cats) || '{}'); } catch (e) {}
  return { on: !!(r && +r.on_), paused: !!(r && +r.paused), agreedAt: (r && r.agreed_at) || '', cats, dailyCap: (r && +r.daily_cap) || DEFAULT_DAILY, gapDays: (r && +r.gap_days) || DEFAULT_GAP_DAYS };
}

export async function fullMaxState(env, c) {
  if (c.regulated) return { allowed: false, on: false, paused: false, cats: {}, why: 'Not available for regulated businesses.' };
  const r = await row(env, c.client_id);
  const since = new Date(Date.now() - 864e5).toISOString();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM fullmax_log WHERE client_id = ?1 AND at > ?2 AND result = 'sent'").bind(c.client_id, since).first().catch(() => null);
  return { allowed: true, on: r.on, paused: r.paused, agreedAt: r.agreedAt, cats: CATS.reduce((o, k) => (o[k] = !!r.cats[k], o), {}), labels: CAT_LABELS, dailyCap: r.dailyCap, gapDays: r.gapDays, sentToday: +(n && n.n) || 0, agreement: AGREEMENT };
}

// App: POST /api/fullmax { action: 'agree' | 'set' | 'pause' | 'resume' | 'off', cats?: {reminders, reviewreq, past} }
export async function apiFullMax(req, env, c) {
  await ensureFullMax(env);
  if (c.regulated) return { ok: false, error: 'Full Max is not available for regulated businesses.' };
  if (c.staff) return { ok: false, error: 'Only the owner can change this.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  const r = await row(env, c.client_id), now = new Date().toISOString();
  let on = r.on, paused = r.paused, cats = Object.assign({}, r.cats), agreedAt = r.agreedAt, agreedBy = '';
  if (b.action === 'agree') { if (b.agree !== true) return { ok: false, error: 'Read the agreement and tick the box first.' }; on = true; paused = false; agreedAt = now; agreedBy = String(b.by || 'Owner').slice(0, 40); }
  else if (b.action === 'off') { on = false; }
  else if (b.action === 'pause') { paused = true; }
  else if (b.action === 'resume') { paused = false; }
  else if (b.action === 'set') { if (!on) return { ok: false, error: 'Turn Full Max on first.' }; }
  else return { ok: false, error: 'Bad request' };
  if (b.cats && typeof b.cats === 'object') for (const k of CATS) if (typeof b.cats[k] === 'boolean') cats[k] = b.cats[k];
  await env.DB.prepare('INSERT INTO fullmax (client_id, on_, paused, agreed_at, agreed_by, cats, daily_cap, gap_days, updated) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(client_id) DO UPDATE SET on_ = excluded.on_, paused = excluded.paused, agreed_at = CASE WHEN excluded.agreed_at != \'\' THEN excluded.agreed_at ELSE fullmax.agreed_at END, agreed_by = CASE WHEN excluded.agreed_by != \'\' THEN excluded.agreed_by ELSE fullmax.agreed_by END, cats = excluded.cats, updated = excluded.updated')
    .bind(c.client_id, on ? 1 : 0, paused ? 1 : 0, b.action === 'agree' ? agreedAt : '', agreedBy, JSON.stringify(cats), r.dailyCap, r.gapDays, now).run();
  try { await logAct(env, c, b.action === 'agree' ? 'Turned Full Max on' : (b.action === 'off' ? 'Turned Full Max off' : (b.action === 'pause' ? 'Paused everything' : (b.action === 'resume' ? 'Resumed Full Max' : 'Changed Full Max switches')))); } catch (e) {}
  return { ok: true, message: b.action === 'pause' ? 'Paused. Nothing sends on its own until you resume.' : (b.action === 'agree' ? 'Full Max is on.' : 'Saved.'), on, paused, cats };
}

// Is this message plainly sensitive? Those always wait for the owner.
export function sensitive(it) {
  const t = [it.title, it.context, it.text].map(x => String(x || '')).join(' ');
  if (it.kind === 'review' || !it.kind) return true;             // review replies are never automatic
  if (it.stars && +it.stars <= 2) return true;
  return SENSITIVE_RE.test(t);
}

async function customerKey(it) {
  const m = /(?:Email to|Text to)\s+(\S+)/i.exec(String(it.context || ''));
  return (m && m[1].toLowerCase()) || '';
}

// Every 10 minutes: for each client with Full Max on and not paused, send what the switches allow and the Guard passes.
export async function fullMaxCron(env) {
  await ensureFullMax(env);
  const clients = ((await env.DB.prepare("SELECT f.*, c.business, c.regulated, c.banned, c.review_link, c.active FROM fullmax f JOIN app_clients c ON c.client_id = f.client_id WHERE f.on_ = 1 AND f.paused = 0 AND c.active = 1").all()).results) || [];
  let sent = 0, held = 0;
  for (const f of clients) {
    if (+f.regulated) continue;
    let cats = {}; try { cats = JSON.parse(f.cats || '{}'); } catch (e) {}
    const c = { client_id: f.client_id, business: f.business, regulated: 0, banned: f.banned, review_link: f.review_link, staff: 'Max' };
    const day = new Date(Date.now() - 864e5).toISOString();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM fullmax_log WHERE client_id = ?1 AND at > ?2 AND result = 'sent'").bind(f.client_id, day).first();
    let left = Math.max(0, (+f.daily_cap || DEFAULT_DAILY) - (+(n && n.n) || 0));
    const gap = new Date(Date.now() - (+f.gap_days || DEFAULT_GAP_DAYS) * 864e5).toISOString();
    const recent = new Set((((await env.DB.prepare("SELECT ref FROM fullmax_log WHERE client_id = ?1 AND at > ?2 AND result = 'sent'").bind(f.client_id, gap).all()).results) || []).map(r => String(r.ref || '').split('|')[1] || ''));
    const log = async (cat, ref, result) => env.DB.prepare('INSERT INTO fullmax_log (client_id, at, cat, ref, who, result) VALUES (?1,?2,?3,?4,?5,?6)').bind(f.client_id, new Date().toISOString(), cat, ref, 'Max', result).run();
    // Items: invoice reminders and review requests.
    const kinds = []; if (cats.reminders) kinds.push('invoice'); if (cats.reviewreq) kinds.push('reviewreq');
    if (kinds.length && left > 0) {
      const items = ((await env.DB.prepare("SELECT * FROM app_items WHERE client_id = ?1 AND status = 'pending' AND kind IN (" + kinds.map(() => '?').join(',') + ") ORDER BY created LIMIT 30").bind(f.client_id, ...kinds).all()).results) || [];
      for (const it of items) {
        if (left <= 0) break;
        const cat = it.kind === 'invoice' ? 'reminders' : 'reviewreq', ck = await customerKey(it);
        if (sensitive(it)) { held++; continue; }
        if (ck && recent.has(ck)) { held++; continue; }
        const hits = await guard(String(it.text || ''), c, it.kind);
        if (hits.length) { await log(cat, it.id + '|' + ck, 'flagged: ' + hits[0].why); held++; continue; }
        const r = await approveItem(env, null, c, it, '', 'Max (automatic)');
        if (r.status === 200) { sent++; left--; if (ck) recent.add(ck); await log(cat, it.id + '|' + ck, 'sent'); try { await logAct(env, c, 'Sent automatically: ' + (it.title || it.kind) + ' (Guard: passed)'); } catch (e) {} }
        else await log(cat, it.id + '|' + ck, 'failed: ' + ((r.body && r.body.error) || r.status));
      }
    }
    // Past-customer messages (only to customers who agreed; approveRevive checks again).
    if (cats.past && left > 0) {
      const rows = ((await env.DB.prepare("SELECT * FROM biz_revive WHERE client_id = ?1 AND status = 'pending' ORDER BY created LIMIT 20").bind(f.client_id).all()).results) || [];
      for (const rv of rows) {
        if (left <= 0) break;
        const ck = rv.ckey || '';
        if (SENSITIVE_RE.test(String(rv.draft || '') + ' ' + String(rv.reason || ''))) { held++; continue; }
        if (ck && recent.has(ck)) { held++; continue; }
        const hits = await guard(String(rv.draft || ''), c, 'past');
        if (hits.length) { await log('past', rv.id + '|' + ck, 'flagged: ' + hits[0].why); held++; continue; }
        if (!(await textingOn()) && !rv.email) { held++; continue; }
        const r = await approveRevive(env, c, rv, '');
        if (r.status === 200 && r.body && r.body.status === 'sent') { sent++; left--; if (ck) recent.add(ck); await log('past', rv.id + '|' + ck, 'sent'); try { await logAct(env, c, 'Sent automatically: message to ' + (rv.name || 'a past customer') + ' (Guard: passed)'); } catch (e) {} }
        else { await log('past', rv.id + '|' + ck, (r.body && r.body.needsOk) ? 'no consent' : 'failed'); held++; }
      }
    }
    // Daily digest at about 6 PM: what went out on its own today.
    await digest(env, f, c);
  }
  return { sent, held, clients: clients.length };
}

async function digest(env, f, c) {
  const tz = await (await import('./callbacks.js')).tzFor(env, f.client_id);
  const h = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()) % 24;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  if (h < 18 || f.digest_day === today) return;
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const rows = ((await env.DB.prepare("SELECT cat, COUNT(*) AS n FROM fullmax_log WHERE client_id = ?1 AND at > ?2 AND result = 'sent' GROUP BY cat").bind(f.client_id, since).all()).results) || [];
  await env.DB.prepare('UPDATE fullmax SET digest_day = ?1 WHERE client_id = ?2').bind(today, f.client_id).run();
  if (!rows.length) return;
  const parts = rows.map(r => r.n + ' ' + (CAT_LABELS[r.cat] || r.cat).toLowerCase());
  const body = 'Sent on its own today: ' + parts.join(', ') + '. Every one passed Compliance Guard. Open Who did what for the list.';
  await pushClient(env, f.client_id, { aps: { alert: { title: 'Full Max today', body }, sound: 'default', 'thread-id': 'fullmax' }, screen: 'home' }).catch(() => {});
  try { const b = await env.DB.prepare('SELECT email FROM billing WHERE client_id = ?1').bind(f.client_id).first(); if (b && b.email) await mailTo(env, b.email, 'Full Max today', body, 'Always Open'); } catch (e) {}
}
