// Always Open's part of his Failsafe (Nov 21, 2026 audit): when it trips, paying clients' billing pauses and every
// client is told; when he turns it back on, billing resumes for the same clients. Nothing runs twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const F = await import('../src/failsafe.js');
const C = await import('../src/checks.js');

async function setup() {
  const DB = H.makeDB(), env = { DB };
  await DB.prepare('CREATE TABLE IF NOT EXISTS hq_kv (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  for (const [cid, biz] of [['c1', 'Sinclair Plumbing'], ['c2', 'Lane Electric'], ['demo-plumbing', 'Demo Plumbing']]) {
    await DB.prepare("INSERT INTO app_clients (client_id, business, active) VALUES (?1, ?2, 1)").bind(cid, biz).run();
  }
  await DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run();
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business) VALUES ('c1', 'sub_1', 'active', 'Sinclair Plumbing'), ('c2', 'sub_2', 'canceled', 'Lane Electric')").run();
  const calls = [];
  const h = { stripe: async (e, m, p, b, idem) => { calls.push([m, p, JSON.stringify(b), idem]); return { id: p.split('/')[1] }; } };
  const fs = (state, at) => DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('failsafe', ?1, ?2)").bind(at || '', JSON.stringify({ state, trip: at ? { at, reason: 'silence' } : undefined })).run();
  const notes = async () => ((await DB.prepare("SELECT client_id, text FROM app_messages WHERE by = 'Always Open' ORDER BY id").all()).results || []);
  return { DB, env, h, calls, fs, notes };
}

test('nothing happens while the Failsafe is armed or missing', async () => {
  const t = await setup();
  assert.equal(await F.failsafeCron(t.env, Date.now(), t.h), 'no failsafe');
  await t.fs('armed');
  assert.equal(await F.failsafeCron(t.env, Date.now(), t.h), 'armed');
  assert.deepEqual(t.calls, []);
  assert.deepEqual(await t.notes(), []);
});

test('a trip pauses paying clients and tells every client once; turning it back on undoes it', async () => {
  const t = await setup();
  const at = '2026-11-21T13:00:00Z';
  await t.fs('tripped', at);
  assert.equal(await F.failsafeCron(t.env, Date.now(), t.h), 'tripped: 1 paused, 2 told');
  assert.deepEqual(t.calls, [['POST', 'subscriptions/sub_1', JSON.stringify({ pause_collection: { behavior: 'void' } }), 'failsafe-pause-sub_1-' + at]], 'only the paying client, never a canceled one');
  assert.equal((await t.DB.prepare("SELECT status FROM billing WHERE client_id = 'c1'").first()).status, 'paused');
  const n = await t.notes();
  assert.deepEqual(n.map(x => x.client_id).sort(), ['c1', 'c2'], 'every active client, never the demo');
  assert.equal(n[0].text, F.AWAY_NOTE);
  // while away, a client's message gets no reply time
  assert.equal(await F.away(t.env), true);
  assert.match(await C.ackMessage(t.env, 'c1', 'Dana', Date.now()), /^Got it, Dana\. Chris is away for a few days\./);
  // the next runs do nothing more
  assert.match(await F.failsafeCron(t.env, Date.now(), t.h), /^tripped$/);
  assert.equal(t.calls.length, 1);
  assert.equal((await t.notes()).length, 2);
  // he turns it back on
  await t.fs('armed');
  assert.equal(await F.failsafeCron(t.env, Date.now(), t.h), 'back: 1 resumed');
  assert.deepEqual(t.calls[1], ['POST', 'subscriptions/sub_1', JSON.stringify({ pause_collection: '' }), 'failsafe-resume-sub_1-' + at]);
  assert.equal((await t.DB.prepare("SELECT status FROM billing WHERE client_id = 'c1'").first()).status, 'active');
  assert.equal((await t.notes()).filter(x => x.text === F.BACK_NOTE).length, 2);
  assert.equal(await F.away(t.env), false);
  assert.equal(await F.failsafeCron(t.env, Date.now(), t.h), 'armed', 'done: nothing more');
});
