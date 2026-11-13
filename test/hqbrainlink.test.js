// Gates HQ brain link: the Mac key's hash is kept for the brain (never the key), and the brain is watched:
// silent until it has answered once, one push after two failed checks in waking hours, one when it's back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { makeDB } = await import('./rehearsal/harness.js');
const { brainLink } = await import('../src/hqbrainlink.js');

const NOON = Date.parse('2026-11-13T17:00:00Z'), NIGHT = Date.parse('2026-11-14T05:00:00Z');
const up = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const down = async () => new Response(JSON.stringify({ ok: false }), { status: 503 });

test('keeps a hash of the Mac key for the brain, never the key itself', async () => {
  const env = { DB: makeDB(), LEADS_KEY: 'k'.repeat(40) };
  await brainLink(env, NOON, async () => {}, up);
  const v = (await env.DB.prepare("SELECT v FROM hq_kv WHERE k = 'mac-key-sha'").first()).v;
  assert.match(v, /^[0-9a-f]{64}$/);
  assert.ok(!v.includes('kkkk'));
});

test('silent before the brain ever answered; one push after two failures; one when back; none at night', async () => {
  const env = { DB: makeDB(), LEADS_KEY: 'k'.repeat(40) }, said = [];
  const ping = async (t) => said.push(t);
  assert.equal(await brainLink(env, NOON, ping, down), 'not deployed yet');
  assert.equal(await brainLink(env, NOON + 6e5, ping, up), 'ok');
  await brainLink(env, NOON + 12e5, ping, down);
  assert.equal(said.length, 0, 'one failure is not enough');
  assert.equal(await brainLink(env, NOON + 18e5, ping, down), 'stopped');
  await brainLink(env, NOON + 24e5, ping, down);
  assert.deepEqual(said, ['Gates HQ brain stopped'], 'said once');
  assert.equal(await brainLink(env, NOON + 30e5, ping, up), 'back');
  assert.deepEqual(said, ['Gates HQ brain stopped', 'Gates HQ brain is back']);
  const env2 = { DB: makeDB() }, said2 = [];
  await brainLink(env2, NIGHT, async (t) => said2.push(t), up);
  await brainLink(env2, NIGHT + 6e5, async (t) => said2.push(t), down);
  await brainLink(env2, NIGHT + 12e5, async (t) => said2.push(t), down);
  assert.equal(said2.length, 0, 'quiet hours: nothing at midnight');
});
