// Nov 25, 2026: a roofer's call to Always Open's own line (Nov 24, 9:37 AM). He asked what his customers would ask ("when
// is my roof going to be done? How long will it take") and the line to Max dropped (Twilio 64105) before a word of the
// answer. The old socket never told the room it had closed (its close came in 15 minutes later), so Twilio's reconnect got
// "Busy" and the call died on his question. Runs the real worker code on the rehearsal harness; nothing touches the internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const CB = await import('../src/callbacks.js');
const { default: worker } = await import('../src/index.js');

const LINE = '+14785551001', CODE = 'r'.repeat(32);
const sidOf = n => 'CA' + String(n).padStart(32, '0');
const QUESTION = 'my customers would ask, when is my roof going to be done? How long will it take';

async function mk() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', ?1, 'Quillen Roofing', 1, 'Pro')")
    .bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, transfer_to, transfer_when, updated, owner_set, tz) VALUES (?1, 'c1', 'Quillen Roofing', 1, 'roofing', 'Eatonton, GA', '', 'never', '2026-11-24', '{}', 'America/New_York')")
    .bind(LINE).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    const r = await hook('in', { CallSid: sid, To: LINE, From: from });
    assert.match(r.text, /<ConversationRelay/);
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    // a socket as Cloudflare has them: open until it is closed
    x.ws.readyState = 1; x.ws.close = function () { this.readyState = 3; };
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return x;
  };
  const socket = () => ({ sent: [], readyState: 1, send(t) { this.sent.push(JSON.parse(t)); }, close() { this.readyState = 3; } });
  const said = ws => ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, hook, room, socket, said, row };
}

// The line drops right after the caller's question, before a word of the answer: what the record looked like on Nov 24.
async function askThenDrop(w, x, sid) {
  const s = await x.room.load();
  s.msgs.push({ r: 'u', t: QUESTION }, { r: 'a', t: '(interrupted)' });
  await x.room.keep(s);
  return w.hook('after', { CallSid: sid, SessionStatus: 'failed', ErrorCode: '64105', SessionDuration: '81' });
}

test('the reconnect after a drop the room never heard about replaces the dead socket, and Max answers the question', async () => {
  const w = await mk();
  const sid = sidOf(924), from = '+12017391534';
  // the fake AI answers the caller's latest words
  const latest = b => { const m = (b.messages || []).at(-1) || {}; return typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''); };
  w.world.aiScript = [b => /roof going to be done/.test(latest(b).slice(-200))
    ? 'The owner gives you the date himself, so nobody gets a guess.' : 'We answer the calls you can\'t get to.'];
  const x = await w.room(sid, from);
  const r = await askThenDrop(w, x, sid);
  assert.match(r.text, /<ConversationRelay/, 'Max comes back on the line');
  assert.match(r.text, /welcomeGreeting="Sorry, we got cut off for a second\."/, 'a plain sorry: the answer follows');
  assert.doesNotMatch(r.text, /Go ahead/, 'never "Go ahead" to someone waiting on an answer');
  // Twilio opens a new socket while the old one still looks open to the room (its close never came)
  assert.equal(x.room.ctx.getWebSockets().length, 1);
  assert.equal(await x.room.canTake(), true, 'not "Busy"');
  assert.equal(x.ws.readyState, 3, 'the dead socket is closed');
  const nw = w.socket();
  x.room.take(nw);
  await x.room.webSocketMessage(nw, JSON.stringify({ type: 'setup', callSid: sid, from }));
  assert.match(w.said(nw), /date himself/, 'the answer to his question goes out on the new socket');
  assert.doesNotMatch(w.said(x.ws), /date himself/, 'nothing goes to the dead one');
  const s = await x.room.load();
  const tail = s.msgs.slice(-3).map(m => m.r + ': ' + m.t);
  assert.deepEqual(tail.slice(0, 2), ['a: Sorry, we got cut off for a second.', 'u: ' + QUESTION]);
  assert.match(tail[2], /^a: .*date himself/);
  assert.equal(s.msgs.filter(m => m.t === '(interrupted)').length, 0, 'the unheard answer is out of the record');
  // the dead socket's close arrives late: the call goes on
  await x.room.webSocketClose(x.ws, 1006, 'WebSocket disconnected without sending Close frame.');
  assert.equal((await x.room.load()).closedAt, 0, 'not taken as the end of the call');
  assert.equal((await w.row(sid)).outcome, 'live');
  // he keeps talking, on the new socket
  await x.room.webSocketMessage(nw, JSON.stringify({ type: 'prompt', voicePrompt: 'okay, what else do you do', last: true }));
  assert.match(w.said(nw), /calls you can't get to/);
  // a second socket with no drop behind it is still refused
  assert.equal(await x.room.canTake(), false);
});

test('a drop mid-answer, or after an answer was heard, still comes back the old way', async () => {
  const w = await mk();
  const sid = sidOf(925), from = '+12017391535';
  const x = await w.room(sid, from);
  await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: 'what is it you do exactly', last: true }));
  assert.ok(w.said(x.ws).length > 0, 'Max answered');
  const r = await w.hook('after', { CallSid: sid, SessionStatus: 'failed', ErrorCode: '64105', SessionDuration: '40' });
  assert.match(r.text, /cut off for a second/);
  assert.equal((await x.room.load()).resumeAsk, '', 'nothing waiting on an answer');
  assert.equal(await x.room.canTake(), true);
  const nw = w.socket();
  x.room.take(nw);
  const before = (await x.room.load()).msgs.length;
  await x.room.webSocketMessage(nw, JSON.stringify({ type: 'setup', callSid: sid, from }));
  const s = await x.room.load();
  assert.equal(s.msgs.length, before + 1, 'only the sorry is added: no answer nobody asked for');
  assert.equal(w.said(nw), '', 'Max waits for the caller');
});

test('what counts as an unanswered question', () => {
  assert.equal(V.unanswered([{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'how long will it take' }]), 'how long will it take', 'no reply yet');
  assert.equal(V.unanswered([{ r: 'u', t: 'how long' }, { r: 'a', t: '(interrupted)' }]), 'how long', 'talked over before a word');
  assert.equal(V.unanswered([{ r: 'u', t: 'how long' }, { r: 'a', t: 'Okay. —', lead: 'Okay.' }]), 'how long', 'only the quick reaction was heard');
  assert.equal(V.unanswered([{ r: 'u', t: 'how long' }, { r: 'a', t: 'Most jobs take —' }]), '', 'part of an answer was heard');
  assert.equal(V.unanswered([{ r: 'u', t: 'how long' }, { r: 'a', t: 'A day or two.' }]), '');
  assert.equal(V.unanswered([{ r: 'a', t: 'Hi.' }]), '');
});

test('every call to our own line has its timing written down; a client\'s real calls do not', () => {
  assert.equal(V.timed({ cid: V.OWN_ID, test: 0 }), true);
  assert.equal(V.timed({ cid: 'c1', test: 1 }), true);
  assert.equal(V.timed({ cid: 'c1', test: 0 }), false);
});

test('our own line has an example answer for a question a caller\'s customers would ask', async () => {
  const F = await import('../src/facts.js');
  const L = Object.assign({ business: 'Always Open', own: true, features: ['v5'] }, F.ownLineFacts());
  const p = V.systemPrompt(L, '+12017391534', 'en-US', false);
  assert.match(p, /Caller: my customers would ask, when is my roof gonna be done, how long will it take\nYou: I'd say you'll give them the date yourself, so nobody gets a guess\./);
});
