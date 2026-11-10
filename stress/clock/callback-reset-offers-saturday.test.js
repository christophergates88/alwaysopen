// BUG: when the owner misses a Friday-evening call-back, Max phones the customer and promises a call "at 9:15 in the
// morning tomorrow": Saturday, a day the business told Max it is closed.
// What goes wrong for a real person: the owner's hours in the app are Monday to Friday, 8 to 6. During the call Max
// respects them (a caller at 5 PM Friday is offered Monday). But the job that rescues a missed promise ignores them: at
// 6 PM Friday it rings the customer, offers Saturday 9:15, the customer presses 1, and the owner is nudged on Saturday
// morning for a call he never agreed to make. If he misses that one too, Max has already used his one reset call, so
// the customer just waits. Mid-week the same thing promises times after closing ("5:45 this evening" when the shop
// closes at 5).
// Cause: src/callbacks.js:402 calls proposeSlot(tz, now, busyFromLine(r, tz)) without the business's hours. proposeSlot
// (callbacks.js:149-171) then uses a fixed 8 AM to 6 PM, every day of the week. slotForLine (callbacks.js:182-191),
// used during the call, passes bookingOf(line).days.
// Severity: medium. A promise made in the owner's name on a day he is closed, to a customer who was already let down once.
// Smallest fix: at callbacks.js:402 pass the same hours slotForLine uses:
//   proposeSlot(tz, now, busyFromLine(r, tz), (await import('./availability.js')).bookingOf(r).days)
// (the row already carries owner_set from the JOIN; select l.facts as well so bookingOf can read the hours).
// Run: node --test stress/clock/callback-reset-offers-saturday.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, MIN } from './_kit.mjs';
const CB = await import('../../src/callbacks.js');

const ET = 'America/New_York';
const ck = clock(at('2026-11-13 09:00', ET));   // Friday
after(() => ck.restore());
const T = await boot();
const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
const a = T.as(A.base);
const WEEKDAYS_8_TO_6 = { Mon: [480, 1080], Tue: [480, 1080], Wed: [480, 1080], Thu: [480, 1080], Fri: [480, 1080] };
const set = await a.post('/api/line', { booking: { days: WEEKDAYS_8_TO_6 } });
assert.equal(set.status, 200, set.text);

test('control: during a call at 5:15 PM Friday, Max offers Monday morning (the business is closed on weekends)', async () => {
  ck.set(at('2026-11-13 17:15', ET));
  const line = await T.get('SELECT * FROM voice_lines WHERE client_id = ?1', A.cid);
  const s = await CB.slotForLine(T.env, line);
  assert.equal(wallOf(s.at, ET).wd, 'Mon', 'offered ' + s.spoken);
});

test('the owner misses a 5:30 PM Friday call-back; at 6 PM Max calls the customer and offers Saturday 9:15 AM', async () => {
  ck.set(at('2026-11-13 16:40', ET));
  await T.fullCall(A.number, '+14785550142', 'Can he call me back at five thirty?', { name: 'Vic', callback: '+14785550142', reason: 'Water heater leaking', details: '', when: '', urgent: false, callback_wanted: true, callback_at: 'today 17:30', booked: '', spam: false, summary: 'Wants a call back.' });
  const cb = await T.get("SELECT * FROM callbacks WHERE phone = '+14785550142'");
  assert.equal(new Date(cb.due_at).getTime(), at('2026-11-13 17:30', ET), 'promised for 5:30 PM Friday, inside the hours');
  for (let t = at('2026-11-13 17:40', ET); t <= at('2026-11-13 18:30', ET); t += 10 * MIN) { ck.set(t); await T.cron(); }
  const d = T.world.dialed.find(x => x.To === '+14785550142');
  assert.ok(d, 'Max called Vic to set a new time');
  const offered = new URL(d.Url).searchParams.get('n');
  const row = await T.get('SELECT due_at FROM callbacks WHERE id = ?1', cb.id);
  const w = wallOf(Date.parse(row.due_at), ET);
  assert.ok(w.wd in WEEKDAYS_8_TO_6, 'Max told Vic the owner would call "' + offered + '": ' + w.text + ', a day the business is closed');
});
