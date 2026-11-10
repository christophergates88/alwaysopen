// BUG: the public booking page (/b/<ref>) books customers on top of visits Max already gave out, and on days and at
// lengths the owner never offered.
// handleBooking (src/extras.js:37-74) takes its times from gcal.js openSlots: fixed one-hour slots, weekdays 9 to 5, from
// the Google Calendar alone. It never reads the owner's Booking settings (visit length, days, hours, time between
// visits: availability.js bookingOf) or Max's own book of visits (line_bookings). In the default "pencil it in" mode Max's
// visits are not put on the Google Calendar at all (availability.js:122), so the page cannot see them.
// It also has no claim on a slot: two customers at the same moment both hear "You're booked" (extras.js:54-61).
//
// The rehearsal harness has no Google Calendar, so this file adds a small one (stress/owner/_setup.mjs
// fakeGoogleCalendar: token, events.list, events.insert, as Google documents them). The calendar is connected through
// the worker's own /google/connect and /google/callback.
// Run: node --test stress/owner/booking-page-double-books.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, fakeGoogleCalendar } from './_setup.mjs';

const MONDAY_8PM = Date.parse('2026-11-10T01:00:00Z');   // Monday, November 9, 8 PM Eastern
async function shop() {
  const T = await boot();
  fakeGoogleCalendar(T.world);
  T.env.GOOGLE_CLIENT_ID = 'gid'; T.env.GOOGLE_CLIENT_SECRET = 'gsecret';
  clock.set(MONDAY_8PM);
  const A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
  const go = await T.site.call('/google/connect?code=' + A.code);
  const back = await T.site.call('/google/callback?state=' + encodeURIComponent(new URL(go.location).searchParams.get('state')) + '&code=authcode');
  assert.equal(back.status, 200); assert.equal((await T.as(A.base).state()).calendar.connected, true);
  const offered = async () => [...(await T.site.call('/b/' + A.ref)).text.matchAll(/name="slot" value="(\d+)"[^>]*><span>([^<]+)</g)].map(m => ({ start: +m[1], say: m[2] }));
  const book = (slot, name, phone, ip) => T.site.call('/b/' + A.ref, { ip, form: { slot: String(slot.start), name, phone, reason: 'Leaky faucet', t: String(Date.now() - 30e3) } });
  const said = r => r.text.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { T, A, a: T.as(A.base), offered, book, said };
}

test('Max pencils Rita in for Wednesday 8 to 10; the booking page then books Walt for Wednesday 9', async () => {
  const { T, A, a, offered, book, said } = await shop();
  try {
    // The owner's Booking card: visits take two hours, Wednesday to Friday, Max pencils a time in (the default mode).
    const set = await a.post('/api/line', { booking: { mode: 'hold', slotMin: 120, bufferMin: 30, days: { Wed: [480, 1020], Thu: [480, 1020], Fri: [480, 1020] } }, by: 'Dana' });
    assert.equal(set.status, 200, set.text);
    // A caller takes the first time Max offers.
    const { sid } = await T.startCall(A.number, '+14785550161'); await T.openRoom(sid, '+14785550161');
    const first = T.wsOf(sid).store.get('s').line.slots[0];
    assert.equal(first.say, 'Wednesday, November 11 at 8 AM');
    T.world.aiNote = { name: 'Rita', callback: '+14785550161', reason: 'Clogged drain', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Rita penciled in a visit.' };
    T.world.aiScript = ['Okay Rita, you are penciled in for ' + first.say + ' and the team will confirm. [BOOK 1 | Rita | Clogged drain]'];
    await T.say(sid, 'The first one works. This is Rita, my kitchen drain is clogged.');
    await T.hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' }); await T.site.settle();
    const rita = await T.get("SELECT start, end, status FROM line_bookings WHERE client_id = ?1 AND name = 'Rita'", A.cid);
    assert.deepEqual([rita.status, rita.end - rita.start], ['held', 2 * 3600e3], 'Rita has Wednesday 8 to 10 AM');

    clock.set(MONDAY_8PM + 10 * 60e3);
    const page = await offered();
    const onTop = page.filter(s => s.start < rita.end && s.start + 3600e3 > rita.start).map(s => s.say);
    const closedDays = page.filter(s => /^(Monday|Tuesday)/.test(s.say)).map(s => s.say);
    assert.deepEqual({ timesInsideRitasVisit: onTop, timesOnDaysTheOwnerTakesNoVisits: closedDays }, { timesInsideRitasVisit: [], timesOnDaysTheOwnerTakesNoVisits: [] },
      'what the booking page offers customers');
  } finally { clock.restore(); }
});

test('and it takes the booking: Walt is told "You’re booked" for the hour inside Rita’s visit', async () => {
  const { T, A, a, offered, book, said } = await shop();
  try {
    await a.post('/api/line', { booking: { mode: 'hold', slotMin: 120, bufferMin: 30, days: { Wed: [480, 1020], Thu: [480, 1020], Fri: [480, 1020] } }, by: 'Dana' });
    const { sid } = await T.startCall(A.number, '+14785550161'); await T.openRoom(sid, '+14785550161');
    T.world.aiNote = { name: 'Rita', callback: '+14785550161', reason: 'Clogged drain', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Rita penciled in a visit.' };
    T.world.aiScript = ['Okay Rita, you are penciled in and the team will confirm. [BOOK 1 | Rita | Clogged drain]'];
    await T.say(sid, 'The first one works. This is Rita.');
    await T.hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' }); await T.site.settle();
    const rita = await T.get("SELECT start, end FROM line_bookings WHERE client_id = ?1 AND name = 'Rita'", A.cid);
    clock.set(MONDAY_8PM + 10 * 60e3);
    const nine = { start: rita.start + 3600e3 };   // Wednesday 9 AM
    const r = await book(nine, 'Walt Web', '478-555-0162');
    assert.doesNotMatch(said(r), /You’re booked/, 'the page told the customer: "' + said(r).slice(0, 170) + '" while Rita holds 8 to 10 that morning');
  } finally { clock.restore(); }
});

test('two customers pick the same open hour at the same moment: both are told they are booked', async () => {
  const { T, offered, book, said } = await shop();
  try {
    clock.set(MONDAY_8PM + 10 * 60e3);
    const slot = (await offered())[0];
    T.world.gcalLagMs = 25;   // each calendar call takes 25 ms here (Google's take a few hundred): the gap the two fall into
    const [ann, bob] = await Promise.all([book(slot, 'Ann Race', '478-555-0171', '198.51.100.21'), book(slot, 'Bob Race', '478-555-0172', '198.51.100.22')]);
    const booked = [ann, bob].filter(r => /You’re booked/.test(said(r))).length;
    const onCalendar = T.world.gcal.filter(e => Date.parse(e.start.dateTime) === slot.start).map(e => e.summary);
    assert.deepEqual({ toldTheyAreBooked: booked, onTheOwnersCalendarAtThatHour: onCalendar.length }, { toldTheyAreBooked: 1, onTheOwnersCalendarAtThatHour: 1 }, slot.say + ': ' + onCalendar.join(' and '));
  } finally { clock.restore(); }
});
