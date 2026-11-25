// A voicemail that cannot be written out is kept for the owner to hear (14 days), not left on Twilio for good.
// Nov 24, 2026 (second pass): any size, and nothing of a caller's voicemail is left on Twilio. See also swarm-vmail-twilio.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const VM = await import('../src/voicemail.js');

const LINE = '+14785551001', CODE = 'v'.repeat(32);
const sid = n => 'CA' + String(n).padStart(32, '0');
const rec = n => 'RE' + String(n).padStart(32, '0');
const when = t => new Date(t).toUTCString();
const call = (n, o) => Object.assign({ sid: sid(n), direction: 'inbound', to: LINE, from: '+1478555' + String(n).padStart(4, '0'), status: 'completed', caller_name: '' }, o);
const SAID = 'They left a voicemail we could not write out. Listen to it here.';

async function setup() {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, { AI: { run: async () => { throw new Error('speech-to-text is down'); } } });
  H.installFetch(world, env);
  await (await import('../src/sms.js')).setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats) VALUES ('c1', ?1, 'Quillen Plumbing', 1, 'Pro', 'calls')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, updated) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', '2026-10-01')").bind(LINE).run();
  world.aiNote = { name: 'Dana Reyes', callback: '+14785550142', reason: 'Voicemail', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'A paraphrase the owner should not see.' };
  const { default: worker } = await import('../src/index.js');
  return { world, DB, env, site: H.makeClient(worker, env) };
}
async function threeTries(env, world, n, NOW, h) {
  world.twCalls = [call(n, { start_time: when(NOW - 20 * 60e3), end_time: when(NOW - 19 * 60e3) })];
  world.twRecs = { [sid(n)]: [{ sid: rec(n), status: 'completed', duration: '20' }] };
  h = Object.assign({ ping: async () => {} }, h || {});
  await VM.vmSweep(env, NOW, h); await VM.vmSweep(env, NOW + 10 * 60e3, h);
  return VM.vmSweep(env, NOW + 20 * 60e3, h);
}
const vmRows = DB => DB.prepare("SELECT id, client_id, mime, kind, created, length(data) AS n FROM line_audio WHERE kind = 'voicemail'").all().then(r => r.results || []);

test('after three failed tries the audio is kept for the owner, linked, and deleted from Twilio', async () => {
  const NOW = Date.now();
  const { world, DB, env, site } = await setup();
  const third = await threeTries(env, world, 11, NOW);
  assert.equal(third.delivered, 1);
  const rows = await vmRows(DB);
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^[A-Za-z0-9]{32}$/);
  assert.equal(rows[0].client_id, 'c1'); assert.equal(rows[0].mime, 'audio/mpeg'); assert.equal(rows[0].n, 4);
  assert.ok(rows[0].created);
  assert.deepEqual(world.twDeleted, [rec(11)], 'Twilio’s copy is gone');
  const c = await DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid(11)).first();
  assert.equal(c.summary, SAID);
  const st = (await site.call('/app/' + CODE + '/api/state')).json();
  const mine = st.calls.find(x => x.id === sid(11));
  assert.equal(mine.listen, 'https://alwaysopenoffice.com/a/' + rows[0].id);
  const got = await site.call('/a/' + rows[0].id);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('cache-control'), 'private, no-store');
  assert.equal(got.headers.get('x-robots-tag'), 'noindex');
  assert.equal(got.headers.get('content-type'), 'audio/mpeg');
  const page = await site.call('/app/' + CODE);
  assert.match(page.text, /Listen to the voicemail/);
});

test('the daily sweep deletes voicemail audio after 14 days and leaves greeting audio alone; the link then says so', async () => {
  const NOW = Date.now();
  const { world, DB, env, site } = await setup();
  await threeTries(env, world, 13, NOW);
  const [v] = await vmRows(DB);
  await DB.prepare("INSERT INTO line_audio (id, client_id, mime, data, created) VALUES ('g'||substr(?1,2), 'c1', 'audio/wav', ?2, ?3)").bind(v.id, new Uint8Array(9000), new Date(NOW - 40 * 86400e3).toISOString()).run();
  const gid = 'g' + v.id.slice(1);
  await VM.vmSweep(env, NOW + 13 * 86400e3, { ping: async () => {} });
  assert.equal((await site.call('/a/' + v.id)).status, 200, 'still kept at 13 days');
  await VM.vmSweep(env, NOW + 15 * 86400e3, { ping: async () => {} });
  const gone = await site.call('/a/' + v.id);
  assert.equal(gone.status, 410);
  assert.equal(gone.text, 'This voicemail is no longer kept.');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM line_audio WHERE id = ?1').bind(gid).first()).n, 1, 'greeting row untouched');
  assert.equal((await site.call('/a/' + gid)).status, 200);
  const st = (await site.call('/app/' + CODE + '/api/state')).json();
  assert.equal(st.calls.find(x => x.id === sid(13)).listen, '', 'no Listen button once deleted');
  assert.equal((await site.call('/a/' + 'Z'.repeat(32))).status, 404);
});

test('a greeting upload and its playback still work as before', async () => {
  const { site } = await setup();
  const wav = new Uint8Array(8044); wav.set(new TextEncoder().encode('RIFF'), 0); wav.set(new TextEncoder().encode('WAVE'), 8);
  const up = await site.call('/app/' + CODE + '/api/greeting-audio', { body: wav, headers: { 'content-type': 'audio/wav' } });
  assert.equal(up.status, 200, up.text);
  const got = await site.call(up.json().line.greetingAudio.replace('https://alwaysopenoffice.com', ''));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(got.headers.get('x-robots-tag'), null);
});
