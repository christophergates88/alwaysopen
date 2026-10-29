// Posts from job photos, drafted on their own: a new photo becomes a pending post with the photo link within a pass;
// regulated and inactive businesses are held; a photo Claude cannot read gets three tries, then one note.
// Also: Always Open's own Page connects from the ops board link before Meta's review, and Full Max can send posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { photoPostCron } = await import('../src/posts.js');
const { handleMeta } = await import('../src/extras.js');
const { boardToken } = await import('../src/opsboard.js');
const { CATS, CAT_LABELS } = await import('../src/fullmax.js');

async function seeded() {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, phone, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', '+14785551234', 1, 'Growth')").run();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, regulated, tier) VALUES ('c2', 'h2', 'Gates Insurance', 1, 1, 'Pro')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, 'plumbing', 'Eatonton', '2026-10-01T00:00:00Z')").run();
  const img = new Uint8Array(400); img[0] = 0xff; img[1] = 0xd8;
  const at = '2026-11-02T15:00:00Z';
  await db.prepare("INSERT INTO app_photos (id, client_id, at, note, by, mime, size, data, status, hq_synced) VALUES ('p1', 'c1', ?1, 'Water heater swap in Eatonton', 'Owner', 'image/jpeg', 400, ?2, 'new', 0)").bind(at, img).run();
  await db.prepare("INSERT INTO app_photos (id, client_id, at, note, by, mime, size, data, status, hq_synced) VALUES ('p2', 'c2', ?1, '', 'Owner', 'image/jpeg', 400, ?2, 'new', 0)").bind(at, img).run();
  await db.prepare("INSERT INTO app_photos (id, client_id, at, note, by, mime, size, data, status, hq_synced) VALUES ('p3', 'demo-plumbing', ?1, '', 'Owner', 'image/jpeg', 400, ?2, 'new', 0)").bind(at, img).run();
  return db;
}
const later = Date.parse('2026-11-02T15:05:00Z');

test('a new photo becomes a pending post with the photo link; regulated is held; the demo client is skipped', async () => {
  const db = await seeded(); const env = { DB: db };
  const seen = [];
  const h = { write: async (env, c, p) => { seen.push({ c, note: p.note, bytes: p.data ? p.data.length || p.data.byteLength : 0 }); return 'We swapped out a tired water heater for a family in Eatonton this morning. Hot water back before lunch. Give us a call at (478) 555-1234.'; }, alert: async () => {} };
  assert.deepEqual(await photoPostCron(env, Date.parse('2026-11-02T15:00:30Z'), h), { made: 0, held: 0, failed: 0, stuck: 0 }, 'a photo under a minute old waits for its note');
  assert.deepEqual(await photoPostCron(env, later, h), { made: 1, held: 1, failed: 0, stuck: 0 });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].c, { client_id: 'c1', business: 'Sinclair Plumbing', phone: '+14785551234', industry: 'plumbing', town: 'Eatonton' });
  assert.equal(seen[0].bytes, 400, 'Claude got the photo itself');
  const it = await db.prepare("SELECT kind, title, context, text, status, photo, hq_synced FROM app_items WHERE client_id = 'c1'").first();
  assert.equal(it.kind, 'post'); assert.equal(it.status, 'pending'); assert.equal(it.title, 'From your photo');
  assert.equal(it.context, 'Your note: Water heater swap in Eatonton'); assert.equal(it.photo, 'https://alwaysopenoffice.com/p/p1'); assert.equal(it.hq_synced, 0);
  assert.match(it.text, /^We swapped out/);
  const st = Object.fromEntries((await db.prepare('SELECT id, status FROM app_photos').all()).results.map(r => [r.id, r.status]));
  assert.deepEqual(st, { p1: 'drafted', p2: 'held', p3: 'new' });
  assert.deepEqual(await photoPostCron(env, later, h), { made: 0, held: 0, failed: 0, stuck: 0 }, 'nothing left to do');
});

test('a photo Claude cannot read: three tries, then one note to the ops board and the photo is left alone', async () => {
  const db = await seeded(); const env = { DB: db };
  const alerts = [];
  const h = { write: async () => { throw new Error('Claude answered 529: overloaded'); }, alert: async (type, who, detail) => alerts.push({ type, who, detail }) };
  for (let i = 0; i < 3; i++) assert.deepEqual(await photoPostCron(env, later + i * 600e3, h), { made: 0, held: i ? 0 : 1, failed: 1, stuck: i === 2 ? 1 : 0 }, 'try ' + (i + 1));
  assert.equal(alerts.length, 1); assert.equal(alerts[0].type, 'photo-post'); assert.match(alerts[0].detail, /after 3 tries \(Claude answered 529: overloaded\)/);
  assert.equal((await db.prepare("SELECT status FROM app_photos WHERE id = 'p1'").first()).status, 'failed');
  assert.deepEqual(await photoPostCron(env, later + 5 * 600e3, h), { made: 0, held: 0, failed: 0, stuck: 0 }, 'not noted twice');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM app_items").first()).n, 0);
});

test('Always Open’s own Page connects from the ops board link before the review; a wrong token does not', async () => {
  const db = makeDB(); const env = { DB: db, META_APP_ID: 'app', META_APP_SECRET: 'sec', LEADS_KEY: 'the-ops-key' };
  const tok = await boardToken(env);
  const r = await handleMeta(new Request('https://alwaysopenoffice.com/meta/connect?hq=' + tok), env, new URL('https://alwaysopenoffice.com/meta/connect?hq=' + tok));
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.hostname, 'www.facebook.com');
  assert.match(to.searchParams.get('state'), /^always-open\.\d+\.[0-9a-f]{32}$/);
  assert.match(to.searchParams.get('scope'), /pages_manage_posts/);
  const bad = await handleMeta(new Request('https://alwaysopenoffice.com/meta/connect?hq=nope'), env, new URL('https://alwaysopenoffice.com/meta/connect?hq=nope'));
  assert.equal(bad.status, 403);
  const owner = await handleMeta(new Request('https://alwaysopenoffice.com/meta/connect?code=abcdefghijklmnopqrstuvwxyz'), env, new URL('https://alwaysopenoffice.com/meta/connect?code=abcdefghijklmnopqrstuvwxyz'));
  assert.equal(owner.status, 404, 'owners still wait for Meta’s review');
  assert.match(await owner.text(), /coming soon/i);
});

test('Full Max has a posts category', () => {
  assert.ok(CATS.includes('posts'));
  assert.equal(CAT_LABELS.posts, 'Posts from your photos');
});
