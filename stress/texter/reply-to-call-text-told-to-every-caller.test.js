// BUG: the owner's reply to Max's own "New call from ..." text becomes a standing note that Max tells every caller.
// What a real person sees: after a call, the owner gets a text from their business number ("Max: New call from Tom
// Reyes. Water heater leaking at 12 Oak St. Call back: (404) 555-0111"). Replying to that text is the natural thing
// to do: "Thanks, I'll call Tom back, quote him $1,200 for the heater at 12 Oak St". That reply goes to the same
// business number, and every owner text to it that is not a Shoulder Tap answer or a timecard question is filed as
// "From the owner (things they want callers told)" in Max's instructions for every later call. So the next caller,
// a stranger, is being answered by a Max who has Tom's name, address and quoted price as something the owner wants
// callers told. The owner gets "Got it. Max knows: ..." back, which reads like an acknowledgement, not a warning.
// (The owner's deliberate note, "Closed Friday for the holiday", working the same way is the feature: control.)
//
// CAUSE: src/sms.js:157-171 sends every other owner text to tellMax (src/duties.js:115), which adds it to
//   owner_set.owner on every line; withOwner/lineView put that into the prompt (src/voice.js:1644 and 1795). The call
//   summary text it answers comes from the same number (src/voice.js:1440, kind 'callsum').
// SEVERITY: medium (one customer's name, address and price go into what Max tells other callers; it happens on an
//   ordinary reply, and stays until the owner texts UNDO or the note ages out).
// SMALLEST FIX: in handleSms, when the owner texted within a few hours of a 'callsum' text to them and the text does not
//   start with "Max"/"Tell Max"/"Callers", file it on that call (or in the owner's inbox) instead of tellMax, and reply
//   "Saved on Tom Reyes's call. To tell Max something for every caller, start with 'Max,'".
//
// Run: node --test stress/texter/reply-to-call-text-told-to-every-caller.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, SMS } from './_kit.mjs';
const V = await import('../../src/voice.js');
const { withOwner } = await import('../../src/app.js');

// The instructions Max gets for the next call on this line, built the way a call builds them.
async function nextCallPrompt(T, number) {
  const line = await T.one('SELECT * FROM voice_lines WHERE number = ?1', number);
  return V.systemPrompt(V.lineView(withOwner(line)), '+17065550123', 'en-US');
}
// Max's text to the owner after a call, built by voice.js's own callTextBody. Sent as kind 'confirm' (what voice.js uses
// for an urgent call) rather than 'callsum', only so the test does not depend on the hour it runs at.
async function callSummaryText(T, A) {
  const body = V.callTextBody({ max: 'Max', name: 'Tom Reyes', callback: '+14045550111', what: 'Water heater leaking at 12 Oak St. Wants someone today.' });
  const r = await SMS.sendText(T.env, { clientId: A.cid, to: A.owner, kind: 'confirm', body });
  assert.equal(r.ok, true);
  assert.equal(T.sentTo(A.owner)[0].Body, body);
}

test('control: the owner\'s deliberate note to Max reaches the next caller', async () => {
  const T = boot();
  const A = await T.addClient({});
  const r = await T.sms(A.number, A.owner, 'Closed Friday for the holiday.');
  assert.match(T.twimlMessage(r), /Max knows: Closed Friday for the holiday/);
  assert.match(await nextCallPrompt(T, A.number), /things they want callers told\): \(\w{3} \d+\) Closed Friday for the holiday/);
});

test('the owner\'s reply to a call text puts that customer\'s details into what Max tells every caller', async () => {
  const T = boot();
  const A = await T.addClient({});
  await callSummaryText(T, A);
  const r = await T.sms(A.number, A.owner, 'Thanks. I\'ll call Tom back, quote him $1,200 for the heater at 12 Oak St.');
  const prompt = await nextCallPrompt(T, A.number);
  const told = /- From the owner \(things they want callers told\): ([^\n]*)/.exec(prompt);
  assert.ok(!/12 Oak St|\$1,200|Tom/.test(prompt), 'the next caller\'s Max is told, as something the owner wants callers told: "' + (told && told[1]) + '" (the owner was answered: "' + T.twimlMessage(r) + '")');
});
