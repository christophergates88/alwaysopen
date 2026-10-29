// Pushes to Christopher's phone (the ntfy app, the same topic Gates HQ uses).
//
// ntfy.sh limits its free tier by the sender's internet address, and every Cloudflare Worker sends from one shared pool
// of addresses, so a push straight from here is sometimes refused (429, someone else used up the day's quota) or never
// connects (522). So a push that doesn't go through waits in push_queue:
//   1. The Gates HQ agent on the Mac asks for waiting pushes every couple of minutes (/ops/push-queue, with the key),
//      sends them to ntfy from the Mac's own address, and says which went.
//   2. Every 10 minutes the cron tries one waiting push straight to ntfy again; if that works, it sends the rest.
//   3. An important push (high priority) still waiting after 10 minutes goes out as a text from the Always Open number
//      instead, once, between 8 AM and 9 PM.
// Pushes never carry keys or customer card details; they're the same short notes that already went by push and email.
//
// Night, 10 PM to 7 AM Eastern: every push arrives silently (ntfy priority "low": no sound, no buzz) unless it is marked
// loud. Problems still go by email and are listed in the 7 AM push (ops.js, morning.js). Loud at night is kept for the
// few things where callers can reach nobody at all: a number that no longer points at us, or Twilio out of money.

const TIMEOUT_MS = 8000;
const LEASE_MS = 5 * 60e3;            // a push handed to the Mac and not confirmed comes back after this
const TEXT_AFTER_MS = 10 * 60e3;      // important pushes still waiting this long become a text
const DROP_AFTER_MS = 24 * 3600e3;    // anything still waiting after a day is dropped (the email went)
const KEEP_MS = 14 * 24 * 3600e3;
const HIGH = new Set(['high', 'urgent', 'max', '4', '5']);
const NIGHT_FROM = 22, NIGHT_TO = 7;
export function isNight(now) {
  const h = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).format(new Date(now || Date.now()));
  return h >= NIGHT_FROM || h < NIGHT_TO;
}

const ready = new WeakSet();
export async function ensurePush(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, title TEXT, body TEXT, priority TEXT DEFAULT 'default', tags TEXT DEFAULT '', click TEXT DEFAULT '', status TEXT DEFAULT 'queued', out_at TEXT DEFAULT '', done_at TEXT DEFAULT '', via TEXT DEFAULT '', why TEXT DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS push_meta (k TEXT PRIMARY KEY, at TEXT, v TEXT)')
  ]);
  ready.add(env.DB);
}
const ascii = s => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E]/g, '').slice(0, 120);
const note = (env, k, v, at) => env.DB.prepare('INSERT OR REPLACE INTO push_meta (k, at, v) VALUES (?1, ?2, ?3)').bind(k, new Date(at || Date.now()).toISOString(), String(v || '').slice(0, 200)).run().catch(() => {});

// Straight to ntfy. Returns '' when it went, or why it didn't.
async function direct(env, p, h) {
  const f = (h && h.fetch) || fetch;
  const headers = { Title: ascii(p.title), Priority: p.priority || 'default' };
  if (p.tags) headers.Tags = ascii(p.tags);
  if (p.click) headers.Click = String(p.click).slice(0, 500);
  try {
    const r = await f(env.NTFY_URL, { method: 'POST', headers, body: String(p.body || '').slice(0, 3000), signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? '' : 'ntfy answered ' + r.status;
  } catch (e) { return /abort|timeout/i.test(String(e && (e.name || e.message))) ? 'ntfy did not answer in time' : 'ntfy could not be reached'; }
}

// p: { title, body, priority, tags, click }. Returns 'sent', 'queued' or 'off'.
export async function push(env, p, h) {
  if (!env.NTFY_URL) return 'off';
  p = p || {};
  if (!p.loud && isNight(h && h.now)) p = Object.assign({}, p, { priority: 'low' });
  const why = await direct(env, p, h);
  try { await ensurePush(env); await note(env, 'direct', why ? 'failed: ' + why : 'ok'); } catch (e) { /* the push itself is what matters */ }
  if (!why) return 'sent';
  try {
    await env.DB.prepare("INSERT INTO push_queue (at, title, body, priority, tags, click, status, why) VALUES (?1,?2,?3,?4,?5,?6,'queued',?7)")
      .bind(new Date().toISOString(), String(p.title || '').slice(0, 200), String(p.body || '').slice(0, 3000), String(p.priority || 'default').slice(0, 12), String(p.tags || '').slice(0, 120), String(p.click || '').slice(0, 500), why).run();
    return 'queued';
  } catch (e) { return 'off'; }
}

// GET /ops/push-queue: the Mac takes what's waiting. POST /ops/push-queue {done:[ids], failed:[ids]}: what went.
export async function relayTake(env, now) {
  now = now || Date.now();
  await ensurePush(env);
  await note(env, 'relay', 'asked', now);
  const stale = new Date(now - LEASE_MS).toISOString();
  const rows = ((await env.DB.prepare("SELECT id, at, title, body, priority, tags, click FROM push_queue WHERE status = 'queued' OR (status = 'out' AND out_at < ?1) ORDER BY id LIMIT 20").bind(stale).all()).results) || [];
  if (rows.length) await env.DB.batch(rows.map(r => env.DB.prepare("UPDATE push_queue SET status = 'out', out_at = ?1 WHERE id = ?2").bind(new Date(now).toISOString(), r.id)));
  return { ok: true, items: rows };
}
export async function relayDone(env, b, now) {
  now = now || Date.now();
  await ensurePush(env);
  await note(env, 'relay', 'reported', now);
  const ids = x => (Array.isArray(x) ? x : []).map(n => parseInt(n, 10)).filter(n => n > 0).slice(0, 50);
  const done = ids(b && b.done), failed = ids(b && b.failed), at = new Date(now).toISOString();
  const st = done.map(id => env.DB.prepare("UPDATE push_queue SET status = 'done', done_at = ?1, via = 'mac' WHERE id = ?2 AND status IN ('out', 'queued')").bind(at, id))
    .concat(failed.map(id => env.DB.prepare("UPDATE push_queue SET status = 'queued', why = 'the Mac could not send it either' WHERE id = ?1 AND status = 'out'").bind(id)));
  if (st.length) await env.DB.batch(st);
  return { ok: true, done: done.length, failed: failed.length };
}

// Every 10 minutes. h: { fetch, text(body) -> {ok, retry} } for tests.
export async function pushCron(env, now, h) {
  now = now || Date.now();
  h = h || {};
  if (!env.NTFY_URL) return { off: true };
  await ensurePush(env);
  const iso = t => new Date(t).toISOString();
  const waiting = ((await env.DB.prepare("SELECT * FROM push_queue WHERE status IN ('queued', 'out') ORDER BY id LIMIT 50").all()).results) || [];
  let sent = 0, texted = 0, dropped = 0;
  // 1. ntfy straight again: one first, the rest only if that one goes.
  const fresh = waiting.filter(r => r.status === 'queued');
  for (const r of fresh) {
    const why = await direct(env, r, h);
    if (why) { await note(env, 'direct', 'failed: ' + why, now); break; }
    await env.DB.prepare("UPDATE push_queue SET status = 'done', done_at = ?1, via = 'direct' WHERE id = ?2").bind(iso(now), r.id).run();
    await note(env, 'direct', 'ok', now);
    r.status = 'done'; sent++;
  }
  // 2. Important ones still waiting: one text for all of them.
  const late = waiting.filter(r => r.status !== 'done' && HIGH.has(String(r.priority).toLowerCase()) && now - Date.parse(r.at) >= TEXT_AFTER_MS);
  const to = env.OPS_TEXT_TO || '';
  const hour = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).format(new Date(now));
  if (late.length && to && hour >= 8 && hour < 21) {
    const lines = late.slice(0, 4).map(r => ascii(r.title) + (r.body ? ': ' + String(r.body).replace(/\s+/g, ' ').slice(0, late.length === 1 ? 300 : 90) : ''));
    const body = 'Always Open: ' + (late.length === 1 ? '' : late.length + ' alerts didn’t reach your phone app.\n') + lines.join('\n') + (late.length > 4 ? '\n+' + (late.length - 4) + ' more by email.' : '');
    let r = { ok: false };
    try { r = h.text ? await h.text(body) : await (await import('./sms.js')).sendText(env, { clientId: 'always-open', to, body, kind: 'ops', tz: 'America/New_York' }); } catch (e) { r = { ok: false }; }
    if (r && r.ok) {
      await env.DB.batch(late.map(x => env.DB.prepare("UPDATE push_queue SET status = 'done', done_at = ?1, via = 'text' WHERE id = ?2").bind(iso(now), x.id)));
      texted = late.length;
      late.forEach(x => { x.status = 'done'; });
    }
  }
  // 3. Anything a day old is dropped (it also went by email); old rows are cleared.
  const old = waiting.filter(r => r.status !== 'done' && now - Date.parse(r.at) >= DROP_AFTER_MS);
  if (old.length) { await env.DB.batch(old.map(x => env.DB.prepare("UPDATE push_queue SET status = 'dropped', done_at = ?1 WHERE id = ?2").bind(iso(now), x.id))); dropped = old.length; }
  await env.DB.prepare("DELETE FROM push_queue WHERE status IN ('done', 'dropped') AND at < ?1").bind(iso(now - KEEP_MS)).run();
  return { waiting: waiting.length - sent - texted - dropped, sent, texted, dropped };
}

// For the hourly health check: are pushes reaching the phone, one way or another?
export async function pushHealth(env, now) {
  now = now || Date.now();
  if (!env.NTFY_URL) return { ok: false, why: 'no push topic set: nothing reaches your phone' };
  await ensurePush(env);
  const stuck = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(at) AS first FROM push_queue WHERE status IN ('queued', 'out') AND at < ?1").bind(new Date(now - 15 * 60e3).toISOString()).first();
  const relay = await env.DB.prepare("SELECT at FROM push_meta WHERE k = 'relay'").first().catch(() => null);
  const d = await env.DB.prepare("SELECT at, v FROM push_meta WHERE k = 'direct'").first().catch(() => null);
  const relayMin = relay ? Math.round((now - Date.parse(relay.at)) / 60e3) : null;
  const directOk = d && d.v === 'ok';
  if (stuck && +stuck.n > 0) {
    return { ok: false, why: stuck.n + (stuck.n === 1 ? ' push to your phone is' : ' pushes to your phone are') + ' stuck: ntfy is refusing this server (' + String((d && d.v) || 'no answer').replace(/^failed: /, '') + ') and the Mac relay ' + (relayMin == null ? 'has never checked in' : 'last checked in ' + relayMin + ' minutes ago') + '. Important ones go by text and every alert by email.' };
  }
  // Nothing stuck. Still say so if neither path has worked lately, so a quiet week doesn't hide a broken relay.
  if (d && !directOk && (relayMin == null || relayMin > 30)) return { ok: false, why: 'ntfy is refusing this server and the Gates HQ agent on the Mac has not asked for pushes ' + (relayMin == null ? 'yet' : 'in ' + relayMin + ' minutes') + ': the next push will wait' };
  return { ok: true, why: '' };
}
