// Max's job description (duties.js), the weekly timecard (timecard.js) and "tell Max" notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
import { DUTIES, dutiesOf, cleanDuties, dutyLines, dutyChanges, addNote, dropLastNote, tellMax } from '../src/duties.js';
import { weekCost, planCents, timecardNumbers, timecardText, lastWeek, timecardFor, timecardCron, review } from '../src/timecard.js';
register('./rehearsal/hooks.mjs', import.meta.url);

test('duties: defaults, cleaning, and rules for every duty on or off', () => {
  const d = dutiesOf({});
  for (const k of DUTIES) assert.equal(d[k.key], k.def, k.key);
  const c = cleanDuties({ prices: true, priceList: 'Service call $89.\n<b>', allDay: 'yes', bogus: true });
  assert.equal(c.prices, true);
  assert.equal(c.allDay, false, 'only real booleans');
  assert.equal('bogus' in c, false);
  assert.equal(c.priceList, 'Service call $89. b');
  const off = dutyLines({}).join(' ');
  assert.match(off, /Never give a price/);
  assert.match(off, /when they last had this kind of work done/);
  const on = dutyLines({ prices: true, priceList: 'Service call $89', allDay: true, areaOnly: true, pastService: false }).join(' ');
  assert.match(on, /Service call \$89/);
  assert.match(on, /during business hours too/);
  assert.match(on, /outside the service area and thank them/);
  assert.doesNotMatch(on, /last had this kind of work/);
  // prices switched on with no list: still never a price
  assert.match(dutyLines({ prices: true }).join(' '), /Never give a price/);
  // a voice_lines row works too
  assert.match(dutyLines({ owner_set: JSON.stringify({ duties: { payments: true, payText: 'Cards and cash.' } }) }).join(' '), /Cards and cash/);
  assert.deepEqual(dutyChanges({}, { allDay: true }), ['Max now: answer during business hours too']);
});

test('notes for Max: dated, oldest dated note dropped first, owner text kept, undo', () => {
  const at = Date.parse('2026-11-04T15:00:00Z');
  const a = addNote('We do repairs.', 'closed friday', at);
  assert.equal(a, 'We do repairs. (Nov 4) Closed friday.');
  assert.equal(dropLastNote(a), 'We do repairs.');
  assert.equal(dropLastNote('We do repairs.'), null);
  let s = 'Owner text stays.';
  for (let i = 0; i < 12; i++) s = addNote(s, 'note number ' + i + ' ' + 'x'.repeat(80), at + i * 864e5);
  assert.ok(s.length <= 800);
  assert.ok(s.startsWith('Owner text stays.'));
  assert.match(s, /Note number 11/);
  assert.doesNotMatch(s, /Note number 0 /);
});

test('tellMax writes into what Max tells callers, on every line', async () => {
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, '{}')").run();
  const r = await tellMax(env, 'c1', 'No jobs in Macon this week', 'Owner');
  assert.equal(r.ok, true);
  assert.match(r.text, /Max knows: No jobs in Macon this week/);
  const o = JSON.parse((await db.prepare("SELECT owner_set FROM voice_lines WHERE number = '+14785550100'").first()).owner_set);
  assert.match(o.owner, /\) No jobs in Macon this week\.$/);
  const u = await tellMax(env, 'c1', 'UNDO', 'Owner');
  assert.equal(u.undone, true);
  assert.equal(JSON.parse((await db.prepare("SELECT owner_set FROM voice_lines WHERE number = '+14785550100'").first()).owner_set).owner, '');
});

test('timecard math: 168 hours, plan cost per week, plain lines', () => {
  assert.equal(weekCost(29900), 69);   // $299 × 12 / 52
  assert.equal(weekCost(14900), 34);
  assert.equal(planCents('Growth', true), 29900 + 14900);
  assert.equal(planCents('', false), 0);
  const t = timecardNumbers({ calls: 41, booked: 9, kept: 6, due: 6, after: 10, leads: 8, avgJob: 400, winRate: 50, monthlyCents: 29900 });
  assert.equal(t.hours, 168);
  assert.equal(t.caught, 1600);   // 8 leads × $400 × 50%
  assert.equal(t.cost, 69);
  const text = timecardText(t, 'Max', 'Oct 26–Nov 1');
  assert.match(text, /On the clock: 168 hours/);
  assert.match(text, /Answered: 41 calls/);
  assert.match(text, /Call-backs kept: 6 of 6/);
  assert.match(text, /about \$1,600/);
  assert.match(text, /Cost you: \$69/);
  assert.doesNotMatch(text, /\bAI\b|employee/i);
  assert.match(timecardText(timecardNumbers({}), 'Max', 'x'), /Quiet week/);
});

test('last week is Monday to Sunday in the business’s own time', () => {
  const w = lastWeek('America/New_York', Date.parse('2026-11-02T14:00:00Z'));   // Monday 9 AM ET (after the clocks went back)
  assert.equal(w.week, '2026-10-26');
  assert.equal(w.label, 'Oct 26–Nov 1');
  assert.equal(w.from, '2026-10-26T04:00:00.000Z');
  assert.equal(w.to, '2026-11-02T05:00:00.000Z');
});

test('timecard from the database, sent once on Monday morning', async () => {
  const db = makeDB(); const env = { DB: db };
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, phone, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 1, '4785551234', 'Growth')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, '{}')").run();
  const call = (id, at, outcome, name) => db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test, caller_name) VALUES (?1, 'c1', '+14785550100', ?2, ?3, 0, ?4)").bind(id, at, outcome, name || '').run();
  await call('A1', '2026-10-27T01:00:00Z', 'done', 'Dana');    // Mon Oct 26, 9 PM ET: after hours, a lead
  await call('A2', '2026-10-28T15:00:00Z', 'done', 'Sam');     // Wed 11 AM ET: business hours
  await call('A3', '2026-10-29T15:00:00Z', 'spam', 'Robo');    // not counted
  await call('A4', '2026-11-02T15:00:00Z', 'done', 'Next');    // this week: not counted
  const mon = Date.parse('2026-11-02T14:00:00Z');
  const tc = await timecardFor(env, 'c1', mon);
  assert.equal(tc.nums.calls, 2);
  assert.equal(tc.nums.after, 1);
  assert.equal(tc.nums.leads, 1);
  assert.equal(tc.nums.cost, 69);
  const sent = [], pushed = [];
  const h = { send: async (cid, to, body) => { sent.push({ cid, to, body }); return { ok: true }; }, push: async (cid, n) => { pushed.push(n); } };
  const s1 = await timecardCron(env, mon, h);
  assert.equal(s1.sent, 1);
  assert.equal(sent[0].to, '4785551234');
  assert.match(sent[0].body, /Max’s timecard, Oct 26–Nov 1/);
  assert.equal(pushed.length, 1);
  await timecardCron(env, mon + 3600e3, h);
  assert.equal(sent.length, 1, 'once a week');
  const tue = await timecardCron(env, Date.parse('2026-11-03T14:00:00Z'), h);
  assert.equal(tue.looked, 0, 'only on Monday morning');
});

test('Max’s month, reviewed: what went well, what slipped, one change', () => {
  const a = { calls: { n: 14, after: 6, leads: 11, booked: 3, urgent: 2, transferred: 2, callbacks: { set: 3, kept: 2, missed: 1 } },
    lost: { n: 3, top: [{ r: 'price', label: 'said price', n: 2 }] }, work: { fill: { booked: 2 } } };
  const r = review(a, 'Max');
  assert.ok(r.good.some(x => /Answered 14 calls/.test(x)));
  assert.ok(r.good.some(x => /Booked 5 visits/.test(x)));
  assert.ok(r.missed.some(x => /8 leads left details/.test(x)));
  assert.ok(r.missed.some(x => /1 call-back went past/.test(x)));
  assert.match(r.change, /standard prices in Job description/);
  assert.equal(review({ calls: { n: 0 } }).any, false);
});
