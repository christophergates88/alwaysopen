// The monthly report's analytics: what the office did in a month, when the phone rang, why callers didn't book, how
// reviews and follow-ups went, where the business stands against the ones nearby, and what that means in plain words.
// gather() reads one client's month from the tables the rest of the system already writes; analyze() is pure (tests).
// Nothing here ever names a customer: counts, times and money only.
import { local } from './callbacks.js';
import { isAfterHours } from './answerrate.js';
import { LABELS as LOST_LABELS } from './lost.js';
import { dollars } from './money.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
// When the phone rang, in six bands of the business's own day. Overnight wraps past midnight.
export const BANDS = ['6 to 9 AM', '9 AM to noon', 'noon to 3 PM', '3 to 6 PM', '6 to 9 PM', '9 PM to 6 AM'];
export function bandOf(hour) { return hour >= 6 && hour < 9 ? 0 : hour >= 9 && hour < 12 ? 1 : hour >= 12 && hour < 15 ? 2 : hour >= 15 && hour < 18 ? 3 : hour >= 18 && hour < 21 ? 4 : 5; }
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// A quote amount as the owner typed it ("$1,500", "1500-2000", "$2.5k", "about 900"): the first number only, k for
// thousands. Anything without a readable number, or past any real quote, counts as nothing.
export function money(v) {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k\b)?/i.exec(String(v == null ? '' : v));
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, '') + (m[2] || '')) * (m[3] ? 1000 : 1);
  return isFinite(n) && n > 0 && n < 1e7 ? Math.round(n) : 0;
}

// ---------- reading a month ----------
export async function gather(env, cid, startIso, endIso) {
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const one = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).first()) || null; } catch (e) { return null; } };
  const a = startIso, b = endIso, ym = String(startIso).slice(0, 7);
  const [calls, lost, callbacks, bookings, leads, jobs, followups, checkins, fill, handoffs, texts, reviews, won, gbp, snapWeek] = await Promise.all([
    all("SELECT id, at, seconds, outcome, transferred, lang, urgency, caller_name, callback, reason FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited')", cid, a, b),
    all('SELECT reason FROM call_lost WHERE client_id = ?1 AND at >= ?2 AND at < ?3', cid, a, b),
    all('SELECT status FROM callbacks WHERE client_id = ?1 AND created >= ?2 AND created < ?3', cid, a, b),
    all("SELECT call_id FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND created >= ?2 AND created < ?3", cid, a, b),
    one('SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at >= ?2 AND at < ?3', cid, a, b),
    one('SELECT COUNT(*) AS n, SUM(CASE WHEN consent = 1 THEN 1 ELSE 0 END) AS asked FROM app_jobs WHERE client_id = ?1 AND at >= ?2 AND at < ?3', cid, a, b),
    all("SELECT kind, status, amount FROM app_followups WHERE client_id = ?1 AND status = 'done' AND done_at >= ?2 AND done_at < ?3", cid, a, b),
    all("SELECT status FROM checkins WHERE client_id = ?1 AND COALESCE(NULLIF(done_at, ''), created) >= ?2 AND COALESCE(NULLIF(done_at, ''), created) < ?3", cid, a, b),
    all('SELECT status FROM fillweek_offers WHERE client_id = ?1 AND at >= ?2 AND at < ?3', cid, a, b),
    all('SELECT from_id, to_id FROM handoffs WHERE (from_id = ?1 OR to_id = ?1) AND at >= ?2 AND at < ?3', cid, a, b),
    all('SELECT kind, COUNT(*) AS n FROM sms_log WHERE client_id = ?1 AND at >= ?2 AND at < ?3 GROUP BY kind', cid, a, b),
    all("SELECT stars, status, created, decided_at FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'review') AND created >= ?2 AND created < ?3", cid, a, b),
    // Imported past jobs are history (dated the day of the import), not this month's work, as on the app's job board
    // (biz.js bizState). The sample business's own jobs (source 'demo') are its month, so they count.
    all("SELECT stage, ROUND(amount / 100.0) AS amount FROM biz_jobs WHERE client_id = ?1 AND stage IN ('booked', 'done', 'paid') AND COALESCE(source, '') != 'import' AND updated >= ?2 AND updated < ?3", cid, a, b),
    one('SELECT calls, clicks, directions FROM gbp_metrics WHERE client_id = ?1 AND month = ?2', cid, ym),
    one('SELECT week FROM rival_snap WHERE client_id = ?1 AND at < ?2 ORDER BY week DESC LIMIT 1', cid, b)
  ]);
  const rivals = snapWeek ? await all('SELECT own, name, rating, reviews FROM rival_snap WHERE client_id = ?1 AND week = ?2', cid, snapWeek.week) : [];
  return { calls, lost, callbacks, bookings, leads: +(leads && leads.n) || 0, jobs: { n: +(jobs && jobs.n) || 0, asked: +(jobs && jobs.asked) || 0 },
    followups, checkins, fill, handoffs, texts, reviews, won, gbp, rivals, cid };
}

// ---------- what it means ----------
// raw: gather()'s rows. ctx: { tz, prev (last month's analytics, or null), money (money.js figure, or null), regulated }.
export function analyze(raw, ctx) {
  ctx = ctx || {};
  const tz = ctx.tz || 'America/New_York', prev = ctx.prev || null;
  const booked = new Set((raw.bookings || []).map(r => String(r.call_id)).filter(Boolean));
  const byBand = [0, 0, 0, 0, 0, 0], byDay = [0, 0, 0, 0, 0, 0, 0];
  let after = 0, weekend = 0, spanish = 0, urgent = 0, transferred = 0, leads = 0, nBooked = 0;
  const secs = [];
  for (const c of raw.calls || []) {
    const l = local(tz, Date.parse(c.at));
    byBand[bandOf(l.hour)]++;
    const di = WD.indexOf(l.wd); if (di > -1) byDay[di]++;
    if (isAfterHours(l)) after++;
    if (l.wd === 'Sat' || l.wd === 'Sun') weekend++;
    if (/^es/i.test(c.lang || '')) spanish++;
    if (/urgent|emergency|high/i.test(c.urgency || '')) urgent++;
    if (+c.transferred === 1) transferred++;   // 2 is a dial that was still ringing
    if (+c.seconds > 0) secs.push(+c.seconds);
    const isBooked = booked.has(String(c.id));
    if (isBooked) nBooked++;
    if (isBooked || ((c.outcome === 'done' || c.outcome === 'transferred') && (String(c.caller_name || '').trim() || String(c.callback || '').trim() || String(c.reason || '').trim()))) leads++;
  }
  const n = (raw.calls || []).length;
  const peakBand = n ? byBand.indexOf(Math.max(...byBand)) : -1, peakDay = n ? byDay.indexOf(Math.max(...byDay)) : -1;
  const texted = {}; for (const t of raw.texts || []) texted[t.kind || 'other'] = +t.n || 0;
  const cb = { set: (raw.callbacks || []).length, kept: (raw.callbacks || []).filter(r => r.status === 'done').length, missed: (raw.callbacks || []).filter(r => r.status === 'missed').length };
  const calls = { n, after, weekend, spanish, urgent, transferred, leads, booked: nBooked, avgSec: secs.length ? Math.round(secs.reduce((x, y) => x + y, 0) / secs.length) : 0,
    textback: texted.textback || 0, callbacks: cb, byBand, byDay, peak: n ? { band: BANDS[peakBand], bandN: byBand[peakBand], day: DAY_NAME[WD[peakDay]], dayN: byDay[peakDay] } : null };

  const lostCount = {}; for (const r of raw.lost || []) lostCount[r.reason] = (lostCount[r.reason] || 0) + 1;
  const lostTop = Object.keys(lostCount).map(r => ({ r, label: LOST_LABELS[r] || 'said something else', n: lostCount[r] })).sort((x, y) => y.n - x.n);
  const lost = { n: (raw.lost || []).length, top: lostTop.slice(0, 3) };

  const fill = { offers: (raw.fill || []).length, booked: (raw.fill || []).filter(r => r.status === 'booked').length };
  const chk = { yes: (raw.checkins || []).filter(r => r.status === 'yes').length, no: (raw.checkins || []).filter(r => r.status === 'no').length };
  const hand = { out: (raw.handoffs || []).filter(r => r.from_id === raw.cid).length, in: (raw.handoffs || []).filter(r => r.to_id === raw.cid).length };
  const wonAmount = (raw.won || []).reduce((s, j) => s + (+j.amount || 0), 0);
  const fuAmount = (raw.followups || []).filter(f => f.kind === 'quote').reduce((s, f) => s + money(f.amount), 0);
  const work = { requests: +raw.leads || 0, bookedCalls: nBooked, fill, jobsLogged: raw.jobs ? raw.jobs.n : 0, asks: raw.jobs ? raw.jobs.asked : 0, checkins: chk, handoffs: hand,
    won: { n: (raw.won || []).length, amount: wonAmount }, followups: { done: (raw.followups || []).length, quoteAmount: fuAmount } };

  const revs = raw.reviews || [];
  const rated = revs.filter(r => +r.stars > 0), replied = revs.filter(r => r.status === 'approved' || r.status === 'closed');
  const hrs = replied.map(r => (Date.parse(r.decided_at) - Date.parse(r.created)) / 36e5).filter(h => isFinite(h) && h >= 0);
  const reviews = { n: revs.length, avg: rated.length ? Math.round(rated.reduce((s, r) => s + +r.stars, 0) / rated.length * 10) / 10 : null,
    replied: replied.length, replyRate: revs.length ? Math.round(replied.length / revs.length * 100) : null, replyHrs: hrs.length ? Math.round(median(hrs) * 10) / 10 : null };

  const google = raw.gbp ? { calls: raw.gbp.calls == null ? null : +raw.gbp.calls, clicks: raw.gbp.clicks == null ? null : +raw.gbp.clicks, directions: raw.gbp.directions == null ? null : +raw.gbp.directions } : null;

  let rivals = null;
  const rs = (raw.rivals || []).filter(r => r.rating != null);
  const own = rs.find(r => +r.own);
  if (own && rs.length > 1) {
    const sorted = rs.slice().sort((x, y) => (+y.rating - +x.rating) || ((+y.reviews || 0) - (+x.reviews || 0)));
    const leader = rs.slice().sort((x, y) => (+y.reviews || 0) - (+x.reviews || 0))[0];
    rivals = { rank: sorted.indexOf(own) + 1, of: rs.length, rating: +own.rating, reviews: +own.reviews || 0, mostReviews: +leader.reviews || 0, leaderIsYou: !!+leader.own };
  }

  const out = { v: 1, calls, lost, work, reviews, google, rivals, worth: ctx.money && ctx.money.mid ? { mid: ctx.money.mid, low: ctx.money.low, high: ctx.money.high, after: ctx.money.afterHoursCalls, leads: ctx.money.leads } : null };
  out.vs = prev ? compare(out, prev) : null;
  out.insights = insights(out, ctx);
  out.next = nextStep(out, ctx);
  return out;
}

// Month against month, on the figures an owner would quote.
export function compare(a, p) {
  const d = (x, y) => (x == null || y == null) ? null : x - y;
  return { label: p.label || '', calls: d(a.calls.n, p.calls && p.calls.n), after: d(a.calls.after, p.calls && p.calls.after), reviews: d(a.reviews.n, p.reviews && p.reviews.n),
    leads: d(a.calls.leads + a.work.requests, p.calls && p.work ? p.calls.leads + p.work.requests : null),
    googleCalls: d(a.google && a.google.calls, p.google && p.google.calls) };
}

// Up to four findings, most useful first, each one sentence an owner could repeat at dinner.
export function insights(a, ctx) {
  ctx = ctx || {};
  const out = [], c = a.calls;
  if (c.n && c.after) out.push({ k: 'after', t: c.after + ' of ' + pl(c.n, 'call', 'calls') + ' came after hours or on a weekend, when most businesses send callers to voicemail. Every call was answered' + (c.leads ? ', and ' + c.leads + ' of ' + c.n + ' callers left their details.' : '.') });
  if (c.n >= 5 && c.peak) out.push({ k: 'peak', t: 'Your phone rang most on ' + c.peak.day + 's, and most often ' + c.peak.band + ' (' + c.peak.bandN + ' of ' + c.n + ' calls).' });
  if (a.lost.n >= 2 && a.lost.top[0]) {
    const t = a.lost.top[0];
    const tip = { price: ' Free estimates or financing on your Google profile can win some of those back.', timing: ' An early or late slot each week could catch them.', distance: ' Your service area on Google may reach farther than you go.', notus: ' Hand-offs send those callers to a member nearby, and they send work back.' }[t.r] || '';
    out.push({ k: 'lost', t: t.n + ' of ' + pl(a.lost.n, 'caller', 'callers') + ' who didn’t book ' + t.label + '.' + tip });
  }
  const r = a.reviews;
  if (r.n) out.push({ k: 'reviews', t: (r.replied === r.n ? (r.n === 1 ? 'Your new review got a reply' : 'All ' + r.n + ' new reviews got a reply') : r.replied + ' of ' + pl(r.n, 'new review', 'new reviews') + ' have a reply') + (r.replyHrs != null ? ', ' + (r.replyHrs < 1 ? 'in under an hour' : 'in about ' + Math.round(r.replyHrs) + (Math.round(r.replyHrs) === 1 ? ' hour' : ' hours')) + ' on average.' : '.') + (r.avg ? ' They averaged ' + r.avg.toFixed(1) + ' stars.' : '') });
  if (a.rivals) out.push({ k: 'rivals', t: a.rivals.leaderIsYou ? 'You have the most reviews of the ' + a.rivals.of + ' businesses we watch near you, and rank ' + ord(a.rivals.rank) + ' on rating.' : 'You rank ' + ord(a.rivals.rank) + ' of ' + a.rivals.of + ' nearby on rating, ' + pl(Math.max(0, a.rivals.mostReviews - a.rivals.reviews), 'review', 'reviews') + ' behind the one with the most.' });
  const w = a.work;
  if (w.won.amount) out.push({ k: 'won', t: 'Jobs worth ' + dollars(w.won.amount) + ' were booked, finished or paid this month' + (w.fill.booked ? ', ' + w.fill.booked + ' of them from Fill my week.' : '.') });
  else if (w.fill.booked) out.push({ k: 'fill', t: 'Fill my week booked ' + pl(w.fill.booked, 'open slot', 'open slots') + ' from your own past customers.' });
  if (w.checkins.no) out.push({ k: 'check', t: pl(w.checkins.no, 'customer', 'customers') + ' told you about a problem on the three-day check-in, before it could become a review.' });
  if (a.vs && a.vs.calls != null && Math.abs(a.vs.calls) >= 3) out.push({ k: 'vs', t: 'Calls were ' + (a.vs.calls > 0 ? 'up ' : 'down ') + Math.abs(a.vs.calls) + ' from ' + (a.vs.label ? a.vs.label.split(' ')[0] : 'last month') + '.' });
  return out.slice(0, 4);
}

// One thing for next month: the cheapest change with the biggest likely payoff.
export function nextStep(a, ctx) {
  ctx = ctx || {};
  const t = a.lost.top[0];
  if (!ctx.regulated && a.lost.n >= 3 && t && t.r === 'price') return 'Most callers who didn’t book said price. Ask us to add “free estimates” to your Google profile and to Max’s answers.';
  if (!ctx.regulated && a.calls.after >= 3 && !(ctx.money && ctx.money.avgJob)) return 'Put your average job in Settings, and next month this page shows what after-hours calls were worth in dollars.';
  if (!ctx.regulated && a.reviews.n < 3 && a.work.jobsLogged < 5) return 'Tap “Finished a job” after each one. Every customer who agrees gets one review request, and steady reviews move you up on Google.';
  if (a.reviews.replyHrs != null && a.reviews.replyHrs > 24) return 'Approve replies within a day. Fast replies are the ones future customers notice.';
  if (!ctx.regulated && a.calls.n >= 10 && !a.work.fill.offers) return 'Turn on Fill my week. When a day is wide open, past customers who are due get first pick.';
  return 'Keep doing what you did this month. We’ll keep the phone, the reviews and the follow-ups moving.';
}

// The month-to-date or a whole month for one client, ready for the app and the report page.
export async function monthAnalytics(env, cid, startIso, endIso, ctx) {
  const raw = await gather(env, cid, startIso, endIso);
  return analyze(raw, ctx);
}
