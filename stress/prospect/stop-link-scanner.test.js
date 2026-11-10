// BUG: the "Don't email me again" link acts on any request to it: a plain GET, even a HEAD. Mail security scanners
// (and link-preview fetchers) open every link in a message the moment it lands. The click-through link already knows
// this ("a click within two minutes of sending is a mail scanner, not a person", leadmail.js ENGAGED_AFTER); the stop
// link does not. So for a lead behind such a scanner, the audit email unsubscribes itself on arrival:
//   - the lead is marked "unsubscribed" and the address goes on the do-not-email list for good,
//   - the two follow-ups never go, even after the person clicks "Start my first month",
//   - and a later request from the same person gets no audit ("this address asked us not to email it").
//
// SEVERITY: high (the follow-ups are the sales path, and the lead shows in the pipeline as someone who opted out).
// CAUSE: handleStop never looks at the request method (src/leadmail.js:416-433).
// SMALLEST FIX: act only on POST. On GET show the same page with one button ("Stop these emails") that posts to
//   the same address; answer HEAD without doing anything.
//
// Run: node --test stress/prospect/stop-link-scanner.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, clock } from './_kit.mjs';

const MON_10AM = Date.parse('2026-10-26T14:00:00Z');   // a Monday, 10 AM Eastern
const linksIn = m => [...new Set([...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, '&')).concat([...m.text.matchAll(/https:\/\/\S+/g)].map(x => x[0])))]
  .filter(u => new URL(u).hostname === 'alwaysopenoffice.com').map(u => { const x = new URL(u); return x.pathname + x.search; });

test('a mail scanner opening every link in the audit email does not unsubscribe the lead', async () => {
  const s = site();
  let back = clock(MON_10AM);
  try {
    await ask(s, { email: 'owner@scanned.example' });
    assert.equal(s.out.length, 1);
    const links = linksIn(s.out[0]);
    assert.ok(links.some(l => l.startsWith('/lead/stop')) && links.some(l => l.startsWith('/lead/go')), 'the email carries a stop link and click-through links');
    back(); back = clock(MON_10AM + 5000);                       // five seconds after delivery
    for (const l of links) await s.client.call(l);              // the scanner: one GET each, nothing else
    const row = await s.one('SELECT stop, engaged FROM leads WHERE email = ?1', 'owner@scanned.example');
    assert.equal(row.engaged || '', '', 'control: the scanner’s click on Start is not taken for a person');
    assert.equal(row.stop || '', '', 'but its fetch of the stop link was taken for a person asking to stop');
    assert.equal(await L.suppressed(s.env, 'owner@scanned.example'), false, 'and the address went on the do-not-email list');
  } finally { back(); }
});

test('the follow-up still reaches a lead whose mail was scanned, once the person clicks through', async () => {
  const s = site();
  let back = clock(MON_10AM);
  try {
    await ask(s, { email: 'owner@scanned.example' });
    const links = linksIn(s.out[0]);
    back(); back = clock(MON_10AM + 5000);
    for (const l of links) await s.client.call(l);              // the scanner
    back(); back = clock(MON_10AM + 20 * 60e3);
    await s.client.call(links.find(l => /to=start/.test(l)));   // the owner, twenty minutes later, taps Start my first month
    assert.ok((await s.one('SELECT engaged FROM leads')).engaged, 'control: the owner’s own click counts');
    back(); back = clock(MON_10AM + 2 * 864e5);                 // Wednesday 10 AM: follow-up 1 is due
    const r = await L.followCron(s.env);
    assert.deepEqual(r, { sent: 1, stopped: 0 }, 'the day-2 follow-up should go to a lead who clicked through and never asked to stop');
  } finally { back(); }
});

test('a HEAD request to the stop link changes nothing', async () => {
  const s = site();
  await ask(s, { email: 'owner@scanned.example' });
  const stop = linksIn(s.out[0]).find(l => l.startsWith('/lead/stop'));
  const r = await s.client.call(stop, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal((await s.one('SELECT stop FROM leads')).stop || '', '', 'a HEAD (no page is even read) unsubscribed the lead');
});

test('control: a deliberate one-click unsubscribe (a POST, what mail apps send) still stops everything', async () => {
  const s = site();
  await ask(s, { email: 'owner@scanned.example' });
  const stop = linksIn(s.out[0]).find(l => l.startsWith('/lead/stop'));
  await s.client.call(stop, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await s.one('SELECT stop FROM leads')).stop, 'unsubscribed');
  assert.equal(await L.suppressed(s.env, 'owner@scanned.example'), true);
});
