// BUG (low, depends on who is given the sample link): the sample account ("Sample data. Everything on this screen is made
// up so you can see the app working") takes every action a paying owner's link takes. Its app opens and reads fine, but
// whoever holds the link can have Max phone any number from the sample line, switch that line off, rewrite what it tells
// callers, and ping Christopher. Only texting registration refuses the demo (src/a2p.js:332); /api/line, /api/message
// and the rest have no check for 'demo-plumbing' (src/app.js apiLine, apiMessage). The sample line is also the line the
// website's "Hear Max" recording is made from (src/hearmax.js SAMPLE_CLIENT).
// Run: node --test stress/owner/demo-account-takes-real-actions.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

const T = await boot();
const CODE = 'D'.repeat(32);
let d;
before(async () => {
  clock.set('2026-11-10T15:00:00Z');
  // HQ made the demo client once; the worker's own seed fills it (POST /ops/seed-demo with the key).
  await T.run("INSERT INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES ('demo-plumbing', ?1, 'demo-plumbing', 'Demo Plumbing', 'Sam', 0, '', '', '', 'Pro', 1, ?2, '', 'calls')", T.sha(CODE), new Date().toISOString());
  const seed = await T.site.call('/ops/seed-demo', { method: 'POST', headers: { 'x-key': T.env.LEADS_KEY } });
  assert.equal(seed.status, 200, seed.text);
  d = T.as('/app/' + CODE);
});
after(() => clock.restore());

test('the sample account opens: state, month, year, billing and help pages all answer', async () => {
  const st = await d.state();
  assert.equal(st.ok, true); assert.equal(st.sample, true); assert.ok(st.calls.length >= 20); assert.ok(st.line);
  for (const p of ['', '/month/now', '/year', '/billing', '/texting', '/help/forwarding', '/api/trends', '/api/pulse', '/api/inbox']) assert.equal((await d.get(p)).status, 200, p);
});

test('a visitor with the sample link has Max phone a number of their choosing and switches the sample line off', async () => {
  const call = await d.post('/api/line', { action: 'interview', phone: '404-555-0199' });
  const off = await d.post('/api/line', { onAir: false, by: 'visitor' });
  const pushes = T.world.pushes.length;
  await d.post('/api/message', { text: 'hello from a visitor' });
  const line = (await d.state()).line;
  assert.deepEqual({ callsPlaced: T.world.dialed.map(x => x.To), lineStillOn: line.onAir, pushesToChristopher: T.world.pushes.length - pushes },
    { callsPlaced: [], lineStillOn: true, pushesToChristopher: 0 }, 'the sample account answered: ' + call.text.slice(0, 80) + ' / ' + off.status);
});
