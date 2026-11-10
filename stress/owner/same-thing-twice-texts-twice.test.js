// BUG: a second tap (or a retry after "No connection. Try again.") sends the customer the same text again.
//  1. POST /api/followup has no check for the same appointment being added twice (src/app.js:785-807): each copy gets its
//     own confirmation text now, its own reminder tomorrow, and its own confirm call from Max.
//  2. POST /api/work {action:'onway'} texts every time it is tapped (src/biz.js:173-184); the rehearsal says "one text".
// Run: node --test stress/owner/same-thing-twice-texts-twice.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

test('the same appointment sent twice: the customer gets two "You’re set" texts and two calls from Max', async () => {
  const T = await boot();
  try {
    let now = Date.parse('2026-11-10T15:00:00Z'); clock.set(now);   // Tuesday 10 AM Eastern
    const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
    const a = T.as(A.base);
    await T.approveTexting(A.cid);
    const appt = { kind: 'appointment', name: 'Cara Customer', phone: '478-555-0188', due: '2026-11-11', time: '14:00', consent: true, by: 'Dana' };
    assert.equal((await a.post('/api/followup', appt)).status, 200);
    assert.equal((await a.post('/api/followup', appt)).status, 200);   // the same form again
    now += 10 * 60e3; clock.set(now); await T.cron();
    const texts = T.world.texts.filter(t => t.To === '+14785550188').map(t => t.Body.slice(0, 44));
    const calls = T.world.dialed.filter(c => c.To === '+14785550188').length;
    assert.deepEqual({ texts: texts.length, callsFromMax: calls }, { texts: 1, callsFromMax: 1 }, 'to the customer within ten minutes: ' + texts.join(' | '));
  } finally { clock.restore(); }
});

test('"Text them I’m on the way" tapped twice: two texts and two calls', async () => {
  const T = await boot();
  try {
    clock.set('2026-11-10T15:00:00Z');
    const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
    const a = T.as(A.base);
    await T.approveTexting(A.cid);
    const job = (await a.post('/api/work', { action: 'add', name: 'Jo Job', phone: '478-555-0111', title: 'Sink' })).json().job.id;
    await a.post('/api/work', { action: 'stage', id: job, stage: 'booked' });
    await a.post('/api/work', { action: 'onway', id: job, minutes: 20, by: 'Dana' });
    clock.set('2026-11-10T15:00:02Z');   // two seconds later
    await a.post('/api/work', { action: 'onway', id: job, minutes: 20, by: 'Dana' });
    const texts = T.world.texts.filter(t => t.To === '+14785550111').length, calls = T.world.dialed.filter(c => c.To === '+14785550111').length;
    assert.deepEqual({ texts, callsFromMax: calls }, { texts: 1, callsFromMax: 1 }, 'to the customer, two seconds apart');
  } finally { clock.restore(); }
});
