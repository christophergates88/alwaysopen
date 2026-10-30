// Google Business Profile, Google Calendar and the client reports: the defects an outside review found, each pinned by
// a test. Runs the real worker code on the rehearsal stand-ins (test/rehearsal/harness.js): D1 on SQLite, and Google
// answered here, never on the internet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', GBP_ON: '1' });
const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();
const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
const keep = setInterval(() => {}, 1000);   // the harness unrefs timers; the slow fake Google below needs the process up
after(() => clearInterval(keep));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });

// Google, as each test needs it. answer(url, init) returns a Response, or nothing for the defaults below.
let answer = () => null;
const seen = [];
globalThis.fetch = async (input, init) => {
  const url = String((input && input.url) || input);
  seen.push(url);
  const r = await answer(url, init || {});
  if (r) return r;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
  if (url.includes('mybusinessaccountmanagement.googleapis.com/v1/accounts')) return json({ accounts: [{ name: 'accounts/1' }] });
  if (url.includes('mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations')) return json({ locations: [{ name: 'locations/AAA', title: 'Smith Plumbing', phoneNumbers: { primaryPhone: '(478) 555-0101' }, metadata: { placeId: 'ChIJ_A' } }] });
  return json({});
};

const gbp = await import('../src/gbp.js');
const launch = await import('../src/launch.js');
const client = (cid, business, extra) => run('INSERT INTO app_clients (client_id, code_hash, ref, business, phone, tier, regulated, active) VALUES (?1, ?1, ?1, ?2, ?3, ?4, 0, 1)', cid, business, (extra && extra.phone) || '', (extra && extra.tier) || '');
await gbp.saveRefresh(env, gbp.AGENCY, 'refresh-agency');

// ---------- 1 ----------
test('1. a different place id rules a profile out, and one Google profile never serves two clients', async () => {
  const pool = [{ account: 'accounts/1', location: 'locations/AAA', title: 'Smith Plumbing', phones: ['4785550101'], placeId: 'ChIJ_A' }];
  assert.equal(gbp.pickLocation({ business: 'Smith Plumbing LLC', phones: ['7065550199'], placeId: 'ChIJ_B' }, pool), null, 'same name, different place: not theirs');
  assert.equal(gbp.pickLocation({ business: 'Smith Plumbing', placeId: 'ChIJ_B' }, [Object.assign({}, pool[0], { placeId: '' })]).how, 'name', 'a profile with no place id can still match by name');
  assert.equal(gbp.pickLocation({ business: 'Smith Plumbing', placeId: 'ChIJ_A' }, pool).how, 'place');

  // Macon owns the profile (its phone is on it); Augusta's name matches too, and yesterday's pass had already mapped it there.
  await client('smith-macon', 'Smith Plumbing', { phone: '4785550101' });
  await client('smith-augusta', 'Smith Plumbing, LLC', { phone: '7065550199' });
  await run("INSERT INTO gbp_locations (client_id, account, location, title, matched, via, updated) VALUES ('smith-augusta', 'accounts/1', 'locations/AAA', 'Smith Plumbing', 'name', 'agency', '')");
  const out = await gbp.mapLocations(env);
  assert.deepEqual(await all("SELECT client_id, location, matched FROM gbp_locations WHERE client_id LIKE 'smith-%'"), [{ client_id: 'smith-macon', location: 'locations/AAA', matched: 'phone' }]);
  assert.deepEqual(out.shared, [{ name: 'Smith Plumbing, LLC', other: 'Smith Plumbing' }]);
  const board = await gbp.gbpBoard(env);
  const dup = board.find(x => x.group === 'Google: two businesses, one profile');
  assert.ok(dup && dup.title === 'Smith Plumbing, LLC' && /Smith Plumbing/.test(dup.detail), JSON.stringify(board));

  // A hand mapping holds its profile against any automatic match; equal matches give it to nobody.
  let s = gbp.settleLocations([{ cid: 'x', name: 'X', loc: { location: 'locations/AAA' }, how: 'place' }], [{ cid: 'y', name: 'Y', location: 'accounts/1/locations/AAA' }]);
  assert.deepEqual([s.win.length, s.refused.map(r => r.cid + '>' + r.other)], [0, ['x>Y']]);
  s = gbp.settleLocations([{ cid: 'a', name: 'A', loc: { location: 'locations/B' }, how: 'name' }, { cid: 'b', name: 'B', loc: { location: 'locations/B' }, how: 'name' }], []);
  assert.deepEqual([s.win.length, s.refused.length], [0, 2]);
});

// ---------- 2 ----------
test('2. an approved post goes to Google once, even when the timer reaches it during the approval-time post', async () => {
  const posts = [];
  answer = async (url, init) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) { await sleep(40); return json({ access_token: 'tok2', expires_in: 3600 }); }
    if (url.endsWith('/localPosts')) { await sleep(80); posts.push(JSON.parse(init.body).summary); return json({ name: 'accounts/1/locations/9/localPosts/' + posts.length }); }
  };
  await client('oak-dental', 'Oak Dental');
  await run("INSERT INTO gbp_locations (client_id, account, location, title, matched, via, updated) VALUES ('oak-dental', 'accounts/1', 'locations/9', 'Oak Dental', 'hand', 'agency', '')");
  await run("INSERT OR REPLACE INTO launch (k, on_, at) VALUES ('google', 1, ?1)", new Date(Date.now() - 864e5).toISOString());
  launch.forget();
  const now = new Date().toISOString();
  await run("INSERT INTO app_items (id, client_id, kind, title, text, status, created, updated) VALUES ('p1', 'oak-dental', 'post', 'Fall', 'Fall cleanings are open this week.', 'pending', ?1, ?1)", now);
  const app = await import('../src/app.js');
  const c = await get("SELECT * FROM app_clients WHERE client_id = 'oak-dental'");
  const waits = [];
  const r = await app.approveItem(env, { waitUntil: p => waits.push(p) }, c, await get("SELECT * FROM app_items WHERE id = 'p1'"), '', 'Owner');
  assert.equal(r.status, 200);
  await sleep(10);   // the 10-minute timer lands while the approval-time post is waiting on Google
  await Promise.all([...waits, gbp.gbpCron(env, Date.now())]);
  assert.deepEqual(posts, ['Fall cleanings are open this week.']);
  assert.equal((await get("SELECT ok FROM gbp_posted WHERE item_id = 'p1'")).ok, 1);

  // Two attempts at the very same moment: one posts, the other sees the claim and stops.
  await run("INSERT INTO app_items (id, client_id, kind, title, text, decided_text, status, decided_at, created, updated) VALUES ('p2', 'oak-dental', 'post', 'Winter', 'Book a winter checkup.', 'Book a winter checkup.', 'approved', ?1, ?1, ?1)", now);
  const it2 = await get("SELECT * FROM app_items WHERE id = 'p2'");
  const both = await Promise.all([gbp.publishItem(env, c, it2, it2.decided_text), gbp.publishItem(env, c, it2, it2.decided_text)]);
  assert.deepEqual(both.slice().sort(), ['busy', 'posted']);
  assert.equal(posts.filter(p => p === 'Book a winter checkup.').length, 1);

  // A claim left behind by a worker that died: fresh, it is left alone; stale, the next attempt takes it over.
  await run("INSERT INTO app_items (id, client_id, kind, title, text, decided_text, status, decided_at, created, updated) VALUES ('p3', 'oak-dental', 'post', 'Spring', 'Spring is here.', 'Spring is here.', 'approved', ?1, ?1, ?1)", now);
  const it3 = await get("SELECT * FROM app_items WHERE id = 'p3'");
  await run("INSERT INTO gbp_posted (item_id, client_id, kind, ok, tries, result, at) VALUES ('p3', 'oak-dental', 'post', 0, 0, 'posting', ?1)", new Date(Date.now() - 60e3).toISOString());
  assert.equal(await gbp.publishItem(env, c, it3, it3.decided_text), 'busy');
  await run("UPDATE gbp_posted SET at = ?1 WHERE item_id = 'p3'", new Date(Date.now() - 40 * 60e3).toISOString());
  await gbp.gbpCron(env, Date.now());   // the timer picks up the stale claim
  assert.equal(posts.filter(p => p === 'Spring is here.').length, 1);
  assert.deepEqual(await get("SELECT ok, tries, result FROM gbp_posted WHERE item_id = 'p3'"), { ok: 1, tries: 2, result: 'posted' }, 'the dead attempt counts as a try');
  answer = () => null;
});

// ---------- 3 ----------
test('3. switching Google on by hand (no launch time) posts nothing that was approved before the switch', async () => {
  const posts = [];
  answer = async (url, init) => { if (url.endsWith('/localPosts')) { posts.push(JSON.parse(init.body).summary); return json({ name: 'x/localPosts/' + posts.length }); } };
  await run("DELETE FROM launch WHERE k = 'google'");
  await run("DELETE FROM gbp_runs WHERE k = 'on'");
  launch.forget();
  await client('elm-roof', 'Elm Roofing');
  await run("INSERT INTO gbp_locations (client_id, account, location, title, matched, via, updated) VALUES ('elm-roof', 'accounts/1', 'locations/31', 'Elm Roofing', 'hand', 'agency', '')");
  const old = new Date(Date.now() - 9 * 864e5).toISOString();
  await run("INSERT INTO app_items (id, client_id, kind, title, text, decided_text, status, decided_at, created, updated) VALUES ('e0', 'elm-roof', 'post', 'Old', 'Posted by hand already.', 'Posted by hand already.', 'approved', ?1, ?1, ?1)", old);
  const t0 = Date.now();
  await gbp.gbpCron(env, t0);
  assert.deepEqual(posts, [], 'the post Christopher already put up by hand is not posted again');
  const stamp = await get("SELECT at FROM gbp_runs WHERE k = 'on'");
  assert.ok(stamp && Math.abs(Date.parse(stamp.at) - t0) < 5000, 'the moment it was found on is kept');
  // Approved after the switch, and missed by the approval-time attempt: the timer posts it.
  const later = new Date(t0 + 60e3).toISOString();
  await run("INSERT INTO app_items (id, client_id, kind, title, text, decided_text, status, decided_at, created, updated) VALUES ('e1', 'elm-roof', 'post', 'New', 'New gutters this week.', 'New gutters this week.', 'approved', ?1, ?1, ?1)", later);
  await gbp.gbpCron(env, t0 + 2 * 60e3);
  assert.deepEqual(posts, ['New gutters this week.']);
  // Off again: the stamp goes, so a later switch-on starts from its own moment.
  launch.forget();
  assert.deepEqual(await gbp.gbpCron(Object.assign({}, env, { GBP_ON: '' }), Date.now()), { off: true });
  assert.equal(await get("SELECT at FROM gbp_runs WHERE k = 'on'"), null);
  launch.forget();
  answer = () => null;
});

// ---------- 4 ----------
test('4. imported past jobs are not this month’s money, on the month page or the year page', async () => {
  await client('pine-imp', 'Pine Plumbing');
  const now = Date.now(), iso = new Date(now).toISOString();
  await run("INSERT INTO biz_jobs (client_id, name, title, stage, amount, source, source_id, created, updated) VALUES ('pine-imp', 'Pat', 'Water heater', 'paid', 48000, 'manual', 'm1', ?1, ?1)", iso);
  for (let i = 0; i < 40; i++) await run("INSERT INTO biz_jobs (client_id, name, title, stage, amount, source, source_id, created, updated) VALUES ('pine-imp', 'Old', 'Water heater install', 'done', 240000, 'import', ?1, '2022-03-10T00:00:00Z', ?2)", 'i' + i, iso);
  const I = await import('../src/insights.js');
  const start = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString();
  const a = await I.monthAnalytics(env, 'pine-imp', start, new Date(now + 864e5).toISOString(), { tz: 'America/New_York' });
  assert.deepEqual(a.work.won, { n: 1, amount: 480 });
  const T = await import('../src/trends.js');
  assert.equal((await T.trendsFor(env, { client_id: 'pine-imp' }, now)).since.won, 480);
});

// ---------- 5 ----------
test('5. the share card turns invoice cents into dollars', async () => {
  await client('cedar-inv', 'Cedar Electric');
  await run("INSERT INTO billing (client_id, created) VALUES ('cedar-inv', '2026-01-01T00:00:00Z')");
  const d = new Date(), lm = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)).toISOString();
  await run("INSERT INTO app_invoices (client_id, token, name, amount, status, paid_at, created) VALUES ('cedar-inv', 'tok-cedar', 'Pat', 125000, 'paid', ?1, ?1)", lm);
  const fl = await import('../src/firstlook.js');
  const sh = await fl.shareState(env, { client_id: 'cedar-inv' }, 'https://alwaysopenoffice.com/?ref=x');
  assert.equal(sh.wins.paid, 1250);
  assert.match(sh.message, /\$1,250 in invoices got paid/);
  assert.ok(!/125,000/.test(sh.message));
});

// ---------- 6 and 7 ----------
test('6. the monthly report counts the business’s own month, not the UTC one', async () => {
  const cid = 'pine-hvac';
  await client(cid, 'Pine HVAC');
  await run("INSERT INTO billing (client_id, created, status, plan) VALUES (?1, '2026-09-01T00:00:00Z', 'active', 'Growth')", cid);
  await run("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES (?1, 'r-pine', 'America/Los_Angeles', '2026-09-01')", cid);
  await run('INSERT INTO app_settings (client_id, avg_job, win_rate) VALUES (?1, 500, 30)', cid);
  // Friday and Saturday evenings Pacific (already Oct 31 / Nov 1 in UTC), plus one each side of the month in Pacific time.
  for (const [id, at] of [['c1', '2026-10-31T02:30:00Z'], ['c2', '2026-11-01T02:00:00Z'], ['c3', '2026-11-01T04:00:00Z'], ['c4', '2026-11-01T05:30:00Z'], ['sep', '2026-10-01T03:00:00Z'], ['nov', '2026-11-01T08:00:00Z']])
    await run("INSERT INTO app_calls (id, client_id, at, caller_name, reason, outcome, test) VALUES (?1, ?2, ?3, 'Pat', 'No heat', 'done', 0)", id, cid, at);
  const rep = await import('../src/report.js');
  for (let i = 0; i < 4 && !(await get("SELECT 1 AS x FROM app_months WHERE client_id = ?1 AND month = '2026-10'", cid)); i++) await rep.monthReportCron(env, Date.parse('2026-11-02T00:10:00Z'));
  const d = JSON.parse((await get("SELECT data FROM app_months WHERE client_id = ?1 AND month = '2026-10'", cid)).data);
  assert.equal(d.a.calls.n, 4, 'the four October evenings, not September’s or November’s');
  assert.equal(d.a.calls.after, 4);
  assert.match(d.note, /In all, Max answered 4 calls\./);
  assert.equal(d.a.worth.after, 4, 'the money line and the call count agree');
  const m = rep.inZone(rep.monthOf(Date.parse('2026-11-02T00:10:00Z')), 'America/Los_Angeles');
  assert.deepEqual([m.start, m.end], ['2026-10-01T07:00:00.000Z', '2026-11-01T07:00:00.000Z']);
});

test('7. Google’s numbers that arrive after the report is written still reach the month page', async () => {
  const cid = 'pine-hvac';
  await run("INSERT INTO gbp_locations (client_id, account, location, title, matched, via, updated) VALUES (?1, 'accounts/1', 'locations/77', 'Pine HVAC', 'hand', 'agency', '')", cid);
  const before = JSON.parse((await get("SELECT data FROM app_months WHERE client_id = ?1 AND month = '2026-10'", cid)).data);
  assert.equal(before.a.google, null, 'on the 2nd Google has nothing yet');
  const series = (k, vals) => ({ dailyMetric: k, timeSeries: { datedValues: vals.map(v => ({ value: String(v) })) } });
  answer = url => url.includes(':fetchMultiDailyMetricsTimeSeries') ? json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [series('CALL_CLICKS', [20, 11]), series('WEBSITE_CLICKS', [50, 2]), series('BUSINESS_DIRECTION_REQUESTS', [18])] }] }) : null;
  await run("DELETE FROM gbp_runs WHERE k = 'metrics'");
  launch.forget();
  await gbp.gbpCron(env, Date.parse('2026-11-03T12:00:00Z'));
  answer = () => null;
  assert.deepEqual(await get("SELECT calls, clicks, directions FROM gbp_metrics WHERE client_id = ?1 AND month = '2026-10'", cid), { calls: 31, clicks: 52, directions: 18 });
  const app = await import('../src/app.js');
  const m = await app.monthFor(env, { client_id: cid, role: 'owner', regulated: 0 }, '2026-10', Date.parse('2026-11-05T12:00:00Z'));
  assert.deepEqual(m.a.google, { calls: 31, clicks: 52, directions: 18 });
  const { renderMonthPage } = await import('../src/monthpage.js');
  assert.match(renderMonthPage({ business: 'Pine HVAC', label: m.label, a: m.a, stats: m.stats }), /From your Google profile/);
  // Pure: numbers already in the report are left as they are.
  assert.equal(gbp.withGoogle({ a: { google: { calls: 3, clicks: 0, directions: 0 } } }, { calls: 9 }), null);
  assert.equal(gbp.withGoogle({ stats: {} }, { calls: 9 }), null, 'an HQ record with no analytics is not touched');
});

// ---------- 8 ----------
test('8. quote amounts typed as ranges or short forms count once, at their first number', async () => {
  const I = await import('../src/insights.js');
  const raw = { calls: [], lost: [], callbacks: [], bookings: [], leads: 0, jobs: { n: 0, asked: 0 }, checkins: [], fill: [], handoffs: [], texts: [], reviews: [], won: [], gbp: null, rivals: [], cid: 'x',
    followups: [{ kind: 'quote', status: 'done', amount: '$1,500-2,000' }, { kind: 'quote', status: 'done', amount: '$2.5k' }, { kind: 'quote', status: 'done', amount: 'call me' }] };
  assert.equal(I.analyze(raw, {}).work.followups.quoteAmount, 4000);
  for (const [typed, want] of [['$1,500-2,000', 1500], ['$2.5k', 2500], ['1500 to 2000', 1500], ['about $900', 900], ['$1,250.60', 1251], ['2K', 2000], ['TBD', 0], ['', 0], [null, 0], ['4785550101', 0]])
    assert.equal(I.money(typed), want, String(typed));
});

// ---------- 9 ----------
test('9. a calendar that can’t be read is not the same as no calendar', async () => {
  const gcal = await import('../src/gcal.js');
  await gcal.ensureGcal(env);
  await run("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES ('birch-cal', 'r-birch', 'America/New_York', '2026-10-01')");
  const from = Date.parse('2026-11-04T12:00:00Z'), to = from + 7 * 864e5;
  assert.equal(await gcal.busyTimes(env, 'birch-none', from, to), null, 'no calendar connected');
  answer = url => url.startsWith('https://www.googleapis.com/calendar/v3/') ? json({ error: { message: 'backend error' } }, 503) : null;
  await assert.rejects(gcal.busyTimes(env, 'birch-cal', from, to), /Google Calendar answered 503/);
  answer = url => url.startsWith('https://oauth2.googleapis.com/token') ? json({ error: 'internal_failure' }, 500) : null;
  await assert.rejects(gcal.busyTimes(env, 'birch-cal', from, to), /refused/);
  answer = url => url.startsWith('https://www.googleapis.com/calendar/v3/') ? json({ timeZone: 'America/Chicago', items: [{ start: { dateTime: '2026-11-05T15:00:00Z' }, end: { dateTime: '2026-11-05T16:00:00Z' } }] }) : null;
  const ok = await gcal.busyTimes(env, 'birch-cal', from, to);
  assert.deepEqual(ok, { tz: 'America/Chicago', busy: [[Date.parse('2026-11-05T15:00:00Z'), Date.parse('2026-11-05T16:00:00Z')]] });
  answer = () => null;
});

// ---------- 10 ----------
test('10. Fill my week tries each client once a day, so an eleventh client gets its turn', async () => {
  const reads = {};
  answer = (url, init) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) { const rt = new URLSearchParams(init.body).get('refresh_token'); if (/^rt-fw/.test(rt)) reads[rt] = (reads[rt] || 0) + 1; return json({ access_token: 'tok', expires_in: 3600 }); }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) return json({ timeZone: 'America/New_York', items: [] });
  };
  const fw = await import('../src/fillweek.js');
  await fw.ensureFill(env);
  for (let i = 1; i <= 11; i++) {
    const cid = 'fw-' + String(i).padStart(2, '0');
    await client(cid, 'Biz ' + i, { tier: 'Pro' });
    await run("INSERT INTO fillweek (client_id, on_, agreed_at) VALUES (?1, 1, '2026-10-01')", cid);
    await run("INSERT INTO sms_brands (client_id, messaging_sid, status) VALUES (?1, ?2, 'approved')", cid, 'MG' + 'a'.repeat(32));
    await run("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES (?1, ?2, 'America/New_York', '2026-10-01')", cid, 'rt-' + cid);
  }
  // Only the eleventh has a past customer who is due and agreed to hear from them; the first ten never have anyone.
  await run("INSERT INTO biz_customers (client_id, ckey, name, phone10, agreed, optout) VALUES ('fw-11', '4785550111', 'Sam', '4785550111', 1, 0)");
  await run("INSERT INTO biz_jobs (client_id, name, phone, title, stage, source, source_id, created, updated) VALUES ('fw-11', 'Sam', '4785550111', 'AC tune-up', 'done', 'manual', 'x', '2026-01-10T00:00:00Z', '2026-01-10T00:00:00Z')");
  // Every ten minutes from 10:00 to 10:50 Eastern on a Wednesday.
  for (let k = 0; k < 6; k++) await fw.fillCron(env, Date.parse('2026-11-04T15:00:00Z') + k * 600e3);
  answer = () => null;
  assert.equal(Object.keys(reads).length, 11, JSON.stringify(reads));
  assert.ok(Object.values(reads).every(n => n === 1), 'one calendar read per client, not one every ten minutes: ' + JSON.stringify(reads));
  assert.deepEqual((await all("SELECT client_id FROM fillweek_runs WHERE client_id LIKE 'fw-%'")).map(r => r.client_id), ['fw-11']);
  assert.equal((await all("SELECT client_id FROM fillweek_tries WHERE client_id LIKE 'fw-%'")).length, 11);
  assert.match((await get("SELECT result FROM fillweek_tries WHERE client_id = 'fw-01'")).result, /Nobody is due/);
});

// ---------- 11 ----------
test('11. a tech sees no job dollars on the year page or in the app’s numbers', async () => {
  await client('ash-tech', 'Ash Heating');
  const iso = new Date().toISOString();
  await run("INSERT INTO biz_jobs (client_id, name, title, stage, amount, source, source_id, created, updated) VALUES ('ash-tech', 'Lee', 'Furnace', 'paid', 4820000, 'manual', 'a1', ?1, ?1)", iso);
  const T = await import('../src/trends.js');
  assert.equal((await T.trendsFor(env, { client_id: 'ash-tech' }, Date.now())).since.won, 48200);
  const tech = await T.trendsFor(env, { client_id: 'ash-tech', role: 'tech' }, Date.now());
  assert.equal(tech.since.won, 0);
  assert.ok(tech.months.every(m => m.won === 0));
  const { renderYearPage } = await import('../src/yearpage.js');
  assert.ok(!/Jobs booked, finished or paid/.test(renderYearPage({ business: 'X', t: { months: [{ month: '2026-10', short: 'Oct', calls: 1, after: 0, leads: 0, requests: 0, reviews: 0, replied: 0, won: 0 }], since: { calls: 1, won: 48200, after: 0, months: 1 }, lines: [], avgJob: 0, noMoney: true } })));
  assert.ok(!renderYearPage({ business: 'Ash Heating', t: tech }).includes('$'));
});

// ---------- 12 ----------
test('12. the HQ list of profiles we could not match survives a long list', async () => {
  for (let i = 1; i <= 25; i++) await client('nm-' + i, 'Nomatch Business Number ' + i + ' With A Long Enough Name To Matter');
  await run("DELETE FROM gbp_runs WHERE k = 'map'");
  await gbp.mapLocations(env);
  const note = (await get("SELECT note FROM gbp_runs WHERE k = 'map'")).note;
  const parsed = JSON.parse(note);
  assert.ok(parsed.unmatched.length >= 25 && parsed.unmatched.length <= 40);
  const board = await gbp.gbpBoard(env);
  assert.equal(board.filter(x => /^gbpmap:Nomatch Business Number/.test(x.key)).length, 25);
  // Capped by count: always whole JSON, however many and however long.
  const big = JSON.parse(gbp.mapNote({ mapped: 1, unmatched: Array.from({ length: 100 }, (_, i) => 'N' + i + 'x'.repeat(300)), shared: [] }));
  assert.equal(big.unmatched.length, 40); assert.equal(big.moreUnmatched, 60); assert.equal(big.unmatched[0].length, 80);
});

// ---------- 13 ----------
test('13. the public sample report works out the network numbers at most once a day, not on every visit', async () => {
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  const A = await import('../src/answerrate.js');
  let perClient = 0;
  const prepare = DB.prepare;
  DB.prepare = sql => { if (/^SELECT at, outcome FROM app_calls/.test(sql)) perClient++; return prepare(sql); };
  try {
    A.forgetNetwork();
    assert.equal((await site.call('/sample-report')).status, 200);
    const first = perClient;
    assert.ok(first > 10, 'the first visit works it out, one look per business: ' + first);
    assert.equal((await site.call('/sample-report')).status, 200);
    A.forgetNetwork();   // a fresh worker reads what was kept, it doesn't work it out again
    assert.equal((await site.call('/sample-report')).status, 200);
    assert.equal(perClient, first);
    await run("UPDATE answer_network SET at = ?1 WHERE k = 'month'", new Date(Date.now() - 2 * 864e5).toISOString());
    A.forgetNetwork();
    await site.call('/sample-report');
    assert.equal(perClient, first * 2, 'a day later it is worked out once more');
  } finally { DB.prepare = prepare; }
});
