// BUG: a reply is the second way to opt out, and it is not kept.
//   1. The site's own words (the page a broken stop link shows, leadmail.js bad()): "Reply to any of our emails with
//      “stop” and we won’t email you again." A reply only marks the lead rows that exist today (mailin.js leadReplied);
//      the address never goes on the do-not-email list (mail_suppress). The next time that address is typed into the
//      form, 31 or more days later, it gets another audit email. The stop link, by contrast, is for good.
//   2. leadReplied only accepts addresses made of a-z 0-9 . _ % + -. The form accepts more (validEmail allows
//      o'brien@..., dana&sons@..., josé@...), so a reply from one of those leads stops nothing and the follow-ups go on.
//
// SEVERITY: medium.
// CAUSE: src/mailin.js:240 (the narrow pattern) and 245 (rows only; nothing written to mail_suppress). The promise
//   is at src/leadmail.js:421.
// SMALLEST FIX: in leadReplied test the address with leadmail's validEmail, and also INSERT OR IGNORE INTO
//   mail_suppress (at least when the reply begins with stop, unsubscribe or remove).
//
// Run: node --test stress/prospect/reply-stop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, worker, clock } from './_kit.mjs';

// An email arriving at hello@alwaysopenoffice.com, as Cloudflare hands it to the Worker's email() handler.
const inbound = (s, raw) => worker.email({ rawSize: raw.length, raw: new Response(raw).body, forward: async () => {} }, s.env, s.client.ctx);
const MON_10AM = Date.parse('2026-10-26T14:00:00Z');

test('control: a reply from the lead stops the follow-ups already queued', async () => {
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  await inbound(s, 'From: Dana Whitfield <dana@example.com>\r\nTo: hello@alwaysopenoffice.com\r\nSubject: Re: Your free audit\r\n\r\nSTOP');
  assert.equal((await s.one('SELECT stop FROM leads')).stop, 'replied');
});

test('an address that replied STOP is not emailed again when it is typed into the form later', async () => {
  const s = site();
  let back = clock(MON_10AM);
  try {
    await ask(s, { email: 'dana@example.com' });
    assert.equal(s.out.length, 1);
    back(); back = clock(MON_10AM + 3600e3);
    await inbound(s, 'From: Dana Whitfield <dana@example.com>\r\nTo: hello@alwaysopenoffice.com\r\nSubject: Re: Your free audit: Sinclair Plumbing gets a C\r\n\r\nSTOP. Do not email me again.');
    back(); back = clock(MON_10AM + 40 * 864e5);              // forty days on, anyone types the address into the form
    await ask(s, { email: 'dana@example.com', business: 'Sinclair Plumbing' }, '192.0.2.9');
    assert.equal(await L.suppressed(s.env, 'dana@example.com'), true, 'a reply of STOP did not put the address on the do-not-email list');
    assert.equal(s.out.length, 1, 'a second marketing email went to an address that had replied STOP');
  } finally { back(); }
});

for (const addr of ["sean.o'brien@example.org", 'dana&sons@example.org', 'josé@ejemplo.example']) {
  test('a reply from ' + addr + ' (an address the form accepts) stops their follow-ups', async () => {
    const s = site();
    const r = await ask(s, { email: addr });
    assert.equal(r.status, 200); assert.equal(s.out.length, 1, 'control: the form took the address and emailed the audit to it');
    await inbound(s, 'From: <' + addr + '>\r\nTo: hello@alwaysopenoffice.com\r\nSubject: Re: Your free audit\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNot interested, please stop.');
    assert.equal((await s.one('SELECT stop FROM leads')).stop || '', 'replied', 'the reply was ignored, so the day-2 and day-6 follow-ups still go');
  });
}
