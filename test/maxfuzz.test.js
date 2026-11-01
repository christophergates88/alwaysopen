// What Max hears: live emergencies (English and Spanish), false alarms, and every way a customer says yes, no or stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { activeProblem } = await import('../src/voice.js');
const { readAnswer } = await import('../src/callbacks.js');

test('real emergencies are urgent, in English and in Spanish', () => {
  const urgent = ["my pipe just burst and water is everywhere", "there's a gas smell in my house", "my furnace died and it's 10 degrees", "the ceiling is leaking right now",
    "I smell smoke", "my basement is flooding", "no heat and I have a newborn", "the AC quit and my mom is on oxygen", "sewage is backing up in my tub",
    "my car broke down on the highway", "I was in an accident and need to file a claim now", "my roof is caving in", "somebody broke into my store",
    "my toilet is overflowing", "tengo una fuga de agua", "se me inundó la casa", "huele a gas", "no tengo calefacción", "hay un incendio", "es una emergencia"];
  for (const t of urgent) assert.equal(activeProblem(t), true, t);
});
test('past problems, thanks and trade talk are not alarms', () => {
  const calm = ["I'd like a quote for a new roof", "what are your hours", "the leak was fixed last year and I want to thank you", "I want a quote for emergency generator install",
    "our company does emergency plumbing and wants to partner", "I'm a plumber looking for work", "do you service heat pumps", "a leak detector for my basement"];
  for (const t of calm) assert.equal(activeProblem(t), false, t);
  assert.equal(activeProblem('the leak was fixed last year but now it is leaking again'), true, 'a new problem after an old one is still live');
});
test('stop means stop wherever it is in the answer, and in Spanish', () => {
  for (const t of ['no no no stop', 'yes please stop', 'remove my number', 'take me off your list', "don't call me again", 'no me llamen más', 'dejen de llamar', 'stop texting me'])
    assert.equal(readAnswer('', t), 'stop', t);
  assert.equal(readAnswer('', "it won't stop leaking"), 'no', 'about the work, not a request');
  assert.equal(readAnswer('', 'it stopped working'), 'no');
});
test('Spanish yes and no are understood', () => {
  assert.equal(readAnswer('', 'sí'), 'yes'); assert.equal(readAnswer('', 'claro que sí'), 'yes'); assert.equal(readAnswer('', 'no gracias'), 'no');
});
