// Who's drifting: forwarding off, calls falling, a silent owner, drafts piling up and failed payments, scored so the
// reasons explain the number; internal and canceled clients never show; new clients are never "quiet".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { ensureBookings } = await import('../src/availability.js');
const { score, driftRows, driftTable, driftText } = await import('../src/drift.js');

const NOW = Date.parse('2026-10-20T16:00:00Z');
const ago = d => new Date(NOW - d * 864e5).toISOString();

test('the score is the sum of its reasons', () => {
  assert.deepEqual(score({ hasLine: true, weekCalls: 0, priorWeekly: 4, quietDays: 3, tenureDays: 90, waiting: 0 }).level, 'watch');
  const off = score({ hasLine: true, weekCalls: 0, priorWeekly: 4, quietDays: 20, tenureDays: 90, waiting: 6, pay: 'past_due' });
  assert.equal(off.score, 100);
  assert.equal(off.level, 'call');
  assert.equal(off.reasons.length, 4);
  assert.equal(score({ hasLine: true, weekCalls: 1, priorWeekly: 5, quietDays: 2, tenureDays: 60 }).reasons[0], 'calls down to 1 this week from about 5');
  assert.equal(score({ hasLine: true, weekCalls: 0, priorWeekly: 1, quietDays: 1, tenureDays: 60 }).score, 0, 'a quiet line that was always quiet is not a signal');
  assert.equal(score({ hasLine: true, weekCalls: 3, priorWeekly: 3, quietDays: null, tenureDays: 5 }).score, 0, 'new clients are never quiet');
  assert.equal(score({ hasLine: true, weekCalls: 3, priorWeekly: 3, quietDays: null, tenureDays: 40 }).reasons[0], 'owner has never used the app');
});

test('rows from the tables: worst first, internal and canceled clients left out', async () => {
  const db = makeDB(); const env = { DB: db };
  await ensureBookings(env);
  const client = async (id, name, status, created) => {
    await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES (?1, ?2, ?3, 1)").bind(id, 'h' + id, name).run();
    await db.prepare("INSERT INTO billing (client_id, plan, status, business, created) VALUES (?1, 'Growth', ?2, ?3, ?4)").bind(id, status, name, created).run();
    await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES (?1, ?2, ?3, 1)").bind('+1478555' + id.padStart(4, '0'), id, name).run();
  };
  await client('1', 'Forwarding Off Plumbing', 'active', ago(120));
  await client('2', 'Happy HVAC', 'active', ago(120));
  await client('3', 'Gone Roofing', 'canceled', ago(120));
  await client('always-open', 'Always Open', 'active', ago(200));
  let n = 0;
  const call = (cid, at) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, ?2, '+1', ?3, 'done', 0)").bind('C' + (++n), cid, at).run();
  for (let d = 8; d < 36; d += 2) await call('1', ago(d));            // 14 calls in the 4 weeks before, none this week
  for (let d = 1; d < 36; d += 3) await call('2', ago(d));            // steady
  await db.prepare("INSERT INTO app_items (id, client_id, kind, status, created, decided_at, decided_by) VALUES ('i1', '2', 'reply', 'approved', ?1, ?1, 'Owner')").bind(ago(2)).run();
  await db.prepare("INSERT INTO app_items (id, client_id, kind, status, created, decided_at, decided_by) VALUES ('i2', '1', 'reply', 'approved', ?1, ?1, 'Always Open')").bind(ago(2)).run();
  await db.prepare("INSERT INTO app_messages (client_id, at, text, dir) VALUES ('1', ?1, 'hi', 'in')").bind(ago(40)).run();
  const rows = await driftRows(env, NOW);
  assert.deepEqual(rows.map(r => r.client_id), ['1', '2']);
  assert.equal(rows[0].level, 'call');
  assert.match(rows[0].reasons.join(' '), /forwarding probably off/);
  assert.match(rows[0].reasons.join(' '), /owner silent for 40 days/, 'an Always Open approval is not the owner');
  assert.equal(rows[1].level, 'ok');
  const html = driftTable(rows);
  assert.ok(html.includes('Forwarding Off Plumbing') && html.includes('Call them'));
  assert.ok(html.includes('1 other client looks fine.'));
  assert.match(driftText(rows), /^Call them: Forwarding Off Plumbing/);
});
