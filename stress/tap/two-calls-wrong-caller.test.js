// BUG: with two calls on one business, the owner's answer is told to the wrong caller.
//
// What goes wrong for a real person: two people ring Quillen Plumbing within a minute of each other. Dana asks "can
// someone come tonight?" and Max texts Mike. Seconds later Tom asks "how much is a tankless flush?" and Max texts Mike
// again. Mike answers the first text he sees, Dana's: "Yes, 7 tonight". Max tells TOM "Mike says: Yes, 7 tonight." Tom
// thinks a plumber is coming tonight; Dana hears nothing and gets "couldn't reach Mike" a minute later. Mike then answers
// Tom's text ("$189"), and that is also said to Tom, as a second note; Dana's question is never answered on the call.
// Mike's texts back say only "Got it. Max is telling them now.", so he never learns it went to the wrong person.
//
// CAUSE: src/tap.js:217. tapFromText takes the newest question for the business (ORDER BY asked_at DESC LIMIT 1) and
//   gives it the text, whichever call it belongs to. Both questions went out from the same business number, so the
//   reply carries nothing that says which one it answers. Once the newest is answered, every later text goes to that
//   same call as a "tell" (src/tap.js:225-229), even while the older question is still open.
// SEVERITY: high. A caller is told a time or price meant for someone else, in the owner's name.
// SMALLEST FIX: allow one open question per business at a time. In tapSetup/openTap (src/tap.js:143, 159), when another
//   call of the same client_id has an 'ask' row still 'open' (asked in the last TAP_WAIT_MS), do not send a second
//   question: return { ok: false } so Max gives that caller the call-back promise at once (the tapDead path,
//   src/voice.js:1074). (A fuller fix puts a short code in each text, "Reply 1 ...", and matches it in tapFromText.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER, CALLER2, replyOf } from './_kit.mjs';

const ASK_A = 'Let me check with Mike right now. While I do, what is the address? [ASK: Can someone come out tonight for a leaking water heater?]';
const ASK_B = 'Let me check with Mike right now. And what is your name? [ASK: How much is a tankless water heater flush?]';

test('two calls at once: the answer to the first caller’s question is told to the second caller', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK_A, ASK_B, 'Okay.'];
  const dana = await w.room(sidOf(101));
  await w.say(dana, 'My water heater is leaking, can somebody come out tonight?');
  c.add(5000);
  const tom = await w.room(sidOf(102), CALLER2);
  await w.say(tom, 'Hi, how much do you charge to flush a tankless water heater?');
  // Nov 10 fix: one open question per business; Tom's waits for the callback, so Mike's reply can only mean Dana's
  assert.equal(w.world.ownerTexts.length, 1, 'Mike got one question while Dana’s was open');
  assert.match(w.world.ownerTexts[0].Body, /come out tonight/);
  c.add(6000);
  const mDana = w.at(dana), mTom = w.at(tom);
  // Mike answers Dana's question (the first text he got)
  const r = await w.text(OWNER, 'Yes, 7 tonight');
  assert.match(replyOf(r), /Got it\./);
  c.add(6000); await dana.room.alarm(); await tom.room.alarm();
  // what should happen: Dana hears it, Tom does not
  assert.doesNotMatch(w.since(tom, mTom), /7 tonight/, 'Tom was told the answer to Dana’s question: "' + w.since(tom, mTom) + '"');   // Nov 10: Tom gets the callback promise instead
  assert.match(w.since(dana, mDana), /Mike says: Yes, 7 tonight/, 'Dana should hear Mike’s answer');
}));

test('then Mike answers Tom: Dana’s question is never answered on her call', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK_A, ASK_B, 'Okay.'];
  const dana = await w.room(sidOf(103));
  await w.say(dana, 'My water heater is leaking, can somebody come out tonight?');
  c.add(5000);
  const tom = await w.room(sidOf(104), CALLER2);
  await w.say(tom, 'Hi, how much do you charge to flush a tankless water heater?');
  c.add(6000);
  const mDana = w.at(dana);
  await w.text(OWNER, 'Yes, 7 tonight');
  c.add(4000);
  await w.text(OWNER, '$189 for the flush');
  c.add(6000); await dana.room.alarm(); await tom.room.alarm();
  const rows = await w.taps();
  const danaRow = rows.find(t => t.call_id === dana.sid && t.kind === 'ask');
  assert.equal(danaRow.answer, 'Yes, 7 tonight', 'Dana’s question should hold Mike’s answer to it; it holds: "' + danaRow.answer + '" (status ' + danaRow.status + ')');
  assert.match(w.since(dana, mDana), /Yes, 7 tonight/, 'Dana should have heard her answer');
}));

test('control: with one call on the line, the answer reaches that caller', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK_A, 'Okay.'];
  const dana = await w.room(sidOf(105));
  await w.say(dana, 'My water heater is leaking, can somebody come out tonight?');
  c.add(6000);
  const m = w.at(dana);
  await w.text(OWNER, 'Yes, 7 tonight');
  c.add(6000); await dana.room.alarm();
  assert.match(w.since(dana, m), /Mike says: Yes, 7 tonight/);
}));
