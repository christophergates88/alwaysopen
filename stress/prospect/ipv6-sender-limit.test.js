// BUG (small): "five requests per sender per hour" counts exact internet addresses (index.js lines 511 and 522-524).
// On IPv6 one home or one rented server owns a whole /64 (18 billion billion addresses) and can use a new one for
// every request, so for it there is no limit: every post is saved as a real lead and pushed and emailed to
// Christopher. The audit emails themselves stay capped (the network limit in leadmail.js netOf already treats an
// IPv6 block as one network); it is Christopher's phone, his inbox and the leads table that fill up.
//
// SEVERITY: low.
// SMALLEST FIX: for an address with a colon in it, count the sender by its first four groups (its /64), not the
//   whole address.
//
// Run: node --test stress/prospect/ipv6-sender-limit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask } from './_kit.mjs';

const junk = i => ({ name: 'Bot ' + i, email: 'bot' + i + '@junk' + i + '.example', business: 'Junk ' + i });

test('control: forty posts from one IPv4 address: five reach Christopher, the rest are dropped', async () => {
  const s = site();
  for (let i = 1; i <= 40; i++) await ask(s, junk(i), '203.0.113.50');
  assert.equal(s.world.mail.length, 5);
  assert.equal((await s.one("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'")).n, 5);
});

test('forty posts from one IPv6 customer (one /64): still five', async () => {
  const s = site();
  for (let i = 1; i <= 40; i++) await ask(s, junk(i), '2001:db8:aa:bb::' + i.toString(16));
  assert.ok(s.out.length <= 3, 'control: the audit emails stay capped at three for the network (' + s.out.length + ')');
  const got = { savedAsRealLeads: (await s.one("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'")).n, emailsToChristopher: s.world.mail.length, pushesToChristopher: s.world.pushes.length };
  assert.ok(got.emailsToChristopher <= 5, JSON.stringify(got));
});
