// The voicemail backup: a call that never reached Max (our server down, our code failing, Max cut off) still reaches
// the owner, with what the caller said. A caller who left nothing gets the missed-call text only while it is fresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const VM = await import('../src/voicemail.js');

const LINE = '+14785551001', OTHER = '+14785559999';
const sid = n => 'CA' + String(n).padStart(32, '0');
const rec = n => 'RE' + String(n).padStart(32, '0');
const when = t => new Date(t).toUTCString();   // Twilio's date format
const call = (n, o) => Object.assign({ sid: sid(n), direction: 'inbound', to: LINE, from: '+1478555' + String(n).padStart(4, '0'), status: 'completed', caller_name: '' }, o);

async function setup(transcripts) {
  const world = new H.World(), DB = H.makeDB();
  let last;   // one transcript per try: the turbo model first, the older model as its backup within the same try
  const env = H.makeEnv(world, DB, { AI: { run: async model => { if (/turbo/.test(model)) last = transcripts.shift(); if (last instanceof Error) throw last; return { text: last || '' }; } } });
  H.installFetch(world, env);
  await (await import('../src/sms.js')).setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Quillen Plumbing', 1)").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, updated) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', '2026-10-01')").bind(LINE).run();
  world.aiNote = { name: 'Dana Reyes', callback: '+14785550142', reason: 'Leaking water heater', details: 'Water pooling in the garage', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'Dana Reyes has a leaking water heater and wants a call back.' };
  return { world, DB, env };
}
const row = (DB, n) => DB.prepare('SELECT outcome, summary, details, caller, client_id FROM app_calls WHERE id = ?1').bind(sid(n)).first();

test('calls that missed Max during an outage reach the owner: the voicemail written up, hang-ups texted only while fresh', async () => {
  const NOW = Date.now();
  const { world, DB, env } = await setup(['Hi, this is Dana Reyes. My water heater is leaking into the garage. Please call me at 478 555 0142.']);
  const ago = m => when(NOW - m * 60e3);
  world.twCalls = [
    call(1, { start_time: ago(20), end_time: ago(19) }),                       // left a voicemail
    call(2, { start_time: ago(10), end_time: ago(9) }),                        // hung up at the greeting, a few minutes ago
    call(3, { start_time: ago(120), end_time: ago(119) }),                     // hung up two hours ago
    call(4, { start_time: ago(15), end_time: ago(12) }),                       // Max took this one: we already have it
    call(5, { direction: 'outbound-api', start_time: ago(15), end_time: ago(14) }),
    call(6, { to: OTHER, start_time: ago(15), end_time: ago(14) }),            // not one of our lines
    call(7, { start_time: ago(1.5), end_time: ago(0.5) })                       // still finishing
  ];
  world.twRecs = { [sid(1)]: [{ sid: rec(1), status: 'completed', duration: '34' }] };
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, test) VALUES (?1, 'c1', ?2, ?3, '+14785550004', 'done', 'new', 0)").bind(sid(4), LINE, new Date(NOW - 15 * 60e3).toISOString()).run();
  const pings = [];
  const r = await VM.vmSweep(env, NOW, { ping: async (t, b) => pings.push(t + ' | ' + b) });
  assert.deepEqual(r, { checked: 4, delivered: 3, retry: 0, appended: 0 });
  const a = await row(DB, 1);
  assert.equal(a.outcome, 'done'); assert.equal(a.client_id, 'c1');
  assert.equal(a.summary, 'Dana Reyes has a leaking water heater and wants a call back.');
  assert.equal((await row(DB, 2)).outcome, 'hangup');
  assert.equal((await row(DB, 3)).outcome, 'hangup');
  assert.deepEqual(world.texts.map(t => t.To), ['+14785550002'], 'the fresh hang-up gets the missed-call text; the two-hour-old one and the voicemail do not');
  assert.match(world.texts[0].Body, /^Sorry we missed you\. This is Quillen Plumbing\./);
  assert.deepEqual(world.twDeleted, [rec(1)], 'the recording is deleted once its words are saved');
  assert.equal(pings.length, 1);
  assert.match(pings[0], /^Always Open: 3 calls missed Max \| They reached the voicemail backup instead/);
  assert.equal(await row(DB, 7), null, 'too fresh: left for the next pass');
  // The next pass finds nothing new, and the call that was finishing goes out once it has settled.
  const again = await VM.vmSweep(env, NOW + 10 * 60e3, { ping: async () => {} });
  assert.equal(again.delivered, 1);
  assert.equal((await row(DB, 7)).outcome, 'hangup');
  assert.equal((await VM.vmSweep(env, NOW + 20 * 60e3, { ping: async () => {} })).delivered, 0);
});

test('a recording that cannot be read yet is tried again; after three tries the owner still hears about the call', async () => {
  const NOW = Date.now();
  const { world, DB, env } = await setup([new Error('speech-to-text is down'), new Error('still down'), new Error('down')]);
  world.twCalls = [call(11, { start_time: when(NOW - 20 * 60e3), end_time: when(NOW - 19 * 60e3) })];
  world.twRecs = { [sid(11)]: [{ sid: rec(11), status: 'completed', duration: '20' }] };
  const h = { ping: async () => {} };
  assert.deepEqual(await VM.vmSweep(env, NOW, h), { checked: 1, delivered: 0, retry: 1, appended: 0 });
  assert.equal(await row(DB, 11), null);
  assert.equal(await DB.prepare("SELECT v FROM vm_meta WHERE k = 'swept'").first(), null, 'the window does not move on while one waits for another try');
  assert.equal((await VM.vmSweep(env, NOW + 10 * 60e3, h)).retry, 1);
  const third = await VM.vmSweep(env, NOW + 20 * 60e3, h);
  assert.equal(third.delivered, 1);
  const r = await row(DB, 11);
  assert.equal(r.outcome, 'done', 'written up as a message, so the owner calls back');
  assert.deepEqual(world.twDeleted || [], [], 'kept in Twilio: nobody has heard it yet');
});

test('Max cut off mid-call: the voicemail that follows is added to the call and sent to the owner', async () => {
  const NOW = Date.now();
  const { world, DB, env } = await setup(['It is Rob again, the line dropped. Kitchen sink is backed up, any time after 3.']);
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, status, summary, details, test) VALUES (?1, 'c1', ?2, ?3, '+14785550021', 'Rob', 'failed', 'new', 'The phone line could not start this call. Call them back.', '', 0)")
    .bind(sid(21), LINE, new Date(NOW - 10 * 60e3).toISOString()).run();
  world.twRecs = { [sid(21)]: [{ sid: rec(21), status: 'completed', duration: '12' }] };
  world.twCalls = [];
  const r = await VM.vmSweep(env, NOW, { ping: async () => {} });
  assert.equal(r.appended, 1);
  const c = await row(DB, 21);
  assert.equal(c.summary, 'They left a voicemail: It is Rob again, the line dropped. Kitchen sink is backed up, any time after 3.');
  assert.match(c.details, /^Voicemail: It is Rob again/);
  assert.deepEqual(world.twDeleted, [rec(21)]);
  assert.equal((await VM.vmSweep(env, NOW + 10 * 60e3, { ping: async () => {} })).appended, 0, 'once');
});

test('Twilio’s recording note reaches the owner at once, and the call is not written up twice', async () => {
  const NOW = Date.now();
  const { world, DB, env } = await setup(['Hi, Dana Reyes, water heater leaking, call me back please.']);
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  world.twCalls = [call(31, { start_time: when(NOW - 3 * 60e3), end_time: when(NOW - 2 * 60e3) })];
  world.twRecs = { [sid(31)]: [{ sid: rec(31), status: 'completed', duration: '18' }] };
  const params = { CallSid: sid(31), RecordingSid: rec(31), RecordingStatus: 'completed', RecordingDuration: '18', AccountSid: env.TWILIO_ACCOUNT_SID };
  const href = 'https://alwaysopenoffice.com/voice/vm/' + env.VOICE_KEY;
  assert.equal((await site.call('/voice/vm/' + env.VOICE_KEY, { form: params })).status, 403, 'only Twilio, signed');
  const r = await site.call('/voice/vm/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  assert.equal(r.status, 204, r.text);
  assert.equal((await row(DB, 31)).summary, 'Dana Reyes has a leaking water heater and wants a call back.');
  assert.equal((await VM.vmSweep(env, NOW + 10 * 60e3, { ping: async () => {} })).delivered, 0, 'the sweep sees it is done');
});

test('a call our code fails to answer gets the voicemail, not "call back later"', async () => {
  const { world, DB, env } = await setup([]);
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  const params = { CallSid: sid(41), To: LINE, From: '+14785550041' };
  const href = 'https://alwaysopenoffice.com/voice/in/' + env.VOICE_KEY;
  // Break the database for this call only: the line lookup throws.
  const prep = DB.prepare.bind(DB);
  DB.prepare = sql => { if (/FROM voice_lines WHERE number/.test(sql)) throw new Error('D1 is having a moment'); return prep(sql); };
  try {
    const r = await site.call('/voice/in/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
    assert.equal(r.status, 200);
    assert.match(r.text, /Please leave your name, your number and what you need after the tone/);
    assert.match(r.text, /recordingStatusCallback="https:\/\/alwaysopenoffice\.com\/voice\/vm\//);
    assert.doesNotMatch(r.text, /call back in a few minutes/);
  } finally { DB.prepare = prep; }
  assert.ok(world.pushes.some(p => /max-call/.test(p.title)), 'Christopher still hears about it');
});
