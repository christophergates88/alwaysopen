// BUG: a Starter account ($149) gets tools the site sells only with Pro ($499).
//   1. Invoice and payment reminders. /api/invoice refuses a Starter owner ("Invoice reminders come with the Pro plan"),
//      but /api/quote lets the same owner write an estimate and turn it into an invoice. The every-10-minutes job then
//      drafts the reminder like for any Pro invoice, and one tap sends it to the customer.
//   2. Call-backs kept by Max ("Call-backs with a time on them. If you miss it, Max calls them to set a new one" is on
//      the Pro card of public/index.html). On a Starter line Max names a time just the same, and when the owner misses
//      it the job has Max phone the customer: an outbound call we pay for, on a plan that does not include it.
// Cause: src/biz.js:259-275 (the 'invoice' action of apiQuote has no features(c).invoices check; the route at
//        src/app.js:282 has none either), src/extras.js:181 (invoiceCron takes every active client's open invoices),
//        src/app.js:847 (approve sends it); src/voice.js:1262 and src/callbacks.js:381-403 (no plan check anywhere).
// Also run, with no failing test here because test/plangates.test.js states it as intended: a Growth account's finished
// job with "OK to call" gets the three-day check-in call, and a Starter account can switch hand-offs on (/api/handoff).
// The pricing page lists both under Pro. Either the page or the gates should change.
// Severity: medium to low. Free service, and outbound calls we pay for.
// Smallest fix: if (!features(c).invoices) return 403 in the 'invoice' action of apiQuote; decide for call-backs,
// check-ins and hand-offs whether the gate or the pricing page is right.
// Run: node --test stress/money/08-starter-gets-pro-tools.test.js   (1 control passes, 2 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';

const ck = clock('2026-11-10T15:00:00Z');   // Tuesday, 10 AM Eastern
after(() => ck.restore());
const w = await boot();
const c = await w.signup({ plan: 'Starter' });
const post = (path, json) => w.site.call(c.A(path), { json });

test('control: the account is Starter and the Pro doors that are checked stay shut', async () => {
  const st = (await w.site.call(c.A('/api/state'))).json();
  assert.deepEqual([st.client.tier, st.features.invoices, st.features.followups, st.features.textback], ['Starter', false, false, false]);
  const r = await post('/api/invoice', { action: 'add', name: 'Joe Hart', amount: '1850', due: '2026-11-12', email: 'joe@example.com', payLink: 'https://pay.example.com/x' });
  assert.equal(r.status, 403);
  assert.equal(r.json().error, 'Invoice reminders come with the Pro plan.');
  assert.equal((await post('/api/followup', { kind: 'invoice', name: 'Joe Hart', phone: '4785550100', due: '2026-11-12' })).status, 403);
});

test('BUG 1: an estimate turned into an invoice must not bring the Pro invoice reminders with it', async () => {
  const q = await post('/api/quote', { action: 'add', name: 'Joe Hart', email: 'joe@example.com', items: [{ desc: 'Water heater', qty: 1, price: 1850 }] });
  assert.equal(q.status, 200, 'estimates are open to every plan');
  const inv = await post('/api/quote', { action: 'invoice', id: q.json().quote.id, due: '2026-11-12', payLink: 'https://pay.example.com/x' });
  ck.set('2026-11-16T15:00:00Z');   // four days past due
  await w.cron();
  const drafts = (await w.all("SELECT id, title FROM app_items WHERE client_id = ?1 AND kind = 'invoice'", c.cid)).map(r => r.id + ': ' + r.title);
  const mails = w.world.mail.length;
  const ok = drafts.length ? await post('/api/decide', { id: drafts[0].split(':')[0], action: 'approve' }) : null;
  await w.site.settle();
  const sent = w.world.mail.slice(mails).map(m => m.to + ' <- ' + (m.raw.match(/Subject: (.*)/) || [])[1]);
  assert.deepEqual({ turnedIntoInvoice: inv.status, reminderDrafted: drafts, approve: ok && ok.status, sentToCustomer: sent }, { turnedIntoInvoice: inv.status, reminderDrafted: [], approve: null, sentToCustomer: [] },
    'a $149 account just sent a Pro invoice reminder');
});

test('BUG 2: on Starter, Max does not place the Pro call-back call when the owner misses the time', async () => {
  ck.set('2026-11-17T15:00:00Z');
  w.world.aiScript = ['He is on a job. He will call you back at the time I gave. [END]'];
  w.world.aiNote = { name: 'Gus', callback: '+14785550182', reason: 'Leaking pipe', details: '', when: '', urgent: false, callback_wanted: true, callback_at: '', booked: '', spam: false, summary: 'Gus wants a call back about a leaking pipe.' };
  const sid = w.newSid();
  await w.hook('in', { CallSid: sid, To: c.number, From: '+14785550182' });
  await w.openRoom(sid, '+14785550182');
  await w.say(sid, 'Hi, this is Gus. I have a leaking pipe, can he call me back?');
  await w.hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' });
  await w.site.settle();
  const cb = await w.get('SELECT due_at, status FROM callbacks WHERE client_id = ?1', c.cid);
  if (cb) { ck.set(Date.parse(cb.due_at) + 25 * 60e3); await w.cron(); }
  const dials = w.world.dialed.filter(d => /\/voice\/out\//.test(d.Url)).map(d => d.To);
  assert.deepEqual(dials, [], 'Max phoned the customer to set a new time for a Starter account (sold as Pro on the pricing page)');
});
