// BUG: an emoji that lands on a cut-off point stops the operator's email about the lead from being built at all.
// Field limits are applied with slice() (index.js clean(), and leadEmail's `notes.slice(0, 220)` for the email's
// "Their note" row). slice() counts UTF-16 units, so an emoji sitting across the limit is cut in half. rawEmail then
// calls encodeURIComponent on the text (neonmail.js lines 112 and 121), which throws "URI malformed" on half an
// emoji. In index.js mail() that call sits outside the try (lines 617-618), so:
//   - the email to Christopher about this lead is never sent, and leads.mail stays empty (nothing says it failed);
//   - the throw rejects the Promise.all handed to ctx.waitUntil (lines 558-563) at once, before the push and the audit
//     email, which share that promise, have gone out.
// Under Node the push and the audit still finish a moment later, because nothing cancels them. On Cloudflare a
// request's background work is only protected while its waitUntil promise is pending; the harness cannot show what
// the platform does with the work that is still in flight, so only the lost email and the early rejection are
// asserted here.
// A phone keyboard makes this easy: a note of a few lines with one emoji near the 220th character.
//
// SEVERITY: low (it takes an emoji in exactly the wrong place).
// SMALLEST FIX: move index.js lines 617-618 inside mail()'s try and send the plain text when the HTML cannot be
//   built; after each slice drop a trailing half emoji (.replace(/[\uD800-\uDBFF]$/, '')); give the push, the
//   operator email and the audit email their own ctx.waitUntil each, so one failing cannot end the others.
//
// Run: node --test stress/prospect/emoji-cut.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, sleep } from './_kit.mjs';

const LONG = 'We miss a lot of calls after five and on weekends, and I would love to know how we look on Google next to the two other shops in town. ';

test('control: a long note with an emoji that is not on the cut-off: Christopher gets the email', async () => {
  const s = site();
  await ask(s, { email: 'dana@example.com', notes: 'Thanks 👍 ' + LONG + LONG });
  assert.equal(s.world.mail.length, 1);
  assert.equal((await s.one('SELECT mail FROM leads')).mail, 'sent');
  assert.deepEqual((s.client.pending.errors || []).map(e => e.message), []);
});

test('a note with an emoji across its 220th character: Christopher still gets the email about the lead', async () => {
  const s = site();
  const notes = LONG.padEnd(219, '.') + '👍 thanks, talk soon';
  assert.equal(notes.slice(0, 220).length, 220);
  const r = await ask(s, { email: 'dana@example.com', notes });
  assert.equal(r.status, 200);
  await sleep(300);   // give anything still running every chance to finish
  const row = await s.one('SELECT status, mail FROM leads');
  assert.equal(row.status, 'new', 'control: the lead itself was saved as a real lead');
  assert.deepEqual((s.client.pending.errors || []).map(e => e.name + ': ' + e.message), [], 'the lead’s background work (push, operator email, audit email) was rejected as a whole');
  assert.equal(s.world.mail.length, 1, 'no email about this lead ever reached Christopher (leads.mail = ' + row.mail + ')');
});

test('a business name with an emoji across its 120th character: Christopher still gets the email about the lead', async () => {
  const s = site();
  const business = 'Sinclair Plumbing, Heating, Cooling, Drains, Water Heaters, Gas Lines and Remodeling of Eatonton and Lake Oconee'.slice(0, 119).padEnd(119, '.') + '🔧';
  assert.equal(business.length, 121, 'control: 119 characters, then one emoji (two UTF-16 units) across the 120 limit');
  const r = await ask(s, { email: 'dana@example.com', business });
  assert.equal(r.status, 200);
  await sleep(300);
  assert.equal(s.world.mail.length, 1, 'no email about this lead ever reached Christopher');
});
