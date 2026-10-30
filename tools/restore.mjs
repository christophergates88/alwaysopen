// Loads a weekly copy (alwaysopen-<date>.jsonl.gz) into a SQLite file, so the data can be read, checked, or turned
// into inserts for a new D1 database. Run from the repo root:
//   node tools/restore.mjs alwaysopen-2026-11-01.jsonl.gz restored.sqlite          -> a SQLite file with every table
//   node tools/restore.mjs alwaysopen-2026-11-01.jsonl.gz restored.sqlite --sql    -> also writes restore.sql for `wrangler d1 execute --file`
// Prints the row count per table. Tables come from test/fixtures/schema.sql and tools/restore-extra.sql; a table missing
// from both is created from its rows, and a column missing from either is added before its rows go in.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
const [file, out, flag] = process.argv.slice(2);
if (!file || !out) { console.error('usage: node tools/restore.mjs <copy.jsonl.gz> <out.sqlite> [--sql]'); process.exit(2); }
const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
const db = new DatabaseSync(out);
db.exec(fs.readFileSync(new URL('../test/fixtures/schema.sql', import.meta.url), 'utf8'));
db.exec(fs.readFileSync(new URL('./restore-extra.sql', import.meta.url), 'utf8'));
const counts = {}, sql = [];
const q = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const made = new Set();
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  const { table, row } = JSON.parse(line);
  const cols = Object.keys(row);
  if (!made.has(table)) {
    const exists = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) { const ddl = 'CREATE TABLE ' + table + ' (' + cols.map(c => c + (/^id$/.test(c) ? ' PRIMARY KEY' : '')).join(', ') + ')'; db.exec(ddl); sql.push(ddl + ';'); }
    made.add(table);
  }
  // Columns the live database gained after schema.sql was written (the code adds them as it goes): added here, so no
  // row is ever dropped for "no column named ...".
  const have = new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name));
  for (const c of cols) if (!have.has(c)) { const ddl = 'ALTER TABLE ' + table + ' ADD COLUMN ' + c; db.exec(ddl); sql.push(ddl + ';'); }
  const ins = 'INSERT OR REPLACE INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map(c => q(row[c])).join(', ') + ')';
  try { db.exec(ins); counts[table] = (counts[table] || 0) + 1; if (flag === '--sql') sql.push(ins + ';'); }
  catch (e) { console.error(table + ': ' + e.message.slice(0, 120)); }
}
if (flag === '--sql') fs.writeFileSync('restore.sql', sql.join('\n') + '\n');
for (const t of Object.keys(counts).sort()) console.log(t.padEnd(20), counts[t]);
console.log(JSON.stringify(counts));
