import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, confirmText, reminderText, followText, whenText } from '../src/autotext.js';

const tz = 'America/New_York';
const base = { status: 'open', consent: 1, phone: '4785550142', name: 'Dana Ross', auto_conf: '', auto_rem: '', auto_fu: '' };

test('appointments: a confirmation first, then a reminder the afternoon before', () => {
  const now = Date.parse('2026-11-02T14:00:00Z');   // Mon 9 AM Eastern
  const appt = Object.assign({}, base, { kind: 'appointment', due: '2026-11-04', appt_at: '2026-11-04T19:00:00Z' });
  assert.deepEqual(nextStep(appt, now, { day: '2026-11-02', hour: 9 }, '2026-11-03'), { send: 'confirm' });
  const confirmed = Object.assign({}, appt, { auto_conf: '2026-11-02T14:01:00Z' });
  assert.equal(nextStep(confirmed, now, { day: '2026-11-02', hour: 9 }, '2026-11-03'), null);
  const eve = Date.parse('2026-11-03T21:30:00Z');    // Tue 4:30 PM Eastern
  assert.deepEqual(nextStep(confirmed, eve, { day: '2026-11-03', hour: 16 }, '2026-11-04'), { send: 'reminder' });
  // booked this afternoon for tomorrow: the confirmation is enough
  const late = Object.assign({}, appt, { auto_conf: '2026-11-03T20:00:00Z' });
  assert.equal(nextStep(late, eve, { day: '2026-11-03', hour: 16 }, '2026-11-04').mark, 'auto_rem');
});

test('nothing goes out without a yes, a cell number, or for something already past', () => {
  const now = Date.parse('2026-11-02T14:00:00Z');
  assert.equal(nextStep(Object.assign({}, base, { kind: 'appointment', due: '2026-11-04', consent: 0 }), now, { day: '2026-11-02', hour: 9 }, '2026-11-03'), null);
  assert.equal(nextStep(Object.assign({}, base, { kind: 'quote', due: '2026-11-02', phone: '' }), now, { day: '2026-11-02', hour: 11 }, '2026-11-03'), null);
  assert.equal(nextStep(Object.assign({}, base, { kind: 'appointment', due: '2026-10-30', appt_at: '2026-10-30T14:00:00Z' }), now, { day: '2026-11-02', hour: 9 }, '2026-11-03').value, 'skip:past');
});

test('quotes and invoices: one follow-up on the day, in business hours', () => {
  const q = Object.assign({}, base, { kind: 'quote', due: '2026-11-02', amount: '$1,250' });
  assert.equal(nextStep(q, 0, { day: '2026-11-02', hour: 8 }, '2026-11-03'), null);
  assert.deepEqual(nextStep(q, 0, { day: '2026-11-02', hour: 10 }, '2026-11-03'), { send: 'follow' });
  assert.equal(nextStep(Object.assign({}, q, { auto_fu: 'x' }), 0, { day: '2026-11-02', hour: 10 }, '2026-11-03'), null);
});

test('every text names the business and says how to stop, with no exclamation marks', () => {
  const x = Object.assign({}, base, { kind: 'appointment', due: '2026-11-04', appt_at: '2026-11-04T19:00:00Z', amount: '$300' });
  for (const t of [confirmText('Sinclair Plumbing', x, tz), reminderText('Sinclair Plumbing', x, tz), followText('Sinclair Plumbing', Object.assign({}, x, { kind: 'quote' })), followText('Sinclair Plumbing', Object.assign({}, x, { kind: 'invoice' }))]) {
    assert.match(t, /Sinclair Plumbing/);
    assert.match(t, /Reply STOP to end texts\.$/);
    assert.match(t, /^Hi Dana,/);
    assert.ok(!t.includes('!'));
  }
  assert.match(confirmText('Sinclair Plumbing', x, tz), /Wednesday, Nov 4 at 2 PM/);
  assert.match(reminderText('Sinclair Plumbing', x, tz), /tomorrow at 2 PM/);
  assert.equal(whenText(tz, '', '2026-11-04'), 'Wednesday, Nov 4');
});
