// Your year: twelve months from our own records, "since you joined" totals, first full month against the latest, the
// assistant check as a rank strip, and the page drawn without gaps. Never dollars without the owner's average job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { ensureBookings } = await import('../src/availability.js');
const T = await import('../src/trends.js');
const { renderYearPage, barChart } = await import('../src/yearpage.js');
const { renderMonthPage } = await import('../src/monthpage.js');

const NOW = Date.parse('2026-10-20T16:00:00Z');

async function seeded(opts) {
  opts = opts || {};
  const db = makeDB(); const env = { DB: db };
  await ensureBookings(env);
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, 'Growth')").run();
  await db.prepare("INSERT INTO billing (client_id, plan, status, business, created) VALUES ('c1', 'Growth', 'active', 'Sinclair Plumbing', '2026-07-12T14:00:00Z')").run();
  if (opts.avg) await db.prepare("INSERT INTO app_settings (client_id, avg_job, win_rate) VALUES ('c1', ?1, 40)").bind(opts.avg).run();
  let n = 0;
  const call = (at, outcome, extra) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, caller_name, callback, reason, seconds) VALUES (?1, 'c1', '+14785550100', ?2, ?3, ?4, ?5, '', '', 120)")
    .bind('K' + (++n), at, outcome, (extra && extra.test) || 0, (extra && extra.name) || '').run();
  // July (joined mid-month): 2 calls. August: 4 calls, 2 after hours, 1 lead. September: 6 calls, 4 after hours, 3 leads.
  await call('2026-07-20T15:00:00Z', 'done', { name: 'A' });
  await call('2026-07-25T23:30:00Z', 'done');
  await call('2026-08-04T15:00:00Z', 'done');
  await call('2026-08-05T15:00:00Z', 'done');
  await call('2026-08-08T15:00:00Z', 'done', { name: 'Sat lead' });       // Saturday 11 AM ET: after hours, a lead
  await call('2026-08-12T01:00:00Z', 'hangup');                           // Tuesday 9 PM ET: after hours, not a lead
  for (const d of ['02', '03']) await call('2026-09-' + d + 'T14:00:00Z', 'done');
  for (const d of ['05', '06', '13']) await call('2026-09-' + d + 'T15:00:00Z', 'done', { name: 'Weekend' });   // Saturdays and a Sunday
  await call('2026-09-16T02:00:00Z', 'done');                             // Tuesday 10 PM ET, booked a time
  await db.prepare("INSERT INTO line_bookings (client_id, start, end, status, call_id, created) VALUES ('c1', 1, 2, 'booked', ?1, '2026-09-16T02:01:00Z')").bind('K' + n).run();
  await call('2026-10-04T15:00:00Z', 'done', { name: 'Oct' });            // this month so far
  await call('2026-10-05T15:00:00Z', 'spam', { name: 'Robo' });           // never counts
  await call('2026-10-06T15:00:00Z', 'done', { name: 'Me', test: 1 });    // never counts
  // Reviews: August, replied in 30 hours; September, two replied in 3 and 5 hours.
  const item = (id, created, decided, status) => db.prepare("INSERT INTO app_items (id, client_id, kind, status, created, decided_at, decided_by) VALUES (?1, 'c1', 'reply', ?2, ?3, ?4, 'Dana')").bind(id, status, created, decided).run();
  await item('r1', '2026-08-10T12:00:00Z', '2026-08-11T18:00:00Z', 'approved');
  await item('r2', '2026-09-10T12:00:00Z', '2026-09-10T15:00:00Z', 'approved');
  await item('r3', '2026-09-20T12:00:00Z', '2026-09-20T17:00:00Z', 'closed');
  await db.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('c1', '4785551111', '2026-09-03T02:00:00Z', 'textback', 'delivered')").run();
  await db.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('c1', '4785551112', '2026-09-03T03:00:00Z', 'textback', 'skipped')").run();
  await db.prepare("INSERT INTO ai_checks (client_id, month, at, data) VALUES ('c1', '2026-08', '2026-08-03', ?1)").bind(JSON.stringify({ mentioned: false })).run();
  await db.prepare("INSERT INTO ai_checks (client_id, month, at, data) VALUES ('c1', '2026-09', '2026-09-03', ?1)").bind(JSON.stringify({ mentioned: true, rank: 2 })).run();
  await db.prepare("INSERT INTO ai_checks (client_id, month, at, data) VALUES ('c1', '2026-10', '2026-10-03', ?1)").bind(JSON.stringify({ error: 'no town on file' })).run();
  return env;
}

test('twelve months, oldest first, ending with this month; months before joining are marked', async () => {
  const env = await seeded();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  assert.equal(t.months.length, 12);
  assert.equal(t.months[0].month, '2025-11');
  assert.equal(t.months[11].month, '2026-10');
  assert.ok(t.months[11].partial);
  assert.ok(t.months.find(m => m.month === '2026-06').before);
  assert.ok(!t.months.find(m => m.month === '2026-07').before);
  assert.ok(t.months.find(m => m.month === '2026-07').joinedHere);
});

test('calls, after hours, leads and bookings per month in the business’s own time; spam and tests left out', async () => {
  const env = await seeded();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  const m = k => t.months.find(x => x.month === k);
  assert.deepEqual([m('2026-08').calls, m('2026-08').after, m('2026-08').leads], [4, 2, 1]);
  assert.deepEqual([m('2026-09').calls, m('2026-09').after, m('2026-09').leads, m('2026-09').booked], [6, 4, 4, 1]);
  assert.equal(m('2026-10').calls, 1);
  assert.equal(m('2026-09').textbacks, 1, 'a skipped text is not a text sent');
  assert.equal(m('2026-09').replyHrs, 4);
  assert.equal(m('2026-08').replyHrs, 30);
});

test('the assistant check: named 2nd, not named, and a failed check left blank', async () => {
  const env = await seeded();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  const m = k => t.months.find(x => x.month === k);
  assert.equal(m('2026-08').aiRank, 0);
  assert.equal(m('2026-09').aiRank, 2);
  assert.equal(m('2026-10').aiRank, null);
  assert.ok(t.lines.some(l => /names you 2nd/.test(l)), t.lines.join(' | '));
});

test('since you joined: totals, and the first full month (not the half month they joined in) against the latest', async () => {
  const env = await seeded();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  const s = t.since;
  assert.equal(s.calls, 13);
  assert.equal(s.joinedLabel, 'July 2026');
  assert.equal(s.first.month, '2026-08');
  assert.equal(s.latest.month, '2026-09');
  assert.equal(s.worth, 0, 'no average job set: never a dollar figure');
  assert.ok(t.lines.some(l => /voicemail/.test(l)));
  assert.ok(!t.lines.some(l => /\$/.test(l)));
});

test('with an average job the after-hours leads become dollars, and a tech never sees them', async () => {
  const env = await seeded({ avg: 500 });
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  assert.ok(t.since.worth > 0);
  assert.equal(t.months.find(x => x.month === '2026-09').worth, 800, '4 after-hours leads × $500 × 40%');
  const tech = await T.trendsFor(env, { client_id: 'c1', role: 'tech' }, NOW);
  assert.equal(tech.since.worth, 0);
  assert.ok(!renderYearPage({ business: 'Sinclair Plumbing', t: tech }).includes('$'));
});

test('a business with us longer than the twelve months shown keeps every call in its totals', async () => {
  const env = await seeded();
  await env.DB.prepare("UPDATE billing SET created = '2025-06-01T12:00:00Z' WHERE client_id = 'c1'").run();
  await env.DB.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES ('OLD', 'c1', '+1', '2025-08-10T15:00:00Z', 'done', 0)").run();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  assert.equal(t.since.calls, 14);
  assert.equal(t.since.joinedLabel, 'June 2025');
});

test('the year page draws every section with real numbers, nothing undefined, and the month page links to it', async () => {
  const env = await seeded({ avg: 500 });
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  const html = renderYearPage({ business: 'Sinclair Plumbing', back: '/app/x', month: '/app/x/month/now', t });
  for (const bad of ['undefined', 'NaN', 'null']) assert.ok(!html.includes('>' + bad), bad);
  assert.ok(html.includes('Calls Max answered, month by month'));
  assert.ok(html.includes('What AI assistants say'));
  assert.ok(html.includes('Your first month and your latest'));
  assert.ok(html.includes('August') && html.includes('September'));
  const empty = renderYearPage({ business: 'New Co', t: { months: [], since: {}, lines: [] } });
  assert.ok(empty.includes('Your year starts here'));
  const { analyze } = await import('../src/insights.js');
  const mp = renderMonthPage({ business: 'Sinclair Plumbing', label: 'October 2026', a: analyze({ calls: [] }, {}), year: '/app/x/year', since: T.sinceLine(t.since) });
  assert.ok(mp.includes('href="/app/x/year"'));
  assert.ok(mp.includes('Since you joined in July 2026'));
});

test('bars are drawn to one scale, and empty months before joining get a stub, not a bar', () => {
  const months = [{ short: 'Jan', before: true, calls: 0 }, { short: 'Feb', calls: 5 }, { short: 'Mar', calls: 10 }];
  const svg = barChart(months, [{ key: 'calls', cls: 'yr-a' }]);
  const heights = [...svg.matchAll(/class="yr-a"[^>]*height="([\d.]+)"/g)].map(m => +m[1]);
  assert.equal(heights.length, 2);
  assert.ok(Math.abs(heights[1] / heights[0] - 2) < 0.01);
  assert.ok(svg.includes('yr-none'));
});

test('the sample report shows real network numbers only once there are enough of them', async () => {
  const { networkLine, NETWORK_MIN } = await import('../src/answerrate.js');
  const { samplePage } = await import('../src/monthpage.js');
  assert.equal(networkLine({ month: '2026-09', after: NETWORK_MIN - 1, answered: 40, businesses: 9 }), '');
  assert.equal(networkLine({ month: '2026-09', after: 400, answered: 390, businesses: 2 }), '', 'two businesses is not a network');
  const line = networkLine({ month: '2026-09', after: 412, answered: 400, businesses: 14 });
  assert.equal(line, 'Real numbers, not the sample: in September, Max answered 97% of 412 after-hours calls across 14 Always Open businesses.');
  assert.ok(samplePage(line).includes('class="proof"'));
  assert.ok(!samplePage('').includes('class="proof"'));
});

test('a business with us over a year compares its real first full month, not the oldest month on the chart', async () => {
  const env = await seeded();
  await env.DB.prepare("UPDATE billing SET created = '2025-06-10T12:00:00Z' WHERE client_id = 'c1'").run();
  for (const [id, at] of [['J1', '2025-07-08T15:00:00Z'], ['J2', '2025-07-09T15:00:00Z'], ['J3', '2025-08-09T15:00:00Z']]) await env.DB.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, 'c1', '+1', ?2, 'done', 0)").bind(id, at).run();
  const t = await T.trendsFor(env, { client_id: 'c1' }, NOW);
  assert.equal(t.since.first.month, '2025-07');
  assert.equal(t.since.first.calls, 2);
});
