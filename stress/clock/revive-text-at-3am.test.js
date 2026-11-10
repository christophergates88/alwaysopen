// BUG: a past-customer message ("It's been a while, want us to come back out?") is texted to a Hawaii business's
// customer at 3 AM their time, and to a California business's customer at 5 AM.
// What goes wrong for a real person: the owner in Hilo approves the message at 8:30 PM. That is still daytime there,
// but the worker judges the hour on the East Coast (1:30 AM), so it is held "until morning". The timer then sends it at
// the first tick after 8 AM EASTERN, which is 3:00 AM in Hawaii (5:00 AM in California). A marketing text from a
// business at 3 AM is exactly what the 8 AM to 9 PM rule (and the TCPA's quiet hours) is there to stop.
// Cause: src/past.js:456 calls sendText(... kind: 'revive') with no tz. sendText's daytime check (src/sms.js:98 ->
// textDaytime -> hourIn, src/sms.js:47-53) then falls back to 'America/New_York'. The held-message timer
// (src/past.js:468-482, sendHeldRevive) re-runs the same approveRevive, so every retry is judged in Eastern time too.
// Every other customer text from a scheduled job passes the business's zone (autotext.js:131, extras.js:252,
// fillweek.js:139, checkin.js:158).
// Severity: high. A text to a customer in the middle of their night, every time a business outside Eastern time
// approves one of these after about 4 PM local (Pacific) / 2 PM (Hawaii) or before 8 AM Eastern.
// Smallest fix: in approveRevive pass the zone: sendText(env, { ..., kind: 'revive', tz: await tzFor(env, cid) })
// (tzFor from callbacks.js).
// Run: node --test stress/clock/revive-text-at-3am.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, MIN } from './_kit.mjs';

const ck = clock('2026-11-10T20:00:00Z');
after(() => ck.restore());
const T = await boot();

// One business with one past customer who agreed to hear from it (last job almost two years ago), texting approved.
async function businessWithPastCustomer(o, customer10) {
  const A = await T.signup(o);
  const a = T.as(A.base);
  const imp = await a.post('/api/import', { action: 'save', csv: 'name,phone,date,amount,work\nOld Cust,' + customer10 + ',2024-01-15,400,drain cleaning', agreed: true });
  assert.equal(imp.status, 200, imp.text);
  assert.equal((await a.post('/api/revive', { action: 'refresh' })).json().count, 1);
  assert.equal((await T.approveTexting(A.cid)).status, 200);
  const item = (await a.state()).past.revive.items.find(x => x.hasPhone);
  return { A, a, item };
}
const textsTo = to10 => T.world.texts.filter(t => t.To === '+1' + to10);
// Run the whole timer every 10 minutes from `from` to `to`; return the first moment a text reached `to10`.
async function timerUntilTexted(from, to, to10) {
  for (let t = from; t <= to; t += 10 * MIN) { ck.set(t); await T.cron(); if (textsTo(to10).length) return t; }
  return 0;
}

test('control: a Georgia business approves at 10:30 PM; the message waits and goes at 8 AM Eastern', async () => {
  const TZ = 'America/New_York', CUST = '4785550144';
  ck.set(at('2026-11-10 12:00', TZ));
  const { A, a, item } = await businessWithPastCustomer({ plan: 'Pro', business: 'Sinclair Plumbing', town: 'Eatonton, GA', phone: '(478) 555-0101' }, CUST);
  assert.equal(A.tz, TZ);
  ck.set(at('2026-11-10 22:30', TZ));
  const r = (await a.post('/api/revive', { action: 'approve', id: item.id, text: '' })).json();
  assert.equal(r.status, 'queued', 'after 9 PM: held for the morning');
  const sentAt = await timerUntilTexted(at('2026-11-10 22:40', TZ), at('2026-11-11 10:00', TZ), CUST);
  assert.ok(sentAt, 'it goes out in the morning');
  const w = wallOf(sentAt, TZ);
  assert.ok(w.hour >= 8 && w.hour < 21, 'sent at ' + w.text + ' for the customer');
});

test('a Hawaii business approves at 8:30 PM (daytime there): held, then texted to the customer at 3 AM Hawaii time', async () => {
  const TZ = 'Pacific/Honolulu', CUST = '8085550144';
  ck.set(at('2026-11-10 12:00', TZ));
  const { A, a, item } = await businessWithPastCustomer({ plan: 'Pro', business: 'Hilo Plumbing', owner: 'Kai Akana', email: 'kai@hiloplumbing.example', town: 'Hilo, HI', phone: '(808) 555-0101' }, CUST);
  assert.equal(A.tz, TZ, 'the business is on Hawaii time (voice_lines.tz)');
  ck.set(at('2026-11-10 20:30', TZ));
  const r = (await a.post('/api/revive', { action: 'approve', id: item.id, text: '' })).json();
  // (8:30 PM in Hilo is inside 8 AM to 9 PM, so this should have gone now; it is held because it is 1:30 AM in New York.)
  const sentAt = r.status === 'sent' ? at('2026-11-10 20:30', TZ) : await timerUntilTexted(at('2026-11-10 20:40', TZ), at('2026-11-11 12:00', TZ), CUST);
  assert.ok(sentAt, 'it goes out at some point');
  const w = wallOf(sentAt, TZ);
  assert.ok(w.hour >= 8 && w.hour < 21,
    'the approve answered ' + JSON.stringify(r) + '; the held message was texted to the customer at ' + w.text + ' Hawaii time (' + wallOf(sentAt, 'America/New_York').text + ' in New York)');
});
