// The app's Results dashboard: the last 30 days against the 30 before, from the same tables the monthly report reads
// (insights.js gather/analyze). Counts, times and money only; never a customer's name. Pure shaping is in shape() for tests.
import { gather, analyze } from './insights.js';
import { local, tzFor } from './callbacks.js';
import { isAfterHours } from './answerrate.js';

const DAY = 864e5;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Per-day calls (with after-hours and booked), a 7 x 6 day-by-time grid, and the headline figures with their change.
export function shape(cur, prevA, rawCalls, bookedIds, tz, now) {
  const days = [];
  const index = {};
  for (let i = 29; i >= 0; i--) {
    const l = local(tz, now - i * DAY);
    const key = l.day;
    index[key] = days.length;
    days.push({ d: key, wd: l.wd, calls: 0, after: 0, booked: 0 });
  }
  const heat = WD.map(() => [0, 0, 0, 0, 0, 0]);
  const bandOf = h => h >= 6 && h < 9 ? 0 : h >= 9 && h < 12 ? 1 : h >= 12 && h < 15 ? 2 : h >= 15 && h < 18 ? 3 : h >= 18 && h < 21 ? 4 : 5;
  for (const c of rawCalls || []) {
    const l = local(tz, Date.parse(c.at));
    const i = index[l.day];
    if (i != null) {
      days[i].calls++;
      if (isAfterHours(l)) days[i].after++;
      if (bookedIds.has(String(c.id))) days[i].booked++;
    }
    const w = WD.indexOf(l.wd);
    if (w > -1) heat[w][bandOf(l.hour)]++;
  }
  const c = cur.calls, w = cur.work, r = cur.reviews;
  const leads = c.leads + w.requests;
  const p = prevA ? prevA.calls : null;
  const prevLeads = prevA ? prevA.calls.leads + prevA.work.requests : null;
  const ch = (a, b) => (b == null ? null : a - b);
  return {
    days, heat,
    kpi: {
      calls: { n: c.n, ch: ch(c.n, p && p.n) },
      after: { n: c.after, pct: c.n ? Math.round(c.after / c.n * 100) : 0, ch: ch(c.after, p && p.after) },
      leads: { n: leads, ch: ch(leads, prevLeads) },
      booked: { n: c.booked + w.fill.booked, ch: ch(c.booked + w.fill.booked, prevA ? prevA.calls.booked + prevA.work.fill.booked : null) },
      won: { amount: w.won.amount, n: w.won.n }
    },
    funnel: [['Calls and requests', c.n + w.requests], ['Real leads', leads], ['Booked', c.booked + w.fill.booked], ['Jobs won', w.won.n]],
    speed: {
      callbacks: c.callbacks.set ? { set: c.callbacks.set, kept: c.callbacks.kept, pct: Math.round(c.callbacks.kept / c.callbacks.set * 100) } : null,
      avgSec: c.avgSec || 0,
      replyHrs: r.replyHrs, replyRate: r.replyRate, reviews: r.n, rating: r.avg
    },
    extra: { spanish: c.spanish, urgent: c.urgent, transferred: c.transferred, textback: c.textback, weekend: c.weekend, checkinsNo: w.checkins.no, handIn: w.handoffs.in, handOut: w.handoffs.out },
    lost: cur.lost,
    peak: c.peak,
    insights: (cur.insights || []).map(x => x.t),
    next: cur.next || ''
  };
}

export async function pulseState(env, c, now) {
  now = now || Date.now();
  const cid = c.client_id;
  const tz = await tzFor(env, cid).catch(() => 'America/New_York');
  const end = new Date(now + 60e3).toISOString(), start = new Date(now - 30 * DAY).toISOString(), pstart = new Date(now - 60 * DAY).toISOString();
  const [raw, praw] = await Promise.all([gather(env, cid, start, end), gather(env, cid, pstart, start)]);
  const ctx = { tz, regulated: !!+c.regulated };
  const cur = analyze(raw, ctx);
  const prevA = (praw.calls || []).length || praw.leads ? analyze(praw, ctx) : null;
  const booked = new Set((raw.bookings || []).map(b => String(b.call_id)).filter(Boolean));
  return shape(cur, prevA, raw.calls, booked, tz, now);
}
