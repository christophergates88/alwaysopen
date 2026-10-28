import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burnPerDay, twilioLevel, renewalsDue, isCreditError } from '../src/funding.js';

const t = h => new Date(Date.UTC(2026, 9, 20) + h * 3600e3).toISOString();
test('spending counts drops only, so a top-up is not mistaken for income', () => {
  const r = [{ at: t(0), value: 100 }, { at: t(24), value: 90 }, { at: t(30), value: 140 }, { at: t(48), value: 130 }];
  assert.equal(Math.round(burnPerDay(r)), 10);
  assert.equal(burnPerDay([{ at: t(0), value: 5 }]), 0);
});
test('warning and urgent levels by dollars and by days left', () => {
  assert.equal(twilioLevel(200, 5).level, 'ok');
  assert.equal(twilioLevel(40, 5).level, 'warn');      // 8 days left
  assert.equal(twilioLevel(12, 5).level, 'urgent');    // under 3 days
  assert.equal(twilioLevel(20, 0).level, 'warn');      // under $25
  assert.equal(twilioLevel(8, 0).level, 'urgent');     // under $10
});
test('renewal reminders at 30, 7 and 1 days', () => {
  const now = Date.parse('2027-09-25T12:00:00Z');
  assert.equal(renewalsDue('alwaysopenoffice.com domain:2027-10-24', now)[0].bucket, 30);
  assert.equal(renewalsDue('x:2027-10-01', now)[0].bucket, 7);
  assert.equal(renewalsDue('x:2027-09-26', now)[0].bucket, 1);
  assert.equal(renewalsDue('x:2027-12-01', now).length, 0);
});
test('Claude credit errors are recognized', () => {
  assert.ok(isCreditError('Your credit balance is too low to access the Anthropic API.'));
  assert.ok(!isCreditError('overloaded'));
});

import { checkLevel } from '../src/funding.js';
test('the review check alarm: fine under 14 hours, a warning after, urgent after 30', () => {
  const now = Date.parse('2026-10-28T20:00:00Z');
  assert.equal(checkLevel('', now).level, 'unknown');
  assert.equal(checkLevel('2026-10-28T12:00:00Z', now).level, 'ok');
  assert.equal(checkLevel('2026-10-28T04:00:00Z', now).level, 'warn');
  assert.equal(checkLevel('2026-10-27T12:00:00Z', now).level, 'urgent');
});
