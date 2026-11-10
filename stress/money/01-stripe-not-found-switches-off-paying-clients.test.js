// BUG: the daily "paying and served" check reads "Stripe does not know this subscription" (HTTP 404) as "cancelled", and
// switches the client off: the app link stops working and Max stops answering their line.
// Stripe never answers 404 for a subscription that was really cancelled (it stays readable with status "canceled"). It
// answers 404 when the worker's key belongs to another Stripe account or to the other mode (a test key on the live
// database: "No such subscription ... a similar object exists in live mode, but a test mode key was used"). So the one
// time this branch runs is the one time every client is still paying, and it turns ALL of them off within a day.
// They stay off after the key is fixed: the check only notes "is paying but their app is off".
// Severity: high. Every paying client loses the app and the phone line at once, and stays off until someone sets
// app_clients.active and voice_lines.on_air back by hand.
// Cause: src/checks.js:236 (catch: 404 becomes 'canceled') feeding src/checks.js:240-243 (active = 0, lineEnded).
// Smallest fix: on a 404 leave st = '' (skip the client) and raise an alert; switch a client off only on a status that
// Stripe actually returned.
// Run: node --test stress/money/01-stripe-not-found-switches-off-paying-clients.test.js   (1 control passes, 2 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, DAY } from './_h.mjs';
const { payingServed } = await import('../../src/checks.js');

const ck = clock('2026-11-10T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const a = await w.signup({ plan: 'Pro', max: '1' });
const b = await w.signup({ plan: 'Starter', business: 'Lane Electric', owner: 'Pat Lane', phone: '(706) 555-0144', email: 'pat@laneelectric.example', town: 'Madison, GA' });
const gone = await w.signup({ plan: 'Growth', business: 'Gone Roofing', owner: 'Lee Gone', phone: '(706) 555-0155', email: 'lee@goneroofing.example', town: 'Madison, GA' });
const state = () => w.all('SELECT b.business, b.status, c.active, v.on_air FROM billing b JOIN app_clients c ON c.client_id = b.client_id JOIN voice_lines v ON v.client_id = b.client_id ORDER BY b.created');
const callTo = async c => (await w.hook('in', { CallSid: w.newSid(), To: c.number, From: '+14785550199' })).text;

test('control: a subscription Stripe really cancelled (webhook missed) is switched off by the daily check, the others are left alone', async () => {
  w.S.subs.get(gone.sub).status = 'canceled';
  const r = await payingServed(w.env, Date.now(), {});
  assert.deepEqual(r.fixed, ['Gone Roofing (canceled in Stripe, still on: turned off)']);
  assert.deepEqual((await state()).map(x => [x.business, x.active, x.on_air]), [['Sinclair Plumbing', 1, 1], ['Lane Electric', 1, 1], ['Gone Roofing', 0, 0]]);
  assert.match(await callTo(a), /<ConversationRelay/, 'Max answers a paying client');
});

test('BUG: the next day the worker has a Stripe key from another account or mode; every paying client must stay on', async () => {
  // Stripe: "No such subscription" (404) for ids it does not hold. Nobody cancelled anything.
  const held = new Map(w.S.subs); w.S.subs.clear();
  ck.add(DAY);
  const pushes = w.world.pushes.length;
  const r = await payingServed(w.env, Date.now(), {});
  for (const [k, v] of held) w.S.subs.set(k, v);   // the key is put right
  const now = await state();
  const told = w.world.pushes.slice(pushes).map(p => p.title + ': ' + p.body).join(' | ');
  assert.deepEqual({ fixed: r.fixed, apps: [(await w.site.call(a.A('/api/state'))).status, (await w.site.call(b.A('/api/state'))).status], clients: now.slice(0, 2).map(x => [x.business, x.active, x.on_air]), maxAnswers: /<ConversationRelay/.test(await callTo(a)) },
    { fixed: [], apps: [200, 200], clients: [['Sinclair Plumbing', 1, 1], ['Lane Electric', 1, 1]], maxAnswers: true },
    'two paying clients lost their app and their phone line. The operator was told only: ' + told);
});

test('BUG: once the key is right again, the check must put paying clients back (or never have taken them off)', async () => {
  ck.add(DAY);
  const r = await payingServed(w.env, Date.now(), {});
  assert.deepEqual((await state()).slice(0, 2).map(x => [x.business, x.status, x.active, x.on_air]), [['Sinclair Plumbing', 'active', 1, 1], ['Lane Electric', 'active', 1, 1]],
    'Stripe says both are active and paying; they are still off. The check only says: ' + JSON.stringify(r.notes));
});
