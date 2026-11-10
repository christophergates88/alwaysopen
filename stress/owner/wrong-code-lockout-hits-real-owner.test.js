// BUG: the wrong-code pause locks out people with the RIGHT code.
// handleApp counts wrong codes per sender (IP) and, at 20 in an hour, answers 429 before it even looks at the code
// (src/app.js:144-145). So a working owner link stops working for everyone behind that IP: a shop's Wi-Fi, a phone
// carrier's shared address. One open tab on a link that no longer works is enough, because the page keeps asking for
// /api/state once a minute (src/apppage.js:1558) whatever the answer was.
// Run: node --test stress/owner/wrong-code-lockout-hits-real-owner.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

const SHOP_WIFI = '198.51.100.9', ELSEWHERE = '198.51.100.77';

test('a staff link HQ removed, still open on the shop’s computer, locks the owner out of the app on the same Wi-Fi', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-10T15:00:00Z'); clock.set(now);
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const office = await T.staffLink(A.cid, 'Olive Office', 'manager');
    assert.equal((await T.site.call(office.base + '/api/state', { ip: SHOP_WIFI })).status, 200, 'the office link works');
    assert.equal((await T.site.call(A.base + '/api/state', { ip: SHOP_WIFI })).status, 200, 'the owner’s link works on the same Wi-Fi');

    await T.run('DELETE FROM app_staff WHERE code_hash = ?1', office.hash);   // HQ removes the office worker
    // Her tab stays open: the page asks for the state once a minute.
    const seen = [];
    for (let minute = 1; minute <= 25; minute++) { now += 60e3; clock.set(now); seen.push((await T.site.call(office.base + '/api/state', { ip: SHOP_WIFI })).status); }
    assert.deepEqual([...new Set(seen.slice(0, 20))], [404], 'her link is refused, as it should be');

    const owner = await T.site.call(A.base + '/api/state', { ip: SHOP_WIFI });
    const page = await T.site.call(A.base, { ip: SHOP_WIFI });
    const away = await T.site.call(A.base + '/api/state', { ip: ELSEWHERE });
    assert.equal(away.status, 200, 'the same owner link is fine from another network');
    assert.deepEqual({ api: owner.status, page: page.status }, { api: 200, page: 200 },
      'the owner’s own, correct link on the shop Wi-Fi. The app says: ' + owner.text);
  } finally { clock.restore(); }
});

test('and it does not lift after the hour while that tab stays open', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-10T15:00:00Z'); clock.set(now);
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const stale = '/app/' + 'q'.repeat(32) + '/api/state';
    // Three hours of one stale tab; every 10 minutes the owner tries their own link from the same address.
    const ownerGot = [];
    for (let minute = 1; minute <= 180; minute++) {
      now += 60e3; clock.set(now);
      await T.site.call(stale, { ip: SHOP_WIFI });
      if (minute > 20 && minute % 10 === 5) { clock.set(now + 30e3); ownerGot.push((await T.site.call(A.base + '/api/state', { ip: SHOP_WIFI })).status); }
    }
    const blocked = ownerGot.filter(s => s === 429).length;
    assert.equal(blocked, 0, 'the owner was refused ' + blocked + ' of ' + ownerGot.length + ' times over three hours: ' + ownerGot.join(' '));
  } finally { clock.restore(); }
});
