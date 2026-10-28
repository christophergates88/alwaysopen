// Public answer rate. Real calls, real count: how many calls came in after hours last month, and how many Max picked up.
// After hours means evenings, nights and weekends (outside 8 AM to 6 PM, Monday to Friday, in the business's own time).
// Shown to the owner always; shown to the public only when the owner turns it on AND there were at least ten
// after-hours calls that month. Never seeded, never estimated, never a percentage of a handful.
import { tzFor, local } from './callbacks.js';

const MIN_CALLS = 10;

let ready = false;
export async function ensureAnswer(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS answer_prefs (client_id TEXT PRIMARY KEY, show INTEGER DEFAULT 0, updated TEXT DEFAULT '')").run();
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
