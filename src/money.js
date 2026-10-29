// What Max caught: the calls Max answered while the business was closed, and what they are worth at the owner's own
// numbers. One honest figure the owner sees every day, with the arithmetic shown on the card:
//   leads from after-hours calls × the owner's win rate × the owner's average job, and a range at the win rate ± 10 points.
// After hours is the same rule as the public answer rate (answerrate.js): outside 8 AM to 6 PM, Monday to Friday, in the
// business's own time. A lead is a call Max answered where the caller left a name, a number to call back or a reason,
// or booked a time; a booking counts as a lead once, never twice. No average job set: counts only, never a dollar figure.
import { tzFor, local } from './callbacks.js';
import { isAfterHours } from './answerrate.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const SPREAD = 10;   // win-rate points either side for the range

// Round a dollar figure the way a person says it: to $10 under $1,000, $50 under $10,000, $100 above.
export function roundMoney(n) {
  n = Math.max(0, +n || 0);
  const step = n < 1000 ? 10 : (n < 10000 ? 50 : 100);
  return Math.round(n / step) * step;
}
export function dollars(n) { return '$' + Math.round(+n || 0).toLocaleString('en-US'); }

// Pure: the figures from counts and the owner's numbers.
export function figure(c, avgJob, winRate) {
  const avg = Math.max(0, Math.round(+avgJob || 0)), win = Math.max(1, Math.min(100, Math.round(winRate == null ? 30 : +winRate)));
  const at = w => roundMoney(c.leads * avg * w / 100);
  const out = { afterHoursCalls: c.after, leads: c.leads, booked: c.booked, avgJob: avg, winRate: win, low: 0, mid: 0, high: 0 };
  if (avg > 0) { out.mid = at(win); out.low = at(Math.max(0, win - SPREAD)); out.high = at(Math.min(100, win + SPREAD)); }
  out.explained = explain(out);
  return out;
}
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
export function explain(m) {
  if (!m.afterHoursCalls) return 'No after-hours calls yet this month. When Max answers one while you are closed, it counts here.';
  const head = pl(m.afterHoursCalls, 'after-hours call', 'after-hours calls') + ', ' + (m.leads === m.afterHoursCalls ? (m.leads === 1 ? 'and it' : 'all') : m.leads) + ' became ' + (m.leads === 1 ? 'a lead' : 'leads') + (m.booked ? ' (' + m.booked + ' booked a time)' : '') + '.';
  if (!m.avgJob) return head + ' Tell us your average job in Settings and this becomes dollars.';
  if (!m.leads) return head;
  return head + ' At your ' + m.winRate + '% win rate and ' + dollars(m.avgJob) + ' average job, that is about ' + dollars(m.mid) + ' (between ' + dollars(m.low) + ' and ' + dollars(m.high) + ').';
}
// The report's one line, same figures, same words.
export function reportLine(m) {
  if (!m || !m.afterHoursCalls) return '';
  return 'Max answered ' + pl(m.afterHoursCalls, 'call', 'calls') + ' after hours; ' + (m.leads === m.afterHoursCalls && m.leads > 1 ? 'all ' + m.leads : m.leads) + ' became ' + (m.leads === 1 ? 'a lead' : 'leads') + (m.avgJob && m.mid ? ', worth about ' + dollars(m.mid) + ' at your numbers.' : '.');
}

// Counts for the calendar month (in the business's own time) that contains `at`.
export async function countsFor(env, cid, at, tz) {
  tz = tz || await tzFor(env, cid);
  const ym = local(tz, at).day.slice(0, 7);
  const lo = new Date(Date.parse(ym + '-01T00:00:00Z') - 864e5).toISOString(), hi = new Date(Date.parse(ym + '-01T00:00:00Z') + 33 * 864e5).toISOString();
  const rows = ((await env.DB.prepare("SELECT id, at, outcome, caller_name, callback, reason FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview', 'failed')").bind(cid, lo, hi).all()).results) || [];
  let booked = new Set();
  try {
    const b = ((await env.DB.prepare("SELECT call_id FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND call_id != '' AND created >= ?2 AND created < ?3").bind(cid, lo, hi).all()).results) || [];
    booked = new Set(b.map(r => String(r.call_id)));
  } catch (e) { /* no bookings table yet */ }
  let after = 0, leads = 0, nb = 0;
  for (const r of rows) {
    const l = local(tz, Date.parse(r.at));
    if (l.day.slice(0, 7) !== ym || !isAfterHours(l)) continue;
    after++;
    const isBooked = booked.has(String(r.id));
    const isLead = isBooked || ((r.outcome === 'done' || r.outcome === 'transferred') && !!(String(r.caller_name || '').trim() || String(r.callback || '').trim() || String(r.reason || '').trim()));
    if (isLead) leads++;
    if (isBooked) nb++;
  }
  return { month: ym, label: MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4), after, leads, booked: nb };
}
async function settings(env, cid) {
  try { const s = await env.DB.prepare('SELECT avg_job, win_rate FROM app_settings WHERE client_id = ?1').bind(cid).first(); return { avg: +(s && s.avg_job) || 0, win: s && s.win_rate != null ? +s.win_rate : 30 }; }
  catch (e) { return { avg: 0, win: 30 }; }
}
export async function caughtFor(env, cid, at) {
  const tz = await tzFor(env, cid);
  const c = await countsFor(env, cid, at, tz), s = await settings(env, cid);
  return Object.assign({ month: c.month, label: c.label }, figure(c, s.avg, s.win));
}
// For the app: this month so far and last month.
export async function moneyState(env, cid, now) {
  now = now || Date.now();
  const tz = await tzFor(env, cid), s = await settings(env, cid);
  const cur = await countsFor(env, cid, now, tz);
  const prev = await countsFor(env, cid, Date.parse(cur.month + '-01T12:00:00Z') - 2 * 864e5, tz);
  return { thisMonth: Object.assign({ month: cur.month, label: cur.label }, figure(cur, s.avg, s.win)), lastMonth: Object.assign({ month: prev.month, label: prev.label }, figure(prev, s.avg, s.win)) };
}
