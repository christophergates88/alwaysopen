import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthOf, isComplete, buildMonth, wasClient, hasNews } from '../src/report.js';

test('on November 2 the report is for October', () => {
  const m = monthOf(Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(m.key, '2026-10'); assert.equal(m.label, 'October 2026'); assert.equal(m.prevKey, '2026-09');
});
test('a record HQ made mid-month is replaced; one made after the month is kept', () => {
  const m = monthOf(Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(isComplete({ record: { made: 'Oct 27, 2026' } }, m), false);
  assert.equal(isComplete({ record: { made: 'Nov 1, 2026' } }, m), true);
  assert.equal(isComplete(null, m), false);
});
test('the month reads plainly and shows who approved each reply', () => {
  const m = monthOf(Date.parse('2026-11-02T14:00:00Z'));
  const d = buildMonth({ business: 'Sinclair Plumbing' }, m, {
    reviews: [{ id: 'r:1', title: 'Dana R.', stars: 5, context: 'Fast and fair.', status: 'approved', decided_text: 'Thank you, Dana.', decided_at: '2026-10-12T15:00:00Z', decided_by: 'Sam', created: '2026-10-11T12:00:00Z' },
              { id: 'r:2', title: 'Mo L.', stars: 2, context: 'Late.', status: 'pending', text: 'Sorry, Mo.', created: '2026-10-20T12:00:00Z' }],
    posts: [{ id: 'p:1', title: 'Winter pipes', text: 'Wrap them.', decided_at: '2026-10-14T12:00:00Z', decided_by: 'Sam' }],
    posted: ['r:1'], calls: 12 }, { reviews: 1, replies: 1 }, Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(d.stats.reviews, 2); assert.equal(d.stats.replies, 1); assert.equal(d.stats.posts, 1);
  assert.match(d.note, /Max answered 12 calls\. 2 new reviews, 1 with a reply so far\. 1 post went up\./);
  assert.match(d.record.revs[0].t, /^Reply posted Oct 12, 2026: Thank you, Dana\./);
  assert.equal(d.record.revs[0].by, 'Approved by Sam in the app');
  assert.match(d.record.revs[1].t, /waiting/);
  assert.ok(!/!/.test(JSON.stringify(d)));
});
test('no report for a month before the client joined, and no push for an empty month', () => {
  const m = monthOf(Date.parse('2026-10-28T17:30:00Z'));   // September
  assert.equal(wasClient('2026-10-24T13:00:00Z', m), false);
  assert.equal(wasClient('', m), false);
  assert.equal(wasClient('2026-09-30T23:00:00Z', m), true);
  const quiet = buildMonth({ business: 'X' }, m, { reviews: [], posts: [], posted: [], calls: 0 }, null, Date.now());
  assert.equal(hasNews(quiet), false);
  const calls = buildMonth({ business: 'X' }, m, { reviews: [], posts: [], posted: [], calls: 3 }, null, Date.now());
  assert.equal(hasNews(calls), true);
});
