// BUG: POST /api/invoice {action:'paid'} with no id (or id 0, null, "abc") marks EVERY job that has no invoice as paid.
// apiInvoice turns a missing id into 0, the invoice update changes nothing, and then
//   UPDATE biz_jobs SET stage = 'paid' ... WHERE client_id = ? AND invoice_id = 0
// runs anyway (src/extras.js:136-141). invoice_id = 0 is every job that was never invoiced. Any other action word
// ("open", or none at all) sets them all to 'done' the same way. The answer is 200 {"ok":false}, so nothing looks wrong.
// Run: node --test stress/owner/invoice-without-id-marks-every-job-paid.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './_setup.mjs';

test('one request with the id missing rewrites the whole job board and the month’s "paid" total', async () => {
  const T = await boot();
  const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
  const a = T.as(A.base);
  const add = async (name, title, amount) => (await a.post('/api/work', { action: 'add', name, title, amount })).json().job.id;
  const j1 = await add('Jo', 'Sink', '300'), j2 = await add('Kay', 'Tub', '700'), j3 = await add('Lu', 'Water heater', '1900');
  await a.post('/api/work', { action: 'stage', id: j2, stage: 'booked' });
  const stages = async () => (await T.all('SELECT name, stage FROM biz_jobs WHERE client_id = ?1 ORDER BY id', A.cid)).map(j => j.name + ':' + j.stage).join(' ');
  assert.equal(await stages(), 'Jo:new Kay:booked Lu:new');
  assert.equal((await a.state()).jobTotals.paidMonth, 0);

  const r = await a.post('/api/invoice', { action: 'paid' });   // what the page sends if the id is lost: {action:'paid', id:null}
  assert.ok(r.status === 200 || r.status === 400); assert.equal(r.json().ok, false, 'the answer says nothing was changed');
  const after = await stages(), paid = (await a.state()).jobTotals.paidMonth;
  assert.deepEqual({ jobs: after, paidThisMonth: paid }, { jobs: 'Jo:new Kay:booked Lu:new', paidThisMonth: 0 }, 'nothing should have moved');
});

test('and with any other word (or none) every job becomes "done"', async () => {
  const T = await boot();
  const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
  const a = T.as(A.base);
  for (const n of ['Jo', 'Kay']) await a.post('/api/work', { action: 'add', name: n, title: 'Job', amount: '100' });
  const r = await a.post('/api/invoice', {});
  const after = (await T.all('SELECT name, stage FROM biz_jobs WHERE client_id = ?1 ORDER BY id', A.cid)).map(j => j.name + ':' + j.stage).join(' ');
  assert.equal(after, 'Jo:new Kay:new', 'an empty request to /api/invoice (answered ' + r.status + ' ' + r.text + ') moved the jobs');
});
