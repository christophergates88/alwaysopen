// Was: the "due for service" call going to the same customer again after they said "not right now" (fixed Nov 2026
// with a per-customer guard). Since the Nov 21, 2026 audit, due-for-service calls are gone altogether: in an automated
// voice a sales call needs the customer's prior express written consent (TCPA, FCC 24-17), which nothing collects.
// This keeps the old scenario and checks the new rule: the switch can't be turned on, and Gail is never called.
// Run: node --test stress/clock/due-call-twice-at-bucket-edge.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, MIN, DAY } from './_kit.mjs';

const ET = 'America/New_York';
const ck = clock(at('2027-03-01 09:00', ET));
after(() => ck.restore());
const T = await boot();
const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
const a = T.as(A.base);
await T.cron();   // makes the tables
// Gail's check-in call after her job last summer went well ("yes, it held up"): the kind of customer it was for.
await T.run("INSERT INTO checkins (client_id, phone, first, job, due_at, status, attempts, result, created, done_at) VALUES (?1, '+14785550177', 'Gail', 'water heater', ?2, 'yes', 1, 'held up', ?2, ?2)",
  A.cid, new Date(at('2026-08-04 11:00', ET)).toISOString());
const GAIL = '+14785550177';
const callsToGail = () => T.world.dialed.filter(d => d.To === GAIL);

test('the owner cannot switch on due-for-service calls', async () => {
  const r = (await a.post('/api/outcalls', { key: 'due', on: true })).json();
  assert.equal(r.ok, false);
  assert.match(r.error, /written OK/);
});

test('even with an old "on" row in the database, Gail is never called over four days', async () => {
  await T.run("INSERT OR REPLACE INTO outcall_prefs (client_id, k, on_) VALUES (?1, 'due', 1)", A.cid);
  for (let d = 0; d <= 3; d++) {
    for (let t = at('2027-03-01 10:00', ET) + d * DAY; t <= at('2027-03-01 20:50', ET) + d * DAY; t += 30 * MIN) { ck.set(t); await T.cron(); }
  }
  assert.equal(callsToGail().length, 0);
});
