// Max comes with every plan: an owner without a line taps "Set up Max for your calls" in the app and gets a number right
// there, instead of the button sending us a message to do it by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const APP = await import('../src/app.js');
const { appHtml } = await import('../src/apppage.js');
const { default: worker } = await import('../src/index.js');
const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = 'M'.repeat(30);

test('Set up Max turns calls on and buys the line; the button no longer just messages us', async () => {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active, feats) VALUES ('lc', ?1, 'lc', 'Lake Country Foam Party', 'Pro', 'Chris', 1, '')").bind(sha(OWNER)).run();
  await DB.prepare("INSERT INTO billing (client_id, session_id, business, email, phone, town, type, status, created) VALUES ('lc', 's-lc', 'Lake Country Foam Party', 'chris@lc.example', '(478) 555-0144', 'Eatonton, GA', 'Other', 'active', ?1)").bind(new Date().toISOString()).run();
  const site = H.makeClient(worker, env);
  const c0 = await DB.prepare("SELECT * FROM app_clients WHERE client_id = 'lc'").first();
  assert.equal(APP.features(c0).calls, false);
  const r = await site.call('/app/' + OWNER + '/api/max-setup', { json: {} });
  assert.equal(r.status, 200, r.text);
  const j = r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, 'live', JSON.stringify(j));
  const c1 = await DB.prepare("SELECT * FROM app_clients WHERE client_id = 'lc'").first();
  assert.equal(APP.features(c1).calls, true);
  const line = await DB.prepare("SELECT number, spanish FROM voice_lines WHERE client_id = 'lc'").first();
  assert.ok(line && line.number, 'a number was bought');
  assert.equal(line.spanish, 1);
  // tapping again does not buy a second number
  await site.call('/app/' + OWNER + '/api/max-setup', { json: {} });
  const n = await DB.prepare("SELECT COUNT(*) AS n FROM voice_lines WHERE client_id = 'lc'").first();
  assert.equal(n.n, 1);
  const html = String(appHtml.length !== undefined && typeof appHtml === 'function' ? appHtml({}) : appHtml);
  assert.doesNotMatch(html, /Please set up Max, my phone assistant/);
});
