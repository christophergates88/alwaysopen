import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates, offerText, whenText, shortSlot, openDays } from '../src/fillweek.js';

const now = Date.parse('2026-11-02T15:00:00Z');
const ago = d => new Date(now - d * 864e5).toISOString();
const customers = [
  { name: 'Dana Ross', phone10: '4785550101', agreed: 1, optout: 0 },
  { name: 'Mo Lee', phone10: '4785550102', agreed: 1, optout: 0 },
  { name: 'Kim Park', phone10: '4785550103', agreed: 0, optout: 0 },
  { name: 'Al Cruz', phone10: '4785550104', agreed: 1, optout: 1 },
  { name: 'Bea Fox', phone10: '4785550105', agreed: 1, optout: 0 },
  { name: 'Cy Diaz', phone10: '4785550106', agreed: 1, optout: 0 },
  { name: 'Ed Gray', phone10: '4785550107', agreed: 1, optout: 0 }
];
const jobs = [
  { phone: '(478) 555-0101', title: 'Water heater install', amount: 180000, at: ago(300) },
  { phone: '4785550102', title: 'Drain clearing', amount: 25000, at: ago(40) },        // too recent
  { phone: '4785550103', title: 'Leak', amount: 9000, at: ago(400) },                 // never agreed
  { phone: '4785550104', title: 'Leak', amount: 9000, at: ago(400) },                 // opted out
  { phone: '4785550105', title: 'Faucet', amount: 30000, at: ago(500) },
  { phone: '4785550106', title: 'Old job', amount: 99000, at: ago(1300) },            // too old
  { phone: '4785550107', title: 'Toilet', amount: 20000, at: ago(200) }
];
test('only past customers who agreed, last job 6 months to 3 years ago, not opted out', () => {
  const c = pickCandidates(customers, jobs, [], [], now);
  assert.deepEqual(c.map(x => x.phone10), ['4785550101', '4785550105', '4785550107']);
});
test('nobody gets a second offer within 90 days, or after texting STOP', () => {
  const c = pickCandidates(customers, jobs, ['4785550101'], ['4785550107'], now);
  assert.deepEqual(c.map(x => x.phone10), ['4785550105']);
});
test('never more than 8 in one run', () => {
  const many = [], mj = [];
  for (let i = 0; i < 20; i++) { const p = '47855502' + String(i).padStart(2, '0'); many.push({ name: 'P ' + i, phone10: p, agreed: 1, optout: 0 }); mj.push({ phone: p, title: 'Job', amount: i, at: ago(250) }); }
  assert.equal(pickCandidates(many, mj, [], [], now).length, 8);
});
test('the offer names the business, the open time and the last job, and says how to stop', () => {
  const t = offerText('Sinclair Plumbing', 'Sam', 'Thursday at 9 AM', { name: 'Dana Ross', job: 'Water heater install', lastAt: Date.parse(ago(300)) }, now);
  assert.equal(t, 'Hi Dana, this is Sinclair Plumbing. Sam has Thursday at 9 AM open and thought of you since your water heater install last January. Want it? Reply YES or a better time. Reply STOP to end texts.');
  assert.ok(!t.includes('!'));
  assert.equal(whenText(Date.parse(ago(500)), now), 'back in June 2025');
  assert.equal(shortSlot('Thursday, November 5 at 9 AM'), 'Thursday at 9 AM');
});
test('only days with a few open hours, at least a day and a half out', () => {
  const s = h => ({ start: now + h * 3600e3, say: 'x' });
  const d = openDays([s(10), s(12), s(40), s(42), s(44), s(70)], 'America/New_York', now);
  assert.equal(d.length, 1);
  assert.equal(d[0].slots.length, 3);
});
