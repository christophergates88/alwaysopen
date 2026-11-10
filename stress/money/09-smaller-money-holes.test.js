// Smaller holes around sign-up and billing. Each test stands alone (they share one world, different businesses).
//   A. Plan names that are not plans ("constructor", "__proto__", "toString") pass every `PLANS[plan]` check, because
//      PLANS is a plain object. The worker then asks Stripe for a subscription with NO price, and if Stripe says yes it
//      sets the business up. Only Stripe's own validation stands between this and a free account.
//      src/billing.js:163 (checkout), :264 (in-app plan change), :90 (createFromSession).
//   B. A Checkout session that is "complete" but not paid (payment_status "unpaid": a bank debit still clearing, which
//      can fail days later) is treated as paid: client made, number bought, operator told "Paid by card".
//      src/billing.js:336 (webhook) and :187 (welcome page look at mode / status, never payment_status).
//   C. Three chargebacks from one client a minute apart (a bank disputing three months at once): one alert. The other two
//      deadlines never reach the operator. src/billing.js:410 keys the alert by client; src/ops.js:45-61 holds repeats 3 hours.
//   D. The same owner signs up a second time with the same email and phone (lost the private link, say): second
//      subscription, second phone number, and nothing in the "New signup" push says so. The warning exists only for
//      Payment Links (src/billing.js:91-92), not on the normal path (src/billing.js:110).
//   E. A referred owner who steps back from Stripe's payment page lands on /start with the referral code gone, so the
//      referrer never gets the free month. src/billing.js:176 (cancel_url carries the plan, not the ref).
//   F. An owner whose payment failed can clear the "Payment failed" state themselves: POST a=resume (or a=undo) to
//      the billing page sets status = 'active' without Stripe agreeing. src/billing.js:257-260 and :282-285.
// Severity: all low.
// What the harness cannot say: for A, whether the real Stripe accepts a price with no amount (the harness's Stripe does;
// the real one is believed to refuse, which is why this is low and not critical). For B, whether a complete-but-unpaid
// session can happen depends on which payment methods the Stripe account has switched on.
// Smallest fixes: A Object.hasOwn(PLANS, plan) in all three places. B require payment_status 'paid' or
// 'no_payment_required' (and handle checkout.session.async_payment_succeeded). C key the alert by dispute id.
// D add the "already pays with this email" line to the normal sign-up push. E append &ref= to cancel_url.
// F allow a=resume only from 'paused' and a=undo only from 'canceling'.
// Run: node --test stress/money/09-smaller-money-holes.test.js   (1 control passes, 10 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, CUSTOMER } from './_h.mjs';

const ck = clock('2026-11-10T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const SOLD = ['Starter', 'Growth', 'Pro'];
const checkout = async form => {
  const r = await w.site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, form) });
  const s = w.world.sessions.get(r.location.split('/').pop());
  const sent = w.S.log.filter(l => l.method === 'POST' && l.path === 'checkout/sessions').at(-1);
  return { r, s, sent: sent && sent.body };
};

test('control: a plan that is not a plan becomes Growth at Growth\'s price; Pro is Pro at Pro\'s price', async () => {
  const a = await checkout({ plan: 'Platinum', business: 'Control A', email: 'a@control.example' });
  assert.deepEqual([a.s.metadata.plan, a.sent['line_items[0][price_data][unit_amount]']], ['Growth', '29900']);
  const b = await checkout({ plan: 'Pro', business: 'Control B', email: 'b@control.example' });
  assert.deepEqual([b.s.metadata.plan, b.sent['line_items[0][price_data][unit_amount]']], ['Pro', '49900']);
});

for (const junk of ['constructor', '__proto__', 'toString']) {
  test('BUG A: plan=' + junk + ' at checkout is not sent to Stripe as a plan with no price', async () => {
    const x = await checkout({ plan: junk, business: 'Junk ' + junk, email: junk.replace(/_/g, '') + '@junk.example' });
    assert.deepEqual({ plan: x.sent['metadata[plan]'], price: x.sent['line_items[0][price_data][unit_amount]'] || 'none', name: x.sent['line_items[0][price_data][product_data][name]'] },
      { plan: 'Growth', price: '29900', name: 'Always Open Growth' }, 'the worker asked Stripe for a monthly subscription with no amount');
  });
}

test('BUG A: a paid session whose plan is not one we sell is never set up on its own (the rule for Payment Links)', async () => {
  const bought = w.world.bought.length;
  const s = { id: 'cs_test_junkplan0000000001', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: 'cus_junk', subscription: 'sub_junk', customer_email: 'junk@junk.example', amount_total: 0, metadata: { plan: 'constructor', max: '0', business: 'Free Ride Co', owner: 'Free Rider', phone: '(478) 555-0190', town: 'Eatonton, GA', type: 'Other' } };
  assert.equal((await w.event('checkout.session.completed', s)).status, 200);
  const made = await w.all("SELECT b.plan, c.tier, c.active FROM billing b JOIN app_clients c ON c.client_id = b.client_id WHERE b.business = 'Free Ride Co'");
  assert.deepEqual({ made, numbersBought: w.world.bought.length - bought }, { made: [], numbersBought: 0 }, 'a "constructor plan" client with an app and a phone number');
});

test('BUG A: the in-app plan change does not ask Stripe to move the subscription to a plan that does not exist', async () => {
  const c = await w.signup({ plan: 'Starter', business: 'Plan Changer', phone: '(706) 555-0166', email: 'changer@example.com' });
  await w.site.call(c.A('/billing'), { form: { a: 'plan', plan: 'constructor' } });
  const asked = w.S.log.filter(l => l.method === 'POST' && (l.path === 'products' || l.path === 'subscriptions/' + c.sub)).map(l => l.path + ' ' + JSON.stringify(l.body));
  assert.deepEqual(asked, [], 'sent to Stripe for plan=constructor (Stripe\'s own "missing amount" error is all that stops it)');
});

test('BUG B: a complete-but-unpaid Checkout session does not get an app, a phone number and "Paid by card"', async () => {
  const x = await checkout({ plan: 'Pro', business: 'Not Paid Yet Co', email: 'owner@notpaid.example', phone: '(706) 555-0177' });
  x.s.payment_status = 'unpaid';   // Stripe: the session finished, the money has not arrived (and may never)
  const bought = w.world.bought.length, pushes = w.world.pushes.length;
  assert.equal((await w.event('checkout.session.completed', x.s)).status, 200);
  const rows = await w.all("SELECT plan, status FROM billing WHERE business = 'Not Paid Yet Co'");
  const told = w.world.pushes.slice(pushes).filter(p => /New signup/.test(p.title)).map(p => p.body.match(/Paid by card/) ? 'Paid by card' : p.body);
  assert.deepEqual({ rows, numbersBought: w.world.bought.length - bought, told }, { rows: [], numbersBought: 0, told: [] });
});

test('BUG C: three chargebacks from one client are three alerts, each with its own deadline', async () => {
  const c = await w.signup({ plan: 'Growth', business: 'Disputes Roofing', phone: '(706) 555-0188', email: 'disputes@example.com' });
  const due = Math.floor(Date.parse('2026-11-19T23:59:00Z') / 1000), before = w.world.pushes.length;
  for (const n of [1, 2, 3]) {
    ck.add(60e3);
    w.S.charges.set('ch_d' + n, { id: 'ch_d' + n, customer: c.customer });
    assert.equal((await w.event('charge.dispute.created', { id: 'dp_' + n, charge: 'ch_d' + n, amount: 29900, reason: 'fraudulent', evidence_details: { due_by: due } })).status, 200);
    await w.site.settle();
  }
  const alerts = w.world.pushes.slice(before).filter(p => /disputed/.test(p.title + p.body));
  assert.equal(alerts.length, 3, '$897 and three dispute fees are at stake; the operator heard about one: ' + alerts.map(p => p.body.replace(/\s+/g, ' ').slice(0, 150)).join(' | '));
});

test('BUG D: a second sign-up by the same owner (same email, same phone) is flagged to the operator', async () => {
  const one = await w.signup({ plan: 'Growth', business: 'Twice Plumbing', phone: '(706) 555-0199', email: 'twice@example.com' });
  const before = w.world.pushes.length, bought = w.world.bought.length;
  const two = await w.signup({ plan: 'Growth', business: 'Twice Plumbing', phone: '(706) 555-0199', email: 'twice@example.com' });
  assert.notEqual(one.cid, two.cid);
  assert.equal(w.world.bought.length - bought, 1, 'control: it is a second client with a second number and a second subscription');
  const push = w.world.pushes.slice(before).find(p => /New signup/.test(p.title));
  assert.match(push.body, /already|second|twice|duplicate/i, 'the push for the second $299 subscription: "' + push.body + '"');
});

test('BUG E: stepping back from Stripe\'s payment page keeps the referral code', async () => {
  const x = await checkout({ plan: 'Starter', business: 'Referred Electric', email: 'referred@example.com', ref: 'sinclair-plumb-ab12' });
  assert.equal(x.sent['metadata[ref]'], 'sinclair-plumb-ab12', 'control: the code is carried to Stripe');
  assert.match(x.sent.cancel_url, /ref=sinclair-plumb-ab12/, 'the "back" link from Stripe is ' + x.sent.cancel_url + ': the form they come back to has lost who sent them');
});

test('BUG F: an owner whose payment failed cannot mark the account Active from the billing page', async () => {
  const c = await w.signup({ plan: 'Growth', business: 'Past Due Painting', phone: '(706) 555-0100', email: 'pastdue@example.com' });
  w.S.subs.get(c.sub).status = 'past_due';
  assert.equal((await w.event('invoice.payment_failed', { id: 'in_pd', subscription: c.sub, billing_reason: 'subscription_cycle' })).status, 200);
  const status = async () => (await w.get('SELECT status FROM billing WHERE client_id = ?1', c.cid)).status;
  assert.equal(await status(), 'past_due');
  assert.match((await w.site.call(c.A('/billing'))).text, /Payment failed: please update your card/, 'control: the page says so');
  await w.site.call(c.A('/billing'), { form: { a: 'resume' } });
  const afterResume = await status();
  await w.run("UPDATE billing SET status = 'past_due' WHERE client_id = ?1", c.cid);
  await w.site.call(c.A('/billing'), { form: { a: 'undo' } });
  assert.deepEqual({ afterResume, afterUndo: await status(), stripe: w.S.subs.get(c.sub).status }, { afterResume: 'past_due', afterUndo: 'past_due', stripe: 'past_due' });
});
