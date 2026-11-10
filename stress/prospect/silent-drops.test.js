// BUG: two spam rules throw real requests away without a trace, and tell the owner the opposite.
//   1. More than two "http(s)://" in the note (index.js line 519). This is the one business where a prospect pastes
//      links: their website, their Google listing and their Facebook page are what they want looked at.
//   2. The sixth request in an hour from one internet address (index.js lines 522-524). One address is not one person:
//      a shared office, a co-working space, or the Wi-Fi at an event where Always Open is being shown.
// In both cases the row is saved as spam, nothing is pushed or emailed to Christopher, it is not in /leads, and the
// page says "Your free audit is on its way to your inbox now, and Katie follows up within one business day."
// Neither thing happens, and nobody ever knows.
// Everything else that looks odd but may be real (a form sent too fast, a stale form, no form time) is "held for a
// look" and reaches Christopher quietly. These two are not.
//
// SEVERITY: medium (each one is a lost lead who believes help is coming).
// CAUSE: src/index.js:519 and 522-524 set `reason`, which skips every notification (line 557) and still returns the
//   full promise (lines 570-573).
// SMALLEST FIX: treat "links in note" the way timing is treated (held for a look: quiet push and email, no audit
//   email, the honest answer). For the per-sender limit, answer plainly ("That is a lot of requests from here. Call
//   (706) 460-2226.") instead of the promise.
//
// Run: node --test stress/prospect/silent-drops.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask } from './_kit.mjs';

const told = s => s.world.pushes.length + s.world.mail.length;
const NOTE = 'We miss most calls after 5. Here is where to look: our site https://sinclairplumbing.example our Google listing https://maps.google.com/?cid=123456 and our Facebook page https://facebook.com/sinclairplumbing';

test('control: the same request with two links reaches Christopher and gets its audit', async () => {
  const s = site();
  const r = await ask(s, { email: 'dana@sinclairplumbing.example', phone: '(478) 555-0101', notes: NOTE.replace(/ and our Facebook page \S+/, '') });
  assert.match(r.json().message, /on its way/);
  assert.equal(s.out.length, 1); assert.ok(told(s) >= 2);
  assert.equal((await s.one('SELECT status FROM leads')).status, 'new');
});

test('control: a bot that fills the hidden field is dropped quietly, as designed', async () => {
  const s = site();
  await s.client.call('/lead', { form: { name: 'Bot', email: 'bot@example.org', company_site: 'https://spam.example', t: String(Date.now() - 60000) }, headers: { accept: 'application/json' } });
  assert.equal(told(s), 0); assert.equal(s.out.length, 0);
});

test('an owner who pastes their website, Google listing and Facebook page still reaches Christopher', async () => {
  const s = site();
  const r = await ask(s, { email: 'dana@sinclairplumbing.example', phone: '(478) 555-0101', notes: NOTE });
  assert.equal(r.status, 200);
  const row = await s.one('SELECT status, reason FROM leads');
  assert.match(r.json().message, /on its way to your inbox now, and Katie follows up/, 'control: the owner is told an audit is coming and Katie will follow up');
  assert.equal(s.out.length + told(s) > 0, true,
    'the owner was promised an audit and a call; no audit went out, and Christopher got no push and no email (row: ' + row.status + ', "' + row.reason + '")');
});

test('seven owners on one Wi-Fi inside an hour: every one of them reaches Christopher', async () => {
  const s = site();
  const answers = [];
  for (let i = 1; i <= 7; i++) answers.push((await ask(s, { name: 'Owner ' + i, email: 'owner' + i + '@shop' + i + '.example', business: 'Shop ' + i, phone: '478-555-01' + (10 + i) }, '203.0.113.50')).json().message);
  const heard = new Set(s.world.pushes.map(p => (/^Always Open lead(?: to check)?: (Shop \d)/.exec(p.title) || [])[1]).filter(Boolean));
  assert.ok(heard.has('Shop 4') && heard.has('Shop 5'), 'control: the 4th and 5th (over the network’s three audit emails a day) are held and Christopher is told');
  const lost = [6, 7].filter(i => !heard.has('Shop ' + i)).map(i => 'Shop ' + i + (/on its way/.test(answers[i - 1]) ? ' (told: your free audit is on its way)' : ''));
  assert.deepEqual(lost, [], 'these owners were never passed on to Christopher by push or email');
});
