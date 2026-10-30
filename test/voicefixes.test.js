// Fixes to Max's calls, check-ins and call-backs found in review (one test or more per fix, numbered as in the review).
// Runs the real worker code on the rehearsal harness (test/rehearsal/harness.js): D1 on SQLite, Twilio, Claude and the
// phone pushes faked. Nothing here touches the internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateKeyPairSync, createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const CB = await import('../src/callbacks.js');
const CI = await import('../src/checkin.js');
const VM = await import('../src/voicemail.js');
const { setBrand } = await import('../src/sms.js');
const { default: worker } = await import('../src/index.js');

const LINE = '+14785551001', CELL = '+14785557777', CODE = 'q'.repeat(32);
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const sidOf = n => 'CA' + String(n).padStart(32, '0');
const ago = (now, m) => new Date(now - m * 60e3).toUTCString();
// A fixed zone where it is now `want(hour)` (Etc/GMT-5 is five hours ahead of UTC), so tests about quiet hours and call
// windows do not depend on when they run.
function zoneWhere(want) {
  for (let off = -11; off <= 12; off++) { const h = (new Date().getUTCHours() + off + 24) % 24; if (want(h)) return off === 0 ? 'Etc/GMT' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
  throw new Error('no zone');
}
const DAY_TZ = zoneWhere(h => h >= 11 && h <= 16), NIGHT_TZ = zoneWhere(h => h >= 1 && h <= 4);

async function mk(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, Object.assign({ APNS_KEY: PEM, APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAM' }, o.env || {}));
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, review_link) VALUES ('c1', ?1, 'Quillen Plumbing', ?2, ?3)")
    .bind(createHash('sha256').update(CODE).digest('hex'), o.active === 0 ? 0 : 1, o.review || '').run();
  await DB.prepare("INSERT INTO app_devices (token, client_id) VALUES ('tok1', 'c1')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, transfer_to, transfer_when, updated, owner_set, tz) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', ?2, ?3, '2026-10-01', ?4, ?5)")
    .bind(LINE, o.transferTo === undefined ? CELL : o.transferTo, o.when || 'asked', JSON.stringify(o.ownerSet || {}), o.tz === undefined ? DAY_TZ : o.tz).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params, query) => {
    const q = query ? '?' + query : '', href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    const r = await hook('in', { CallSid: sid, To: LINE, From: from });
    if (!/<ConversationRelay/.test(r.text)) return { twiml: r.text };
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return Object.assign(x, { twiml: r.text });
  };
  const send = (x, m) => x.room.webSocketMessage(x.ws, JSON.stringify(m));
  const say = (x, words) => send(x, { type: 'prompt', voicePrompt: words, last: true });
  const said = x => x.ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
  const pushes = () => world.calls.filter(c => /push\.apple\.com\/3\/device\/tok1$/.test(c.url)).map(c => JSON.parse(c.body));
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  // Let the call's "end" go out (the alarm after its end time), then Twilio closes the socket.
  const endCall = async x => { const real = Date.now; Date.now = () => real() + 15000; try { await x.room.alarm(); } finally { Date.now = real; } await x.room.webSocketClose(x.ws, 1000); };
  return { world, DB, env, site, hook, room, send, say, said, pushes, row, endCall };
}
// The harness unrefs every setTimeout; a test that waits only on Max's own timers needs something keeping Node awake.
async function awake(fn) { const k = setInterval(() => {}, 1000); try { return await fn(); } finally { clearInterval(k); } }
const extraOf = world => { const sys = world.aiSeen.at(-1).system; return sys.length > 1 ? sys[sys.length - 1].text : ''; };
async function withClock(t, fn) { const real = Date.now; Date.now = () => t; try { return await fn(); } finally { Date.now = real; } }

// ---------- 1. a paused line ----------
test('1. a call to a line the owner paused rings through to them and is never written up as a hang-up', async () => {
  const w = await mk({ ownerSet: { off: true } });
  const r = await w.hook('in', { CallSid: sidOf(1), To: LINE, From: '+14785550002' });
  assert.match(r.text, /<Dial timeout="25"[^>]*><Number>\+14785557777<\/Number><\/Dial>/, 'rings through to the owner');
  assert.equal(await w.row(sidOf(1)), null, 'not a Max call');
  assert.equal((await w.DB.prepare('SELECT status FROM vm_seen WHERE call_sid = ?1').bind(sidOf(1)).first()).status, 'skipped');
  // The owner talked to them; the sweep runs later. A second paused-time call that was never noted (from before this
  // fix) is skipped too, because the line is paused.
  const NOW = Date.now();
  w.world.twCalls = [sidOf(1), sidOf(2)].map(sid => ({ sid, direction: 'inbound', to: LINE, from: '+14785550002', status: 'completed', caller_name: '', start_time: ago(NOW, 9), end_time: ago(NOW, 5) }));
  const pings = [];
  const out = await VM.vmSweep(w.env, NOW, { ping: async t => pings.push(t) });
  assert.equal(out.delivered || 0, 0);
  assert.equal(await w.row(sidOf(2)), null);
  assert.deepEqual(w.world.texts, [], 'no "Sorry we missed you"');
  assert.deepEqual(pings, []);
  assert.deepEqual(w.pushes(), [], 'no "hung up" push');
});

// ---------- 2. transfers written up after the dial ----------
test('2. a caller put through to the owner is written up after the dial: no hang-up note, no text, no call-back promise', async () => {
  const w = await mk({ when: 'asked' });
  w.world.aiNote = { name: 'Lee', callback: '+14785550170', reason: 'Burst pipe', details: '', when: '', urgent: true, callback_wanted: true, callback_at: '', booked: 'yes', spam: false, summary: 'Lee has a burst pipe and asked for a call back.' };
  w.world.aiScript = ['Let me try to reach him for you now, one moment. [TRANSFER]'];
  const sid = sidOf(20), x = await w.room(sid, '+14785550170');
  await w.say(x, 'Pipe burst. Can he call me back, or can I talk to him now?');
  assert.equal((await x.room.load()).transfer, true);
  await w.endCall(x);
  assert.equal(x.ws.sent.at(-1).type, 'end');
  assert.equal(JSON.parse(x.ws.sent.at(-1).handoffData).reason, 'transfer');
  assert.equal((await w.row(sid)).outcome, 'live', 'the socket closing as the dial starts is not the end of the call');
  const tw = await w.hook('after', { CallSid: sid, HandoffData: JSON.stringify({ reason: 'transfer' }), SessionStatus: 'ended', SessionDuration: '30' });
  assert.match(tw.text, /<Dial timeout="20" action="[^"]*\/voice\/dial\//);
  let r = await w.row(sid);
  assert.equal(r.outcome, 'live'); assert.equal(r.transferred, 2, 'marked as being put through');
  // Twilio's status callback during the dial changes nothing; the stuck-call cron leaves it alone too.
  await w.hook('status', { CallSid: sid, CallStatus: 'in-progress' });
  await w.DB.prepare('UPDATE app_calls SET at = ?1 WHERE id = ?2').bind(new Date(Date.now() - 30 * 60e3).toISOString(), sid).run();
  await V.voiceCron(w.env);
  assert.equal((await w.row(sid)).outcome, 'live');
  assert.deepEqual(w.world.texts, []); assert.deepEqual(w.pushes(), []);
  // The owner picks up and they talk for 200 seconds.
  await w.hook('dial', { CallSid: sid, DialCallStatus: 'completed', DialCallDuration: '200' });
  r = await w.row(sid);
  assert.equal(r.outcome, 'transferred'); assert.equal(r.transferred, 1);
  assert.equal(r.summary, 'Lee has a burst pipe and asked for a call back.');
  assert.deepEqual(w.world.texts, [], 'no "Sorry we missed you" to someone who reached the owner');
  const p = w.pushes();
  assert.equal(p.length, 1);
  assert.match(p[0].aps.alert.body, /Max put them through to you\. You talked for 3 minutes\./);
  assert.doesNotMatch(p[0].aps.alert.body, /hung up/);
  assert.deepEqual((await w.DB.prepare('SELECT id FROM callbacks WHERE call_sid = ?1').bind(sid).all()).results, [], 'no call-back promise for a call the owner took');
  // Twilio's final status ping afterwards changes nothing but the billed length.
  await w.hook('status', { CallSid: sid, CallStatus: 'completed', CallDuration: '240' });
  assert.equal(w.pushes().length, 1); assert.equal((await w.row(sid)).seconds, 240);
});

test('2. pressing 0 at once and nobody picking up: one missed-call note and one text, not "hung up"', async () => {
  const w = await mk({ when: 'asked' });
  const sid = sidOf(21), x = await w.room(sid, '+14785550190');
  await w.send(x, { type: 'dtmf', digit: '0' });
  assert.match(w.said(x), /One moment, let me try to reach someone for you/);
  await w.endCall(x);
  await w.hook('after', { CallSid: sid, HandoffData: JSON.stringify({ reason: 'transfer' }), SessionStatus: 'ended' });
  assert.deepEqual(w.world.texts, [], 'nothing while the owner\'s phone rings');
  await w.hook('dial', { CallSid: sid, DialCallStatus: 'no-answer', DialCallDuration: '0' });
  const r = await w.row(sid);
  assert.equal(r.outcome, 'hangup');
  assert.match(r.summary, /^They asked to be put through, and nobody picked up\. Call them back\./);
  assert.equal(w.world.texts.length, 1); assert.match(w.world.texts[0].Body, /^Sorry we missed you/);
  const p = w.pushes();
  assert.equal(p.length, 1);
  assert.match(p[0].aps.alert.title, /^Missed call from/);
  assert.match(p[0].aps.alert.body, /Max tried to put them through to you, and nobody picked up/);
});

test('2. a hand-off to a neighbor is written up after its dial, with no call-back promise', async () => {
  const w = await mk();
  const sid = sidOf(22), x = await w.room(sid, '+14785550191');
  w.world.aiNote = { name: 'Ann', callback: '', reason: 'Needs an electrician', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'Ann needs an electrician.' };
  const s = await x.room.load(); s.handoff = { id: 'c2', number: '+14785552002', business: 'Lane Electric' }; s.endAt = Date.now() + 100; await x.room.keep(s);
  await w.endCall(x);
  assert.equal(JSON.parse(x.ws.sent.at(-1).handoffData).reason, 'handoff');
  const tw = await w.hook('after', { CallSid: sid, HandoffData: JSON.stringify({ reason: 'handoff', to: '+14785552002' }), SessionStatus: 'ended' });
  assert.match(tw.text, /handdial/);
  assert.equal((await w.row(sid)).outcome, 'live');
  await w.hook('handdial', { CallSid: sid, DialCallStatus: 'completed' });
  const r = await w.row(sid);
  assert.equal(r.outcome, 'handoff'); assert.equal(r.transferred, 0);
  assert.deepEqual((await w.DB.prepare('SELECT id FROM callbacks WHERE call_sid = ?1').bind(sid).all()).results, []);
  assert.deepEqual(w.world.texts, []);
});

// ---------- 3. calls Max never took ----------
test('3. rate-limited calls: no hang-up, no text to the caller, one quiet push a day', async () => {
  const w = await mk();
  const caller = '+14785550099';
  for (let i = 0; i < 5; i++) await w.DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, test) VALUES (?1, 'c1', ?2, ?3, ?4, 'done', 'new', 0)").bind(sidOf(100 + i), LINE, new Date(Date.now() - (10 + i) * 60e3).toISOString(), caller).run();
  for (const n of [30, 31]) {
    const r = await w.hook('in', { CallSid: sidOf(n), To: LINE, From: caller });
    assert.match(r.text, /We have your number and will call you back/);
    const st = await w.hook('status', { CallSid: sidOf(n), CallStatus: 'completed', CallDuration: '9' });
    assert.equal(st.status, 204, 'answered plainly (a 204 with a body threw, and alerted "A call to Max errored")');
    const row = await w.row(sidOf(n));
    assert.equal(row.outcome, 'limited'); assert.equal(row.seconds, 9);
    assert.match(row.summary, /^Max did not take this one/);
  }
  assert.deepEqual(w.world.texts, [], 'no "Sorry we missed you" to a limited caller');
  const p = w.pushes();
  assert.equal(p.length, 1, 'one summary push, not one per call');
  assert.equal(p[0].aps.sound, undefined, 'and a quiet one');
  assert.deepEqual(w.world.pushes.filter(x => /max-call/.test(x.title)), [], 'no error alert to Christopher');
});

// ---------- 4. the robocall filter ----------
test('4. real customers mentioning a warranty, a final notice or card fees are not hung up on; robocalls still are', async () => {
  for (const t of ['Hi, I want to know if the transmission repair is covered by my extended warranty.', 'I got a final notice from the county about my septic, can you come look at it?',
    'Do you guys take credit card processing fees on top of the bill?', 'Is my water heater still under the extended warranty you sold me?', 'Can you verify your Google listing hours? It says closed.'])
    assert.equal(V.looksRobo(t), false, t);
  for (const t of ['This is a recorded message. Press one to speak to an agent.', 'Press 1 now to be connected.', 'This is an automated call about your account.',
    'Your Google business listing is about to be suspended.', 'We are calling about your extended car warranty.', 'Congratulations, you qualify for a business line of credit.',
    'Hi this is Jake with merchant services, we can lower your processing fees.'])
    assert.equal(V.looksRobo(t), true, t);
  // End to end: a customer's first sentence with one pitch word goes to Max as usual.
  const w = await mk();
  const x = await w.room(sidOf(40), '+14785550140');
  const seen = w.world.aiSeen.length;
  w.world.aiScript = ['Sure, what is the address?'];
  await w.say(x, 'I got a final notice from the county about my septic, can you come look at it?');
  assert.equal(w.world.aiSeen.length, seen + 1, 'Max answered them');
  assert.doesNotMatch(w.said(x), /pass that along/);
});

// ---------- 5. time zones ----------
test('5. each line has its own time zone: from its state or phone at sign-up, worked out for older lines, a calendar wins', async () => {
  assert.equal(CB.lineZone({ town: 'Austin, TX', phone: '512-555-0100' }), 'America/Chicago');
  assert.equal(CB.lineZone({ town: 'Knoxville, TN', phone: '(865) 555-0100' }), 'America/New_York', 'east Tennessee, by its area code');
  assert.equal(CB.lineZone({ town: 'Nashville, TN', phone: '615-555-0100' }), 'America/Chicago');
  assert.equal(CB.lineZone({ town: 'Phoenix, AZ' }), 'America/Phoenix');
  assert.equal(CB.lineZone({ town: 'Somewhere', number: '+13105550100' }), 'America/Los_Angeles');
  assert.equal(CB.lineZone({}), 'America/New_York');
  assert.deepEqual(CB.zonesOfNumber('+18505550100'), ['America/Chicago', 'America/New_York']);
  const w = await mk({ tz: '' });
  assert.equal(await CB.tzFor(w.env, 'c1'), 'America/New_York', 'Eatonton, GA');
  await w.DB.prepare("UPDATE voice_lines SET town = 'Denver, CO' WHERE number = ?1").bind(LINE).run();
  assert.equal(await CB.tzFor(w.env, 'c1'), 'America/Denver', 'an older line with no zone stored: from its town');
  await w.DB.prepare("UPDATE voice_lines SET tz = 'America/Los_Angeles' WHERE number = ?1").bind(LINE).run();
  assert.equal(await CB.tzFor(w.env, 'c1'), 'America/Los_Angeles', 'the stored zone');
  const line = await w.DB.prepare('SELECT * FROM voice_lines WHERE number = ?1').bind(LINE).first();
  assert.equal((await (await import('../src/availability.js')).slotsFor(w.env, line, Date.now(), 4)).tz, 'America/Los_Angeles', 'open times are in the business\'s zone');
  assert.equal(CB.proposeSlot(await CB.tzFor(w.env, 'c1'), Date.parse('2026-11-03T15:00:00Z')).text, '9:15 AM', 'call-back times too (7 AM in Los Angeles: 9:15)');
  await w.DB.prepare("INSERT INTO gcal_tokens (client_id, refresh, tz) VALUES ('c1', 'r', 'America/Chicago')").run();
  assert.equal(await CB.tzFor(w.env, 'c1'), 'America/Chicago', 'a connected calendar wins');
});

test('5. a new line gets its zone when it is bought', async () => {
  const w = await mk();
  await w.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, phone) VALUES ('c9', 'h9', 'Hill Country Roofing', 1, '')").run();
  await w.DB.prepare("INSERT INTO billing (client_id, business, phone, town, type, email, status) VALUES ('c9', 'Hill Country Roofing', '512-555-0144', 'Austin, TX', 'Contractor or trade', 'x@example.com', 'active')").run();
  const r = await (await import('../src/provision.js')).provisionLine(w.env, 'c9');
  assert.equal(r.status, 'live');
  assert.equal((await w.DB.prepare("SELECT tz FROM voice_lines WHERE client_id = 'c9'").first()).tz, 'America/Chicago');
});

test('5. no outbound call 9 PM to 8 AM for the customer either, by their area code', () => {
  const t = Date.parse('2026-11-03T13:05:00Z');   // 8:05 AM Eastern, 5:05 AM in Los Angeles
  assert.equal(CB.callHoursOk('America/New_York', t), true);
  assert.equal(CB.callHoursOk('America/New_York', t, '+14785550100'), true);
  assert.equal(CB.callHoursOk('America/New_York', t, '+13105550100'), false);
  assert.equal(CB.callHoursOk('America/New_York', Date.parse('2026-11-03T17:00:00Z'), '+13105550100'), true);
  assert.equal(CB.callHoursOk('America/New_York', Date.parse('2026-11-03T13:30:00Z'), '+18505550100'), false, 'an area code across a zone line: both sides');
  assert.equal(CB.callHoursOk('America/Los_Angeles', Date.parse('2026-11-04T04:30:00Z'), '+14785550100'), false, '8:30 PM in LA is 11:30 PM for a Georgia number');
});

// ---------- 6. "only if urgent" and quiet hours ----------
test('6. an owner who takes urgent calls only is not rung for pressing 0 or asking twice', async () => {
  const w = await mk({ when: 'urgent' });
  const x = await w.room(sidOf(60), '+14785550160');
  await w.send(x, { type: 'dtmf', digit: '0' });
  let s = await x.room.load();
  assert.equal(s.transfer, false); assert.equal(s.endAt, 0);
  assert.match(w.said(x), /only put urgent calls through/);
  w.world.aiScript = ['I can take a message for him. What is going on?'];
  await w.say(x, 'Can I talk to a real person please?');
  w.world.aiScript = ['I understand. He will call you back soon. What is the best number? [END]'];
  await w.say(x, 'No, I want to speak to a real person.');
  assert.match(extraOf(w.world), /asked for a person twice\. The owner only takes calls put through when it is urgent.*If not, stop trying to help them yourself: say the owner will call them back/);
});

test('6. "put through when they ask": 0 works by day; in quiet hours only urgent calls ring and a message is taken', async () => {
  const day = await mk({ when: 'asked', tz: DAY_TZ });
  const d = await day.room(sidOf(61), '+14785550161');
  await day.send(d, { type: 'dtmf', digit: '0' });
  assert.equal((await d.room.load()).transfer, true);
  const night = await mk({ when: 'asked', tz: NIGHT_TZ });
  const n = await night.room(sidOf(62), '+14785550162');
  assert.equal((await n.room.load()).line.transferWhen, 'urgent');
  await night.send(n, { type: 'dtmf', digit: '0' });
  assert.equal((await n.room.load()).transfer, false);
  assert.match(night.said(n), /only put urgent calls through/);
  night.world.aiScript = ['Sure. What is going on?'];
  await night.say(n, 'Can I talk to a real person please?');
  assert.match(JSON.stringify(night.world.aiSeen.at(-1).system), /Only if it is urgent/);
  night.world.aiScript = ['He will call you back first thing. What is the best number? [END]'];
  await night.say(n, 'No, I want to speak to a real person.');
  assert.match(extraOf(night.world), /It is after hours, so the owner only takes calls put through when it is urgent/);
});

// ---------- 7. the disclosure ----------
test('7. the disclosure is always Max\'s own sentence; a greeting that contradicts it is not used', async () => {
  assert.equal(V.DISCLOSURE, 'I\'m an S.I. assistant, and this call may be recorded.');
  const once = t => t.split(V.DISCLOSURE).length - 1;
  for (const bad of ['Thanks for calling Bob\'s Plumbing, this is Sarah, no AI here. Calls are recorded for quality.', 'Hi, thanks for calling Bob\'s Plumbing, this is Sarah at the front desk, calls may be recorded. AI could never replace us.',
    'Thanks for calling Bob\'s Plumbing. You are talking to a real person. How can I help?', 'Thanks for calling Bob\'s Plumbing. This call is not recorded. How can I help?', 'Thanks for calling Bob\'s, I\'m not a robot, promise.']) {
    assert.equal(V.greetingOk(bad), false, bad);
    const g = V.greetingText('Bob\'s Plumbing', false, bad);
    assert.equal(g, 'Hi, thanks for calling Bob\'s Plumbing. ' + V.DISCLOSURE + ' What can I do for you?', 'the standard greeting instead');
  }
  const own = V.greetingText('Bob\'s Plumbing', false, 'Thanks for calling Bob\'s Plumbing. How can I help today?');
  assert.equal(own, 'Thanks for calling Bob\'s Plumbing. ' + V.DISCLOSURE + ' How can I help today?', 'added by Max, after the first sentence');
  assert.equal(V.greetingText('X', false, 'Thanks for calling Bob\'s, what can I do for you?'), V.DISCLOSURE + ' Thanks for calling Bob\'s, what can I do for you?');
  // their own words that already say both things play as written (nothing of theirs is cut: the business name lives
  // there); the app's old added sentence becomes the disclosure
  const theirs = V.greetingText('X', false, 'Thanks for calling Lake Country Foam Party! I\'m Max, an S.I., and this call may be recorded. What can I do for you?');
  assert.equal(theirs, 'Thanks for calling Lake Country Foam Party! I\'m Max, an S.I., and this call may be recorded. What can I do for you?');
  assert.equal(V.greetingText('X', false, 'You\'ve reached Quillen Plumbing\'s AI assistant, and this call may be recorded. How can I help?'), 'You\'ve reached Quillen Plumbing\'s AI assistant, and this call may be recorded. How can I help?', 'the business name stays');
  assert.equal(V.greetingText('X', false, 'This is Max with Quillen Plumbing, your virtual assistant. How can I help?'), 'This is Max with Quillen Plumbing, your virtual assistant. ' + V.DISCLOSURE + ' How can I help?', 'recording not said: the disclosure goes in, nothing comes out');
  assert.equal(V.greetingOk('Thanks for calling Quillen Plumbing! Press 0 to reach a real person.'), true, 'reaching a person is not claiming to be one');
  assert.equal(V.greetingText('X', false, 'Hey there, Bob\'s Plumbing! I’m an S.I., and this call may be recorded.'), 'Hey there, Bob\'s Plumbing! ' + V.DISCLOSURE);
  const es = V.greetingText('X', true, 'Thanks for calling Bob\'s Plumbing. SI, hablamos espanol. This call is recorded.');
  assert.equal(once(es), 1); assert.match(es, /SI, hablamos espanol\./); assert.match(es, /Para español, oprima dos\.$/);
  // end to end: the owner saves a greeting in the app; a contradicting one is refused
  const w = await mk();
  const A = p => '/app/' + CODE + p;
  assert.equal((await w.site.call(A('/api/line'), { json: { greeting: 'Thanks for calling Quillen Plumbing, this is Sarah, no AI here.', by: 'Dana' } })).status, 422);
  const ok = await w.site.call(A('/api/line'), { json: { greeting: 'Thanks for calling Quillen Plumbing. What can we fix for you today?', by: 'Dana' } });
  assert.equal(ok.status, 200, ok.text);
  const x = await w.room(sidOf(70), '+14785550170');
  const heard = x.twiml.match(/welcomeGreeting="([^"]*)"/)[1].replace(/&apos;/g, '\'');
  assert.equal(heard, 'Thanks for calling Quillen Plumbing. ' + V.DISCLOSURE + ' What can we fix for you today?');
});

// ---------- 8. "no problems" is a yes ----------
test('8. "no problems", "not a single issue" and "sure, no problem" are yeses; a mixed answer is asked again, never a complaint', () => {
  for (const t of ['No problems at all', 'Yeah no problems, it is working great.', 'Not a single issue', 'Yes it did, no leaks', 'Sure, no problem', 'Everything is working', 'Nothing wrong with it', 'No complaints here', 'Not bad at all'])
    assert.equal(CB.readAnswer('', t), 'yes', t);
  for (const t of ['No, it is leaking again', 'It is not working', 'There is a problem with it', 'Nope', 'It stopped working yesterday', 'It hasn\'t held up'])
    assert.equal(CB.readAnswer('', t), 'no', t);
  for (const t of ['Yeah, but it is leaking again', 'I am not sure', 'Can you say that again?', 'Hello?']) assert.equal(CB.readAnswer('', t), 'unclear', t);
  assert.equal(CB.readAnswer('', 'Please stop calling me'), 'stop');
  assert.equal(CB.readAnswer('', 'It will not stop dripping'), 'no', 'a drip that will not stop is a complaint, not an opt-out');
  assert.equal(CB.readAnswer('2', 'yes'), 'no', 'the keypad wins');
  assert.equal(CB.readAnswer('', ''), '');
});

test('8. at the check-in, "no problems" is a yes and "yes, but it leaks" is asked again by keypad', async () => {
  const w = await mk();
  const add = async first => { const r = await w.DB.prepare("INSERT INTO checkins (client_id, phone, first, job, due_at, status, created) VALUES ('c1', '+14785550150', ?1, 'water heater', ?2, 'pending', ?2)").bind(first, new Date().toISOString()).run(); return r.meta.last_row_id; };
  const gather = (id, said, extra) => CI.checkinGather(w.env, new URL('https://x/voice/cig/k?id=' + id + (extra || '')), new URLSearchParams({ SpeechResult: said }));
  const a = await add('Dana');
  assert.match(await (await gather(a, 'No problems at all')).text(), /Glad to hear it/);
  assert.equal((await w.DB.prepare('SELECT status FROM checkins WHERE id = ?1').bind(a).first()).status, 'yes');
  const b = await add('Sam');
  const again = await (await gather(b, 'Yeah, but it is leaking again')).text();
  assert.match(again, /<Gather[^>]*actionOnEmptyResult="true"[^>]*action="[^"]*id=\d+&amp;a=1"/);
  assert.match(again, /Press 1 if it did, or press 2 if something is not right/);
  assert.equal((await w.DB.prepare('SELECT status FROM checkins WHERE id = ?1').bind(b).first()).status, 'pending');
  assert.equal((await w.DB.prepare('SELECT COUNT(*) AS n FROM callbacks').first()).n, 0, 'not taken as a complaint');
});

test('8. a call-back time: "sure, no problem" keeps the time instead of becoming "as soon as possible"', async () => {
  const w = await mk();
  const id = (await w.DB.prepare("INSERT INTO callbacks (client_id, phone, name, reason, due_at, status, created) VALUES ('c1', '+14785550151', 'Kim', 'Leak', ?1, 'missed', ?1)").bind(new Date(Date.now() + 3600e3).toISOString()).run()).meta.last_row_id;
  const r = await CB.outboundGather(w.env, new URL('https://x/voice/outg/k?id=' + id + '&k=reset'), new URLSearchParams({ SpeechResult: 'Sure, no problem' }));
  assert.match(await r.text(), /He will call you then/);
  assert.equal((await w.DB.prepare('SELECT status FROM callbacks WHERE id = ?1').bind(id).first()).status, 'pending');
  const r2 = await CB.outboundGather(w.env, new URL('https://x/voice/outg/k?id=' + id + '&k=reset'), new URLSearchParams({ SpeechResult: 'Yes, no, I mean sooner' }));
  assert.match(await r2.text(), /<Gather[^>]*a=1/, 'mixed: asked once more');
  assert.equal((await w.DB.prepare('SELECT status FROM callbacks WHERE id = ?1').bind(id).first()).status, 'pending');
});

// ---------- 9. check-in calls go out once ----------
test('9. a check-in is dialed once: answered is done, no answer is tried the next day, paused or inactive clients are not called', async () => {
  const T0 = Date.parse('2026-11-03T17:00:00Z');   // Tuesday noon Eastern
  const w = await mk({ tz: 'America/New_York' });
  await w.DB.prepare("INSERT INTO checkin_prefs (client_id, on_) VALUES ('c1', 1)").run();
  const add = async (first, phone) => (await w.DB.prepare("INSERT INTO checkins (client_id, phone, first, job, due_at, status, created) VALUES ('c1', ?1, ?2, 'drain', '2026-11-03T16:00:00.000Z', 'pending', '2026-10-31T00:00:00Z')").bind(phone, first).run()).meta.last_row_id;
  const sam = await add('Sam', '+14785550161'), pat = await add('Pat', '+14785550162');
  const dialed = to => w.world.dialed.filter(d => d.To === to).length;
  const k = id => w.DB.prepare('SELECT status, attempts, due_at, result FROM checkins WHERE id = ?1').bind(id).first();
  await withClock(T0, () => CI.checkinCron(w.env));
  assert.equal(dialed('+14785550161'), 1); assert.equal(dialed('+14785550162'), 1);
  // Sam picks up and says nothing, twice; Pat does not pick up.
  await withClock(T0, async () => {
    await CI.checkinTwiml(w.env, new URL('https://x/voice/ci/k?id=' + sam), new URLSearchParams({ AnsweredBy: 'human' }));
    await CI.checkinGather(w.env, new URL('https://x/voice/cig/k?id=' + sam), new URLSearchParams({}));
    await CI.checkinGather(w.env, new URL('https://x/voice/cig/k?id=' + sam + '&a=1'), new URLSearchParams({}));
    await CI.checkinStatus(w.env, new URL('https://x/voice/cistatus/k?id=' + sam), new URLSearchParams({ CallStatus: 'completed' }));
    await CI.checkinStatus(w.env, new URL('https://x/voice/cistatus/k?id=' + pat), new URLSearchParams({ CallStatus: 'no-answer' }));
  });
  assert.equal((await k(sam)).status, 'done');
  const p = await k(pat);
  assert.equal(p.status, 'pending'); assert.equal(p.due_at, '2026-11-04T16:00:00.000Z', 'tomorrow at 11 AM, the business\'s time');
  await withClock(T0 + 10 * 60e3, () => CI.checkinCron(w.env));
  assert.equal(dialed('+14785550161'), 1, 'not called again ten minutes later'); assert.equal(dialed('+14785550162'), 1);
  await withClock(Date.parse('2026-11-04T16:05:00Z'), () => CI.checkinCron(w.env));
  assert.equal(dialed('+14785550162'), 2, 'the one who did not answer gets the second try the next day');
  assert.equal((await k(pat)).attempts, 2);
  // Paused by the owner: no call (held for a few days); a client who is not active: dropped.
  await w.DB.prepare("UPDATE voice_lines SET owner_set = '{\"off\":true}' WHERE number = ?1").bind(LINE).run();
  const lee = await add('Lee', '+14785550163');
  await withClock(T0 + 30 * 60e3, () => CI.checkinCron(w.env));
  assert.equal(dialed('+14785550163'), 0); assert.equal((await k(lee)).status, 'pending');
  await w.DB.prepare("UPDATE voice_lines SET owner_set = '{}' WHERE number = ?1").bind(LINE).run();
  await w.DB.prepare("UPDATE app_clients SET active = 0 WHERE client_id = 'c1'").run();
  await withClock(T0 + 40 * 60e3, () => CI.checkinCron(w.env));
  assert.equal(dialed('+14785550163'), 0); assert.equal((await k(lee)).status, 'skipped');
});

test('9. the check-in window holds for the customer\'s own zone too', async () => {
  const w = await mk({ tz: 'America/New_York' });
  await w.DB.prepare("INSERT INTO checkin_prefs (client_id, on_) VALUES ('c1', 1)").run();
  for (const phone of ['+14785550171', '+13105550172']) await w.DB.prepare("INSERT INTO checkins (client_id, phone, first, job, due_at, status, created) VALUES ('c1', ?1, 'A', 'drain', '2026-11-03T14:00:00.000Z', 'pending', '2026-10-31T00:00:00Z')").bind(phone).run();
  await withClock(Date.parse('2026-11-03T15:10:00Z'), () => CI.checkinCron(w.env));   // 10:10 AM Eastern, 7:10 AM in Los Angeles
  assert.deepEqual(w.world.dialed.map(d => d.To), ['+14785550171']);
});

// ---------- 10. and 11. the review ask ----------
test('10. 11. every customer who answers the check-in gets the review link, whatever they say; a no still reaches the owner', async () => {
  const w = await mk({ review: 'https://g.page/r/quillen' });
  const add = async phone => (await w.DB.prepare("INSERT INTO checkins (client_id, phone, first, job, due_at, status, created) VALUES ('c1', ?1, 'Pat', 'water heater', ?2, 'pending', ?2)").bind(phone, new Date().toISOString()).run()).meta.last_row_id;
  const gather = (id, f, extra) => CI.checkinGather(w.env, new URL('https://x/voice/cig/k?id=' + id + (extra || '')), new URLSearchParams(f));
  const texts = to => w.world.texts.filter(t => t.To === to);
  // A no: the owner's push and call-back as before, and the same review text as everyone gets.
  await gather(await add('+14785550181'), { Digits: '2' });
  assert.equal(texts('+14785550181').length, 1); assert.match(texts('+14785550181')[0].Body, /https:\/\/g\.page\/r\/quillen/);
  assert.equal((await w.DB.prepare("SELECT COUNT(*) AS n FROM callbacks WHERE phone = '+14785550181' AND status = 'asap'").first()).n, 1);
  assert.ok(w.pushes().some(p => /says something is not right/.test(p.aps.alert.title)));
  // A yes.
  assert.match(await (await gather(await add('+14785550182'), { SpeechResult: 'Yes it did' })).text(), /A link to leave a quick review is on its way/);
  assert.equal(texts('+14785550182').length, 1);
  // No clear answer, twice.
  const u = await add('+14785550183');
  await gather(u, { SpeechResult: 'hmm' }); assert.equal(texts('+14785550183').length, 0, 'asked again first');
  await gather(u, { SpeechResult: 'hmm' }, '&a=1'); assert.equal(texts('+14785550183').length, 1);
  // Asked not to be called: no text.
  await gather(await add('+14785550184'), { Digits: '9' });
  assert.equal(texts('+14785550184').length, 0);
  // 10. Already sent one (Twilio logged it "queued", not "sent"): not asked again.
  await gather(await add('+14785550182'), { Digits: '1' });
  assert.equal(texts('+14785550182').length, 1, 'the earlier text counts');
  assert.equal((await w.DB.prepare("SELECT status FROM sms_log WHERE to10 = '4785550182' AND kind = 'review'").first()).status, 'queued');
});

// ---------- 12. a stalled AI ----------
test('12. Claude saying nothing for a few seconds: the backup model answers', async () => {
  const enc = new TextEncoder();
  const backup = { run: async (model, o) => o.stream ? new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"response":"Sure. What is the address?"}\n\ndata: [DONE]\n\n')); c.close(); } }) : { response: '{"summary":"They called.","name":"","callback":""}' } };
  const w = await mk({ env: { AI: backup, VOICE_FIRST_TOKEN_MS: '60' } });
  const base = globalThis.fetch; let stalled = 0;
  globalThis.fetch = (u, i) => /anthropic/.test(String(u)) && JSON.parse((i && i.body) || '{}').stream ? (stalled++, new Promise(() => {})) : base(u, i);
  try {
    const x = await w.room(sidOf(120), '+14785550120');
    const t0 = Date.now();
    await awake(() => w.say(x, 'My furnace is making a banging noise.'));
    assert.ok(Date.now() - t0 < 3000, 'answered in well under the old wait');
    assert.match(w.said(x), /What is the address\?/, 'the backup model\'s answer');
    assert.equal(stalled, 1);
  } finally { globalThis.fetch = base; }
});

test('12. with no backup, a stalled AI gets one apology (not a second long wait), and the call cap and check-ins still run', async () => {
  const w = await mk({ env: { VOICE_FIRST_TOKEN_MS: '60' } });
  const base = globalThis.fetch; let stalled = 0;
  globalThis.fetch = (u, i) => /anthropic/.test(String(u)) && JSON.parse((i && i.body) || '{}').stream ? (stalled++, new Promise(() => {})) : base(u, i);
  try {
    const x = await w.room(sidOf(121), '+14785550121');
    await awake(() => w.say(x, 'My furnace is making a banging noise.'));
    assert.equal(stalled, 1, 'not asked a second time after timing out');
    assert.match(w.said(x), /Could you say (it|that) one more time\?/);
    // Now one that never comes back at all (the timeout set very long): the alarm gives up on it, then the cap ends the call.
    w.env.VOICE_FIRST_TOKEN_MS = '600000'; w.env.VOICE_REPLY_MAX_MS = '600000';
    const y = await w.room(sidOf(122), '+14785550122');
    w.say(y, 'My furnace is making a banging noise.');
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    const real = Date.now, base0 = real();
    for (const m of [0.5, 2, 9.6]) { Date.now = () => base0 + m * 60e3; await y.room.alarm(); }
    Date.now = real;
    const s = await y.room.load();
    assert.match(w.said(y), /lost my train of thought/);
    assert.match(w.said(y), /I have to let you go now/);
    assert.ok(s.endAt > 0, 'the call is ending');
  } finally { globalThis.fetch = base; }
});

// ---------- 13. talking over "one moment" ----------
test('13. talking over "one moment, let me reach him" does not cancel the transfer', async () => {
  const w = await mk({ when: 'asked' });
  const x = await w.room(sidOf(130), '+14785550130');
  w.world.aiScript = ['Let me try to reach him for you now, one moment. [TRANSFER]'];
  await w.say(x, 'Can I talk to a real person please?');
  assert.equal((await x.room.load()).transfer, true);
  await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: 'Let me try to reach him', durationUntilInterruptMs: 900 });
  let s = await x.room.load();
  assert.equal(s.transfer, true); assert.ok(s.endAt > 0);
  const seen = w.world.aiSeen.length;
  await w.say(x, 'Okay, thanks.');
  s = await x.room.load();
  assert.equal(s.transfer, true, 'their "okay" does not start a new answer that would cancel it');
  assert.equal(w.world.aiSeen.length, seen);
  assert.equal(s.msgs.at(-1).t, 'Okay, thanks.');
});

// ---------- 14. hand-offs ----------
test('14. no hand-offs to a business whose owner paused Max', async () => {
  const w = await mk();
  const { neighborsFor } = await import('../src/handoff.js');
  for (const [cid, biz, ind, num, os, lat] of [['c1', 'Quillen Plumbing', 'plumbing', LINE, '{}', 33.32], ['c2', 'Lane Electric', 'electrical', '+14785552002', '{"off":true}', 33.33], ['c3', 'Oconee Roofing', 'roofing', '+14785552003', '{}', 33.34]]) {
    if (cid !== 'c1') {
      await w.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES (?1, ?2, ?3, 1)").bind(cid, 'h' + cid, biz).run();
      await w.DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, owner_set) VALUES (?1, ?2, ?3, 1, ?4, ?5)").bind(num, cid, biz, ind, os).run();
    }
    await w.DB.prepare('INSERT INTO map_listing (client_id, show, lat, lng) VALUES (?1, 1, ?2, -83.39)').bind(cid, lat).run();
    await w.DB.prepare('INSERT INTO handoff_prefs (client_id, give, take) VALUES (?1, 1, 1)').bind(cid).run();
  }
  assert.deepEqual((await neighborsFor(w.env, 'c1')).map(n => n.business), ['Oconee Roofing']);
});

// ---------- 15. the write-up is saved before the call is marked done ----------
test('15. a write-up that fails keeps the call for a retry; once saved, the call room keeps only the flag', async () => {
  const w = await mk();
  w.world.aiNote = { name: 'Dana', callback: '+14785550142', reason: 'Leak', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'Dana has a leak.' };
  const sid = sidOf(150), x = await w.room(sid, '+14785550142');
  w.world.aiScript = ['Got it. What is your name? '];
  await w.say(x, 'My water heater is leaking.');
  const prepare = w.DB.prepare; let failed = 0;
  w.DB.prepare = sql => { if (/^UPDATE app_calls SET (?:transferred = CASE[^,]*, )?caller_name/.test(sql) && !failed) { failed++; throw new Error('D1 is down'); } return prepare.call(w.DB, sql); };
  await assert.rejects(() => x.room.finalize(sid, 'ended'));
  w.DB.prepare = prepare;
  let st = x.store.get('s');
  assert.ok(!st.finalized, 'not marked finalized'); assert.ok(st.msgs.length >= 2, 'the words are still there');
  assert.equal((await w.row(sid)).outcome, 'live');
  // The 10-minute cron tries again (as it does for any call still live after 20 minutes).
  await w.DB.prepare('UPDATE app_calls SET at = ?1 WHERE id = ?2').bind(new Date(Date.now() - 25 * 60e3).toISOString(), sid).run();
  await V.voiceCron(w.env);
  const r = await w.row(sid);
  assert.equal(r.outcome, 'done'); assert.equal(r.summary, 'Dana has a leak.');
  assert.match(r.transcript, /water heater is leaking/);
  st = x.store.get('s');
  assert.deepEqual(st, { sid, finalized: true, done: true }, 'no transcript left in the call room');
  assert.equal(w.pushes().length, 1, 'one note to the owner');
});
