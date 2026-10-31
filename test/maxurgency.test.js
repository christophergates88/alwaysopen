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

test('after a question Max stops talking (the Joe call: "...shut off under that sink? The valves are usually...")', async () => {
  const { Speaker } = await import('../src/voice.js');
  const out = []; const sp = new Speaker(m => out.push(m.token), 'en-US');
  for (const t of ['Before anything else, is the water ', 'shut off under that sink?', ' The valves are usually on the pipes', ' right under it. [END]']) sp.push(t);
  const said = sp.end();
  assert.equal(said, 'Before anything else, is the water shut off under that sink?');
  assert.equal(sp.flags.end, true, 'control tags after the question still count');
  const sp2 = new Speaker(() => {}, 'en-US'); sp2.push('Got it, Saturday at eight. The team will text to confirm. Goodbye. [END]');
  assert.equal(sp2.end(), 'Got it, Saturday at eight. The team will text to confirm. Goodbye.');
});

test('what the call already settled is handed to Max every turn, so he never re-asks or re-reads it', async () => {
  const { settledOnCall } = await import('../src/voice.js');
  const msgs = [{ r: 'a', t: 'Hi, thanks for calling. What can I do for you?' }, { r: 'u', t: 'Kitchen sink leak, need it asap.' },
    { r: 'a', t: 'Oh no. Is the water shut off?' }, { r: 'u', t: 'Yes, whole house.' },
    { r: 'a', t: 'Good. What is the best number for Mike to reach you?' }, { r: 'u', t: 'four seven eight two one two two six two nine' }];
  const n = settledOnCall(msgs);
  assert.match(n, /Is the water shut off\?" -> "Yes, whole house\./);
  assert.match(n, /best number for Mike to reach you\?" -> "four seven eight/);
  assert.equal(settledOnCall([{ r: 'a', t: 'Hello.' }]), '');
});
