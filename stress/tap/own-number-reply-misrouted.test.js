// BUG: a reply that comes back to Always Open's own number is matched to a business by a loose scan, so it can go to
// another business's caller, or to nobody.
//
// What goes wrong for a real person:
//  1. Mike owns two businesses, a plumbing shop and an electrical shop, and neither has its own texting approved yet, so
//     Max's questions for both come from Always Open's number. A plumbing caller asked earlier and Mike answered; that
//     call is still going. Now an electrical caller asks "can you install a panel Saturday?" and Mike gets a text that
//     says "for Second Shop". He answers "Yes, Saturday at 9". Max tells the PLUMBING caller "I just got a note from
//     Mike: Yes, Saturday at 9", and the electrical caller hears "couldn't reach Mike" a minute later.
//  2. Once more than 20 businesses have asked a question in the last 10 minutes (any business on Always Open's number,
//     or with its own), an owner whose business sorts after them is never found: their answer goes to Always Open's
//     inbox, they get no text back, and their caller is told nobody could be reached.
//
// CAUSE: tapFromOwnerText (src/tap.js:239-243) lists "SELECT DISTINCT client_id FROM call_taps WHERE ... LIMIT 20"
//   with no order and no filter on the sender, then hands the text to the first business whose owner phone matches.
//   tapFromText for that business then gives it to that business's latest call, as a "tell" if its question was
//   already answered (src/tap.js:225-229). Nothing checks which business the question was sent for, or that it went
//   out from Always Open's number at all.
// SEVERITY: medium (only businesses not yet registered for texting, and Always Open's own line; more as clients grow).
// SMALLEST FIX: find the businesses by the sender first: "SELECT client_id FROM app_clients WHERE active = 1" matched on
//   ph10(phone) = from10 (plus OWN when from10 is OPS_TEXT_TO), then pick, across those, the newest call_taps 'ask' row
//   that is still open (status 'open' or 'timeout') before any already-answered one; no LIMIT 20 over everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER, CALLER2, OWN_LINE, LINE3, replyOf } from './_kit.mjs';

test('one owner, two businesses on Always Open’s number: the answer for one is told to the other’s caller', async () => timed(async c => {
  const w = await mk({ brand: false, third: { brand: false } });
  w.world.aiScript = ['Let me check with Mike right now. What is the address? [ASK: Can someone come out tonight for a leaking water heater?]', 'Okay.',
    'Let me check with Mike right now. What is your name? [ASK: Can we install a new panel this Saturday?]', 'Okay.'];
  const plumb = await w.room(sidOf(601));
  await w.say(plumb, 'My water heater is leaking, can somebody come out tonight?');
  c.add(6000);
  const r1 = await w.text(OWNER, 'Yes, 7 tonight', OWN_LINE);
  assert.match(replyOf(r1), /Got it/);
  c.add(6000); await plumb.room.alarm();
  await w.say(plumb, 'Great, it is 12 Oak Street.');           // the plumbing call carries on
  c.add(20000);
  const elec = await w.room(sidOf(602), CALLER2, LINE3);
  await w.say(elec, 'Hi, can you put in a new electrical panel this Saturday?');
  assert.match(w.world.ownerTexts.at(-1).Body, /for Second Shop\.\nThey ask: "Can we install a new panel this Saturday\?"/);
  c.add(6000);
  const mP = w.at(plumb), mE = w.at(elec);
  await w.text(OWNER, 'Yes, Saturday at 9', OWN_LINE);
  c.add(6000); await plumb.room.alarm(); await elec.room.alarm();
  assert.doesNotMatch(w.since(plumb, mP), /Saturday/, 'the plumbing caller was told: "' + w.since(plumb, mP) + '"');   // (an idle "Hello?" on the quiet plumbing call is fine)
  assert.match(w.since(elec, mE), /Saturday at 9/, 'the electrical caller should hear it');
}));

test('more than 20 businesses with a question in the last 10 minutes: the owner’s answer is never matched', async () => timed(async c => {
  const w = await mk({ brand: false });
  w.world.aiScript = ['Let me check with Mike right now. What is the address? [ASK: Can someone come out tonight for a leaking water heater?]', 'Okay.'];
  const x = await w.room(sidOf(603));
  await w.say(x, 'My water heater is leaking, can somebody come out tonight?');
  // twenty other businesses asked their owners in the same ten minutes (their own lines; their ids sort first)
  const now = new Date().toISOString();
  for (let i = 0; i < 20; i++) {
    const id = 'b' + String(i).padStart(2, '0');
    await w.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first) VALUES (?1, ?2, 'Shop', 1, 'Pro', 'calls', ?3, 'Sam')").bind(id, 'h' + id, '(478) 555-3' + String(i).padStart(3, '0')).run();
    await w.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) VALUES (?1, ?2, ?3, 'ask', 'q?', ?4, 'open')").bind('tpx' + i, sidOf(700 + i), id, now).run();
  }
  c.add(6000);
  const m = w.at(x);
  const r = await w.text(OWNER, 'Yes, 7 tonight', OWN_LINE);
  c.add(6000); await x.room.alarm();
  assert.match(replyOf(r), /Got it/, 'Mike got no "Got it" back: "' + replyOf(r) + '"');
  assert.match(w.since(x, m), /Mike says: Yes, 7 tonight/, 'the caller never heard Mike’s answer');
}));

test('control: one business on Always Open’s number, the reply finds its call', async () => timed(async c => {
  const w = await mk({ brand: false });
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can someone come out tonight?]', 'Okay.'];
  const x = await w.room(sidOf(604));
  await w.say(x, 'Can somebody come out tonight?');
  c.add(6000);
  const m = w.at(x);
  await w.text(OWNER, 'Yes, 7 tonight', OWN_LINE);
  assert.match(w.since(x, m), /Mike says: Yes, 7 tonight/);
}));
