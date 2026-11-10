// BUG: an iPhone "tapback" on Max's text is read out to the caller as the owner's answer, including the caller's own
// phone number and the internal wording of the text.
//
// What goes wrong for a real person: Mike's text from Max says "Max: Live call from (478) 555-0142. They ask: ...".
// Mike long-presses it and taps the thumbs-up (or "?", or the heart), the way most people acknowledge a text. To a
// plain SMS number an iPhone sends that as a new text: Liked “Max: Live call from (478) 555-0142. They ask: ...”.
// Max then tells the caller: "I just heard back. Mike says: Liked “Max: Live call from (478) 555-0142. They ask: ...
// Reply to this text now and Max tells them..." The question is marked answered, so the caller never gets the real
// answer or the call-back promise for it. A "?" tapback (Mike did not understand) is read out the same way. A reply of
// just "?" is said as "Mike says: ?." and closes the question too.
//
// CAUSE: src/tap.js:219 (tapFromText) takes any text with a letter or digit, or any non-empty text, as the answer;
//   cleanAnswer (src/tap.js:33) only strips brackets. relayLine (src/tap.js:67) says it word for word when the
//   plain-speech wording is not back in time (src/voice.js:1111), and the question is closed (src/voice.js:1314).
// SEVERITY: medium. Common on iPhones; the caller hears garbage and their own number, and the question is lost.
// SMALLEST FIX: in tapFromText, before poking the room, treat a reaction (/^(Liked|Loved|Disliked|Laughed at|Emphasized|
//   Questioned) [“"]/ and the Android "Reacted .. to" form) and a reply with no letters or digits as not an answer:
//   leave the question open and text back "Type the answer in words and Max tells them."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER, replyOf } from './_kit.mjs';

const ASK = 'Let me check with Mike right now. While I do, what is the address? [ASK: Can someone come out tonight for a leaking water heater?]';

async function reacted(body) {
  return timed(async c => {
    const w = await mk();
    w.world.aiScript = [ASK, 'Okay.'];
    const x = await w.room(sidOf(201));
    await w.say(x, 'My water heater is leaking, can somebody come out tonight?');
    const sent = w.world.ownerTexts[0].Body;
    c.add(6000);
    const m = w.at(x);
    const r = await w.text(OWNER, body(sent));
    c.add(6000); await x.room.alarm();
    return { w, x, heard: w.since(x, m), reply: replyOf(r), row: (await w.taps())[0] };
  });
}

test('a thumbs-up tapback from an iPhone is read to the caller, with their phone number', async () => {
  const { heard, row } = await reacted(sent => 'Liked “' + sent + '”');
  assert.doesNotMatch(heard, /Liked|555-0142|Reply to this text/, 'the caller heard: "' + heard + '"');
  assert.equal(row.status, 'open', 'a reaction is not an answer, so the question should still be open');
});

test('a "?" tapback (Mike did not understand) is read to the caller too', async () => {
  const { heard } = await reacted(sent => 'Questioned “' + sent + '”');
  assert.doesNotMatch(heard, /Questioned|Live call from/, 'the caller heard: "' + heard + '"');
});

test('a reply of just "?" is said as the answer and closes the question', async () => {
  const { heard, row } = await reacted(() => '?');
  assert.doesNotMatch(heard, /Mike says: \?/, 'the caller heard: "' + heard + '"');
  assert.equal(row.status, 'open');
});

test('control: a real answer is said', async () => {
  const { heard, row } = await reacted(() => 'Yes, 7 tonight');
  assert.equal(heard, 'I just heard back. Mike says: Yes, 7 tonight.');
  assert.equal(row.status, 'answered');
});
