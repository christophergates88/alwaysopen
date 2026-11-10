// BUG: a reply to a "Fill my week" offer that starts with a yes-word books the offered time, even when the rest of the
// reply asks for a different time.
// What a real person sees: the offer says "Dana has Thursday at 9 AM open ... Want it? Reply YES or a better time."
// The customer answers with a better time, the way the text invites them to: "Yes, but Friday would work better" or
// "OK but can you do Friday instead?" They are booked for Thursday at 9 on the owner's Google Calendar, they get
// "You're set for Thursday ..." (and a reminder the afternoon before), and the owner gets a push that they booked.
// The owner drives out on Thursday to someone who asked for Friday. Spanish "Sí, pero mejor el viernes" does the same.
// A plain "Yes" booking Thursday, and "No thanks" not booking, are right (controls).
//
// CAUSE: src/fillweek.js:151 (YES_RE) only looks at how the reply starts; src/fillweek.js:158 books on that alone.
// SEVERITY: medium (a wrong appointment on the calendar, a wrong confirmation to the customer, a wasted trip).
// SMALLEST FIX: book only when the reply is a yes and nothing else of substance (anchor YES_RE at the end too, allowing
//   please/thanks/punctuation), or at least not when it contains "but", "instead", "rather", "better", "pero", "mejor",
//   or a weekday or time other than the offered one; anything else stays an inbox reply for the owner.
//
// Run: node --test stress/texter/yes-but-friday-books-thursday.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_kit.mjs';

const NOW = Date.parse('2026-11-10T15:00:00Z');   // Tuesday, 10 AM Eastern
const CUSTOMER = '+14785550188';

async function offerOut(T) {
  const A = await T.addClient({ tier: 'Pro', ownerFirst: 'Dana' });
  await T.connectCalendar(A.cid, 'America/New_York');
  // what runFill writes when it texts the offer (src/fillweek.js:140): one live offer for Thursday
  await T.run("INSERT INTO fillweek_runs (client_id, day, created, by) VALUES (?1, '2026-11-12', ?2, 'Always Open')", A.cid, new Date(NOW - 3600e3).toISOString());
  await T.run("INSERT INTO fillweek_offers (run_id, client_id, phone10, name, job, day, status, at, result) VALUES (1, ?1, '4785550188', 'Pat Lowe', 'Water heater flush', '2026-11-12', 'sent', ?2, '')", A.cid, new Date(NOW - 3600e3).toISOString());
  return A;
}
async function reply(said) {
  const T = boot();
  clock.set(NOW);
  try {
    const A = await offerOut(T);
    await T.sms(A.number, CUSTOMER, said);
    const offer = await T.one('SELECT status, result FROM fillweek_offers WHERE client_id = ?1', A.cid);
    return { T, A, offer, booked: (T.world.gcal || []).map(e => e.start.dateTime), texts: T.sentTo(CUSTOMER).map(t => t.Body) };
  } finally { clock.restore(); }
}

test('control: "Yes" books Thursday 9 AM and confirms it', async () => {
  const { offer, booked, texts } = await reply('Yes');
  assert.equal(offer.status, 'booked');
  assert.deepEqual(booked, ['2026-11-12T14:00:00.000Z']);   // 9 AM Eastern
  assert.match(texts.join(' | '), /You’re set for Thursday/);
});

test('control: "No thanks" books nothing and stays a reply for the owner', async () => {
  const { offer, booked, texts } = await reply('No thanks');
  assert.equal(offer.status, 'replied');
  assert.equal(booked.length, 0);
  assert.equal(texts.length, 0);
});

for (const said of ['Yes, but Friday would work better', 'OK but can you do Friday instead?', 'Sí, pero mejor el viernes']) {
  test('"' + said + '" does not book Thursday', async () => {
    const { offer, booked, texts } = await reply(said);
    assert.equal(booked.length, 0, 'booked Thursday ' + booked.join() + ' (offer ' + offer.status + ') and texted them: ' + JSON.stringify(texts));
  });
}
