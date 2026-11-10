// BUG: last month's extra-minute charge is worked out against the add-on the client has on the 2nd of THIS month, not the
// one they had (and paid for) in the month being billed.
//   - A client who paid for 600 minutes in October, used 500, and dropped the add-on on October 28 is charged $50.00
//     "past 300" for October.
//   - The same code forgives the other way round: 500 minutes on the plain 300, add-on bought November 1, nothing charged.
// Severity: high. A client's card is charged for minutes they had paid for; or we give away up to $75 a month per client.
// Cause: src/minutes.js:31-34 (includedFor reads billing.max as it is now) used at src/minutes.js:74 for last month.
// Smallest fix: keep the allowance with the month. On each 10-minute run, when includedFor is 600, INSERT OR IGNORE a
// minute_marks (client_id, month, 'incl600') row; on the 2nd use 600 for last month only if that row exists for it.
// Run: node --test stress/money/02-overage-wrong-month-allowance.test.js   (3 pass, 2 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';
const { meterFor } = await import('../../src/minutes.js');

const ck = clock('2026-10-05T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const base = { owner: 'Pat Lane', town: 'Madison, GA' };
const kept = await w.signup({ max: '1', business: 'Kept Add-on Plumbing', phone: '(706) 555-0111', email: 'kept@example.com', ...base });
const dropped = await w.signup({ max: '1', business: 'Dropped Add-on Plumbing', phone: '(706) 555-0122', email: 'dropped@example.com', ...base });
const added = await w.signup({ max: '0', business: 'Added Add-on Plumbing', phone: '(706) 555-0133', email: 'added@example.com', ...base });

// 50 ten-minute calls each in October: 500 minutes.
let n = 0;
for (const c of [kept, dropped, added]) for (let i = 0; i < 50; i++) {
  await w.run("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, seconds, relay_seconds, test) VALUES (?1, ?2, ?3, ?4, '+14785550142', 'done', 600, 598, 0)",
    'CA' + (++n).toString(16).padStart(32, '0'), c.cid, c.number, new Date(Date.UTC(2026, 9, 6 + (i % 20), 14, i)).toISOString());
}
const itemsFor = c => w.S.invoiceItems.filter(i => i.customer === c.customer);

test('control: in October the meter shows 500 of 600 for the two who pay for the add-on, 500 of 300 for the one who does not', async () => {
  ck.set('2026-10-27T15:00:00Z');
  for (const [c, included, over] of [[kept, 600, 0], [dropped, 600, 0], [added, 300, 200]]) {
    const m = await meterFor(w.env, c.cid);
    assert.deepEqual([m.used, m.included, m.over], [500, included, over]);
  }
});

test('the add-on changes in Stripe around the end of the month, and Stripe tells the worker', async () => {
  // October 28: one client takes the add-on off for next month.
  ck.set('2026-10-28T15:00:00Z');
  const sub = w.S.subs.get(dropped.sub);
  sub.items.data = sub.items.data.filter(i => !/Max/.test(i.price.product.name));
  assert.equal((await w.event('customer.subscription.updated', w.subObj(dropped.sub))).status, 200);
  assert.equal((await w.get('SELECT max FROM billing WHERE client_id = ?1', dropped.cid)).max, 0);
  // November 1: another client, 200 minutes over in October, has the add-on put on.
  ck.set('2026-11-01T15:00:00Z');
  w.S.subs.get(added.sub).items.data.push({ id: 'si_added', quantity: 1, price: { unit_amount: 5900, recurring: { interval: 'month' }, product: { id: 'prod_max', name: 'More Max minutes' } } });
  assert.equal((await w.event('customer.subscription.updated', w.subObj(added.sub))).status, 200);
  assert.equal((await w.get('SELECT max FROM billing WHERE client_id = ?1', added.cid)).max, 1);
});

test('November 2: the every-10-minutes job bills October', async () => {
  ck.set('2026-11-02T00:10:00Z');
  await w.cron();
  ck.add(10 * 60e3); await w.cron();   // a second run changes nothing
  assert.equal((await w.all('SELECT * FROM minute_overage')).length, 3, 'all three were looked at');
  assert.deepEqual(itemsFor(kept), [], 'control: 500 of 600, add-on untouched, nothing charged');
});

test('BUG (wrongly charged): 500 minutes used in a month with 600 paid for must not be billed as overage', () => {
  assert.deepEqual(itemsFor(dropped).map(i => [i.amount, i.description]), [],
    'they paid $59 for the extra 300 in October and stayed inside 600, yet Stripe was told to charge them');
});

test('BUG (money lost): 200 minutes over the plan in October must still be billed after the add-on is bought in November', () => {
  assert.deepEqual(itemsFor(added).map(i => i.amount), [5000], '200 minutes at 25 cents = $50.00 owed for October');
});
