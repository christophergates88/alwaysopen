// More calls from Max, to the owner or to customers who already agreed: who gets one, who does not, and the one set of rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const OC = await import('../src/outcalls.js');
const CB = await import('../src/callbacks.js');

const LINE = '+14785551001', tz = 'America/New_York';
async function setup(opts = {}) {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, phone, regulated, owner_first) VALUES ('c1', 'h1', 'Quillen Plumbing', 1, 'Pro', '4785550100', ?1, 'Pat')").bind(opts.regulated ? 1 : 0).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, regulated, updated) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', ?2, '2026-10-01')").bind(LINE, opts.regulated ? 1 : 0).run();
  await OC.ensureOutcalls(env);
  return { world, DB, env };
}
// 11 AM on a weekday in the business's zone, so calling hours are open
const NOW = CB.fromLocal(tz, '2026-10-28', 11, 0);
const fu = (DB, o) => DB.prepare("INSERT INTO app_followups (client_id, kind, name, phone, amount, due, note, consent, status, created, by, hq_synced, appt_at) VALUES ('c1', ?1, ?2, ?3, '', '', ?4, ?5, 'open', ?6, 'Pat', 0, ?7)").bind(o.kind, o.name || 'Linda Park', '+14785550142', o.note || '', o.consent ? 1 : 0, o.created || new Date(NOW - 864e5).toISOString(), o.appt || '').run();
const dials = world => world.calls.filter(c => /Calls\.json/.test(c.url));

test('confirmation call goes only to a customer who already agreed, the day before', async () => {
  const { world, DB, env } = await setup();
  await fu(DB, { kind: 'appointment', consent: true, appt: new Date(NOW + 22 * 3600e3).toISOString() });
  await fu(DB, { kind: 'appointment', consent: false, name: 'No Consent', appt: new Date(NOW + 22 * 3600e3).toISOString() });
  const r = await OC.outCallsCron(env, NOW);
  assert.equal(r.queued, 1); assert.equal(r.calls, 1);
  assert.equal(dials(world).length, 1);
  assert.match(dials(world)[0].body, /voice%2Foc%2F|voice\/oc\//);
  const row = await DB.prepare('SELECT * FROM outcalls').first();
  assert.equal(row.kind, 'confirm'); assert.match(row.topic, /tomorrow/);
  // the next tick never calls them again
  await OC.outCallsCron(env, NOW + 10 * 60e3);
  assert.equal(dials(world).length, 1);
});

test('regulated businesses get no calls out of any kind', async () => {
  const { world, DB, env } = await setup({ regulated: true });
  await fu(DB, { kind: 'appointment', consent: true, appt: new Date(NOW + 22 * 3600e3).toISOString() });
  await OC.outCallsCron(env, NOW);
  assert.equal(dials(world).length, 0);
  assert.equal(await OC.ringOwner(env, 'c1', 'CA1', 'leak'), false);
});

test('a customer who said stop is not called, and nothing goes out after 9 PM', async () => {
  const { world, DB, env } = await setup();
  await fu(DB, { kind: 'appointment', consent: true, appt: new Date(CB.fromLocal(tz, '2026-10-29', 9, 0)).toISOString() });
  await DB.prepare("INSERT INTO call_optout (client_id, phone10, at) VALUES ('c1', '4785550142', 'x')").run();
  await OC.outCallsCron(env, CB.fromLocal(tz, '2026-10-28', 14, 0));
  assert.equal(dials(world).length, 0);
  const s2 = await setup();
  await fu(s2.DB, { kind: 'appointment', consent: true, appt: new Date(CB.fromLocal(tz, '2026-10-29', 9, 0)).toISOString() });
  const late = CB.fromLocal(tz, '2026-10-28', 21, 30);
  await OC.outCallsCron(s2.env, late - 3 * 3600e3 + 3 * 3600e3);
  assert.equal(dials(s2.world).length, 0);
});

test('missed visit is offered a new time; estimate and due-for-service calls stay off until turned on', async () => {
  const { world, DB, env } = await setup();
  await fu(DB, { kind: 'appointment', consent: true, appt: new Date(NOW - 3 * 3600e3).toISOString() });
  await fu(DB, { kind: 'quote', consent: true, note: 'new water heater', created: new Date(NOW - 4 * 864e5).toISOString() });
  let r = await OC.outCallsCron(env, NOW);
  assert.equal(r.calls, 1, 'only the missed visit: estimates are off by default');
  assert.equal((await DB.prepare('SELECT kind FROM outcalls').first()).kind, 'noshow');
  await DB.prepare("INSERT INTO outcall_prefs (client_id, k, on_) VALUES ('c1', 'quote', 1)").run();
  r = await OC.outCallsCron(env, NOW + 10 * 60e3);
  assert.equal(r.calls, 1);
  assert.deepEqual((await DB.prepare('SELECT kind FROM outcalls ORDER BY id').all()).results.map(x => x.kind), ['noshow', 'quote']);
});

test('an urgent call rings the owner once, at any hour, and not when switched off', async () => {
  const { world, DB, env } = await setup();
  assert.equal(await OC.ringOwner(env, 'c1', 'CA9', 'pipe burst'), true);
  assert.equal(await OC.ringOwner(env, 'c1', 'CA9', 'pipe burst'), false, 'one ring per call');
  assert.equal(dials(world).length, 1);
  await DB.prepare("INSERT INTO outcall_prefs (client_id, k, on_) VALUES ('c1', 'urgent', 0)").run();
  assert.equal(await OC.ringOwner(env, 'c1', 'CA10', 'flooding'), false);
});

test('answers: 1 confirms, 2 asks the owner to call, 9 stops all calls', async () => {
  const { DB, env } = await setup();
  const id = await OC.queue(env, { client_id: 'c1', kind: 'confirm', phone: '4785550142', name: 'Linda', topic: 'Your appointment is tomorrow at 9 AM', ref: 'confirm:1' });
  const g = d => OC.outcallGather(env, new URL('https://x/voice/ocg/k?id=' + id), new URLSearchParams({ Digits: d }));
  assert.match(await (await g('1')).text(), /you are confirmed/);
  assert.equal((await DB.prepare('SELECT status FROM outcalls WHERE id = ?1').bind(id).first()).status, 'yes');
  const id2 = await OC.queue(env, { client_id: 'c1', kind: 'confirm', phone: '4785550143', name: 'Sam', topic: 'x', ref: 'confirm:2' });
  const r2 = await OC.outcallGather(env, new URL('https://x/voice/ocg/k?id=' + id2), new URLSearchParams({ Digits: '2' }));
  assert.match(await r2.text(), /better time/);
  assert.ok(await DB.prepare("SELECT 1 AS x FROM callbacks WHERE client_id = 'c1' AND phone = '+14785550143'").first());
  const id3 = await OC.queue(env, { client_id: 'c1', kind: 'quote', phone: '4785550144', name: 'Al', topic: 'x', ref: 'quote:3' });
  await OC.outcallGather(env, new URL('https://x/voice/ocg/k?id=' + id3), new URLSearchParams({ Digits: '9' }));
  assert.ok(await DB.prepare("SELECT 1 AS x FROM call_optout WHERE client_id = 'c1' AND phone10 = '4785550144'").first());
});
