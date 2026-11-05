// Brief 3: each guard cuts the exact sentences from the Nov 4-5 practice runs, and leaves ordinary calls alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const G = await import('../src/guards.js');
const V = await import('../src/voice.js');

const MIKE = { business: "Mike's Plumbing", town: 'Eatonton, GA', next: 'On an emergency he calls back within 15 minutes and can usually be there within the hour around Eatonton.', prices: 'Service call $89' };
const HVAC = { business: 'Lane Heating & Air', town: 'Eatonton, GA', prices: 'Service call is $95, applied to the repair' };
const DENT = { business: 'Oconee Family Dental', town: 'Eatonton, GA', regulated: true };
const AUTO = { business: 'Lake Country Auto', town: 'Eatonton, GA', prices: 'Diagnostic is $89' };
const call = (...turns) => [{ r: 'a', t: 'Thanks for calling. I\'m S.I., and this call may be recorded.' }].concat(turns.map((t, i) => ({ r: i % 2 ? 'a' : 'u', t })));
const ctx = (L, msgs, said, on, extra) => Object.assign(V.guardCtx(Object.assign({}, L, { features: on }), msgs, said, extra || {}), extra || {});
const run = (L, msgs, said, on, text, extra) => G.guardText(text, ctx(L, msgs, said, on, extra));

test('sentences split without breaking S.I., Mr., St. or a price', () => {
  assert.deepEqual(G.sentencesOf('I\'m S.I., and this call may be recorded. What can I do for you?'), ['I\'m S.I., and this call may be recorded. ', 'What can I do for you?']);
  assert.deepEqual(G.sentencesOf('It\'s $1,450.00 installed. Mr. Lane will call.').length, 2);
});

test('g-safety: no name or number ask in the same breath as a safety step', () => {
  const m = call('water is pouring out of my water heater onto the floor');
  const r = run(MIKE, m, 'water is pouring out of my water heater onto the floor', ['g-safety'], 'Shut the cold valve on top, only if you can reach it dry. What\'s your name and the best number to call you back?', { urgent: true });
  assert.equal(r.text, 'Shut the cold valve on top, only if you can reach it dry. ');
  assert.equal(r.cuts[0].guard, 'g-safety');
  const s = call('there\'s water under my water heater and I smell burning by the outlet');
  assert.equal(run(MIKE, s, 'x', ['g-safety'], 'Stay out of the water and away from the outlet. If you see smoke, get out and call 911. What\'s your name?').text, 'Stay out of the water and away from the outlet. If you see smoke, get out and call 911. ');
  // the question about them stays
  assert.match(run(MIKE, s, 'x', ['g-safety'], 'Stay out of the water. Are you clear of it right now?').text, /Are you clear of it/);
  // an ordinary call asks for the name as usual
  assert.equal(run(MIKE, call('I need a faucet replaced'), 'I need a faucet replaced', ['g-safety'], 'Got it. What\'s your name?').text, 'Got it. What\'s your name?');
});

test('g-once: the same ask word for word, a third ask, or an ask for what they already gave', () => {
  const ask = 'What\'s your name, and what\'s the best number for the owner to reach you?';
  const m = call('my haircut is way too short', ask, 'I\'m so upset, I have an event this weekend', ask, 'I want it fixed');
  assert.deepEqual(run(MIKE, m, 'I want it fixed', ['g-once'], 'I\'ll put that in the note exactly as you said it. ' + ask).cuts.map(c => c.guard), ['g-once']);
  // a second ask in fresh words is allowed
  const m2 = call('my sink is leaking', 'What\'s your name?', 'it\'s been leaking all day');
  assert.equal(run(MIKE, m2, 'it\'s been leaking all day', ['g-once'], 'Got it. And your name?').text, 'Got it. And your name?');
  // a third ask in new words stays (cutting it lost callback numbers on Nov 5); only a third word-for-word ask goes
  const m3 = call('my sink is leaking', 'What\'s your name?', 'all day', 'And your name?', 'under the kitchen sink');
  assert.equal(run(MIKE, m3, 'under the kitchen sink', ['g-once'], 'Okay. Who am I speaking with?').cuts.length, 1, 'g-once lets it through; g-ask2 (live) caps the name at two asks');
  // "same number" settles it
  const m4 = call('boat is taking on water', 'Stay off the boat. What\'s your name?', 'Greg, call me back on this number');
  assert.equal(run(MIKE, m4, 'Greg, call me back on this number', ['g-once'], 'Thanks, Greg. Is this the best number to reach you?').cuts[0].guard, 'g-once');
  // never leaves nothing
  assert.equal(run(MIKE, m, 'I want it fixed', ['g-once'], ask).text, ask);
});

test('g-town: never names a town the caller didn\'t say', () => {
  const m = call('how much for a new heat pump');
  assert.equal(run(HVAC, m, 'x', ['g-town'], 'I can\'t quote that. Are you in Milledgeville, or out of town a bit?').cuts[0].guard, 'g-town');
  const m2 = call('it\'s Jake Turner, 301 Hammock Road');
  assert.equal(run(HVAC, m2, 'x', ['g-town'], 'Thanks, Jake. Is 301 Hammock Road in Milledgeville?').cuts[0].guard, 'g-town');
  assert.equal(run(HVAC, m2, 'x', ['g-town'], 'Thanks, Jake. And what town is that in?').text, 'Thanks, Jake. And what town is that in?');
  const m3 = call('it\'s Cody Lane, Cody\'s Pressure Washing in Gray');
  assert.equal(run(MIKE, m3, 'x', ['g-town'], 'Good to meet you, Cody. Which town is Gray in, so I get the right one?').cuts.length, 1, 'cut by g-town or g-once (Gray is a town they gave)');
  const m4 = call('I\'m over in Milledgeville');
  assert.equal(run(HVAC, m4, 'x', ['g-town'], 'Got it. So that\'s Milledgeville, right?').cuts.length, 0);
  assert.equal(run(MIKE, call('hola, se está saliendo el agua'), 'x', ['g-town'], 'Entiendo. ¿Está en Eatonton?').cuts[0].guard, 'g-town');
});

test('g-history: no past-service question on an emergency, upset call, goodbye or regulated line', () => {
  const m = call('water is coming through my ceiling from the bathroom upstairs');
  const q = 'When did you last have plumbing work done on that bathroom, and who did it?';
  assert.equal(run(MIKE, m, 'x', ['g-history'], 'Mike will call you within 15 minutes. ' + q, { urgent: true }).cuts[0].guard, 'g-history');
  assert.equal(run(MIKE, call('my faucet drips'), 'my faucet drips', ['g-history'], 'Got it. ' + q).cuts.length, 0);
  assert.equal(run(DENT, call('I need a cleaning'), 'x', ['g-history'], 'Sure. Have you been in with us before?').cuts[0].guard, 'g-history');
  assert.equal(run(MIKE, call('thanks'), 'thanks', ['g-history'], 'Take care. ' + q).cuts[0].guard, 'g-history');
});

test('g-promise: what the scanner flags is never said', () => {
  assert.equal(run(AUTO, call('my car won\'t start, is it okay to leave it'), 'x', ['g-promise'], 'Got it. Leaving it overnight should be fine. What\'s your name?').text, 'Got it. What\'s your name?');
  assert.equal(run(DENT, call('I broke a tooth and it hurts'), 'x', ['g-promise'], 'I\'m sorry. Don\'t chew on that side. The office will call you to find a time.').text, 'I\'m sorry. The office will call you to find a time.');
  assert.equal(run(DENT, call('can I come in tomorrow'), 'x', ['g-promise'], 'Okay. We can get you in tomorrow. What\'s your name?').text, 'Okay. What\'s your name?');
  assert.equal(run(HVAC, call('heat is out'), 'x', ['g-promise'], 'Okay. Someone will be there within the hour. Is everyone warm?').text, 'Okay. Is everyone warm?');
  // the line's own promise and the caller's own words are fine
  assert.equal(run(MIKE, call('my water heater burst'), 'x', ['g-promise'], 'Mike calls back within 15 minutes on an emergency. Is the water off?').cuts.length, 0);
  assert.equal(run(MIKE, call('call me first thing'), 'x', ['g-promise'], 'First thing, got it.').cuts.length, 0);
});

test('g-short: a long reply is trimmed, never the question or a safety step', () => {
  const long = 'Got it, a heat pump about twelve years old. That helps the team a lot. The owner already has the urgent alert. He will look at it when he calls. Thanks for the details. What\'s your name?';
  const r = run(HVAC, call('heat is out'), 'x', ['g-short'], long, { urgent: true });
  assert.match(r.text, /What's your name\?$/);
  assert.ok(G.sentencesOf(r.text).length <= 4, r.text);
  assert.equal(run(MIKE, call('my faucet drips'), 'x', ['g-short'], 'Got it. What\'s your name?').cuts.length, 0);
});

test('no guard fires when its switch is off, and each guard is fast', () => {
  const m = call('water is pouring out of my water heater');
  assert.equal(run(MIKE, m, 'x', [], 'Shut the valve. What\'s your name?').text, 'Shut the valve. What\'s your name?');
  const msgs = call(...Array.from({ length: 59 }, (_, i) => i % 2 ? 'Got it. What\'s the best number to reach you?' : 'my sink is leaking under the cabinet'));
  const c = ctx(MIKE, msgs, 'x', G.GUARDS, { urgent: true });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) G.guardOne('Leaving it overnight should be fine.', Object.assign(c, { spoken: 'Shut the valve. ' }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  assert.ok(ms < 5, 'a sentence took ' + ms.toFixed(2) + ' ms with all guards on and 60 messages');
});

test('the owner sees "held back" lines in plain words after the reply they belong to', () => {
  const msgs = [{ r: 'a', t: 'Hi, I\'m S.I.' }, { r: 'u', t: 'water everywhere' }, { r: 'a', t: 'Shut the main valve.' }, { r: 'u', t: 'done, thanks' }, { r: 'a', t: 'Take care.' }];
  const t = JSON.parse(V.transcriptOf(msgs, [{ i: 2, g: 'g-safety' }, { i: 4, g: 'wrap' }]));
  assert.deepEqual(t.map(x => x.w), ['ai', 'caller', 'ai', 'held', 'caller', 'ai', 'held']);
  assert.equal(t[3].t, 'asking for their details in the middle of a safety step');
  assert.ok(!t.some(x => /\bg-|\bAI\b/.test(x.t)), 'no code names, no "AI"');
  assert.deepEqual(JSON.parse(V.transcriptOf(msgs)).map(x => x.w), ['ai', 'caller', 'ai', 'caller', 'ai']);
});

test('g-leads: from the third caller turn, "Got it."-style reactions go; question, trouble and goodbye reactions stay', () => {
  const L = { features: ['g-leads'] };
  const m3 = [{ r: 'a', t: 'hi' }, { r: 'u', t: 'a' }, { r: 'a', t: 'b' }, { r: 'u', t: 'c' }, { r: 'a', t: 'd' }, { r: 'u', t: 'it is Tom' }];
  assert.equal(V.trimLead({ kind: 'name', text: 'Got it.' }, L, m3), null);
  assert.deepEqual(V.trimLead({ kind: 'wh', text: 'Good question.' }, L, m3), { kind: 'wh', text: 'Good question.' });
  assert.deepEqual(V.trimLead({ kind: 'trouble', text: 'Oh no.' }, L, m3), { kind: 'trouble', text: 'Oh no.' });
  assert.deepEqual(V.trimLead({ kind: 'name', text: 'Got it.' }, L, m3.slice(0, 4)), { kind: 'name', text: 'Got it.' });
  assert.equal(V.trimLead({ kind: 'name', text: 'Got it.' }, {}, m3), null, 'on for every call since Nov 5');
});

test('fixes from the Nov 5 guard runs: tags kept, open town ask kept, read-backs and first asks kept, "first thing I\'m flagging" is not a promise', () => {
  // [END] alone is never cut, so the call still hangs up
  assert.match(run(HVAC, call('heat is out'), 'thank you', G.GUARDS, 'The owner will call you at that number. Keep that baby warm tonight. Talk soon. [END]', { urgent: true }).text, /\[END\]/);
  // the open town ask stays even when the street has a word like "Pine"
  assert.equal(run(MIKE, call('it\'s Tom Becker, 88 Pine Hill Road'), 'x', ['g-town'], 'Thanks, Tom. What town is Pine Hill Road in?').cuts.length, 0);
  // a first or second ask for the name stays; a Spanish read-back stays
  assert.equal(run(HVAC, call('what\'s a tune-up cost', 'It\'s ninety-five dollars. Who am I talking to?', 'what\'s that cost'), 'what\'s that cost', ['g-once'], 'The service call is ninety-five dollars. Who am I talking to?').cuts.length, 0);
  assert.equal(run(MIKE, call('me llamo Rosa, cuatro siete ocho cinco cinco cinco dos cinco tres tres'), 'x', ['g-once'], 'Le leo el número: cuatro siete ocho, cinco cinco cinco, dos cinco tres tres, ¿está bien?').cuts.length, 0);
  // a third word-for-word ask goes
  const q = 'What\'s your name?';
  assert.equal(run(MIKE, call('sink leaks', q, 'all day', q, 'kitchen'), 'kitchen', ['g-once'], 'Okay. ' + q).cuts[0].guard, 'g-once');
  // "the first thing I'm flagging" is not a time promise; "call you first thing" is
  assert.equal(run(MIKE, call('my boat is sinking'), 'x', ['g-promise'], 'The owner knows it\'s urgent and will call you as soon as he can, and the bilge pump is the first thing I\'m flagging for him.').cuts.length, 0);
  assert.equal(run(HVAC, call('heat is out'), 'x', ['g-promise'], 'Got it. Someone will call you back first thing. Is everyone warm?').cuts[0].guard, 'g-promise');
});

test('g-safety stands down once they are safe, and after the third turn, so the name still gets taken', () => {
  const m = call('there\'s water under my heater and I smell burning by the outlet', 'Stay out of the water. Are you clear of it?', 'okay we\'re outside now');
  assert.equal(run(MIKE, m, 'okay we\'re outside now', ['g-safety'], 'Good, stay out there. What\'s your name?').cuts.length, 0);
  const es = call('se está saliendo el agua debajo del fregadero', 'Cierre la llave de abajo. ¿Puede llegar a ella?', 'sí, ya cerré la llave de abajo');
  assert.equal(run(MIKE, es, 'sí, ya cerré la llave de abajo', ['g-safety'], 'Bien hecho. Si sigue, cierre la llave principal. ¿Me da su nombre?').cuts.length, 0);
  const late = call('water everywhere', 'Shut the main.', 'ok', 'Good.', 'still dripping', 'Keep it off.', 'what now');
  assert.equal(run(MIKE, late, 'what now', ['g-safety'], 'Keep the valve shut. What\'s your name?', { urgent: true }).cuts.length, 0);
  // still cuts on the early unsafe turn
  assert.equal(run(MIKE, call('water is pouring from the heater'), 'should I unplug it', ['g-safety'], 'Don\'t touch it. Stay out of the water. What\'s your name?', { urgent: true }).cuts[0].guard, 'g-safety');
});

test('the emergency detector hears a ceiling leak and Spanish water; the history guard cuts after a safety step', () => {
  assert.ok(V.activeProblem('water is coming through my ceiling from the bathroom upstairs'));
  assert.ok(V.activeProblem('hola, se está saliendo el agua debajo del fregadero de la cocina'));
  assert.ok(!V.activeProblem('how much to replace a kitchen faucet'));
  const m = call('my ceiling has a stain', 'Shut the main water valve if you can.', 'yeah this number\'s fine');
  assert.equal(run(MIKE, m, 'yeah this number\'s fine', ['g-history'], 'We\'ll call you back at this number. One quick thing for his note: when did you last have plumbing work done up there, and who did it?').cuts[0].guard, 'g-history');
});

test('a Spanish line on Flux listens in "multi" from the first word (Nov 5: a Spanish caller was heard as nothing)', () => {
  assert.equal(V.multiStt({ VOICE_FLUX: 'all' }, { spanish: 1, facts: '{}' }), true);
  assert.equal(V.multiStt({ VOICE_FLUX: 'all' }, { spanish: 0, facts: '{}' }), false, 'English-only lines keep English Flux');
  assert.equal(V.multiStt({}, { spanish: 1, facts: '{}' }), false, 'a Spanish line not on Flux keeps its recognizer');
});

test('7c-1: no doubled or clipped openers after the spoken reaction', () => {
  assert.equal(V.dropRepeat('Alright Gary, the team will call you back.', 'said'), 'Gary, the team will call you back.'.replace(/^Gary, t/, 'T'));
  assert.equal(V.dropRepeat('Good. I\'m still missing your street.', 'said'), 'I\'m still missing your street.');
  assert.equal(V.dropRepeat('Got it, Brian, first thing, you got it.', 'name'), 'First thing, you got it.');
  assert.equal(V.dropRepeat('Got it, Timothy. Thanks.', 'said'), 'Thanks.');
  // a name that starts the real sentence stays; an ordinary reply is untouched
  assert.equal(V.dropRepeat('Alright, so here is the plan.', 'said'), 'So here is the plan.');
  assert.equal(V.dropRepeat('The owner will call you.', 'said'), 'The owner will call you.');
  assert.equal(V.dropRepeat('Good morning to you too.', 'said'), 'Good morning to you too.');
});

test('7a g-ask2 (narrowed): the number once when caller ID has it, the name at most twice, nothing they gave', () => {
  const on = ['g-ask2'];
  const m1 = call('my boat is low in the water', 'Stay off the boat. What\'s the best number to reach you?', 'it\'s a 22 foot bowrider');
  assert.equal(run(MIKE, m1, 'x', on, 'Got it, a bowrider. Is this the best number to reach you?').text, 'Got it, a bowrider. ');
  const m1b = call('my boat is low in the water', 'What\'s the best number?', 'bowrider', 'Okay. Is the water still rising?', 'yes');
  assert.equal(run(MIKE, m1b, 'yes', on, 'Okay. What\'s the best number to reach you?', { caller: '' }).cuts.length, 0);
  // asking again the next turn is fine
  const m2 = call('my haircut is too short', 'I\'m sorry. What\'s your name?', 'I have an event this weekend');
  assert.equal(run(MIKE, m2, 'x', on, 'That\'s a lot of pressure. Who am I speaking with?').cuts.length, 0);
  // a third name ask is not
  const m4 = call('sink leaks', 'What\'s your name?', 'it drips', 'And your name?', 'ok');
  assert.equal(run(MIKE, m4, 'ok', on, 'Okay. Who am I speaking with?').cuts[0].guard, 'g-ask2');
  assert.equal(run(MIKE, call('my faucet drips'), 'x', on, 'Got it. What\'s your name?').cuts.length, 0);
  assert.equal(run(MIKE, call('it\'s 478 555 0122', 'What\'s the best number?', '478 555 0122'), 'x', on, 'Four seven eight, five five five, zero one two two, right?').cuts.length, 0);
});

test('7c-3 g-stock: no saying the same thing twice in a call, no "while I\'ve got you"', () => {
  const on = ['g-stock'];
  const m = call('my heat is out and I have a baby', 'Get the baby in the warmest room. The owner knows it\'s urgent and will call you as soon as he can.', 'it\'s Jake, this number');
  assert.equal(run(HVAC, m, 'x', on, 'Thanks, Jake. The owner knows it\'s urgent and he\'ll call you as soon as he can. Talk soon.').text, 'Thanks, Jake. Talk soon.');
  assert.equal(run(MIKE, call('this number'), 'x', on, 'Got it. While I\'ve got you, anything else I can help with?').text, 'Got it. ');
  // a safety step may be said again, and new information stays
  const s2 = call('water everywhere', 'Shut the main valve and stay out of the water.', 'ok');
  assert.equal(run(MIKE, s2, 'x', on, 'Good. Shut the main valve and stay out of the water until he gets there.').cuts.length, 0);
  assert.equal(run(MIKE, m, 'x', on, 'Thanks, Jake. Mike will bring a space heater if you want one.').cuts.length, 0);
});

test('7b g-sales: on Always Open\'s own line, the pitch past two sentences goes; the answer stays', () => {
  const AO = { business: 'Always Open', own: true, town: 'Eatonton, GA' };
  const said = 'hey I saw your card, I run a pressure washing business, what exactly do you do';
  const long = 'We keep a business answered around the clock: every review replied to, missed calls picked up, quotes followed up. Then on the 2nd of each month you get one page showing what it all did. For a pressure washing crew, that means the call that comes in while you are on a driveway still gets answered. It runs on the number you already have. Want me to text you a free audit?';
  const r = run(AO, call(said), said, ['g-sales'], long);
  assert.match(r.text, /^We keep a business answered/);
  assert.match(r.text, /pressure washing crew/, 'answers what they said (pressure washing)');
  assert.match(r.text, /free audit\?$/);
  assert.doesNotMatch(r.text, /number you already have/);
  // prices and the refund always stay
  const c = run(AO, call('what does it cost'), 'what does it cost', ['g-sales'], 'Three plans. Starter is $149 a month. There is no setup fee and the first month is refunded if it is not worth it. It is a great fit for a lot of trades.');
  assert.match(c.text, /refunded/);
  assert.doesNotMatch(c.text, /great fit/);
  // never on a client's line
  assert.equal(run(MIKE, call(said), said, ['g-sales'], long).cuts.filter(c => c.guard === 'g-sales').length, 0);
});

test('a web address is not the end of a sentence', () => {
  assert.deepEqual(G.sentencesOf('Take your time, the website is alwaysopenoffice.com whenever you want a look. Talk soon.'), ['Take your time, the website is alwaysopenoffice.com whenever you want a look. ', 'Talk soon.']);
  assert.deepEqual(G.sentencesOf('Hi! Is it $1,450.00? Yes.'), ['Hi! ', 'Is it $1,450.00? ', 'Yes.']);
  assert.deepEqual(G.sentencesOf('No end punctuation'), ['No end punctuation']);
});

test('the business question is asked once a call (Nov 5, 5:57 PM: asked again after a compliment); the quiet check-in waits like a person', () => {
  const asked = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'tell me about always open' }, { r: 'a', t: 'We answer calls. Do you run a business yourself?' }, { r: 'u', t: 'so I only get the report once a month' }];
  assert.equal(V.cutBizQ('There is more to it. What kind of business do you run?', V.askedBiz(asked)), 'There is more to it. ', 'asked once already: not again');
  assert.equal(V.askedBiz(asked.slice(0, 2)), false, 'never asked: it may be asked');
  const answered = asked.concat({ r: 'a', t: 'What kind of business do you run?' }, { r: 'u', t: 'I have a mechanic shop' });
  assert.equal(V.cutBizQ('Calls are the big one. What kind of business do you run?', V.askedBiz(answered)), 'Calls are the big one. ');
  const twice = asked.concat({ r: 'a', t: 'What kind of business do you run?' }, { r: 'u', t: 'you never answered me' });
  assert.equal(V.cutBizQ('Fair. What kind of business do you run?', V.askedBiz(twice)), 'Fair. ');
  assert.ok(V.IDLE_MS >= 6000 && V.IDLE_Q_MS >= 6000, 'a person waits more than a couple of seconds');
});

test('8a g-audit: the free audit is offered once; after a no it is not mentioned again (Christopher, Nov 5)', () => {
  const AO = { business: 'Always Open', own: true };
  const offer = 'Want the free audit texted to you?';
  const m1 = call('do you outreach to people to get me sales', 'We follow up with your customers. ' + offer, 'why don\'t you cold call customers for me is that an option?');
  assert.equal(run(AO, m1, 'x', ['g-audit'], 'Cold calling isn\'t part of what we do. ' + offer).text, 'Cold calling isn\'t part of what we do. ');
  const m2 = m1.concat({ r: 'a', t: 'Not today.' }, { r: 'u', t: 'Now I don\'t want the free audit texted to me. What do you do?' });
  assert.equal(run(AO, m2, 'x', ['g-audit'], 'Fair, I\'ll skip the audit. We follow up on quotes that went quiet.').text, 'We follow up on quotes that went quiet.');
  // taken: it may be mentioned again (sending it)
  const m3 = call('what is the audit', 'A one-page look at how you show up online. ' + offer, 'sure, text it to me');
  assert.equal(run(AO, m3, 'x', ['g-audit'], 'Done, I\'ll text you the free audit after we hang up.').cuts.length, 0);
  // the first offer always goes out
  assert.equal(run(AO, call('what do you do'), 'x', ['g-audit'], 'We answer your calls. ' + offer).cuts.length, 0);
});

test('Nov 5, 5:57 PM call: two statements and stop, unless they asked for more; what they asked about stays', () => {
  const said = 'what is always open do for businesses to make them money';
  const long = 'It keeps the business answering every review, every missed call, and every quote follow-up around the clock. On the 2nd of each month you get one page showing what it did. It works on the number you already have. What kind of business do you run?';
  const r = run(MIKE, call(said), said, [], long);
  assert.doesNotMatch(r.text, /number you already have/, 'the third statement goes');
  assert.match(r.text, /What kind of business do you run\?$/, 'the question at the end stays');
  const more = run(MIKE, call('tell me more about it'), 'tell me more about it', [], long);
  assert.match(more.text, /number you already have/, 'asked for more: all of it');
  assert.equal(G.guardOne('Want to test me the way one of your customers would?', { on: new Set(['g-canned']), msgs: [], said: '' }), 'g-canned');
});

test('a short opener is not one of the two statements (Nov 5 practice: "Fair pushback." left the answer out)', () => {
  const said = 'it sounds like an answering service';
  const r = run(MIKE, call(said), said, [], 'Fair pushback. An answering service takes messages. This answers any hour and sends you the name and number on your phone. Starter is $149 a month, no contract.');
  assert.match(r.text, /sends you the name and number/, 'the answer itself stays');
  assert.doesNotMatch(r.text, /Starter is/, 'the third statement still goes');
});
