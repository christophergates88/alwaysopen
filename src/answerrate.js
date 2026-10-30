// Public answer rate. Real calls, real count: how many calls came in after hours last month, and how many Max picked up.
// After hours means evenings, nights and weekends (outside 8 AM to 6 PM, Monday to Friday, in the business's own time).
// Shown to the owner always; shown to the public only when the owner turns it on AND there were at least ten
// after-hours calls that month. Never seeded, never estimated, never a percentage of a handful.
import { tzFor, local } from './callbacks.js';

const MIN_CALLS = 10;

let ready = false;
export async function ensureAnswer(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS answer_prefs (client_id TEXT PRIMARY KEY, show INTEGER DEFAULT 0, updated TEXT DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS answer_network (k TEXT PRIMARY KEY, at TEXT, data TEXT DEFAULT '')")
  ]);
  ready = true;
}

export function isAfterHours(l) { return l.wd === 'Sat' || l.wd === 'Sun' || l.hour < 8 || l.hour >= 18; }

// Counts for the calendar month that contains `at`, in the client's time. A failed call is the one kind Max did not pick up.
export async function monthCounts(env, cid, at, tz) {
  tz = tz || await tzFor(env, cid);
  const l = local(tz, at), ym = l.day.slice(0, 7);
  const lo = new Date(Date.parse(ym + '-01T00:00:00Z') - 864e5).toISOString(), hi = new Date(Date.parse(ym + '-01T00:00:00Z') + 33 * 864e5).toISOString();
  const rows = ((await env.DB.prepare("SELECT at, outcome FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam')").bind(cid, lo, hi).all()).results) || [];
  let after = 0, answered = 0;
  for (const r of rows) {
    const ll = local(tz, Date.parse(r.at));
    if (ll.day.slice(0, 7) !== ym || !isAfterHours(ll)) continue;
    after++; if (r.outcome !== 'failed') answered++;
  }
  return { month: ym, after, answered };
}

export function rateLine(c) {
  if (!c || !c.after) return '';
  return 'After hours ' + monthName(c.month) + ': ' + c.after + ' call' + (c.after === 1 ? '' : 's') + '. ' + c.answered + ' answered.';
}
export function publicLine(c) {
  if (!c || c.after < MIN_CALLS) return '';
  const pct = Math.round(100 * c.answered / c.after);
  return 'Answered ' + pct + '% of after-hours calls in ' + monthName(c.month) + ' (' + c.after + ' calls)';
}
function monthName(ym) { try { return new Date(ym + '-15T12:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }); } catch (e) { return ym; } }

export async function showing(env, cid) {
  await ensureAnswer(env);
  const r = await env.DB.prepare('SELECT show FROM answer_prefs WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return !!(r && +r.show);
}

// App: POST /api/answer { show: bool }
export async function apiAnswer(req, env, c) {
  await ensureAnswer(env);
  if (c.staff) return { ok: false, error: 'Only the owner can change this.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (typeof b.show !== 'boolean') return { ok: false, error: 'Bad request' };
  await env.DB.prepare('INSERT INTO answer_prefs (client_id, show, updated) VALUES (?1,?2,?3) ON CONFLICT(client_id) DO UPDATE SET show = excluded.show, updated = excluded.updated').bind(c.client_id, b.show ? 1 : 0, new Date().toISOString()).run();
  return { ok: true, show: b.show, message: b.show ? 'Your answer rate shows on the map once a month has ten or more after-hours calls.' : 'Your answer rate is private.' };
}

// For the app: this month and last month, the public line if any, and a line the owner can paste on his Google profile.
export async function answerState(env, cid) {
  const tz = await tzFor(env, cid);
  const now = Date.now();
  const thisM = await monthCounts(env, cid, now, tz);
  const lastM = await monthCounts(env, cid, Date.parse(thisM.month + '-01T12:00:00Z') - 864e5, tz);
  const show = await showing(env, cid);
  const pub = publicLine(lastM);
  return { show, thisMonth: thisM, lastMonth: lastM, line: rateLine(thisM), lastLine: rateLine(lastM), publicLine: pub, paste: pub ? pub + '. Every call answered, day or night.' : '', minCalls: MIN_CALLS };
}

// For the map: last month's public line for every opted-in client that qualifies. Cheap enough per request (cached per area upstream).
export async function publicLines(env, cids) {
  await ensureAnswer(env);
  if (!cids.length) return {};
  const on = ((await env.DB.prepare('SELECT client_id FROM answer_prefs WHERE show = 1').all()).results) || [];
  const want = new Set(on.map(r => r.client_id).filter(id => cids.includes(id)));
  const out = {};
  const lastMonthAt = Date.now() - 20 * 864e5 - (new Date().getUTCDate() * 864e5);
  for (const cid of want) {
    try { const c = await monthCounts(env, cid, lastMonthAt); const l = publicLine(c); if (l) out[cid] = l; } catch (e) {}
  }
  return out;
}

// Every business together, last full month: after-hours calls and how many Max picked up. For the website's sample
// report, shown only once the total is big enough to mean something; never a percentage of a handful.
export const NETWORK_MIN = 50;
const lastFullAt = now => Date.parse(new Date(now).toISOString().slice(0, 8) + '01T12:00:00Z') - 10 * 864e5;
const lastFullMonth = now => new Date(lastFullAt(now)).toISOString().slice(0, 7);
export async function networkMonth(env, now) {
  now = now || Date.now();
  const rows = ((await env.DB.prepare("SELECT client_id FROM app_clients WHERE active = 1 AND client_id NOT IN ('always-open', 'demo-plumbing')").all()).results) || [];
  const at = lastFullAt(now);
  const out = { month: '', after: 0, answered: 0, businesses: 0 };
  for (const r of rows) {
    const c = await monthCounts(env, r.client_id, at);
    out.month = out.month || c.month;
    if (c.after) { out.after += c.after; out.answered += c.answered; out.businesses++; }
  }
  return out;
}
// The website's sample report reads the network month from here: worked out at most once a day and kept in D1 (and
// for a few minutes in the worker's memory), never once per visitor.
const NETWORK_EVERY = 24 * 3600e3, MEMO_MS = 5 * 60e3;
let memo = null;
export async function networkCached(env, now) {
  now = now || Date.now();
  if (memo && now - memo.t < MEMO_MS) return memo.n;
  await ensureAnswer(env);
  const row = await env.DB.prepare("SELECT at, data FROM answer_network WHERE k = 'month'").first().catch(() => null);
  let n = null;
  if (row && now - Date.parse(row.at || '') < NETWORK_EVERY) { try { n = JSON.parse(row.data || 'null'); } catch (e) { n = null; } }
  if (n && n.month && n.month !== lastFullMonth(now)) n = null;   // a new month started: last month's figure is due
  if (!n) {
    // Stamp first, so visitors arriving while it's being worked out read the old figure instead of all working it out too.
    if (row) await env.DB.prepare("UPDATE answer_network SET at = ?1 WHERE k = 'month'").bind(new Date(now).toISOString()).run();
    n = await networkMonth(env, now);
    await env.DB.prepare("INSERT OR REPLACE INTO answer_network (k, at, data) VALUES ('month', ?1, ?2)").bind(new Date(now).toISOString(), JSON.stringify(n)).run();
  }
  memo = { t: now, n };
  return n;
}
export function forgetNetwork() { memo = null; }
export function networkLine(n) {
  if (!n || n.after < NETWORK_MIN || n.businesses < 3) return '';
  return 'Real numbers, not the sample: in ' + monthName(n.month) + ', Max answered ' + Math.round(100 * n.answered / n.after) + '% of ' + n.after.toLocaleString('en-US') + ' after-hours calls across ' + n.businesses + ' Always Open businesses.';
}
