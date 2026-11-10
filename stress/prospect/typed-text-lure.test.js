// BUG: the "one quick question" email quotes what was typed into the form, and the filter that is meant to make that
// safe ("one line, short, with no links and no phone numbers", leadmail.js plain(), lines 63-67) only knows a fixed
// list of endings (.com .net .org ...). A web address ending in anything else (.ru .cc .dev .uk ...) or an email
// address passes straight through. (So does a phone number written with letter O's, "4O4 555 O1OO"; no filter will
// catch every spelling, which is the argument for not quoting typed text to an unconfirmed address at all.)
// Anyone can type a stranger's address into the form, so anyone can make hello@alwaysopenoffice.com send that
// stranger: We looked on Google for “Refund waiting: claim at irs-refund.ru, today”.
// Mail apps turn a bare web address or email address into a tappable link. The cost lands on Always Open: its sending
// domain is the one reported for phishing, and it is the same domain every client email comes from.
// (Google finding nothing is the normal answer for made-up text; when it does find something, see wrong-business.)
//
// SEVERITY: medium.
// CAUSE: plain() (src/leadmail.js:63-67); the quote is built at src/leadmail.js:276-277.
// SMALLEST FIX: drop any word that contains a dot or an @ from the quote (.replace(/\S*[.@]\S*/g, ' ')), or do not
//   quote typed text to an address nobody has confirmed.
//
// Run: node --test stress/prospect/typed-text-lure.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask } from './_kit.mjs';

async function quoted(business, town) {
  const s = site();
  s.world.places = { places: [] };          // Google has no listing by that name
  await ask(s, { email: 'stranger@example.org', business, town });
  assert.equal(s.out.length, 1); assert.equal(s.out[0].to, 'stranger@example.org');
  return { text: (/“([^”]*)”/.exec(s.out[0].text) || [])[1] || '', html: s.out[0].html };
}

test('control: links and phone numbers the filter knows are taken out', async () => {
  const q = await quoted('WIN A FREE IPHONE at evil.com/claim', 'call 404-555-0100 now');
  assert.doesNotMatch(q.text + q.html, /evil\.com|404-555-0100/);
});

for (const [what, business, town, lure] of [
  ['a web address ending in .ru', 'Refund waiting: claim at irs-refund.ru', 'today', /irs-refund\.ru/],
  ['a web address ending in .dev', 'Verify your account at secure-login.dev', '', /secure-login\.dev/],
  ['an email address', 'Invoice overdue, write to billing@pay-desk.cc', '', /billing@pay-desk\.cc|pay-desk\.cc/],
]) {
  test('the email to a stranger’s address never carries ' + what, async () => {
    const q = await quoted(business, town);
    assert.doesNotMatch(q.text, lure, 'Always Open emailed a stranger: We looked on Google for “' + q.text + '”');
  });
}
