// Google connections that ask to be fixed: a refused refresh is written down, the owner gets one push and a card,
// Christopher gets one alert, a blip is not a break, and a reconnect clears it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { connectionsCron, brokenFor, markOk, markBroken, refusedForGood } from '../src/connections.js';

const setup = async () => {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1)").run();
  await db.prepare("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES ('c1', 'r1', 'America/New_York', '2026-10-01')").run();
  await db.prepare("INSERT INTO gbp_tokens (client_id, refresh, connected_at) VALUES ('c1', 'r2', '2026-10-01')").run();
  return db;
};

test('Google’s final refusals are told apart from blips', () => {
  assert.equal(refusedForGood(400, { error: 'invalid_grant' }), true);
  assert.equal(refusedForGood(401, { error: 'unauthorized_client' }), true);
  assert.equal(refusedForGood(500, { error: 'internal' }), false);
  assert.equal(refusedForGood(0, {}), false);
});

test('a refused calendar: one push, one alert, a card with the text, and a reconnect clears it', async () => {
  const db = await setup(); const env = { DB: db };
  const pushes = [], alerts = [];
  const answers = { calendar: { ok: false, status: 400, body: { error: 'invalid_grant' } }, profile: { ok: true, status: 200, body: {} } };
  const h = { refresh: async kind => answers[kind], push: async (cid, n) => pushes.push(cid + ': ' + n.title), alert: async (t, who, d) => alerts.push(t + ' ' + who) };
  const now = Date.parse('2026-10-28T12:00:00Z');
  let r = await connectionsCron(env, now, h);
  assert.deepEqual(r, { checked: 2, broken: 1, told: 1 });
  assert.deepEqual(pushes, ['c1: Reconnect Google Calendar']);
  assert.deepEqual(alerts, ['google-connection:calendar c1']);
  const b = await brokenFor(env, 'c1');
  assert.equal(b.length, 1); assert.equal(b[0].kind, 'calendar'); assert.match(b[0].text, /Connect it again/);
  // The next day it is still broken: no second push.
  r = await connectionsCron(env, now + 25 * 3600e3, h);
  assert.equal(r.told, 0); assert.equal(pushes.length, 1);
  // Within the day nothing is re-checked.
  r = await connectionsCron(env, now + 26 * 3600e3, h);
  assert.equal(r.checked, 0);
  await markOk(env, 'c1', 'calendar', now + 26 * 3600e3);
  assert.equal((await brokenFor(env, 'c1')).length, 0);
  // Broken again a day after the reconnect: told again, because it was fixed in between.
  r = await connectionsCron(env, now + 51 * 3600e3, h);
  assert.equal(r.told, 1);
});

test('a blip (Google 500) is not a break, and the real refresh path marks the connection as the cron would', async () => {
  const db = await setup(); const env = { DB: db };
  const h = { refresh: async () => ({ ok: false, status: 500, body: {} }), push: async () => { throw new Error('no push for a blip'); }, alert: async () => { throw new Error('no alert for a blip'); } };
  const r = await connectionsCron(env, Date.parse('2026-10-28T12:00:00Z'), h);
  assert.deepEqual(r, { checked: 2, broken: 0, told: 0 });
  assert.equal((await brokenFor(env, 'c1')).length, 0);
  const m = await markBroken(env, 'c1', 'profile', 'invalid_grant');
  assert.equal(m.fresh, true, 'the first time it breaks, the owner has not been told');
  assert.match((await brokenFor(env, 'c1'))[0].text, /reviews aren’t being drafted/);
});
