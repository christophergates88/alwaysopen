// Nov 24, 2026 (fix-drill): the transfer test call. The 4 AM test number calls Always Open's own line, presses 0, and the
// line puts it through to the test number itself, which for the test answers as a robot owner (presses 1) or as a
// voicemail box. Runs the real worker on the rehearsal harness with Twilio faked; nothing here touches the internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const D = await import('../src/drill.js');
const CB = await import('../src/callbacks.js');
const { default: worker } = await import('../src/index.js');

const OWN = '+17064602226', TEST = '+14785550199', OTHER = '+14785550188';
const PN = 'PN' + '7'.repeat(32);
const sidOf = n => 'CA' + String(n).padStart(32, '0');
// a zone where it is the middle of the night now, so the "no transfers after hours" rule would block the test
function zoneWhere(want) {
  for (let off = -11; off <= 12; off++) { const h = (new Date().getUTCHours() + off + 24) % 24; if (want(h)) return off === 0 ? 'Etc/GMT' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
  throw new Error('no zone');
}
const NIGHT_TZ = zoneWhere(h => h >= 1 && h <= 4);

async function mk(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  // the parts of Twilio the harness does not fake: finding the test number, and setting what it answers with
  const voiceUrls = [], base = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input.url || String(input)), method = (init && init.method) || 'GET';
    const js = (b, st) => new Response(JSON.stringify(b), { status: st || 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.twilio.com/') && /\/IncomingPhoneNumbers\.json\?PhoneNumber=/.test(url) && method === 'GET') {
      world.calls.push({ method, url, body: '' });
      return js({ incoming_phone_numbers: decodeURIComponent(url.split('PhoneNumber=')[1]) === TEST ? [{ sid: PN, phone_number: TEST }] : [] });
    }
    const m = url.match(/^https:\/\/api\.twilio\.com\/.*\/IncomingPhoneNumbers\/(PN[0-9a-f]{32})\.json$/);
    if (m && method === 'POST') { voiceUrls.push(Object.assign({ pn: m[1] }, Object.fromEntries(new URLSearchParams(String(init.body))))); return js({ sid: m[1] }); }
    return base(input, init);
  };
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts, updated, tz) VALUES (?1, 'always-open', 'Always Open', 1, ?2, '2026-10-01', ?3)")
    .bind(OWN, JSON.stringify({ testers: OTHER }), o.tz || NIGHT_TZ).run();
  await D.ensureDrill(env);
  if (o.from !== '') await DB.prepare("INSERT INTO drill_meta (k, v) VALUES ('from', ?1)").bind(o.from || TEST).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params, query) => {
    const q = query ? '?' + query : '', href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const ops = (body, method) => site.call('/ops/test-call', { method: method || 'POST', headers: Object.assign({ 'x-key': env.LEADS_KEY }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  // The line's side of the test call: it rings in, Max answers, the caller presses 0, the relay ends for the transfer.
  const ringAndPress0 = async (sid, from) => {
    const r = await hook('in', { CallSid: sid, To: OWN, From: from });
    assert.match(r.text, /<ConversationRelay/);
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'dtmf', digit: '0' }));
    const said = x.ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
    const real = Date.now; Date.now = () => real() + 15000; try { await x.room.alarm(); } finally { Date.now = real; }
    const end = x.ws.sent.find(m => m.type === 'end');
    await x.room.webSocketClose(x.ws, 1000);
    const after = await hook('after', { CallSid: sid, HandoffData: (end && end.handoffData) || '{}', SessionStatus: 'ended', SessionDuration: '14' });
    return { said, end, after };
  };
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, site, hook, ops, ringAndPress0, row, voiceUrls };
}

test('press 1: the robot owner answers, the screen stores the 1, the call reads as put through, the judge says ok and the test number turns callers away again', async () => {
  const w = await mk();
  const run = await w.ops({ run: 'transfer' });
  assert.equal(run.status, 200);
  assert.equal(run.json().ok, true); assert.equal(run.json().placed, true);
  assert.match(run.json().sid, /^CA[0-9a-f]{32}$/);
  assert.equal(w.voiceUrls.length, 1, 'the test number now answers as the robot owner');
  assert.deepEqual([w.voiceUrls[0].pn, w.voiceUrls[0].VoiceUrl, w.voiceUrls[0].VoiceMethod], [PN, D.ROBOT.transfer, 'GET']);
  assert.match(decodeURIComponent(D.ROBOT.transfer), /<Pause length="4"\/><Play digits="1"\/><Pause length="5"\/><Play digits="1"\/><Pause length="20"\/><Hangup\/>/);
  assert.equal(w.world.dialed.length, 1);
  const call = w.world.dialed[0];
  assert.deepEqual([call.From, call.To, call.Twiml, call.TimeLimit], [TEST, OWN, D.SCRIPT_TRANSFER, '150']);
  assert.match(call.Twiml, /<Play digits="0"\/>/, 'the caller presses 0: the put-through that does not depend on the model');

  // the line's side: after hours on that line, and still put through for this one call
  const S = sidOf(901);
  const { said, end, after } = await w.ringAndPress0(S, TEST);
  assert.match(said, /One moment, let me try to reach someone for you/);
  assert.equal(JSON.parse(end.handoffData).reason, 'transfer');
  assert.match(after.text, /<Dial timeout="20" action="https:\/\/alwaysopenoffice\.com\/voice\/dial\/[^"]+" callerId="\+17064602226"><Number url="([^"]+)">\+14785550199<\/Number><\/Dial>/);
  const wurl = after.text.match(/<Number url="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const wp = { CallSid: 'CA' + 'f'.repeat(32), From: OWN, To: TEST };
  const wh = await w.site.call(wurl.replace('https://alwaysopenoffice.com', ''), { form: wp, headers: { 'x-twilio-signature': H.twilioSign(w.env.TWILIO_AUTH_TOKEN, wurl, wp) } });
  assert.match(wh.text, /<Gather numDigits="1"[^>]*>.*Press 1 to take this call/);
  const sc = await w.hook('screen', { CallSid: 'CA' + 'f'.repeat(32), Digits: '1' }, 'c=' + S);
  assert.match(sc.text, /Connecting you now/);
  const dl = await w.hook('dial', { CallSid: S, DialCallStatus: 'completed', DialCallDuration: '25' });
  assert.match(dl.text, /<Hangup\/>/);
  assert.equal((await w.row(S)).outcome, 'transferred');
  assert.ok(await w.DB.prepare('SELECT 1 AS x FROM dial_taken WHERE sid = ?1').bind(S).first());

  const j = await w.ops({ judge: 1 });
  assert.equal(j.json().ok, true, j.json().why);
  assert.equal(j.json().kind, 'transfer');
  assert.equal(j.json().pressed, true);
  assert.equal(j.json().outcome, 'transferred');
  assert.equal(j.json().call, S);
  assert.match(j.json().why, /robot owner pressed 1/);
  assert.equal(w.voiceUrls.at(-1).VoiceUrl, D.REJECT, 'the test number turns callers away again');
  assert.match(decodeURIComponent(w.voiceUrls.at(-1).VoiceUrl), /<Reject\/>/);
  assert.equal(await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'transfer-test'").first(), null, 'the marker is gone');
  const stored = JSON.parse((await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'transfer-result'").first()).v);
  for (const k of ['kind', 'at', 'sid', 'ok', 'why', 'outcome', 'pressed', 'promise']) assert.ok(k in stored, k);
  assert.equal(stored.sid, run.json().sid);
  const lg = await w.DB.prepare("SELECT detail FROM voice_log WHERE kind = 'transfer-test'").all();
  assert.equal(lg.results.length, 1); assert.deepEqual(JSON.parse(lg.results[0].detail), stored);
  const g = await w.ops(null, 'GET');
  assert.deepEqual(g.json().result, stored);
  // and the marker gone, the same number is a plain tester again: 0 gets no transfer
  const S2 = sidOf(902), again = await w.ringAndPress0(S2, TEST);
  assert.doesNotMatch(again.said, /One moment/);
  assert.equal(JSON.parse(again.end ? again.end.handoffData : '{"reason":"none"}').reason === 'transfer', false);
  assert.doesNotMatch(again.after.text, /<Dial/);
});

test('voicemail: nothing pressed, so not put through; the caller hears the missed-transfer line, and the 10-minute job judges it and puts the number back', async () => {
  const w = await mk();
  const run = await w.ops({ run: 'transfer-vm' });
  assert.equal(run.json().placed, true);
  assert.equal(w.voiceUrls[0].VoiceUrl, D.ROBOT['transfer-vm']);
  assert.match(decodeURIComponent(D.ROBOT['transfer-vm']), /You have reached the voicemail box\. Please leave a message after the tone\.<\/Say><Pause length="25"\/><Hangup\/>/);
  const S = sidOf(903);
  const { after } = await w.ringAndPress0(S, TEST);
  assert.match(after.text, /<Number url="[^"]+">\+14785550199<\/Number>/);
  // the voicemail box "answered": the screen's Gather got nothing, its leg hung up, and Twilio says the dial completed
  const sc = await w.hook('screen', { CallSid: 'CA' + 'e'.repeat(32), Digits: '' }, 'c=' + S);
  assert.match(sc.text, /<Hangup\/>/);
  const dl = await w.hook('dial', { CallSid: S, DialCallStatus: 'completed', DialCallDuration: '12' });
  assert.match(dl.text, /<Say>They could not pick up right now, but they have your message as urgent and will call you back as soon as they can\. Goodbye\.<\/Say><Hangup\/>/);
  const r = await w.row(S);
  assert.notEqual(r.outcome, 'transferred');
  assert.equal(r.callback, TEST, 'the write-up keeps the number to call back');
  // not judged yet at 2 minutes, judged at the first run after 3.5 minutes
  const meta = JSON.parse((await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'transfer-test'").first()).v);
  await D.drillCron(w.env, meta.at + 2 * 60e3);
  assert.equal(w.voiceUrls.length, 1, 'still answering as the robot');
  await D.drillCron(w.env, meta.at + 4 * 60e3);
  const res = await D.transferResult(w.env);
  assert.equal(res.ok, true, res.why);
  assert.equal(res.kind, 'transfer-vm');
  assert.equal(res.pressed, false);
  assert.match(res.promise.said, /will call you back/);
  assert.equal(res.promise.callback, TEST);
  assert.equal(res.dial, 'completed');
  assert.equal(w.voiceUrls.at(-1).VoiceUrl, D.REJECT);
  assert.equal(await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'transfer-test'").first(), null);
  // a second judge just answers the stored result
  assert.equal((await w.ops({ judge: 1 })).json().ok, false, 'nothing left to judge: no marker');
});

test('the judge in plain words when it went wrong', async () => {
  const w = await mk();
  await w.ops({ run: 'transfer' });
  // the robot answered but its 1 never reached the screen
  const S = sidOf(904);
  await w.ringAndPress0(S, TEST);
  await w.hook('dial', { CallSid: S, DialCallStatus: 'completed', DialCallDuration: '30' });
  const j = (await w.ops({ judge: 1 })).json();
  assert.equal(j.ok, false);
  assert.match(j.why, /robot owner answered, but the call screen never got its 1 \(Twilio said completed\)/);
  assert.equal(w.voiceUrls.at(-1).VoiceUrl, D.REJECT);
  // nobody ever called the line
  const w2 = await mk();
  await w2.ops({ run: 'transfer-vm' });
  const j2 = (await w2.ops({ judge: 1 })).json();
  assert.equal(j2.ok, false); assert.match(j2.why, /never reached Max/);
});

test('the hook does nothing for any other call: another number, the test number with no marker, an expired one, another line', async () => {
  const w = await mk();
  const own = await w.DB.prepare('SELECT * FROM voice_lines WHERE number = ?1').bind(OWN).first();
  assert.equal(await V.drillTransferTo(w.env, own, TEST), '', 'no marker');
  const put = m => w.DB.prepare("INSERT OR REPLACE INTO drill_meta (k, v) VALUES ('transfer-test', ?1)").bind(JSON.stringify(m)).run();
  await put({ kind: 'transfer', to: TEST, until: Date.now() - 1000 });
  assert.equal(await V.drillTransferTo(w.env, own, TEST), '', 'expired');
  await put({ kind: 'transfer', to: TEST, until: Date.now() + 6 * 60e3 });
  assert.equal(await V.drillTransferTo(w.env, own, TEST), TEST, 'the test call itself');
  assert.equal(await V.drillTransferTo(w.env, own, OTHER), '', 'another tester');
  assert.equal(await V.drillTransferTo(w.env, own, '+14045550123'), '', 'a real caller');
  assert.equal(await V.drillTransferTo(w.env, Object.assign({}, own, { client_id: 'c1' }), TEST), '', 'another line');
  // end to end, marker set: another tester presses 0 and is not put through
  const S = sidOf(905), r = await w.ringAndPress0(S, OTHER);
  assert.doesNotMatch(r.said, /One moment/);
  assert.match(r.said, /cannot connect you right now/);
  assert.doesNotMatch(r.after.text, /<Dial/);
  // the test number while the marker is expired
  await put({ kind: 'transfer', to: TEST, until: Date.now() - 1 });
  const r2 = await w.ringAndPress0(sidOf(906), TEST);
  assert.doesNotMatch(r2.said, /One moment/);
  assert.doesNotMatch(r2.after.text, /<Dial/);
  // a marker for some other number does not open the test number either
  await put({ kind: 'transfer', to: OTHER, until: Date.now() + 6 * 60e3 });
  assert.equal(await V.drillTransferTo(w.env, own, TEST), '');
  assert.equal(await V.drillTransferTo(w.env, own, OTHER), '', 'and not the other number: it is not the test number');
});

test('/ops/test-call: 403 without the key; no test number yet is said plainly; an empty POST still approves the 4 AM test call', async () => {
  const w = await mk({ from: '' });
  for (const m of ['POST', 'GET']) assert.equal((await w.site.call('/ops/test-call', { method: m, headers: { 'x-key': 'nope' } })).status, 403, m);
  assert.equal((await w.site.call('/ops/test-call', { method: 'POST' })).status, 403);
  const r = await w.ops({ run: 'transfer' });
  assert.equal(r.json().ok, false);
  assert.match(r.json().error, /Turn on the 4 AM test call first/);
  assert.equal(w.world.dialed.length, 0);
  assert.equal(await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'buy'").first(), null, 'asking for a transfer test is not a yes to buying a number');
  assert.equal((await w.ops(null, 'GET')).json().result, null);
  const e = await w.site.call('/ops/test-call', { method: 'POST', headers: { 'x-key': w.env.LEADS_KEY } });
  assert.match(e.json().status, /^approved/);
});

test('a test number Twilio cannot find: no call is placed and nothing is left set', async () => {
  const w = await mk({ from: '+14785550177' });
  const r = (await w.ops({ run: 'transfer' })).json();
  assert.equal(r.placed, false); assert.match(r.error, /did not find the test number/);
  assert.equal(w.world.dialed.length, 0); assert.equal(w.voiceUrls.length, 0);
  assert.equal(await w.DB.prepare("SELECT v FROM drill_meta WHERE k = 'transfer-test'").first(), null);
});
