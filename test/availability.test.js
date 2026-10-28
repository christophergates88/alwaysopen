// Booking without a calendar: reading the owner's hours, finding open times, and never booking one time twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const { parseHours, bookingOf, slotsFor, bookFor, cancelForCall, cleanBooking, DEFAULT_DAYS } = await import('../src/availability.js');

const H = m => m * 60;

test('reading the hours owners type', () => {
  assert.deepEqual(parseHours('Mon to Fri 7 to 6, Sat 8 to 12'), { Mon: [H(7), H(18)], Tue: [H(7), H(18)], Wed: [H(7), H(18)], Thu: [H(7), H(18)], Fri: [H(7), H(18)], Sat: [H(8), H(12)] });
  assert.deepEqual(parseHours('Monday-Friday 8am-5pm; Saturday 9am-1pm; Sunday closed'), { Mon: [H(8), H(17)], Tue: [H(8), H(17)], Wed: [H(8), H(17)], Thu: [H(8), H(17)], Fri: [H(8), H(17)], Sat: [H(9), H(13)] });
  assert.deepEqual(parseHours('8:30 to 4:30'), { Mon: [510, 990], Tue: [510, 990], Wed: [510, 990], Thu: [510, 990], Fri: [510, 990] }, 'no days named means weekdays');
  assert.deepEqual(parseHours('Tue thru Sat 10 to 7'), { Tue: [H(10), H(19)], Wed: [H(10), H(19)], Thu: [H(10), H(19)], Fri: [H(10), H(19)], Sat: [H(10), H(19)] });
  assert.equal(parseHours('By appointment'), null);
  assert.equal(parseHours(''), null);
});

test('settings: pencil-in until the owner chooses, message-only for regulated lines, weekdays 8 to 5 when hours are unreadable', () => {
  assert.equal(bookingOf({ owner_set: '{}', facts: '{}' }).mode, 'hold');
  assert.deepEqual(bookingOf({ owner_set: '{}', facts: '{"hours":"call us"}' }).days, DEFAULT_DAYS);
  assert.equal(bookingOf({ owner_set: '{"book":{"mode":"book"}}', facts: '{}', regulated: 1 }).mode, 'off');
  const b = bookingOf({ owner_set: '{"book":{"mode":"book","slotMin":120,"bufferMin":0}}', facts: '{"hours":"Mon to Fri 7 to 6"}' });
  assert.equal(b.mode, 'book'); assert.equal(b.slotMin, 120); assert.equal(b.bufferMin, 0); assert.deepEqual(b.days.Mon, [H(7), H(18)]);
  assert.deepEqual(cleanBooking({ mode: 'nope', slotMin: 5000, days: { Mon: [600, 500] } }, { mode: 'book' }), { mode: 'book', slotMin: 480 });
});

const line = (o) => ({ client_id: 'c1', number: '+14785550100', regulated: 0, facts: JSON.stringify({ hours: 'Mon to Fri 8 to 5' }), owner_set: JSON.stringify({ book: Object.assign({ mode: 'book', slotMin: 60, bufferMin: 30 }, o || {}) }) });
// Wednesday Oct 28, 2026, 9:00 AM in Georgia (13:00 UTC)
const WED_9AM = Date.parse('2026-10-28T13:00:00Z');

test('open times: two hours out at least, two hours apart, only inside the owner’s hours, never on a weekend', async () => {
  const env = { DB: makeDB() };
  const o = await slotsFor(env, line(), WED_9AM, 6);
  assert.equal(o.mode, 'book');
  assert.equal(o.slots.length, 6);
  assert.equal(o.slots[0].start, Date.parse('2026-10-28T15:00:00Z'), 'first is 11 AM, two hours out');
  for (let i = 1; i < o.slots.length; i++) assert.ok(o.slots[i].start - o.slots[i - 1].start >= 2 * 3600e3);
  for (const s of o.slots) {
    const h = new Date(s.start).getUTCHours() - 4;   // Eastern daylight time in late October
    assert.ok(h >= 8 && h + 1 <= 17, 'inside 8 to 5: ' + s.say);
    assert.ok(![0, 6].includes(new Date(s.start - 4 * 3600e3).getUTCDay()), 'not a weekend: ' + s.say);
  }
  assert.match(o.slots[0].say, /^Wednesday, October 28 at 11 AM$/);
});

test('open times skip what is already booked, with the owner’s buffer around it, and work across the clock change', async () => {
  const env = { DB: makeDB() };
  const first = (await slotsFor(env, line(), WED_9AM, 6)).slots[0];
  const r = await bookFor(env, line(), first, { name: 'Dana', phone: '+14785550142', reason: 'Leaking water heater', callId: 'CA' + '1'.repeat(32) });
  assert.deepEqual([r.ok, r.held], [true, false]);
  const again = await slotsFor(env, line(), WED_9AM, 6);
  assert.ok(again.slots.every(s => s.start >= first.end + 30 * 60000 || s.end <= first.start - 30 * 60000), 'no time inside the booking or its buffer');
  // Sunday Nov 1, 2026 the clocks go back: Monday's 8 AM is 13:00 UTC, not 12:00.
  const mon = await slotsFor(env, line(), Date.parse('2026-11-01T18:00:00Z'), 1);
  assert.equal(mon.slots[0].start, Date.parse('2026-11-02T13:00:00Z'));
  assert.match(mon.slots[0].say, /Monday, November 2 at 8 AM/);
});

test('two callers grabbing the same time: the second one loses, and no time is booked twice', async () => {
  const env = { DB: makeDB() };
  const slot = (await slotsFor(env, line(), WED_9AM, 1)).slots[0];
  const [a, b] = await Promise.all([
    bookFor(env, line(), slot, { name: 'A', callId: 'CA' + 'a'.repeat(32) }),
    bookFor(env, line(), slot, { name: 'B', callId: 'CA' + 'b'.repeat(32) })
  ]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].filter(x => x.taken).length, 1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM line_bookings WHERE status != 'cancelled'").first()).n, 1);
});

test('pencil-in mode holds the time and leaves the job for the owner to confirm; cancelling frees the time', async () => {
  const env = { DB: makeDB() };
  const L = line({ mode: 'hold' });
  const slot = (await slotsFor(env, L, WED_9AM, 1)).slots[0];
  const call = 'CA' + 'c'.repeat(32);
  const r = await bookFor(env, L, slot, { name: 'Dana', phone: '+14785550142', reason: 'Drain', callId: call });
  assert.deepEqual([r.ok, r.held], [true, true]);
  const job = await env.DB.prepare("SELECT * FROM biz_jobs WHERE source = 'call' AND source_id = ?1").bind(call).first();
  assert.equal(job.stage, 'new'); assert.match(job.title, /to confirm/);
  assert.ok(await cancelForCall(env, 'c1', call));
  assert.equal((await slotsFor(env, L, WED_9AM, 1)).slots[0].start, slot.start, 'the time is open again');
  assert.equal(await slotsFor(env, line({ mode: 'off' }), WED_9AM, 6), null, 'off means Max takes a message');
});
