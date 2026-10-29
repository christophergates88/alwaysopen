// The 4 AM test call, and Max's switch to the backup model when Claude keeps failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const D = await import('../src/drill.js');

const OWN = '+17064602226';
const AT4 = Date.parse('2026-10-30T08:00:00Z');   // 4 AM Eastern
async function setup() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts, updated) VALUES (?1, 'always-open', 'Always Open', 1, ?2, '2026-10-01')").bind(OWN, JSON.stringify({ testers: '+14785550188' })).run();
  return { world, DB, env };
}
const writeUp = (DB, from, at, o) => DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, transcript, summary, ai_model, test) VALUES (?1, 'always-open', ?2, ?3, ?4, ?5, ?6, ?7, 'claude-haiku-5-5', 1)")
  .bind('CA' + String(at).slice(-10).padStart(32, '0'), OWN, new Date(at).toISOString(), from, o.outcome || 'done', JSON.stringify(o.t || []), o.summary || '').run();

test('nothing runs, and nothing is bought, until Christopher says yes to the test number', async () => {
  const { world, env } = await setup();
  assert.deepEqual(await D.drillCron(env, AT4), { off: 'no test number yet' });
  assert.equal(world.bought.length, 0);
  assert.equal(world.dialed.length, 0);
  assert.equal(await D.drillLine(env, AT4), '', 'no line in the 7 AM push yet');
});

test('approved: one number bought and listed as a tester; at 4 AM Max is called, and a good write-up passes', async () => {
  const { world, DB, env } = await setup();
  await D.ensureDrill(env);
  await DB.prepare("INSERT INTO drill_meta (k, v) VALUES ('buy', 'approved')").run();
  assert.deepEqual(await D.drillCron(env, AT4 - 3600e3), { waiting: 'not the hour' }, '3 AM: bought, but no call yet');
  assert.equal(world.bought.length, 1);
  assert.match(world.bought[0].FriendlyName, /4 AM test caller/);
  assert.match(decodeURIComponent(world.bought[0].VoiceUrl), /<Reject\/>/, 'anyone calling the test number back is turned away');
  const from = (await DB.prepare("SELECT v FROM drill_meta WHERE k = 'from'").first()).v;
  assert.match(JSON.parse((await DB.prepare('SELECT facts FROM voice_lines WHERE number = ?1').bind(OWN).first()).facts).testers, new RegExp('\\+14785550188, \\' + from), 'its calls are tests: no lead, no push');
  assert.deepEqual(await D.drillCron(env, AT4), { placed: 'calling' });
  assert.equal(world.dialed.length, 1);
  assert.deepEqual([world.dialed[0].To, world.dialed[0].From], [OWN, from]);
  assert.match(world.dialed[0].Twiml, /plumbing company in Eatonton, and I would like the free audit/);
  assert.deepEqual(await D.drillCron(env, AT4 + 60e3), { status: 'calling' }, 'judged only after the call has had time to finish');
  await writeUp(DB, from, AT4 + 20e3, { t: [{ w: 'ai', t: 'Always Open, this is Max.' }, { w: 'caller', t: 'I run a plumbing company and want the audit.' }, { w: 'ai', t: 'Happy to help. What is the business called?' }], summary: 'A plumbing company owner in Eatonton wants the free audit and a call back tomorrow morning.' });
  const r = await D.drillCron(env, AT4 + 5 * 60e3);
  assert.match(r.passed, /^Max answered, heard the caller, replied 1 time and wrote it up \(claude-haiku-5-5\)$/);
  assert.equal(await D.drillLine(env, AT4 + 3 * 3600e3), 'The 4 AM test call passed.');
  assert.deepEqual(await D.drillCron(env, AT4 + 20 * 60e3), { status: 'passed' }, 'once a night');
  assert.equal(world.bought.length, 1, 'bought once');
});

test('a failure is tried once more, and a second failure is an alert and shows at 7 AM', async () => {
  const { world, DB, env } = await setup();
  await D.ensureDrill(env);
  await DB.prepare("INSERT INTO drill_meta (k, v) VALUES ('from', '+14785551999')").run();
  const alerts = [];
  const h = { alert: async (t, d) => alerts.push(t + ' | ' + d) };
  await D.drillCron(env, AT4, h);
  assert.match((await D.drillCron(env, AT4 + 5 * 60e3, h)).retry, /never reached Max/);
  assert.deepEqual(await D.drillCron(env, AT4 + 10 * 60e3, h), { status: 'retry' }, 'waits 15 minutes');
  assert.deepEqual(await D.drillCron(env, AT4 + 21 * 60e3, h), { placed: 'calling' });
  assert.equal(world.dialed.length, 2);
  await writeUp(DB, '+14785551999', AT4 + 22 * 60e3, { t: [{ w: 'ai', t: 'Always Open, this is Max.' }], summary: 'They hung up.' , outcome: 'hangup' });
  const r = await D.drillCron(env, AT4 + 27 * 60e3, h);
  assert.equal(r.failed, 'Max answered but heard nothing the caller said');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^drill \| The 4 AM test call to Max failed twice: Max answered but heard nothing the caller said\. Real callers still reach Max or the voicemail backup/);
  assert.equal(await D.drillLine(env, AT4 + 3 * 3600e3), 'The 4 AM test call failed: Max answered but heard nothing the caller said.');
});

test('judging the write-up', async () => {
  const { DB, env } = await setup();
  const F = '+14785551999';
  assert.match((await D.judge(env, F, OWN, AT4)).why, /never reached Max/);
  await writeUp(DB, F, AT4 + 1000, { t: [{ w: 'ai', t: 'Hi' }, { w: 'caller', t: 'audit please' }], summary: 'x' });
  assert.match((await D.judge(env, F, OWN, AT4)).why, /never answered/);
  await writeUp(DB, F, AT4 + 2000, { t: [{ w: 'ai', t: 'Hi' }, { w: 'caller', t: 'audit please' }, { w: 'ai', t: 'Sure' }], summary: 'Someone called about lawn care.' });
  assert.match((await D.judge(env, F, OWN, AT4)).why, /write-up missed what the caller wanted/);
});

test('Max’s backup switch: on, every turn goes to the backup model without trying Claude; off, back to Claude', async () => {
  const world = new H.World(), DB = H.makeDB();
  const seen = [];
  const env = H.makeEnv(world, DB, { AI: { run: async (model, input) => { seen.push(model); return { response: 'Backup here.' }; } } });
  H.installFetch(world, env);
  const V = await import('../src/voice.js');
  await V.setBackup(env, true);
  let r = await V.brain(env, 'You are a test.', [{ role: 'user', content: 'Hi' }], null, 20);
  assert.equal(r.text, 'Backup here.');
  assert.equal(world.calls.filter(c => c.url.includes('anthropic')).length, 0, 'Claude not tried at all');
  await V.setBackup(env, false);
  r = await V.brain(env, 'You are a test.', [{ role: 'user', content: 'Hi' }], null, 20);
  assert.equal(world.calls.filter(c => c.url.includes('anthropic')).length, 1, 'back on Claude');
});

test('/ops/test-call: only with the key; it records the yes, and the next run buys the number', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  assert.equal((await site.call('/ops/test-call', { method: 'POST', headers: { 'x-key': 'nope' } })).status, 403);
  const r = await site.call('/ops/test-call', { method: 'POST', headers: { 'x-key': env.LEADS_KEY } });
  assert.match(r.json().status, /^approved/);
  assert.equal((await DB.prepare("SELECT v FROM drill_meta WHERE k = 'buy'").first()).v, 'approved');
});
