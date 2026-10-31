// Keeping Max quick: the instructions stay within a size budget and stay the same from turn to turn (so they are cached),
// and when Claude fails before saying anything, the backup model answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { systemPrompt, lineView, brain } = await import('../src/voice.js');
const { FACTS } = await import('../src/interview.js');

function fullLine() {
  const facts = { hours: 'Mon to Fri 7 to 6, Sat 8 to 12', name: 'Max', owner: 'x'.repeat(800) };
  for (const f of FACTS) facts[f.key] = 'y'.repeat(f.max);
  const L = lineView({ business: 'Sinclair Plumbing and Drain Company', town: 'Eatonton, GA', industry: 'plumbing', facts: JSON.stringify(facts), owner_set: '{}', transfer_to: '+14785550109', transfer_when: 'urgent', spanish: 1, client_id: 'c1' });
  L.slots = Array.from({ length: 6 }, (_, i) => ({ say: 'Wednesday, October 28 at 1' + i + ' AM' })); L.bookMode = 'book';
  L.memory = '- Name on file: Dana.\n- They have a visit booked for Thursday, October 30 at 10 AM.\n- They have called before (3 or more times); most recent Oct 20: leak.\n- An estimate sent on Oct 2 is still open.';
  L.cbSlot = 'three fifteen this afternoon'; L.cbBusy = 'out on a job right now';
  L.neighbors = 'Lane Electric (electrical, 4 miles), Oconee Roofing (roofing, 9 miles)';
  return L;
}

test('Max’s instructions stay under 14,200 characters even with every field full (about 3,550 tokens, cached after the first turn)', () => {
  const n = systemPrompt(fullLine(), '+14785550142', 'en-US', false).length;
  assert.ok(n <= 14200, 'instructions are ' + n + ' characters');
});

test('the instructions are the same on every turn of a call, so the cache holds (per-turn notes go in a separate block)', () => {
  const L = fullLine();
  assert.equal(systemPrompt(L, '+14785550142', 'en-US', false), systemPrompt(L, '+14785550142', 'en-US', false));
});

test('when Claude fails before a word is said, the backup model answers in time', async () => {
  const pinged = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('anthropic.com')) return new Response('{"error":{"message":"overloaded"}}', { status: 529 });
    if (String(url).includes('ntfy')) { pinged.push(url); return new Response('ok'); }
    return new Response('{}', { status: 404 });
  };
  const stream = text => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"' + text + '"}\n\ndata: [DONE]\n\n')); c.close(); } });
  const env = { ANTHROPIC_API_KEY: 'sk-ant-test', AI: { run: async () => stream('Sure, I can help with that.') }, DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null }) }) }, NTFY_URL: 'https://ntfy.example.test/x' };
  let said = '';
  try {
    const t0 = Date.now();
    const r = await brain(env, 'You are a test.', [{ role: 'user', content: 'Hi' }], t => { said += t; }, 50);
    assert.equal(said, 'Sure, I can help with that.');
    assert.ok(r.text && Date.now() - t0 < 2200, 'the backup answered within the time Max would otherwise fill with "One sec"');
  } finally { globalThis.fetch = realFetch; }
});
