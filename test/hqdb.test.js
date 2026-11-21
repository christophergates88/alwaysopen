// The database split (Nov 21, 2026 audit): with HQDB bound, Gates HQ's routes, jobs and calls work in Gates HQ's own
// database and the business never touches it; pushes from both sides still reach the Mac in one list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { hqEnv } = await import('../src/hqdb.js');
const P = await import('../src/push.js');

function split(extra) {
  const world = new H.World(), DB = H.makeDB(), HQDB = H.makeDB();
  const env = Object.assign(H.makeEnv(world, DB), { HQDB, LEADS_KEY: 'k'.repeat(40) }, extra || {});
  H.installFetch(world, env);
  return { world, DB, HQDB, env };
}
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();

test('hqEnv points DB at Gates HQ\'s database, and changes nothing without one', () => {
  const DB = {}, HQDB = {};
  const plain = { DB };
  assert.equal(hqEnv(plain), plain);
  const env = { DB, HQDB, X: 1, ANTHROPIC_API_KEY: 'max' };
  const he = hqEnv(env);
  assert.equal(he.DB, HQDB);
  assert.equal(he.X, 1);
  assert.equal(he.ANTHROPIC_API_KEY, 'max', 'Max\'s key until Gates HQ has its own');
  assert.equal(hqEnv(he), he, 'once only');
  assert.equal(hqEnv({ DB, HQDB, ANTHROPIC_API_KEY: 'max', HQ_ANTHROPIC_API_KEY: 'hq' }).ANTHROPIC_API_KEY, 'hq');
});

test('a Gates HQ route writes only to Gates HQ\'s database', async () => {
  const { DB, HQDB, env } = split();
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  const tok = 't'.repeat(32);
  await HQDB.prepare('CREATE TABLE IF NOT EXISTS hq_widget (id INTEGER PRIMARY KEY, token TEXT, at TEXT, json TEXT)').run();
  await HQDB.prepare("INSERT OR REPLACE INTO hq_widget (id, token, at, json) VALUES (1, ?1, '2026-11-21', '{\"ok\":1}')").bind(tok).run();
  const r = await site.call('/ops/hq-where?t=' + tok, { json: { pts: [{ at: new Date().toISOString(), kind: 'visit', lat: 33.3, lon: -83.4 }] } });
  assert.equal(r.status, 200, r.text);
  assert.equal(+(await one(HQDB, 'SELECT COUNT(*) AS n FROM hq_where')).n, 1);
  const inBiz = await one(DB, "SELECT name FROM sqlite_master WHERE name = 'hq_where'");
  assert.equal(inBiz, null, 'the business database never got the table');
  const w = await site.call('/ops/hq-widget?t=' + tok);
  assert.equal(w.status, 200);
  assert.equal(JSON.parse(w.text).ok, 1);
});

test('the Mac takes both queues in one list and its report lands in the right one', async () => {
  const { DB, HQDB, env } = split();
  const ins = (db, title) => db.prepare("INSERT INTO push_queue (at, title, body, priority, tags, click, status, why, orig, loud) VALUES (?1, ?2, 'b', 'default', '', '', 'queued', '', 'default', 0)").bind(new Date().toISOString(), title).run();
  await P.ensurePush(env); await P.ensurePush(hqEnv(env));
  await ins(DB, 'Always Open: a new lead');
  await ins(HQDB, 'Failsafe: tap I\'m here');
  const t = await P.relayTake(env);
  assert.deepEqual(t.items.map(i => i.title).sort(), ['Always Open: a new lead', 'Failsafe: tap I\'m here']);
  const hq = t.items.find(i => /Failsafe/.test(i.title)), biz = t.items.find(i => /lead/.test(i.title));
  assert.ok(hq.id > P.HQ_ID && biz.id < P.HQ_ID);
  assert.deepEqual(await P.relayDone(env, { done: [hq.id, biz.id] }), { ok: true, done: 2, failed: 0 });
  assert.equal((await one(HQDB, "SELECT status FROM push_queue WHERE title LIKE 'Failsafe%'")).status, 'done');
  assert.equal((await one(DB, "SELECT status FROM push_queue WHERE title LIKE 'Always Open%'")).status, 'done');
  // without HQDB nothing changes: one queue, ids as they are
  const solo = Object.assign({}, env, { HQDB: undefined });
  await ins(DB, 'Always Open: another');
  const s = await P.relayTake(solo);
  assert.equal(s.items.length, 1);
  assert.ok(s.items[0].id < P.HQ_ID);
});

test('Always Open\'s numbers for Gates HQ 2 come from the business database, counts only', async () => {
  const { DB, env } = split();
  const { aoNumbers } = await import('../src/hqclaude.js');
  await DB.prepare("INSERT INTO leads (at, name, business, phone, status) VALUES (?1, 'Dana', 'Sinclair Plumbing', '+14785550101', 'new')").bind(new Date().toISOString()).run();
  const n = await aoNumbers(env, new Date(Date.now() - 7 * 864e5).toISOString(), new Date(Date.now() - 864e5).toISOString());
  assert.equal(n.leads7, 1);
  assert.deepEqual(Object.keys(n).sort(), ['calls7', 'calls_today', 'clients', 'leads7', 'msgs7', 'paying', 'waiting_owners']);
  assert.equal(await aoNumbers(env, 'not a time', 'x'), null);
});
