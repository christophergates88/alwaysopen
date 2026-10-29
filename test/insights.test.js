// The monthly report's analytics: when the phone rang, why callers didn't book, reviews, check-ins, follow-ups and the
// businesses nearby, turned into plain findings and one thing for next month. And the one-page report that shows them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const I = await import('../src/insights.js');
const P = await import('../src/monthpage.js');

const call = (iso, extra) => Object.assign({ id: iso, at: iso, seconds: 120, outcome: 'done', transferred: 0, lang: 'en-US', urgency: '', caller_name: 'A', callback: '', reason: 'leak' }, extra || {});
function raw() {
  return {
    cid: 'c1',
    calls: [
      call('2026-10-06T23:30:00Z'),                       // Tue 7:30 PM Eastern: after hours, 6 to 9 PM
      call('2026-10-13T23:10:00Z', { lang: 'es-US' }),    // Tue 7:10 PM, in Spanish
      call('2026-10-20T22:40:00Z', { transferred: 1, urgency: 'urgent' }),   // Tue 6:40 PM, rung through
      call('2026-10-08T14:00:00Z'),                       // Thu 10 AM
      call('2026-10-10T15:00:00Z', { caller_name: '', reason: '', outcome: 'hangup' })   // Sat 11 AM: weekend, no details
    ],
    lost: [{ reason: 'price' }, { reason: 'price' }, { reason: 'timing' }],
    callbacks: [{ status: 'done' }, { status: 'missed' }],
    bookings: [{ call_id: '2026-10-08T14:00:00Z' }],
    leads: 2, jobs: { n: 6, asked: 5 },
    followups: [{ kind: 'quote', status: 'done', amount: '$1,840' }, { kind: 'invoice', status: 'done', amount: '300' }],
    checkins: [{ status: 'yes' }, { status: 'yes' }, { status: 'no' }],
    fill: [{ status: 'booked' }, { status: 'sent' }],
    handoffs: [{ from_id: 'c1', to_id: 'c2' }, { from_id: 'c3', to_id: 'c1' }],
    texts: [{ kind: 'textback', n: 1 }],
    reviews: [{ stars: 5, status: 'approved', created: '2026-10-02T12:00:00Z', decided_at: '2026-10-02T14:00:00Z' }, { stars: 4, status: 'approved', created: '2026-10-09T12:00:00Z', decided_at: '2026-10-09T16:00:00Z' }],
    won: [{ stage: 'paid', amount: 1840 }, { stage: 'booked', amount: 650 }],
    gbp: { calls: 12, clicks: 30, directions: 9 },
    rivals: [{ own: 1, name: 'Us', rating: 4.6, reviews: 40 }, { own: 0, name: 'B', rating: 4.8, reviews: 70 }, { own: 0, name: 'C', rating: 4.2, reviews: 20 }]
  };
}

test('a month, analyzed: when, why, reviews, check-ins, follow-ups, rivals, and what it means', () => {
  const a = I.analyze(raw(), { tz: 'America/New_York', prev: { label: 'September 2026', calls: { n: 1, leads: 0 }, work: { requests: 0 }, reviews: { n: 1 }, google: { calls: 10 } }, money: { mid: 1200, low: 800, high: 1600, afterHoursCalls: 4, leads: 3 } });
  assert.equal(a.calls.n, 5); assert.equal(a.calls.after, 4, '3 evenings and a Saturday'); assert.equal(a.calls.weekend, 1);
  assert.equal(a.calls.spanish, 1); assert.equal(a.calls.transferred, 1); assert.equal(a.calls.booked, 1); assert.equal(a.calls.leads, 4, 'the hang-up with no details is not a lead');
  assert.deepEqual(a.calls.byBand, [0, 2, 0, 0, 3, 0], 'Thursday 10 AM and Saturday 11 AM, three evenings'); assert.equal(a.calls.peak.day, 'Tuesday'); assert.equal(a.calls.peak.band, '6 to 9 PM');
  assert.deepEqual(a.lost.top[0], { r: 'price', label: 'said price', n: 2 });
  assert.deepEqual(a.work.checkins, { yes: 2, no: 1 }); assert.deepEqual(a.work.fill, { offers: 2, booked: 1 }); assert.deepEqual(a.work.handoffs, { out: 1, in: 1 });
  assert.equal(a.work.won.amount, 2490); assert.equal(a.work.followups.quoteAmount, 1840);
  assert.equal(a.reviews.replyRate, 100); assert.equal(a.reviews.replyHrs, 3); assert.equal(a.reviews.avg, 4.5);
  assert.deepEqual(a.rivals, { rank: 2, of: 3, rating: 4.6, reviews: 40, mostReviews: 70, leaderIsYou: false });
  assert.equal(a.vs.calls, 4); assert.equal(a.vs.googleCalls, 2);
  assert.equal(a.worth.mid, 1200);
  const ks = a.insights.map(x => x.k);
  assert.deepEqual(ks.slice(0, 2), ['after', 'peak'].filter(k => k !== 'peak' || a.calls.n >= 5));
  assert.ok(ks.includes('lost'));
  assert.match(a.insights[0].t, /^4 of 5 calls came after hours or on a weekend/);
  assert.match(a.next, /said price/);
  for (const x of a.insights) assert.doesNotMatch(x.t, /\bAI\b/);
});

test('a regulated month never suggests price or money, and an empty month still reads well', () => {
  const r = raw(); r.lost = [{ reason: 'price' }, { reason: 'price' }, { reason: 'price' }];
  const a = I.analyze(r, { regulated: true });
  assert.doesNotMatch(a.next, /price|average job|Finished a job|Fill my week/);
  const empty = I.analyze({ cid: 'c1' }, {});
  assert.equal(empty.calls.n, 0); assert.equal(empty.calls.peak, null); assert.deepEqual(empty.insights, []);
  assert.ok(empty.next.length > 20);
  const html = P.renderMonthPage({ business: 'Quiet Co', label: 'October 2026', a: empty, stats: {} });
  assert.match(html, /<h1>Quiet Co<\/h1>/); assert.match(html, /One thing for next month/); assert.doesNotMatch(html, /When your phone rang/);
});

test('the one-page report: check-ins have their own band, print fits a Letter page, Katie answers', () => {
  const html = P.samplePage();
  assert.match(html, /<section class="check"><h2>Three-day check-ins<\/h2>/);
  assert.match(html, /When your phone rang/); assert.match(html, /Why callers didn’t book/); assert.match(html, /What it means/);
  assert.match(html, /@page\{size:letter/); assert.match(html, /print-color-adjust:exact/);
  assert.match(html, /Katie answers/);
  assert.match(html, /<b>Sample\.<\/b>/);
  assert.doesNotMatch(html, /\bAI\b/);
});
