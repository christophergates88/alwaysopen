// The weekly copy restores to the same data: values, not just row counts (an earlier restore wrote column names as
// values and still matched every count). Also: columns the code added later and tables missing from schema.sql survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const B = await import('../src/backup.js');

test('a backup restores with every value intact, and app codes are never in it', async () => {
  const DB = H.makeDB(), env = { DB };
  await (await import('../src/leadmail.js')).ensureLeadMail(env);
  await DB.prepare("INSERT INTO leads (at, name, email, status, audit, grade) VALUES ('2026-10-29T12:00:00Z', 'Pat O''Neil', 'pat@example.test', 'new', 'sent', 'C')").run();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h', 'Sinclair Plumbing', 1)").run();
  await (await import('../src/billing.js')).ensureBilling(env);
  await DB.prepare("INSERT INTO billing (client_id, session_id, plan, status, business, code) VALUES ('c1', 'cs_1', 'Growth', 'active', 'Sinclair Plumbing', 'SECRETCODE123')").run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS minute_overage (client_id TEXT, month TEXT, minutes INTEGER, cents INTEGER, invoiced TEXT, invoice_item TEXT, PRIMARY KEY (client_id, month))').run();
  await DB.prepare("INSERT INTO minute_overage VALUES ('c1', '2026-10', 30, 750, '2026-11-02', 'ii_1')").run();
  const d = await B.dump(env);
  assert.doesNotMatch(d.text, /SECRETCODE123/, 'an app code never leaves the database');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));
  fs.writeFileSync(path.join(dir, 'copy.jsonl.gz'), await B.gzip(d.text));
  execFileSync(process.execPath, [path.resolve('tools/restore.mjs'), path.join(dir, 'copy.jsonl.gz'), path.join(dir, 'out.sqlite')], { stdio: 'pipe' });
  const r = new DatabaseSync(path.join(dir, 'out.sqlite'));
  assert.deepEqual({ ...r.prepare('SELECT name, email, audit, grade FROM leads').get() }, { name: "Pat O'Neil", email: 'pat@example.test', audit: 'sent', grade: 'C' });
  assert.deepEqual({ ...r.prepare('SELECT plan, business FROM billing').get() }, { plan: 'Growth', business: 'Sinclair Plumbing' });
  assert.deepEqual({ ...r.prepare('SELECT minutes, cents FROM minute_overage').get() }, { minutes: 30, cents: 750 });
  assert.match(r.prepare("SELECT sql FROM sqlite_master WHERE name = 'minute_overage'").get().sql, /PRIMARY KEY \(client_id, month\)/, 'its key comes back too');
});
