// BUG: every limit on the audit email is "look, then send, then write it down", with the Google lookup and the send in
// between. Requests that arrive together all look before any of them has written anything down, so all of them send.
//   - one audit per address in 30 days      -> ten at once, ten emails to the same inbox
//   - three a day to one network (a /24)    -> thirty at once, thirty emails
//   - 80 a day in all, "whatever happens"   -> 120 at once, 120 emails
// Each one is also a paid Google lookup, a push and an email to Christopher.
//
// The same posts sent one after another are held exactly as designed (the control tests), so the limits themselves are
// right; it is only the gap between the check (leadmail.js auditHold) and the record (noteSend, mark) that lets a
// burst through. The harness is used as it is: requests are started together with Promise.all, the way a Worker serves
// requests that arrive together. On Cloudflare the gap is wider (D1, Google and the mail send are network calls).
//
// SEVERITY: high. The mail goes out from hello@alwaysopenoffice.com, the address every client email uses.
// CAUSE: auditHold reads the counts (src/leadmail.js:156-172; called at src/index.js:554 and src/leadmail.js:368);
//   the lookup and the send follow; only then is anything written (mark and noteSend, src/leadmail.js:394-395).
//   The per-sender count has the same shape (src/index.js:522-524, the insert is at 540).
// SMALLEST FIX: record before sending. In sendAudit, in place of the second auditHold call, one statement that
//   inserts the audit_sends row only if the counts still allow it (INSERT ... SELECT ... WHERE NOT EXISTS (this
//   address in 30 days) AND (this network today) < 3 AND (everyone today) < 80); go on only when it changed a row,
//   and delete the row if the send fails. D1 runs one statement atomically.
// NOT SHOWN: /audit/score has the same shape (count at src/audit.js:151-154, insert after the lookup at 157), but the
//   harness's Google answers without a real pause there, so its burst stays at 3. On Cloudflare that lookup takes
//   seconds.
//
// Run: node --test stress/prospect/burst-limits.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask } from './_kit.mjs';

const burst = async (s, n, make) => { await Promise.all(Array.from({ length: n }, (_, i) => ask(s, ...make(i)))); await s.client.settle(); };
const inOrder = async (s, n, make) => { for (let i = 0; i < n; i++) await ask(s, ...make(i)); };

// ---- one address ----
const sameAddress = i => [{ email: 'victim@example.org', business: 'Biz ' + i }, '203.0.' + i + '.9'];   // ten networks, one inbox
test('control: ten requests for one address, one after another: one audit email', async () => {
  const s = site();
  await inOrder(s, 10, sameAddress);
  assert.equal(s.out.length, 1);
});
test('ten requests for one address at the same moment: still one audit email', async () => {
  const s = site();
  await burst(s, 10, sameAddress);
  assert.equal(s.out.filter(m => m.to === 'victim@example.org').length, 1, 'one audit per address in 30 days');
});

// ---- one network ----
const oneNetwork = i => [{ email: 'stranger' + i + '@inbox' + i + '.example', business: 'Biz ' + i }, '198.51.100.' + (i + 1)];   // thirty machines on one /24
test('control: thirty strangers’ addresses from one network, one after another: three audit emails', async () => {
  const s = site();
  await inOrder(s, 30, oneNetwork);
  assert.equal(s.out.length, 3);
});
test('thirty strangers’ addresses from one network at the same moment: still three audit emails', async () => {
  const s = site();
  await burst(s, 30, oneNetwork);
  assert.ok(s.out.length <= 3, s.out.length + ' audit emails went to strangers from one network (the limit is 3 a day)');
});

// ---- one machine ----
// One sender, one address, using the form time the site itself hands out (GET /lead?t=1), as the real page does.
// Checking that signature is real work between "how many has this sender sent this hour?" and saving the request, so
// here the per-sender limit (five an hour) is passed in the same way. How many get through varies from run to run
// (it is a race), so three fresh tries are made and every one of them must stay inside the limits.
test('forty requests from one machine at the same moment: no more than three audit emails, five requests accepted', async () => {
  const tries = [];
  for (let n = 0; n < 3; n++) {
    const s = site();
    const stamp = (await s.client.call('/lead?t=1', { headers: { accept: 'application/json' } })).json().t;
    const back = (real => { Date.now = () => real() + 60000; return () => { Date.now = real; }; })(Date.now);   // a minute later
    try { await burst(s, 40, i => [{ email: 'stranger' + i + '@inbox' + i + '.example', business: 'Biz ' + i, t: stamp }, '198.51.100.20']); } finally { back(); }
    tries.push({ auditEmails: s.out.length, accepted: (await s.one("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'")).n });
  }
  assert.ok(tries.every(t => t.auditEmails <= 3 && t.accepted <= 5), 'three tries: ' + JSON.stringify(tries));
});

// ---- the day ----
const manyNetworks = i => [{ email: 'stranger' + i + '@inbox' + i + '.example', business: 'Biz ' + i }, '10.' + (i >> 8) + '.' + (i & 255) + '.7'];
test('control: 120 requests from 120 networks, one after another: 80 audit emails, the rest held for Christopher', async () => {
  const s = site();
  await inOrder(s, 120, manyNetworks);
  assert.equal(s.out.length, 80);
  assert.equal((await s.one("SELECT COUNT(*) AS n FROM leads WHERE audit = 'held: daily limit'")).n, 40);
});
test('120 requests from 120 networks at the same moment: still no more than 80 audit emails', async () => {
  const s = site();
  await burst(s, 120, manyNetworks);
  assert.ok(s.out.length <= 80, s.out.length + ' audit emails in one burst (the cap is 80 in 24 hours, "whatever happens")');
});
