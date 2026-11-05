// Brief 4, Part 1: the map lives on Customers itself. No door to it, no new tab, examples only when nobody is near.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { appHtml } = await import('../src/apppage.js');
const { tradeNoun, mapState, ensureMap } = await import('../src/map.js');
const { makeDB } = await import('./rehearsal/harness.js');
const html = appHtml({ base: '/app/x', business: 'Sinclair Plumbing' });

test('the map is the map: loaded in the app, no "open the map" door, no new tab', () => {
  assert.match(html, /maplibre-gl\/4\.7\.1\/maplibre-gl\.min/);
  assert.match(html, /tiles\.openfreemap\.org\/styles\/dark/);
  assert.doesNotMatch(html, />Open the map</, 'no button that opens a link to the map');
  assert.doesNotMatch(html, /row\('map'/);
  assert.doesNotMatch(html, /g==='map'/);
  assert.doesNotMatch(html, /\/map\?real=1/);
  assert.doesNotMatch(html, /Show me on the Always Open map/, 'the Settings switch moved onto the map card');
  assert.match(html, /Other businesses will show up here as they join\. These are examples\./);
});

test('example dots carry no names, trades or phones', () => {
  const fn = html.slice(html.indexOf('function drawPins'), html.indexOf('function mapFallback'));
  assert.match(fn, /b\.ex\?'Example'/);
  const ex = html.slice(html.indexOf('function exDots'), html.indexOf('function mapData'));
  assert.doesNotMatch(ex, /name|kind|phone/);
});

test('the line under the map says the trade the way customers search it', () => {
  assert.equal(tradeNoun('plumbing'), 'plumber');
  assert.equal(tradeNoun('Heating and air'), 'HVAC company');
  assert.equal(tradeNoun('hair salon'), 'salon');
  assert.equal(tradeNoun('auto repair'), 'mechanic');
  assert.equal(tradeNoun('other'), '');
});

test('map state gives the owner the same pin the public sees', async () => {
  const DB = makeDB(), env = { DB };
  await ensureMap(env);
  await DB.prepare("INSERT INTO map_listing (client_id, show, lat, lng, exact) VALUES ('c1', 1, 33.3268, -83.3885, 0)").run();
  const m = await mapState(env, { client_id: 'c1', regulated: 0 });
  assert.equal(m.placed, true);
  assert.ok(Math.abs(m.lat - 33.3268) < 0.03 && Math.abs(m.lng + 83.3885) < 0.03, 'nudged a short way, like the public card');
  const none = await mapState(env, { client_id: 'c2', regulated: 0 });
  assert.equal(none.placed, false);
  assert.equal(none.lat, undefined);
});

test('an empty account sees one honest example caller, with no real-looking name', () => {
  const ex = html.slice(html.indexOf('function exampleCall'), html.indexOf('function vCustomers'));
  assert.match(ex, />Example</);
  assert.match(ex, /A caller/);
  assert.doesNotMatch(ex, /tel:|sms:|\d{3}-\d{4}/, 'no number, nothing that dials');
});
