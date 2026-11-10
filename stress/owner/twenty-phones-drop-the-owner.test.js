// BUG: after 20 later phone registrations at a business, the owner's own phone is dropped and gets no more pushes.
// apiDevice keeps the 20 most recently registered phones per business and deletes the rest (src/app.js:995). A phone's
// place in that line only moves when it registers again, and nothing checks who is registering: a tech's link can add
// 20 made-up tokens in a second. The owner's phone is then gone from app_devices, so pushClient() no longer reaches it
// (new calls, urgent calls, bookings), and nothing tells the owner.
// Run: node --test stress/owner/twenty-phones-drop-the-owner.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('a tech registers 20 tokens; the owner’s iPhone is no longer on the list that gets this business’s pushes', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-10T15:00:00Z'); clock.set(now);
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const a = T.as(A.base), t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
    const token = n => n.toString(16).padStart(64, '0');
    const OWNER_PHONE = token(1);
    assert.equal((await a.post('/api/device', { token: OWNER_PHONE })).status, 200);
    const onList = async () => !!(await T.get('SELECT 1 AS x FROM app_devices WHERE token = ?1 AND client_id = ?2', OWNER_PHONE, A.cid));
    assert.equal(await onList(), true, 'the owner’s phone is registered for pushes');

    for (let i = 2; i <= 21; i++) { now += 1000; clock.set(now); assert.equal((await t.post('/api/device', { token: token(i) })).status, 200); }
    assert.equal(await onList(), true, 'the owner’s phone must still be registered after other phones sign in; '
      + (await T.all('SELECT token FROM app_devices WHERE client_id = ?1', A.cid)).length + ' phones are on the list and none of them is the owner’s');
  } finally { clock.restore(); }
});
