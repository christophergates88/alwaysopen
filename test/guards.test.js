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
  // a third ask for the same detail goes
  const m3 = call('my sink is leaking', 'What\'s your name?', 'all day', 'And your name?', 'under the kitchen sink');
  assert.equal(run(MIKE, m3, 'under the kitchen sink', ['g-once'], 'Okay. Who am I speaking with?').cuts[0].guard, 'g-once');
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
  assert.equal(run(MIKE, m3, 'x', ['g-town'], 'Good to meet you, Cody. Which town is Gray in, so I get the right one?').cuts[0].guard, 'g-town');
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
