// Who's drifting: the signals that come before a cancellation, per paying client, for Christopher only.
// Nothing here changes a client's data or reaches a client. It feeds the ops board (one sortable table), the Monday
// email, and the 7 AM summary.
//   1. Forwarding: calls to Max in the last 7 days against the weekly average of the 4 weeks before. A line that
//      averaged 2 or more a week and has none this week almost always means call forwarding was turned off.
//   2. Calls falling: this week at 40% or less of that average (and the average was 3 or more).
//   3. The owner went quiet: days since the owner (not Always Open) approved or skipped something, marked a call handled,
//      sent a message or logged a job. New clients (under 14 days) are never "quiet".
//   4. Drafts piling up: things waiting on the owner for more than 3 days.
//   5. Money: Stripe says past due or unpaid.
// The score is a plain sum of those, so the reasons always explain it. Value this month (what Max caught after hours)
// is shown beside it: a client who is winning and drifting is the first call to make.
import { DEMO_ID } from './demo.js';

const DAY = 864e5;
export const INTERNAL = new Set(['always-open', 'demo-plumbing']);
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// Pure: one client's signals to a score, a level and the reasons in words.
// s: { weekCalls, priorWeekly, quietDays, tenureDays, waiting, pay, hasLine }
export function score(s) {
  const reasons = [];
  let n = 0;
  const avg = Math.round((+s.priorWeekly || 0) * 10) / 10;
  if (s.hasLine && avg >= 2 && !s.weekCalls) { n += 40; reasons.push('no calls this week (averaged ' + avg + ' a week): forwarding probably off'); }
  else if (s.hasLine && avg >= 3 && s.weekCalls <= avg * 0.4) { n += 20; reasons.push('calls down to ' + s.weekCalls + ' this week from about ' + avg); }
  if ((+s.tenureDays || 0) >= 14 && s.quietDays != null) {
    if (s.quietDays >= 30) { n += 35; reasons.push('owner silent for ' + s.quietDays + ' days'); }
    else if (s.quietDays >= 14) { n += 25; reasons.push('owner silent for ' + s.quietDays + ' days'); }
  }
  if ((+s.tenureDays || 0) >= 14 && s.quietDays == null) { n += 30; reasons.push('owner has never used the app'); }
  if (s.waiting >= 5) { n += 10; reasons.push(pl(s.waiting, 'draft', 'drafts') + ' waiting over 3 days'); }
  if (s.pay === 'unpaid') { n += 40; reasons.push('Stripe: unpaid'); }
  else if (s.pay === 'past_due') { n += 30; reasons.push('Stripe: payment failed, retrying'); }
  n = Math.min(100, n);
  return { score: n, level: n >= 50 ? 'call' : n >= 25 ? 'watch' : 'ok', reasons };
}

// Every paying client, scored, worst first.
export async function driftRows(env, now) {
  now = now || Date.now();
  const iso = t => new Date(t).toISOString();
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const clients = await all("SELECT c.client_id, c.business, b.plan, b.status, b.created, (SELECT COUNT(*) FROM voice_lines v WHERE v.client_id = c.client_id AND v.on_air = 1) AS lines FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id WHERE c.active = 1 AND c.client_id != ?1", DEMO_ID);
  const week = iso(now - 7 * DAY), month = iso(now - 35 * DAY), stale = iso(now - 3 * DAY);
  const byCid = rows => { const m = {}; for (const r of rows) m[r.client_id] = r; return m; };
  const [wk, prior, items, calls, msgs, jobs, waiting] = await Promise.all([
    all("SELECT client_id, COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('spam', 'limited', 'interview') GROUP BY client_id", week),
    all("SELECT client_id, COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND at < ?2 AND test = 0 AND outcome NOT IN ('spam', 'limited', 'interview') GROUP BY client_id", month, week),
    all("SELECT client_id, MAX(decided_at) AS t FROM app_items WHERE decided_at IS NOT NULL AND decided_at != '' AND COALESCE(decided_by, '') NOT IN ('', 'Always Open') GROUP BY client_id"),
    all("SELECT client_id, MAX(handled_at) AS t FROM app_calls WHERE handled_at != '' GROUP BY client_id"),
    all("SELECT client_id, MAX(at) AS t FROM app_messages WHERE dir = 'in' GROUP BY client_id"),
    all("SELECT client_id, MAX(created) AS t FROM biz_jobs WHERE by != '' AND source NOT IN ('demo', 'import') GROUP BY client_id"),
    all("SELECT client_id, COUNT(*) AS n FROM app_items WHERE status = 'pending' AND created < ?1 GROUP BY client_id", stale)
  ]);
  const W = byCid(wk), P = byCid(prior), I = byCid(items), C = byCid(calls), M = byCid(msgs), J = byCid(jobs), WT = byCid(waiting);
  let money = null; try { money = await import('./money.js'); } catch (e) { money = null; }
  const out = [];
  for (const c of clients) {
    if (INTERNAL.has(c.client_id)) continue;
    if (c.status && !/^(active|trialing|past_due|unpaid)$/.test(c.status)) continue;
    const last = [I, C, M, J].map(x => x[c.client_id] && Date.parse(x[c.client_id].t)).filter(Boolean);
    const lastAt = last.length ? Math.max(...last) : 0;
    const sig = {
      weekCalls: +(W[c.client_id] && W[c.client_id].n) || 0,
      priorWeekly: (+(P[c.client_id] && P[c.client_id].n) || 0) / 4,
      quietDays: lastAt ? Math.floor((now - lastAt) / DAY) : null,
      tenureDays: c.created ? Math.floor((now - Date.parse(c.created)) / DAY) : 999,
      waiting: +(WT[c.client_id] && WT[c.client_id].n) || 0,
      pay: c.status === 'unpaid' || c.status === 'past_due' ? c.status : '',
      hasLine: +c.lines > 0
    };
    const r = score(sig);
    let caught = 0;
    if (money) { try { caught = (await money.caughtFor(env, c.client_id, now)).mid || 0; } catch (e) { caught = 0; } }
    out.push(Object.assign({ client_id: c.client_id, business: c.business || c.client_id, plan: c.plan || '', caught }, sig, r));
  }
  return out.sort((a, b) => (b.score - a.score) || (b.caught - a.caught) || String(a.business).localeCompare(String(b.business)));
}

// The ops board's table. Rows at "ok" are folded into one line so the table stays about the ones that need you.
export function driftTable(rows) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  if (!rows.length) return '';
  const bad = rows.filter(r => r.level !== 'ok'), fine = rows.length - bad.length;
  const $ = n => n ? '$' + Math.round(n).toLocaleString('en-US') : '–';
  return '<section><h2>Who’s drifting</h2>' +
    (bad.length ? '<div class="dr-wrap"><table class="dr"><thead><tr><th>Business</th><th>Risk</th><th>Calls this wk</th><th>Owner last seen</th><th>Caught this month</th><th>Why</th></tr></thead><tbody>' +
      bad.map(r => '<tr class="' + r.level + '"><td><b>' + esc(r.business) + '</b><span>' + esc(r.plan) + '</span></td><td><i>' + (r.level === 'call' ? 'Call them' : 'Watch') + '</i> ' + r.score + '</td><td>' + r.weekCalls + (r.priorWeekly ? ' <span>avg ' + (Math.round(r.priorWeekly * 10) / 10) + '</span>' : '') + '</td><td>' + (r.quietDays == null ? 'never' : r.quietDays + ' d ago') + '</td><td>' + $(r.caught) + '</td><td>' + esc(r.reasons.join('; ')) + '</td></tr>').join('') +
      '</tbody></table></div>' : '<p>Nobody is drifting.</p>') +
    (fine ? '<p class="dr-ok">' + pl(fine, 'other client looks', 'other clients look') + ' fine.</p>' : '') + '</section>';
}
export const DRIFT_CSS = '.dr-wrap{overflow-x:auto}.dr{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}.dr th{font-size:12px;text-align:left;color:var(--slate);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.dr td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.dr td span{display:block;color:var(--slate);font-size:12px}.dr i{font-style:normal;font-weight:700;font-size:12px;padding:2px 7px;border-radius:6px}.dr tr.call i{background:#FDECEA;color:#B42318}.dr tr.watch i{background:#FBF0DC;color:#9A5B00}.dr-ok{color:var(--slate);font-size:14px}';

// Lines for the Monday email and the morning summary.
export function driftText(rows) {
  const bad = rows.filter(r => r.level === 'call');
  if (!bad.length) return '';
  return 'Call them: ' + bad.slice(0, 4).map(r => r.business + ' (' + r.reasons[0] + ')').join('; ') + (bad.length > 4 ? '; and ' + (bad.length - 4) + ' more' : '') + '.';
}
