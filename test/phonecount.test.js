import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { phoneReadback, callerNotes, leadIn } = await import('../src/voice.js');

const n = t => (phoneReadback(t) || { n: 0 }).n;
test('phone numbers callers say are counted by code, so a complete number is never called short', () => {
  // the three the stronger model wrongly called "a digit short" in the Nov 4 rehearsal
  assert.equal(n('Dave Miller, four seven eight five five five zero one nine nine.'), 10);
  assert.equal(n('Fine, tell the owner to call Karen Wells at four seven eight five five five zero one seven seven.'), 10);
  assert.equal(n("Name's Lee Chen, number four seven eight five five five zero one two three, 90 Elm Street."), 10);
  assert.equal(phoneReadback("Name's Lee Chen, number four seven eight five five five zero one two three, 90 Elm Street.").digits, '4785550123');
  assert.equal(n('55 Cedar Ct Eatonton, Pam Ortiz 4785550166.'), 10);
  assert.equal(n('478-555-0123'), 10);
  assert.equal(n('four seven eight, five five five, zero one two three'), 10);
  assert.equal(n('one four seven eight five five five zero one two three'), 10);
  assert.equal(n('four seven eight five five five double oh one nine'), 10);
  assert.equal(n('cuatro siete ocho cinco cinco cinco cero uno dos tres'), 10);
  assert.equal(phoneReadback('four seven eight five five five zero one nine nine').say, 'four seven eight, five five five, zero one nine nine');
});
test('short, seven-digit and non-numbers', () => {
  assert.equal(n('four seven eight, five five five, zero one two'), 9);
  assert.equal(n('five five five one two one two'), 7);
  assert.equal(phoneReadback('Eleven forty Oak Lane, Eatonton.'), null);
  assert.equal(phoneReadback("Oh, okay. Yes that's right."), null);
  assert.equal(phoneReadback('I have two kids'), null);
});
const S = (msgs) => ({ line: {}, msgs: msgs || [], lang: 'en-US' });
test('Max is told the count and the exact read-back', () => {
  const ok = callerNotes(S(), 'Dave Miller, four seven eight five five five zero one nine nine.');
  assert.match(ok, /ten digits, complete/);
  assert.match(ok, /"four seven eight, five five five, zero one nine nine"/);
  assert.match(ok, /never say it is short/);
  assert.match(callerNotes(S(), 'four seven eight, five five five, zero one two'), /nine digits.*missing/);
  assert.match(callerNotes(S(), 'five five five one two one two'), /area code/);
  assert.doesNotMatch(callerNotes(S(), 'Eleven forty Oak Lane, Eatonton.'), /digits/);
});
test('a Spanish gas or flood call never gets an upbeat "Perfecto."', () => {
  for (let i = 0; i < 20; i++) {
    const r = leadIn('Hola, huele a gas en mi cocina.', 'es-US', [], () => i / 20);
    assert.ok(!r || !/Perfecto|Muy bien/.test(r.text), r && r.text);
  }
  for (let i = 0; i < 20; i++) { const r = leadIn('Estoy en cuatro doce Pine Street.', 'es-US', [], () => i / 20); assert.ok(!r || r.text !== 'Perfecto.'); }
});

test('toll-free numbers, a filler "oh", Spanish tens and "o", and a time or street said right after', () => {
  const r = phoneReadback('one eight hundred five five five one two one two');
  assert.equal(r.digits, '8005551212'); assert.equal(r.n, 10);
  assert.equal(phoneReadback('eight hundred five five five one two one two').digits, '8005551212');
  assert.equal(phoneReadback('My number, oh, four seven eight five five five zero one nine nine').digits, '4785550199');
  const es = phoneReadback('cuatro siete ocho cinco cinco cinco dos cinco treinta y tres');
  assert.equal(es.digits, '4785552533'); assert.equal(es.n, 10);
  assert.equal(es.say, 'cuatro siete ocho, cinco cinco cinco, dos cinco tres tres', 'read back in Spanish');
  assert.equal(phoneReadback('cuatro siete ocho cinco cinco cinco dos cinco tres tres o el de mi esposo').n, 10);
  assert.equal(phoneReadback("four seven eight five five five zero one two three nine o'clock works").digits, '4785550123');
  assert.equal(phoneReadback('four seven eight five five five zero one two three ninety Elm Street').digits, '4785550123');
  // an address still reads "one hundred five" as 105
  assert.equal(n('four seven eight five five five zero one two'), 9, 'a real nine-digit number is still nine');
});
