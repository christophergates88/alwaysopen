// Nov 24, 2026: past a line's 120-minute daily limit, callers get the voicemail (they used to hear "call back in an hour"
// and were hung up on, so a real customer on a rush day could leave nothing). The voicemail reaches the owner like any
// other; one that is plainly a robocall is filed as spam with no push, so a flood cannot buzz the owner's phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateKeyPairSync, createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const CB = await import('../src/callbacks.js');
const { setBrand } = await import('../src/sms.js');
const { default: worker } = await import('../src/index.js');
const LINE = '+14785551001', CODE = 'q'.repeat(32);
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const sidOf = n => 'CA' + String(n).padStart(32, '0');
const recOf = n => 'RE' + String(n).padStart(32, '0');

async function mk(heard) {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, { APNS_KEY: PEM, APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAM', AI: { run: async () => ({ text: heard }) } });
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, review_link, tier) VALUES ('c1', ?1, 'Quillen Plumbing', 1, '', 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO app_devices (token, client_id) VALUES ('tok1', 'c1')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, tz) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', '2026-10-01', 'America/New_York')").bind(LINE).run();
  // two long calls in the last half hour: 2 x 61 minutes, over the 120-minute limit, while well under the 80-call one
  const at = new Date(Date.now() - 1800e3).toISOString();
  for (let i = 0; i < 2; i++) await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, notified, hq_synced, test, relay_seconds, seconds) VALUES (?1, 'c1', ?2, ?3, ?4, 'done', 'new', 1, 0, 0, 3660, 3660)")
    .bind('CAlong' + i, LINE, at, '+147855520' + String(10 + i)).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const pushes = () => world.calls.filter(c => /push\.apple\.com\/3\/device\/tok1$/.test(c.url)).map(c => JSON.parse(c.body));
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, site, hook, pushes, row };
}
async function leaveVoicemail(w, n) {
  w.world.twRecs = { [sidOf(n)]: [{ sid: recOf(n), status: 'completed', duration: '15' }] };
  await w.hook('vm', { CallSid: sidOf(n), RecordingStatus: 'completed', RecordingSid: recOf(n), RecordingDuration: '15' });
  await w.site.settle();
}

test('past 120 minutes in a day, the next caller gets the voicemail, not "call back in an hour", and the owner gets the message', async () => {
  const w = await mk('Hi, this is Dana Reyes, my water heater is leaking. Please call me back at 478 555 0142.');
  const r = await w.hook('in', { CallSid: sidOf(41), To: LINE, From: '+14785550142' });
  assert.match(r.text, /<Record\b/, 'the voicemail');
  assert.match(r.text, /Thanks for calling Quillen Plumbing\. Please leave your name, your number and what you need after the tone/);
  assert.doesNotMatch(r.text, /call back in an hour|getting a lot of calls/);
  assert.equal((await w.row(sidOf(41))).outcome, 'limited');
  assert.ok(await w.DB.prepare("SELECT type FROM ops_alerts WHERE type LIKE 'line-cap:c1%'").first(), 'Chris is told');
  await leaveVoicemail(w, 41);
  const c = await w.row(sidOf(41));
  assert.equal(c.summary, 'They left a voicemail: Hi, this is Dana Reyes, my water heater is leaking. Please call me back at 478 555 0142.');
  const p = w.pushes().filter(x => x.call === sidOf(41));
  assert.equal(p.length, 1);
  assert.match(p[0].aps.alert.title, /^Voicemail from /);
  assert.deepEqual(w.world.twDeleted, [recOf(41)], 'and off Twilio');
});

test('a robocall that talks into the voicemail is filed as spam: no push, and its recording is still deleted', async () => {
  const w = await mk('This is a recorded message about your Google business listing. Press 1 now to speak to a specialist.');
  await w.hook('in', { CallSid: sidOf(42), To: LINE, From: '+12025550188' });
  await leaveVoicemail(w, 42);
  assert.equal((await w.row(sidOf(42))).outcome, 'spam');
  assert.equal(w.pushes().filter(x => x.call === sidOf(42)).length, 0, 'no push');
  assert.deepEqual(w.world.twDeleted, [recOf(42)]);
});

test('a customer who quotes a "press 1" text in the voicemail is not a robocall', async () => {
  const w = await mk('Hi, I got your text that said press 1 to confirm, but I need to reschedule my appointment. Call me back.');
  await w.hook('in', { CallSid: sidOf(43), To: LINE, From: '+14785550143' });
  await leaveVoicemail(w, 43);
  assert.equal((await w.row(sidOf(43))).outcome, 'limited');
  assert.equal(w.pushes().filter(x => x.call === sidOf(43)).length, 1);
});
