// Nov 24, 2026 swarm, wiring between the fixes: a client whose state cannot be read from the town gets a line on a
// guessed clock, and the operator is told once; a town with a state raises nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const C = await import('../src/callbacks.js');
const PA = await import('../src/plainalerts.js');

test('zoneGuess says when the zone is only a guess', () => {
  assert.deepEqual(C.zoneGuess({ town: 'Phoenix AZ 85001', phone: '(706) 555-0100' }), { tz: 'America/Phoenix', guessed: false });
  assert.equal(C.zoneGuess({ town: 'Eatonton', phone: '(706) 555-0100' }).guessed, true);
  assert.equal(C.zoneGuess({ town: '', phone: '' }).tz, 'America/New_York');
});

test('the new alerts have plain titles', () => {
  for (const k of ['zone-unknown|c1', 'audit-failed|7']) {
    const x = PA.explainAlert(k, 'detail');
    const title = Array.isArray(x) ? x[0] : (x && (x.title || x.what || x[0]));
    assert.ok(title && !/Something in Always Open needs a look/.test(String(title)), k + ' has its own title: ' + JSON.stringify(x).slice(0, 160));
  }
});
