// BUG: after 40 newer calls, a call nobody has handled drops out of the app's call list.
// /api/state lists calls newest first, LIMIT 40, whether handled or not (src/app.js:402). "Needs you" on Today, the Max
// tab's list ("Call them back, then tap Done") and its badge are all built from that list, and the Inbox has the same
// LIMIT 40 (src/biz.js:453). A busy week pushes older callers off the bottom while they still wait for a call back. What
// is left of them is a "New" card on the Jobs board (Customers tab), with no call note and no Done button.
// Run: node --test stress/owner/busy-week-hides-unhandled-calls.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('45 callers in three days, none handled yet: the first five are in neither the call list nor the inbox', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-09T14:00:00Z'); clock.set(now);
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const a = T.as(A.base);
    for (let i = 1; i <= 45; i++) {
      now += 90 * 60e3; clock.set(now);   // one every hour and a half
      const from = '+1478555' + String(2000 + i);
      await T.fullCall(A.number, from, 'My water heater is out, please call me back.', { name: 'Caller ' + i, callback: from, reason: 'No hot water', details: '', when: '', urgent: i === 3, callback_wanted: false, callback_at: '', booked: '', spam: false, summary: 'Caller ' + i + ' has no hot water and wants a call back.' });
    }
    now += 60 * 60e3; clock.set(now);
    assert.equal((await T.get("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND status != 'handled' AND outcome = 'done'", A.cid)).n, 45, '45 callers are waiting');
    const st = await a.state(), inbox = (await a.get('/api/inbox')).json().inbox;
    const shown = new Set(st.calls.map(c => c.name).concat(inbox.filter(x => x.channel === 'call').map(x => x.name)));
    const missing = Array.from({ length: 45 }, (_, i) => 'Caller ' + (i + 1)).filter(n => !shown.has(n));
    const stillAJob = st.jobs.filter(j => missing.includes(j.name)).length;
    assert.deepEqual(missing, [], 'callers still waiting for a call back who are not in the call list, "Needs you" or the inbox (Caller 3 was urgent; '
      + stillAJob + ' of them still have a card on the Jobs board). The Max tab’s badge counts ' + st.calls.filter(c => c.status !== 'handled').length + ' of 45');
  } finally { clock.restore(); }
});
