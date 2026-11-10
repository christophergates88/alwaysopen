// BUG: Max's minutes (the 300 a month, the 25-cents-a-minute bill and the 120-minutes-a-day safety cap) are counted from
// app_calls.seconds: the length of the whole phone call as Twilio reports it in its status callback. That is not the
// time Max was on the call (app_calls.relay_seconds), and it is only there if that one callback arrives.
//   1. A call Max puts through to the owner keeps counting while the owner talks on their own phone. Four callers put
//      through for 30 minutes each: Max spoke for 80 seconds, the meter says 124 minutes.
//   2. Those same two hours trip the daily cap ("a robocall storm or abuse"): the fifth caller that day, and everyone after
//      for a day, hears "We are getting a lot of calls right now" and is hung up on. A paying client's line is off.
//   3. A ten-minute call with Max whose status callback never arrives counts as zero minutes: free, and invisible.
//   4. The app's own Upgrades card counts the other way (relay_seconds), so the same screen shows two different
//      numbers, and it always says "your 300" even to a client who pays for 600: it tells them to buy what they have.
// Cause: src/minutes.js:28 (usedMinutes sums seconds), src/minutes.js:104 (overDailyCap sums seconds),
//        src/voice.js:360 (the only place seconds is written), src/upgrades.js:21 and :70-72 (relay_seconds, fixed 300).
// Severity: high. Owners are billed 25 cents a minute for their own conversations, a paying line goes dead for a day,
// and other calls are free.
// Smallest fix: in both sums count Max's time: CASE WHEN relay_seconds > 0 THEN relay_seconds ELSE
// MAX(seconds - transfer_seconds, 0) END; and have the Upgrades card take "used" and "included" from meterFor.
// (If billing the whole call is what is wanted, the cap must still leave transfer_seconds out, and the card must say
// the meter's number.)
// Run: node --test stress/money/05-minutes-counted-from-the-wrong-clock.test.js   (1 control passes, 5 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';
const { meterFor } = await import('../../src/minutes.js');

const ck = clock('2026-11-10T14:00:00Z');   // Tuesday, 9 AM Eastern
after(() => ck.restore());
const w = await boot();
const plain = await w.signup({ plan: 'Pro', business: 'Plain Plumbing', phone: '(706) 555-0111', email: 'plain@example.com' });
const busy = await w.signup({ plan: 'Pro', business: 'Put Through Plumbing', phone: '(706) 555-0122', email: 'busy@example.com' });
const addon = await w.signup({ plan: 'Growth', max: '1', business: 'Six Hundred Plumbing', phone: '(706) 555-0133', email: 'addon@example.com' });
w.world.aiNote = { name: 'Gus', callback: '', reason: 'Wants the owner', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'Asked for the owner.' };

// One call with Max from start to finish: Twilio's hooks in the order Twilio sends them.
async function call(c, from, o) {
  const sid = w.newSid();
  const first = await w.hook('in', { CallSid: sid, To: c.number, From: from });
  if (!/<ConversationRelay/.test(first.text)) return { sid, answered: false, heard: (first.text.match(/<Say[^>]*>([^<]*)/) || [])[1] || '' };
  await w.openRoom(sid, from);
  w.world.aiScript = [o.transfer ? 'Sure, connecting you now. [TRANSFER]' : 'Got it. I will pass that along. [END]'];
  await w.say(sid, o.transfer ? 'Can I talk to the owner please, I want to speak to a real person.' : 'Hi, my water heater is leaking.');
  const end = await w.hook('after', Object.assign({ CallSid: sid, SessionDuration: String(o.max), SessionStatus: 'ended' }, o.transfer ? { HandoffData: '{"reason":"transfer"}' } : {}));
  if (o.transfer) { assert.match(end.text, /<Dial/, 'the call is put through to the owner'); await w.hook('dial', { CallSid: sid, DialCallStatus: 'completed', DialCallDuration: String(o.owner) }); }
  await w.site.settle();
  if (o.status !== false) await w.hook('status', { CallSid: sid, CallStatus: 'completed', CallDuration: String(o.max + (o.owner || 0) + 2) });
  return { sid, answered: true };
}

test('control: a 95-second call with Max counts as 2 minutes', async () => {
  await call(plain, '+14785550140', { max: 95 });
  const m = await meterFor(w.env, plain.cid);
  assert.deepEqual([m.used, m.calls], [2, 1]);
});

test('BUG 3: a ten-minute call with Max counts even when Twilio\'s status callback never arrives', async () => {
  ck.add(5 * 60e3);
  const { sid } = await call(plain, '+14785550141', { max: 600, status: false });
  const row = await w.get('SELECT outcome, seconds, relay_seconds FROM app_calls WHERE id = ?1', sid);
  assert.deepEqual([row.outcome, row.relay_seconds], ['done', 600], 'the worker knows Max was on for 600 seconds');
  const m = await meterFor(w.env, plain.cid);
  assert.equal(m.used, 12, 'the meter still says ' + m.used + ' minutes: the ten-minute call was free (seconds = ' + row.seconds + ')');
});

test('BUG 1: time the owner spends talking on their own phone is not Max\'s minutes', async () => {
  await w.site.call(busy.A('/api/line'), { json: { transferTo: '478 555 0109', transferWhen: 'asked', by: 'Dana' } });
  for (let i = 0; i < 4; i++) { ck.add(40 * 60e3); assert.equal((await call(busy, '+1478555016' + i, { transfer: true, max: 20, owner: 1800 })).answered, true); }
  const rows = await w.all('SELECT outcome, relay_seconds, transfer_seconds FROM app_calls WHERE client_id = ?1', busy.cid);
  assert.deepEqual(rows.map(r => [r.outcome, r.relay_seconds, r.transfer_seconds]), Array(4).fill(['transferred', 20, 1800]), 'four calls: 20 seconds of Max, 30 minutes of the owner');
  const m = await meterFor(w.env, busy.cid);
  assert.equal(m.used, 4, 'Max spoke for 80 seconds in all; the meter (and the 25-cent bill past 300) says ' + m.used + ' minutes');
});

test('BUG 2: the owner\'s own two hours on the phone must not shut the line to the next caller', async () => {
  ck.add(40 * 60e3);
  const pushes = w.world.pushes.length;
  const fifth = await call(busy, '+14785550170', { max: 60 });
  await w.site.settle();
  assert.equal(fifth.answered, true, 'the fifth caller of the day did not get Max. They heard: "' + fifth.heard + '". Operator push: ' + w.world.pushes.slice(pushes).map(p => p.title + ' / ' + p.body.replace(/\s+/g, ' ').slice(0, 160)).join(' | '));
});

test('BUG 4: the Upgrades card and the minutes meter in the same app must agree', async () => {
  const st = (await w.site.call(busy.A('/api/state'))).json();
  const card = st.upgrades.list.find(u => u.id === 'addon-minutes');
  const said = +(card.why[0].match(/You used (\d+) of your/) || [])[1];
  assert.equal(said, st.minutes.used, 'meter: "' + st.minutes.used + ' of ' + st.minutes.included + '". Upgrades card: "' + card.why.join(' ') + '"');
});

test('BUG 4: a client who already pays for 600 minutes is not told they have 300 and should buy 300 more', async () => {
  let n = 0;
  for (let i = 0; i < 52; i++) await w.run("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, seconds, relay_seconds, test) VALUES (?1, ?2, ?3, ?4, '+14785550142', 'done', 600, 600, 0)",
    'CA' + (0xa000 + ++n).toString(16).padStart(32, '0'), addon.cid, addon.number, new Date(Date.UTC(2026, 10, 1 + (i % 9), 14, i)).toISOString());
  const st = (await w.site.call(addon.A('/api/state'))).json();
  assert.deepEqual([st.billing.max, st.minutes.used, st.minutes.included, st.minutes.over], [true, 520, 600, 0], 'control: the meter knows they have 600 and are inside it');
  const card = st.upgrades.list.find(u => u.id === 'addon-minutes');
  assert.ok(!card || (!/of your 300 /.test(card.why[0]) && card.fit < 90), 'top of "Upgrades for you" (fit ' + (card && card.fit) + '): "' + (card && card.why.join(' ')) + '"');
});
