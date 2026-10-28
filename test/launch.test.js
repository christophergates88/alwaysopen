import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGoogle, readMeta } from '../src/launch.js';
import { pickLocation, reviewScore, bestReview, sumMetrics, normName } from '../src/gbp.js';

test('Google: a quota refusal means still waiting, a 200 means approved', () => {
  assert.equal(readGoogle(429, { error: { status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute'" } }).state, 'waiting');
  assert.equal(readGoogle(200, { accounts: [] }).state, 'live');
  assert.equal(readGoogle(401, {}).state, 'needs_connect');
  const off = readGoogle(403, { error: { status: 'PERMISSION_DENIED', message: 'My Business Account Management API has not been used in project 123456789 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } });
  assert.equal(off.state, 'api_off');
  assert.match(off.detail, /project=123456789/);
});

test('Meta: on only once posting to Pages is approved', () => {
  assert.equal(readMeta([{ permission: 'public_profile', status: 'live' }, { permission: 'email', status: 'live' }]).state, 'waiting');
  const r = readMeta([{ permission: 'public_profile', status: 'live' }, { permission: 'pages_manage_posts', status: 'live' }, { permission: 'instagram_content_publish', status: 'live' }]);
  assert.equal(r.state, 'live');
  assert.equal(r.instagram, true);
});

test('each client finds its own Google location, and two equal answers mean none', () => {
  const locs = [
    { account: 'accounts/1', location: 'locations/11', title: 'Sinclair Plumbing, LLC', phones: ['4785550101'], placeId: 'ChIJaaa' },
    { account: 'accounts/1', location: 'locations/12', title: 'Lane Electric', phones: ['4785550102'], placeId: '' },
    { account: 'accounts/1', location: 'locations/13', title: 'Lane Electric', phones: [], placeId: '' }
  ];
  assert.equal(pickLocation({ business: 'x', placeId: 'ChIJaaa' }, locs).loc.location, 'locations/11');
  assert.equal(pickLocation({ business: 'x', phones: ['(478) 555-0102'] }, locs).loc.location, 'locations/12');
  assert.equal(pickLocation({ business: 'Sinclair Plumbing' }, locs).loc.location, 'locations/11');
  assert.equal(pickLocation({ business: 'Lane Electric' }, locs), null);
  assert.equal(normName('The Smith & Sons Co.'), 'smith sons');
});

test('an approved draft is matched to the right Google review', () => {
  const reviews = [
    { name: 'r/1', reviewer: { displayName: 'Dana Robinson' }, starRating: 'FIVE', comment: 'Fixed our leak the same day. Great work.' },
    { name: 'r/2', reviewer: { displayName: 'Dan Ross' }, starRating: 'FOUR', comment: 'Good, a little late.' },
    { name: 'r/3', reviewer: { displayName: 'Mo Lee' }, starRating: 'ONE' }
  ];
  assert.equal(bestReview(reviews, { title: 'Dana R.', stars: 5, context: 'Fixed our leak the same day. Great work.' }).name, 'r/1');
  assert.equal(bestReview(reviews, { title: 'Mo L.', stars: 1, context: '' }).name, 'r/3');
  assert.equal(bestReview(reviews, { title: 'Dana R.', stars: 2, context: 'Fixed our leak' }), null);   // stars disagree
  assert.ok(reviewScore(reviews[0], { title: 'A customer', stars: 5, context: 'Fixed our leak the same day. Great work.' }) >= 4);
});

test('monthly Google numbers add up by kind', () => {
  const j = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: {}, value: '3' }, { date: {} }, { date: {}, value: '2' }] } },
    { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ date: {}, value: '10' }] } },
    { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: [{ date: {}, value: '4' }] } }
  ] }] };
  assert.deepEqual(sumMetrics(j), { calls: 5, clicks: 10, directions: 4 });
});
