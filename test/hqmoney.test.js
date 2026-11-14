// Gates HQ 2's money (Nov 14, 2026): the Mac posts the checking balance and the bills and paychecks that repeat to
// /ops/hq-sense as hq_kv 'money' (Mac key only); the brain reads it and dates them from today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const site = H.makeClient(worker, env);
const row = async (k) => { try { return await DB.prepare('SELECT at, v FROM hq_kv WHERE k = ?1').bind(k).first(); } catch (e) { return null; } };

test('the money row is kept whole from the Mac, and only from the Mac', async () => {
  const money = { at: '2026-11-14T09:05:00-05:00', bank_at: '2026-11-14T09:04:10-05:00', balance: 1234.56,
    plan: { everyday30: 1500, paychecks: [{ name: 'X PAYROLL', label: 'X', kind: 'biweekly', amount: 1480, last: '2026-11-07' }],
      bills: [{ name: 'Power', every: 'month', amount: 182, day: 18, last: '2026-10-18' }] } };
  const no = await site.call('/ops/hq-sense', { json: { kv: { money } } });
  assert.equal(no.status, 403, 'no key, no write');
  assert.equal(await row('money'), null);
  const ok = await site.call('/ops/hq-sense', { json: { kv: { money, other: { x: 1 } } }, headers: { 'x-key': env.LEADS_KEY } });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse((await row('money')).v), money);
  assert.equal(await row('other'), null, 'only the keys it knows');
  // a row too long to keep whole is not kept at all: the last good one stays
  const big = Object.assign({}, money, { balance: 1, pad: 'x'.repeat(61000) });
  await site.call('/ops/hq-sense', { json: { kv: { money: big } }, headers: { 'x-key': env.LEADS_KEY } });
  assert.equal(JSON.parse((await row('money')).v).balance, 1234.56);
});
