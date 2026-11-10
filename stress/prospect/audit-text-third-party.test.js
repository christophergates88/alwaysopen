// BUG: the free audit by text goes to whatever call-back number the call note holds, not to the phone that called,
// and it carries the business name from the note unfiltered.
// voice.js line 1227 takes note.callback (a number the caller said out loud) ahead of the caller's own number, and
// ownLead hands that to leadmail.js textAudit. So one call to (706) 460-2226 that says "yes, text it to me, my cell is
// 478-555-0199" makes Always Open text 478-555-0199, a phone that never called and never agreed. The comment above
// ownLead says "nobody else is texted". The words between "audit for" and "you asked for" are the caller's too:
// auditText uses the business name as spoken, where the emails strip links and phone numbers from typed text
// (leadmail.js plain()).
//
// What the harness can and cannot show: the AI is faked, so the call note here is typed in by the test (world.aiNote).
// Whether the real model would write down every word a caller chooses is not something this run proves. What it does
// prove is what the Worker does with a note whose call-back number is not the caller's.
//
// SEVERITY: medium (one text per call, to a person who never agreed to be texted).
// CAUSE: src/voice.js:1227 and 1344-1346; src/leadmail.js:490-494 (auditText).
// SMALLEST FIX: text the audit only when the call-back number is the number that called; otherwise leave it to
//   Katie. Run the business name through plain() before it goes into the text.
//
// Run: node --test stress/prospect/audit-text-third-party.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, H } from './_kit.mjs';

const OWN = '+17064602226', CALLER = '+14045550111', STRANGER = '+14785550199';

async function callAlwaysOpen(s, note) {
  const { env, world, client } = s;
  await s.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('always-open', 'h0', 'Always Open', 1)").run();
  await s.DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, facts, updated) VALUES (?1, 'always-open', 'Always Open', 1, '', '{}', '2026-10-01')").bind(OWN).run();
  const hook = (kind, params) => client.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY, params) } });
  world.aiScript = ['Sure. What is your business called, and what town are you in?', 'I can text you a free audit of how your business looks on Google. Want it?', 'Done. Katie will follow up. [END]'];
  world.aiNote = note;
  const sid = 'CA' + '1'.padStart(32, '0');
  assert.equal((await hook('in', { CallSid: sid, To: OWN, From: CALLER })).status, 200);
  const room = env.CALLROOM.get(sid), w = env.CALLROOM._rooms.get(sid);
  await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from: CALLER }));
  const real = Date.now; Date.now = () => real() + 2500;
  try {
    for (const words of ['Hi, I heard about the free audit.', 'Yes, text it to me. My cell is four seven eight, five five five, zero one nine nine.', 'Yes please.'])
      await room.webSocketMessage(w.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  } finally { Date.now = real; }
  await hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' });
  await client.settle();
}
const NOTE = { name: 'Pat', reason: 'Wants the audit', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'Pat asked for the free audit by text.', town: 'Eatonton', kind: 'plumbing', plan: '', audit_text: true };

test('control: a caller who says yes gets the audit link on the phone they called from', async () => {
  const s = site();
  await callAlwaysOpen(s, Object.assign({}, NOTE, { callback: CALLER, business: 'Sinclair Plumbing' }));
  assert.deepEqual(s.world.texts.map(t => t.To), [CALLER]);
  assert.match(s.world.texts[0].Body, /free audit for Sinclair Plumbing you asked for on the call: https:\/\/alwaysopenoffice\.com\/your-audit\/[A-Za-z0-9]{16} /);
});

test('a number that did not call is not texted on a caller’s say-so', async () => {
  const s = site();
  await callAlwaysOpen(s, Object.assign({}, NOTE, { callback: STRANGER, business: 'Sinclair Plumbing' }));
  assert.deepEqual(s.world.texts.map(t => t.To).filter(to => to !== CALLER), [], 'a phone that never called Always Open was texted');
});

test('the text carries no phone number or web address of the caller’s choosing', async () => {
  const s = site();
  await callAlwaysOpen(s, Object.assign({}, NOTE, { callback: CALLER, business: 'FREE GIFT CARD waiting call 900-555-0100 or visit win.example' }));
  assert.equal(s.world.texts.length, 1);
  const extra = s.world.texts[0].Body.replace(/https:\/\/alwaysopenoffice\.com\/your-audit\/[A-Za-z0-9]{16}/, '').match(/900-555-0100|win\.example/g) || [];
  assert.deepEqual(extra, [], 'the emails strip links and phone numbers from what a stranger supplies (plain()); the text does not');
});
