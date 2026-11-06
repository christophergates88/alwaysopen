// The demo seed: a full sample month for the monthly page, without touching the Hear Max line, the staged Hear Max
// calls, or follow-ups someone added by hand, and with nothing left waiting that a job could call or text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { seedDemo, DEMO_ID } = await import('../src/demo.js');
const { ensureBiz } = await import('../src/biz.js');
const { ensureInvoices } = await import('../src/extras.js');
const { ensureRivals, isoWeek } = await import('../src/rivals.js');
const { ensureReviews } = await import('../src/reviews.js');
const { monthFor } = await import('../src/app.js');
const mods = { ensureBiz, ensureInvoices, ensureRivals, ensureReviews, isoWeek };
const NOW = Date.parse('2026-10-29T16:00:00Z');

await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES (?1, 'h1', 'Demo Plumbing Co.', 1, 'Pro')").bind(DEMO_ID).run();
await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, facts, updated) VALUES ('+14785550100', ?1, 'Mike’s Plumbing', 1, 'plumbing', '{\"hours\":\"edited by hand\"}', '2026-10-01')").bind(DEMO_ID).run();
await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, transcript) VALUES ('CAhearmax', ?1, '+14785550100', '2026-10-29T13:48:00Z', 'done', 1, '[]')").bind(DEMO_ID).run();

test('the seed fills the month and leaves the Hear Max line, its calls and hand-added follow-ups alone', async () => {
  const { ensureCheckins } = await import('../src/checkin.js'); await ensureCheckins(env);
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_followups (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'quote', name TEXT DEFAULT '', phone TEXT DEFAULT '', amount TEXT DEFAULT '', due TEXT DEFAULT '', note TEXT DEFAULT '', consent INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created TEXT, by TEXT DEFAULT '', done_at TEXT DEFAULT '', hq_synced INTEGER NOT NULL DEFAULT 0, reminded TEXT DEFAULT '', appt_at TEXT DEFAULT '', auto_conf TEXT DEFAULT '', auto_rem TEXT DEFAULT '', auto_fu TEXT DEFAULT '')").run().catch(() => {});
  await DB.prepare("INSERT INTO app_followups (client_id, kind, name, status, created, by) VALUES (?1, 'quote', 'Jordan Reese', 'open', '2026-10-23T02:47:07Z', 'Sam')").bind(DEMO_ID).run();
  for (let k = 0; k < 2; k++) {   // twice: a second run replaces the sample, it never doubles it
    const r = await seedDemo(env, mods, NOW);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.line, '+14785550100');
  }
  const line = await DB.prepare('SELECT number, business, facts FROM voice_lines WHERE client_id = ?1').bind(DEMO_ID).all();
  assert.equal(line.results.length, 1); assert.equal(line.results[0].business, 'Mike’s Plumbing'); assert.match(line.results[0].facts, /edited by hand/);
  assert.ok(await DB.prepare("SELECT 1 FROM app_calls WHERE id = 'CAhearmax'").first(), 'the staged Hear Max call keeps its transcript');
  assert.ok(await DB.prepare("SELECT 1 FROM app_followups WHERE by = 'Sam'").first(), 'a follow-up added by hand stays');
  const calls = await DB.prepare("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0 AND number = '+14785550100'").bind(DEMO_ID).first();
  assert.equal(calls.n, 55, '20 sample calls with their stories, and one short call a day for five weeks');
  // nothing waiting that a job would act on
  for (const [t, w] of [['checkins', "status = 'pending'"], ['callbacks', "status IN ('pending','missed','asap')"], ['fillweek_offers', "status = 'sent'"], ['app_followups', "status = 'open' AND by = 'Sample owner'"]]) {
    const n = await DB.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE client_id = ?1 AND ' + w).bind(DEMO_ID).first();
    assert.equal(n.n, 0, t);
  }
  const hand = await DB.prepare('SELECT COUNT(*) AS n FROM handoffs WHERE from_id = ?1 OR to_id = ?1').bind(DEMO_ID).first();
  assert.equal(hand.n, 3, 'hand-offs replaced, not doubled');
});

test('the demo month reads full: check-ins, why callers didn’t book, follow-ups, Google, and against last month', async () => {
  const c = await DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(DEMO_ID).first();
  const m = await monthFor(env, c, 'now', NOW);
  const a = m.a;
  assert.equal(a.calls.n, 49, 'every October call: the 20 with stories and 29 short ones');
  assert.equal(a.calls.booked, 5);
  assert.deepEqual(a.calls.callbacks, { set: 6, kept: 6, missed: 0 });
  assert.equal(a.calls.textback, 3);
  assert.equal(a.lost.n, 5); assert.equal(a.lost.top[0].r, 'price');
  assert.deepEqual(a.work.checkins, { yes: 8, no: 1 });
  assert.equal(a.work.jobsLogged, 10); assert.equal(a.work.asks, 9);
  assert.deepEqual(a.work.fill, { offers: 6, booked: 2 });
  assert.deepEqual(a.work.handoffs, { out: 1, in: 2 });
  assert.equal(a.work.followups.done, 4); assert.equal(a.work.followups.quoteAmount, 12320);
  // jobs are kept in cents; the page talks in dollars
  assert.equal(a.work.won.n, 8); assert.equal(a.work.won.amount, 2210);
  assert.deepEqual(a.google, { calls: 38, clicks: 57, directions: 16 });
  assert.ok(a.rivals && a.rivals.of === 6, 'six on the list, as on the website');
  assert.ok(a.vs && a.vs.label.startsWith('September'), 'compared with the stored September');
  assert.equal(a.vs.calls, 33);
  assert.equal(m.stats.posts, 3, 'approved posts for Google');
  assert.ok(a.insights.length >= 3);
  assert.ok(a.insights.some(i => i.k === 'lost'), 'the price finding shows');
  const sep = await monthFor(env, c, '2026-09', NOW);
  assert.equal(sep.a.calls.n, 16); assert.ok(sep.a.worth && sep.a.worth.mid > 0);
});

// Build Brief 7, Part 1: the demo never runs dry. Seeded on the 20th of a month, every screen the website shows has data.
test('seeded on the 20th: calls on 12 days, a clock worth money, a storm post, last week’s timecard, eight weeks of rivals', async () => {
  const { clockFor } = await import('../src/clock.js');
  const { moneyState } = await import('../src/money.js');
  const { stormState } = await import('../src/stormdesk.js');
  const T = Date.parse('2026-11-20T08:20:00Z');   // 3:20 AM Eastern
  const r = await seedDemo(env, mods, T);
  assert.equal(r.ok, true, JSON.stringify(r));
  const days = await DB.prepare("SELECT COUNT(DISTINCT substr(at, 1, 10)) AS d FROM app_calls WHERE client_id = ?1 AND test = 0 AND at >= '2026-11-01'").bind(DEMO_ID).first();
  assert.ok(days.d >= 12, 'calls on ' + days.d + ' days this month');
  const c = await DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(DEMO_ID).first();
  const money = await moneyState(env, DEMO_ID, T);
  const worth = money && money.thisMonth && money.thisMonth.avgJob ? money.thisMonth.mid : 0;
  assert.ok(worth > 0, 'after-hours calls are worth something at the demo’s own average job');
  const clk = await clockFor(env, DEMO_ID, '2026-11-01T04:00:00Z', new Date(T).toISOString(), { tz: 'America/New_York', mtd: true, worth, now: T });
  assert.ok(clk && clk.calls >= 12 && clk.worth > 0, JSON.stringify(clk && { calls: clk.calls, worth: clk.worth }));
  const storm = await stormState(env, c, T, 'America/New_York');
  assert.equal(storm.county, 'Putnam County, GA');
  assert.equal(storm.active.length, 1);
  assert.equal(storm.active[0].sign, 'FLOOD WARNING');
  assert.match(storm.active[0].line, /^Flood Warning for Putnam County, GA, until 9:30 AM/);
  const tc = await DB.prepare('SELECT * FROM max_timecards WHERE client_id = ?1').bind(DEMO_ID).first();
  assert.equal(tc.status, 'sent'); assert.equal(tc.week, '2026-11-09');
  assert.match(JSON.parse(tc.qa)[0].a, /after hours/);
  const weeks = await DB.prepare('SELECT COUNT(DISTINCT week) AS n FROM rival_snap WHERE client_id = ?1').bind(DEMO_ID).first();
  assert.equal(weeks.n, 8);
  const { liveCheck } = await import('../src/rivals.js');
  const rv = await liveCheck(env, c);
  assert.equal(rv.toFirst.k, 7, '7 more 5-star reviews to be #1, as on the website');
  assert.equal(rv.toFirst.weeks, 6, 'about 6 weeks at the sample’s pace');
  const items = await DB.prepare("SELECT checks FROM app_items WHERE client_id = ?1 AND kind = 'reply'").bind(DEMO_ID).all();
  assert.ok(items.results.every(x => JSON.parse(x.checks).length === 3), 'every sample reply records the three checks it passed');
});

test('the nightly refresh runs in the 3 AM hour once, and again only when the sample has gone stale', async () => {
  const { demoNightly } = await import('../src/demo.js');
  await DB.prepare("DELETE FROM drill_meta WHERE k = 'demo-seeded'").run().catch(() => {});
  const T = Date.parse('2026-11-21T08:05:00Z');   // 3:05 AM Eastern
  const a = await demoNightly(env, mods, T);
  assert.equal(a.why, 'nightly'); assert.equal(a.ok, true);
  const b = await demoNightly(env, mods, T + 10 * 60e3);
  assert.match(b.skipped || '', /minutes ago/, 'a second run 10 minutes later does nothing');
  const noon = await demoNightly(env, mods, T + 9 * 3600e3);
  assert.equal(noon.skipped, 'not the 3 AM hour', 'midday, with a fresh sample, nothing runs');
  const late = await demoNightly(env, mods, T + 50 * 3600e3);   // two nights missed: the newest call is 50 hours old
  assert.equal(late.why, 'stale');
});
