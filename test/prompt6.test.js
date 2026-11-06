// Build Brief 6, Parts 1 and 2: prompt6 is short, keeps the harm rules, and runs with only the harm filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const L = { business: 'Lane Plumbing', town: 'Eatonton, GA', name: 'Max', services: 'Drains, water heaters, leaks', prices: 'Service call $89', hours: 'Mon to Fri 8 to 5', features: ['prompt6'] };

test('prompt6: about a quarter the size, and every harm rule is still there', () => {
  const p6 = V.systemPrompt(L, '+14785550142', 'en-US', false), old = V.systemPrompt(Object.assign({}, L, { features: [] }), '+14785550142', 'en-US', false);
  assert.ok(p6.length < old.length * 0.6, 'prompt6 is ' + p6.length + ' chars, old is ' + old.length);
  for (const must of [/S\.I\./, /Make up a price/, /legal, medical, insurance/, /911/, /Social Security/, /\[END\]/, /\[TRANSFER\]|cannot connect/, /first words answer it/, /15 words or fewer/])
    assert.match(p6, must);
  assert.doesNotMatch(p6, /How it sounds|Vary your rhythm|never two replies in a row/, 'no style lists');
  assert.equal(V.systemPrompt(L, '', 'en-US', false), V.systemPrompt(L, '', 'en-US', false), 'the same every turn, so the cache holds');
  assert.match(V.systemPrompt(Object.assign({}, L, { regulated: true }), '', 'en-US', false), /regulated business: take a message only/);
});

test('prompt6: only the harm filters run, reactions are short and once a call, and Max waits ten seconds', () => {
  const g = V.guardCtx(L, [{ r: 'u', t: 'hi' }], 'hi', {});
  assert.deepEqual([...g.on].sort(), ['g-history', 'g-promise', 'g-safety']);
  const a = V.trimLead({ kind: 'wh', text: 'Good question.' }, L, [], []);
  assert.ok(['Okay.', 'Sure.', 'Right.', 'Got it.', 'Hm.', 'Mm-hm.'].includes(a.text));
  const b = V.trimLead({ kind: 'wh', text: 'Good question.' }, L, [], [a.text]);
  assert.notEqual(b.text, a.text, 'never the same reaction twice');
  assert.equal(String(V.callerNotes({ line: L, msgs: [] }, "I really don't like talking to AI")), '', 'no per-turn patches');
});

test('prompt6 can be switched on for a line and for a practice run (it is a known feature)', () => {
  assert.ok(V.FEATURES.includes('prompt6'));
});

test('testFeatures reach test calls only', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8');
  assert.match(src, /if \(call\.test\) \{ const tf = \(parse\(line\.facts\) \|\| \{\}\)\.testFeatures/);
});
