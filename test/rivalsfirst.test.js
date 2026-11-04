// Competitor Watch: "To be #1" is worked out from the numbers just looked up, at the owner's own pace when there is one,
// and the card and the Monday line both say it. Nothing from Google is kept to do it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const R = await import('../src/rivals.js');
const { RIVALS_JS } = await import('../src/rivalspage.js');

const rows = [{ own: true, name: 'You', rating: 4.6, reviews: 58 }, { name: 'Lane Plumbing', rating: 4.8, reviews: 71 }, { name: 'Oconee Plumbing', rating: 4.5, reviews: 44 }];

test('how many 5-star reviews it takes to be #1 on rating', () => {
  const f = R.toFirst(rows);
  assert.equal(f.leader, 'Lane Plumbing');
  // 35 more: Google then shows 4.8 for both, and 93 reviews beats 71 (the card ranks by rating, then reviews)
  assert.equal(f.k, 35);
  // the website's sample card: 4.7 with 30 against 4.8 with 36 is seven more, about six weeks at 1.2 a week
  const site = R.toFirst([{ own: true, rating: 4.7, reviews: 30 }, { name: 'Lane Plumbing', rating: 4.8, reviews: 36 }]);
  assert.equal(site.k, 7);
  assert.equal(R.weeksAtPace(site.k, 1.2), 6);
  assert.equal(R.toFirst([{ own: true, rating: 4.9, reviews: 10 }, { rating: 4.8, reviews: 99 }]), null, 'already #1');
  assert.equal(R.toFirst([{ own: true, rating: 4.8, reviews: 60 }, { rating: 4.8, reviews: 71 }]).k, 12, 'a tie on rating: pass them on reviews');
  assert.equal(R.weeksAtPace(14, 2), 7);
  assert.equal(R.weeksAtPace(500, 0.5), null, 'years away: no promise');
});

test('the owner’s pace comes from their own review notices, Yelp left out', async () => {
  const env = { DB: makeDB() }, now = Date.parse('2026-11-04T15:00:00Z');
  for (let i = 0; i < 12; i++) await env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified) VALUES (?1, 'c1', 'reply', 'A', ?2, 5, 't', 'pending', 1, 0, ?3, ?3, 0)").bind('m:' + i, i < 10 ? 'Great work' : 'Yelp review', new Date(now - i * 4 * 864e5).toISOString()).run();
  assert.equal(await R.reviewPace(env, 'c1', now), 10 / 8);
  assert.equal(await R.reviewPace(env, 'nobody', now), null);
});

test('the card shows "To be #1" and the locked card no longer promises to spot a slip', () => {
  assert.match(RIVALS_JS, /To be #1/);
  assert.match(RIVALS_JS, /At your pace, about /);
  assert.doesNotMatch(RIVALS_JS, /when one of them slips/);
});
