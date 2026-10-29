// Always Open's own Facebook and Instagram: a reminder with the link until the Page is connected, then one post on
// Monday, Wednesday and Friday in the 10 AM Eastern hour, Claude's caption or our own words, logged and alerted on failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { socialCron, pickTheme, THEMES, weekNumbers, caughtFallback, socialLine, eastern, HQ } = await import('../src/social.js');

function fakeNet(world) {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = init && init.body != null ? String(init.body) : '';
    world.calls.push({ host: u.hostname, path: u.pathname, body });
    if (u.hostname === 'api.anthropic.com') return world.claudeDown ? new Response('{"error":{"message":"overloaded"}}', { status: 529 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: world.caption }] }), { headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'graph.facebook.com') {
      if (world.fbDown) return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'post_' + world.calls.length }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('not faked', { status: 404 });
  };
}
const monday10 = Date.parse('2026-11-02T15:15:00Z');   // Monday, 10:15 AM Eastern (standard time)
const hooks = () => { const out = { pings: [], alerts: [] }; out.h = { ping: async (t, b, p, tag, click) => out.pings.push({ t, b, click }), alert: async (type, who, detail) => out.alerts.push({ type, who, detail }), boardToken: async () => 'tok123' }; return out; };

test('until the Page is connected: a reminder with the link every three days, nothing else', async () => {
  const db = makeDB(); const env = { DB: db, META_APP_ID: 'app', META_APP_SECRET: 'sec' };
  const k = hooks();
  assert.deepEqual(await socialCron(env, monday10, k.h), { skipped: 'not connected', asked: true });
  assert.equal(k.pings.length, 1);
  assert.match(k.pings[0].click, /\/meta\/connect\?hq=tok123$/);
  assert.deepEqual(await socialCron(env, monday10 + 864e5, k.h), { skipped: 'not connected' }, 'the next day: no second push');
  assert.deepEqual(await socialCron(env, monday10 + 4 * 864e5, k.h), { skipped: 'not connected', asked: true }, 'three days on: asked again');
  assert.deepEqual(await socialCron({ DB: db }, monday10, k.h), { skipped: 'no keys' });
});

test('connected: one post on a posting day in the 10 AM hour, to the Page and Instagram, logged', async () => {
  const db = makeDB(); const env = { DB: db, META_APP_ID: 'app', META_APP_SECRET: 'sec', ANTHROPIC_API_KEY: 'k' };
  await db.prepare("INSERT INTO meta_pages (client_id, page_id, page_name, page_token, ig_id, connected_at) VALUES (?1, 'pg1', 'Always Open', 'ptok', 'ig1', '2026-11-01T00:00:00Z')").bind(HQ).run();
  const world = { calls: [], caption: 'Most callers who reach voicemail call the next name on Google. Max picks up every call to your business and texts you the lead. alwaysopenoffice.com' };
  fakeNet(world);
  const k = hooks();
  assert.deepEqual(await socialCron(env, Date.parse('2026-11-02T14:15:00Z'), k.h), { skipped: 'not the hour' }, '9:15 AM is too early');
  assert.deepEqual(await socialCron(env, Date.parse('2026-11-03T15:15:00Z'), k.h), { skipped: 'not the hour' }, 'Tuesday is not a posting day');
  const r = await socialCron(env, monday10, k.h);
  assert.deepEqual(r, { posted: true, theme: 'missed', result: 'fb:ok,ig:ok' });
  assert.equal(world.calls.filter(c => c.host === 'api.anthropic.com').length, 1, 'Claude wrote the caption');
  const fb = world.calls.filter(c => c.host === 'graph.facebook.com').map(c => c.path);
  assert.deepEqual(fb, ['/v21.0/pg1/photos', '/v21.0/ig1/media', '/v21.0/ig1/media_publish']);
  assert.match(world.calls.find(c => c.path === '/v21.0/pg1/photos').body, /url=https%3A%2F%2Falwaysopenoffice.com%2Fsocial%2Fmissed.jpg/);
  assert.deepEqual(await socialCron(env, monday10 + 20 * 60e3, k.h), { skipped: 'done today' });
  assert.equal(k.pings.length, 1); assert.equal(k.pings[0].t, 'Posted to Facebook and Instagram');
  const row = await db.prepare('SELECT day, theme, text, result FROM social_posts').first();
  assert.deepEqual(row, { day: '2026-11-02', theme: 'missed', text: world.caption, result: 'fb:ok,ig:ok' });
  assert.match(await socialLine(env), /^posting to Always Open and Instagram Monday, Wednesday and Friday; last: 2026-11-02 \(missed, fb:ok,ig:ok\)$/);
});

test('Claude down: our own words go up; Facebook down: one alert and the day is logged as failed', async () => {
  const db = makeDB(); const env = { DB: db, META_APP_ID: 'app', META_APP_SECRET: 'sec', ANTHROPIC_API_KEY: 'k' };
  await db.prepare("INSERT INTO meta_pages (client_id, page_id, page_name, page_token, ig_id, connected_at) VALUES (?1, 'pg1', 'Always Open', 'ptok', '', '2026-11-01T00:00:00Z')").bind(HQ).run();
  const world = { calls: [], claudeDown: true }; fakeNet(world);
  const k = hooks();
  const r = await socialCron(env, monday10, k.h);
  assert.deepEqual(r, { posted: true, theme: 'missed', result: 'fb:ok (own words)' });
  assert.equal((await db.prepare('SELECT text FROM social_posts').first()).text, THEMES[0].fallback);
  world.fbDown = true;
  const r2 = await socialCron(env, Date.parse('2026-11-04T15:15:00Z'), k.h);   // Wednesday
  assert.equal(r2.posted, false); assert.equal(r2.theme, 'grade', 'no real calls yet, so the numbers post gives way to the next theme');
  assert.match(r2.result, /^fb:fail \(Invalid OAuth access token\) \(own words\)$/);
  assert.equal(k.alerts.length, 1); assert.equal(k.alerts[0].type, 'social'); assert.match(k.alerts[0].detail, /did not go up: fb:fail/);
});

test('the rotation and the week numbers', async () => {
  assert.equal(pickTheme(0).name, 'missed');
  assert.equal(pickTheme(1, { calls: 2 }).name, 'grade', 'too few calls to say anything');
  assert.equal(pickTheme(1, { calls: 12 }).name, 'caught');
  assert.equal(pickTheme(7, { calls: 12 }).name, 'caught');
  assert.equal(pickTheme(5).name, 'max');
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1)").run();
  const now = Date.parse('2026-11-02T15:15:00Z');
  const at = ['2026-10-31T15:00:00Z', '2026-11-01T02:30:00Z', '2026-11-02T13:00:00Z', '2026-11-02T04:00:00Z', '2026-10-20T15:00:00Z'];   // Sat day, Sat night, Mon 8 AM, Sun midnight, too old
  for (let i = 0; i < at.length; i++) await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, 'c1', '+14785550100', ?2, 'done', 0)").bind('CA' + i, at[i]).run();
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES ('CAd', 'demo-plumbing', '+14785550100', ?1, 'done', 0)").bind(at[0]).run();
  await db.prepare("INSERT INTO leads (at, name, email, status) VALUES (?1, 'Dana', 'd@e.f', 'new')").bind(at[2]).run();
  const n = await weekNumbers(env, now);
  assert.deepEqual(n, { calls: 4, after: 3, leads: 1, booked: 0 });
  assert.equal(caughtFallback(n), 'This week Max answered 4 calls for the businesses we work for, 3 of them after hours or on the weekend, and passed on 1 new lead. Every one of those callers heard a real answer instead of voicemail. alwaysopenoffice.com');
  assert.deepEqual(eastern(Date.parse('2026-07-06T14:30:00Z')), { day: '2026-07-06', hour: 10, dow: 1 }, 'summer: 14:30 UTC is 10:30 AM Eastern on a Monday');
});
