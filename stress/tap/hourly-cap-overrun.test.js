// BUG: the "12 questions an hour" limit is only checked when a call starts, so calls that start together, or one call
// that asks twice, go past it.
//
// What goes wrong for a real person: a busy hour, or someone ringing the line over and over. Each call that starts
// while the hour's count is under 12 may ask Mike twice, however many questions go out meanwhile. In the test, five
// calls that start when 11 have gone out each ask once: 16 in the hour where the limit says 12 (asking twice each,
// 21). Someone who wants to pester the owner only has to have several calls going at once.
//
// CAUSE: the count is read once, in tapSetup at the start of the call (src/tap.js:152-153); openTap (src/tap.js:159)
//   and tapStart (src/voice.js:1059-1068) never look at it again. Only TAP_MAX (2 a call) applies after that.
// SEVERITY: low. The overrun is bounded by 2 per call that is on at once, and the general text ceilings still apply.
// SMALLEST FIX: check the hour's count again in openTap, before the insert (one COUNT for the client_id in the last
//   hour); at or over TAP_PER_HOUR, insert nothing and return { ok: false }, which the room already turns into the
//   call-back promise (src/voice.js:1074).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mk, timed, sidOf, T } from './_kit.mjs';

test('five calls that start under the limit together send the owner past twelve questions in the hour', async () => timed(async c => {
  const w = await mk();
  await T.ensureTaps(w.env);
  const now = new Date().toISOString();
  for (let i = 0; i < T.TAP_PER_HOUR - 1; i++) await w.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) VALUES (?1, 'CAx', 'c1', 'ask', 'q?', ?2, 'timeout')").bind('tp' + i, now).run();
  w.world.aiScript = ['Let me check with Mike right now. [ASK: Can someone come out tonight?]'];
  const rooms = [];
  for (let i = 0; i < 5; i++) rooms.push(await w.room(sidOf(950 + i), '+1478555' + String(1200 + i)));   // all five calls are on
  for (const x of rooms) await w.say(x, 'Can somebody come out tonight?');
  const n = (await w.DB.prepare("SELECT COUNT(*) AS n FROM call_taps WHERE client_id = 'c1' AND kind = 'ask'").first()).n;
  assert.ok(n <= T.TAP_PER_HOUR, n + ' questions went to Mike in the hour (limit ' + T.TAP_PER_HOUR + '); texts sent now: ' + w.world.ownerTexts.length);
}));

test('control: a call that starts once the hour is full gets no Shoulder Tap', async () => timed(async () => {
  const w = await mk();
  await T.ensureTaps(w.env);
  const now = new Date().toISOString();
  for (let i = 0; i < T.TAP_PER_HOUR; i++) await w.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) VALUES (?1, 'CAx', 'c1', 'ask', 'q?', ?2, 'timeout')").bind('tp' + i, now).run();
  w.world.aiScript = ['Okay.'];
  const x = await w.room(sidOf(960));
  await w.say(x, 'Can somebody come out tonight?');
  assert.doesNotMatch(w.prompt(), /\[ASK/);
}));
