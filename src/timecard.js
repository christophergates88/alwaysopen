// Max's timecard: every Monday morning (8 to 11 AM in the business's own time) the owner gets one short text and an
// app card for last week, Monday to Sunday: hours on duty (always 168), calls answered, booked, call-backs kept, what
// after-hours calls were worth at the owner's own numbers (money.js), and what Max cost that week (plan / 52 weeks × 12).
// Deadpan, numbers only. Texts go through sms.js sendText (opt-outs, daytime, ceilings). Each week is sent once.
// Also here: review(a) — Max's month, reviewed, for the monthly page (monthpage.js): what went well, what slipped, one change.
import { tzFor, local, fromLocal, ensureCallbacks } from './callbacks.js';
import { isAfterHours } from './answerrate.js';
import { figure } from './money.js';
import { hoursText } from './clock.js';
import { PLANS, MAX } from './facts.js';

export const HOURS = 168;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLAN_CENTS = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.cents]));   // facts.js
const MORE_MINUTES_CENTS = MAX.moreCents;   // facts.js
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const dollars = n => '$' + Math.round(+n || 0).toLocaleString('en-US');

// What Max costs in a week: the monthly price × 12 months / 52 weeks, to the dollar.
export function weekCost(monthlyCents) { return Math.round((+monthlyCents || 0) * 12 / 52 / 100); }
export function planCents(plan, moreMinutes) { return (PLAN_CENTS[plan] || 0) + (moreMinutes ? MORE_MINUTES_CENTS : 0); }

const addDay = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const short = day => MON[+day.slice(5, 7) - 1] + ' ' + (+day.slice(8, 10));
// Last full week, Monday to Sunday, in the business's time, for a moment in the week after it.
export function lastWeek(tz, now) {
  const l = local(tz, now);
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[l.wd] || 0;
  const thisMon = addDay(l.day, -back), prevMon = addDay(thisMon, -7);
  return { week: prevMon, from: new Date(fromLocal(tz, prevMon, 0, 0)).toISOString(), to: new Date(fromLocal(tz, thisMon, 0, 0)).toISOString(), label: short(prevMon) + '–' + short(addDay(prevMon, 6)) };
}

// Pure: the card's numbers.
export function timecardNumbers(c) {
  const m = figure({ after: c.after || 0, leads: c.leads || 0, booked: c.booked || 0 }, c.avgJob || 0, c.winRate == null ? 30 : c.winRate);
  return { hours: HOURS, calls: c.calls || 0, booked: c.booked || 0, kept: c.kept || 0, due: c.due || 0, after: c.after || 0, leads: c.leads || 0,
    caught: m.mid || 0, cost: weekCost(c.monthlyCents), back: Math.round(c.back || 0) };
}
// Pure: the text, one line per fact, nothing else.
export function timecardText(t, name, label) {
  const n = name || 'Max';
  const out = [n + '’s timecard, ' + label + '.', 'On the clock: ' + t.hours + ' hours.', 'Answered: ' + pl(t.calls, 'call', 'calls') + '.'];
  if (t.booked) out.push('Booked: ' + t.booked + '.');
  if (t.due) out.push('Call-backs kept: ' + t.kept + ' of ' + t.due + '.');
  if (t.caught) out.push('Caught after hours: about ' + dollars(t.caught) + '.');
  else if (t.leads) out.push('After-hours leads: ' + t.leads + '.');
  if (t.back) out.push('Back to you: ' + hoursText(t.back, true) + '.');
  if (t.cost) out.push('Cost you: ' + dollars(t.cost) + '.');
  if (!t.calls) out.push('Quiet week. He was there anyway.');
  return out.join('\n');
}

export async function ensureTimecards(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS max_timecards (client_id TEXT NOT NULL, week TEXT NOT NULL, at TEXT, nums TEXT DEFAULT '', status TEXT DEFAULT '', PRIMARY KEY (client_id, week))").run();
  // The owner's question back and Max's answer (Brief 7): [{ q, a, at }]
  try { await env.DB.prepare("ALTER TABLE max_timecards ADD COLUMN qa TEXT DEFAULT ''").run(); } catch (e) { /* already there */ }
}

async function lineName(env, cid) {
  try { const l = await env.DB.prepare('SELECT owner_set, facts FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(cid).first(); const o = JSON.parse((l && l.owner_set) || '{}'), f = JSON.parse((l && l.facts) || '{}'); return String(o.name || f.name || 'Max').replace(/[^A-Za-z .'-]/g, '').slice(0, 30) || 'Max'; }
  catch (e) { return 'Max'; }
}

// Counts for one week (from/to ISO). Every query tolerates a missing table.
export async function weekCounts(env, cid, w, tz) {
  const q = async (sql, ...b) => { try { return ((await env.DB.prepare(sql).bind(...b).all()).results) || []; } catch (e) { return []; } };
  const calls = await q("SELECT id, at, outcome, caller_name, callback, reason FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview', 'failed')", cid, w.from, w.to);
  const books = await q("SELECT call_id FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND created >= ?2 AND created < ?3", cid, w.from, w.to);
  const booked = new Set(books.map(r => String(r.call_id || '')).filter(Boolean));
  let after = 0, leads = 0, bookedAfter = 0;
  for (const r of calls) {
    if (!isAfterHours(local(tz, Date.parse(r.at)))) continue;
    after++;
    const isB = booked.has(String(r.id));
    if (isB || ((r.outcome === 'done' || r.outcome === 'transferred') && !!(String(r.caller_name || '').trim() || String(r.callback || '').trim() || String(r.reason || '').trim()))) leads++;
    if (isB) bookedAfter++;
  }
  await ensureCallbacks(env).catch(() => {});
  const cbs = await q("SELECT status FROM callbacks WHERE client_id = ?1 AND due_at >= ?2 AND due_at < ?3 AND status NOT IN ('cancelled', 'optout')", cid, w.from, w.to);
  let set = null;
  try { set = await env.DB.prepare('SELECT avg_job, win_rate FROM app_settings WHERE client_id = ?1').bind(cid).first(); } catch (e) { set = null; }
  let bill = null, cl = null;
  try { bill = await env.DB.prepare('SELECT plan, max FROM billing WHERE client_id = ?1').bind(cid).first(); } catch (e) { bill = null; }
  try { cl = await env.DB.prepare('SELECT tier FROM app_clients WHERE client_id = ?1').bind(cid).first(); } catch (e) { cl = null; }
  let back = 0;
  try { back = (await (await import('./clock.js')).clockFor(env, cid, w.from, w.to, { tz })).backMin; } catch (e) { back = 0; }
  return { calls: calls.length, booked: books.length, after, leads, bookedAfter, kept: cbs.filter(r => r.status === 'done').length, due: cbs.length, back,
    avgJob: +(set && set.avg_job) || 0, winRate: set && set.win_rate != null ? +set.win_rate : 30,
    monthlyCents: planCents((bill && bill.plan) || (cl && cl.tier) || '', !!(bill && +bill.max)) };
}

export async function timecardFor(env, cid, now) {
  const tz = await tzFor(env, cid);
  const w = lastWeek(tz, now || Date.now());
  const c = await weekCounts(env, cid, w, tz);
  const t = timecardNumbers(Object.assign({}, c, { booked: c.booked }));
  t.after = c.after; t.leads = c.leads;
  const name = await lineName(env, cid);
  return { week: w.week, label: w.label, name, nums: t, text: timecardText(t, name, w.label) };
}

// For the app: last week's card (the one sent, or worked out now if Monday's hasn't gone yet).
export async function timecardState(env, cid, now) {
  try {
    const tc = await timecardFor(env, cid, now);
    // What was actually sent (Monday's text, when it went, and any question back with Max's answer).
    let row = null;
    try { await ensureTimecards(env); row = await env.DB.prepare('SELECT at, nums, status, qa FROM max_timecards WHERE client_id = ?1 AND week = ?2').bind(cid, tc.week).first(); } catch (e) { row = null; }
    let nums = tc.nums, text = tc.text;
    if (row && row.nums) { try { nums = Object.assign({}, tc.nums, JSON.parse(row.nums)); text = timecardText(nums, tc.name, tc.label); } catch (e) { /* worked out now */ } }
    let qa = [];
    try { qa = (JSON.parse((row && row.qa) || '[]') || []).filter(x => x && x.q && x.a).slice(-3).map(x => ({ q: String(x.q).slice(0, 300), a: String(x.a).slice(0, 400), at: x.at || '' })); } catch (e) { qa = []; }
    const tz = await tzFor(env, cid);
    const when = row && row.at ? new Date(row.at).toLocaleString('en-US', { timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit' }).replace(',', '') : '';
    return { label: tc.label, name: tc.name, hours: nums.hours, calls: nums.calls, booked: nums.booked, kept: nums.kept, due: nums.due, caught: nums.caught, leads: nums.leads, cost: nums.cost, back: nums.back, text,
      sent: !!(row && row.status === 'sent'), when, qa };
  } catch (e) { return null; }
}

// ---------- the owner's question back (Brief 7) ----------
// A text from the owner to their own line, within 24 hours of a timecard going out, that asks something ("what did the
// after-hours calls come from?") is answered from that week's call write-ups, in a sentence or two. Anything else the
// owner texts is still a note for Max (duties.js tellMax).
export const isQuestion = t => /\?\s*$/.test(String(t || '').trim()) || /^(what|which|how|who|why|when|where|did|was|were|any|anything)\b/i.test(String(t || '').trim());
export const QA_PROMPT = 'Answer the owner\'s question about last week\'s calls from these write-ups only; numbers and plain words; under 40 words. If the write-ups do not answer it, say that in one short sentence. No greeting, no sign-off.';
export function clip40(t) {
  const w = String(t || '').replace(/\s+/g, ' ').trim().split(' ');
  if (w.length <= 40) return w.join(' ');
  const cut = w.slice(0, 40).join(' '), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
  return end > 40 ? cut.slice(0, end + 1) : cut.replace(/[,;:]?$/, '.');
}
export async function timecardReply(env, cid, text, now, h) {
  now = now || Date.now(); h = h || {};
  if (!isQuestion(text)) return null;
  await ensureTimecards(env);
  const row = await env.DB.prepare("SELECT week, at, qa FROM max_timecards WHERE client_id = ?1 AND status = 'sent' AND at > ?2 ORDER BY at DESC LIMIT 1").bind(cid, new Date(now - 24 * 3600e3).toISOString()).first().catch(() => null);
  if (!row) return null;
  const tz = await tzFor(env, cid);
  const from = new Date(fromLocal(tz, row.week, 0, 0)).toISOString(), to = new Date(fromLocal(tz, addDay(row.week, 7), 0, 0)).toISOString();
  const calls = ((await env.DB.prepare("SELECT at, caller_name, reason, summary, urgency, outcome FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview', 'failed') ORDER BY at LIMIT 80").bind(cid, from, to).all().catch(() => ({ results: [] }))).results) || [];
  const lines = calls.map(c => { const l = local(tz, Date.parse(c.at)); return l.wd + ' ' + String(l.hour).padStart(2, '0') + ':' + String(l.minute).padStart(2, '0') + (isAfterHours(l) ? ' (after hours)' : '') + (/urgent/i.test(c.urgency || '') ? ' (urgent)' : '') + ': ' + String(c.summary || c.reason || 'call').replace(/\s+/g, ' ').slice(0, 220); });
  const ask = h.brain || (async (sys, msgs) => (await (await import('./voice.js')).brain(env, sys, msgs, null, 140)).text);
  let a = '';
  try { a = clip40(await ask(QA_PROMPT, [{ role: 'user', content: 'Write-ups of last week\'s calls (' + calls.length + '):\n' + (lines.join('\n') || '(no calls)') + '\n\nThe owner asks: ' + String(text).slice(0, 400) }])); } catch (e) { a = ''; }
  if (!a) return null;
  let qa = []; try { qa = JSON.parse(row.qa || '[]') || []; } catch (e) { qa = []; }
  qa.push({ q: String(text).slice(0, 300), a, at: new Date(now).toISOString() });
  await env.DB.prepare('UPDATE max_timecards SET qa = ?1 WHERE client_id = ?2 AND week = ?3').bind(JSON.stringify(qa.slice(-6)), cid, row.week).run().catch(() => {});
  return a;
}

// Monday morning, once a week per business. h: { send(cid, to, body, tz), push(cid, note) } for tests; defaults to the real ones.
export async function timecardCron(env, now, h) {
  now = now || Date.now();
  h = h || {};
  await ensureTimecards(env);
  const rows = ((await env.DB.prepare("SELECT c.client_id, c.phone, c.business, MAX(l.on_air) AS on_air FROM app_clients c JOIN voice_lines l ON l.client_id = c.client_id WHERE c.active = 1 AND c.client_id NOT IN ('demo-plumbing', 'always-open') GROUP BY c.client_id LIMIT 500").all()).results) || [];
  // Every send and every skip is written down once a week, with the reason, so a quiet Monday can be read (Brief 7).
  const note = (cid, week, what, why) => env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'timecard', ?2)").bind(new Date(now).toISOString(), JSON.stringify({ cid, week, what, why })).run().catch(() => {});
  const stats = { looked: 0, sent: 0, held: 0 };
  for (const r of rows) {
    const tz = await tzFor(env, r.client_id);
    const l = local(tz, now);
    if (l.wd !== 'Mon' || l.hour < 8 || l.hour >= 11) continue;
    stats.looked++;
    const w = lastWeek(tz, now);
    const done = await env.DB.prepare("SELECT status FROM max_timecards WHERE client_id = ?1 AND week = ?2").bind(r.client_id, w.week).first().catch(() => null);
    if (done && done.status !== 'held') continue;
    if (!+r.on_air) {
      await env.DB.prepare("INSERT OR REPLACE INTO max_timecards (client_id, week, at, nums, status) VALUES (?1, ?2, ?3, '', 'off')").bind(r.client_id, w.week, new Date(now).toISOString()).run();
      await note(r.client_id, w.week, 'skipped', 'the phone line is off');
      continue;
    }
    const tc = await timecardFor(env, r.client_id, now);
    let status = 'app', why = r.phone ? '' : 'no owner cell on file, so it is in the app only';
    if (r.phone) {
      const send = h.send || (async (cid, to, body, z) => (await import('./sms.js')).sendText(env, { clientId: cid, to, body, kind: 'timecard', tz: z }));
      const res = await send(r.client_id, r.phone, tc.text, tz).catch(() => ({ ok: false }));
      status = res && res.ok ? 'sent' : (res && res.retry ? 'held' : 'app');
      if (!(res && res.ok)) why = String((res && (res.why || res.error)) || 'the text did not send').slice(0, 160);
    }
    await note(r.client_id, w.week, status === 'sent' ? 'sent' : (status === 'held' ? 'held, trying again' : 'skipped'), why);
    const push = h.push || (async (cid, note) => (await import('./app.js')).pushClient(env, cid, note));
    if (status !== 'held') await push(r.client_id, { aps: { alert: { title: tc.name + '’s week: ' + pl(tc.nums.calls, 'call', 'calls') + (tc.nums.booked ? ', ' + tc.nums.booked + ' booked' : ''), body: tc.text.split('\n').slice(1).join(' ').slice(0, 300) }, 'thread-id': 'timecard' }, screen: 'max' }).catch(() => {});
    await env.DB.prepare('INSERT OR REPLACE INTO max_timecards (client_id, week, at, nums, status) VALUES (?1,?2,?3,?4,?5)').bind(r.client_id, w.week, new Date(now).toISOString(), JSON.stringify(tc.nums), status).run();
    if (status === 'sent') stats.sent++; else if (status === 'held') stats.held++;
  }
  return stats;
}

// ---------- Max's month, reviewed (monthly page) ----------
// Pure, from insights.analyze output. Never more than three lines a side; one change, said plainly.
export function review(a, name) {
  const n = name || 'Max', c = (a && a.calls) || {}, cb = c.callbacks || {}, w = (a && a.work) || {}, lost = (a && a.lost) || null;
  const good = [], missed = [];
  if (c.n) good.push('Answered ' + pl(c.n, 'call', 'calls') + (c.after ? ', ' + c.after + ' of them after hours or on a weekend' : '') + '.');
  const booked = (c.booked || 0) + ((w.fill && w.fill.booked) || 0);
  if (booked) good.push('Booked ' + pl(booked, 'visit', 'visits') + (c.leads ? ' from ' + pl(c.leads, 'lead', 'leads') : '') + '.');
  if (cb.set && (cb.kept || 0) === cb.set) good.push('Kept every call-back time he promised (' + cb.set + ').');
  if (c.urgent) good.push('Caught ' + pl(c.urgent, 'urgent call', 'urgent calls') + (c.transferred ? ' and rang ' + (c.transferred === 1 ? 'it' : c.transferred) + ' through to you' : '') + '.');
  if (c.spanish) good.push('Handled ' + pl(c.spanish, 'call', 'calls') + ' in Spanish.');
  const open = Math.max(0, (c.leads || 0) - (c.booked || 0));
  if (open && c.leads) missed.push(pl(open, 'lead', 'leads') + ' left details but didn’t book a time.');
  if (cb.set && (cb.kept || 0) < cb.set) missed.push(pl(cb.set - (cb.kept || 0), 'call-back', 'call-backs') + ' went past the promised time' + (cb.missed ? ' and had to be reset' : '') + '.');
  if (lost && lost.n && lost.top && lost.top[0]) missed.push(pl(lost.n, 'caller', 'callers') + ' walked. Most ' + lost.top[0].label + '.');
  let change = '';
  if (lost && lost.top && lost.top[0] && lost.top[0].r === 'price') change = 'Price is why most walked. Give ' + n + ' your standard prices in Job description, so callers hear a number instead of “we’ll quote it.”';
  else if (lost && lost.top && lost.top[0] && lost.top[0].r === 'timing') change = 'Timing is why most walked. Open more booking hours in Booking so ' + n + ' can offer sooner times.';
  else if (lost && lost.top && lost.top[0] && lost.top[0].r === 'distance') change = 'Distance is why most walked. Check the area you serve on the Teach tab is right.';
  else if (open >= 2) change = 'Let ' + n + ' book open times himself (Booking tab), so more leads leave with a time instead of a promise.';
  else if (cb.set && (cb.kept || 0) < cb.set) change = 'Call-backs slipped. If a time doesn’t work, tap “30 more minutes” on the nudge so ' + n + ' resets it before it passes.';
  else if (c.n) change = 'Nothing to fix. Tell ' + n + ' about anything new this month by texting your business line.';
  return { good: good.slice(0, 3), missed: missed.slice(0, 3), change, any: !!(good.length || missed.length) };
}
