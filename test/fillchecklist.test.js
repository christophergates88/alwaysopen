// Fill my week's checklist in the app: the five steps with what is done, how many past customers are due right now
// (everyone, not just the 8 a run texts), and the app page draws it with a button for each missing step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const F = await import('../src/fillweek.js');
const { BIZ_JS } = await import('../src/bizpage.js');
const { PAST_JS } = await import('../src/pastpage.js');

const now = Date.parse('2026-11-02T15:00:00Z');
const ago = d => new Date(now - d * 864e5).toISOString();

test('a new Growth client: nothing done but the plan step says Pro, no customers, nobody due', async () => {
  const db = makeDB(); const env = { DB: db };
  const c = { client_id: 'c1', business: 'Sinclair Plumbing', tier: 'Growth', regulated: 0, feats: '' };
  const s = await F.fillState(env, c, now);
  assert.deepEqual(s.steps.map(x => [x.k, x.done]), [['pro', false], ['texting', false], ['calendar', false], ['customers', false], ['on', false]]);
  assert.equal(s.ready, false); assert.equal(s.due, 0); assert.equal(s.customers, 0); assert.equal(s.nextDay, null);
  assert.equal(s.steps[3].label, 'Past customers imported');
});

test('imported customers count, and everyone due is counted, not only the 8 one run texts', async () => {
  const db = makeDB(); const env = { DB: db };
  await F.ensureFill(env);
  await (await import('../src/past.js')).ensurePast?.(env);
  for (let i = 0; i < 12; i++) {
    const p = '47855502' + String(i).padStart(2, '0');
    await db.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, agreed, optout, opt_token, source, created, updated) VALUES ('c1', ?1, ?2, ?3, ?3, 1, 0, ?1, 'import', ?4, ?4)").bind('k' + i, 'P ' + i, p, ago(1)).run();
    await db.prepare("INSERT INTO biz_jobs (client_id, phone, title, amount, stage, source, source_id, created, updated) VALUES ('c1', ?1, 'Water heater', 0, 'done', 'import', ?1, ?2, ?2)").bind(p, ago(i < 10 ? 250 : 30)).run();
  }
  const s = await F.fillState(env, { client_id: 'c1', business: 'Sinclair Plumbing', tier: 'Pro', regulated: 0 }, now);
  assert.equal(s.customers, 12);
  assert.equal(s.due, 10, 'two had a job last month, so they are not due');
  assert.deepEqual(s.steps.find(x => x.k === 'customers'), { k: 'customers', label: '12 past customers OK to contact', done: true });
  assert.equal(s.steps.find(x => x.k === 'pro').done, true);
});

test('regulated businesses and staff get no Fill my week at all', async () => {
  const env = { DB: makeDB() };
  assert.equal(await F.fillState(env, { client_id: 'c2', regulated: 1, tier: 'Pro' }, now), null);
  assert.equal(await F.fillState(env, { client_id: 'c3', regulated: 0, tier: 'Pro', staff: true }, now), null);
});

test('the app panel has a button for each missing step, and the import screen explains how to get the file', () => {
  for (const s of ['See Pro', 'Connect Google Calendar', 'Import my customers', 'Turn Fill my week on', ' past customers are', 'Nobody is due yet', 'of \'+st.length+\' ready']) assert.ok(BIZ_JS.includes(s), s);
  for (const s of ['QuickBooks Online', 'Jobber', 'Housecall Pro', 'Square', 'Google Contacts', 'hello@alwaysopenoffice.com']) assert.ok(PAST_JS.includes(s), s);
});
