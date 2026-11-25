// Nov 24, 2026: nothing of a caller's voicemail stays on Twilio. A recording of any size is moved into our own storage
// when its words cannot be written out; one Twilio will not hand over waits and is tried again until it comes (the owner
// is told it is on its way), and at 14 days Twilio's copy is deleted whatever happened; a delete Twilio refuses is tried
// again until it goes; a recording that finishes after its call was written up still reaches the owner; and once a day
// Twilio's own list of recordings is checked, so nothing slips past.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const VM = await import('../src/voicemail.js');
const PA = await import('../src/plainalerts.js');
const { default: worker } = await import('../src/index.js');

const LINE = '+14785551001', OTHER = '+14785559999', CODE = 'v'.repeat(32);
const sid = n => 'CA' + String(n).padStart(32, '0');
const rec = n => 'RE' + String(n).padStart(32, '0');
const when = t => new Date(t).toUTCString();
const call = (n, o) => Object.assign({ sid: sid(n), direction: 'inbound', to: LINE, from: '+1478555' + String(n).padStart(4, '0'), status: 'completed', caller_name: '' }, o);
const COULD_NOT = 'They left a voicemail we could not write out. Listen to it here.';
const ON_ITS_WAY = 'They left a voicemail we could not write out. The recording is still coming in and will be here to listen to. Call them back.';
const NO_PLAY = 'They left a voicemail that could not be played back. Call them back.';
const SAID = 'Hi, this is Dana Reyes. My water heater is leaking. Please call me back.';
const MIN = 60e3, DAY = 86400e3;

async function setup(hears) {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, { AI: { run: async () => { if (!hears) throw new Error('speech-to-text is down'); return { text: SAID }; } } });
  H.installFetch(world, env);
  await (await import('../src/sms.js')).setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats) VALUES ('c1', ?1, 'Quillen Plumbing', 1, 'Pro', 'calls')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, updated) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', '2026-10-01')").bind(LINE).run();
  world.aiNote = { name: 'Dana Reyes', callback: '+14785550142', reason: 'Voicemail', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'Dana Reyes has a leaking water heater.' };
  const pushes = [];
  const h = { ping: async () => {}, app: { pushClient: async (e, cid, p) => { pushes.push(Object.assign({ cid }, p)); }, opsPing: async () => {} } };
  return { world, DB, env, h, pushes, site: H.makeClient(worker, env) };
}
// the call leaves a voicemail and the sweep runs three times, ten minutes apart (the words fail each time when !hears)
async function threeTries(env, world, n, NOW, h) {
  world.twCalls = [call(n, { start_time: when(NOW - 20 * MIN), end_time: when(NOW - 19 * MIN) })];
  world.twRecs = { [sid(n)]: [{ sid: rec(n), status: 'completed', duration: '20' }] };
  await VM.vmSweep(env, NOW, h); await VM.vmSweep(env, NOW + 10 * MIN, h);
  return VM.vmSweep(env, NOW + 20 * MIN, h);
}
const card = (DB, n) => DB.prepare('SELECT summary, outcome FROM app_calls WHERE id = ?1').bind(sid(n)).first();
const dueRows = DB => DB.prepare('SELECT * FROM vm_due').all().then(r => r.results || []);
const audioRow = (DB, n) => DB.prepare("SELECT id, created, bytes, parts, length(data) AS first FROM line_audio WHERE kind = 'voicemail' AND call_id = ?1").bind(sid(n)).first();
const listen = async (site, n) => ((await site.call('/app/' + CODE + '/api/state')).json().calls.find(x => x.id === sid(n)) || {}).listen;
async function raw(env, path, headers, method) {
  const res = await worker.fetch(new Request('https://alwaysopenoffice.com' + path, { method: method || 'GET', headers: Object.assign({ 'cf-connecting-ip': '203.0.113.7' }, headers || {}) }), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}
// a recording handed over in uneven pieces, as the network does
const pattern = n => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 7 + (i >> 11)) % 251; return b; };
const streamOf = (bytes, piece) => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += piece) c.enqueue(bytes.slice(i, i + piece)); c.close(); } });

test('any size: a 3.5 MB voicemail is kept whole, plays whole and by byte range (as iPhones ask), and leaves Twilio', async () => {
  const NOW = Date.now();
  const { world, DB, env, h, site } = await setup(false);
  const big = pattern(3500000);
  world.twAudio = () => streamOf(big, 333333);
  await threeTries(env, world, 11, NOW, h);
  const a = await audioRow(DB, 11);
  assert.ok(a, 'kept');
  assert.equal(a.bytes, 3500000); assert.equal(a.parts, 4); assert.equal(a.first, 1000000);
  const parts = (await DB.prepare('SELECT n, length(data) AS len FROM line_audio_parts WHERE id = ?1 ORDER BY n').bind(a.id).all()).results;
  assert.deepEqual(parts.map(p => [p.n, p.len]), [[1, 1000000], [2, 1000000], [3, 500000]]);
  assert.deepEqual(world.twDeleted, [rec(11)], 'Twilio’s copy is gone');
  assert.equal((await card(DB, 11)).summary, COULD_NOT);
  assert.equal(await listen(site, 11), 'https://alwaysopenoffice.com/a/' + a.id);
  const whole = await raw(env, '/a/' + a.id);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), '3500000');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('content-type'), 'audio/mpeg');
  assert.equal(whole.headers.get('cache-control'), 'private, no-store');
  assert.equal(Buffer.compare(Buffer.from(whole.bytes), Buffer.from(big)), 0, 'every byte, in order');
  const probe = await raw(env, '/a/' + a.id, { range: 'bytes=0-1' });
  assert.equal(probe.status, 206); assert.equal(probe.headers.get('content-range'), 'bytes 0-1/3500000'); assert.deepEqual([...probe.bytes], [...big.slice(0, 2)]);
  const across = await raw(env, '/a/' + a.id, { range: 'bytes=999998-2000003' });
  assert.equal(across.status, 206); assert.equal(across.headers.get('content-length'), '1000006');
  assert.equal(Buffer.compare(Buffer.from(across.bytes), Buffer.from(big.slice(999998, 2000004))), 0, 'a range across rows');
  const tail = await raw(env, '/a/' + a.id, { range: 'bytes=-5' });
  assert.equal(tail.status, 206); assert.deepEqual([...tail.bytes], [...big.slice(-5)]);
  const open = await raw(env, '/a/' + a.id, { range: 'bytes=3499990-' });
  assert.equal(open.status, 206); assert.equal(open.bytes.length, 10);
  const past = await raw(env, '/a/' + a.id, { range: 'bytes=3500000-' });
  assert.equal(past.status, 416); assert.equal(past.headers.get('content-range'), 'bytes */3500000');
  const head = await raw(env, '/a/' + a.id, {}, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '3500000'); assert.equal(head.bytes.length, 0);
});

test('a recording longer than we keep (over 24 MB, though ours stop at 3 minutes): the first 24 MB is kept, and Twilio’s copy still goes', async () => {
  const NOW = Date.now();
  const { world, DB, env, h } = await setup(false);
  const huge = pattern(25000500);
  world.twAudio = () => streamOf(huge, 1048576);
  await threeTries(env, world, 12, NOW, h);
  const a = await audioRow(DB, 12);
  assert.equal(a.bytes, 24000000); assert.equal(a.parts, 24);
  assert.deepEqual(world.twDeleted, [rec(12)]);
  const log = await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'voicemail-audio' AND detail LIKE '%longer than we keep%'").first();
  assert.ok(log && log.detail.includes(sid(12)));
  const mid = await raw(env, '/a/' + a.id, { range: 'bytes=23999995-23999999' });
  assert.equal(mid.status, 206); assert.deepEqual([...mid.bytes], [...huge.slice(23999995, 24000000)]);
});

test('Twilio will not hand the audio over: the owner is told it is coming, it is tried again, and when it comes they get it and Twilio’s copy goes', async () => {
  const NOW = Date.now();
  const { world, DB, env, h, pushes, site } = await setup(false);
  world.fail.recording = true;
  await threeTries(env, world, 13, NOW, h);
  assert.equal((await card(DB, 13)).summary, ON_ITS_WAY);
  assert.equal(await listen(site, 13), '', 'nothing to play yet');
  let d = await dueRows(DB);
  assert.equal(d.length, 1); assert.equal(d[0].want, 'keep'); assert.equal(d[0].rec_sid, rec(13));
  assert.deepEqual(world.twDeleted || [], [], 'kept on Twilio only while we wait for it');
  await VM.vmSweep(env, NOW + 30 * MIN, h);   // still refused
  d = await dueRows(DB);
  assert.equal(d.length, 1); assert.equal(d[0].tries, 1);
  world.fail.recording = false;
  await VM.vmSweep(env, NOW + 45 * MIN, h);
  assert.deepEqual(await dueRows(DB), []);
  assert.deepEqual(world.twDeleted, [rec(13)]);
  assert.equal((await card(DB, 13)).summary, COULD_NOT);
  const a = await audioRow(DB, 13);
  assert.equal(await listen(site, 13), 'https://alwaysopenoffice.com/a/' + a.id);
  assert.equal(a.created, new Date(Date.parse(when(NOW - 20 * MIN))).toISOString(), 'the 14 days count from the voicemail, not from when its audio came in');
  const told = pushes.filter(p => p.call === sid(13));
  assert.equal(told.length, 1);
  assert.equal(told[0].aps.alert.body, 'The recording is ready. Tap to listen.');
});

test('never handed over: at 14 days Twilio’s copy is deleted anyway and the card says so', async () => {
  const NOW = Date.now();
  const { world, DB, env, h } = await setup(false);
  world.fail.recording = true;
  await threeTries(env, world, 14, NOW, h);
  await VM.vmSweep(env, NOW + 13 * DAY, h);
  assert.deepEqual(world.twDeleted || [], [], 'still trying at 13 days');
  await VM.vmSweep(env, NOW + 14 * DAY, h);
  assert.deepEqual(world.twDeleted, [rec(14)]);
  assert.deepEqual(await dueRows(DB), []);
  assert.equal((await card(DB, 14)).summary, NO_PLAY);
});

test('Twilio refuses the delete: it is tried again until it goes, and Christopher is told if it keeps refusing', async () => {
  const NOW = Date.now();
  const { world, DB, env, h, site } = await setup(false);
  world.fail.recordingDelete = true;
  await threeTries(env, world, 15, NOW, h);
  assert.ok(await audioRow(DB, 15), 'the owner has the audio');
  assert.match(await listen(site, 15), /^https:\/\/alwaysopenoffice\.com\/a\//);
  let d = await dueRows(DB);
  assert.equal(d.length, 1); assert.equal(d[0].want, 'delete');
  for (let i = 1; i <= 12; i++) await VM.vmSweep(env, NOW + 20 * MIN + i * 61 * MIN, h);
  assert.equal((await dueRows(DB))[0].tries, 12);
  const alert = await DB.prepare("SELECT type FROM ops_alerts WHERE type = 'voicemail-stuck'").first();
  assert.ok(alert, 'an alert after twelve refusals');
  const x = PA.explainAlert('voicemail-stuck', 'detail');
  assert.match(String(Array.isArray(x) ? x[0] : (x && (x.title || x[0]))), /Twilio is refusing to delete a voicemail recording/);
  world.fail.recordingDelete = false;
  await VM.vmSweep(env, NOW + 20 * MIN + 13 * 61 * MIN, h);
  assert.deepEqual(world.twDeleted, [rec(15)]);
  assert.deepEqual(await dueRows(DB), []);
});

test('a recording that finishes after its call was written up still reaches the owner, and leaves Twilio', async () => {
  const NOW = Date.now();
  const { world, DB, env, h, pushes } = await setup(true);
  world.twCalls = [call(16, { start_time: when(NOW - 10 * MIN), end_time: when(NOW - 9 * MIN) })];
  world.twRecs = {};   // the recording is not finished when the sweep looks
  await VM.vmSweep(env, NOW, h);
  assert.equal((await card(DB, 16)).outcome, 'hangup');
  world.twRecs = { [sid(16)]: [{ sid: rec(16), status: 'completed', duration: '12' }] };
  const form = new URLSearchParams({ CallSid: sid(16), RecordingStatus: 'completed', RecordingSid: rec(16) });
  assert.equal(await VM.voicemailHook(env, form, h), 'late');
  assert.equal((await card(DB, 16)).summary, 'They left a voicemail: ' + SAID);
  assert.deepEqual(world.twDeleted, [rec(16)]);
  assert.deepEqual(await dueRows(DB), []);
  assert.equal(pushes.filter(p => p.call === sid(16)).length, 1);
  assert.equal(await VM.voicemailHook(env, form, h), 'already', 'Twilio’s second note changes nothing');
});

test('once a day Twilio’s own list is checked: leftovers deleted, unheard voicemails delivered, anything not a customer’s voicemail left alone', async () => {
  const NOW = Date.now();
  const { world, DB, env, h, pushes } = await setup(true);
  const at = t => new Date(t).toISOString();
  const row = (n, outcome, t, test) => DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, test, summary) VALUES (?1, 'c1', ?2, ?3, '+14785550100', ?4, 'new', ?5, 'Max took this call.')").bind(sid(n), LINE, at(t), outcome, test ? 1 : 0).run();
  const r = (n, t, o) => [Object.assign({ sid: rec(n), status: 'completed', duration: '20', date_created: when(t) }, o || {})];
  await VM.ensureVoicemail(env);
  await row(21, 'done', NOW - 3 * DAY);
  await DB.prepare("INSERT INTO vm_seen (call_sid, at, status, tries, rec_sid, note) VALUES (?1, ?2, 'done', 0, ?3, 'voicemail')").bind(sid(21), at(NOW - 3 * DAY), rec(21)).run();
  await row(22, 'failed', NOW - 2 * DAY);
  await row(25, 'done', NOW - 1 * DAY, true);
  await row(26, 'failed', NOW - 30 * MIN);
  await row(27, 'done', NOW - 5 * 3600e3);
  await row(28, 'done', NOW - 5 * 3600e3);
  world.twCalls = [
    call(23, { start_time: when(NOW - 3 * DAY), end_time: when(NOW - 3 * DAY + MIN) }),   // never reached us: we were down longer than the sweep looks back
    call(24, { to: OTHER, start_time: when(NOW - 2 * DAY), end_time: when(NOW - 2 * DAY + MIN) })   // not one of our lines
  ];
  world.twRecs = {
    [sid(21)]: r(21, NOW - 3 * DAY),                                 // its words were saved; the delete never happened
    [sid(22)]: r(22, NOW - 2 * DAY),                                 // a voicemail after a failed call that nobody wrote out
    [sid(23)]: r(23, NOW - 3 * DAY),
    [sid(24)]: r(24, NOW - 2 * DAY),
    [sid(25)]: r(25, NOW - 1 * DAY),                                 // a test call: its own code looks after it
    [sid(26)]: r(26, NOW - 30 * MIN),                                // fresh: the ordinary steps have it
    [sid(27)]: r(27, NOW - 5 * 3600e3, { duration: '1' }),           // a click
    [sid(28)]: r(28, NOW - 5 * 3600e3, { status: 'processing' })     // still being made
  };
  await VM.vmSweep(env, NOW, h);
  // 26 is fresh, so the daily check leaves it, and the sweep's ordinary pass delivers it the same minute
  assert.deepEqual([...(world.twDeleted || [])].sort(), [rec(21), rec(22), rec(23), rec(26), rec(27)].sort());
  assert.equal((await card(DB, 26)).summary, 'They left a voicemail: ' + SAID);
  assert.equal((await card(DB, 22)).summary, 'They left a voicemail: ' + SAID);
  assert.equal(pushes.filter(p => p.call === sid(22)).length, 1);
  const c23 = await card(DB, 23);
  assert.ok(c23 && c23.outcome !== 'live', 'the call from the long outage is written up');
  assert.equal((await DB.prepare('SELECT status FROM vm_seen WHERE call_sid = ?1').bind(sid(24)).first()).status, 'skipped');
  assert.equal((await card(DB, 21)).summary, 'Max took this call.', 'a finished call is not written up again');
  assert.deepEqual(await dueRows(DB), []);
  // the check runs once a day
  world.twRecs[sid(29)] = r(29, NOW - 4 * 3600e3, { duration: '1' });
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, test) VALUES (?1, 'c1', ?2, ?3, '', 'done', 'new', 0)").bind(sid(29), LINE, at(NOW - 4 * 3600e3)).run();
  await VM.vmSweep(env, NOW + 3600e3, h);
  assert.ok(!(world.twDeleted || []).includes(rec(29)), 'not again within the day');
  await VM.vmSweep(env, NOW + DAY + MIN, h);
  assert.ok(world.twDeleted.includes(rec(29)), 'the next day it is');
  assert.ok(!world.twDeleted.includes(rec(24)) && !world.twDeleted.includes(rec(25)) && !world.twDeleted.includes(rec(28)));
});

test('the daily sweep clears parts of a recording that never finished storing, but not one being stored right now', async () => {
  const NOW = Date.now();
  const { DB, env, h } = await setup(false);
  await VM.ensureVoicemail(env);
  await DB.prepare("INSERT INTO line_audio_parts (id, n, data, at) VALUES (?1, 1, ?2, ?3)").bind('o'.repeat(32), new Uint8Array(10), NOW - 2 * 3600e3).run();
  await DB.prepare("INSERT INTO line_audio_parts (id, n, data, at) VALUES (?1, 1, ?2, ?3)").bind('p'.repeat(32), new Uint8Array(10), Date.now()).run();
  await VM.vmSweep(env, NOW, h);
  const left = (await DB.prepare('SELECT id FROM line_audio_parts').all()).results.map(r => r.id);
  assert.deepEqual(left, ['p'.repeat(32)]);
});
