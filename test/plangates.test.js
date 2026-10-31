// What each plan gets matches what the site sells, and "Closed today" reaches Max as well as us.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const APP = await import('../src/app.js');
const V = await import('../src/voice.js');
const { default: worker } = await import('../src/index.js');
const sha = s => createHash('sha256').update(s).digest('hex');

test('Starter: no invoice reminders, past-customer reminders, missed-call text-back or check-ins; Pro has them', () => {
  const st = APP.features({ tier: 'Starter', regulated: 0, feats: 'calls' });
  assert.equal(st.invoices, false); assert.equal(st.past, false); assert.equal(st.textback, false); assert.equal(st.jobs, false);
  const pro = APP.features({ tier: 'Pro', regulated: 0, feats: 'calls' });
  assert.equal(pro.invoices, true); assert.equal(pro.past, true); assert.equal(pro.textback, true); assert.equal(pro.jobs, true);
});

test('the app refuses Pro-only actions for a Starter owner, and its state hides check-ins and hand-offs without a line', async () => {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const CODE = 'S'.repeat(30);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active, feats) VALUES ('s1', ?1, 's1-ref', 'Starter Co', 'Starter', 'Sam', 1, 'calls')").bind(sha(CODE)).run();
  const site = H.makeClient(worker, env);
  const inv = await site.call('/app/' + CODE + '/api/invoice', { json: { action: 'add', name: 'Joe', amount: '100', due: '2026-11-10' } });
  assert.equal(inv.status, 403);
  const imp = await site.call('/app/' + CODE + '/api/import', { json: { csv: 'name,phone\nJoe,4785550100' } });
  assert.equal(imp.status, 403);
  const st = (await site.call('/app/' + CODE + '/api/state')).json();
  assert.equal(st.handoff, null);
  assert.equal(st.checkins, null);
  assert.equal(st.features.invoices, false);
  assert.equal(st.past, undefined);
});

test('Closed today: Max says so first until the end of the owner\'s day, then goes back to the regular hours', () => {
  const until = new Date(Date.now() + 3600e3).toISOString();
  const line = { owner_set: JSON.stringify({ closed: { until, why: 'family event' } }), facts: JSON.stringify({ hours: 'Mon to Fri 8 to 5' }) };
  const v = V.lineView(line);
  assert.match(v.hours, /^CLOSED TODAY \(family event\); take a message/);
  assert.match(v.hours, /Regular hours: Mon to Fri 8 to 5$/);
  const past = { owner_set: JSON.stringify({ closed: { until: new Date(Date.now() - 1000).toISOString() } }), facts: JSON.stringify({ hours: 'Mon to Fri 8 to 5' }) };
  assert.equal(V.lineView(past).hours, 'Mon to Fri 8 to 5');
});

test('the Closed today message sets it on the line, and Open after all clears it', async () => {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const CODE = 'C'.repeat(30);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active, feats) VALUES ('k1', ?1, 'k1-ref', 'Closed Co', 'Pro', 'Kim', 1, 'calls')").bind(sha(CODE)).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, updated, owner_set) VALUES ('+14785550123', 'k1', 'Closed Co', 1, '2026-10-01', '{}')").run();
  const site = H.makeClient(worker, env);
  const until = new Date(Date.now() + 5 * 3600e3).toISOString();
  const r = await site.call('/app/' + CODE + '/api/message', { json: { kind: 'hours', text: 'Closed today.', by: 'Kim', closedUntil: until, why: 'sick' } });
  assert.equal(r.status, 200, r.text);
  const l1 = await DB.prepare("SELECT owner_set FROM voice_lines WHERE client_id = 'k1'").first();
  assert.equal(JSON.parse(l1.owner_set).closed.why, 'sick');
  const st = (await site.call('/app/' + CODE + '/api/state')).json();
  assert.ok(st.line.closedUntil, 'the app shows it');
  await site.call('/app/' + CODE + '/api/message', { json: { kind: 'hours', text: 'Open after all today.', by: 'Kim', reopen: true } });
  const l2 = await DB.prepare("SELECT owner_set FROM voice_lines WHERE client_id = 'k1'").first();
  assert.equal(JSON.parse(l2.owner_set).closed, undefined);
});
