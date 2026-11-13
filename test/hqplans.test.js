// Gates HQ plans from texts and email: topics Christopher muted (hq_kv 'mute', private) never become plans, tasks or
// pushes, and saved plans about them aren't handed to the Mac for reminders. No names live in the public code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { makeDB } = await import('./rehearsal/harness.js');
const { handleHqPlans, isMuted, muteList } = await import('../src/hqplans.js');

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('a muted name matches as written or in bank capitals, as a whole word', () => {
  const names = ['Acme Card', 'Zeta'];
  assert.equal(isMuted(names, 'Acme Card minimum payment $345'), true);
  assert.equal(isMuted(names, 'ACME CARD MOBILE PMT'), true);
  assert.equal(isMuted(names, '', 'Zeta'), true);
  assert.equal(isMuted(names, 'Please zeta your form'), false, 'a lower-case word is not the name');
  assert.equal(isMuted(names, 'Zetagram order'), false, 'part of another word is not the name');
  assert.equal(isMuted([], 'Zeta'), false);
});

test('saved plans about a muted topic are not handed to the Mac', async () => {
  const env = { DB: makeDB() };
  await handleHqPlans(new Request('https://x/ops/hq-plans', { method: 'GET' }), env, json);   // creates the table
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_kv (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  for (const [key, what, who] of [['m1', 'Zeta bill $19.62', 'Zeta'], ['m2', 'Power bill $277.35', 'Power Co'], ['m3', 'Dinner at Mom\'s', 'Mom']])
    await env.DB.prepare("INSERT INTO hq_plans (key, date, t, what, who, status, src, at, made, kind) VALUES (?1, ?2, '', ?3, ?4, 'new', 'email', ?5, ?5, 'bill')").bind(key, day(5), what, who, new Date().toISOString()).run();
  let r = await (await handleHqPlans(new Request('https://x/ops/hq-plans', { method: 'GET' }), env, json)).json();
  assert.equal(r.plans.length, 3, 'nothing muted yet');
  assert.deepEqual(r.mute, []);
  await env.DB.prepare("INSERT INTO hq_kv (k, at, v) VALUES ('mute', ?1, ?2)").bind(new Date().toISOString(), JSON.stringify({ names: ['Zeta'] })).run();
  assert.deepEqual(await muteList(env), ['Zeta']);
  r = await (await handleHqPlans(new Request('https://x/ops/hq-plans', { method: 'GET' }), env, json)).json();
  assert.deepEqual(r.plans.map(p => p.key).sort(), ['m2', 'm3']);
  assert.deepEqual(r.mute, ['Zeta'], 'the Mac gets the list too, for its own pushes');
});
