// Max never hangs up on a caller who just answered a question, but "No" to "anything else?" still ends the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { earlyEnd } = await import('../src/voice.js');
test('a yes in the middle of a call does not hang up; a no to anything else does', () => {
  assert.equal(earlyEnd([{ r: 'a', t: 'Is the water still spraying?' }, { r: 'u', t: 'Yes.' }], 'Thanks for calling. Talk soon.'), true);
  assert.equal(earlyEnd([{ r: 'a', t: 'While I\'ve got you, anything else I can help with?' }, { r: 'u', t: 'No.' }], 'Alright, talk soon.'), false);
  assert.equal(earlyEnd([{ r: 'a', t: 'Did you call them?' }, { r: 'u', t: 'Yes.' }], 'Hang up and call 911 now. Goodbye.'), false);
  assert.equal(earlyEnd([{ r: 'a', t: 'Anything else?' }, { r: 'u', t: 'Thanks, bye.' }], 'Talk soon.'), false);
});
