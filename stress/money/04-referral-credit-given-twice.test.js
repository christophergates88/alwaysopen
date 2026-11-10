// BUG: one referral, two free months. When Stripe applies the referral credit but its answer does not reach the worker
// (a timeout or a dropped connection on that one call), the worker puts the referral back to "earned" and the next
// six-hourly run applies the credit a second time. The database then shows one credit of $299 while the referrer's
// Stripe balance holds $598, and the "six free months a year" cap counts one.
// Cause: src/referral.js:156 sends the credit with no Idempotency-Key (stripe() in billing.js:38-40 takes one as its 5th
// argument), and the catch at src/referral.js:161-162 resets the row to 'earned' at once instead of leaving it
// 'crediting' for recoverStuck (referral.js:169-183), which is the code that looks in Stripe before trying again.
// Severity: medium. One extra free month ($149 to $558) each time it happens; it needs one lost answer on one call.
// Smallest fix: pass 'referral-' + r.id as the 5th argument of h.stripe at referral.js:156, and in the catch leave the
// row 'crediting' so recoverStuck looks in Stripe before anything is tried again.
// Run: node --test stress/money/04-referral-credit-given-twice.test.js   (2 pass, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';

const ck = clock('2026-01-05T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const paid = (cust, id, when, reason) => ({ id, customer: cust, status: 'paid', amount_paid: 14900, attempt_count: 1, billing_reason: reason, created: Math.floor(Date.parse(when) / 1000), status_transitions: { paid_at: Math.floor(Date.parse(when) / 1000) }, charge: { id: 'ch_' + id, amount_refunded: 0, disputed: false } });
// Two referrers on Growth ($299), each sends one business that pays three months.
async function pair(n) {
  ck.set('2026-01-05T15:00:00Z');
  const R = await w.signup({ plan: 'Growth', business: 'Referrer ' + n + ' Plumbing', owner: 'Rae Number' + n, phone: '(478) 555-01' + n + '1', email: 'owner@referrer' + n + '.example' });
  const ref = (await w.get('SELECT ref FROM app_clients WHERE client_id = ?1', R.cid)).ref;
  ck.set('2026-01-10T15:00:00Z');
  const F = await w.signup({ plan: 'Starter', business: 'Friend ' + n + ' Electric', owner: 'Pat Friend' + n, phone: '(706) 555-01' + n + '4', email: 'pat@friend' + n + '.example', town: 'Madison, GA', ref });
  w.S.invoices.push(paid(F.customer, 'in_' + n + '1', '2026-01-10T15:00:00Z', 'subscription_create'), paid(F.customer, 'in_' + n + '2', '2026-02-10T15:00:00Z', 'subscription_cycle'), paid(F.customer, 'in_' + n + '3', '2026-03-10T15:00:00Z', 'subscription_cycle'));
  return { R, F };
}
const ok = await pair(1), lost = await pair(2);
const credits = c => w.S.balanceTx.filter(t => t.customer === c.customer && t.amount < 0).map(t => t.amount);

// Stripe applies the credit for the second referrer, and the answer is lost on the way back. Once.
const inner = globalThis.fetch; let dropped = 0;
globalThis.fetch = async (input, init) => {
  const res = await inner(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (!dropped && init && init.method === 'POST' && new URL(url).pathname === '/v1/customers/' + lost.R.customer + '/balance_transactions') { dropped++; throw new TypeError('network connection lost'); }
  return res;
};

test('the six-hourly referral run on the day the third month is paid, and the two runs after it', async () => {
  assert.deepEqual((await w.all('SELECT status FROM referrals ORDER BY id')).map(r => r.status), ['pending', 'pending']);
  for (const t of ['2026-03-10T18:05:00Z', '2026-03-11T00:05:00Z', '2026-03-11T06:05:00Z']) { ck.set(t); await w.cron(); }
  assert.equal(dropped, 1, 'the one lost answer happened');
  assert.deepEqual((await w.all('SELECT status, credit_cents FROM referrals ORDER BY id')).map(r => [r.status, r.credit_cents]), [['credited', 29900], ['credited', 29900]]);
});

test('control: the referrer whose credit went through normally got one free month', () => {
  assert.deepEqual(credits(ok.R), [-29900]);
  assert.equal(w.S.customers.get(ok.R.customer).balance, -29900);
});

test('BUG: the referrer whose credit hit a lost answer must also get one free month, not two', () => {
  assert.deepEqual({ creditsInStripe: credits(lost.R), balance: w.S.customers.get(lost.R.customer).balance }, { creditsInStripe: [-29900], balance: -29900 },
    'Stripe holds two "Referral: one free month" credits for referral 2: $598 off for one business sent');
});
