// BUG: when the caller talks over Max while he is still finishing the reply that asks the owner, the question is never
// sent, though the caller already heard "Let me check with Mike right now."
//
// What goes wrong for a real person: Max says "Let me check with Mike right now." and the caller says "okay, sure"
// over the next words. Max stops talking, as he should. But the [ASK] tag at the end of that reply is dropped with the
// rest of it: Mike is never texted, no push goes out, and nothing waits on an answer, so the caller never hears either
// Mike's answer or "couldn't reach Mike". Max's next turn has no note that a question is out, only his own words
// "Let me check with Mike right now", so he may say he is still checking for as long as the caller holds, or guess.
//
// CAUSE: onPrompt returns early for a reply the caller talked over (src/voice.js:961, "if (mine.cut != null) ...
//   return") before the line that opens the question (src/voice.js:996, "if (sp.flags.ask) this.tapStart(...)").
//   The tag comes last in the reply (tapRule asks for it at the end, src/tap.js:92), so it is the part most likely to be
//   cut. The caller's words reach the room as an interrupt while the model is still writing (onInterrupt sets L.cut and
//   stops the Speaker, src/voice.js:1014).
// SEVERITY: medium-low. The window is the second or two while the reply is still being written, but "okay" over Max is
//   common, and the failure is silent.
// SMALLEST FIX: when the cut reply's spoken part already promised the check (the heard text says "check with") or the
//   tag was read, still open the question: move the tapStart call above the "mine.cut != null" return, guarded by
//   cur.line.tap; or, if the tag was not read, add a tapNote line so Max knows nothing was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, gateStream, tick } from './_kit.mjs';

const ASK = 'Let me check with Mike right now. While I do, what is the address there? [ASK: Can someone come out tonight for a leaking water heater?]';

async function run(c, interrupt) {
  const w = await mk();
  w.world.aiScript = [ASK, 'Sure, what is the address?'];
  const x = await w.room(sidOf(801));
  const g = gateStream('While I');
  try {
    const p = w.send(x, { type: 'prompt', voicePrompt: 'My water heater is leaking, can somebody come out tonight?', last: true });
    for (let i = 0; i < 500 && !/right now\./.test(w.said(x)); i++) await tick();
    assert.match(w.said(x), /Let me check with Mike right now\./, 'the caller heard the promise');
    if (interrupt) await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: 'Let me check with Mike right now.', durationUntilInterruptMs: 1800 });
    g.release();
    await p;
    if (x.room.tapJob) await x.room.tapJob;
  } finally { g.restore(); }
  return { w, x };
}

test('the caller says "okay" over Max: Mike is never asked', async () => timed(async c => {
  const { w, x } = await run(c, true);
  assert.equal(w.world.ownerTexts.length, 1, 'Max said he would check with Mike, but no question went to Mike');
  assert.ok(w.state(x).tap, 'and nothing is waiting on an answer');
}));

test('control: the same reply heard to the end asks Mike', async () => timed(async c => {
  const { w, x } = await run(c, false);
  assert.equal(w.world.ownerTexts.length, 1);
  assert.ok(w.state(x).tap);
}));
