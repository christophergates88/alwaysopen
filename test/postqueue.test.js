// The Google posting queue: approved replies and posts wait here, oldest first, until Christopher taps Posted; a posted
// one never comes back (and the Google API will not post it again); Yelp, the demo client and pending drafts stay out;
// the page needs the board link; the reminder pushes at most twice a day and only when something is waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const Q = await import('../src/postqueue.js');
const { boardToken } = await import('../src/opsboard.js');

async function seeded() {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, 'Growth')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, 'plumbing', 'Eatonton', '2026-10-01T00:00:00Z')").run();
  const ins = (id, kind, status, decided, extra) => db.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, decided_text, status, hq_synced, checked, created, updated, decided_at, notified) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft words', ?7, ?8, 1, 0, ?9, ?9, ?9, 0)")
    .bind(id, extra && extra.client || 'c1', kind, extra && extra.title || 'Dana R.', extra && extra.context || 'Fixed our leak fast.', 5, 'Thank you, Dana. — Sam', status, decided).run();
  await ins('m:old', 'reply', 'approved', '2026-11-03T12:00:00Z');
  await ins('m:new', 'reply', 'approved', '2026-11-04T12:00:00Z');
  await ins('phst1', 'post', 'approved', '2026-11-04T13:00:00Z', { title: 'Storm Desk: Flooding', context: 'Storm Desk' });
  await ins('m:pend', 'reply', 'pending', '2026-11-04T12:00:00Z');
  await ins('m:yelp', 'reply', 'approved', '2026-11-04T12:00:00Z', { context: 'Yelp review' });
  await ins('m:demo', 'reply', 'approved', '2026-11-04T12:00:00Z', { client: 'demo-plumbing' });
  return db;
}
const now = Date.parse('2026-11-04T16:00:00Z');

test('the queue lists approved replies and posts, oldest first, with the words and a Google link', async () => {
  const env = { DB: await seeded() };
  const items = await Q.queueItems(env, now);
  assert.deepEqual(items.map(i => i.id), ['m:old', 'm:new', 'phst1']);
  assert.equal(items[0].words, 'Thank you, Dana. — Sam');
  assert.equal(items[0].link, 'https://www.google.com/search?q=Sinclair%20Plumbing%20Eatonton+reviews');
  assert.equal(items[2].kind, 'post');
  assert.equal(Q.googleLink({ kind: 'reply', place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', business: 'X' }), 'https://search.google.com/local/reviews?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4');
});

test('Posted takes it off for good and records it the way the Google API does', async () => {
  const env = { DB: await seeded() };
  assert.equal(await Q.markPosted(env, 'm:old', now), true);
  assert.deepEqual((await Q.queueItems(env, now)).map(i => i.id), ['m:new', 'phst1']);
  const p = await env.DB.prepare("SELECT ok, result FROM gbp_posted WHERE item_id = 'm:old'").first();
  assert.deepEqual({ ...p }, { ok: 1, result: 'by hand' });
  assert.equal(await Q.markPosted(env, 'm:pend', now), false, 'a pending draft cannot be marked posted');
  assert.equal(await Q.markPosted(env, 'nope', now), false);
});

test('the page needs the board link, escapes what owners and reviewers wrote, and saves Posted', async () => {
  const env = { DB: await seeded(), LEADS_KEY: 'k'.repeat(32) };
  await env.DB.prepare("UPDATE app_items SET decided_text = '<script>alert(1)</script>' WHERE id = 'm:new'").run();
  const url = t => new URL('https://alwaysopenoffice.com/ops/post' + (t ? '?t=' + t : ''));
  assert.equal((await Q.handlePostQueue(new Request(url('')), env, url(''))).status, 404);
  const tok = await boardToken(env);
  const page = await (await Q.handlePostQueue(new Request(url(tok)), env, url(tok))).text();
  assert.match(page, /Post on Google/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /Copy and open Google/);
  const r = await Q.handlePostQueue(new Request(url(tok), { method: 'POST', body: JSON.stringify({ id: 'm:old' }) }), env, url(tok));
  assert.deepEqual(await r.json(), { ok: true });
  assert.match(Q.queuePage([], tok, now), /All caught up/);
});

test('the reminder: 10 AM and 4 PM Eastern, once each, only when something is waiting', async () => {
  const env = { DB: await seeded(), LEADS_KEY: 'k'.repeat(32) };
  const pings = []; const ping = async (e, title, body, pr, tags, click) => pings.push({ title, click });
  assert.deepEqual(await Q.queuePush(env, Date.parse('2026-11-04T13:00:00Z'), { ping }), { skipped: 'not yet' }, '8 AM Eastern');
  assert.deepEqual(await Q.queuePush(env, Date.parse('2026-11-04T15:10:00Z'), { ping }), { waiting: 5 - 2 });
  assert.deepEqual(await Q.queuePush(env, Date.parse('2026-11-04T15:20:00Z'), { ping }), { skipped: 'sent' });
  assert.equal(pings.length, 1);
  assert.match(pings[0].title, /^2 replies and 1 post ready to post on Google$/);
  assert.match(pings[0].click, /^https:\/\/alwaysopenoffice\.com\/ops\/post\?t=[0-9a-f]{40}$/);
  for (const id of ['m:old', 'm:new', 'phst1']) await Q.markPosted(env, id, now);
  assert.deepEqual(await Q.queuePush(env, Date.parse('2026-11-04T21:10:00Z'), { ping }), { waiting: 0 }, 'nothing waiting: no push');
  assert.equal(pings.length, 1);
});
