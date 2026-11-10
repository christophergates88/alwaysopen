// BUG: right after the caller hangs up, the owner's answer is taken as "Max is telling them", and the call's note says
// it was answered, though nobody heard it.
//
// What goes wrong for a real person: the caller gets tired of holding and hangs up. The call room keeps the call open
// for up to 20 seconds in case the line comes back (webSocketClose sets closedAt; onAlarm waits). In that window Mike
// replies "Yes, 7 tonight". His text back says "Got it. Max tells them as soon as they stop talking." and the note on
// the call says "You answered: “Yes, 7 tonight”", the same as a call where the caller heard it. Mike assumes the
// caller knows a plumber is coming at 7 and does not ring them; the caller heard nothing and calls someone else.
//
// CAUSE: tapAnswer (src/voice.js:1085) checks done/endAt/transfer but not that the socket closed (s.closedAt, no
//   socket in getWebSockets()). It keeps the answer and returns 'queued' (src/voice.js:1102); tapFlush cannot say it
//   (no socket, src/voice.js:1120). The write-up's tapSummary (src/tap.js:116) cannot tell said from not said.
// SEVERITY: medium. Short window, but it is exactly when a caller who gave up on holding has just left.
// SMALLEST FIX: in tapAnswer, return 'late' when s.closedAt is set (or no socket is open), like s.done. tapFromText then
//   gives the owner the "call ended... Call them back: (478) 555-0142" text and records it as a late answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER, replyOf } from './_kit.mjs';

const ASK = 'Let me check with Mike right now. While I do, what is the address? [ASK: Can someone come out tonight for a leaking water heater?]';

test('the caller has hung up, and the owner is told Max is telling them', async () => timed(async c => {
  const w = await mk();
  w.world.aiScript = [ASK, 'Okay.'];
  w.world.aiNote = { name: 'Dana', callback: '', reason: 'Leaking water heater', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'Dana has a leaking water heater.' };
  const x = await w.room(sidOf(401));
  await w.say(x, 'My water heater is leaking, can somebody come out tonight?');
  c.add(30000);
  // the caller hangs up: Twilio closes the socket (a closed socket is no longer listed by the runtime)
  const socks = x.room.ctx.getWebSockets();
  await x.room.webSocketClose(x.ws, 1000, '');
  socks.splice(socks.indexOf(x.ws), 1);
  c.add(3000);
  const r = await w.text(OWNER, 'Yes, 7 tonight');
  const reply = replyOf(r);
  // the room gives the line its 20 seconds, then writes the call up
  c.add(20000); await x.room.alarm(); await w.site.settle();
  const call = await w.row(x.sid);
  assert.doesNotMatch(reply, /Got it\. Max (is telling|tells) them/, 'Mike was told: ' + reply);
  assert.doesNotMatch(call.summary, /You answered: “Yes, 7 tonight”/, 'the note says the caller was answered: ' + call.summary);
}));
