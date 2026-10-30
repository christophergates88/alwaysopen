// From the second review of the fixes: plain-words opt-outs, real customers not hung up on, renewals every year, and a
// signup whose app row was lost is finished on the next try.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

test('opt-outs in plain words count; "stop by" and "cancel my appointment" do not', async () => {
  const { keywordOf } = await import('../src/sms.js');
  for (const t of ['STOP', 'Please stop texting me', 'Stop texting me please', 'Remove me from your list', "Don't text me anymore", 'no more texts thanks']) assert.equal(keywordOf(t), 'stop', t);
  for (const t of ['Stop by after 3', 'Cancel my appointment Tuesday', 'End of day works', 'Can you stop the leak today?']) assert.equal(keywordOf(t), '', t);
});

test('a customer asking about their own warranty or a notice is not a robocall; the pitch still is', async () => {
  const { looksRobo } = await import('../src/voice.js');
  assert.equal(looksRobo("Is my car's warranty still good? I got a second notice from the dealer"), false);
  assert.equal(looksRobo('Is my transmission repair covered by my extended warranty?'), false);
  assert.equal(looksRobo('We are calling about your extended car warranty. This is your final attempt to reach you'), true);
  assert.equal(looksRobo('This is a recorded message, press 1 now'), true);
});

test('a paid signup whose app row was never written gets it on the next try', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const B = await import('../src/billing.js');
  const s = { id: 'cs_lost1', mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', customer_email: 'dana@example.com', metadata: { plan: 'Growth', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', town: 'Eatonton, GA', type: 'Contractor or trade' } };
  const first = await B.createFromSession(env, s, {});
  await DB.prepare('DELETE FROM app_clients WHERE client_id = ?1').bind(first.client_id).run();   // as if that write had failed
  const pings = [];
  const again = await B.createFromSession(env, s, { notify: async t => pings.push(t) });
  assert.equal(again.client_id, first.client_id);
  const c = await DB.prepare('SELECT tier, active, business FROM app_clients WHERE client_id = ?1').bind(first.client_id).first();
  assert.deepEqual([c.tier, c.active, c.business], ['Growth', 1, 'Sinclair Plumbing']);
  assert.match(pings[0], /New signup: Sinclair Plumbing/);
});
