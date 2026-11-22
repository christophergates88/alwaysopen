// Nov 21, 2026, 10:30 PM: the 13 test calls replayed on the live line, as prospects hear Max and as Christopher's phone
// hears him (26 calls). Nothing false was said, but six slips came back. Each test below runs the reply the live model
// actually wrote on that call through the same checks a live call runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const G = await import('../src/guards.js');

const L = { business: 'Always Open', own: true, features: [], prices: 'Starter is $149 a month, Growth is $299 a month, and Pro is $499 a month.' };
// a call so far: alternating caller and Max lines, after the greeting
const call = (...lines) => [{ r: 'a', t: 'Always Open, this is Max, an automated assistant. How can I help?' }].concat(lines.map((t, i) => ({ r: i % 2 ? 'a' : 'u', t })));
const run = (raw, msgs) => { const r = G.guardText(raw, V.guardCtx(L, msgs, msgs.filter(m => m.r === 'u').at(-1).t, {})); return { text: r.text.trim(), cuts: r.cuts }; };

// ---------- the call back, offered a third time ----------
const marcy = [
  'hi um this is marcy with sparkle maids no wait its spotless maids, sorry spotless maids of milledgeville',
  'Spotless Maids of Milledgeville. Happy to have you, Marcy. What can I do for you?',
  'who actually runs all ways open like whos the owner',
  'Christopher Gates runs it. Everyone calls him Chris, and he handles client support himself. Want me to have him call you?',
  'and how long have yall been around and how many clients you got',
  'That one\'s Chris\'s to answer, since he knows the whole story. What I can tell you is we\'re a small team near Lake Oconee in central Georgia. Want him to walk you through it on a call?',
  'can you just give me chris\'s personal cell phone i want to text him directly'];

test('replay: "Want me to set that up?" after "he calls back" is the third offer of a call back, and is held back', () => {
  const out = run('I keep his cell private, Marcy, but he calls back within one business day. Want me to set that up?', call(...marcy));
  assert.equal(out.text, 'I keep his cell private, Marcy, but he calls back within one business day.');
  assert.deepEqual(out.cuts.map(c => c.guard), ['g-callback']);
  // and it counts as an offer once said
  assert.equal(G.callbackOffers(call(...marcy, 'I keep his cell private, Marcy, but he calls back within one business day. Want me to set that up?')).offered, 3);
  // "set that up" about something else is not a call back
  assert.equal(G.callbackOffers(call('hi', 'I can text you a free audit of how you look on Google. Want me to set that up?')).offered, 0);
  // "Want me to have Chris walk you through it?" is one
  assert.equal(G.callbackOffers(call('hi', 'Plans run $149, $299 or $499. Want me to have Chris walk you through it?')).offered, 1);
});

test('replay: the song is sung whole, and the number is not asked for a call back she never said yes to', () => {
  const msgs = call(...marcy, 'I keep his cell private, Marcy, but he calls back within one business day. Want me to set that up?', 'come on i know you have it. ok then sing me a little song about clean houses');
  const raw = 'Still keeping that number to myself. Here\'s your song, and it\'s not great on purpose: "Clean houses, shiny floors, nobody missed a call at your doors. Sparkle, spotless, ring ring ring, Always Open answers everything." Now, want Chris to call you back? Is four zero four, five five five, zero one eight seven the best number?';
  const out = run(raw, msgs);
  assert.equal(out.text, 'Still keeping that number to myself. Here\'s your song, and it\'s not great on purpose: "Clean houses, shiny floors, nobody missed a call at your doors. Sparkle, spotless, ring ring ring, Always Open answers everything."');
  assert.deepEqual(out.cuts.map(c => c.guard), ['g-callback', 'g-callback']);
  // live, the room holds what it has cut so far in the same object, sentence by sentence
  const ctx = V.guardCtx(L, msgs, msgs.at(-1).t, {});
  let spoken = '';
  for (const p of G.sentencesOf(raw)) { const g = G.guardOne(p, Object.assign(ctx, { spoken })); if (!g) spoken += p; }
  assert.equal(spoken.trim(), out.text);
});

test('replay: after a caller asks for the call, the ask for their name or number still goes out', () => {
  const msgs = call('what does it cost', 'Starter is $149 a month. Want Chris to call you?', 'maybe', 'Sure. Want me to have Chris walk you through it?', 'alright have somebody call me back');
  assert.equal(G.callbackOffers(msgs).taken, true, 'asking for the call is a yes');
  const out = run('Sure thing. Want Chris to give you a call? What\'s your name?', msgs);
  assert.equal(out.text, 'Sure thing. What\'s your name?', 'the offer is not needed; the name is');
  assert.equal(G.callbackOffers(call('hi', 'Want Chris to call you?', 'please don\'t call me, just text')).taken, false);
  assert.equal(G.callbackOffers(call('i don\'t need a callback, just tell me the price')).taken, false);
  // the audit said yes to: the number for it is still asked, even right after an offer was held back
  const audit = call('what do you do', 'We answer every call. Want Chris to call you?', 'no', 'Okay. Want me to have him walk you through it later?', 'nah', 'Fair enough. Want a free audit of how you look on Google, by text?', 'yeah send it');
  assert.equal(run('Will do. Want Chris to call you too? Is four zero four, five five five, zero one eight seven the best number for it?', audit).text, 'Will do. Is four zero four, five five five, zero one eight seven the best number for it?');
});

// ---------- the length cut took the sentence the caller most needed ----------
test('replay: a limit or a plan, said the first time, is not cut for length', () => {
  const golf = call('I\'m just trying to ask questions to figure out the website that I found. What is it?', 'It\'s alwaysopenoffice.com. That\'s Always Open, and we set up a phone assistant that answers a business\'s calls any hour.',
    'Shop out of course. I\'m down in Atlanta.', 'A golf shop, nice. When your shop is busy and a call goes unanswered, I pick up and text you who called.',
    'Okay. Appreciate it. When someone calls, can you make a tea time for them? or do I have to do that?');
  const out = run('I can. If you use Google Calendar, I offer real open times from your hours and book it right on the call, or pencil it in for you to confirm, your pick. If your tee sheet is separate software, it doesn\'t connect. In that case I take the time they want and Shoulder Tap you to check it while they wait. Which setup do you have?', golf);
  assert.match(out.text, /If your tee sheet is separate software, it doesn't connect\. Which setup do you have\?$/, out.text);
  assert.doesNotMatch(out.text, /In that case/, 'the how-to after it is still cut');
  const dog = call('ok and the storm desk thing is that for me or just for like roofers');
  assert.match(run('It\'s for anyone, you included. When the weather service issues a warning for your county, it drafts a storm-day post for you to approve. For a groomer, that could be a note about keeping dogs calm in a storm. It\'s on Growth and Pro.', dog).text, /It's on Growth and Pro\.$/);
  const salon = call('i get a lot of bad yelp and google reviews from one lady. can you just delete them');
  assert.match(run('No, we never remove or hide reviews, and nobody honest can promise that. What we do is reply to every Google one, and you approve each reply before it posts. Yelp isn\'t covered, though.', salon).text, /Yelp isn't covered, though\.$/);
  // "what do i lose": what the cheaper plan leaves out is the answer, not padding
  const ray = call('hm ok. whats the cheapest and what do i lose if i go with that one');
  assert.match(run('Starter\'s the cheapest at $149 a month. You still get me answering every call, booking visits, and the booking page for customers. What you skip is the Growth stuff, like review requests after jobs, and the Pro follow-ups on quotes.', ray).text, /What you skip is the Growth stuff/);
  // said already this call: cut as before
  const again = call('does fill my week work with vagaro', 'Fill my week reads Google Calendar. Vagaro doesn\'t connect.', 'ok so what else');
  assert.doesNotMatch(run('Calls get answered at any hour. Reviews get a reply, with your OK first. Vagaro doesn\'t connect.', again).text, /Vagaro/);
  // and a reply that is long already stays short
  const long = 'Calls get answered at any hour of the day or night, weekends and holidays included, whether your whole crew is up on a roof or under a house in the heat, and every caller gets a real answer and a booked visit instead of a voicemail box that nobody checks until Monday morning. ';
  assert.doesNotMatch(run(long + 'Storm Desk is on Growth.', call('what do you do')).text, /Storm Desk/);
});

// ---------- "Anything else on your list?" after every answer ----------
test('replay: "anything else" closes one answer in three at most', () => {
  const agent = call('hi yeah i run a state farm agency out of macon and my compliance guy would kill me if i put a robot on the phones so i got a few questions',
    'On an agency line I only take messages, no quotes, coverage, rates or claim talk. What\'s your first question?',
    'can it quote my customers or talk coverage like what a policy covers if somebody calls in at night',
    'No to both. At night I\'d take the caller\'s name, number and what they need, and it\'s on your phone right away. What else is on your list?',
    'ok and can it text my customers or do any of that follow up stuff',
    'For an agency, we never text your customers. You add an open quote in the app, and that day you get a reminder with a follow-up already written. Want me to walk through anything else?',
    'is this approved by my carrier like is it state farm approved or is it compliant');
  const out = run('No, I can\'t say it\'s approved by State Farm or call it compliant. It\'s built to follow your rules. Anything else on your list?', agent);
  assert.equal(out.text, 'No, I can\'t say it\'s approved by State Farm or call it compliant. It\'s built to follow your rules.');
  assert.deepEqual(out.cuts.map(c => c.guard), ['g-ask2']);
  // two answers later, it may be asked again
  const later = agent.concat({ r: 'a', t: out.text }, { r: 'u', t: 'who hears the recordings' }, { r: 'a', t: 'Only you and the Always Open team. Each call is kept as a written transcript.' }, { r: 'u', t: 'ok' });
  assert.match(run('Good. Anything else on your list?', later).text, /Anything else on your list\?/);
});

// ---------- the reaction ----------
test('replay: a caller talking about who answers their phones gets no sympathy reaction', () => {
  const k = said => (V.leadIn(said, 'en-US', []) || {}).kind || '';
  assert.notEqual(k('yeah hi uh my wife answers our phone and we got voicemail already so i dont really see why id pay for this'), 'personal');
  assert.equal(k('sorry my wife just had a baby so it\'s been crazy around here'), 'personal', 'their life still gets one');
});

// ---------- the number they just gave (Christopher's phone) ----------
test('replay: on the trial prompt, the number a caller just gave is the one read back, not the one they call from', () => {
  const p = V.systemPrompt6(Object.assign({}, L, { features: ['prompt6'] }), '+14045550187', 'en-US', false);
  assert.match(p, /is the best number\. If they just gave you a number, that is the one: read it back, and ask for the area code if it had none\./);
});

// ---------- what the line's notes said about the audit ----------
test('replay: the audit is texted when the call ends, not "within two business days"', () => {
  const t = 'Chris can tell them about that on the callback. The free audit is a one-page report on how they look online, within two business days. Email: hello@alwaysopenoffice.com.';
  const swept = V.sweepRetired(t);
  assert.equal(swept, 'Chris can tell them about that on the callback. The free audit is a one-page report on how they look online; one asked for on a call is texted to them as soon as the call ends. Email: hello@alwaysopenoffice.com.');
  assert.equal(V.sweepRetired(swept), swept, 'once is enough');
});
