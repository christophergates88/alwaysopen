// BUG: the per-business daily and hourly ceilings on automatic texts are "count, then send, then write it down", with
// the Twilio request in between, so texts started together all count before any of them is written down, and all go.
// What a real person sees: the ceiling exists so a loop or a flood (a wave of robocalls that hang up, each one earning
// a missed-call text-back) can't run one business's number into the ground. One at a time it holds: with 199 automatic
// texts sent today, the 200th goes and the rest wait (control). Ten text-backs started at the same moment all go out,
// to ten numbers, past the ceiling; a hundred would all go too. The hourly ceiling (60 per business) has the same gap.
// On Cloudflare the gap is a full Twilio round trip (hundreds of milliseconds), so calls that end close together are
// enough; the harness's fake Twilio answers at once and it still happens.
//
// CAUSE: src/sms.js:102-118 counts sms_log rows, then src/sms.js:128 calls Twilio, and only src/sms.js:132 writes the
//   row that the next count would see.
// SEVERITY: low (it takes texts started within the same second or so; each one is still a real text to a real number).
// SMALLEST FIX: claim the slot before sending: INSERT the sms_log row with status 'sending' first (or keep a per-client
//   counter row updated with a conditional UPDATE ... WHERE n < ceiling), count 'sending' rows as sent, and update the
//   row with Twilio's status afterwards.
//
// Run: node --test stress/texter/ceiling-burst.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, SMS, clock } from './_kit.mjs';

const NOW = Date.parse('2026-11-10T15:00:00Z');
async function busyDay(T, cid) {
  // 199 automatic texts in the last day, all more than an hour ago, so only the daily ceiling (200) is in play
  const st = [];
  for (let i = 0; i < 199; i++) st.push(T.DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, sid, status, why, len) VALUES (?1, ?2, ?3, 'textback', ?4, 'delivered', '', 90)")
    .bind(cid, '47855' + String(10000 + i).slice(-5), new Date(NOW - 3 * 3600e3 - i * 60e3).toISOString(), 'SM' + String(i).padStart(32, '0')));
  await T.DB.batch(st);
}
const textback = (T, A, i) => SMS.sendText(T.env, { clientId: A.cid, to: '+1706555' + String(1000 + i), kind: 'textback', body: 'Sorry we missed you. This is Sinclair Plumbing. Reply here with what you need. Reply STOP to end texts.' });

test('control: one at a time, the daily ceiling lets the 200th text go and holds the rest', async () => {
  const T = boot();
  clock.set(NOW);
  try {
    const A = await T.addClient({});
    await busyDay(T, A.cid);
    const out = [];
    for (let i = 0; i < 10; i++) out.push(await textback(T, A, i));
    assert.equal(out.filter(r => r.ok).length, 1);
    assert.equal(out.filter(r => r.why === 'held: daily ceiling').length, 9);
  } finally { clock.restore(); }
});

test('ten text-backs started together all go out past the daily ceiling', async () => {
  const T = boot();
  clock.set(NOW);
  try {
    const A = await T.addClient({});
    await busyDay(T, A.cid);
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => textback(T, A, i)));
    const day = await T.one("SELECT COUNT(*) AS n FROM sms_log WHERE client_id = ?1 AND status NOT IN ('skipped', 'held', 'failed')", A.cid);
    assert.ok(out.filter(r => r.ok).length <= 1, out.filter(r => r.ok).length + ' of 10 went out; the business sent ' + day.n + ' automatic texts in a day against a ceiling of 200');
  } finally { clock.restore(); }
});

test('seventy text-backs started together all go out past the hourly ceiling of 60', async () => {
  const T = boot();
  clock.set(NOW);
  try {
    const A = await T.addClient({});
    const out = await Promise.all(Array.from({ length: 70 }, (_, i) => textback(T, A, i)));
    assert.ok(out.filter(r => r.ok).length <= 60, out.filter(r => r.ok).length + ' of 70 went out in the same hour');
  } finally { clock.restore(); }
});
