// The morning all-clear: once a day in the 7 AM Eastern hour, with yesterday's real counts; a red check changes the first line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { morningCron, morningText, eastern } from '../src/morning.js';

test('sent once in the 7 AM hour, with the counts from the database', async () => {
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1)").run();
  const sevenET = Date.parse('2026-10-29T11:20:00Z');   // 7:20 AM Eastern (daylight time)
  for (let i = 0; i < 3; i++) await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, 'c1', '+14785550100', ?2, 'done', 0)").bind('CA' + i, new Date(sevenET - 5 * 3600e3).toISOString()).run();
  await db.prepare("INSERT INTO leads (at, name, email, status) VALUES (?1, 'Dana', 'd@e.f', 'new')").bind(new Date(sevenET - 3600e3).toISOString()).run();
  await db.prepare("INSERT INTO app_items (id, client_id, kind, status, created) VALUES ('i1', 'c1', 'reply', 'pending', ?1)").bind(new Date(sevenET).toISOString()).run();
  const pings = [];
  const h = { health: async () => ({ ok: true, checks: [{ name: 'd1', ok: true }] }), ping: async (t, b) => pings.push(t + ' | ' + b) };
  assert.deepEqual(await morningCron(env, Date.parse('2026-10-29T10:30:00Z'), h), { skipped: 'not the hour' }, '6:30 AM is too early');
  assert.deepEqual(await morningCron(env, sevenET, h), { sent: true, ok: true });
  assert.deepEqual(pings, ['Always Open: all good | All checks green. Yesterday: 3 calls, 1 lead, 0 jobs booked. 1 draft waiting.']);
  assert.deepEqual(await morningCron(env, sevenET + 20 * 60000, h), { skipped: 'sent today' });
  assert.equal(pings.length, 1);
});

test('a red check leads the message', () => {
  const t = morningText({ ok: false, checks: [{ name: 'stripe', ok: false }, { name: 'cron', ok: false }] }, { calls: 0, leads: 0, drafts: 0, booked: 2, errors: 4 });
  assert.equal(t.title, 'Always Open: 2 checks are red');
  assert.equal(t.body, 'Needs a look: stripe, cron. Yesterday: 0 calls, 0 leads, 2 jobs booked, 4 errors. 0 drafts waiting.');
  assert.deepEqual(eastern(Date.parse('2026-12-15T12:05:00Z')), { day: '2026-12-15', hour: 7 }, 'standard time: 12:05 UTC is 7:05 AM Eastern');
});
