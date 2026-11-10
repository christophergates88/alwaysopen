// BUG: Max's outgoing customer calls (confirm the appointment, rebook a missed visit, follow up an estimate, due for
// service, the owner's morning rundown) stop for EVERY business, for good, once 40 calls are stuck waiting on lines that
// are paused or ended.
// What goes wrong for a real person: a call is queued and then can't be placed because that business's line is off
// (the owner paused Max, or the plan ended). The row is left 'pending' with its old due time, forever. The timer only
// ever looks at the 40 oldest pending rows, so after enough of those pile up (one busy business ending its plan the
// night before 40 confirmations go out is enough; ordinary churn gets there on its own) it looks at the same 40 dead
// rows every 10 minutes and never reaches anyone else's. A plumber in Eatonton who pays for "Max calls the day before
// to confirm" gets no confirmation calls at all, and nothing tells anyone. If a paused business comes back weeks later,
// the stale calls fire then ("your appointment is tomorrow" about one long gone).
// Cause: src/outcalls.js:106 (place: a paused/ended line leaves the row 'pending', due_at unchanged, no age limit) and
// src/outcalls.js:239 ("... status = 'pending' AND due_at <= now ... ORDER BY due_at LIMIT 40"). The clients loop above
// it skips ended clients, but nothing clears what they left in the queue.
// Severity: high. Every Pro business silently loses a feature it pays for, with no alert; it never recovers by itself.
// Smallest fix: in place(), for a line that is not live, push due_at forward (e.g. +1 hour) so live rows come first, and
// mark the row 'skipped' once it is older than a day or two (the confirm/noshow it was about is over by then). Also
// skip rows of inactive clients outright (app_clients.active = 0), as callbacks.js:397 and checkin.js:77 do.
// Run: node --test stress/clock/outcalls-queue-jams.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, MIN, HOUR, DAY } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2026-11-10 09:00', ET));
after(() => ck.restore());
const T = await boot();

const B = await T.signup({ plan: 'Pro', business: 'Eatonton Plumbing', owner: 'Bea Brown', email: 'bea@eatontonplumbing.example', phone: '(478) 555-0201' });
const b = T.as(B.base);
const dialedTo = p => T.world.dialed.filter(d => d.To === p);
const addAppt = (app, name, phone, due, time) => app.post('/api/followup', { kind: 'appointment', name, phone, due, time, consent: true, by: 'Owner' });

test('control: the day before an appointment, Max calls the customer to confirm it', async () => {
  ck.set(at('2026-11-10 14:00', ET));   // Tuesday 2 PM
  const r = await addAppt(b, 'Cora Control', '478-555-0300', '2026-11-11', '14:00');
  assert.equal(r.status, 200, r.text);
  ck.add(10 * MIN); await T.cron();
  assert.equal(dialedTo('+14785550300').length, 1, 'confirm call placed');
});

test('two other businesses leave 40 confirm calls in the queue overnight; after that nobody’s customers are called', async () => {
  // Tuesday evening: two busy businesses add tomorrow's appointments after supper (20 each, customers said calls are OK).
  const A = await T.signup({ plan: 'Pro', business: 'Lake Oconee Heating', owner: 'Al Avery', email: 'al@lakeoconee.example', phone: '(706) 555-0101', town: 'Greensboro, GA' });
  const C = await T.signup({ plan: 'Pro', business: 'Milledgeville Electric', owner: 'Cy Cole', email: 'cy@milledgeville.example', phone: '(478) 555-0401', town: 'Milledgeville, GA' });
  const a = T.as(A.base), c = T.as(C.base);
  ck.set(at('2026-11-10 21:30', ET));
  for (let i = 0; i < 20; i++) {
    assert.equal((await addAppt(a, 'Ann ' + i, '706-555-' + String(1000 + i), '2026-11-11', String(13 + (i % 4)) + ':' + (i % 2 ? '30' : '00'))).status, 200);
    assert.equal((await addAppt(c, 'Cal ' + i, '478-555-' + String(1000 + i), '2026-11-11', String(13 + (i % 4)) + ':' + (i % 2 ? '30' : '00'))).status, 200);
  }
  ck.add(10 * MIN); await T.cron();   // 9:40 PM: the 40 confirm calls are queued for 8 AM (too late to call now: correct)
  assert.equal((await T.get("SELECT COUNT(*) AS n FROM outcalls WHERE status = 'pending' AND kind = 'confirm' AND client_id IN (?1, ?2)", A.cid, C.cid)).n, 40);
  // Overnight: A's owner pauses Max from the app; C's subscription ends (Stripe's signed event).
  assert.equal((await a.post('/api/line', { onAir: false })).json().ok, true, 'A paused Max');
  assert.equal((await T.stripeEvent('customer.subscription.deleted', { id: C.sub, customer: C.customer, status: 'canceled' })).status, 200, 'C ended');

  // Thursday 10 AM: B (paying, line on) adds Friday's appointment. Run the timer all day Thursday.
  ck.set(at('2026-11-12 10:00', ET));
  assert.equal((await addAppt(b, 'Dot Daily', '478-555-0310', '2026-11-13', '14:00')).status, 200);
  for (let t = at('2026-11-12 10:10', ET); t <= at('2026-11-12 18:00', ET); t += 10 * MIN) { ck.set(t); await T.cron(); }
  // and a week later, still the same
  for (let t = at('2026-11-19 10:00', ET); t <= at('2026-11-19 11:00', ET); t += 10 * MIN) { ck.set(t); await T.cron(); }

  const stuck = (await T.get("SELECT COUNT(*) AS n FROM outcalls WHERE status = 'pending' AND client_id IN (?1, ?2)", A.cid, C.cid)).n;
  const mine = await T.get("SELECT status, attempts, result, due_at FROM outcalls WHERE client_id = ?1 AND phone = '+14785550310'", B.cid);
  assert.ok(mine, 'B’s confirm call was queued');
  assert.ok(dialedTo('+14785550310').length >= 1,   // Nov 10: one retry 3 hours later is by design when nobody answers
    'B’s customer was never called to confirm Friday’s appointment (row: ' + JSON.stringify(mine) + '). The queue is held by ' + stuck + ' rows of a paused and an ended business, still pending a week later.');
});
