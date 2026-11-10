// BUG: the stop link in an emailed audit copy belongs to the lead row, not to the mailbox the copy went to.
// A private audit page (/your-audit/<token>: a caller's texted link, or the QR code on a mailed letter) emails a copy
// to whatever address is typed in, one a day. Every copy carries stopLink(env, lead.id) (leadmail.js line 575), and
// handleStop puts row.email on the do-not-email list (lines 429-431): the first address that ever asked for a copy.
// So when a second person at the business (the bookkeeper, the partner) gets a copy and taps "Don't email me again":
//   - they are shown "Done. No more emails." and are not on the list: the next request with their address emails them;
//   - the owner, who never asked to stop, is on the list for good.
//
// SEVERITY: medium (it needs two people asking for a copy of one audit, but then the opt-out is not honored).
// SMALLEST FIX: in handleStop also put on the list every address in audit_sends for that lead id (or sign the
//   recipient's address into the link and suppress that one).
//
// Run: node --test stress/prospect/copy-stop-wrong-address.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, clock } from './_kit.mjs';

const T0 = Date.parse('2026-10-26T14:00:00Z');
const TOKEN = 'AbCdEfGhJkMnPqRs';
const said = r => (/<p[^>]*>([^<]*)<\/p>/.exec(r.text) || [])[1];

test('control: when only one mailbox ever asked for a copy, its stop link stops that mailbox', async () => {
  const s = site();
  await L.ensureLeadMail(s.env);
  await s.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, origin, ip_hash, status, token, audit, audit_at) VALUES (?1, 'Dana', '', '+14785550101', 'Sinclair Plumbing', 'Eatonton', 'phone CAx', '', 'new', ?2, 'texted', ?1)").bind(new Date().toISOString(), TOKEN).run();
  await s.client.call('/your-audit/' + TOKEN, { ip: '198.51.100.30' });
  await s.client.call('/your-audit/' + TOKEN, { form: { email: 'owner@sinclair.example' }, ip: '198.51.100.30' });
  await s.client.call(/https:\/\/alwaysopenoffice\.com(\/lead\/stop\S+)/.exec(s.out[0].text)[1], { method: 'POST' });
  assert.equal(await L.suppressed(s.env, 'owner@sinclair.example'), true);
});

test('the person who taps "Don’t email me again" in an audit copy is the one who is never emailed again', async () => {
  const s = site();
  let back = clock(T0);
  try {
    await L.ensureLeadMail(s.env);
    // A caller said yes to the audit by text; this is the row and the link textAudit makes.
    await s.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, origin, ip_hash, status, token, audit, audit_at) VALUES (?1, 'Dana', '', '+14785550101', 'Sinclair Plumbing', 'Eatonton', 'phone CAx', '', 'new', ?2, 'texted', ?1)").bind(new Date(T0).toISOString(), TOKEN).run();
    const page = '/your-audit/' + TOKEN;
    await s.client.call(page, { ip: '198.51.100.30' });
    assert.match(said(await s.client.call(page, { form: { email: 'owner@sinclair.example' }, ip: '198.51.100.30' })), /A copy is on its way to owner@sinclair\.example/);
    back(); back = clock(T0 + 25 * 3600e3);       // the next day the owner forwards the link; the bookkeeper asks for a copy too
    assert.match(said(await s.client.call(page, { form: { email: 'bookkeeper@other.example' }, ip: '198.51.100.31' })), /A copy is on its way to bookkeeper@other\.example/);
    assert.deepEqual(s.out.map(m => m.to), ['owner@sinclair.example', 'bookkeeper@other.example'], 'control: two copies, two mailboxes');
    // The bookkeeper taps the stop link in the copy they received.
    const stop = /https:\/\/alwaysopenoffice\.com(\/lead\/stop\S+)/.exec(s.out[1].text)[1];
    const done = await s.client.call(stop, { method: 'POST' });
    assert.match(done.text, /Done\. No more emails\./, 'control: they are told it worked');
    // Today the owner (who never asked) is on the list and the bookkeeper (who did) is not. Only the second half is
    // asserted: the mailbox that tapped the link must be on the list, whatever else a fix decides about the owner.
    const owner = await L.suppressed(s.env, 'owner@sinclair.example');
    assert.equal(await L.suppressed(s.env, 'bookkeeper@other.example'), true,
      'the mailbox that tapped "Don’t email me again" is not on the do-not-email list' + (owner ? '; the owner, who never asked, is' : ''));
  } finally { back(); }
});

test('and that mailbox gets no audit email when it is typed into the website form later', async () => {
  const s = site();
  let back = clock(T0);
  try {
    await L.ensureLeadMail(s.env);
    await s.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, origin, ip_hash, status, token, audit, audit_at) VALUES (?1, 'Dana', '', '+14785550101', 'Sinclair Plumbing', 'Eatonton', 'phone CAx', '', 'new', ?2, 'texted', ?1)").bind(new Date(T0).toISOString(), TOKEN).run();
    const page = '/your-audit/' + TOKEN;
    await s.client.call(page, { ip: '198.51.100.30' });
    await s.client.call(page, { form: { email: 'owner@sinclair.example' }, ip: '198.51.100.30' });
    back(); back = clock(T0 + 25 * 3600e3);
    await s.client.call(page, { form: { email: 'bookkeeper@other.example' }, ip: '198.51.100.31' });
    await s.client.call(/https:\/\/alwaysopenoffice\.com(\/lead\/stop\S+)/.exec(s.out[1].text)[1], { method: 'POST' });
    back(); back = clock(T0 + 40 * 864e5);
    await ask(s, { email: 'bookkeeper@other.example', business: 'Other Co' }, '192.0.2.5');
    assert.equal(s.out.filter(m => m.to === 'bookkeeper@other.example').length, 1, 'the mailbox that tapped "Don’t email me again" was sent another marketing email');
  } finally { back(); }
});
