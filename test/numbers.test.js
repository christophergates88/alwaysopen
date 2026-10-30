// The numbers page: revenue from plans, the website funnel, real Twilio spend from its balance (top-ups ignored),
// per-client cost estimates, cohorts, and the daily snapshot that draws the revenue line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { mrrOf, costOf, spentFrom, numbersState, numbersDaily, renderNumbers, RATES } = await import('../src/numbers.js');

const NOW = Date.parse('2026-10-20T16:00:00Z');
const ago = d => new Date(NOW - d * 864e5).toISOString();

test('monthly revenue counts paying plans and the extra minutes, never demo or Always Open itself', () => {
  const m = mrrOf([
    { client_id: 'a', plan: 'Growth', status: 'active', max: 0 }, { client_id: 'b', plan: 'Pro', status: 'past_due', max: 1 },
    { client_id: 'c', plan: 'Starter', status: 'canceled' }, { client_id: 'always-open', plan: 'Pro', status: 'active' }, { client_id: 'demo-plumbing', plan: 'Pro', status: 'active' }
  ]);
  assert.equal(m.cents, 29900 + 49900 + 14900);
  assert.equal(m.clients, 2);
  assert.deepEqual(Object.keys(m.byPlan).sort(), ['Growth', 'Pro']);
});

test('costs: the estimate from usage, and real spend from balance drops with top-ups ignored', () => {
  assert.equal(Math.round(costOf({ minutes: 100, texts: 100, numbers: 1, aiIn: 2e6, aiOut: 1e6 }) * 100) / 100, Math.round((100 * RATES.voicePerMin + 100 * RATES.perText + RATES.numberPerMonth + 2 * RATES.claudeInPerM + RATES.claudeOutPerM) * 100) / 100);
  assert.equal(spentFrom([{ at: ago(3), value: 50 }, { at: ago(2), value: 45 }, { at: ago(1.5), value: 95 }, { at: ago(1), value: 92 }]), 8);
});

test('the page from the tables: funnel, margin, per-client rows, cohorts, and a snapshot once a day', async () => {
  const db = makeDB(); const env = { DB: db };
  const client = async (id, plan, status, created) => {
    await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES (?1, ?2, ?3, 1)").bind(id, 'h' + id, 'Biz ' + id).run();
    await db.prepare("INSERT INTO billing (client_id, plan, status, business, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(id, plan, status, 'Biz ' + id, created).run();
  };
  await client('1', 'Growth', 'active', '2026-08-03T15:00:00Z');
  await client('2', 'Starter', 'active', '2026-10-05T15:00:00Z');
  await client('3', 'Pro', 'canceled', '2026-08-10T15:00:00Z');
  for (let i = 0; i < 10; i++) await db.prepare("INSERT INTO audits (at, q, score) VALUES (?1, 'x', 60)").bind(ago(i + 1)).run();
  for (let i = 0; i < 3; i++) await db.prepare("INSERT INTO leads (at, status) VALUES (?1, 'new')").bind(ago(i + 1)).run();
  await db.prepare("INSERT INTO leads (at, status) VALUES (?1, 'spam')").bind(ago(2)).run();
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, seconds, ai_in, ai_out) VALUES ('c1', '1', '+1', ?1, 'done', 0, 600, 100000, 20000)").bind(ago(2)).run();
  await db.prepare("INSERT INTO funding_log (at, service, value) VALUES (?1, 'twilio', 60), (?2, 'twilio', 52)").bind(ago(10), ago(1)).run();
  const s = await numbersState(env, NOW);
  assert.equal(s.mrr.cents, 29900 + 14900);
  assert.deepEqual([s.funnel.now.audits, s.funnel.now.requests, s.funnel.now.signups], [10, 3, 1]);
  assert.equal(s.costs.twilio, 8);
  assert.equal(s.perClient.length, 2);
  assert.ok(s.cohorts.find(c => c.key === '2026-08').joined === 2 && s.cohorts.find(c => c.key === '2026-08').active === 1);
  const html = renderNumbers(s, '/ops?t=x');
  for (const bad of ['undefined', 'NaN']) assert.ok(!html.includes(bad), bad);
  assert.ok(html.includes('$448'), 'monthly revenue tile');
  assert.ok(html.includes('starts drawing tomorrow'));
  assert.equal((await numbersDaily(env, NOW)).clients, 2);
  assert.deepEqual(await numbersDaily(env, NOW + 3600e3), { skipped: true });
  await numbersDaily(env, NOW + 864e5);
  const s2 = await numbersState(env, NOW + 864e5);
  assert.ok(renderNumbers(s2, '/ops').includes('nm-spark'));
});
