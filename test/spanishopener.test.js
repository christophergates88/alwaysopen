// A Spanish caller's first words, garbled by the English listener, still switch the call to Spanish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { spanishOpener } = await import('../src/voice.js');

test('Spanish openers, clean or garbled, are caught', () => {
  for (const s of ['Hola', 'Ola, nay say toe un plo mero', 'Buenos días', 'Bueno?', 'Habla español?', 'oh la, tengo una fuga', 'Allo, necesito ayuda', 'Señora, por favor', 'Buenas tardes, quisiera una cita'])
    assert.equal(spanishOpener(s), true, s);
});
test('English callers are not switched', () => {
  for (const s of ['Hello, I need a plumber', 'Hola, I need a plumber for my kitchen', 'Hi this is Bob', 'Hello?', 'I have a leak', 'My spaniel chewed the hose', 'Ola is my daughter and she needs help with the sink'])
    assert.equal(spanishOpener(s), false, s);
});
