// Shoulder Tap: Max asks the owner a caller's question while the caller is still on the line, and says the answer.
// Runs the real worker on the rehearsal harness (D1 on SQLite; Twilio, Claude and the phone pushes faked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const T = await import('../src/tap.js');
const G = await import('../src/guards.js');
const GR = await import('../src/grades.js');
const CB = await import('../src/callbacks.js');
const { setBrand } = await import('../src/sms.js');
const { default: worker } = await import('../src/index.js');

const LINE = '+14785551001', CELL = '+14785557777', OWNER = '+14785550101', CALLER = '+14785550142', CODE = 'q'.repeat(32), CODE2 = 'z'.repeat(32), OWN_LINE = '+17065550000';
const sidOf = n => 'CA' + String(n).padStart(32, '0');
function zoneWhere(want) {
  for (let off = -11; off <= 12; off++) { const h = (new Date().getUTCHours() + off + 24) % 24; if (want(h)) return off === 0 ? 'Etc/GMT' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
  throw new Error('no zone');
}
const DAY_TZ = zoneWhere(h => h >= 11 && h <= 16), NIGHT_TZ = zoneWhere(h => h >= 1 && h <= 4);
const ASK1 = 'Let me check with Mike right now. While I do, what is the address there? [ASK: Do we flush tankless water heaters, and what does it cost?]';

async function mk(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, Object.assign({ OPS_TEXT_TO: '+14783652533' }, o.env || {}));
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  if (o.brand !== false) await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first, regulated) VALUES ('c1', ?1, 'Quillen Plumbing', 1, 'Pro', 'calls', ?2, ?3, ?4)")
    .bind(createHash('sha256').update(CODE).digest('hex'), o.phone === undefined ? '(478) 555-0101' : o.phone, o.first === undefined ? 'Mike' : o.first, o.regulated ? 1 : 0).run();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first) VALUES ('c2', ?1, 'Other Shop', 1, 'Pro', 'calls', '(478) 555-0202', 'Pat')").bind(createHash('sha256').update(CODE2).digest('hex')).run();
  const facts = Object.assign({ features: o.features === undefined ? ['tap'] : o.features }, o.facts || {});
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, transfer_to, transfer_when, updated, owner_set, tz, facts) VALUES (?1, 'c1', 'Quillen Plumbing', 1, ?2, 'plumbing', 'Eatonton, GA', ?3, ?4, '2026-10-01', ?5, ?6, ?7)")
    .bind(LINE, o.regulated ? 1 : 0, o.transferTo === undefined ? CELL : o.transferTo, o.when || 'urgent', JSON.stringify(o.ownerSet || {}), o.tz === undefined ? DAY_TZ : o.tz, JSON.stringify(facts)).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, updated, tz, facts) VALUES (?1, 'always-open', 'Always Open', 1, '2026-10-01', ?2, ?3)").bind(OWN_LINE, DAY_TZ, JSON.stringify(o.ownFacts || {})).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params, query) => {
    const q = query ? '?' + query : '', href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from, to) => {
    const r = await hook('in', { CallSid: sid, To: to || LINE, From: from || CALLER });
    if (!/<ConversationRelay/.test(r.text)) return { twiml: r.text };
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from: from || CALLER }));
    return Object.assign(x, { twiml: r.text, sid });
  };
  const send = (x, m) => x.room.webSocketMessage(x.ws, JSON.stringify(m));
  const say = async (x, words) => { await send(x, { type: 'prompt', voicePrompt: words, last: true }); if (x.room.tapJob) await x.room.tapJob; };
  const tokens = x => x.ws.sent.filter(m => m.type === 'text').map(m => m.token);
  const said = x => tokens(x).join('');
  // what Max has said since a mark (each sentence is its own piece on the wire, so the pieces are joined)
  const at = x => tokens(x).length, since = (x, m) => tokens(x).slice(m).join('').trim();
  let n = 0;
  const text = (from, body, to) => hook('sms', { From: from, To: to || LINE, Body: body, MessageSid: 'SM' + String(++n).padStart(32, '0') });
  const taps = async () => (await DB.prepare('SELECT * FROM call_taps ORDER BY asked_at, rowid').all()).results;
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  const state = x => x.store.get('s');
  const app = (path, json, code) => site.call('/app/' + (code || CODE) + path, json ? { json } : {});
  const hangUp = async x => { await hook('after', { CallSid: x.sid, SessionDuration: '60', SessionStatus: 'ended' }); await site.settle(); };
  const extra = () => { const sys = world.aiSeen.at(-1).system; return sys.length > 1 ? sys[sys.length - 1].text : ''; };
  const prompt = () => world.aiSeen.at(-1).system[0].text;
  return { world, DB, env, site, hook, room, send, say, said, tokens, at, since, text, taps, row, state, app, hangUp, extra, prompt };
}
// A clock the test moves: Max's pauses are decided by Date.now.
function clock() { const real = Date.now; let skew = 0; Date.now = () => real() + skew; return { add(ms) { skew += ms; }, stop() { Date.now = real; } }; }
async function timed(fn) { const c = clock(); try { return await fn(c); } finally { c.stop(); } }

// ---------- the words ----------
test('the question, the answer and the text are cleaned: one line, no control tags, nothing empty', () => {
  assert.equal(T.cleanAsk(' "Can he come [END] tonight" '), 'Can he come END tonight?');
  assert.equal(T.cleanAsk('how much for a flush?'), 'how much for a flush?');
  assert.equal(T.cleanAsk('[]  ...'), '');
  assert.equal(T.cleanAsk('x'.repeat(400)).length, 141, 'short enough for a text');
  assert.equal(T.cleanAnswer('yes\n[TRANSFER] 7pm <b>ok</b> {x}'), 'yes TRANSFER 7pm bok/b x');
  assert.equal(T.cleanAnswer('a'.repeat(500)).length, 240);
  const t = T.tapText({ max: 'Max', caller: '+14785550142', q: 'Can someone come out tonight?' });
  assert.match(t, /^Max: Live call from \(478\) 555-0142\.\nThey ask: "Can someone come out tonight\?"\nReply to this text now and Max tells them\./);
  assert.match(T.tapText({ max: 'Max', name: 'Dana Hill', q: 'x?', biz: 'Quillen Plumbing' }), /^Max: Live call from Dana Hill for Quillen Plumbing\./);
  assert.equal(T.relayLine('Mike', 'yes 7pm.', 'en-US', 'q'), 'I just heard back. Mike says: yes 7pm.');
  assert.equal(T.relayLine('', 'closing early today', 'en-US', ''), 'I just got a note from the owner: closing early today.');
  assert.match(T.relayLine('Mike', 'sí, a las 7', 'es-US', 'q'), /^Ya me respondieron\. Mike dice: sí, a las 7\.$/);
  assert.match(T.missLine('Mike'), /couldn.t reach Mike just now.*call you back/);
  assert.match(T.missLine('', 'es-US'), /el dueño/);
});
test('the wording the AI writes for the answer is used only when it is short and plain', () => {
  assert.equal(T.sayOk('I just heard back from Mike: he can be there by seven tonight'), 'I just heard back from Mike: he can be there by seven tonight.');
  assert.equal(T.sayOk('{"name":"x"}'), '');
  assert.equal(T.sayOk('Sure! [TRANSFER]'), '');
  assert.equal(T.sayOk('ok'), '');
  assert.equal(T.sayOk('x '.repeat(200)), '');
  assert.equal(T.sayOk('One. Two. Three. Four. Five.'), '');
});
test('the call note says what was asked and what came back', () => {
  assert.equal(T.tapSummary([{ id: 'a', q: 'Can you come tonight?', a: 'yes 7' }]), ' Max asked you mid-call: “Can you come tonight?” You answered: “yes 7”');
  assert.match(T.tapSummary([{ id: 'a', q: 'Price for a flush?', a: '' }]), /No answer came in time, so he promised a call back\.$/);
  assert.match(T.tapSummary([{ tell: true, a: 'closing at 4' }, { take: true }]), /You told Max mid-call: “closing at 4” You took the call from the app\./);
  assert.equal(T.tapSummary([]), '');
});

// ---------- the control tag ----------
test('[ASK: ...] is read however the stream splits it, and is never spoken', () => {
  const full = 'Let me check with Mike right now. What is the address? [ASK: Can he come out tonight for a leaking water heater?] ';
  for (let cut = 1; cut < full.length; cut++) {
    const out = [], sp = new V.Speaker(o => out.push(o.token), 'en-US');
    sp.push(full.slice(0, cut)); sp.push(full.slice(cut));
    const spoken = sp.end();
    assert.equal(spoken, 'Let me check with Mike right now. What is the address?', 'cut at ' + cut);
    assert.equal(sp.flags.ask, 'Can he come out tonight for a leaking water heater?', 'cut at ' + cut);
    assert.ok(!out.join('').includes('ASK'), 'cut at ' + cut);
  }
  const one = new V.Speaker(() => {}, 'en-US');
  for (const ch of 'Sure. [ask: price for a flush] [END]') one.push(ch);
  one.end();
  assert.equal(one.flags.ask, 'price for a flush'); assert.equal(one.flags.end, true);
});
test('a hand-off to a business with a long name is acted on, not read out (it was spoken when the stream split it)', () => {
  const out = [], sp = new V.Speaker(o => out.push(o.token), 'en-US');
  for (const c of ['One moment, putting you through. ', '[HANDOFF:Lane Elec', 'tric and Generator Company]']) sp.push(c);
  assert.equal(sp.end(), 'One moment, putting you through.');
  assert.equal(sp.flags.handoff, 'Lane Electric and Generator Company');
  assert.ok(!out.join('').includes('HANDOFF'));
});
test('a control tag is one piece when a reply is split into sentences, whatever punctuation it carries', () => {
  assert.deepEqual(G.sentencesOf('Let me check. What is the address? [ASK: Can he come tonight? They have a leak.] [END]'), ['Let me check. ', 'What is the address? ', '[ASK: Can he come tonight? They have a leak.] [END]']);
  assert.deepEqual(G.sentencesOf('It costs $1,450.00 total. Call at seven p.m. sharp. Bye.'), ['It costs $1,450.00 total. ', 'Call at seven p.m. sharp. ', 'Bye.'], 'ordinary sentences split as before');
  // the caller is wrapping up ("thanks"): questions are cut from the reply, but never a tag that happens to end in "?"
  assert.equal(V.cutBizQ('Sounds good. Anything else? [BOOK 2 | Dana | leaking faucet?]', false, true), 'Sounds good. [BOOK 2 | Dana | leaking faucet?]');
});

// ---------- Max's instructions ----------
test('the rule is in Max’s instructions only on a call where the owner can be asked, in both prompt styles', () => {
  const L = V.lineView({ business: 'Quillen Plumbing', facts: '{}', client_id: 'c1' });
  assert.doesNotMatch(V.systemPrompt(L, '', 'en-US', false), /\[ASK/);
  const on = Object.assign({}, L, { tap: { who: 'Mike' } });
  const p = V.systemPrompt(on, '', 'en-US', false);
  assert.match(p, /Let me check with Mike right now/); assert.match(p, /\[ASK: the question for Mike/); assert.match(p, /never for an emergency/);
  const p6 = V.systemPrompt(Object.assign({}, on, { features: ['prompt6'] }), '', 'en-US', false);
  assert.match(p6, /\[ASK: the question for Mike, 12 words or fewer\]/);
  assert.match(V.systemPrompt(Object.assign({}, L, { tap: { who: '' } }), '', 'en-US', false), /Let me check with the owner right now/);
  assert.ok(p.length - V.systemPrompt(L, '', 'en-US', false).length < 1100, 'the rule is short');
});

// ---------- a whole call ----------
test('Max asks, the owner answers by text, and the caller hears it in the same call', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK1, 'Thursday works. What is the best number for you?', 'You are all set. Talk soon. [END]'];
  w.world.aiNote = { name: 'Dana', callback: CALLER, reason: 'Tankless flush', details: '', when: 'Thursday', urgent: false, callback_wanted: true, booked: 'yes', spam: false, summary: 'Dana wants a tankless water heater flush on Thursday.' };
  const x = await w.room(sidOf(1));
  await w.say(x, 'Hi, do you guys flush tankless water heaters, and how much is it?');
  assert.match(w.said(x), /Let me check with Mike right now\. While I do, what is the address there\?$/);
  assert.ok(!/ASK|tankless water heaters, and what does it cost/.test(w.said(x)), 'the tag is never spoken');
  // the owner's phone: one text, on their own number, with the question
  assert.equal(w.world.ownerTexts.length, 1);
  assert.equal(w.world.ownerTexts[0].To, OWNER);
  assert.equal(w.world.ownerTexts[0].From, LINE, 'from the business’s own line, so a reply comes back to it');
  assert.match(w.world.ownerTexts[0].Body, /^Max: Live call from \(478\) 555-0142\.\nThey ask: "Do we flush tankless water heaters, and what does it cost\?"/);
  assert.equal(w.world.texts.length, 0, 'the caller is not texted');
  // the app's live card shows the question
  const st = (await w.app('/api/state')).json();
  assert.equal(st.live.length, 1);
  assert.equal(st.live[0].tap.q, 'Do we flush tankless water heaters, and what does it cost?');
  assert.ok(st.live[0].tap.left > 60 && st.live[0].tell === true && st.live[0].take === true);
  assert.deepEqual([st.tap.on, st.tap.when], [true, 'day']);
  // the owner replies; Max has just asked the caller a question, so he gives them a moment before speaking up
  const r = await w.text(OWNER, 'Yes we do. $189 for a flush, can do Thursday');
  assert.match(r.text, /<Message>Got it\. Max tells them as soon as they stop talking\.<\/Message>/);
  const m = w.at(x);
  c.add(1000); await x.room.alarm();
  assert.equal(w.since(x, m), '', 'nothing said over the caller\u2019s chance to answer');
  c.add(12000);
  await x.room.alarm();
  assert.equal(w.since(x, m), 'I just heard back. Mike says: Yes we do. $189 for a flush, can do Thursday.');
  // the next reply knows the answer and builds on it
  await w.say(x, 'Great, Thursday works for me.');
  assert.match(w.extra(), /Mike answered the question "Do we flush tankless water heaters, and what does it cost\?": "Yes we do\. \$189 for a flush, can do Thursday"/);
  assert.match(w.prompt(), /During this call, just now, Mike answered the caller's question/, 'the owner’s word is in what Max knows');
  await w.say(x, 'Four seven eight, five five five, zero one four two. Thanks, bye.');
  await w.hangUp(x);
  const call = await w.row(x.sid);
  assert.equal(call.outcome, 'done');
  assert.match(call.summary, /^Dana wants a tankless water heater flush on Thursday\. Max asked you mid-call: “Do we flush tankless water heaters, and what does it cost\?” You answered: “Yes we do\. \$189 for a flush, can do Thursday”$/);
  const taps = await w.taps();
  assert.equal(taps.length, 1);
  assert.deepEqual([taps[0].status, taps[0].via, taps[0].kind, taps[0].notified], ['answered', 'text', 'ask', 'text,push']);
  // the reply was an answer for the caller, never a standing note for Max
  assert.equal((await w.DB.prepare('SELECT owner_set FROM voice_lines WHERE number = ?1').bind(LINE).first()).owner_set, '{}');
  assert.equal((await w.DB.prepare("SELECT COUNT(*) AS n FROM biz_msgs WHERE client_id = 'c1'").first().catch(() => ({ n: 0 }))).n, 0, 'nor a message in the owner’s own inbox');
  // and nothing Max said from the owner’s answer is graded as a made-up price or promise
  const s = { line: Object.assign(V.lineView({ business: 'Quillen Plumbing', facts: '{}', client_id: 'c1' }), { tap: { who: 'Mike' }, owner: 'During this call, just now, Mike answered the caller\'s question "x": "Yes we do. $189 for a flush, can do Thursday".' }) };
  assert.deepEqual(GR.hardErrors([{ r: 'u', t: 'how much' }, { r: 'a', t: 'I just heard back. Mike says: Yes we do. $189 for a flush, can do Thursday.' }, { r: 'u', t: 'ok' }, { r: 'a', t: 'So that is $189, and Mike will be there Thursday.' }], s.line), []);
  assert.equal(w.world.unmocked.length, 0, 'nothing reached for the internet: ' + w.world.unmocked.join(', '));
}));

test('an answer that lands while the caller is talking is the first thing they hear next', async () => timed(async () => {
  const w = await mk();
  w.world.aiScript = [ASK1, 'And what is the best number for you?'];
  const x = await w.room(sidOf(2));
  await w.say(x, 'Do you flush tankless water heaters, and how much is it?');
  const r = await w.text(OWNER, 'yes');   // "yes" alone is also the carriers' START word: here it is an answer
  assert.match(r.text, /Got it\./);
  const before = w.tokens(x).length;
  await w.say(x, 'It is twelve Oak Street in Eatonton.');
  const after = w.tokens(x).slice(before);
  assert.equal(after[0], 'I just heard back. Mike says: yes.', 'the owner’s word first, in place of the quick reaction');
  assert.match(after.join(''), /best number/);
  assert.match(w.extra(), /You just said "I just heard back\. Mike says: yes\." out loud/);
  const s = w.state(x);
  assert.equal(s.msgs.at(-1).t, 'I just heard back. Mike says: yes. And what is the best number for you?');
  assert.equal(s.tapGot, null);
}));

test('the AI’s plain-speech wording is said when it comes back in time', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]', 'Perfect.'];
  w.world.aiRelay = 'I just heard back from Mike: he can be there by seven tonight.';
  const x = await w.room(sidOf(3));
  await w.say(x, 'Can somebody come out tonight to look at my disposal?');
  c.add(6000);   // Max finished his sentence a while ago
  const m = w.at(x);
  const r = await w.text(OWNER, 'yea 7pm');
  assert.match(r.text, /Got it\. Max is telling them now\./);
  assert.equal(w.since(x, m), 'I just heard back from Mike: he can be there by seven tonight.');
  assert.match(w.world.relaySeen[0].messages[0].content, /The owner's name: Mike\nThe caller asked: Can he come out tonight\?\nThe owner texted back: yea 7pm/);
  // both the owner's words and the spoken wording are now things Max knows, so repeating them is not a made-up promise
  assert.match(w.state(x).line.owner, /"yea 7pm"\. \(Said to the caller as: "I just heard back from Mike: he can be there by seven tonight\."\)$/);
}));

test('no answer in time: Max says they will get a call back, and a late reply is kept on the call instead of becoming a note for Max', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK1, 'Okay.'];
  w.world.aiNote = { name: '', callback: '', reason: 'Tankless flush price', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'A caller asked about a tankless flush.' };
  const x = await w.room(sidOf(4));
  await w.say(x, 'Do you flush tankless water heaters, and how much is it?');
  const m = w.at(x);
  c.add(T.TAP_WAIT_MS + 2000);
  await x.room.alarm();
  assert.equal(w.since(x, m), 'I couldn\u2019t reach Mike just now, but they have your question and will call you back about it.');
  assert.equal((await w.taps())[0].status, 'timeout');
  await w.say(x, 'Okay, thanks.');
  assert.match(w.extra(), /You could not reach Mike in time and told the caller they will get a call back/);
  await w.hangUp(x);
  assert.match((await w.row(x.sid)).summary, /Max asked you mid-call: .* No answer came in time, so he promised a call back\.$/);
  // three minutes later the owner sees the text and answers
  c.add(180000);
  const r = await w.text(OWNER, 'yes $189');
  assert.match(r.text, /<Message>That call ended before your answer got there\. They asked: "Do we flush tankless water heaters, and what does it cost\?"\. Call them back: \(478\) 555-0142\.<\/Message>/);
  assert.match((await w.row(x.sid)).summary, /You answered after the call ended: “yes \$189”$/);
  assert.equal((await w.taps())[0].status, 'late');
  assert.equal((await w.DB.prepare('SELECT owner_set FROM voice_lines WHERE number = ?1').bind(LINE).first()).owner_set, '{}', 'not saved as something Max tells every caller');
  // after that, a text from the owner is a note for Max again
  c.add(11 * 60000);
  const note = await w.text(OWNER, 'Closed this Friday for the holiday');
  assert.doesNotMatch(note.text, /call ended/);
  assert.match((await w.DB.prepare('SELECT owner_set FROM voice_lines WHERE number = ?1').bind(LINE).first()).owner_set, /Closed this Friday/);
}));

test('a quiet caller hears that Max is still checking, never "Are you there?", and the usual check-ins come back after the answer', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]'];
  const x = await w.room(sidOf(5));
  await w.say(x, 'Can somebody come out tonight to look at my disposal?');
  let m = w.at(x);
  c.add(12000); await x.room.alarm();
  assert.equal(w.since(x, m), 'Still checking with Mike. One more moment.');
  m = w.at(x);
  c.add(8000); await x.room.alarm();
  assert.equal(w.since(x, m), '', 'not again so soon');
  c.add(16000); await x.room.alarm();
  assert.equal(w.since(x, m), 'Still with you. Just waiting to hear back.');
  assert.ok(!/are you there|still there|not hearing/i.test(w.said(x)));
  m = w.at(x);
  await w.text(OWNER, 'no, tomorrow at 8');
  c.add(4000); await x.room.alarm();   // once Max has finished saying he is still waiting
  assert.equal(w.since(x, m), 'I just heard back. Mike says: no, tomorrow at 8.');
  m = w.at(x);
  c.add(12000); await x.room.alarm();
  assert.match(w.since(x, m), /^(Hello\?|You still with me\?)$/, 'silence after the answer is ordinary silence again');
}));

test('from the app: answer the question, tell Max something, or take the call; another business cannot touch the call', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]', 'Okay.'];
  const x = await w.room(sidOf(6));
  await w.say(x, 'Can somebody come out tonight to look at my disposal?');
  const tap = (await w.app('/api/state')).json().live[0].tap, m0 = w.at(x);
  // a stranger's app, a tech, a bad id
  assert.equal((await w.app('/api/tap', { call: x.sid, id: tap.id, text: 'hello' }, CODE2)).status, 404, 'another business');
  await w.DB.prepare("INSERT INTO app_staff (code_hash, client_id, name, role) VALUES (?1, 'c1', 'Terry', 'tech')").bind(createHash('sha256').update('t'.repeat(32)).digest('hex')).run();
  assert.equal((await w.app('/api/tap', { call: x.sid, id: tap.id, text: 'hello' }, 't'.repeat(32))).status, 400, 'a tech');
  assert.equal((await w.app('/api/state', null, 't'.repeat(32))).json().live[0].tap, undefined, 'a tech sees the call, not the controls');
  assert.equal((await w.app('/api/tap', { call: 'CAnope', text: 'hello' })).status, 400);
  assert.equal((await w.app('/api/tap', { call: x.sid, text: '   ' })).status, 400);
  assert.equal(w.at(x), m0, 'none of that reached the caller');
  c.add(6000);
  let m = w.at(x);
  const a = (await w.app('/api/tap', { call: x.sid, id: tap.id, text: 'Yes, 7 tonight' })).json();
  assert.deepEqual([a.ok, a.state], [true, 'said']);
  assert.equal(w.since(x, m), 'I just heard back. Mike says: Yes, 7 tonight.');
  assert.equal((await w.app('/api/state')).json().live[0].tap, null, 'the question is closed');
  // a line of the owner's own, with no question out
  c.add(6000); m = w.at(x);
  const t = (await w.app('/api/tap', { call: x.sid, text: 'Tell them to leave the gate open' })).json();
  assert.equal(t.state, 'said');
  assert.equal(w.since(x, m), 'I just got a note from Mike: Tell them to leave the gate open.');
  // take the call: Max says so and hands the call to Twilio to ring the owner
  m = w.at(x);
  const k = (await w.app('/api/tap', { call: x.sid, action: 'take' })).json();
  assert.equal(k.state, 'said');
  assert.equal(w.since(x, m), 'Good news: Mike can take your call right now. One moment while I connect you.');
  await w.say(x, 'Okay, thank you.');
  assert.equal(w.since(x, m), 'Good news: Mike can take your call right now. One moment while I connect you.', 'nothing more is said once they are being put through');
  c.add(15000); await x.room.alarm();
  assert.deepEqual(JSON.parse(x.ws.sent.at(-1).handoffData), { reason: 'transfer' });
  const after = await w.hook('after', { CallSid: x.sid, SessionDuration: '40', SessionStatus: 'ended', HandoffData: '{"reason":"transfer"}' });
  assert.match(after.text, /<Dial[^>]*>.*<Number[^>]*>\+14785557777<\/Number>/);
  const late = (await w.app('/api/tap', { call: x.sid, text: 'one more thing' })).json();
  assert.equal(late.state, 'late');
  const kinds = (await w.taps()).map(r => r.kind + ':' + r.status + ':' + r.via);
  assert.deepEqual(kinds, ['ask:answered:app', 'tell:answered:app', 'take:answered:app']);
}));

test('taking the call needs a number to ring; with none on file the app says so and the call carries on', async () => timed(async () => {
  const w = await mk({ transferTo: '' });
  w.world.aiScript = ['Sure, what is the address?'];
  const x = await w.room(sidOf(7));
  await w.say(x, 'I need a plumber next week.');
  const k = await w.app('/api/tap', { call: x.sid, action: 'take' });
  assert.equal(k.status, 400); assert.match(k.json().error, /number Max should ring/);
  assert.equal(w.state(x).transfer, false);
  assert.equal((await w.app('/api/state')).json().live[0].take, false);
}));

test('when Max may ask: not on a regulated line, not when the owner switched it off, not at night, never without a phone to reach, and not too often', async () => {
  const asked = async (o, from) => { const w = await mk(o); w.world.aiScript = ['Okay.']; const x = await w.room(sidOf(8), from); await w.say(x, 'How much is a tankless flush?'); return /\[ASK/.test(w.prompt()); };
  assert.equal(await asked({}), true, 'the usual case');
  assert.equal(await asked({ regulated: true }), false, 'an insurance or medical line takes messages only');
  assert.equal(await asked({ ownerSet: { tap: 'off' } }), false, 'the owner switched it off');
  assert.equal(await asked({ features: [] }), false, 'the line does not have it');
  assert.equal(await asked({ tz: NIGHT_TZ }), false, 'the middle of the owner’s night');
  assert.equal(await asked({ tz: NIGHT_TZ, ownerSet: { tap: 'always' } }), true, 'unless they said any hour');
  assert.equal(await asked({ phone: '' }), false, 'no phone on file');
  // the owner's own test call may try it at any hour, and before real callers get it
  assert.equal(await asked({ tz: NIGHT_TZ, features: [], facts: { testers: OWNER, testFeatures: ['tap'] } }, OWNER), true);
  assert.equal(await asked({ features: [], facts: { testFeatures: ['tap'] } }), false, 'a real caller does not get a test feature');
  // twelve questions in an hour is enough for anyone
  const w = await mk(); await T.ensureTaps(w.env);
  for (let i = 0; i < T.TAP_PER_HOUR; i++) await w.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) VALUES (?1, 'CAx', 'c1', 'ask', 'q?', ?2, 'timeout')").bind('tp' + i, new Date().toISOString()).run();
  w.world.aiScript = ['Okay.']; const x = await w.room(sidOf(9)); await w.say(x, 'How much is a tankless flush?');
  assert.doesNotMatch(w.prompt(), /\[ASK/);
});

test('the owner’s switch: off, daytime or any hour, the owner only', async () => {
  const w = await mk();
  assert.equal((await w.app('/api/line', { tap: 'always' })).json().ok, true);
  assert.equal((await w.app('/api/state')).json().tap.when, 'always');
  assert.equal((await w.app('/api/line', { tap: 'off' })).json().ok, true);
  assert.deepEqual([(await w.app('/api/state')).json().tap.when, T.tapPref(await w.DB.prepare('SELECT * FROM voice_lines WHERE number = ?1').bind(LINE).first())], ['off', 'off']);
  assert.equal((await w.app('/api/line', { tap: 'sometimes' })).status, 400);
  await w.DB.prepare("INSERT INTO app_staff (code_hash, client_id, name, role) VALUES (?1, 'c1', 'Sam', 'manager')").bind(createHash('sha256').update('s'.repeat(32)).digest('hex')).run();
  assert.equal((await w.app('/api/line', { tap: 'day' }, 's'.repeat(32))).status, 403);
  assert.equal((await w.app('/api/line', { tap: 'day' })).json().ok, true);
  assert.equal((await w.app('/api/state')).json().tap.when, 'day');
});

test('a business whose own texting is not registered yet is asked from the Always Open number, and the reply finds the call', async () => timed(async c => {
  const w = await mk({ brand: false });
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]'];
  const x = await w.room(sidOf(10));
  await w.say(x, 'Can somebody come out tonight to look at my disposal?');
  assert.equal(w.world.ownerTexts.length, 1);
  assert.equal(w.world.ownerTexts[0].MessagingServiceSid, w.env.TWILIO_MESSAGING_SID, 'through Always Open’s own registration');
  assert.match(w.world.ownerTexts[0].Body, /^Max: Live call from \(478\) 555-0142 for Quillen Plumbing\./);
  c.add(6000);
  // someone else texting that number is not an answer
  const m = w.at(x);
  const other = await w.text('+14785559999', 'yes come on', OWN_LINE);
  assert.doesNotMatch(other.text, /Got it/);
  assert.equal(w.since(x, m), '');
  const r = await w.text(OWNER, 'Yes, about 7', OWN_LINE);
  assert.match(r.text, /Got it\. Max is telling them now\./);
  assert.equal(w.since(x, m), 'I just heard back. Mike says: Yes, about 7.');
}));

test('Always Open’s own line asks Christopher, and his reply to that number is the answer', async () => timed(async c => {
  const w = await mk({ ownFacts: { features: ['tap'] } });
  w.world.aiScript = ['Let me check with Christopher right now. [ASK: Can he do a demo for a marina this week?]'];
  const x = await w.room(sidOf(11), CALLER, OWN_LINE);
  await w.say(x, 'Could someone show my marina how this works this week?');
  assert.match(w.prompt(), /Let me check with Christopher right now/);
  assert.equal(w.world.ownerTexts.at(-1).To, '+14783652533');
  assert.ok(w.world.pushes.some(p => /Max is asking you/.test(p.title)), 'and a push to his phone');
  c.add(6000);
  const m = w.at(x);
  const r = await w.text('+14783652533', 'Yes Thursday at 2', OWN_LINE);
  assert.match(r.text, /Got it\. Max is telling them now\./);
  assert.equal(w.since(x, m), 'I just heard back. Christopher says: Yes Thursday at 2.');
}));

test('limits: a third question in one call, or a second while the first is open, gets the call-back promise; a tag on a line without Shoulder Tap does nothing', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = ['Let me check. [ASK: one?]', 'Let me check again. [ASK: two?]', 'And again. [ASK: three?]', 'Okay.'];
  const x = await w.room(sidOf(12));
  await w.say(x, 'First question for the owner.');
  await w.say(x, 'Second question for the owner.');   // the first is still open
  assert.equal(w.world.ownerTexts.length, 1, 'one question out at a time');
  assert.match(w.said(x), /Let me check again\.$/);
  let m = w.at(x);
  c.add(6000); await x.room.alarm();
  assert.match(w.since(x, m), /couldn.t reach Mike just now/);
  await w.text(OWNER, 'answer one'); c.add(6000); await x.room.alarm();
  await w.say(x, 'Third question.');
  assert.equal(w.world.ownerTexts.length, 2, 'a second question once the first is answered');
  await w.text(OWNER, 'answer three'); c.add(6000); await x.room.alarm();
  await w.say(x, 'Fourth question.');
  assert.match(w.extra(), /You have already checked with Mike 2 times on this call: do not use \[ASK\] again/);
  const off = await mk({ features: [] });
  off.world.aiScript = ['Sure. [ASK: something?]'];
  const y = await off.room(sidOf(13));
  await off.say(y, 'A question.');
  assert.match(off.said(y), /Sure\.$/); assert.ok(!/ASK|something/.test(off.said(y)));
  assert.equal(off.world.ownerTexts.length, 0);
  assert.equal(off.state(y).tap, undefined);
}));

test('when the owner cannot be told at all, the caller is not left waiting a minute', async () => timed(async c => {
  const w = await mk();
  await w.DB.prepare("CREATE TABLE IF NOT EXISTS sms_optout (client_id TEXT NOT NULL, phone10 TEXT NOT NULL, at TEXT, PRIMARY KEY (client_id, phone10))").run();
  await w.DB.prepare("INSERT INTO sms_optout (client_id, phone10, at) VALUES ('c1', '4785550101', '2026-11-01')").run();   // the owner once texted STOP to their own line
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]'];
  const x = await w.room(sidOf(14));
  await w.say(x, 'Can somebody come out tonight?');
  assert.equal(w.world.ownerTexts.length, 0);
  const m = w.at(x);
  c.add(5000); await x.room.alarm();
  assert.match(w.since(x, m), /couldn.t reach Mike just now/, 'within seconds, not after the full wait');
}));

test('the answer is said even when a busy turn wrote over it', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can he come out tonight?]'];
  const x = await w.room(sidOf(15));
  await w.say(x, 'Can somebody come out tonight?');
  await w.text(OWNER, 'yes at 7');
  // an older copy of the call is saved over the answer (a reply that was finishing as the text arrived)
  const s = w.state(x); s.tapGot = null; x.store.set('s', s);
  const m = w.at(x);
  c.add(6000); await x.room.alarm();
  assert.equal(w.since(x, m), 'I just heard back. Mike says: yes at 7.');
}));

test('a practice call can try Shoulder Tap: the question Max sends is noted, and a scripted owner answer reaches the next reply', async () => {
  const w = await mk();
  w.world.aiScript = ['Let me check with Mike right now. What is the address? [ASK: Can he come out tonight for a jammed disposal?]', 'Great, seven tonight it is. And the best number?', 'Talk soon. [END]'];
  await w.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-request', ?2)").bind(new Date().toISOString(),
    JSON.stringify({ number: LINE, tag: 'tap-try', features: ['tap'], who: 'Mike', calls: [{ id: 'tonight', turns: ['My disposal is jammed, can somebody come out tonight?', { owner: 'yes 7pm' }, 'Perfect, seven works.', 'Same number. Thanks, bye.'] }] })).run();
  await V.rehearse(w.env);
  const r = JSON.parse((await w.DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").first()).detail);
  assert.equal(r.out[0].ask, 'Can he come out tonight for a jammed disposal?');
  assert.deepEqual(r.out[1], { owner: 'yes 7pm', relay: 'I just heard back. Mike says: yes 7pm.' });
  assert.equal(r.out.length, 4);
  // the turn after the answer was told what the owner said, and that the caller has heard it
  const notes = w.world.aiSeen.map(b => b.system.length > 1 ? b.system[b.system.length - 1].text : '');
  assert.match(notes[0], /^(?!.*No answer yet)/);
  assert.match(notes[1], /Mike answered the question "Can he come out tonight for a jammed disposal\?": "yes 7pm"\. You told the caller in these words: "I just heard back\. Mike says: yes 7pm\."/);
  assert.match(w.world.aiSeen[1].system[0].text, /During this call, just now, Mike answered the caller's question/);
  assert.deepEqual(r.hard, [], 'repeating the owner’s time is not a made-up promise: ' + JSON.stringify(r.hard));
  // a practice call without the switch never gets the rule
  w.world.aiSeen.length = 0;
  await w.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-request', ?2)").bind(new Date().toISOString(), JSON.stringify({ number: LINE, tag: 'tap-off', features: [], calls: [['How much is a flush?']] })).run();
  await V.rehearse(w.env);
  assert.doesNotMatch(w.world.aiSeen[0].system[0].text, /\[ASK/);
});
