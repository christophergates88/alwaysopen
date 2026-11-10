// BUG: a field tech (role "tech", "Tech (no money)" in the Team card) sees dollar amounts and can act on money.
// The rule in the code (src/app.js:183, src/biz.js:115): "techs never see money or billing".
// Run: node --test stress/owner/tech-sees-and-moves-money.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

const T = await boot();
let A, a, t, invoice, job;
const DOLLARS = /\$\s?\d/;

before(async () => {
  clock.set('2026-11-10T15:00:00Z');   // Tuesday 10 AM Eastern
  A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
  a = T.as(A.base);
  t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
  // The owner's own money: an invoice three weeks overdue, a quote to chase, a paid job.
  invoice = (await a.post('/api/invoice', { action: 'add', name: 'Ivy Invoice', amount: '1234.56', due: '2026-10-20', email: 'ivy@customer.example', payLink: 'https://pay.example.com/ivy' })).json().invoice;
  assert.equal((await a.post('/api/followup', { kind: 'invoice', name: 'Sam Money', phone: '478-555-0188', amount: '$4,321', due: '2026-11-09', note: 'second notice', by: 'Dana' })).status, 200);
  job = (await a.post('/api/work', { action: 'add', name: 'Jo Job', phone: '4785550111', title: 'Sink', amount: '5555' })).json().job.id;
  assert.equal((await a.post('/api/work', { action: 'stage', id: job, stage: 'paid' })).json().ok, true);
  clock.set('2026-11-10T15:10:00Z');
  await T.cron();   // the invoice timer drafts the "7 days past due" reminder for the owner to approve
  clock.set('2026-11-10T15:20:00Z');   // ten minutes later the tech opens the app
  assert.equal((await T.get("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND kind = 'invoice' AND status = 'pending'", A.cid)).n, 1, 'the reminder draft is waiting');
});

after(() => clock.restore());

test('what the tech is rightly kept from (so the role is on)', async () => {
  const st = await t.state();
  assert.equal(st.me.role, 'tech');
  assert.deepEqual([st.invoices, st.quotes, st.unpaid, st.jobTotals, st.billing], [[], [], 0, null, null]);
  assert.equal(st.jobs.find(j => j.id === job).amount, null);
  assert.equal((await t.post('/api/invoice', { action: 'paid', id: invoice.id })).status, 403);
});

test('the tech’s app state carries the invoice follow-up’s amount', async () => {
  const st = await t.state();
  const withMoney = st.followups.filter(f => DOLLARS.test(f.amount || ''));
  assert.deepEqual(withMoney.map(f => f.name + ' ' + f.amount), [], 'follow-up amounts reach the tech (shown on the Today card when due)');
});

test('the tech’s app state carries the invoice reminder waiting for approval, with the amount and the pay link', async () => {
  const st = await t.state();
  const seen = st.items.filter(i => i.kind === 'invoice').map(i => i.title);
  assert.deepEqual(seen, [], 'invoice reminders reach the tech as cards to approve');
});

test('the tech can approve that invoice reminder, and the customer is emailed', async () => {
  const mails = T.world.mail.length;
  const r = await t.post('/api/decide', { id: 'inv-' + invoice.id + '-7', action: 'approve' });
  const sent = T.world.mail.slice(mails).filter(m => m.to === 'ivy@customer.example');
  assert.deepEqual({ status: r.status, emailsToTheCustomer: sent.length }, { status: 403, emailsToTheCustomer: 0 },
    'a tech’s tap on an invoice reminder should be refused and nothing should go to the customer; it answered ' + r.text);
});

test('"This month’s page", linked from the tech’s Today screen, states what the jobs were worth', async () => {
  const st = await t.state();
  const page = (await t.get('/month/now')).text.replace(/<style[\s\S]*?<\/style>/g, '');
  const onPage = page.match(/[^<>]*\$\s?\d[\d,]*[^<>]*/);
  const inState = DOLLARS.test(String(st.monthNow && st.monthNow.insight)) ? st.monthNow.insight : null;
  assert.deepEqual({ onTheMonthPage: onPage && onPage[0], inAppState: inState }, { onTheMonthPage: null, inAppState: null }, 'dollar figures shown to the tech');
});

test('the tech can take a paid job back to "new", and delete it', async () => {
  const before = (await a.state()).jobTotals.paidMonth;
  assert.equal(before, 5555);
  const back = await t.post('/api/work', { action: 'stage', id: job, stage: 'new' });
  const after = (await a.state()).jobTotals.paidMonth;
  assert.equal(after, 5555, 'the owner’s "paid this month" must not move on a tech’s tap; it went from $' + before + ' to $' + after + ' (' + back.text + ')');
  const del = await t.post('/api/work', { action: 'delete', id: job });
  assert.ok(await T.get('SELECT id FROM biz_jobs WHERE id = ?1', job), 'a job with money on it must not be deletable by a tech (' + del.text + ')');
});
