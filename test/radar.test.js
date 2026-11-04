// Rate-Shock Radar, nationwide: towns read the way agents type them, a 5-star "great rates" is never a complaint, big
// towns need more than two bad days to count as a wave, every client's town is checked first within the weekly budget,
// leftover lookups read more agencies, and the post waiting for the client is plain and educational.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const R = await import('../src/radar.js');
const { radarScan, radarNotes, RADAR_POST } = await import('../src/index.js');

test('towns as people type them, anywhere in the U.S.', () => {
  const cases = {
    'Eatonton, GA': 'Eatonton, GA', 'eatonton ga': 'Eatonton, GA', 'Eatonton Georgia': 'Eatonton, GA', 'Eatonton, Ga.': 'Eatonton, GA', 'EATONTON, GEORGIA 31024': 'Eatonton, GA',
    'Kansas City, Missouri': 'Kansas City, MO', 'Washington, DC': 'Washington, DC', 'Fort Myers, Fla.': 'Fort Myers, FL', 'Virginia Beach, VA': 'Virginia Beach, VA',
    'Virginia Beach': 'Virginia Beach', 'New York, New York': 'New York, NY', 'Santa Fe, New Mexico, USA': 'Santa Fe, NM', 'Indiana, PA': 'Indiana, PA', 'Charlotte NC 28202': 'Charlotte, NC',
    '': '', '   ': '', '31024': '', 'Georgia': 'Georgia'
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(R.normTown(raw), want, JSON.stringify(raw));
  assert.equal(R.townKey('eatonton georgia'), R.townKey('Eatonton, GA'));
});

const now = Date.parse('2026-11-02T12:17:00Z');
const day = d => new Date(now - d * 864e5).toISOString();
const rv = (stars, text, d) => ({ rating: stars, publishTime: day(d == null ? 3 : d), originalText: { text } });

test('a 5-star "great rates" is a compliment; unhappy reviews about rates are what counts', () => {
  assert.equal(R.aboutRates('Great rates and Jane is wonderful', 5), false);
  assert.equal(R.aboutRates('Great rates and Jane is wonderful', 4), false);
  assert.equal(R.aboutRates('My premium doubled and nobody called', 1), true);
  assert.equal(R.aboutRates('Me subió la prima sin avisar', 2), true);
  assert.equal(R.aboutRates('Rates went up', 0), true, 'no star rating shown: still counts');
  const happy = [{ rating: 4.9, userRatingCount: 80, reviews: [rv(5, 'Best rates in town'), rv(5, 'Saved me money on my premium'), rv(5, 'Great price')] }];
  assert.equal(R.scoreTown(happy, now).rate, 0);
  assert.equal(R.scoreTown(happy, now).wave, false);
  const sore = [{ rating: 3.1, userRatingCount: 40, reviews: [rv(1, 'Rates went up 40% at renewal'), rv(2, 'Premium increased again'), rv(5, 'Nice office'), rv(1, 'Old one', 45)] }];
  const s = R.scoreTown(sore, now);
  assert.deepEqual([s.rate, s.low, s.recent, s.wave, s.why], [2, 2, 3, true, 'rate']);
});

test('in a big city two bad days are not a wave', () => {
  const agencies = Array.from({ length: 60 }, (_, i) => ({ rating: 4.6, userRatingCount: 50, reviews: [rv(5, 'Helpful'), rv(5, 'Great'), rv(4, 'Good')] }));
  agencies[0].reviews.push(rv(1, 'My rates went up'));
  agencies[1].reviews.push(rv(2, 'Premium increased'));
  const s = R.scoreTown(agencies, now);
  assert.equal(s.rate, 2);
  assert.equal(s.wave, false, '60 agencies: needs 3 unhappy reviews about rates, and 2 low out of 182 is not a share');
  agencies[2].reviews.push(rv(1, 'Price doubled'));
  assert.equal(R.scoreTown(agencies, now).wave, true);
});

test('the weekly plan: clients first, the prospect list after, and it rotates when there are too many towns', () => {
  const p = R.planTowns(['eatonton georgia', 'Macon, GA', 'Eatonton, GA', ''], ['Eatonton, GA', 'Madison, GA', 'Gray, GA'], 4, 45);
  assert.deepEqual(p.towns.map(t => [t.town, t.client]), [['Eatonton, GA', true], ['Macon, GA', true], ['Madison, GA', false], ['Gray, GA', false]]);
  assert.equal(p.extra, 0); assert.equal(p.skipped, 0);
  const many = Array.from({ length: 10 }, (_, i) => 'Town' + 'ABCDEFGHIJ'[i] + ', TX');
  const w1 = R.planTowns(many, [], 4, 1).towns.map(t => t.town), w2 = R.planTowns(many, [], 4, 2).towns.map(t => t.town), w3 = R.planTowns(many, [], 4, 3).towns.map(t => t.town);
  assert.equal(w1.length, 4);
  assert.equal(new Set(w1.concat(w2, w3)).size, 10, 'every client town is covered within three weeks');
  assert.equal(R.planTowns(many, ['Macon, GA'], 4, 1).skipped, 7);
});

test('the scan: one lookup per town first, leftovers read more agencies in clients’ towns, errors stay per town', async () => {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, regulated, tier) VALUES ('c1', 'h', 'Haskell Insurance', 1, 1, 'Growth')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES ('+14785550101', 'c1', 'Haskell Insurance', 1, 'insurance', 'Tulsa Oklahoma', '2026-10-01T00:00:00Z')").run();
  const calls = [];
  const page = async (town, token) => {
    calls.push(town + (token ? ' +' + token : ''));
    if (town === 'Gray, GA') throw new Error('Places 500');
    const n = token ? 2 : 1;
    return { places: [{ rating: 4, userRatingCount: 10, reviews: [rv(1, 'rates went up')] }], next: town === 'Tulsa, OK' && n < 3 ? 'p' + (n + 1) : '' };
  };
  const env = { DB: db, RADAR_TOWNS: 'Eatonton, GA|Gray, GA', RADAR_MAX_CALLS: '5' };
  const r = await radarScan(env, now, { page });
  assert.deepEqual(calls, ['Tulsa, OK', 'Eatonton, GA', 'Gray, GA', 'Tulsa, OK +p2', 'Tulsa, OK +p3']);
  assert.equal(r.calls, 5);
  const tulsa = r.out.find(x => x.town === 'Tulsa, OK');
  assert.equal(tulsa.client, true); assert.equal(tulsa.pages, 3); assert.equal(tulsa.places, 3); assert.equal(tulsa.rate, 3);
  assert.match(r.out.find(x => x.town === 'Gray, GA').error, /Places 500/);
});

test('a client whose account says "Tulsa Oklahoma" still hears about a wave in Tulsa, OK', () => {
  const n = radarNotes([{ cid: 'c1', town: 'Tulsa Oklahoma' }, { cid: 'c2', town: 'Tulsa, OK' }, { cid: 'c3', town: 'Tulsa' }], [{ town: 'Tulsa, OK', wave: true, why: 'low', rate: 1, low: 5 }]);
  assert.deepEqual(n.map(x => x.cid), ['c1', 'c2']);
  assert.match(n[0].note.aps.alert.body, /^Do this: check in with your renewals this week\. 5 low-star reviews/);
  assert.equal(n[0].town, 'Tulsa, OK');
});

test('the waiting post teaches: no numbers, no quotes, no promises, no other agencies', () => {
  assert.doesNotMatch(RADAR_POST.text, /\d|%|\$|save|lower|cheap|best|guarantee|quote/i);
  assert.match(RADAR_POST.text, /call our office/);
});
