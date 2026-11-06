// Build Brief 5 (Nov 5, 2026): the voice gets one whole sentence at a time, each its own utterance, so a sentence
// rises and falls as one breath instead of every few words getting their own tone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');

const run = (toks, opts) => { const sent = []; const sp = new V.Speaker(o => sent.push(o), 'en-US', opts); for (const t of toks) sp.push(t); const spoken = sp.end(); return { sent, spoken, sp }; };
const words = o => o.token.trim();

test('the Nov 5 reply, as it streamed: four utterances, one per sentence', () => {
  const { sent, spoken } = run(['Mm', '-hm. That', "'s two", ' jobs. Answer', 'ing calls, ques', 'tions and follow', '-ups, I do around', ' the clock, and I', "'m not a voicemail. What kind of shop", ' is it?']);
  assert.deepEqual(sent.map(words), ['Mm-hm.', "That's two jobs.", "Answering calls, questions and follow-ups, I do around the clock, and I'm not a voicemail.", 'What kind of shop is it?']);
  assert.ok(sent.every(o => o.last === true), 'each sentence is its own utterance');
  assert.equal(spoken, "Mm-hm. That's two jobs. Answering calls, questions and follow-ups, I do around the clock, and I'm not a voicemail. What kind of shop is it?");
});

test('S.I., Mr., a.m. and prices never split a sentence', () => {
  const { sent } = run(["I'm an S.I. and", ' calls are recorded. Mr. Lane can come at 9 a.m. on', ' Monday. The tank is $1,450.', '00 installed.']);
  assert.deepEqual(sent.map(words), ["I'm an S.I. and calls are recorded.", 'Mr. Lane can come at 9 a.m. on Monday.', 'The tank is $1,450.00 installed.']);
});

test('a long sentence stays one utterance (Nov 5, 6:29 PM: the tone changed where it was split at a comma)', () => {
  const { sent } = run(['Okay. An electric bill is a bit outside my lane too, ', "that one's for your utility company or an electrician."]);
  assert.deepEqual(sent.map(words), ['Okay.', "An electric bill is a bit outside my lane too, that one's for your utility company or an electrician."]);
});

test('tags still work, and nothing after a question is said', () => {
  const r = run(['Thanks for calling. Goodbye. [END]']);
  assert.equal(r.sp.flags.end, true);
  assert.deepEqual(r.sent.map(words), ['Thanks for calling.', 'Goodbye.']);
  const q = run(['Is the water still running? The valve is usually', ' under the sink.']);
  assert.deepEqual(q.sent.map(words), ['Is the water still running?']);
});

test('the first sentence goes out on time even if it runs long', async () => {
  const sent = []; const sp = new V.Speaker(o => sent.push(o), 'en-US');
  sp.push('So the way it works for a shop like yours, every call');
  assert.equal(sent.length, 0, 'held while it may still finish');
  await new Promise(r => setTimeout(r, 1550));
  assert.equal(sent.length, 1, 'out after the cap');
  assert.match(sent[0].token, /like yours,$/);
  sp.push(' gets answered. Then more.');
  sp.end();
  assert.deepEqual(sent.slice(1).map(words), ['every call gets answered.', 'Then more.']);
});

test('a stopped reply (the caller cut in) sends nothing more', () => {
  const sent = []; const sp = new V.Speaker(o => sent.push(o), 'en-US');
  sp.push('First sentence. Second one is'); sp.stop(); sp.push(' still coming.'); sp.end();
  assert.deepEqual(sent.map(words), ['First sentence.']);
});

test('VOICE_CHUNK=word brings back the old pieces', () => {
  const { sent } = run(['Mm', '-hm. That', "'s two jobs."], { chunk: 'word' });
  assert.ok(sent.length >= 3);
  assert.equal(sent.at(-1).last, true);
  assert.equal(sent[0].last, false);
});

// ---------- Part 2: the smaller slips from the same call ----------
const G = await import('../src/guards.js');
const F = await import('../src/facts.js');
const on = new Set(['g-canned']);
test('2c. canned comebacks are cut before they are said, plain answers are kept', () => {
  for (const t of ['Give me a minute to change your mind, and if I don\'t, I\'ll say so.', 'Ha, okay, you\'re testing me.', 'That\'s a sharp ear.', 'The voice is the part I can\'t fully smooth out yet.', 'Nice try.', 'Guilty.'])
    assert.equal(G.guardOne(t, { on, msgs: [], said: '' }), 'g-canned', t);
  for (const t of ['Yep, I\'m an S.I., not a person.', 'What kind of shop is it?', 'No. I don\'t cold-call new customers.'])
    assert.equal(G.guardOne(t, { on, msgs: [], said: '' }), '', t);
  assert.ok(V.LIVE_GUARDS.includes('g-canned'), 'on for every call');
  assert.ok(!Object.values(V.LEADS).flat().some(x => /guilty|nice try|you asked for it/i.test(x)), 'gone from the quick reactions too');
});
test('2a. "Hello?" after a question: Max is here and asks it again, word for word', () => {
  const msgs = [{ r: 'a', t: 'Mm-hm. That\'s two jobs. What kind of shop is it?' }, { r: 'u', t: 'Hello?' }];
  assert.equal(V.fixedReply({}, { kind: 'hear', text: 'Yep, I\'m here.' }, msgs), 'What kind of shop is it?');
  assert.equal(V.fixedReply({}, { kind: 'hear', text: 'Yep, I\'m here.' }, [{ r: 'a', t: 'Can you hear me okay?' }]), '', 'never repeats a can-you-hear-me');
});
test('2b. "That\'s not what I asked": the reply answers their own last question first', () => {
  const s = { line: {}, msgs: [{ r: 'u', t: 'so you\'re telling me that you have no way to bring money in for me' }, { r: 'a', t: 'What kind of shop is it?' }, { r: 'u', t: 'That\'s not what I asked.' }] };
  const notes = String(V.callerNotes(s, 'That\'s not what I asked.'));
  assert.match(notes, /did not answer their question/);
  assert.match(notes, /no way to bring money in/);
  assert.equal(String(V.callerNotes(Object.assign({}, s, { msgs: s.msgs.slice(0, 1) }), 'what does it cost')).indexOf('did not answer'), -1);
});
test('2d. after the S.I. line, straight to the caller; the quiet check-in asks, it does not tease', () => {
  const f = F.ownLineFacts();
  assert.equal(f.greeting2, 'What can I do for you?');
  assert.doesNotMatch(f.nudge, /speechless|told you/i);
});
test('Nov 5, 5:57 PM: a compliment gets a thanks and nothing else; day-to-day comes first; "I come with every plan"', () => {
  const s = { line: {}, msgs: [{ r: 'u', t: 'I think this is the first time you\'ve made me really happy during one of these calls' }] };
  assert.match(String(V.callerNotes(s, s.msgs[0].t)), /compliment[^.]*\. Thank them[^.]*: no question and no pitch/);
  const f = F.ownLineFacts();
  assert.match(f.services, /^Day to day:/);
  assert.match(f.prices, /I come with every plan/);
});

test('6:29 PM call: a personal curveball gets a person\'s reaction and a human answer, not a referral and a pitch', () => {
  assert.equal(V.leadIn('I have a child that is not wanting me to hold them only to mom. What do I do?', 'en-US', [], () => 0).kind, 'personal');
  const notes = String(V.callerNotes({ line: {}, msgs: [] }, 'I have a child that is not wanting me to hold them only to mom. What do I do?'));
  assert.match(notes, /own life/);
  assert.match(notes, /do not ask what business they run/);
  for (const t of ['An electric bill is a bit outside my lane too.', 'Parenting advice is outside what I can help with here.', 'Multilayered sounds interesting, though.'])
    assert.equal(G.guardOne(t, { on, msgs: [], said: '' }), 'g-canned', t);
  assert.notEqual(V.leadIn('my customers keep calling after hours, what do I do?', 'en-US', [], () => 0).kind, 'personal', 'business talk is not personal');
});

test('6:35 PM call: a very long sentence breaks where a person breathes, not where the voice engine cuts it', () => {
  const { sent } = run(["For a day care, every call you miss while you're with the kids gets answered, and you get the parent's name, number and what they need on your phone right away."]);
  assert.equal(sent.length, 2);
  assert.match(sent[0].token, /gets answered,$/);
  assert.ok(sent.every(o => o.token.length <= 112));
  const short = run(["An electric bill is a bit outside my lane too, that one's for your utility company."]);
  assert.equal(short.sent.length, 1, 'under 110 characters: one breath');
});
test('6:35 PM call: "I really don\'t like talking to AI" gets a dry joke about being good at the job', () => {
  const said = "I really don't like talking to AI at all, but I run a business, and I need to know if your company can help.";
  assert.equal(V.leadIn(said, 'en-US', [], () => 0).kind, 'hateai');
  assert.match(String(V.callerNotes({ line: {}, msgs: [] }, said)), /dry, confident joke about being good at your job/);
});

test('7:12 PM call: "fair" once a call; the joke keeps its setup', () => {
  const msgs = [{ r: 'a', t: 'Totally fair.' }];
  assert.equal(V.dropFair("Fair enough, and I'll keep it plain. Katie has it.", msgs), "I'll keep it plain. Katie has it.");
  assert.equal(V.dropFair('Fair, and you did catch me on the bakery.', msgs), 'You did catch me on the bakery.');
  assert.equal(V.dropFair('Fair enough, and I will.', []), 'Fair enough, and I will.', 'the first one stays');
  assert.equal(V.dropFair('Fair.', msgs), 'Fair.', 'never cut to nothing');
  assert.equal(G.guardOne('Most of them earn that reputation.', { on, msgs: [], said: '' }), '', 'the setup for "I\'m annoyingly good at this" stays');
});
test('the monthly page is live all month and sent on the 2nd, never "once a month" (Christopher, Nov 5)', () => {
  const f = F.ownLineFacts();
  assert.match(f.services, /live in the app all month/);
  assert.match(f.services, /never call it that/);
});
