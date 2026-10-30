// Ops fixes from the full review: an alert gets out when the database is what broke; a Twilio hiccup is never
// reported as "number not in the account"; renewals remind once per step; the test call says when it can't start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const O = await import('../src/ops.js');

test('with the database down, the alert still goes out once (and only once)', async () => {
  const sent = [];
  const env = { DB: { prepare() { throw new Error('D1_ERROR: database unavailable'); } }, NTFY_URL: 'https://ntfy.example.test/x' };
  const real = globalThis.fetch; globalThis.fetch = async (u, i) => { sent.push(String(u)); return new Response('{}'); };
  try {
    assert.equal(await O.opsAlert(env, 'health:d1-test', '', 'database did not answer'), 'sent');
    assert.equal(await O.opsAlert(env, 'health:d1-test', '', 'database did not answer'), 'limited');
    assert.equal(sent.filter(u => u.includes('ntfy.example.test')).length, 1);
  } finally { globalThis.fetch = real; }
});

test('a Twilio error while checking numbers is "could not check", never "not in the Twilio account"', async () => {
  const DB = H.makeDB();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785551234', 'c1', 'Sinclair Plumbing', 1)").run();
  const env = { DB, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', VOICE_KEY: 'vk' };
  const f = async url => String(url).includes('IncomingPhoneNumbers') ? new Response('{"message":"busy"}', { status: 503 }) : new Response('{}', { status: 404 });
  const res = await O.slowChecks(env, { fetch: f, ping: async () => {} });
  const tw = res.find(c => c.name === 'twilio-numbers');
  assert.equal(tw.ok, true);
  assert.match(tw.why, /Twilio did not answer for 1 number/);
});

test('a renewal reminds once at each step, not every day', async () => {
  const DB = H.makeDB(), env = { DB };
  const F = await import('../src/funding.js');
  const r1 = await F.fundAlert(env, 'renew:domain:30', 'warn', 't', 'b', { once: true });
  const r2 = await F.fundAlert(env, 'renew:domain:30', 'warn', 't', 'b', { once: true });
  assert.equal(r1, 'sent'); assert.equal(r2, 'limited');
  // Clearing Twilio's alerts leaves the balance-read alert alone.
  await DB.prepare("INSERT INTO funding_alerts (k, at) VALUES ('twilio-read:warn', 1), ('twilio:warn', 1)").run();
  await F.fundAlert(env, 'twilio', 'ok');
  const left = ((await DB.prepare('SELECT k FROM funding_alerts ORDER BY k').all()).results).map(r => r.k);
  assert.ok(left.includes('twilio-read:warn') && !left.includes('twilio:warn'));
});
