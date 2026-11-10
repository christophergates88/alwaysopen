// BUG: Max's "confirm your appointment" call tells the customer it is TOMORROW when it is today.
// What goes wrong for a real person: the owner adds tomorrow's 1 PM appointment after supper (9:45 PM). The timer queues
// the confirm call at once, with the words written then: "Your appointment with Sinclair Plumbing is tomorrow at 1 PM".
// It is too late to call (after 9 PM), so the call waits and goes at 8 AM, on the day of the appointment. The customer
// hears "tomorrow at 1 PM" that morning, presses 1, and is not home at 1 PM today. The same happens to any confirm call
// that is carried past midnight: a no-answer retry three hours later, or a wait for the customer's own 8 AM.
// Cause: src/outcalls.js:223 writes 'today' / 'tomorrow' into the row's topic when it is queued (local(tz, now)), and
// src/outcalls.js:134 / outcallTwiml reads that topic back at whatever time the call is placed.
// Severity: medium. A wrong day told to a customer, by the business, in the call that exists to stop no-shows.
// Smallest fix: store the appointment time, not the word, in the row (e.g. topic 'Your appointment with X is {day} at
// 1 PM' or keep appt_at) and work out "today" / "tomorrow" / the weekday in outcallTwiml when the call is answered.
// Run: node --test stress/clock/confirm-call-says-tomorrow-on-the-day.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, MIN } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2026-11-10 12:00', ET));
after(() => ck.restore());
const T = await boot();
const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
const a = T.as(A.base);
const addAppt = (name, phone, due, time) => a.post('/api/followup', { kind: 'appointment', name, phone, due, time, consent: true, by: 'Dana' });
async function hearConfirm(phone) {
  const d = T.world.dialed.find(x => x.To === phone);
  if (!d) return null;
  const id = new URL(d.Url).searchParams.get('id');
  return T.heard('oc', d.sid, 'id=' + id);
}

test('control: added at 2 PM for tomorrow at 1 PM; called at 2:10 PM and told "tomorrow at 1 PM"', async () => {
  ck.set(at('2026-11-10 14:00', ET));
  assert.equal((await addAppt('Cora Control', '478-555-0300', '2026-11-11', '13:00')).status, 200);
  ck.add(10 * MIN); await T.cron();
  const said = await hearConfirm('+14785550300');
  assert.ok(said, 'called');
  assert.match(said, /is tomorrow at 1 PM/);
});

test('added at 9:45 PM for tomorrow at 1 PM; called at 8 AM on the day and told "tomorrow at 1 PM"', async () => {
  ck.set(at('2026-11-10 21:45', ET));   // Tuesday evening
  assert.equal((await addAppt('Wanda Wednesday', '478-555-0311', '2026-11-11', '13:00')).status, 200);
  let calledAt = 0;
  for (let t = at('2026-11-10 21:50', ET); t <= at('2026-11-11 12:00', ET) && !calledAt; t += 10 * MIN) {
    ck.set(t); await T.cron();
    if (T.world.dialed.some(x => x.To === '+14785550311')) calledAt = t;
  }
  assert.ok(calledAt, 'Max called her before the appointment');
  const said = await hearConfirm('+14785550311');
  assert.doesNotMatch(said, /tomorrow/, 'called ' + wallOf(calledAt, ET).text + ' (the day of the 1 PM appointment) and Max said: "' + said + '"');
});
