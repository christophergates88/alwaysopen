// Storm Desk nationwide: a client is watched where their business is, and a warning there reaches Christopher once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const S = await import('../src/stormdesk.js');

test('a Growth client in Texas is found by their town and gets a warning for their county; others do not', async () => {
  const DB = H.makeDB(), env = { DB };
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, tier, active) VALUES ('c1', 'h1', 'Lone Star Roofing', 'Growth', 1), ('c2', 'h2', 'Starter Co', 'Starter', 1), ('c3', 'h3', 'Pro Plumbing', 'Pro', 1)").run();
  await (await import('../src/billing.js')).ensureBilling(env);
  await DB.prepare("INSERT INTO billing (client_id, session_id, plan, status, town) VALUES ('c1', 's1', 'Growth', 'active', 'Waco, TX'), ('c2', 's2', 'Starter', 'active', 'Waco, TX'), ('c3', 's3', 'Pro', 'active', 'Eatonton, GA')").run();
  const calls = [];
  const fetch = async u => {
    u = String(u); calls.push(u);
    if (u.includes('nominatim') && u.includes('Waco')) return Response.json([{ lat: '31.5493', lon: '-97.1467' }]);
    if (u.includes('nominatim')) return Response.json([{ lat: '33.3268', lon: '-83.3885' }]);
    if (u.includes('/points/31.5493')) return Response.json({ properties: { county: 'https://api.weather.gov/zones/county/TXC309', forecastZone: 'https://api.weather.gov/zones/forecast/TXZ158', relativeLocation: { properties: { state: 'TX' } } } });
    if (u.includes('/points/')) return Response.json({ properties: { county: 'https://api.weather.gov/zones/county/GAC237', forecastZone: 'https://api.weather.gov/zones/forecast/GAZ048', relativeLocation: { properties: { state: 'GA' } } } });
    if (u.includes('/zones/county/TXC309')) return Response.json({ properties: { name: 'McLennan' } });
    if (u.includes('/zones/county/')) return Response.json({ properties: { name: 'Putnam' } });
    if (u.includes('area=TX')) return Response.json({ features: [{ properties: { id: 'urn:tx1', event: 'Tornado Warning', status: 'Actual', messageType: 'Alert', headline: 'Tornado Warning for McLennan County', geocode: { UGC: ['TXC309'] } } }] });
    if (u.includes('area=GA')) return Response.json({ features: [{ properties: { id: 'urn:ga1', event: 'Tornado Warning', status: 'Actual', messageType: 'Alert', geocode: { UGC: ['GAC999'] } } }] });
    return new Response('{}', { status: 404 });
  };
  const pushes = [];
  const h = { fetch, push: async r => pushes.push(r), mail: async () => 'sent' };
  await S.refreshWatch(env, Date.now(), h);
  const w = (await DB.prepare('SELECT client_id, county, label FROM storm_watch ORDER BY client_id').all()).results;
  assert.deepEqual(w.map(x => [x.client_id, x.county, x.label]), [['c1', 'TXC309', 'McLennan County, TX'], ['c3', 'GAC237', 'Putnam County, GA']], 'Starter clients are not on Storm Desk');
  const r = await S.stormRun(env, Date.now(), h);
  assert.deepEqual(r.states.sort(), ['GA', 'TX']);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].counties, 'McLennan County, TX');
  assert.equal(pushes[0].clients, 'c1');
  const post = await DB.prepare("SELECT client_id, kind, title, text, status FROM app_items WHERE client_id = 'c1'").first();
  assert.deepEqual([post.kind, post.title, post.status], ['post', 'Storm Desk: Severe weather', 'pending'], 'the post waits in the owner’s app');
  assert.match(post.text, /Storm damage\?/, 'a roofer gets the trades wording');
  assert.equal(pushes[0].drafted, 1);
  await S.stormRun(env, Date.now(), h);
  assert.equal(pushes.length, 1, 'once per warning');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM app_items WHERE client_id = 'c1'").first()).n, 1);
});
