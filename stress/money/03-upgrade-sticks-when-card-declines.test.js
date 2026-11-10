// BUG: tapping "Pro · $499/mo" on the in-app billing page gives the account Pro at once, even when the card is declined.
// The worker asks Stripe to change the price and bill the difference now (proration_behavior=always_invoice) but does not
// ask Stripe to refuse the change if that bill can't be paid. Stripe's documented default for a subscription update is
// payment_behavior=allow_incomplete: the change is applied, the invoice stays unpaid, the subscription goes past_due and
// the call still answers 200. The worker never looks at the answer; it writes plan = Pro and tier = Pro and tells the
// owner "Done. Your new plan starts now." Everything sold as Pro (invoice and payment reminders, follow-ups,
// missed-call text-back, past-customer reminders) is on from that moment, on a $149 payment.
// Severity: high. Anyone with a dead card gets the $499 plan for $149 (or for nothing, if they are already past due).
// Cause: src/billing.js:268 (no payment_behavior, answer ignored) and src/billing.js:269-272 (tier written regardless).
// Smallest fix: add payment_behavior: 'error_if_incomplete' to the update at billing.js:268. Stripe then answers 402 and
// changes nothing, and the catch already there shows "That did not go through".
// Run: node --test stress/money/03-upgrade-sticks-when-card-declines.test.js   (1 control passes, 2 fail)
//
// About the stand-in: the harness's fake Stripe answers every subscription update with {id}. stress/money/_h.mjs adds the
// one piece of Stripe behaviour this needs (a declined card: applied + past_due by default, 402 and nothing changed only
// with payment_behavior=error_if_incomplete). The first assertion below reads the request the worker itself sent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';
const { features } = await import('../../src/app.js');

const ck = clock('2026-11-10T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const good = await w.signup({ plan: 'Starter', business: 'Good Card Plumbing', phone: '(706) 555-0111', email: 'good@example.com' });
const bad = await w.signup({ plan: 'Starter', business: 'Bad Card Plumbing', phone: '(706) 555-0122', email: 'bad@example.com' });
const client = c => w.get('SELECT * FROM app_clients WHERE client_id = ?1', c.cid);
const invoice = c => w.site.call(c.A('/api/invoice'), { json: { action: 'add', name: 'Joe Hart', amount: '1850', due: '2026-11-20', email: 'joe@example.com', payLink: 'https://pay.example.com/x' } });

test('control: on Starter the Pro tools are refused; with a card that works, the upgrade charges and turns them on', async () => {
  assert.equal((await invoice(good)).status, 403);
  assert.equal((await invoice(bad)).status, 403);
  const r = await w.site.call(good.A('/billing'), { form: { a: 'plan', plan: 'Pro' } });
  assert.match(r.location, /billing\?done=changed$/);
  assert.equal((await client(good)).tier, 'Pro');
  assert.deepEqual(w.S.subs.get(good.sub).items.data.map(i => i.price.unit_amount), [49900], 'Stripe now bills $499');
  assert.equal(w.S.subs.get(good.sub).status, 'active');
  assert.equal((await invoice(good)).status, 200);
});

test('BUG: with a card that is declined, the upgrade must not hand over Pro', async () => {
  w.S.declining.add(bad.customer);   // the card on file will not take the charge for the difference
  const r = await w.site.call(bad.A('/billing'), { form: { a: 'plan', plan: 'Pro' } });
  const sent = w.S.log.filter(l => l.method === 'POST' && l.path === 'subscriptions/' + bad.sub).at(-1).body;
  assert.equal(sent.proration_behavior, 'always_invoice', 'the worker asked Stripe to bill the difference now');
  const c = await client(bad), f = features(c);
  const got = { stripeSays: w.S.subs.get(bad.sub).status, saidDone: /done=changed/.test(r.location), tier: c.tier, proTools: { invoices: f.invoices, followups: f.followups, textback: f.textback, past: f.past }, invoiceRoute: (await invoice(bad)).status };
  assert.deepEqual(got, { stripeSays: got.stripeSays, saidDone: false, tier: 'Starter', proTools: { invoices: false, followups: false, textback: false, past: false }, invoiceRoute: 403 },
    'Stripe could not collect a cent for the upgrade (subscription is ' + got.stripeSays + '), but the app says "Done. Your new plan starts now." and the account has Pro. Sent to Stripe: ' + JSON.stringify(sent));
});

test('BUG: and it stays Pro after Stripe reports the failed payment', async () => {
  assert.equal((await w.event('invoice.payment_failed', { id: 'in_upgrade', subscription: bad.sub, billing_reason: 'subscription_update' })).status, 200);
  assert.equal((await w.event('customer.subscription.updated', w.subObj(bad.sub))).status, 200);
  const b = await w.get('SELECT plan, status FROM billing WHERE client_id = ?1', bad.cid), c = await client(bad);
  assert.deepEqual({ status: b.status, tier: c.tier, invoiceRoute: (await invoice(bad)).status }, { status: 'active', tier: 'Starter', invoiceRoute: 403 },   // Nov 10 fix: Stripe refuses the change outright, so nothing goes past due
    'payment failed, subscription past due, and the account still has every Pro tool');
});
