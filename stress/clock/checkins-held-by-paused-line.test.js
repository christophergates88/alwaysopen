// BUG: one business pausing Max holds up every other business's check-in calls for three days.
// What goes wrong for a real person: a busy contractor logs 30 finished jobs with "OK to call", then pauses Max (a week
// off, or a dispute with us). His 30 check-ins come due and are kept waiting for his line to come back, as designed, for
// three days. But the job only looks at the 30 oldest due check-ins, so for those three days it looks at his and
// nobody else's. Bea's customer, whose check-in is due Friday at 11 AM, is called on Sunday instead; every business's
// "Max calls a few days after the job" stops in the meantime. The more held rows there are, the longer it lasts.
// Cause: src/checkin.js:78 leaves a paused line's rows 'pending' with their old due_at (for PAUSED_GRACE, 3 days,
// checkin.js:61), and src/checkin.js:68 reads "... k.status = 'pending' AND k.due_at <= now ... ORDER BY k.due_at LIMIT 30".
// The same pattern, with no time limit at all, is in outcalls.js (see outcalls-queue-jams.test.js).
// Severity: medium. Calls a customer agreed to arrive days late (and on a Sunday), for every business, with no alert.
// Smallest fix: when holding a row for a paused line, push its due_at to nextDay(tz, now) (like a no-answer) so it stops
// occupying the head of the queue; or exclude paused lines in the SELECT (l.on_air = 1 and owner_set not off).
// Run: node --test stress/clock/checkins-held-by-paused-line.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, MIN, HOUR, DAY } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2026-11-07 10:00', ET));   // Saturday
after(() => ck.restore());
const T = await boot();
const B = await T.signup({ plan: 'Pro', business: 'Eatonton Plumbing', owner: 'Bea Brown', email: 'bea@eatontonplumbing.example', phone: '(478) 555-0201' });
const P = await T.signup({ plan: 'Pro', business: 'Lake Oconee Heating', owner: 'Al Avery', email: 'al@lakeoconee.example', phone: '(706) 555-0101', town: 'Greensboro, GA' });
const b = T.as(B.base), p = T.as(P.base);
const logJob = (app, first, phone) => app.post('/api/job', { first, phone, job: 'furnace repair', consent: true, callOk: true, by: 'Owner' });
const calledAt = phone => { const d = T.world.dialed.find(x => x.To === phone); return d ? d.at : 0; };
// run the timer every 10 minutes between two moments; note when each number was first dialed
async function timer(from, to) {
  for (let t = from; t <= to; t += 10 * MIN) { ck.set(t); const n = T.world.dialed.length; await T.cron(); for (const d of T.world.dialed.slice(n)) d.at = t; }
}

test('control: a job logged Saturday gets its check-in call Tuesday at 11 AM', async () => {
  assert.equal((await logJob(b, 'Cora', '478-555-0300')).status, 200);
  await timer(at('2026-11-10 10:50', ET), at('2026-11-10 12:00', ET));
  assert.equal(wallOf(calledAt('+14785550300'), ET).text, 'Tue 2026-11-10 11:00');
});

test('another business pauses Max with 30 check-ins due: Bea’s customer, due Friday 11 AM, is called Sunday', async () => {
  ck.set(at('2026-11-09 09:00', ET));   // Monday: Al logs 30 finished jobs, customers OK with a call
  for (let i = 0; i < 30; i++) assert.equal((await logJob(p, 'Ann' + i, '706-555-' + String(1000 + i))).status, 200);
  ck.set(at('2026-11-10 09:00', ET));   // Tuesday: Bea logs one
  assert.equal((await logJob(b, 'Dot', '478-555-0310')).status, 200);
  ck.set(at('2026-11-11 18:00', ET));   // Wednesday evening: Al pauses Max for a long weekend
  assert.equal((await p.post('/api/line', { onAir: false })).json().ok, true);
  await timer(at('2026-11-12 10:00', ET), at('2026-11-15 18:00', ET));   // Thursday to Sunday
  const t = calledAt('+14785550310');
  assert.ok(t && wallOf(t, ET).day === '2026-11-13', 'Dot’s check-in was due Fri 2026-11-13 11:00; Max called her ' + (t ? wallOf(t, ET).text : 'never'));
});
