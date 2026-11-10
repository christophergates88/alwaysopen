// What was attacked with time and held. These PASS; they are here so a fix for one of the failing files next to this
// one can be checked against what already works.
// Run: node --test stress/clock/held-up.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, MIN } from './_kit.mjs';
const CB = await import('../../src/callbacks.js');

const ET = 'America/New_York';
const ck = clock(at('2026-11-10 09:00', ET));
after(() => ck.restore());
const T = await boot();

test('quiet hours for calls: 8:00 AM to 8:59 PM in the business zone and the customer’s area-code zone, DST days too', () => {
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 07:59', ET), '+14785550100'), false);
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 08:00', ET), '+14785550100'), true);
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 20:59', ET), '+14785550100'), true);
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 21:00', ET), '+14785550100'), false);
  // a Georgia business, a customer with a Los Angeles number: 10 AM Eastern is 7 AM there
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 10:00', ET), '+12135550100'), false);
  assert.equal(CB.callHoursOk(ET, at('2026-11-10 11:00', ET), '+12135550100'), true);
  // Arizona (no DST) in July: 8 AM Phoenix is 11 AM Eastern
  assert.equal(CB.callHoursOk(ET, at('2027-07-01 10:59', ET), '+16025550100'), false);
  assert.equal(CB.callHoursOk(ET, at('2027-07-01 11:00', ET), '+16025550100'), true);
  // the repeated 1 AM hour on Nov 1 2026 (both passes) and the missing 2 AM hour on Mar 14 2027
  const first130 = Date.parse('2026-11-01T05:30:00Z'), second130 = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(CB.callHoursOk(ET, first130, '+14785550100'), false);
  assert.equal(CB.callHoursOk(ET, second130, '+14785550100'), false);
  assert.equal(CB.callHoursOk(ET, Date.parse('2027-03-14T07:30:00Z'), '+14785550100'), false);   // 3:30 AM EDT
  // fromLocal lands on the right instant on both DST days
  assert.equal(CB.fromLocal(ET, '2026-11-01', 11, 0), Date.parse('2026-11-01T16:00:00Z'));
  assert.equal(CB.fromLocal(ET, '2027-03-14', 11, 0), Date.parse('2027-03-14T15:00:00Z'));
  assert.equal(CB.fromLocal('Pacific/Honolulu', '2027-03-14', 11, 0), Date.parse('2027-03-14T21:00:00Z'));
});

test('one tick delivered twice: a confirm call and a check-in call each ring the customer once (both claim their row)', async () => {
  const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
  const a = T.as(A.base);
  ck.set(at('2026-11-07 10:00', ET));
  assert.equal((await a.post('/api/job', { first: 'Cora', phone: '478-555-0300', job: 'drain', consent: true, callOk: true, by: 'Dana' })).status, 200);
  ck.set(at('2026-11-10 10:00', ET));
  assert.equal((await a.post('/api/followup', { kind: 'appointment', name: 'Ann', phone: '478-555-0301', due: '2026-11-11', time: '14:00', consent: true, by: 'Dana' })).status, 200);
  ck.set(at('2026-11-10 11:00', ET)); await T.cron(2);
  assert.equal(T.world.dialed.filter(d => d.To === '+14785550301').length, 1, 'confirm call once');
  assert.equal(T.world.dialed.filter(d => d.To === '+14785550300').length, 1, 'check-in call once');
});

test('a call-back time Max heard as 9 PM or 6:30 AM is not used; the proposed slot is used instead', async () => {
  // dueFromNote refuses anything before 7 AM or after 8 PM and falls back to the proposed slot
  const slot = { at: 123 };
  ck.set(at('2026-11-10 12:00', ET));
  assert.equal(CB.dueFromNote(ET, 'today 21:00', slot), 123);
  assert.equal(CB.dueFromNote(ET, 'today 06:30', slot), 123);
  assert.equal(CB.dueFromNote(ET, 'tomorrow 09:15', slot), at('2026-11-11 09:15', ET));
});
