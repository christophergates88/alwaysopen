// Claude for Gates HQ's private brain: two models only, the length capped, never streamed, the key only ever in the
// header of the one call to Anthropic, and every failure an answer rather than a throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { relayBody, askClaude, HqClaude, HQ_MODELS } = await import('../src/hqclaude.js');

test('keeps to two models, caps the length, never streams, and leaves the rest alone', () => {
  const b = relayBody({ model: 'claude-opus-9', max_tokens: 99999, stream: true, system: 's', tools: [{ name: 't' }], messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(b.model, HQ_MODELS[0]);
  assert.equal(b.max_tokens, 4000);
  assert.equal('stream' in b, false);
  assert.deepEqual(b.tools, [{ name: 't' }]);
  assert.equal(relayBody({ model: 'claude-haiku-5-5', max_tokens: 300 }).model, 'claude-haiku-5-5');
  assert.equal(relayBody({}).max_tokens, 1200);
});

test('one call to Anthropic with the key in the header only; errors come back as answers', async () => {
  const env = { ANTHROPIC_API_KEY: 'sk-test-key' };
  let seen = null;
  const ok = await askClaude(env, { model: 'claude-sonnet-5-5', messages: [] }, async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }), { status: 200 }); });
  assert.equal(ok.ok, true);
  assert.equal(ok.body.content[0].text, 'hi');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test-key');
  assert.ok(!seen.init.body.includes('sk-test-key'));
  const bad = await askClaude(env, {}, async () => new Response(JSON.stringify({ error: { message: 'web search is not enabled' } }), { status: 400 }));
  assert.deepEqual([bad.ok, bad.status, bad.error], [false, 400, 'web search is not enabled']);
  const down = await askClaude(env, {}, async () => { throw new Error('offline'); });
  assert.equal(down.ok, false);
  assert.equal((await askClaude({}, {})).ok, false);
});

test('the entrypoint answers through the same call', async () => {
  const e = new HqClaude({}, {});
  const r = await e.messages({ model: 'claude-sonnet-5-5' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not set up/);
});
