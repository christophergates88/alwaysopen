// BUG A (privacy): a business that connected Stripe can read other businesses' invoices: customer name, amount and
// invoice number. The Connect webhook (/stripe/webhook) trusts metadata.ao_invoice / metadata.ao_client on any paid
// Checkout Session from a connected account. It checks that the account belongs to the client named in the metadata,
// then loads the invoice BY ID ALONE to write the "Paid" push and the activity line. A connected owner has a full
// Stripe dashboard and API key of their own (controller.stripe_dashboard.type = full), sees ao_invoice / ao_client on
// their own payments, and can make a $1 session with ao_invoice set to any number. Invoice ids count up from 1.
// BUG B: two "Pay by card" taps (two tabs, or the link in two reminders) make two live Stripe sessions for one invoice.
// When both are paid the owner gets two identical "Paid" pushes and nothing says the customer paid twice.
// Cause: src/biz.js:431-434 (metadata trusted when there is no biz_pay row), src/biz.js:437 (invoice read without
//        client_id), src/biz.js:438-439 (push and activity written whether or not an invoice of theirs was marked paid);
//        src/biz.js:392-399 (a new session every tap, the earlier one left open).
// Severity: A medium (one client reads every other client's customer names and amounts), B low.
// Smallest fix: ignore paid sessions that have no biz_pay row; read the invoice with AND client_id = ?; write the push
// and the activity line only when markInvoicePaid changed a row; when the invoice was already paid, tell the owner it is
// a second payment to refund.
// Run: node --test stress/money/07-card-payment-webhook-leaks-other-businesses-invoices.test.js   (1 control passes, 2 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, H, ownerPushes } from './_h.mjs';

const ck = clock('2026-11-10T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const snoop = await w.signup({ plan: 'Pro', business: 'Curious Plumbing', phone: '(706) 555-0111', email: 'curious@example.com' });
const victim = await w.signup({ plan: 'Pro', business: 'Lane Electric', owner: 'Pat Lane', phone: '(706) 555-0144', email: 'pat@laneelectric.example', town: 'Madison, GA' });
const PHONE = { [snoop.cid]: 'a'.repeat(64), [victim.cid]: 'b'.repeat(64) };
for (const c of [snoop, victim]) assert.equal((await w.site.call(c.A('/api/device'), { json: { token: PHONE[c.cid] } })).status, 200);
// Each owner connects Stripe from the app; Stripe then tells the worker the account can take cards.
const acct = {};
for (const c of [snoop, victim]) {
  assert.equal((await w.site.call(c.A('/api/stripe'), { json: { action: 'connect' } })).status, 200);
  acct[c.cid] = (await w.get('SELECT account FROM biz_stripe WHERE client_id = ?1', c.cid)).account;
}
const csecret = (await w.get("SELECT v FROM billing_config WHERE k = 'connect_webhook_secret'")).v;
let evN = 0;
const connectEvent = async (type, object, account) => { const body = JSON.stringify({ id: 'evt_c' + (++evN), type, account, data: { object } }); const r = await w.site.call('/stripe/webhook', { body, headers: { 'stripe-signature': H.stripeSign(csecret, body) } }); await w.site.settle(); return r; };
for (const c of [snoop, victim]) assert.equal((await connectEvent('account.updated', { id: acct[c.cid], charges_enabled: true }, acct[c.cid])).status, 200);
const addInvoice = async (c, name, amount, number) => (await w.site.call(c.A('/api/invoice'), { json: { action: 'add', name, amount, number, due: '2026-11-20', email: 'customer@example.com' } })).json().invoice;
const paidSession = (id, metadata) => ({ id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 100, metadata: metadata || {} });
const pushesTo = c => ownerPushes(w.world).filter(p => p.token === PHONE[c.cid]).map(p => p.title + ' | ' + p.body);

const own = await addInvoice(snoop, 'Joe Hart', '1850', '1042');
const secret = await addInvoice(victim, 'Mary Whitfield', '9400', '77');

test('control: a customer pays the invoice by card; the invoice is marked paid and its own business hears', async () => {
  const pay = await w.site.call('/i/' + own.link.split('/').pop() + '/pay', { form: {} });
  assert.match(pay.location, /^https:\/\/checkout\.stripe\.com\//);
  const second = await w.site.call('/i/' + own.link.split('/').pop() + '/pay', { form: {} });   // the second tab, used further down
  assert.notEqual(second.location, pay.location);
  assert.equal((await connectEvent('checkout.session.completed', paidSession(pay.location.split('/').pop()), acct[snoop.cid])).status, 200);
  assert.equal((await w.get('SELECT status FROM app_invoices WHERE id = ?1', own.id)).status, 'paid');
  assert.deepEqual(pushesTo(snoop), ['Paid: Joe Hart | $1,850 came in by card for invoice #1042.']);
  assert.deepEqual(pushesTo(victim), []);
  w.secondSession = second.location.split('/').pop();
});

test('BUG A: a $1 session made in one business\'s own Stripe account, naming another business\'s invoice number, must tell it nothing', async () => {
  const before = pushesTo(snoop).length;
  const r = await connectEvent('checkout.session.completed', paidSession('cs_live_made_in_their_own_dashboard', { ao_invoice: String(secret.id), ao_client: snoop.cid }), acct[snoop.cid]);
  assert.equal(r.status, 200);
  assert.equal((await w.get('SELECT status FROM app_invoices WHERE id = ?1', secret.id)).status, 'open', 'control: the other business\'s invoice is not marked paid');
  const leaked = { pushes: pushesTo(snoop).slice(before), activity: (await w.all("SELECT what FROM biz_activity WHERE client_id = ?1 AND who = 'Stripe'", snoop.cid)).map(a => a.what).filter(x => /#77/.test(x)) };
  assert.deepEqual(leaked, { pushes: [], activity: [] }, 'Curious Plumbing was just told Lane Electric\'s customer, amount and invoice number');
});

test('BUG B: the second open session for the same invoice gets paid too; the owner must be told it is a second payment, not "Paid" again', async () => {
  const before = pushesTo(snoop).length;
  assert.equal((await connectEvent('checkout.session.completed', paidSession(w.secondSession), acct[snoop.cid])).status, 200);
  assert.deepEqual((await w.all('SELECT paid FROM biz_pay WHERE invoice_id = ?1', own.id)).map(r => r.paid), [1, 1], 'two sessions, both paid: $3,700 taken for a $1,850 invoice');
  const again = pushesTo(snoop).slice(before);
  assert.ok(again.length === 1 && again[0] !== 'Paid: Joe Hart | $1,850 came in by card for invoice #1042.', 'the only word to the owner about the second $1,850 was: ' + JSON.stringify(again));
});
