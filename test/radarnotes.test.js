// Rate-Shock Radar reaches the insurance clients themselves: a client whose own town had a wave this week gets a push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { radarNotes } = await import('../src/index.js');

test('only clients in a wave town get the radar push, with counts and no names', () => {
  const towns = [
    { town: 'Eatonton, GA', wave: true, rate: 3, low: 1 },
    { town: 'Madison, GA', wave: false, rate: 0, low: 0 },
    { town: 'Macon, GA', wave: true, rate: 0, low: 4 },
  ];
  const clients = [{ cid: 'a', town: 'eatonton, ga ' }, { cid: 'b', town: 'Madison, GA' }, { cid: 'c', town: 'Macon, GA' }, { cid: 'd', town: '' }];
  const n = radarNotes(clients, towns);
  assert.deepEqual(n.map(x => x.cid), ['a', 'c']);
  assert.match(n[0].note.aps.alert.body, /^3 recent reviews of agencies in Eatonton, GA mention rate increases/);
  assert.match(n[1].note.aps.alert.body, /^4 low-star reviews/);
  assert.equal(n[0].note.aps.alert.title, 'Rate-Shock Radar: Eatonton, GA');
  assert.deepEqual(radarNotes(clients, []), []);
});
