// BUG: the "due for service" call goes to the same customer again the very next day, after they said "not right now".
// What goes wrong for a real person: six months after a job, Max calls Gail ("It has been a while since your water
// heater. Press 1 if you would like a call to set up the next one, or press 2 if not right now"). She presses 2. The
// next evening Max calls her again with the same question. Every customer who had a "due" call in the previous six
// months and is still between 6 and 13 months after their job is called again on the same day, all at once.
// Cause: src/outcalls.js:229. The once-only guard is the row's ref, made from Math.floor(now / (180 days)): a fixed
// 180-day bucket counted from 1 Jan 1970, not from the customer's last call. When the bucket turns over (next on
// 2027-03-03 00:00 UTC, i.e. 7 PM Eastern on Tue Mar 2) every customer still in the 180-to-400-day window gets a new ref,
// so a new call, whatever happened yesterday. Nothing else looks at the earlier 'due' row or its answer.
// Severity: medium. Repeat robocalls to customers who just declined, for every Pro business with the switch on, in a
// burst; it is also the kind of repeat call people report.
// Smallest fix: make the guard the customer, not the clock: before queueing, skip if an outcalls row of kind 'due' for
// that client and phone exists with created in the last 180 days (or use ref 'due:<phone10>:<check-in id>' so each job
// gets at most one due call).
// Run: node --test stress/clock/due-call-twice-at-bucket-edge.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, MIN, DAY } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2027-03-01 09:00', ET));
after(() => ck.restore());
const T = await boot();
const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
const a = T.as(A.base);
assert.equal((await a.post('/api/outcalls', { key: 'due', on: true })).json().on, true, 'the owner switches on "Due-for-service calls"');
await T.cron();   // makes the tables
// Gail's check-in call after her job last summer went well ("yes, it held up"): she is the kind of customer this is for.
await T.run("INSERT INTO checkins (client_id, phone, first, job, due_at, status, attempts, result, created, done_at) VALUES (?1, '+14785550177', 'Gail', 'water heater', ?2, 'yes', 1, 'held up', ?2, ?2)",
  A.cid, new Date(at('2026-08-04 11:00', ET)).toISOString());
const GAIL = '+14785550177';
const callsToGail = () => T.world.dialed.filter(d => d.To === GAIL);

test('control: Monday Mar 1, 10 AM: Max calls Gail once, she presses 2 ("not right now"); no repeat that day', async () => {
  for (let t = at('2027-03-01 10:00', ET); t <= at('2027-03-01 18:00', ET); t += 10 * MIN) {
    ck.set(t); await T.cron();
    const c = callsToGail();
    if (c.length === 1 && !c[0].answered) {
      c[0].answered = true;
      const id = new URL(c[0].Url).searchParams.get('id');
      assert.match(await T.heard('oc', c[0].sid, 'id=' + id), /It has been a while since your water heater/);
      const r = await T.hook('ocg', { CallSid: c[0].sid, Digits: '2' }, 'id=' + id);
      assert.match(r.text, /No problem/);
    }
  }
  assert.equal(callsToGail().length, 1);
});

test('the next days: Max calls Gail again with the same question', async () => {
  let again = 0;
  for (let d = 1; d <= 3 && !again; d++) {
    for (let t = at('2027-03-01 10:00', ET) + d * DAY; t <= at('2027-03-01 20:50', ET) + d * DAY; t += 10 * MIN) {
      ck.set(t); await T.cron();
      if (callsToGail().length > 1) { again = t; break; }
    }
  }
  assert.equal(callsToGail().length, 1, 'Gail said "not right now" on Mon Mar 1 and was called again ' + (again ? wallOf(again, ET).text : '') + ' with the same "due for service" question');
});
