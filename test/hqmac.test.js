// Gates HQ 2 hands the Mac's Gates HQ routes that need this worker on through the HqMac entrypoint (hqmac.js,
// Nov 22, 2026): they run as when the Mac calls them here, and nothing else gets through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker, HqMac } = await import('../src/index.js');
const site = H.makeClient(worker, env);
const ep = new HqMac(site.ctx, env);
const req = (path, o) => new Request('https://alwaysopen.internal' + path, o);

test('the Mac’s Gates HQ routes pass, with this worker’s own key added here', async () => {
  const plain = await site.call('/ops/hq-text-queue');
  assert.equal(plain.status, 403, 'from the internet the route still wants the key');
  const r = await ep.fetch(req('/ops/hq-text-queue'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-ao-hqmac'), 'yes', 'the router answered');
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.out));
  assert.ok(await (env.HQDB || DB).prepare("SELECT k FROM hq_kv WHERE k = 'mac-seen'").first(), 'the Mac counts as seen, as when it asks here');
  const p = await ep.fetch(req('/ops/hq-plans'));
  assert.equal(p.status, 200);
  assert.ok(Array.isArray((await p.json()).plans));
  const q = await ep.fetch(req('/ops/hq-text-queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sent: [], failed: [], replied: [], people: [{ n: 'Sam Lee', p: '4785550101' }] }) }));
  assert.equal(q.status, 200);
  const people = await (env.HQDB || DB).prepare("SELECT v FROM hq_kv WHERE k = 'people'").first();
  assert.match(people.v, /Sam Lee/, 'the body arrives whole');
});

test('nothing else gets through: not the business routes, not the Gates HQ routes Gates HQ 2 keeps itself', async () => {
  for (const p of ['/ops/push-queue', '/ops/clients', '/ops/hq-sense', '/ops/hq-code', '/ops/hq-rehearse', '/ops/text-test', '/ops/hq-plans/x', '/ops/busy', '/']) {
    const r = await ep.fetch(req(p, { method: 'POST', body: '{}' }));
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('x-ao-hqmac'), 'no', p + ': turned away here, nothing done');
  }
  const big = await ep.fetch(req('/ops/hq-plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(400001) }));
  assert.equal(big.status, 413);
  const off = new HqMac(site.ctx, Object.assign({}, env, { LEADS_KEY: '' }));
  assert.equal((await off.fetch(req('/ops/hq-plans'))).status, 503, 'without its key this worker hands nothing on');
});
