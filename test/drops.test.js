// Build Brief 8: when the line to Max drops mid-answer, he comes back with the end of what he was saying; the 3-minute
// test caller reaches the point where real calls drop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const D = await import('../src/drill.js');

const msgs = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'I just don\'t see how that\'s worth three hundred dollars a month.' },
  { r: 'a', t: 'Fair to push on it. Starter is $149 a month, about five dollars a day. Want me to have Katie walk you through what fits an agency like yours?' }];

test('a drop mid-answer: sorry, then the end of the answer again', () => {
  assert.equal(V.resumeLine(msgs, true, 'en-US'), 'Sorry, we got cut off for a second. Want me to have Katie walk you through what fits an agency like yours?');
});
test('a drop while the caller was talking, or with nothing said yet: the plain line', () => {
  assert.equal(V.resumeLine(msgs, false, 'en-US'), V.RESUME_PLAIN);
  assert.equal(V.resumeLine([], true, 'en-US'), V.RESUME_PLAIN);
  assert.equal(V.resumeLine([{ r: 'a', t: V.RESUME_PLAIN }], true, 'en-US'), V.RESUME_PLAIN);   // never "cut off" twice
  assert.match(V.resumeLine(msgs, true, 'es-US'), /se cortó/);
});
test('control tags are never said again', () => {
  assert.equal(V.resumeLine([{ r: 'a', t: 'Katie will call you tomorrow. Take care. [END]' }], true, 'en-US'), 'Sorry, we got cut off for a second. Take care.');
});
test('the 3-minute test caller talks past the point where real calls drop', () => {
  const pauses = [...D.SCRIPT_LONG.matchAll(/<Pause length="(\d+)"\/>/g)].map(m => +m[1]);
  const lines = (D.SCRIPT_LONG.match(/<Say /g) || []).length;
  assert.ok(lines >= 7, 'lines ' + lines);
  assert.ok(pauses.reduce((a, b) => a + b, 0) + lines * 4 >= 150, 'about three minutes');
  assert.ok(pauses.slice(1).every(p => p <= 20), 'speech at least every 20 seconds or so');
  assert.match(D.SCRIPT_LONG, /<Hangup\/><\/Response>$/);
});
