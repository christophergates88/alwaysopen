// Results in the app: the last 30 days by day, by time of day, and from call to job, against the 30 days before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { shape } = await import('../src/pulse.js');
const { analyze } = await import('../src/insights.js');
const { default: worker } = await import('../src/index.js');
const sha = s => createHash('sha256').update(s).digest('hex');

test('shape: 30 days, the right day and time-of-day cells, and changes against the month before', () => {
  const tz = 'America/New_York', now = Date.parse('2026-10-31T16:00:00Z');
  const calls = [
    { id: 'a', at: '2026-10-31T14:00:00Z', outcome: 'done', caller_name: 'A' },          // Sat 10 AM: after hours (weekend)
    { id: 'b', at: '2026-10-29T13:30:00Z', outcome: 'done', caller_name: 'B' },          // Thu 9:30 AM
    { id: 'c', at: '2026-10-29T23:30:00Z', outcome: 'done', caller_name: '' },           // Thu 7:30 PM: after hours
  ];
  const cur = analyze({ calls, bookings: [{ call_id: 'b' }], leads: 2 }, { tz });
  const prev = analyze({ calls: [calls[0]], leads: 0 }, { tz });
  const P = shape(cur, prev, calls, new Set(['b']), tz, now);
  assert.equal(P.days.length, 30);
  assert.equal(P.days[29].d, '2026-10-31');
  assert.equal(P.days[29].calls, 1); assert.equal(P.days[29].after, 1);
  const thu = P.days.find(d => d.d === '2026-10-29');
  assert.equal(thu.calls, 2); assert.equal(thu.after, 1); assert.equal(thu.booked, 1);
  assert.equal(P.heat[3][1], 1, 'Thursday, 9 AM to noon');
  assert.equal(P.heat[3][4], 1, 'Thursday, 6 to 9 PM');
  assert.equal(P.heat[5][1], 1, 'Saturday, 9 AM to noon');
  assert.equal(P.kpi.calls.n, 3); assert.equal(P.kpi.calls.ch, 2);
  assert.equal(P.kpi.after.n, 2); assert.equal(P.kpi.after.pct, 67);
  assert.equal(P.funnel[0][1], 5, 'calls and requests');
  assert.equal(P.funnel[2][1], 1, 'booked');
});

test('the app serves Results to owners and not to techs', async () => {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const CODE = 'P'.repeat(30);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active, feats) VALUES ('p1', ?1, 'p1-ref', 'Pulse Co', 'Growth', 'Pat', 1, 'calls')").bind(sha(CODE)).run();
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller_name, outcome, test) VALUES ('CA1', 'p1', '+14785550111', ?1, 'Joe', 'done', 0)").bind(new Date(Date.now() - 3600e3).toISOString()).run();
  const site = H.makeClient(worker, env);
  const r = await site.call('/app/' + CODE + '/api/pulse');
  assert.equal(r.status, 200, r.text);
  const P = r.json().pulse;
  assert.equal(P.kpi.calls.n, 1);
  assert.equal(P.days.reduce((s, d) => s + d.calls, 0), 1);
});
