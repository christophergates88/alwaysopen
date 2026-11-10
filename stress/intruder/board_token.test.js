// FINDING: the operator board token (opsboard.boardToken) is a static, never-expiring, un-revocable bearer that
// unlocks the whole operator console and cross-tenant customer data with NO x-key -- just ?t=<token>. It is derived
// deterministically from LEADS_KEY, so it is identical for the life of that key, and it is transmitted in the clear in
// the Monday ops email and in several phone pushes (opsboard.boardWeekly, postqueue.queuePush, social.js, gbp/meta
// connect items). Anyone who sees one such link (forwarded mail, lock-screen push, screenshot, browser history, mail
// logs) has lasting operator access until the master key is rotated.
//
//   node --test stress/intruder/board_token.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lab } from './_lab.mjs';

test('the board token is static, un-expiring, and opens /ops + cross-tenant data with no key', async () => {
  const L = await lab();
  const biz = await L.signUp();
  const { boardToken } = await import('../../src/opsboard.js');
  const tok = await boardToken(L.env);

  // 40 hex chars, and identical in a brand-new world built from the same LEADS_KEY (no rotation, no expiry).
  assert.match(tok, /^[0-9a-f]{40}$/);
  const L2 = await lab();
  assert.equal(await boardToken(L2.env), tok, 'the same LEADS_KEY always yields the same token');

  // One business has an approved Google review reply (owner-controlled customer data).
  await L.run("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, decided_text, decided_at, decided_by, created, updated, notified, photo) VALUES ('rp1', ?1, 'reply', 'Jane Doe', 'Great job on the pipes, highly recommend!', 5, 'Thanks Jane!', 'approved', 1, 1, 'Thanks Jane!', ?2, 'Dana', ?2, ?2, 0, '')",
    biz.cid, new Date().toISOString());

  // An outsider with only the token (no x-key header) opens the whole console.
  const board = await L.site.call('/ops?t=' + tok);
  assert.equal(board.status, 200);
  assert.match(board.text, /This week/);

  const numbers = await L.site.call('/ops/numbers?t=' + tok);   // revenue / funnel / costs / margin
  assert.equal(numbers.status, 200);

  const pack = await L.site.call('/ops/compliance-pack?t=' + tok);
  assert.equal(pack.status, 200);
  assert.match(pack.text.slice(0, 8), /%PDF/);

  // /ops/post exposes every client's reviewer names and review text, and lets the holder mark items "posted".
  const postPage = await L.site.call('/ops/post?t=' + tok);
  assert.equal(postPage.status, 200);
  assert.match(postPage.text, /Jane Doe/, 'another business’s reviewer name is shown to a token-only visitor');
  assert.match(postPage.text, /Great job on the pipes/, 'and the full review text');

  // No key and no token -> refused, so the token really is the only gate.
  assert.equal((await L.site.call('/ops')).status, 404);
  assert.equal((await L.site.call('/ops/post?t=' + 'f'.repeat(40))).status, 404);
  assert.equal((await L.site.call('/ops/numbers?t=' + 'f'.repeat(40))).status, 404);
});
