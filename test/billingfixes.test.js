// Billing fixes from the full review: one client per checkout even under a race, Payment Links never auto-set up,
// one free pause a year, both Stripe invoice shapes, our own paused/ending states, and plan/add-on sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const B = await import('../src/billing.js');

function setup() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const pings = [];
  return { world, DB, env, pings, h: { notify: async (t, b, p) => pings.push([t, b, p]) } };
}
const session = (id, meta) => ({ id, mode: 'subscription', customer: 'cus_1', subscription: 'sub_' + id, customer_email: 'dana@example.com', amount_total: 29900, metadata: meta });
const META = { plan: 'Growth', max: '0', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', town: 'Eatonton, GA', type: 'Contractor or trade' };

test('the webhook and the welcome page at the same moment make one client, not two', async () => {
  const { DB, env, h } = setup();
  const s = session('cs_race1', META);
  const [a, b] = await Promise.all([B.createFromSession(env, s, h), B.createFromSession(env, s, h)]);
  assert.equal(a.client_id, b.client_id);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM app_clients').first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM billing').first()).n, 1);
});

test('a Payment Link payment is never turned into a client or a phone line; Christopher hears at high priority', async () => {
  const { DB, env, h, pings } = setup();
  assert.equal(await B.createFromSession(env, session('cs_link1', {}), h), null);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM app_clients').first()).n, 0);
  assert.match(pings[0][0], /^Payment Link payment: dana@example\.com/);
  assert.match(pings[0][1], /\$299\.00 through a Stripe Payment Link\. Nothing was set up on its own/);
  assert.equal(pings[0][2], 'high');
  // To someone who already pays: a warning about a second subscription.
  await B.createFromSession(env, session('cs_real', META), h);
  await B.createFromSession(env, session('cs_link2', {}), h);
  assert.match(pings.at(-1)[1], /Sinclair Plumbing already pays with this email/);
});

test('both Stripe invoice shapes find the subscription; an invoice without one is ignored', () => {
  assert.equal(B.invoiceSub({ subscription: 'sub_1' }), 'sub_1');
  assert.equal(B.invoiceSub({ parent: { subscription_details: { subscription: 'sub_2' } } }), 'sub_2');
  assert.equal(B.invoiceSub({ subscription: { id: 'sub_3' } }), 'sub_3');
  assert.equal(B.invoiceSub({}), '');
});

test('a pause and a cancellation at the period’s end keep their own names', () => {
  assert.equal(B.statusOf({ status: 'active', pause_collection: { behavior: 'void' } }), 'paused');
  assert.equal(B.statusOf({ status: 'active', cancel_at_period_end: true }), 'canceling');
  assert.equal(B.statusOf({ status: 'past_due' }), 'past_due');
});

test('a plan or add-on changed in Stripe by hand reaches the app', async () => {
  const { DB, env, h, pings } = setup();
  const b = await B.createFromSession(env, session('cs_sync', META), h);
  const call = async () => ({ items: { data: [{ price: { unit_amount: 49900, product: { name: 'Always Open Pro' } } }, { price: { unit_amount: 14900, product: { name: 'More Max minutes' } } }] } });
  await B.subUpdated(env, { id: b.sub, status: 'active', cancel_at_period_end: true }, h, call);
  const r = await DB.prepare('SELECT plan, max, status FROM billing WHERE client_id = ?1').bind(b.client_id).first();
  assert.deepEqual([r.plan, r.max, r.status], ['Pro', 1, 'canceling']);
  assert.equal((await DB.prepare('SELECT tier FROM app_clients WHERE client_id = ?1').bind(b.client_id).first()).tier, 'Pro');
  assert.match(pings.at(-1)[1], /Growth to Pro/);
});
