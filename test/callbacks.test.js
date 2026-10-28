import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeSlot, dueFromNote, local, fromLocal, callHoursOk, sayTime } from '../src/callbacks.js';

const tz = 'America/New_York';
const at = (day, hh, mm) => fromLocal(tz, day, hh, mm);

test('slot is the next quarter hour at least 45 minutes out, inside the day', () => {
  const s = proposeSlot(tz, at('2026-10-28', 14, 2), null);
  assert.equal(s.text, '3 PM'); assert.equal(s.tomorrow, false);
});
test('busy until pushes the slot after it', () => {
  const s = proposeSlot(tz, at('2026-10-28', 14, 2), { day: '2026-10-28', hh: 15, mm: 0 });
  assert.equal(s.text, '3:15 PM');
});
test('late in the day rolls to 9:15 tomorrow', () => {
  const s = proposeSlot(tz, at('2026-10-28', 18, 30), null);
  assert.equal(s.tomorrow, true); assert.equal(s.text, '9:15 AM'); assert.equal(s.day, '2026-10-29');
});
test('the caller\'s own time wins when it is sane', () => {
  const fb = proposeSlot(tz, at('2026-10-28', 10, 0), null);
  const d = dueFromNote(tz, 'today 15:30', fb);
  assert.equal(local(tz, d).hour, 15); assert.equal(local(tz, d).minute, 30);
  assert.equal(dueFromNote(tz, 'today 02:00', fb), fb.at);
  assert.equal(dueFromNote(tz, 'whenever', fb), fb.at);
});
test('no outbound calls between 9 PM and 8 AM', () => {
  assert.equal(callHoursOk(tz, at('2026-10-28', 21, 30)), false);
  assert.equal(callHoursOk(tz, at('2026-10-28', 7, 59)), false);
  assert.equal(callHoursOk(tz, at('2026-10-28', 8, 0)), true);
});
test('times read like people say them', () => { assert.equal(sayTime(15, 15), '3:15 PM'); assert.equal(sayTime(9, 0), '9 AM'); });
