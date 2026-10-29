// What Max caught: after-hours calls in the business's own time that became leads, × the owner's win rate × average
// job, with a range; no dollars without the owner's own average job; the report says it in the same words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
import { caughtFor, moneyState, figure, explain, reportLine, roundMoney, countsFor } from '../src/money.js';
import { buildMonth, monthOf } from '../src/report.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { ensureBookings } = await import('../src/availability.js');

async function seeded(tz) {
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1)").run();
  if (tz) await db.prepare("INSERT INTO gcal_tokens (client_id, refresh, tz) VALUES ('c1', 'x', ?1)").bind(tz).run();
  await ensureBookings(env);
  const call = (id, at, outcome, extra) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, caller_name, callback, reason) VALUES (?1, 'c1', '+14785550100', ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(id, at, outcome, (extra && extra.test) || 0, (extra && extra.name) || '', (extra && extra.callback) || '', (extra && extra.reason) || '').run();
  await call('A1', '2026-10-10T15:00:00Z', 'done', { name: 'Dana', reason: 'Leaking water heater' });     // Saturday 11 AM ET: after hours, a lead
  await call('A2', '2026-10-14T01:30:00Z', 'done', { callback: '+14785551111' });                        // Tuesday 9:30 PM ET: after hours, a lead
  await call('A3', '2026-10-14T23:30:00Z', 'transferred', { name: 'Mo' });                               // Wednesday 7:30 PM ET (4:30 PM PT): a lead in Georgia only
  await call('A4', '2026-10-15T02:00:00Z', 'hangup');                                                     // Wednesday 10 PM ET: answered, not a lead
  await call('A5', '2026-10-16T03:00:00Z', 'done');                                                       // Thursday 11 PM ET: booked a time, nothing else said
  await db.prepare("INSERT INTO line_bookings (client_id, start, end, status, call_id, created) VALUES ('c1', 1, 2, 'booked', 'A5', '2026-10-16T03:01:00Z')").run();
  await call('B1', '2026-10-14T15:00:00Z', 'done', { name: 'Sam' });                                     // Wednesday 11 AM ET: business hours
  await call('X1', '2026-10-11T15:00:00Z', 'failed');                                                     // never answered
  await call('X2', '2026-10-11T16:00:00Z', 'spam', { name: 'Robo' });
  await call('X3', '2026-10-11T17:00:00Z', 'done', { name: 'Chris', test: 1 });
  await call('X4', '2026-09-30T23:00:00Z', 'done', { name: 'Last month' });                              // September 30, 7 PM ET
  return env;
}
const mid = Date.parse('2026-10-20T16:00:00Z');

test('after hours in the business’s own time; failed, spam, test and business-hours calls left out; a booking counts once', async () => {
  const env = await seeded();
  const c = await countsFor(env, 'c1', mid);
  assert.deepEqual(c, { month: '2026-10', label: 'October 2026', after: 5, leads: 4, booked: 1 });
  const la = await seeded('America/Los_Angeles');
  const c2 = await countsFor(la, 'c1', mid);
  assert.equal(c2.after, 4, 'at 4:30 PM in California the Wednesday call is during business hours');
  assert.equal(c2.leads, 3);
});

test('no average job: counts only, never dollars, and the card says how to get dollars', async () => {
  const env = await seeded();
  const m = await caughtFor(env, 'c1', mid);
  assert.equal(m.mid, 0); assert.equal(m.low, 0); assert.equal(m.high, 0);
  assert.equal(m.explained, '5 after-hours calls, 4 became leads (1 booked a time). Tell us your average job in Settings and this becomes dollars.');
  assert.equal(reportLine(m), 'Max answered 5 calls after hours; 4 became leads.');
});

test('with the owner’s numbers: the figure, the range at ± 10 points, and the same words in the report', async () => {
  const env = await seeded();
  await env.DB.prepare("INSERT INTO app_settings (client_id, avg_job, win_rate) VALUES ('c1', 380, 30)").run();
  const m = await caughtFor(env, 'c1', mid);
  assert.deepEqual([m.low, m.mid, m.high], [300, 460, 610], '4 leads × $380 at 20%, 30% and 40%, rounded to $10');
  assert.equal(m.explained, '5 after-hours calls, 4 became leads (1 booked a time). At your 30% win rate and $380 average job, that is about $460 (between $300 and $610).');
  const st = await moneyState(env, 'c1', mid);
  assert.equal(st.thisMonth.mid, 460);
  assert.equal(st.lastMonth.month, '2026-09'); assert.equal(st.lastMonth.leads, 1); assert.equal(st.lastMonth.mid, 110);
  const month = monthOf(Date.parse('2026-11-02T14:00:00Z'));
  const d = buildMonth({ business: 'Sinclair Plumbing' }, month, { reviews: [], posts: [], posted: [], calls: 7, money: m }, null, Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(d.note, 'Max answered 5 calls after hours; 4 became leads, worth about $460 at your numbers. In all, Max answered 7 calls.');
  assert.equal(d.stats.caught, 460); assert.equal(d.stats.afterHours, 5);
});

test('the words for the edges', () => {
  assert.equal(explain(figure({ after: 0, leads: 0, booked: 0 }, 380, 30)), 'No after-hours calls yet this month. When Max answers one while you are closed, it counts here.');
  assert.equal(explain(figure({ after: 1, leads: 1, booked: 0 }, 0, 30)), '1 after-hours call, and it became a lead. Tell us your average job in Settings and this becomes dollars.');
  assert.equal(explain(figure({ after: 3, leads: 3, booked: 0 }, 1200, 50)), '3 after-hours calls, all became leads. At your 50% win rate and $1,200 average job, that is about $1,800 (between $1,450 and $2,150).');
  assert.equal(explain(figure({ after: 2, leads: 0, booked: 0 }, 500, 30)), '2 after-hours calls, 0 became leads.');
  assert.equal(reportLine(figure({ after: 0, leads: 0, booked: 0 }, 500, 30)), '');
  assert.equal(roundMoney(342), 340); assert.equal(roundMoney(1449), 1450); assert.equal(roundMoney(23460), 23500);
  const low = figure({ after: 2, leads: 2, booked: 0 }, 100, 5);
  assert.equal(low.low, 0, 'the range never goes below zero');
});
