// BUG (money): the public form takes a referral code and any email address, and that pair alone later earns the
// code's owner a free month. Nobody has to have used the referral link: a client (or anyone holding a client's code,
// which is public: it is the tail of their /q/ request link and their id on the public map) types a business's address
// into the form with the code. If that business signs up within 120 days with the same address, having found Always
// Open on its own, referral.js matchLeads books it as a referral, and after three paid months Stripe credit for a
// month of the referrer's plan is applied. Up to six free months a year for each client who does this.
//
// referral.js already refuses a phone match for exactly this reason ("a phone number is easy to copy off a business's
// own website, so a phone match alone could let a client claim credit for businesses that found us on their own").
// An email address is on the same website.
//
// The referral rules themselves are run as they are; Stripe's answers are passed in through the cron's own `h.stripe`
// (three paid monthly invoices, nothing refunded, different cards).
//
// SEVERITY: medium (money: $299 in this test, up to six months a year for each client who does it).
// CAUSE: the form accepts any ref with any email (src/index.js:503, saved at 541) and matchLeads trusts the pair
//   (src/referral.js:54-63).
// SMALLEST FIX: in matchLeads count only leads that clicked through their own audit email
//   (AND engaged IS NOT NULL AND engaged != ''), the same proof the follow-ups already ask for.
//
// Run: node --test stress/prospect/referral-by-form.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, H, clock } from './_kit.mjs';
const R = await import('../../src/referral.js');

async function signUp(s, c) {
  await s.client.call('/start?plan=Growth');
  const r = await s.client.call('/billing/checkout', { form: Object.assign({ plan: 'Growth', max: '1', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' }, c) });
  const id = r.location.split('/').pop();
  const body = JSON.stringify({ id: 'evt_' + id, type: 'checkout.session.completed', data: { object: s.world.sessions.get(id) } });
  const secret = (await s.one("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
  const w = await s.client.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
  assert.equal(w.status, 200, w.text);
  return s.one('SELECT client_id, ref, customer FROM billing WHERE session_id = ?1', id);
}

// Acme is a client. Baker Electric signs up two weeks later on its own (no link, no code) and pays three months.
// typed: did somebody first type Baker's address into the public form with Acme's code?
async function story(typed) {
  const s = site();
  const T0 = Date.parse('2026-10-26T14:00:00Z');
  let back = clock(T0);
  try {
    const acme = await signUp(s, { business: 'Acme Plumbing', owner: 'Alex Acme', phone: '(478) 555-0111', email: 'alex@acmeplumbing.example' });
    assert.match(acme.ref, /^acme-plumbing-/);
    back(); back = clock(T0 + 3600e3);
    if (typed) assert.equal((await ask(s, { name: 'Bo Baker', email: 'bo@bakerelectric.example', business: 'Baker Electric', town: 'Madison, GA', ref: acme.ref }, '192.0.2.44')).status, 200);
    back(); back = clock(T0 + 14 * 864e5);
    await signUp(s, { business: 'Baker Electric', owner: 'Bo Baker', phone: '(706) 555-0122', email: 'bo@bakerelectric.example' });
    const credits = [];
    const stripe = async (env, method, path, body) => {
      if (/^invoices\?/.test(path)) return { data: [0, 1, 2].map(i => ({ status: 'paid', amount_paid: 29900, billing_reason: i ? 'subscription_cycle' : 'subscription_create', attempt_count: 1, status_transitions: { paid_at: Math.floor((T0 + (14 + 30 * i) * 864e5) / 1000) } })) };
      if (/^payment_methods\?customer=/.test(path)) return { data: [{ card: { fingerprint: 'fp-' + path } }] };
      if (/^subscriptions\//.test(path)) return { items: { data: [{ price: { unit_amount: 29900, recurring: { interval: 'month' } }, quantity: 1 }] } };
      if (method === 'POST' && /balance_transactions$/.test(path)) { credits.push({ to: path.split('/')[1] === acme.customer ? 'Acme Plumbing' : path, cents: body.amount }); return { id: 'cbtxn_1' }; }
      if (/^customers\//.test(path)) return { address: null, balance: 0 };
      return { data: [] };
    };
    const h = { stripe, notify: async () => {}, alert: async () => {} };
    await R.referralCron(s.env, h, T0 + 14 * 864e5 + 3600e3, true);     // the day Baker signed up
    const booked = (await s.all('SELECT source, status FROM referrals')).map(x => x.source + ':' + x.status);
    back(); back = clock(T0 + 95 * 864e5);
    await R.referralCron(s.env, h, T0 + 95 * 864e5, true);              // three paid months later
    return { booked, credits };
  } finally { back(); }
}

test('control: a business that signs up on its own earns nobody a free month', async () => {
  assert.deepEqual(await story(false), { booked: [], credits: [] });
});

test('typing that business’s address into the form with a client’s code first earns the client nothing either', async () => {
  const got = await story(true);
  assert.deepEqual(got.credits, [], 'a month of Stripe credit was applied to the client whose code was typed');
  assert.deepEqual(got.booked, [], 'and the signup was booked as that client’s referral');
});
