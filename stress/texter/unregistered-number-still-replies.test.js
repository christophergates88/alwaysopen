// BUG: the text webhook answers with its own texts (TwiML <Message>), which never go through sendText, so a business
// whose texting registration is not approved still "texts" from its own number.
// What a real person sees: before a business's A2P registration is approved, sendText refuses every text for it
// ("texting not registered for this business"). But the webhook still replies from that business's unregistered
// number: HELP gets "This is the text line for ...", START gets "You are back on the list ...", and the owner's own
// text to their line gets "Got it. Max knows: ..." or a Shoulder Tap "Got it. Max is telling them now." Carriers block
// unregistered 10DLC traffic, so in practice these replies are dropped (Twilio error 30034): the customer who texted
// HELP never gets the required answer and the owner never gets the "Got it" for the note they just sent Max, and nothing
// in sms_log shows that anything was sent or lost. For approved businesses the same replies skip the log, the hourly
// and daily ceilings and the opt-out check that the rules say every outbound text passes.
//
// CAUSE: src/sms.js:180-184 (START and HELP), 161, 165 and 170 (Shoulder Tap, timecard and tellMax replies) return
//   '<Message>...' from handleSms; none of them asks senderFor (src/sms.js:78) or logs to sms_log.
// SEVERITY: low (no unregistered text actually reaches a phone, but required HELP answers and the owner's
//   confirmations silently vanish, and these sends are invisible to the log and the ceilings).
// SMALLEST FIX: in handleSms, when the client is not OWN and senderFor(env, cid) is null, answer with an empty
//   <Response/> (keep the opt-out and the inbox row); better, send every reply through sendText(kind: 'reply') so it is
//   logged like any other text.
//
// Run: node --test stress/texter/unregistered-number-still-replies.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, SMS } from './_kit.mjs';

test('control: sendText refuses to text for a business whose registration is not approved', async () => {
  const T = boot();
  const A = await T.addClient({ approved: false });
  const r = await SMS.sendText(T.env, { clientId: A.cid, to: '+14785550188', kind: 'reply', body: 'Hi there' });
  assert.equal(r.why, 'texting not registered for this business');
  assert.equal(T.sent().length, 0);
});

test('a customer\'s HELP is answered from the unregistered business number', async () => {
  const T = boot();
  const A = await T.addClient({ approved: false });
  const r = await T.sms(A.number, '+14785550188', 'HELP');
  assert.equal(T.twimlMessage(r), '', 'the webhook sent "' + T.twimlMessage(r) + '" from ' + A.number + ', which has no approved registration');
});

test('START is answered from the unregistered business number', async () => {
  const T = boot();
  const A = await T.addClient({ approved: false });
  await T.sms(A.number, '+14785550188', 'STOP');
  const r = await T.sms(A.number, '+14785550188', 'START');
  assert.equal(T.twimlMessage(r), '', 'the webhook sent "' + T.twimlMessage(r) + '"');
});

test('the owner\'s note to Max is answered from the unregistered business number, and nothing is logged', async () => {
  const T = boot();
  const A = await T.addClient({ approved: false });
  const r = await T.sms(A.number, A.owner, 'We are closed Friday for the holiday.');
  const logged = await T.all('SELECT kind, status FROM sms_log WHERE client_id = ?1', A.cid);
  assert.equal(T.twimlMessage(r), '', 'the webhook sent "' + T.twimlMessage(r) + '" to the owner; sms_log rows: ' + JSON.stringify(logged));
});
