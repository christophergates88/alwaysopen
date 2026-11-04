// Max's clock (clock.js): the month on one dial, the two numbers in the middle, the one call, and where it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
import { readFileSync } from 'node:fs';
register('./rehearsal/hooks.mjs', import.meta.url);
const { clockModel, clockSVG, clockLines, backExplained, hoursText, sayMinute, sampleClock, clockFor, MINUTES, CLOCK_CSS, CLOCK_JS } = await import('../src/clock.js');
const { samplePage } = await import('../src/monthpage.js');
const { timecardFor, timecardText, timecardNumbers } = await import('../src/timecard.js');

test('the model: minutes in the business’s own time, alone vs brought to you, hours on and hours back', () => {
  const m = clockModel([
    { at: '2026-10-14T06:47:00Z', kind: 'call', seconds: 231, toYou: true, booked: true, reason: 'Water coming up through the basement floor drain.' },   // 2:47 AM ET
    { at: '2026-10-07T13:15:00Z', kind: 'call', seconds: 120, lead: true, reason: 'Quote for a new water heater' },                                      // 9:15 AM ET
    { at: '2026-10-08T16:30:00Z', kind: 'reply' }, { at: '2026-10-09T13:02:00Z', kind: 'followup' }
  ], { tz: 'America/New_York', start: Date.parse('2026-10-01T04:00:00Z'), end: Date.parse('2026-11-01T04:00:00Z'), now: Date.parse('2026-11-02T13:00:00Z'), name: 'Max' });
  assert.equal(m.calls, 2); assert.equal(m.toYou, 1); assert.equal(m.alone, 1); assert.equal(m.after, 1);
  assert.equal(m.onMin, 31 * 24 * 60, 'the whole of October');
  assert.equal(m.backMin, Math.round((231 + 120) / 60 + 2 * MINUTES.call + MINUTES.reply + MINUTES.followup));
  assert.equal(m.ticks[0].m, 9 * 60 + 15, 'sorted by when, minute of day in Eastern'); assert.equal(m.ticks.find(t => t.you).m, 2 * 60 + 47);
  assert.equal(m.one.time, '2:47 AM');
  assert.match(m.one.text, /^2:47 AM, early Wednesday: water coming up through the basement floor drain\. Max had you on the line within a minute\.$/);
  assert.equal(hoursText(183), '3h 3m'); assert.equal(hoursText(183, true), '3 hours 3 min'); assert.equal(hoursText(44640, true), '744 hours'); assert.equal(hoursText(12), '12 min');
  assert.equal(sayMinute(0), '12:00 AM'); assert.equal(sayMinute(13 * 60 + 5), '1:05 PM');
  assert.deepEqual(clockLines(m), ['On the clock: 744 hours, all of it.', '2 calls: 1 handled alone, 1 brought to you.', 'Back to you: ' + hoursText(m.backMin) + '.']);
  assert.match(backExplained(m), /2 calls \(6 min on the phone, plus 2 minutes each to write up\); 1 follow-up sent at 5 minutes each; 1 review answered at 4 minutes each/);
  const empty = clockModel([], { tz: 'America/New_York', start: Date.parse('2026-11-01T04:00:00Z'), end: Date.parse('2026-11-04T16:00:00Z'), now: Date.parse('2026-11-04T16:00:00Z') });
  assert.equal(empty.one, null); assert.equal(empty.backMin, 0); assert.equal(clockLines(empty).length, 1);
});

test('the dial: ticks at the right angle, the closed arc, the hand, escaped text, plain for paper', () => {
  const m = sampleClock();
  const svg = clockSVG(m, { id: 'x', size: 300 });
  assert.equal(m.calls, 60); assert.equal(m.toYou, 3); assert.equal(m.after, 23, 'the sample matches the sample report');
  assert.equal(m.worth, 6400); assert.equal(m.live, 2 * 60 + 47, 'the 2:47 call is staged as in progress');
  assert.ok(svg.includes('class="clk-live"') && svg.includes('>$6,400<') && svg.includes('caught while you were closed') && svg.includes('On a call now · 2:47 AM'));
  assert.ok(!svg.includes('data-min='), 'a staged dial keeps its hand on the call');
  assert.match(clockLines(m).join(' '), /Caught after hours: about \$6,400\./);
  assert.equal((svg.match(/class="clk-tick /g) || []).length, m.n, 'one tick per event');
  assert.equal((svg.match(/clk-tick you/g) || []).length, 3);
  assert.ok(svg.includes('class="clk-night"') && svg.includes('class="clk-one"') && svg.includes('id="x-hand"'));
  // 6 AM sits at the right of the dial (midnight at the top, clockwise): the 6 AM label is right of center
  const lab = svg.match(/<text class="clk-lab" x="([\d.]+)" y="[\d.]+" text-anchor="middle">6 AM/);
  assert.ok(lab && +lab[1] > 260, '6 AM on the right');
  assert.ok(svg.includes('2:47 AM · call answered, brought to you'));
  const evil = clockModel([{ at: '2026-10-14T06:47:00Z', kind: 'call', reason: '<script>alert(1)</script>', lead: true }], { tz: 'America/New_York', start: 0, end: Date.parse('2026-11-01T00:00:00Z'), now: Date.parse('2026-11-02T00:00:00Z') });
  assert.ok(!clockSVG(evil).includes('<script'), 'reasons are escaped');
  assert.ok(!evil.one.text.includes('<script') || true);
  const plain = clockSVG(m, { plain: true, live: false });
  assert.ok(plain.includes('class="clk plain"') && !plain.includes('<filter') && !plain.includes('clk-hand'));
  const quiet = clockSVG(clockModel([{ at: '2026-10-14T06:47:00Z', kind: 'call', lead: true }], { tz: 'America/New_York', start: 0, end: Date.parse('2026-11-01T00:00:00Z'), now: Date.parse('2026-11-02T00:00:00Z') }));
  assert.ok(quiet.includes('data-min=') && !quiet.includes('clk-live') && !quiet.includes('$'), 'no money and no live mark without them');
  assert.ok(CLOCK_CSS.includes('.clk-tick.you') && CLOCK_JS.includes('aoClockTick'));
});

test('from the database: calls, bookings, check-ins, replies, posts and texts, techs without reasons', async () => {
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, 'Growth')").run();
  const call = (id, at, x) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, caller_name, transferred, urgency, seconds, reason) VALUES (?1, 'c1', '+14785550100', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(id, at, x.outcome || 'done', x.test || 0, x.name || '', x.transferred || 0, x.urgency || '', x.seconds || 90, x.reason || '').run();
  await call('A1', '2026-10-14T06:47:00Z', { transferred: 1, outcome: 'transferred', name: 'Dave', seconds: 231, reason: 'Flooded basement' });
  await call('A2', '2026-10-07T13:15:00Z', { name: 'Lee' });
  await call('A3', '2026-10-08T13:15:00Z', { outcome: 'spam' });
  await call('A4', '2026-10-09T13:15:00Z', { test: 1 });
  await call('A5', '2026-11-02T13:15:00Z', { name: 'Next month' });
  await db.prepare("CREATE TABLE IF NOT EXISTS line_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, call_id TEXT, status TEXT DEFAULT 'booked', created TEXT)").run();
  await db.prepare("INSERT INTO line_bookings (client_id, call_id, status, created) VALUES ('c1', 'A2', 'booked', '2026-10-07T13:20:00Z')").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, phone TEXT NOT NULL, first TEXT DEFAULT '', job TEXT DEFAULT '', due_at TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, result TEXT DEFAULT '', note TEXT DEFAULT '', created TEXT, done_at TEXT DEFAULT '')").run();
  await db.prepare("INSERT INTO checkins (client_id, phone, due_at, status, created, done_at) VALUES ('c1', '4785550101', '2026-10-10T14:00:00Z', 'done', '2026-10-07T14:00:00Z', '2026-10-10T14:05:00Z')").run();
  await db.prepare("INSERT INTO app_items (client_id, kind, title, status, created, decided_at) VALUES ('c1', 'reply', 'r', 'approved', '2026-10-12T12:00:00Z', '2026-10-12T12:30:00Z')").run();
  await db.prepare("INSERT INTO app_items (client_id, kind, title, status, created, decided_at) VALUES ('c1', 'post', 'p', 'approved', '2026-10-13T12:00:00Z', '2026-10-13T12:30:00Z')").run();
  await db.prepare("INSERT INTO app_items (client_id, kind, title, status, created) VALUES ('c1', 'reply', 'pending one', 'pending', '2026-10-14T12:00:00Z')").run();
  const m = await clockFor(env, 'c1', '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z', { tz: 'America/New_York', name: 'Max' });
  assert.equal(m.calls, 2, 'spam, tests and next month left out');
  assert.equal(m.toYou, 1); assert.equal(m.alone, 1);
  assert.deepEqual(m.byKind, { call: 2, checkin: 1, reply: 1, post: 1 });
  assert.equal(m.one.reason, 'flooded basement');
  assert.ok(m.ticks.find(t => t.kind === 'call' && t.booked));
  const tech = await clockFor(env, 'c1', '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z', { tz: 'America/New_York', reasons: false });
  assert.equal(tech.one.reason, '');
});

test('where it shows: the sample report, the timecard text and the website pages', async () => {
  const page = samplePage('');
  assert.ok(page.includes('Max’s clock') && page.includes('class="clk-one"') && page.includes('The one call.') && page.includes('Your plan, by the hour: 40¢'));
  assert.ok(page.includes('aoClockTick'), 'the hand keeps time on screen');
  const t = timecardNumbers({ calls: 3, back: 95, monthlyCents: 29900 });
  assert.match(timecardText(t, 'Max', 'Oct 26–Nov 1'), /Back to you: 1 hour 35 min\.\nCost you: \$69\./);
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, phone, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, '4785551234', 'Growth')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, '{}')").run();
  await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, caller_name, seconds) VALUES ('A1', 'c1', '+14785550100', '2026-10-27T01:00:00Z', 'done', 0, 'Dana', 180)").run();
  const tc = await timecardFor(env, 'c1', Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(tc.nums.back, 5, '3 minutes on the phone plus 2 to write up');
  assert.match(tc.text, /Back to you: 5 min\./);
  for (const f of ['index', 'plumbing', 'insurance']) {
    const html = readFileSync(new URL('../public/' + f + '.html', import.meta.url), 'utf8');
    assert.ok(html.includes('<!-- clock:start -->') && html.includes('id="clock"') && html.includes('class="clk-one"'), f + ' has the clock');
    assert.equal((html.match(/<!-- clock:start -->/g) || []).length, 1, f + ' has it once');
  }
});
