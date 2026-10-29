// Silence detectors: a line that went quiet after being busy is reported; one that was always quiet is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { silenceWeekly, quietLines, quietProfiles } from '../src/silence.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 864e5;
async function setup() {
  const db = makeDB();
  for (const [cid, biz, num] of [['c1', 'Sinclair Plumbing', '+14785551001'], ['c2', 'Quiet Co', '+14785551002'], ['c3', 'Busy Dental', '+14785551003']]) {
    await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES (?1, ?2, ?3, 1)").bind(cid, 'h' + cid, biz).run();
    await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES (?1, ?2, ?3, 1)").bind(num, cid, biz).run();
  }
  const call = (num, cid, daysAgo, i) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, ?2, ?3, ?4, 'done', 0)").bind('CA' + cid + daysAgo + '_' + i, cid, num, new Date(NOW - daysAgo * DAY).toISOString()).run();
  // c1: 4 calls a week for four weeks, then nothing this week
  for (let d = 8; d <= 35; d++) if (d % 2 === 0) await call('+14785551001', 'c1', d, 0);
  // c3: busy every week including this one
  for (let d = 1; d <= 35; d += 2) await call('+14785551003', 'c3', d, 0);
  return db;
}

test('a busy line gone quiet is reported; a line that was always quiet, and a still-busy one, are not', async () => {
  const env = { DB: await setup() };
  const q = await quietLines(env, NOW);
  assert.deepEqual(q.map(x => [x.business, x.perWeek]), [['Sinclair Plumbing', 4]]);
  const alerts = [];
  const r = await silenceWeekly(env, NOW, async (t, who, d) => alerts.push(t + ' | ' + d));
  assert.deepEqual(r, { lines: 1, profiles: 0 });
  assert.match(alerts[0], /^quiet-line:c1 \| Sinclair Plumbing had no calls this week on a line that averaged 4 a week/);
});

test('a connected profile with reviews that stopped is reported', async () => {
  const env = { DB: await setup() };
  await env.DB.prepare("INSERT INTO gbp_tokens (client_id, refresh, connected_at) VALUES ('c1', 'r', '2026-08-01')").run();
  await env.DB.prepare("INSERT INTO gbp_tokens (client_id, refresh, connected_at) VALUES ('c3', 'r', '2026-08-01')").run();
  for (let d = 20; d <= 60; d += 10) await env.DB.prepare("INSERT INTO gbp_seen (review, client_id, at) VALUES (?1, 'c1', ?2)").bind('rv' + d, new Date(NOW - d * DAY).toISOString()).run();
  await env.DB.prepare("INSERT INTO gbp_seen (review, client_id, at) VALUES ('rv-c3', 'c3', ?1)").bind(new Date(NOW - 3 * DAY).toISOString()).run();
  const p = await quietProfiles(env, NOW);
  assert.deepEqual(p.map(x => [x.business, x.before]), [['Sinclair Plumbing', 5]]);
});
