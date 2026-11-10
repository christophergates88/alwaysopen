// BUG: an answer the owner texts while Max is putting the caller through is lost, and the owner is told the call ended.
//
// What goes wrong for a real person: a caller asks "can someone come tonight?"; Max texts Mike. The caller then says it
// is flooding and asks for a person, so Max puts them through to Mike's cell. Mike is typing "Yes, 7 tonight" as his
// phone rings. His text back says "That call ended before your answer got there... Call them back", while the call is
// ringing on his own phone. He lets it ring out. The call's note then says "No answer came in time, so he promised a
// call back": Mike's answer is nowhere on the call, though call_taps marks it 'late' with the text, and the owner was
// told it would be on the calls list.
//
// CAUSE: during the dial the room has s.transfer set, so tapAnswer returns 'late' (src/voice.js:1085) without keeping
//   the answer in the room's s.taps. tapFromText then calls record(..., 'late') (src/tap.js:228), whose summary update
//   only runs "WHERE ... outcome != 'live'" (src/tap.js:208), and app_calls.outcome is still 'live' for the whole dial
//   (afterRelay only sets transferred = 2, src/voice.js:265). The write-up after the dial builds the note from the room's
//   s.taps (src/voice.js:1389), which never got the answer. REPLY.late (src/tap.js:202) says the call ended.
// SEVERITY: medium. The owner's answer disappears from the record of the call, and the text back misleads them.
// SMALLEST FIX: in tapAnswer, when the call is ending or being put through (s.endAt / s.transfer / s.handoff) but not
//   finalized, still record the answer on the room's own list before returning 'late' (the tapApply rec.a line,
//   without tapGot), so writeUp's tapSummary carries it; and in REPLY.late say "They are being put through to you" when
//   the call row is transferred = 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER, replyOf } from './_kit.mjs';

const ASK = 'Let me check with Mike right now. While I do, what is the address? [ASK: Can someone come out tonight for a leaking water heater?]';

async function putThroughThenAnswer(c, w, dialStatus) {
  w.world.aiScript = [ASK, 'One moment, let me get Mike on the line for you. [TRANSFER]', 'Okay.'];
  w.world.aiNote = { name: 'Dana', callback: '', reason: 'Leaking water heater', details: '', when: '', urgent: true, callback_wanted: true, booked: '', spam: false, summary: 'Dana has a leaking water heater.' };
  const x = await w.room(sidOf(301));
  await w.say(x, 'My water heater is leaking, can somebody come out tonight?');
  c.add(3000);
  await w.say(x, 'Actually it is flooding the garage now, can I talk to someone?');
  assert.equal(w.state(x).transfer, true, 'Max is putting them through');
  c.add(8000); await x.room.alarm();
  assert.deepEqual(JSON.parse(x.ws.sent.at(-1).handoffData), { reason: 'transfer' });
  const dial = await w.hook('after', { CallSid: x.sid, SessionDuration: '30', SessionStatus: 'ended', HandoffData: '{"reason":"transfer"}' });
  assert.match(dial.text, /<Dial/);
  // Mike's phone is ringing; he answers the text instead
  const r = await w.text(OWNER, 'Yes, 7 tonight');
  await w.hook('dial', { CallSid: x.sid, DialCallStatus: dialStatus, DialCallDuration: dialStatus === 'completed' ? '45' : '0' });
  await w.site.settle();
  return { x, reply: replyOf(r), call: await w.row(x.sid), row: (await w.taps())[0] };
}

test('an answer texted during the transfer ring is missing from the call note', async () => timed(async c => {
  const w = await mk();
  const { call, row } = await putThroughThenAnswer(c, w, 'no-answer');
  assert.equal(row.answer, 'Yes, 7 tonight', 'call_taps holds the answer (status ' + row.status + ')');
  assert.match(call.summary, /Yes, 7 tonight/, 'the call note should carry Mike’s answer; it says: ' + call.summary);
}));

test('the owner is told the call ended while it is ringing on his own phone', async () => timed(async c => {
  const w = await mk();
  const { reply } = await putThroughThenAnswer(c, w, 'no-answer');
  assert.doesNotMatch(reply, /That call ended/, 'Mike was told: ' + reply);
}));

test('control: an answer after the call is written up is added to its note', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK, 'Okay.'];
  const x = await w.room(sidOf(302));
  await w.say(x, 'My water heater is leaking, can somebody come out tonight?');
  await w.hangUp(x);
  c.add(60000);
  await w.text(OWNER, 'Yes, 7 tonight');
  assert.match((await w.row(x.sid)).summary, /You answered after the call ended: “Yes, 7 tonight”/);
}));
