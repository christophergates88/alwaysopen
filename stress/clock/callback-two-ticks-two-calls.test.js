// BUG: when the 10-minute timer fires twice at the same moment (Cloudflare can deliver one cron tick to two isolates, and
// a slow run can overlap the next), Max phones the same customer twice, seconds apart, about one missed call-back.
// What goes wrong for a real person: Vic asked for a call back at 1 PM; the owner got held up. At 1:30 both runs read the
// same overdue promise, both mark it missed, and both have Max ring Vic "to set a new time". Vic's phone rings twice,
// the owner gets two "You missed Vic" pushes, and the row says attempts = 2, so the one retry the rules allow is spent.
// Every other customer-facing job already claims its row before acting (outcalls.js:121 'attempts = ?3',
// checkin.js:85 'due_at = ?3', autotext.js:126 "col = ''", extras.js:250); this one does not.
// Cause: src/callbacks.js:392-395. It SELECTs the overdue rows, then runs a plain
// "UPDATE callbacks SET status = 'missed' WHERE id = ?1" without checking that it was still 'pending' or that it
// changed a row, then calls placeCall (callbacks.js:288-303), which reads the stale attempts from the SELECT.
// Severity: medium. A double robocall to a customer who is already waiting on the business; needs two runs at once.
// Smallest fix: claim first: UPDATE callbacks SET status = 'missed' WHERE id = ?1 AND status = 'pending', and skip the
// row unless meta.changes === 1 (the same pattern the other jobs use).
// Run: node --test stress/clock/callback-two-ticks-two-calls.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, MIN } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2026-11-10 09:00', ET));
after(() => ck.restore());
const T = await boot();
const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
const note = (name, phone, when) => ({ name, callback: phone, reason: 'Water heater leaking', details: '', when: '', urgent: false, callback_wanted: true, callback_at: when, booked: '', spam: false, summary: 'Wants a call back.' });
const dialedTo = p => T.world.dialed.filter(d => d.To === p);

test('control: one timer run, a missed call-back: Max calls the customer once to set a new time', async () => {
  ck.set(at('2026-11-10 10:00', ET));
  await T.fullCall(A.number, '+14785550142', 'Can someone call me back at eleven?', note('Uma', '+14785550142', 'today 11:00'));
  const cb = await T.get("SELECT * FROM callbacks WHERE phone = '+14785550142'");
  assert.ok(cb, 'the promise was recorded');
  assert.equal(new Date(cb.due_at).getTime(), at('2026-11-10 11:00', ET));
  ck.set(at('2026-11-10 11:30', ET)); await T.cron();
  assert.equal(dialedTo('+14785550142').length, 1);
});

test('the same tick delivered twice at 1:30 PM: Vic is phoned twice about one missed call-back', async () => {
  ck.set(at('2026-11-10 12:00', ET));
  await T.fullCall(A.number, '+14785550143', 'Please call me back at one', note('Vic', '+14785550143', 'today 13:00'));
  // the timer runs as usual (the owner is nudged at 12:50 and does not call), then the 1:30 tick arrives twice
  for (let t = at('2026-11-10 12:10', ET); t <= at('2026-11-10 13:20', ET); t += 10 * MIN) { ck.set(t); await T.cron(); }
  assert.equal(dialedTo('+14785550143').length, 0, 'not called before the 20-minute grace');
  ck.set(at('2026-11-10 13:30', ET)); await T.cron(2);
  const row = await T.get("SELECT status, attempts FROM callbacks WHERE phone = '+14785550143'");
  assert.equal(dialedTo('+14785550143').length, 1, 'Vic was dialed ' + dialedTo('+14785550143').length + ' times at 1:30 PM; the row now says ' + JSON.stringify(row));
});
