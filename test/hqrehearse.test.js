// The Gates HQ practice run plays every sample text and call without errors (Claude faked: the call brain, the other
// side and the write-up each answer in their own way), and its checks read the transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { makeDB } = await import('./rehearsal/harness.js');
const { rehearseHq, TEXTS, CALLS } = await import('../src/hqrehearse.js');

test('every sample text and call plays through, and nothing is saved', async () => {
  const DB = makeDB();
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body), sys = (b.system && b.system[0] && b.system[0].text) || String(b.system || '');
    let t;
    if (/write up a phone call/.test(sys)) t = JSON.stringify({ outcome: 'done', summary: 'Booked.', booked: null });
    else if (/automated phone assistant/.test(sys)) t = 'Hi, this is an automated assistant calling for Christopher Gates. This call may be recorded. Thanks, goodbye.[END]';
    else if (/incoming text messages/.test(sys)) t = JSON.stringify({ action: 'escalate', category: 'unsure', tell: 'x', suggest: '' });
    else t = 'Hello?';
    return new Response(JSON.stringify({ content: [{ type: 'text', text: t }] }));
  };
  const out = await rehearseHq({ DB, ANTHROPIC_API_KEY: 'x' }, 'all');
  assert.equal(out.texts.length, TEXTS.length); assert.equal(out.calls.length, CALLS.length);
  for (const c of out.calls) { assert.ok(!c.error, c.error); assert.equal(c.ended, true); assert.equal(c.checks.saysAutomated, true); assert.equal(c.checks.saysRecorded, true); }
  const tables = (await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hq_text_log', 'hq_text_out', 'hq_calls_out')").all()).results.map(r => r.name);
  assert.deepEqual(tables, [], 'a practice run writes nothing');
});
