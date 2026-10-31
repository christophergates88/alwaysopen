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
  // A fixed weekday afternoon: quiet hours hold some alerts at night, and a deploy at 11 PM must not fail on the clock.
  const realNow = Date.now; Date.now = () => Date.parse('2026-10-29T18:00:00Z');
  const real = globalThis.fetch; globalThis.fetch = async (u, i) => { sent.push(String(u)); return new Response('{}'); };
  try {
    assert.equal(await O.opsAlert(env, 'health:d1-test', '', 'database did not answer'), 'sent');
    assert.equal(await O.opsAlert(env, 'health:d1-test', '', 'database did not answer'), 'limited');
    assert.equal(sent.filter(u => u.includes('ntfy.example.test')).length, 1);
  } finally { globalThis.fetch = real; Date.now = realNow; }
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

test('a waiting push is quiet or loud by the hour it is SENT, and a loud one may be texted at night', async () => {
  const P = await import('../src/push.js');
  const night = Date.parse('2026-10-31T03:05:00Z'), day = Date.parse('2026-10-30T15:00:00Z');   // 11:05 PM and 11 AM Eastern
  assert.equal(P.sendPriority({ orig: 'high', priority: 'high', loud: 0 }, night), 'low', 'queued at 9:55 PM, retried at 11:05 PM: quiet');
  assert.equal(P.sendPriority({ orig: 'high', priority: 'low', loud: 0 }, day), 'high', 'queued at night, sent in the day: as asked');
  assert.equal(P.sendPriority({ orig: 'urgent', priority: 'urgent', loud: 1 }, night), 'urgent', 'a loud one rings at night');
  const DB = H.makeDB(), env = { DB, NTFY_URL: 'https://ntfy.example.test/x', OPS_TEXT_TO: '+14785550100' };
  await P.ensurePush(env);
  const at = new Date(night - 20 * 60e3).toISOString();
  await DB.prepare("INSERT INTO push_queue (at, title, body, priority, status, orig, loud) VALUES (?1, 'Max unreachable', 'x', 'urgent', 'queued', 'urgent', 1), (?1, 'A quiet one', 'y', 'low', 'queued', 'high', 0)").bind(at).run();
  const texts = [];
  await P.pushCron(env, night, { fetch: async () => new Response('', { status: 503 }), text: async b => { texts.push(b); return { ok: true }; } });
  assert.equal(texts.length, 1);
  assert.match(texts[0], /Max unreachable/);
  assert.doesNotMatch(texts[0], /A quiet one/);
});
