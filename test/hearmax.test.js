// Hear Max: only the armed number, only once, within 30 minutes, gets recorded, and Max answers it as the demo line;
// every other call to the same line is untouched. The saved sample is served with byte ranges for iPhones, and the site
// shows no player when there is none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const HM = await import('../src/hearmax.js');
const { boardToken } = await import('../src/opsboard.js');
const site = H.makeClient(worker, env);
const OWN = '+17064602226', DEMO = '+14785550100', CHRIS = '+14785550188';
await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('always-open', 'h0', 'Always Open', 1), ('demo-plumbing', 'h1', 'Demo Plumbing Co.', 1)").run();
await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, updated) VALUES (?1, 'always-open', 'Always Open', 1, '', '2026-10-01'), (?2, 'demo-plumbing', 'Demo Plumbing Co.', 1, 'plumbing', '2026-10-01')").bind(OWN, DEMO).run();
let n = 0;
const sidOf = () => 'CA' + String(++n).padStart(32, '0');
function hook(params) {
  const href = 'https://alwaysopenoffice.com/voice/in/' + env.VOICE_KEY;
  return site.call('/voice/in/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
}

test('before anyone arms it: a call to our line is answered as Always Open and never recorded', async () => {
  const r = await hook({ CallSid: sidOf(), To: OWN, From: CHRIS });
  assert.equal(r.status, 200);
  assert.ok(!/<Recording/.test(r.text)); assert.match(r.text, /<ConversationRelay/);
  const j = await site.call('/hear-max.json');
  assert.equal(j.status, 404, 'no sample, so the site shows no player');
});

test('armed from the ops board page: only that number, once, answered as the demo line, recorded, marked a test', async () => {
  const tok = await boardToken(env);
  const bad = await site.call('/ops/hear-max?t=nope');
  assert.equal(bad.status, 403);
  const page = await site.call('/ops/hear-max?t=' + tok, { form: { from: '(478) 555-0188', lang: 'en' } });
  assert.match(page.text, /Ready\. Call now from \+14785550188/);
  const other = await hook({ CallSid: sidOf(), To: OWN, From: '+14785550999' });
  assert.ok(!/<Recording/.test(other.text), 'a different caller in the window is not recorded');
  const sid = sidOf();
  const r = await hook({ CallSid: sid, To: OWN, From: CHRIS });
  assert.match(r.text, /^<\?xml[^>]*\?><Response><Start><Recording channels="mono" recordingStatusCallback="https:\/\/alwaysopenoffice\.com\/voice\/recorded\/voice-key-rehearsal" recordingStatusCallbackEvent="completed"\/><\/Start>/);
  assert.match(r.text, /Demo Plumbing/, 'Max answers as the demo line');
  const row = await DB.prepare('SELECT client_id, number, test FROM app_calls WHERE id = ?1').bind(sid).first();
  assert.deepEqual(row, { client_id: 'demo-plumbing', number: DEMO, test: 1 });
  const again = await hook({ CallSid: sidOf(), To: OWN, From: CHRIS });
  assert.ok(!/<Recording/.test(again.text), 'one call only');

  // Twilio says the recording is done: we fetch the MP3, keep it, delete Twilio's copy, and push.
  const mp3 = new Uint8Array(6000).map((_, i) => i % 251);
  const before = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url); seen.push(((init && init.method) || 'GET') + ' ' + u);
    if (u.endsWith('/Recordings/RE' + 'f'.repeat(32) + '.mp3')) return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
    if (u.includes('/Recordings/RE') && init && init.method === 'DELETE') return new Response(null, { status: 204 });
    return before(url, init);
  };
  try {
    await DB.prepare("UPDATE app_calls SET transcript = ?1 WHERE id = ?2").bind(JSON.stringify([{ w: 'ai', t: 'Thanks for calling Demo Plumbing Co.' }, { w: 'caller', t: 'My water heater is leaking.' }]), sid).run();
    const form = { RecordingSid: 'RE' + 'f'.repeat(32), RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC' + 'a'.repeat(32) + '/Recordings/RE' + 'f'.repeat(32), RecordingStatus: 'completed', RecordingDuration: '24', CallSid: sid };
    const wrong = await site.call('/voice/recorded/wrong-key', { form });
    assert.equal(wrong.status, 404);
    const ok = await site.call('/voice/recorded/' + env.VOICE_KEY, { form });
    assert.equal(ok.status, 200);
  } finally { globalThis.fetch = before; }
  assert.ok(seen.some(s => /^DELETE .*\/Recordings\/RE/.test(s)), 'Twilio’s copy is deleted');
  assert.ok(world.pushes.some(p => /Hear Max sample saved, 24 seconds/.test(p.title)));
  const j = (await site.call('/hear-max.json')).json();
  assert.equal(j.ok, true); assert.equal(j.seconds, 24); assert.match(j.caption, /^Our demo plumbing line, \w+day at \d{1,2}:\d{2} [AP]M$/);
  assert.deepEqual(j.lines, [{ who: 'Max', t: 'Thanks for calling Demo Plumbing Co.' }, { who: 'Caller', t: 'My water heater is leaking.' }]);
  const full = await site.call(j.src.split('?')[0]);
  assert.equal(full.status, 200);
  const req = new Request('https://alwaysopenoffice.com/hear-max.mp3', { headers: { range: 'bytes=0-1' } });
  const part = await HM.serveAudio(env, req, 'en');
  assert.equal(part.status, 206, 'Safari’s first ask gets a partial answer');
  assert.equal(part.headers.get('content-range'), 'bytes 0-1/6000');
  assert.equal((await part.arrayBuffer()).byteLength, 2);
  const tail = await HM.serveAudio(env, new Request('https://x/', { headers: { range: 'bytes=5990-' } }), 'en');
  assert.equal(tail.headers.get('content-range'), 'bytes 5990-5999/6000');
  const off = await HM.serveAudio(env, new Request('https://x/', { headers: { range: 'bytes=7000-' } }), 'en');
  assert.equal(off.status, 416);
});

test('a call too short to use is not kept, and the page says why; taking it down hides the player', async () => {
  const tok = await boardToken(env);
  await site.call('/ops/hear-max?t=' + tok, { form: { from: CHRIS, lang: 'en' } });
  const sid = sidOf();
  await hook({ CallSid: sid, To: OWN, From: CHRIS });
  const r = await HM.recordedHook(env, new URLSearchParams({ RecordingSid: 'RE' + 'e'.repeat(32), RecordingUrl: 'https://api.twilio.com/x/RE' + 'e'.repeat(32), RecordingStatus: 'completed', RecordingDuration: '4', CallSid: sid }), {});
  assert.deepEqual(r, { ok: false, why: 'too short' });
  const page = await site.call('/ops/hear-max?t=' + tok);
  assert.match(page.text, /too short to use/);
  assert.match(page.text, /Live on the site: 24 seconds/, 'the earlier good one is still live');
  // The site plays only the part picked: from the hard question on, with the caption Christopher wrote.
  const set = await site.call('/ops/hear-max?t=' + tok, { form: { action: 'clip', lang: 'en', start: '9', end: '0', caption: 'Mike’s Plumbing, a made-up business' } });
  assert.match(set.text, /Live on the site: 15 seconds, starting 9 seconds in/);
  const w = (await site.call('/hear-max.json')).json();
  assert.equal(w.from, 9); assert.equal(w.to, 24); assert.equal(w.seconds, 15); assert.equal(w.caption, 'Mike’s Plumbing, a made-up business');
  assert.deepEqual(HM.clipOf({ seconds: 24, start_at: 40, end_at: 0 }), { from: 19, to: 24 }, 'a start past the end still leaves five seconds');
  assert.deepEqual(HM.clipOf({ seconds: 60, start_at: 10, end_at: 12 }), { from: 10, to: 60 }, 'an end too close to the start plays to the end');
  await site.call('/ops/hear-max?t=' + tok, { form: { action: 'remove', lang: 'en' } });
  assert.equal((await site.call('/hear-max.json')).status, 404);
});

test('the home page and a trade page carry the player slot, hidden until there is a sample', async () => {
  for (const p of ['/', '/plumbing']) {
    const r = await site.call(p);
    assert.match(r.text, /<div data-hearmax id="hear" hidden><\/div>/, p);
    assert.match(r.text, /<script src="\/hear-max\.js" defer><\/script>/, p);
  }
});
