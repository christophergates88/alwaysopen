// What was attacked and held. These PASS. They are here so "what held up" can be re-run, and so a fix for one of the
// failing files next to this one (01 to 09) can be checked against the things that already work.
// Run: node --test stress/money/held-up.test.js   (12 pass)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { boot, clock, CUSTOMER, DAY, H } from './_h.mjs';
const F = await import('../../src/facts.js');

const ck = clock('2026-01-05T15:00:00Z');
after(() => ck.restore());
const w = await boot();
const sign = (secret, body, t) => 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');
const status = async c => { const b = await w.get('SELECT status, plan, max FROM billing WHERE client_id = ?1', c.cid), a = await w.get('SELECT tier, active FROM app_clients WHERE client_id = ?1', c.cid), l = await w.get('SELECT on_air FROM voice_lines WHERE client_id = ?1', c.cid); return [b.status, b.plan, b.max, a.tier, a.active, l.on_air]; };
const paid = (cust, id, when, reason) => ({ id, customer: cust, status: 'paid', amount_paid: 14900, attempt_count: 1, billing_reason: reason, created: Math.floor(Date.parse(when) / 1000), status_transitions: { paid_at: Math.floor(Date.parse(when) / 1000) }, charge: { id: 'ch_' + id, amount_refunded: 0, disputed: false } });

test('Stripe webhook: a forged event, a wrong secret and a correctly signed event more than five minutes old are all refused', async () => {
  const secret = await w.secret();
  const body = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { id: 'cs_evil', mode: 'subscription', metadata: { plan: 'Pro', business: 'Evil Co' } } } });
  const now = Math.floor(Date.now() / 1000);
  for (const [sig, want] of [['t=1,v1=deadbeef', 400], [sign('whsec_wrong', body, now), 400], [sign(secret, body, now - 301), 400], [sign(secret, body, now + 301), 400], ['', 400]]) {
    assert.equal((await w.site.call('/billing/webhook', { body, headers: { 'stripe-signature': sig } })).status, want, sig.slice(0, 20));
  }
  assert.equal((await w.all("SELECT 1 FROM billing WHERE business = 'Evil Co'")).length, 0);
});

test('checkout: the price is the plan\'s price whatever else the form says; the extra-minutes line only with max=1', async () => {
  const sent = async form => { await w.site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, form) }); const b = w.S.log.filter(l => l.path === 'checkout/sessions').at(-1).body; return Object.keys(b).filter(k => /unit_amount|quantity/.test(k)).map(k => b[k]).join(','); };
  assert.equal(await sent({ plan: 'Pro', price: '1', unit_amount: '1', quantity: '-5', 'line_items[0][price_data][unit_amount]': '1' }), '49900,1');
  assert.equal(await sent({ plan: 'Starter', max: '1' }), '14900,1,5900,1');
  assert.equal(await sent({ plan: 'Starter', max: '2' }), '14900,1');
  assert.equal(await sent({ plan: 'pro' }), '29900,1', 'an unknown plan is Growth at Growth\'s price');
});

let c;
test('the same paid checkout arriving three times and the welcome page make one client, one number', async () => {
  c = await w.signup({ plan: 'Growth', max: '1' });
  for (let i = 0; i < 2; i++) assert.equal((await w.event('checkout.session.completed', c.session)).status, 200);
  assert.equal((await w.site.call('/welcome?s=' + c.sessionId)).status, 200);
  assert.equal((await w.all('SELECT 1 FROM billing')).length, 1);
  assert.equal((await w.all('SELECT 1 FROM app_clients')).length, 1);
  assert.equal(w.world.bought.length, 1);
  assert.deepEqual(await status(c), ['active', 'Growth', 1, 'Growth', 1, 1]);
});

test('events for a subscription nobody here has change nothing; failed then paid goes past_due then active with service kept', async () => {
  for (const [type, o] of [['invoice.payment_failed', { subscription: 'sub_unknown' }], ['invoice.paid', { subscription: 'sub_unknown' }], ['customer.subscription.updated', { id: 'sub_unknown', status: 'active' }], ['customer.subscription.deleted', { id: 'sub_unknown' }], ['invoice.paid', {}], ['charge.refunded', { id: 'ch_x' }]]) assert.equal((await w.event(type, o)).status, 200, type);
  assert.deepEqual(await status(c), ['active', 'Growth', 1, 'Growth', 1, 1]);
  await w.event('invoice.payment_failed', { subscription: c.sub, billing_reason: 'subscription_cycle' });
  assert.deepEqual(await status(c), ['past_due', 'Growth', 1, 'Growth', 1, 1]);
  await w.event('invoice.paid', { subscription: c.sub, billing_reason: 'subscription_cycle' });
  assert.deepEqual(await status(c), ['active', 'Growth', 1, 'Growth', 1, 1]);
});

test('a plan or add-on changed in Stripe reaches the app both ways, and the gates follow it', async () => {
  const sub = w.S.subs.get(c.sub);
  sub.items.data[0].price = { unit_amount: 49900, recurring: { interval: 'month' }, product: { id: 'p', name: 'Always Open Pro' } };
  await w.event('customer.subscription.updated', w.subObj(c.sub));
  assert.deepEqual(await status(c), ['active', 'Pro', 1, 'Pro', 1, 1]);
  const add = () => w.site.call(c.A('/api/invoice'), { json: { action: 'add', name: 'Joe', amount: '100', due: '2026-02-01', email: 'joe@example.com', payLink: 'https://pay.example.com/x' } });
  assert.equal((await add()).status, 200);
  sub.items.data[0].price = { unit_amount: 14900, recurring: { interval: 'month' }, product: { id: 'p', name: 'Always Open Starter' } };
  sub.items.data.length = 1;
  await w.event('customer.subscription.updated', w.subObj(c.sub));
  assert.deepEqual(await status(c), ['active', 'Starter', 0, 'Starter', 1, 1]);
  assert.equal((await add()).status, 403);
});

test('minutes: last month\'s overage is put on the Stripe invoice once however many times the job runs; a cancelled client is invoiced on its own', async () => {
  const gone = await w.signup({ plan: 'Starter', business: 'Gone Roofing', phone: '(706) 555-0155', email: 'gone@example.com' });
  let n = 0;
  for (const x of [c, gone]) for (let i = 0; i < 32; i++) await w.run("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, seconds, relay_seconds, test) VALUES (?1, ?2, ?3, ?4, '+14785550142', 'done', 600, 600, 0)", 'CA' + (++n).toString(16).padStart(32, '0'), x.cid, x.number, new Date(Date.UTC(2026, 0, 6 + (i % 20), 14, i)).toISOString());
  ck.set('2026-01-28T15:00:00Z');
  w.S.subs.get(gone.sub).status = 'canceled';
  await w.event('customer.subscription.deleted', { id: gone.sub });
  ck.set('2026-02-01T23:50:00Z'); await w.cron();
  assert.equal(w.S.invoiceItems.length, 0, 'nothing on the 1st');
  for (const t of ['2026-02-02T00:00:00Z', '2026-02-02T00:10:00Z', '2026-02-03T12:00:00Z', '2026-02-20T12:00:00Z']) { ck.set(t); await w.cron(); }
  assert.deepEqual(w.S.invoiceItems.map(i => [i.customer, i.amount, i.description]).sort(), [[c.customer, 500, 'Max minutes past 300 in 2026-01: 20 minutes at 25¢'], [gone.customer, 500, 'Max minutes past 300 in 2026-01: 20 minutes at 25¢']].sort());
  assert.deepEqual(w.S.invoices.filter(i => i.made_by_worker).map(i => [i.customer, i.status]), [[gone.customer, 'open']], 'the cancelled client has no next invoice, so theirs is finalized now, once');
});

test('referrals: who is refused at sign-up, who is refused later, and one credit for the one who qualifies', async () => {
  ck.set('2026-03-01T15:00:00Z');
  const R = await w.signup({ plan: 'Growth', business: 'Referrer Plumbing', owner: 'Rae Ref', phone: '(478) 555-0131', email: 'rae@referrer.example' });
  const ref = (await w.get('SELECT ref FROM app_clients WHERE client_id = ?1', R.cid)).ref;
  ck.set('2026-03-05T15:00:00Z');
  const friend = (n, o) => w.signup(Object.assign({ plan: 'Starter', business: 'Friend ' + n + ' Electric', owner: 'Pat ' + n, phone: '(706) 555-02' + String(n).padStart(2, '0'), email: 'pat@friend' + n + '.example', town: 'Madison, GA', ref }, o || {}));
  const f = {
    sameEmail: await friend(1, { email: 'RAE@referrer.example' }), samePhone: await friend(2, { phone: '+1 478.555.0131' }), sameName: await friend(3, { business: 'Referrer-Plumbing!' }), sameDomain: await friend(4, { email: 'office@referrer.example' }),
    appCode: await friend(5, { ref: R.code }), good: await friend(6), sameCard: await friend(7), refunded: await friend(8), disputed: await friend(9), retried: await friend(10), left: await friend(11), twoMonths: await friend(12)
  };
  const row = async x => { const r = await w.get('SELECT status, note FROM referrals WHERE referred_id = ?1', x.cid); return r ? r.status + (r.note ? ': ' + r.note : '') : 'none'; };
  assert.deepEqual([await row(f.sameEmail), await row(f.samePhone), await row(f.sameName), await row(f.sameDomain), await row(f.appCode), await row(f.good)], ['void: same email', 'void: same phone', 'void: same business name', 'void: same email domain', 'none', 'pending']);
  for (const x of Object.values(f)) w.S.invoices.push(paid(x.customer, 'in1_' + x.cid, '2026-03-05T15:00:00Z', 'subscription_create'), paid(x.customer, 'in2_' + x.cid, '2026-04-05T15:00:00Z', 'subscription_cycle'), paid(x.customer, 'in3_' + x.cid, '2026-05-05T15:00:00Z', 'subscription_cycle'));
  const inv = (x, k) => w.S.invoices.find(i => i.id === 'in' + k + '_' + x.cid);
  w.S.cards.set(R.customer, ['fp_1']); w.S.cards.set(f.sameCard.customer, ['fp_1']);
  inv(f.refunded, 1).charge.amount_refunded = 14900; inv(f.disputed, 2).charge.disputed = true; inv(f.retried, 2).attempt_count = 2;
  w.S.invoices.splice(w.S.invoices.indexOf(inv(f.twoMonths, 3)), 1);
  ck.set('2026-04-10T15:00:00Z'); w.S.subs.get(f.left.sub).status = 'canceled'; await w.event('customer.subscription.deleted', { id: f.left.sub });
  ck.set('2026-04-20T18:05:00Z'); await w.cron();
  assert.equal(w.S.balanceTx.filter(t => t.customer === R.customer).length, 0, 'nothing before the wait is over (day 46, two months paid)');
  for (const t of ['2026-05-05T18:05:00Z', '2026-05-06T00:05:00Z', '2026-05-06T18:05:00Z', '2026-05-07T18:05:00Z']) { ck.set(t); await w.cron(); }
  assert.deepEqual([await row(f.good), await row(f.sameCard), await row(f.refunded), await row(f.disputed), await row(f.retried), await row(f.left), await row(f.twoMonths)],
    ['credited', 'void: same card', 'void: refunded', 'void: chargeback', 'void: payment failed', 'void: left before qualifying', 'pending']);
  assert.deepEqual(w.S.balanceTx.filter(t => t.customer === R.customer).map(t => t.amount), [-29900], 'one credit, one month of the referrer\'s own plan, across five runs');
});

test('referrals: eight businesses sent, six free months in twelve; the other two wait their turn', async () => {
  ck.set('2026-05-10T15:00:00Z');
  const R = await w.signup({ plan: 'Growth', business: 'Busy Referrer Roofing', owner: 'Bea Busy', phone: '(478) 555-0151', email: 'bea@busyreferrer.example' });
  const ref = (await w.get('SELECT ref FROM app_clients WHERE client_id = ?1', R.cid)).ref;
  ck.set('2026-05-12T15:00:00Z');
  for (let n = 1; n <= 8; n++) {
    const f = await w.signup({ plan: 'Starter', business: 'Sent ' + n + ' Painting', owner: 'Sam ' + n, phone: '(706) 555-03' + String(n).padStart(2, '0'), email: 'sam@sent' + n + '.example', town: 'Madison, GA', ref });
    w.S.invoices.push(paid(f.customer, 'c1_' + n, '2026-05-12T15:00:00Z', 'subscription_create'), paid(f.customer, 'c2_' + n, '2026-06-12T15:00:00Z', 'subscription_cycle'), paid(f.customer, 'c3_' + n, '2026-07-12T15:00:00Z', 'subscription_cycle'));
  }
  for (const t of ['2026-07-12T18:05:00Z', '2026-07-13T18:05:00Z', '2026-07-14T18:05:00Z']) { ck.set(t); await w.cron(); }
  const count = async () => Object.fromEntries((await w.all('SELECT status, COUNT(*) AS n FROM referrals WHERE referrer_id = ?1 GROUP BY status', R.cid)).map(r => [r.status, r.n]));
  assert.deepEqual(await count(), { credited: 6, earned: 2 });
  assert.equal(w.S.balanceTx.filter(t => t.customer === R.customer).length, 6);
  assert.equal(w.S.customers.get(R.customer).balance, -6 * 29900);
});

test('customer invoices: a card payment closes the reminder waiting for approval, later runs draft no more, an unsigned or unpaid event changes nothing', async () => {
  ck.set('2026-06-01T15:00:00Z');
  const p = await w.signup({ plan: 'Pro', business: 'Invoice Plumbing', phone: '(706) 555-0177', email: 'inv@example.com' });
  assert.equal((await w.site.call(p.A('/api/stripe'), { json: { action: 'connect' } })).status, 200);
  const acct = (await w.get('SELECT account FROM biz_stripe WHERE client_id = ?1', p.cid)).account;
  const csecret = (await w.get("SELECT v FROM billing_config WHERE k = 'connect_webhook_secret'")).v;
  const cev = async (type, object, sig) => { const body = JSON.stringify({ id: 'evt_h' + Math.random(), type, account: acct, data: { object } }); const r = await w.site.call('/stripe/webhook', { body, headers: { 'stripe-signature': sig || H.stripeSign(csecret, body) } }); await w.site.settle(); return r.status; };
  assert.equal(await cev('account.updated', { id: acct, charges_enabled: true }), 200);
  const inv = (await w.site.call(p.A('/api/invoice'), { json: { action: 'add', name: 'Joe Hart', amount: '1850', number: '1042', due: '2026-06-02', email: 'joe@example.com' } })).json().invoice;
  ck.set('2026-06-06T15:00:00Z'); await w.cron();
  const items = () => w.all("SELECT id, status FROM app_items WHERE client_id = ?1 AND kind = 'invoice' ORDER BY id", p.cid);
  assert.deepEqual(await items(), [{ id: 'inv-' + inv.id + '-3', status: 'pending' }], 'the three-day reminder waits for the owner');
  const pay = await w.site.call('/i/' + inv.link.split('/').pop() + '/pay', { form: {} });
  const sid = pay.location.split('/').pop();
  assert.equal(await cev('checkout.session.completed', { id: sid, payment_status: 'paid' }, 't=1,v1=bad'), 400);
  assert.equal(await cev('checkout.session.completed', { id: sid, payment_status: 'unpaid' }), 200);
  assert.equal((await w.get('SELECT status FROM app_invoices WHERE id = ?1', inv.id)).status, 'open');
  assert.equal(await cev('checkout.session.completed', { id: sid, payment_status: 'paid' }), 200);
  assert.equal((await w.get('SELECT status FROM app_invoices WHERE id = ?1', inv.id)).status, 'paid');
  assert.deepEqual(await items(), [{ id: 'inv-' + inv.id + '-3', status: 'closed' }]);
  assert.equal((await w.site.call(p.A('/api/decide'), { json: { id: 'inv-' + inv.id + '-3', action: 'approve' } })).status, 409, 'a late tap on the closed reminder sends nothing');
  const mails = w.world.mail.filter(m => /joe@example.com/.test(m.to)).length;
  for (const t of ['2026-06-10T15:00:00Z', '2026-06-20T15:00:00Z']) { ck.set(t); await w.cron(); }
  assert.deepEqual((await items()).map(i => i.id), ['inv-' + inv.id + '-3'], 'no seven-day reminder for a paid invoice');
  assert.equal(w.world.mail.filter(m => /joe@example.com/.test(m.to)).length, mails);
  assert.equal((await w.site.call('/i/' + 'x'.repeat(24))).status, 404, 'a made-up invoice link');
});

test('funding watch: a falling Twilio balance warns once, turns urgent, repeats every four hours, clears on a top-up; renewals remind once each at 30, 7 and 1 days', async () => {
  const { fundingCron } = await import('../../src/funding.js');
  let balance = '200.00';
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; return /\/Balance\.json$/.test(new URL(url).pathname) ? Response.json({ balance, currency: 'USD' }) : inner(input, init); };
  w.env.RENEWALS = 'alwaysopenoffice.com domain:2027-10-24';
  try {
    ck.set('2027-08-01T15:00:00Z');
    const step = async (hours, bal) => { ck.add(hours * 3600e3); balance = bal; const n = w.world.pushes.length; await fundingCron(w.env); return w.world.pushes.slice(n).filter(p => /Twilio|renews/.test(p.title)).map(p => p.priority + ': ' + p.title.replace('Always Open: ', '')); };
    assert.deepEqual(await step(0, '200.00'), []);
    assert.deepEqual(await step(1, '24.00'), ['high: Twilio balance is getting low']);
    assert.deepEqual(await step(1, '23.00'), [], 'not again an hour later');
    assert.deepEqual(await step(1, '9.00'), ['urgent: Twilio is almost out of money']);
    assert.deepEqual(await step(1, '8.00'), []);
    assert.deepEqual(await step(4, '7.00'), ['urgent: Twilio is almost out of money'], 'again after four hours');
    assert.deepEqual(await step(1, '50000.00'), [], 'topped up well clear: quiet, and the alert is cleared');
    assert.deepEqual(await step(1, '9.00'), ['urgent: Twilio is almost out of money'], 'so the next drop is said at once, not held for four hours');
    const at = async d => { ck.set(d); const n = w.world.pushes.length; await fundingCron(w.env); return w.world.pushes.slice(n).filter(p => /renews/.test(p.title)).map(p => p.title.replace(/^.*renews /, '')); };
    assert.deepEqual([await at('2027-09-20T15:00:00Z'), await at('2027-09-24T13:00:00Z'), await at('2027-09-26T15:00:00Z'), await at('2027-10-18T15:00:00Z'), await at('2027-10-19T15:00:00Z'), await at('2027-10-23T15:00:00Z'), await at('2027-10-24T15:00:00Z'), await at('2027-10-26T15:00:00Z')],
      [[], ['in 30 days'], [], ['in 6 days'], [], ['tomorrow'], [], []]);
  } finally { globalThis.fetch = inner; }
});

test('pages: business names and query strings are escaped on the sign-up, welcome and billing pages', async () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  const raw = t => /<img src=x|<b>Jerry<\/b>|<i>Dana<\/i>/.test(t);
  assert.equal(raw((await w.site.call('/start?plan=' + encodeURIComponent(evil) + '&ref=' + encodeURIComponent(evil) + '&from=' + encodeURIComponent(evil))).text), false);
  assert.equal(raw((await w.site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, { business: evil, owner: evil, town: evil, email: 'bad', ref: evil }) })).text), false);
  const x = await w.signup({ business: 'Tom & <b>Jerry</b> "Plumbing"', owner: '<i>Dana</i> Sinclair', phone: '(706) 555-0191', email: 'tj@example.com' });
  assert.equal(raw((await w.site.call('/welcome?s=' + x.sessionId)).text), false);
  for (const q of ['', '?step=cancel', '?done=' + encodeURIComponent(evil), '?step=' + encodeURIComponent(evil)]) assert.equal(raw((await w.site.call(x.A('/billing' + q))).text), false, q);
});

test('prices: the sign-up page, Max\'s own words, the terms and the home page all say what Stripe is asked to charge', async () => {
  const text = async p => (await w.site.call(p)).text.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');
  const start = await text('/start'), home = await text('/'), terms = await text('/terms'), max = F.ownLineFacts().prices;
  for (const [plan, p] of Object.entries(F.PLANS)) {
    const d = F.dollars(p.cents);
    await w.site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, { plan }) });
    assert.equal(w.S.log.filter(l => l.path === 'checkout/sessions').at(-1).body['line_items[0][price_data][unit_amount]'], String(p.cents));
    assert.ok(start.includes(plan + ' ' + p.blurb.slice(0, 20)) && start.includes(d + ' /mo'), plan + ' on /start');
    assert.ok(max.includes(plan + ' is ' + d + ' a month'), plan + ' in what Max says');
    assert.ok(terms.includes(plan + ' (' + d + ' a month)'), plan + ' in the terms');
    assert.ok(new RegExp(plan + ' ' + d.replace('$', '\\$') + ' / month About \\$' + p.perDay + ' a day').test(home), plan + ' on the home page');
  }
  const more = F.dollars(F.MAX.moreCents);
  assert.ok(start.includes('Add 300 more Max minutes, ' + more + '/mo'));
  assert.ok(max.includes('300 more minutes are ' + more + ' a month') && max.includes('past their minutes it is 25 cents a minute') && max.includes('with 300 minutes a month'));
  assert.ok(terms.includes('300 minutes of calls each month; after that it is 25¢ a minute. Another 300 minutes a month is available for ' + more));
  assert.ok(home.includes(more + ' / month, 300 more minutes') && home.includes('past your minutes without it, 25¢'));
});
