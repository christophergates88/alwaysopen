// Max's minutes: counted per month, shown as a meter, one push at 80 and 100 percent, the overage on the next invoice
// once, and a daily cap that turns a storm into a short message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { meterFor, meterText, minutesCron, overDailyCap, usedMinutes } from '../src/minutes.js';

const OCT = (d, h) => new Date(Date.UTC(2026, 9, d, h || 12)).toISOString();
async function seed(db, cid, n, secondsEach, day) {
  for (let i = 0; i < n; i++) await db.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, seconds, test) VALUES (?1, ?2, '+14785550100', ?3, '+14785550142', 'done', ?4, 0)").bind('CA' + cid + i + day + String(i).padStart(29, '0'), cid, OCT(day || 10, 8 + (i % 10)), secondsEach).run();
}
const setup = async () => {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, 'Starter')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1)").run();
  return db;
};

test('minutes round up per call like a phone bill, skip test and limited calls, and the meter reads plainly', async () => {
  const db = await setup(); const env = { DB: db };
  await seed(db, 'c1', 10, 61, 5);   // 10 calls of 61 s = 20 billable minutes
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, seconds, test) VALUES ('CAtest', 'c1', '+14785550100', ?1, 'done', 600, 1)").bind(OCT(6)).run();
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, seconds, test) VALUES ('CAlim', 'c1', '+14785550100', ?1, 'limited', 600, 0)").bind(OCT(6)).run();
  const m = await meterFor(env, 'c1', Date.parse(OCT(20)));
  assert.deepEqual([m.used, m.included, m.over, m.overCents, m.pct, m.month], [20, 300, 0, 0, 7, '2026-10']);
  assert.equal(meterText(m), '20 of 300 minutes this month');
  await db.prepare("INSERT INTO billing (client_id, customer, max) VALUES ('c1', 'cus_1', 1)").run();
  assert.equal((await meterFor(env, 'c1', Date.parse(OCT(20)))).included, 600, 'the extra-minutes add-on doubles it');
});

test('one push at 80 percent, one more at 100, never twice, and Max keeps answering', async () => {
  const db = await setup(); const env = { DB: db };
  const pushes = [];
  const h = { push: async (cid, n) => { pushes.push(cid + ': ' + n.title); return 1; } };
  await seed(db, 'c1', 24, 600, 3);   // 240 minutes = 80%
  await minutesCron(env, Date.parse(OCT(10)), h); await minutesCron(env, Date.parse(OCT(10, 13)), h);
  assert.deepEqual(pushes, ['c1: Max has used 240 of your 300 minutes']);
  await seed(db, 'c1', 7, 600, 12);   // 310 minutes
  await minutesCron(env, Date.parse(OCT(15)), h); await minutesCron(env, Date.parse(OCT(16)), h);
  assert.deepEqual(pushes.slice(1), ['c1: Max has used your 300 minutes this month']);
  const m = await meterFor(env, 'c1', Date.parse(OCT(16)));
  assert.deepEqual([m.over, m.overCents], [10, 250]);
  assert.match(meterText(m), /10 past the 300 in your plan \(\$2\.50 at 25¢ a minute\)/);
});

test('on the 2nd, last month’s overage goes on the Stripe invoice once; with no Stripe customer, Christopher is told', async () => {
  const db = await setup(); const env = { DB: db };
  await seed(db, 'c1', 32, 600, 20);   // 320 minutes in October
  const items = [], alerts = [];
  const h = { push: async () => 0, alert: async (t, who, d) => alerts.push(t + ' ' + d), stripe: async (env, method, path, body) => { items.push(body); return { id: 'ii_1' }; } };
  const nov2 = Date.UTC(2026, 10, 2, 12);
  let r = await minutesCron(env, nov2, h);
  assert.equal(r.invoiced, 0, 'no Stripe customer on file yet');
  assert.match(alerts[0], /used 20 minutes past their plan in 2026-10 \(\$5\.00\)/);
  await db.prepare('DELETE FROM minute_overage').run();
  await db.prepare("INSERT INTO billing (client_id, customer, max) VALUES ('c1', 'cus_1', 0)").run();
  r = await minutesCron(env, nov2, h);
  assert.equal(r.invoiced, 1);
  assert.deepEqual(items, [{ customer: 'cus_1', amount: 500, currency: 'usd', description: 'Max minutes past 300 in 2026-10: 20 minutes at 25¢' }]);
  r = await minutesCron(env, nov2 + 3600e3, h);
  assert.equal(items.length, 1, 'never twice');
  assert.equal(r.invoiced, 0);
  assert.equal(await usedMinutes(env, 'c1', '2026-11').then(u => u.minutes), 0);
});

test('the daily cap: 120 minutes in a day on one line', async () => {
  const db = await setup(); const env = { DB: db };
  const now = Date.parse(OCT(10, 18));
  await seed(db, 'c1', 11, 600, 10);   // 110 minutes today
  assert.equal(await overDailyCap(env, '+14785550100', now), false);
  await seed(db, 'c1', 2, 600, 9);     // yesterday: does not count
  assert.equal(await overDailyCap(env, '+14785550100', now), false);
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, seconds, test) VALUES ('CAlast', 'c1', '+14785550100', ?1, 'done', 700, 0)").bind(OCT(10, 17)).run();
  assert.equal(await overDailyCap(env, '+14785550100', now), true);
});
