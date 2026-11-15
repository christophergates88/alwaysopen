// FINDING (closed): the operator board token used to be a static, never-expiring bearer that unlocked the whole operator
// console and cross-tenant customer data with no x-key, and it travelled in the Monday ops email and phone pushes.
// Closed Nov 10, 2026 (dated links that work 30 days, a signed device cookie) and Nov 15, 2026 (the old static link
// retired outright). This test now holds the fix in place.
//
//   node --test stress/intruder/board_token.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lab } from './_lab.mjs';

test('the board link is dated, expires, and the old static link opens nothing', async () => {
  const L = await lab();
  const { boardToken, boardOk } = await import('../../src/opsboard.js');
  const tok = await boardToken(L.env);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  assert.match(tok, /^\d{8}[0-9a-f]{32}$/);
  assert.equal(tok.slice(0, 8), today, 'the link carries its date');

  // today's link opens the board (that is what the Monday email and the pushes carry)
  assert.equal((await L.site.call('/ops?t=' + tok)).status, 200);

  // a link from 31 days ago, correctly signed, is refused; so is tomorrow-and-beyond tampering and a made-up one
  const old = await boardToken(L.env, Date.now() - 31 * 864e5);
  assert.notEqual(old, tok);
  assert.equal(await boardOk(L.env, old), false, 'a 31-day-old link is dead');
  assert.equal((await L.site.call('/ops?t=' + old)).status, 404);
  assert.equal((await L.site.call('/ops/post?t=' + old)).status, 404);
  assert.equal((await L.site.call('/ops/numbers?t=' + old)).status, 404);
  assert.equal((await L.site.call('/ops/post?t=' + today + 'f'.repeat(32))).status, 404, 'right date, wrong signature');

  // the old static link (the same for the life of the key) no longer opens anything
  const legacy = createHmac('sha256', L.env.LEADS_KEY).update('ops-board-v1').digest('hex').slice(0, 40);
  assert.equal(await boardOk(L.env, legacy), false);
  assert.equal((await L.site.call('/ops?t=' + legacy)).status, 404);
  assert.equal((await L.site.call('/ops/post?t=' + legacy)).status, 404);
  assert.equal((await L.site.call('/ops/compliance-pack?t=' + legacy)).status, 404);

  // no key and no link: refused
  assert.equal((await L.site.call('/ops')).status, 404);
});
