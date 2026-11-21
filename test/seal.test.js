// Stripe's webhook signing secrets are kept sealed, never in plain text, and the endpoints whose secrets were ever kept
// in plain text are replaced by themselves: a new endpoint, the new secret sealed, the old endpoint deleted at Stripe.
// Nov 21, 2026 audit: the billing endpoint's secret sat in billing_config in plain text, readable by anything that
// can read the database, and with it anyone could forge a "paid" signup or a cancellation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const B = await import('../src/billing.js');
const { seal, open } = await import('../src/seal.js');

function setup(extra) {
  const world = new H.World(), DB = H.makeDB(), env = Object.assign(H.makeEnv(world, DB), extra || {});
  H.installFetch(world, env);
  return { world, DB, env };
}
const get = (DB, sql, ...a) => DB.prepare(sql).bind(...a).first();
const keys = async DB => ((await DB.prepare('SELECT k FROM billing_config ORDER BY k').all()).results || []).map(r => r.k);
async function hook(env, secret, body) {
  const req = new Request('https://alwaysopenoffice.com/billing/webhook', { method: 'POST', body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
  const r = await B.handleBilling(req, env, new URL(req.url), { notify: async () => {} });
  return r.status;
}
const EVENT = JSON.stringify({ id: 'evt_x', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_nobody' } } });
// a database as it was before Nov 21: the endpoint's secret in plain text
async function legacy(env, DB, world) {
  await B.ensureBilling(env);
  const n = (world.stripeHooks = world.stripeHooks || new Map()).size + 1;
  const w = { id: 'we_old' + n, object: 'webhook_endpoint', url: 'https://alwaysopenoffice.com/billing/webhook', enabled_events: B.EVENTS.concat(['customer.created']), description: 'Always Open billing', api_version: '2024-06-20', status: 'enabled', secret: 'whsec_leaked' };
  world.stripeHooks.set(w.id, w);
  await DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('webhook_id', ?1), ('webhook_secret', 'whsec_leaked')").bind(w.id).run();
  return w;
}

test('a sealed value opens only with the same key and purpose, and shows nothing of the secret', async () => {
  const env = { STRIPE_KEY: 'sk_test_one' };
  const s1 = await seal(env, 'webhook_secret', 'whsec_abc123'), s2 = await seal(env, 'webhook_secret', 'whsec_abc123');
  assert.match(s1, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!s1.includes('abc123') && s1 !== s2, 'random each time, the secret not in it');
  assert.equal(await open(env, 'webhook_secret', s1), 'whsec_abc123');
  await assert.rejects(open({ STRIPE_KEY: 'sk_test_two' }, 'webhook_secret', s1), 'another key');
  await assert.rejects(open(env, 'connect_webhook_secret', s1), 'another purpose');
  const [v, iv, ct] = s1.split('.'), flipped = ct.slice(0, -4) + (ct.slice(-4, -3) === 'A' ? 'B' : 'A') + ct.slice(-3);
  await assert.rejects(open(env, 'webhook_secret', [v, iv, flipped].join('.')), 'changed');
  await assert.rejects(open(env, 'webhook_secret', 'whsec_abc123'), 'plain text');
  await assert.rejects(seal({}, 'webhook_secret', 'x'), 'no key');
});

test('setting Stripe up keeps only the sealed secret, and the webhook checks signatures with it', async () => {
  const { DB, env } = setup();
  await B.setupStripe(env);
  assert.deepEqual((await keys(DB)).filter(k => /webhook/.test(k)), ['webhook_id', 'webhook_secret_sealed']);
  const row = await get(DB, "SELECT v FROM billing_config WHERE k = 'webhook_secret_sealed'");
  assert.ok(!row.v.includes('whsec'), 'sealed');
  assert.equal(await B.webhookSecret(env, 'billing'), 'whsec_rehearsal_secret');
  assert.equal(await hook(env, 'whsec_rehearsal_secret', EVENT), 200);
  assert.equal(await hook(env, 'whsec_wrong', EVENT), 400);
  // already sealed: the 10-minute job reads the database and calls Stripe for nothing
  const seen = [];
  assert.equal(await B.sealWebhooks(env, (...a) => { seen.push(a); return B.stripe(...a); }), 'sealed');
  assert.deepEqual(seen, []);
});

test('an endpoint whose secret was in plain text is replaced, 15 minutes after the new code first runs', async () => {
  const { world, DB, env } = setup();
  const old = await legacy(env, DB, world);
  assert.equal(await hook(env, 'whsec_leaked', EVENT), 200, 'before: the plain secret still works');
  const t0 = Date.parse('2026-11-21T15:00:00Z');
  const calls = () => world.calls.filter(c => /api\.stripe\.com\/v1\/webhook_endpoints/.test(c.url)).length;
  assert.match(await B.sealWebhooks(env, undefined, t0), /billing: waiting/);
  assert.match(await B.sealWebhooks(env, undefined, t0 + 14 * 60000), /billing: waiting/);
  assert.equal(calls(), 0, 'nothing asked of Stripe while a rollback could still happen');
  const seen = [];
  assert.equal(await B.sealWebhooks(env, (e, m, p, b, idem) => { seen.push([m, p, idem || '']); return B.stripe(e, m, p, b, idem); }, t0 + 16 * 60000), 'billing: replaced');
  assert.deepEqual(seen, [['GET', 'webhook_endpoints/' + old.id, ''], ['POST', 'webhook_endpoints', 'seal-billing-' + old.id], ['DELETE', 'webhook_endpoints/' + old.id, '']],
    'read the old settings, make the new one (an idempotency key, so a retry never makes two), delete the old one');
  // the new endpoint copies the old one's address, events, description and event version
  const made = [...world.stripeHooks.values()].filter(w => w.id !== old.id);
  assert.equal(made.length, 1);
  assert.deepEqual({ url: made[0].url, ev: made[0].enabled_events, d: made[0].description, v: made[0].api_version, connect: made[0].connect }, { url: old.url, ev: old.enabled_events, d: old.description, v: old.api_version, connect: false });
  assert.deepEqual(world.stripeHookDeletes, [old.id], 'the old endpoint is deleted at Stripe');
  const ks = await keys(DB);
  assert.ok(!ks.includes('webhook_secret'), 'no plain-text secret left');
  assert.equal((await get(DB, "SELECT v FROM billing_config WHERE k = 'webhook_id'")).v, made[0].id);
  assert.equal(await B.webhookSecret(env, 'billing'), made[0].secret);
  assert.equal(await hook(env, 'whsec_leaked', EVENT), 400, 'the leaked secret signs nothing anymore');
  assert.equal(await hook(env, made[0].secret, EVENT), 200);
  // done: later runs call Stripe for nothing
  const n = calls();
  assert.equal(await B.sealWebhooks(env, undefined, t0 + 30 * 60000), 'sealed');
  assert.equal(calls(), n);
});

test('code that was rolled back and comes back hours later waits its 15 minutes again', async () => {
  const { world, DB, env } = setup();
  await legacy(env, DB, world);
  const t0 = Date.parse('2026-11-21T15:00:00Z');
  assert.match(await B.sealWebhooks(env, undefined, t0), /waiting/);
  // rolled back before replacing; the same code is deployed again a day later
  assert.match(await B.sealWebhooks(env, undefined, t0 + 864e5), /waiting/, 'a fresh wait');
  assert.match(await B.sealWebhooks(env, undefined, t0 + 864e5 + 10 * 60000), /waiting/);
  assert.equal(world.stripeHookDeletes, undefined, 'nothing replaced yet');
  assert.equal(await B.sealWebhooks(env, undefined, t0 + 864e5 + 20 * 60000), 'billing: replaced');
});

test('a replaced STRIPE_KEY heals by itself: the sealed secret no longer opens, so a new endpoint is made at once', async () => {
  const { world, DB, env } = setup();
  await B.setupStripe(env);
  env.STRIPE_KEY = 'sk_test_rotated';
  assert.equal(await B.webhookSecret(env, 'billing'), '', 'can no longer be opened');
  assert.equal(await hook(env, 'whsec_rehearsal_secret', EVENT), 400);
  assert.equal(await B.sealWebhooks(env), 'billing: replaced', 'no 15-minute wait: no rollback is involved');
  const id = (await get(DB, "SELECT v FROM billing_config WHERE k = 'webhook_id'")).v;
  assert.equal(await hook(env, world.stripeHooks.get(id).secret, EVENT), 200);
  assert.deepEqual(world.stripeHookDeletes, ['we_test1']);
});

test('if Stripe will not delete the old endpoint, the new secret is already in use and the delete is tried again', async () => {
  const { world, DB, env } = setup();
  const old = await legacy(env, DB, world);
  const t0 = Date.parse('2026-11-21T15:00:00Z');
  await B.sealWebhooks(env, undefined, t0);
  world.fail.stripeDelete = true;
  assert.match(await B.sealWebhooks(env, undefined, t0 + 16 * 60000), /replaced, old endpoint not deleted yet/);
  assert.equal(await hook(env, 'whsec_leaked', EVENT), 400, 'the old secret is refused already');
  assert.equal((await get(DB, "SELECT v FROM billing_config WHERE k = 'webhook_id_old'")).v, old.id);
  assert.match(await B.sealWebhooks(env, undefined, t0 + 26 * 60000), /old endpoint still there/);
  world.fail.stripeDelete = false;
  assert.match(await B.sealWebhooks(env, undefined, t0 + 36 * 60000), /billing: old endpoint deleted/);
  assert.equal(await get(DB, "SELECT v FROM billing_config WHERE k = 'webhook_id_old'"), null);
  assert.deepEqual(world.stripeHookDeletes, [old.id]);
  assert.equal([...world.stripeHooks.values()].filter(w => !w.deleted).length, 1, 'exactly one endpoint left');
});

test('the client-payments endpoint is sealed and replaced the same way, still a Connect endpoint', async () => {
  const { world, DB, env } = setup();
  await B.setupStripe(env);
  // made before Nov 21, its secret in plain text
  world.stripeHooks.set('we_conn', { id: 'we_conn', object: 'webhook_endpoint', url: 'https://alwaysopenoffice.com/stripe/webhook', enabled_events: B.CONNECT_EVENTS, description: 'Always Open client payments', api_version: null, connect: true, status: 'enabled', secret: 'whsec_conn_leaked' });
  const t = Date.now();   // the new code first ran 20 minutes ago
  await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('connect_webhook_id', 'we_conn'), ('connect_webhook_secret', 'whsec_conn_leaked'), ('seal_seen', ?1)").bind(String(t - 20 * 60000)).run();
  assert.equal(await B.webhookSecret(env, 'connect'), 'whsec_conn_leaked');
  assert.equal(await B.sealWebhooks(env, undefined, t), 'connect: replaced');
  const id = (await get(DB, "SELECT v FROM billing_config WHERE k = 'connect_webhook_id'")).v;
  const w = world.stripeHooks.get(id);
  assert.ok(w && w.connect === true && w.url === 'https://alwaysopenoffice.com/stripe/webhook', 'still listens to connected accounts');
  assert.equal(await B.webhookSecret(env, 'connect'), w.secret);
  assert.ok(!(await keys(DB)).includes('connect_webhook_secret'));
  assert.deepEqual(world.stripeHookDeletes, ['we_conn']);
  assert.equal(await B.webhookSecret(env, 'billing'), 'whsec_rehearsal_secret', 'the billing endpoint was left alone');
});

test('nothing to do without Stripe or before billing is set up', async () => {
  const { env } = setup({ STRIPE_KEY: '' });
  assert.equal(await B.sealWebhooks(env), 'no stripe');
  const s = setup(), seen = [];
  assert.equal(await B.sealWebhooks(s.env, (...a) => { seen.push(a); return B.stripe(...a); }), 'no endpoints');
  assert.deepEqual(seen, []);
  assert.equal(await B.webhookSecret(s.env, 'billing'), '');
  // a database where billing was never set up at all
  const bare = { STRIPE_KEY: 'sk_test_x', DB: { prepare: () => ({ all: async () => { throw new Error('no such table: billing_config'); }, bind() { return this; } }) } };
  assert.equal(await B.sealWebhooks(bare), 'no billing set up');
});
