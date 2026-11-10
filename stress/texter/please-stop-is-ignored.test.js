// BUG: common ways of saying stop are not taken as an opt-out, so the business keeps texting the person.
// What a real person sees: they get a review ask or a "Fill my week" offer and reply "Please stop" (or "Stop please",
// "Stop it"). Nothing changes: no opt-out is recorded, the text just lands in the owner's inbox, and the next review
// ask, past-customer note or offer still goes to them. A Spanish speaker who replies "ALTO", "BASTA" or "CANCELAR"
// (the usual Spanish opt-out words; Max answers Spanish callers on every line and the Spanish pages tell people to
// text the business) is ignored the same way. Twilio's own STOP handling only catches the bare English keywords, so
// nothing else catches these either.
// The tests below send the reply through the real text webhook, then try the next automatic text (a review ask).
// "Stop by after 3" and "Cancel my appointment Tuesday" correctly stay ordinary messages (control).
//
// CAUSE: src/sms.js:10-20. keywordOf only accepts a keyword that is the whole text (STOP_WORDS), or one of the phrases
//   in STOP_SAID; "please stop", "stop please", "stop it" and every Spanish word are in neither.
// SEVERITY: medium (people who asked to stop keep getting automatic texts; the FCC's consent-revocation rule treats a
//   reply using "stop" as a revocation).
// SMALLEST FIX: in keywordOf, after stripping punctuation, also accept the stop words with please/now/it around them
//   (a text made only of stop words plus please/now/it/thanks counts) and add the
//   Spanish words (alto, basta, parar, cancelar, detener, "no mas mensajes"/"no más mensajes") to STOP_WORDS.
//
// Run: node --test stress/texter/please-stop-is-ignored.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, SMS, clock } from './_kit.mjs';

// What the business tries to send next: an automatic review ask (kind 'review'), at 10 AM Eastern on a Tuesday.
async function reviewAsk(T, A, to) {
  return SMS.sendText(T.env, { clientId: A.cid, to, kind: 'review', tz: 'America/New_York', body: 'Thanks for letting Sinclair Plumbing help. A quick review means a lot: https://g.page/r/x Reply STOP to end texts.' });
}

async function replyThenAsk(said) {
  const T = boot();
  clock.set('2026-11-10T15:00:00Z');
  try {
    const A = await T.addClient({});
    const who = '+14785550188';
    await T.sms(A.number, who, said);
    const opted = await T.one('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2', A.cid, '4785550188');
    const r = await reviewAsk(T, A, who);
    return { opted: !!opted, r, T };
  } finally { clock.restore(); }
}

test('control: the bare keywords and the listed phrases opt out at once', async () => {
  for (const said of ['STOP', 'Stop.', 'stop!', 'UNSUBSCRIBE', 'cancel', 'quit', 'end', 'Stop texting me', 'Remove me from your list']) {
    const { opted, r } = await replyThenAsk(said);
    assert.equal(opted, true, '"' + said + '" was not recorded as an opt-out');
    assert.equal(r.why, 'opted out', '"' + said + '": the review ask was not stopped');
  }
});

test('control: "Stop by after 3" and "Cancel my appointment Tuesday" are messages for the owner, not opt-outs', async () => {
  for (const said of ['Stop by after 3', 'Cancel my appointment Tuesday']) {
    const { opted, r } = await replyThenAsk(said);
    assert.equal(opted, false);
    assert.equal(r.ok, true);
  }
});

for (const said of ['Please stop', 'Stop please', 'stop it', 'STOP STOP']) {
  test('"' + said + '" is taken as an opt-out', async () => {
    const { opted, r, T } = await replyThenAsk(said);
    assert.equal(opted, true, '"' + said + '" was saved as an ordinary inbox message; the review ask then ' + (r.ok ? 'went out to them' : 'was ' + r.why) + ' (' + T.sent().length + ' text sent)');
  });
}

for (const said of ['ALTO', 'Basta', 'Cancelar', 'No más mensajes']) {
  test('Spanish "' + said + '" is taken as an opt-out', async () => {
    const { opted, r } = await replyThenAsk(said);
    assert.equal(opted, true, '"' + said + '" did not opt them out; the next review ask ' + (r.ok ? 'went out' : 'was ' + r.why));
  });
}
