// Gates HQ calls for Christopher, in Max's voice: only approved calls dial, from his own calls line once it's bought
// (bought once, never twice), inside the hours and limits; the call runs on ConversationRelay with Max's ElevenLabs
// voice and Flux; the room lets them speak first or opens after a short silence with the automated-assistant line,
// presses menu keys, holds, hangs up after its goodbye, and writes the call up once (row, his day, one push).
// Callbacks to his calls line ring his cell. Twilio, Claude and ntfy are faked; nothing touches the internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { makeDB, makeRoom } = await import('./rehearsal/harness.js');
const HC = await import('../src/hqcalls.js');

const SID = 'CA' + 'b'.repeat(32);
const NOON = Date.parse('2026-11-06T17:00:00Z');   // 12 PM Eastern
const u = (k, id) => new URL('https://alwaysopenoffice.com/voice/' + k + '/k?id=' + id);
let dials = [], buys = [], pushes = [], claude = [], claudeSeen = [];
function sse(text) {
  const ev = [{ type: 'message_start', message: { usage: { input_tokens: 9 }, model: 'm' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'message_delta', usage: { output_tokens: 5 }, delta: { stop_reason: 'end_turn' } }];
  return new Response(ev.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function env(o) {
  o = o || {};
  const DB = makeDB();
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('api.twilio.com')) {
      if (url.includes('/Calls.json')) { dials.push(Object.fromEntries(new URLSearchParams(init.body))); return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }
      if (url.includes('IncomingPhoneNumbers.json?')) return new Response(JSON.stringify({ incoming_phone_numbers: o.existing ? [{ phone_number: o.existing, sid: 'PN0' }] : [] }));
      if (url.includes('AvailablePhoneNumbers')) return new Response(JSON.stringify({ available_phone_numbers: o.noNumbers ? [] : [{ phone_number: '+14785550142' }] }));
      if (url.includes('IncomingPhoneNumbers')) { buys.push(Object.fromEntries(new URLSearchParams(init.body || ''))); return new Response(JSON.stringify({ sid: 'PN1', phone_number: '+14785550142' }), { status: 201 }); }
      return new Response('{}');
    }
    if (url.includes('anthropic.com')) {
      const b = JSON.parse(init.body); claudeSeen.push(b);
      const next = claude.shift();
      if (next == null) return new Response('down', { status: 500 });
      return b.stream ? sse(next) : new Response(JSON.stringify({ content: [{ type: 'text', text: next }] }));
    }
    if (url.includes('ntfy')) { pushes.push({ title: init.headers.Title, body: String(init.body) }); return new Response('ok'); }
    return new Response('{}');
  };
  return Object.assign({ DB, VOICE_KEY: 'k', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'x', NTFY_URL: 'https://ntfy.sh/test' }, o.env || {});
}
async function add(e, o) {
  await HC.ensureHqCalls(e);
  await e.DB.prepare("INSERT INTO hq_calls_out (at, number, business, goal, avail, status, approved_at) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)")
    .bind(new Date(NOON).toISOString(), o.number || '+14784530000', o.business || 'Take 5 Milledgeville', o.goal || 'Book an oil change Saturday morning.', o.status || 'approved', new Date(NOON - 60e3).toISOString()).run();
}
const form = o => new URLSearchParams(Object.assign({ CallSid: SID }, o));
const reset = () => { dials = []; buys = []; pushes = []; claude = []; claudeSeen = []; };

test('a draft never dials; an approved call dials once, from the Always Open line until his calls line exists', async () => {
  reset(); const e = env();
  await add(e, { status: 'draft' });
  assert.equal(await HC.hqCallsTick(e, NOON), 0);
  await e.DB.prepare("UPDATE hq_calls_out SET status = 'approved'").run();
  assert.equal(await HC.hqCallsTick(e, NOON), 1);
  assert.equal(dials[0].From, HC.AO_LINE); assert.equal(dials[0].To, '+14784530000'); assert.equal(dials[0].TimeLimit, '600');
  assert.ok(!dials[0].MachineDetection, 'no answering-machine wait: the room hears voicemail itself');
  assert.equal(await HC.hqCallsTick(e, NOON), 0, 'one call at a time');
});

test('his calls line is bought once (478 first), pointed at Gates HQ, and calls then come from it', async () => {
  reset(); const e = env();
  const L = await HC.hqLineEnsure(e, NOON);
  assert.equal(L.number, '+14785550142');
  assert.equal(buys.length, 1);
  assert.match(buys[0].VoiceUrl, /\/voice\/hqline\/k$/); assert.match(buys[0].SmsUrl, /\/voice\/hqlinesms\/k$/);
  assert.equal(buys[0].FriendlyName, 'Gates HQ calls (Christopher)');
  assert.equal((await HC.hqLineEnsure(e, NOON + 60e3)).number, '+14785550142');
  assert.equal(buys.length, 1, 'never a second number');
  assert.equal(pushes.length, 1); assert.match(pushes[0].title, /calls line is ready/);
  await add(e, {}); await HC.hqCallsTick(e, NOON);
  assert.equal(dials[0].From, '+14785550142');
});

test('a number an earlier try bought is found again instead of buying another; a busy claim is left alone', async () => {
  reset(); const e = env({ existing: '+14785550199' });
  assert.equal((await HC.hqLineEnsure(e, NOON)).number, '+14785550199');
  assert.equal(buys.filter(b => b.PhoneNumber).length, 0);
  buys = [];
  const e2 = env();
  await HC.ensureHqCalls(e2);
  await e2.DB.prepare("INSERT INTO hq_kv (k, at, v) VALUES ('hq-line', ?1, ?2)").bind(new Date().toISOString(), JSON.stringify({ status: 'buying', tries: 1 })).run();
  assert.equal(await HC.hqLineEnsure(e2), null, 'another request is buying right now');
  assert.equal(buys.length, 0);
});

test('no number to buy: it says so after three tries and keeps calling from the Always Open line', async () => {
  reset(); const e = env({ noNumbers: true });
  for (let i = 0; i < 3; i++) {
    await HC.hqLineEnsure(e, NOON);
    await e.DB.prepare("UPDATE hq_kv SET at = ?1 WHERE k = 'hq-line'").bind(new Date(NOON - 20 * 60e3).toISOString()).run();
  }
  const v = JSON.parse((await e.DB.prepare("SELECT v FROM hq_kv WHERE k = 'hq-line'").first()).v);
  assert.equal(v.status, 'failed'); assert.equal(v.tries, 3);
  assert.equal(await HC.hqLineEnsure(e, NOON), null, 'waits a day after three tries');
});

test('no calls at night; his own number, and numbers that said "don\'t call", are refused', async () => {
  reset(); const e = env();
  await add(e, {});
  assert.equal(await HC.hqCallsTick(e, Date.parse('2026-11-07T03:00:00Z')), 0);   // 10 PM Eastern: waits
  assert.equal(dials.length, 0);
  const e2 = env(); await add(e2, { number: HC.ME });
  await HC.hqCallsTick(e2, NOON);
  assert.match((await e2.DB.prepare('SELECT result FROM hq_calls_out').first()).result, /can’t be called/);
  const e3 = env(); await add(e3, {});
  await e3.DB.prepare("INSERT INTO call_optout (client_id, phone10, at) VALUES ('gates-hq', '4784530000', 'x')").run();
  await HC.hqCallsTick(e3, NOON);
  assert.match((await e3.DB.prepare('SELECT result FROM hq_calls_out').first()).result, /asked not to get automated calls/);
  assert.equal(dials.length, 0);
});

test('family on his OK-to-call list: the call knows who it is calling', async () => {
  reset(); const e = env();
  await HC.ensureHqCalls(e);
  await e.DB.prepare("INSERT INTO hq_kv (k, at, v) VALUES ('family', 'x', ?1)").bind(JSON.stringify({ people: [{ name: 'Dad', relation: 'father', phones: ['(478) 555-0111'], call: true }] })).run();
  await add(e, { number: '+14785550111', business: 'Dad', goal: 'Tell him I\'ll be there at 6 and ask if he wants to golf Saturday.' });
  await HC.hqCallsTick(e, NOON);
  const r = await e.DB.prepare('SELECT kind, name, relation FROM hq_calls_out').first();
  assert.deepEqual({ ...r }, { kind: 'family', name: 'Dad', relation: 'father' });
  const sys = HC.systemFor({ kind: 'family', name: 'Dad', relation: 'father', callback: '+14785550142' });
  assert.match(sys, /Hi Dad, this is Christopher's automated assistant calling for him\. This call may be recorded\./);
});

test('when they pick up: ConversationRelay with Max\'s ElevenLabs voice and Flux, no greeting (they speak first)', async () => {
  reset(); const e = env();
  await add(e, {}); await HC.hqCallsTick(e, NOON);
  const x = await (await HC.hqcAnswer(e, u('hqc', 1), form({}))).text();
  assert.match(x, /<ConversationRelay url="wss:\/\/alwaysopenoffice\.com\/voice\/hqws\/CAb+\?id=1&amp;t=[0-9a-f]{32}"/);
  assert.match(x, /ttsProvider="ElevenLabs" voice="UgBBYS2sOqTuMpoF3BR0-flash_v2_5-1\.0_0\.6_0\.8"/);
  assert.match(x, /transcriptionProvider="Deepgram" speechModel="flux"/);
  assert.match(x, /dtmfDetection="true"/);
  assert.doesNotMatch(x, /welcomeGreeting=/);
  assert.equal((await e.DB.prepare('SELECT status FROM hq_calls_out').first()).status, 'talking');
  const bad = await (await HC.hqcAnswer(e, u('hqc', 1), new URLSearchParams({ CallSid: 'CA' + 'c'.repeat(32) }))).text();
  assert.match(bad, /<Hangup\/>/, 'another call never gets on');
});

async function liveRoom(e) {
  await add(e, {}); await HC.hqCallsTick(e, NOON); await HC.hqcAnswer(e, u('hqc', 1), form({}));
  const R = makeRoom(HC.HqCallRoom, e, SID);
  await R.room.ctx.storage.put('id', 1);
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'setup', callSid: SID, from: HC.AO_LINE, to: '+14784530000' }));
  return R;
}
const said = R => R.ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');

test('nobody speaks: after a short wait it opens with who it is, the recording notice and what he needs', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  await R.room.alarm();
  assert.equal(R.ws.sent.length, 0, 'it waits for them first');
  const s = await R.room.load(); s.firstAt = 0; await R.room.keep(s);
  claude = ['Hi, this is an automated assistant calling for Christopher Gates. This call may be recorded. He’d like to book an oil change for Saturday morning.'];
  await R.room.alarm();
  assert.match(said(R), /automated assistant calling for Christopher Gates/); assert.match(said(R), /may be recorded/);
  assert.match(claudeSeen[0].messages[0].content, /nobody has said anything/);
  assert.equal(claudeSeen[0].system[0].cache_control.type, 'ephemeral');
  assert.equal(claudeSeen[0].stream, true);
});

test('a phone menu gets a key press, a hold gets a wait, and the goodbye hangs up and writes the call up once', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  claude = ['[DTMF:2]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Thank you for calling Take 5. For appointments press 2.', last: true }));
  assert.deepEqual(R.ws.sent.find(m => m.type === 'sendDigits'), { type: 'sendDigits', digits: '2' });
  assert.equal(said(R), '', 'nothing spoken over the menu');
  claude = ['Sure.[WAIT]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Please hold.', last: true }));
  assert.ok((await R.room.load()).hold, 'on hold');
  claude = ['Saturday at 9:30 for $89.99 works. That’s Saturday at 9:30, eighty nine ninety nine. If you need him, he’s at 4 7 8, 5 5 5, 0 1 4 2. Thanks, goodbye.[END]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Thanks for holding, we can do 9:30 Saturday, 89.99.', last: true }));
  const s = await R.room.load();
  assert.equal(s.hold, 0); assert.ok(s.endAt > 0);
  assert.doesNotMatch(said(R), /\[END\]|\[WAIT\]|\[DTMF/, 'tags are never read aloud');
  s.endAt = 1; await R.room.keep(s);
  await R.room.alarm();
  assert.ok(R.ws.sent.some(m => m.type === 'end'), 'hangs up after its goodbye');
  claude = [JSON.stringify({ outcome: 'done', summary: 'Booked an oil change Saturday at 9:30 AM, $89.99.', booked: { date: '2026-11-07', t: '09:30', what: 'Oil change at Take 5', place: 'Milledgeville', price: 89.99 } })];
  R.room.ctx.getWebSockets().length = 0;
  await R.room.webSocketClose(R.ws, 1000);
  assert.equal(await R.room.finalize('status'), 'already', 'written up once');
  const r = await e.DB.prepare('SELECT * FROM hq_calls_out').first();
  assert.equal(r.status, 'done'); assert.equal(r.result, 'done'); assert.match(r.summary, /9:30/);
  assert.ok(JSON.parse(r.msgs).length >= 5);
  const plan = await e.DB.prepare("SELECT * FROM hq_plans WHERE key = 'callout-1'").first();
  assert.equal(plan.date, '2026-11-07'); assert.equal(plan.t, '09:30'); assert.equal(plan.src, 'call'); assert.equal(plan.amount, 89.99);
  assert.equal(pushes.length, 1); assert.match(pushes[0].title, /Call to Take 5 Milledgeville: done/); assert.match(pushes[0].body, /Added to your day/);
});

test('a goodbye is said once: their bye back is noted, never answered, and the call hangs up', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  claude = ['Great, Saturday at 9:30 then. Thanks so much, goodbye.[END]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'We can do 9:30 Saturday.', last: true }));
  assert.ok((await R.room.load()).endAt > 0);
  // what happened on the call to his dad: every "Goodbye." got another goodbye
  for (const bye of ['Goodbye.', 'Okay, bye.', 'Thank you, you too.']) {
    await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'interrupt', utteranceUntilInterrupt: 'Thanks so much, goodbye.' }));
    await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: bye, last: true }));
  }
  assert.equal(claudeSeen.length, 1, 'their bye is never answered');
  assert.equal((said(R).match(/goodbye/gi) || []).length, 1, 'one goodbye');
  const s = await R.room.load();
  assert.ok(s.endAt > 0, 'the hang-up stands');
  assert.equal(s.msgs.at(-1).t, 'Thank you, you too.');
  s.endAt = 1; await R.room.keep(s);
  await R.room.alarm();
  assert.ok(R.ws.sent.some(m => m.type === 'end'), 'hangs up');
});

test('a goodbye without [END] still hangs up; a real question over the goodbye gets its answer', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  claude = ['Perfect, see you Saturday. Bye!'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'You are all set for Saturday.', last: true }));
  assert.ok((await R.room.load()).endAt > 0, 'a reply ending in a goodbye hangs up, tag or not');
  claude = ['Nine thirty. Goodbye.[END]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Wait, what time was that again?', last: true }));
  assert.equal(claudeSeen.length, 2, 'a question is answered');
  assert.match(said(R), /Nine thirty/);
  assert.ok((await R.room.load()).endAt > 0);
  // and a question in the middle of a call is never taken for a goodbye
  assert.equal(HC.endsWithGoodbye('Do you want me to tell him goodbye?'), false);
  assert.equal(HC.endsWithGoodbye('Take care, and drive (cut off)'), false);
  assert.equal(HC.endsWithGoodbye('I’ll let Christopher know. Take care, Dad, and drive safe. Goodbye.'), true);
  assert.equal(HC.SEE_YA.test('Love you too, bye!'), true);
  assert.equal(HC.SEE_YA.test('No, not tonight, it is too cold.'), false);
  const sys = HC.systemFor({ kind: 'family', name: 'Dad', relation: 'father' });
  assert.match(sys, /Say goodbye once/);
});

test('their words overtake a reply still being written; "don\'t call" is kept for good', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  claude = ['I’m sorry about that, I’ll make sure of it. Goodbye.[OPTOUT][END]'];
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Take us off your list, we don\'t want robot calls.', last: true }));
  const s = await R.room.load(); assert.ok(s.optout); s.endAt = 1; await R.room.keep(s);
  await R.room.alarm();
  claude = [JSON.stringify({ outcome: 'failed', summary: 'They asked not to get automated calls. Call them yourself.', booked: null })];
  assert.equal(await R.room.finalize('status'), 'done');
  assert.ok(await e.DB.prepare("SELECT 1 AS x FROM call_optout WHERE client_id = 'gates-hq' AND phone10 = '4784530000'").first());
});

test('Claude down mid-call: it asks them to repeat instead of going silent; at the start it apologizes and ends', async () => {
  reset(); const e = env();
  const R = await liveRoom(e);
  await R.room.webSocketMessage(R.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'Take 5, this is Mike.', last: true }));
  assert.match(said(R), /automated assistant calling for Christopher Gates/);
  assert.ok((await R.room.load()).endAt > 0);
});

test('a busy line or no answer is written up as failed with one push; a call nobody spoke on is not "done"', async () => {
  reset(); const e = env();
  await add(e, {}); await HC.hqCallsTick(e, NOON);
  await HC.hqcStatus(e, u('hqcstatus', 1), form({ CallStatus: 'busy' }));
  const r = await e.DB.prepare('SELECT status, result, summary FROM hq_calls_out').first();
  assert.equal(r.status, 'done'); assert.equal(r.result, 'failed'); assert.match(r.summary, /busy/);
  assert.equal(pushes.length, 1); assert.match(pushes[0].title, /didn.t work/);
  assert.deepEqual(await HC.sumUp(e, { goal: 'x' }, [{ r: 'a', t: 'Hi' }]), { result: 'failed', summary: 'Nobody said anything, so the call ended.' });
});

test('a callback to his calls line rings his cell with their number, and he is told who it likely is', async () => {
  reset(); const e = env();
  await add(e, {});
  const x = await (await HC.hqLineCall(e, new URLSearchParams({ From: '+14784530000', To: '+14785550142' }))).text();
  assert.match(x, /<Dial timeout="30" answerOnBridge="true" action="https:\/\/alwaysopenoffice\.com\/voice\/hqlinedone\/k" callerId="\+14784530000"><Number>\+14783652533<\/Number><\/Dial>/);
  assert.equal(pushes.length, 1); assert.match(pushes[0].title, /Take 5 Milledgeville is calling you back/);
  assert.match(await (await HC.hqLineDone(e, new URLSearchParams({ DialCallStatus: 'no-answer' }))).text(), /can’t come to the phone/);
  assert.match(await (await HC.hqLineDone(e, new URLSearchParams({ DialCallStatus: 'completed' }))).text(), /^<\?xml[^>]+><Response><Hangup\/><\/Response>$/);
  const t = await (await HC.hqLineSms(e, new URLSearchParams({ From: '+14784530000', Body: 'Running 10 min behind' }))).text();
  assert.match(t, /<Response><\/Response>/); assert.match(pushes[1].body, /Running 10 min behind/);
});

test('the relay socket only opens for a live Gates HQ call with the right token', async () => {
  reset(); const e = env();
  e.HQCALLROOM = { idFromName: n => n, get: () => ({ fetch: async () => new Response('room') }) };
  await add(e, {}); await HC.hqCallsTick(e, NOON); await HC.hqcAnswer(e, u('hqc', 1), form({}));
  const ws = (t) => new Request('https://alwaysopenoffice.com/voice/hqws/' + SID + '?id=1&t=' + t, { headers: { upgrade: 'websocket' } });
  assert.equal((await HC.hqSocket(ws('nope'), e, SID, new URL(ws('nope').url))).status, 403);
  const t = await HC.wsToken(e, SID);
  assert.equal(await (await HC.hqSocket(ws(t), e, SID, new URL(ws(t).url))).text(), 'room');
});
