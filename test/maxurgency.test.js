import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { activeProblem, CLOSING, saidGoodbye, systemPrompt, lineView } = await import('../src/voice.js');

test('an active problem or "as soon as possible" is urgent (the Joe Thompson call, Oct 30)', () => {
  for (const t of [
    'Hey. This is Joe Thompson. I have a water leak coming out from underneath my kitchen sink that I need to get repaired as soon as possible.',
    'my hot water heater is leaking', 'the basement is flooding', 'we have no heat and it is freezing', 'I need someone ASAP',
    'water is pouring through the ceiling', 'the breaker is sparking', 'pipe burst in the laundry room'
  ]) assert.ok(activeProblem(t), t);
});
test('routine calls and owners describing their trade are not urgent', () => {
  for (const t of ['I need a quote for a new toilet', 'when are you open on Saturday', 'we fix leaks for a living and want your service', 'our company does water damage restoration', 'can I get an estimate next week']) assert.ok(!activeProblem(t), t);
});
test('closing words after a goodbye end the call instead of starting another goodbye', () => {
  for (const t of ['Thank you.', 'Goodbye.', 'Thanks, bye', 'okay bye', 'You too, thanks', 'Alright, have a good night', 'thank you so much']) assert.ok(CLOSING.test(t), t);
  for (const t of ['wait, my number changed', 'Who will text me?', 'thanks, one more thing', 'actually can you do earlier']) assert.ok(!CLOSING.test(t), t);
  assert.ok(saidGoodbye('Sure thing. Goodbye.'));
});
test('the prompt still fits its size cap', () => {
  const L = lineView({ client_id: 'c1', business: 'Mike’s Plumbing', facts: '{}' });
  assert.ok(systemPrompt(L, '+14785550142', 'en-US', false).length <= 14000);
});

test('no model is ever sent a thinking setting it refuses (Opus refused "disabled" on Oct 30)', async () => {
  const { thinkingFor } = await import('../src/voice.js');
  assert.deepEqual(thinkingFor({}, 'claude-haiku-5-5'), { type: 'disabled' });
  assert.equal(thinkingFor({}, 'claude-opus-5-5'), null);
  assert.equal(thinkingFor({}, 'claude-sonnet-5-5'), null);
  assert.deepEqual(thinkingFor({ VOICE_THINKING: 'adaptive' }, 'claude-opus-5-5'), { type: 'adaptive' });
});
