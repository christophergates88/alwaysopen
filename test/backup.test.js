// The weekly copy: every table that matters, gzip JSON lines, to R2 when bound, else an email attachment; once a week.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
import { gunzipSync } from 'node:zlib';
register('./rehearsal/hooks.mjs', import.meta.url);
const { runBackup, backupCron, dump, isoWeek, TABLES } = await import('../src/backup.js');

async function seeded() {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1)").run();
  await db.prepare("INSERT INTO leads (at, name, email, status) VALUES ('2026-10-01', 'Dana', 'd@e.f', 'new')").run();
  await db.prepare("INSERT INTO gbp_tokens (client_id, refresh, connected_at) VALUES ('c1', 'SECRET', '2026-10-01')").run();
  return db;
}

test('the dump holds the data tables and never the token tables', async () => {
  const env = { DB: await seeded() };
  const d = await dump(env);
  assert.ok(d.tables >= 20 && d.rows >= 2, d.tables + ' tables, ' + d.rows + ' rows');
  assert.match(d.text, /"table":"leads","row":\{[^\n]*"name":"Dana"/);
  assert.doesNotMatch(d.text, /SECRET|gbp_tokens|gcal_tokens|app_devices/);
  assert.ok(!TABLES.includes('gbp_tokens') && !TABLES.includes('billing_config'));
});

test('to R2 when a bucket is bound, otherwise an email with a gzip attachment that opens', async () => {
  const puts = [];
  let env = { DB: await seeded(), BACKUPS: { put: async (key, body) => puts.push([key, body.length]) } };
  const r = await runBackup(env, Date.parse('2026-11-01T08:30:00Z'));
  assert.equal(r.where, 'r2:backups/alwaysopen-2026-11-01.jsonl.gz');
  assert.equal(puts[0][0], 'backups/alwaysopen-2026-11-01.jsonl.gz');
  const mails = [];
  env = { DB: await seeded(), EMAIL: {}, MAIL_FROM: 'forms@alwaysopenoffice.com', MAIL_TO: 'c@example.com' };
  const r2 = await runBackup(env, Date.parse('2026-11-01T08:30:00Z'), { send: async raw => mails.push(raw) });
  assert.equal(r2.where, 'email:c@example.com');
  const raw = mails[0];
  assert.match(raw, /Subject: Always Open weekly backup 2026-11-01/);
  const b64 = raw.split(/Content-Disposition: attachment; filename="[^"]+"\r\n\r\n/)[1].split('--ao')[0].replace(/[^A-Za-z0-9+/=]/g, '');
  const text = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
  assert.match(text, /"name":"Dana"/);
});

test('the cron runs on Sunday in the early hours, once a week', async () => {
  const env = { DB: await seeded(), BACKUPS: { put: async () => {} } };
  assert.deepEqual(await backupCron(env, Date.parse('2026-10-31T08:30:00Z')), { skipped: 'not the hour' }, 'Saturday');
  assert.deepEqual(await backupCron(env, Date.parse('2026-11-01T03:00:00Z')), { skipped: 'not the hour' }, 'Sunday but 11 PM Eastern');
  const r = await backupCron(env, Date.parse('2026-11-01T08:30:00Z'));
  assert.equal(r.week, '2026-W44');
  assert.deepEqual(await backupCron(env, Date.parse('2026-11-01T09:30:00Z')), { skipped: 'done this week' });
  assert.equal(isoWeek(Date.parse('2026-12-31T12:00:00Z')), '2026-W53');
});
