// BUG: on the owner's own test call, the push says "Tap to answer", but the app has nothing to answer with, and the app
// endpoint refuses the answer.
//
// What goes wrong for a real person: Shoulder Tap is rolled out through test calls first (facts.testFeatures, TAP_LIVE
// is false). Mike rings his own line to try it. Max asks him; his phone gets the push "Test call: Max is asking you ...
// They are still on the line. Tap to answer." He taps it. The Today screen shows no live call (test calls are left off
// the live card), and if the app does send the answer, it comes back "Shoulder Tap is not on for your line." Only the
// reply text works, so the app half of the feature cannot be tried before it goes to real callers.
//
// CAUSE: tapFromApp checks tapFeature(line, false) (src/tap.js:255), which ignores testFeatures, so a line that has
//   Shoulder Tap for test calls only is refused. tapState does the same (src/tap.js:288). The live card also skips test
//   calls (src/app.js:521, "c.test = 0"). openTap still pushes "Tap to answer" for a test call (src/tap.js:182).
// SEVERITY: low (test calls only), but it is the path the rollout depends on.
// SMALLEST FIX: in tapFromApp, read the call's test flag (add "test" to liveCall's SELECT, src/tap.js:197) and use
//   tapFeature(line, !!call.test); in the live-card query let the line's testers see their own test calls (or have the
//   push for a test call say "Reply to the text to answer").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, OWNER } from './_kit.mjs';

const ASK = 'Let me check with Mike right now. What is the address? [ASK: Can someone come out tonight for a leaking water heater?]';

test('the owner’s own test call: the app cannot answer Max’s question', async () => timed(async c => {
  const w = await mk({ features: [], facts: { testers: OWNER, testFeatures: ['tap'] } });
  w.world.aiScript = [ASK, 'Okay.'];
  const x = await w.room(sidOf(501), OWNER);
  await w.say(x, 'Can somebody come out tonight? My water heater is leaking.');
  assert.equal((await w.row(x.sid)).test, 1, 'a test call');
  assert.equal(w.world.ownerTexts.length, 1, 'Max asked Mike (by text)');
  const tap = (await w.taps())[0];
  c.add(6000);
  const m = w.at(x);
  const r = await w.app('/api/tap', { call: x.sid, id: tap.id, text: 'Yes, 7 tonight' });
  assert.equal(r.status, 200, 'the app answer was refused: ' + r.text);
  c.add(6000); await x.room.alarm();
  assert.match(w.since(x, m), /Mike says: Yes, 7 tonight/);
}));

test('control: the same answer by reply text works on the test call', async () => timed(async c => {
  const w = await mk({ features: [], facts: { testers: OWNER, testFeatures: ['tap'] } });
  w.world.aiScript = [ASK, 'Okay.'];
  const x = await w.room(sidOf(502), OWNER);
  await w.say(x, 'Can somebody come out tonight? My water heater is leaking.');
  c.add(6000);
  const m = w.at(x);
  const r = await w.text(OWNER, 'Yes, 7 tonight');
  assert.match(r.text, /Got it/);
  c.add(6000); await x.room.alarm();
  assert.match(w.since(x, m), /Mike says: Yes, 7 tonight/);
}));
