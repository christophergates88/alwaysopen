// BUG: a past-customer message the owner approved, that cannot go out at that moment, is never sent.
// The app tells the owner "Saved. It goes out in the morning." (src/pastpage.js, pc-approve) and lists it as "Held until
// morning" / "Queued", but nothing in the worker ever sends a biz_revive row whose status is 'queued'.
// Run: node --test stress/owner/past-message-approved-never-sent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_setup.mjs';

const DAY = Date.parse('2026-11-10T15:00:00Z');      // Tuesday 10:00 AM Eastern
const NIGHT = Date.parse('2026-11-11T03:30:00Z');    // Tuesday 10:30 PM Eastern
const MORNING = Date.parse('2026-11-11T15:00:00Z');  // Wednesday 10:00 AM Eastern
const CUSTOMER = '+14785550144';

async function ownerWithOnePastCustomerDue(T) {
  const A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
  const a = T.as(A.base);
  // the owner uploads a customer list (one customer, last job almost two years ago) and says they agreed to hear from them
  const imp = await a.post('/api/import', { action: 'save', csv: 'name,phone,date,amount,work\nOld Cust,4785550144,2024-01-15,400,drain cleaning', agreed: true });
  assert.equal(imp.status, 200, imp.text);
  const ref = await a.post('/api/revive', { action: 'refresh' });
  assert.equal(ref.json().count, 1, 'one past customer looks ready to hear from the business');
  const item = (await a.state()).past.revive.items[0];
  assert.equal(item.agreed, true); assert.equal(item.hasPhone, true); assert.equal(item.hasEmail, false);
  return { A, a, item };
}
// the whole 10-minute timer, at 9 AM, 10 AM, 10:10 AM and 2 PM Eastern on each of the next two days, so nothing can
// say "it was not morning yet" or "that run only claimed it"
async function runTheTimerForTwoDays(T) {
  for (const day of [MORNING, MORNING + 864e5]) for (const min of [-60, 0, 10, 240]) { clock.set(day + min * 60e3); await T.cron(); }
}

test('approved at 10:30 PM: the app says it goes out in the morning, and it never does', async () => {
  const T = await boot();
  try {
    clock.set(DAY);
    const { A, a, item } = await ownerWithOnePastCustomerDue(T);
    assert.equal((await T.approveTexting(A.cid)).status, 200, 'the business’s texting registration is approved');

    clock.set(NIGHT);
    const ok = await a.post('/api/revive', { action: 'approve', id: item.id, text: '' });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual([ok.json().ok, ok.json().status, ok.json().result], [true, 'queued', 'text:after hours'], 'held for daytime, and the app is told it is saved');
    assert.equal(T.world.texts.filter(t => t.To === CUSTOMER).length, 0, 'nothing at night: correct');
    // A control, so the timer and texting are known to work in this run: a quote follow-up due tomorrow, customer said yes to texts.
    const fu = await a.post('/api/followup', { kind: 'quote', name: 'Quinn Control', phone: '478-555-0155', amount: '$900', due: '2026-11-11', consent: true, by: 'Dana' });
    assert.equal(fu.status, 200, fu.text);

    await runTheTimerForTwoDays(T);
    assert.equal(T.world.texts.filter(t => t.To === '+14785550155').length, 1, 'control: the same timer runs did text the quote follow-up');
    const row = await T.get('SELECT status, result FROM biz_revive WHERE id = ?1', item.id);
    assert.equal(T.world.texts.filter(t => t.To === CUSTOMER).length, 1,
      'the approved message reaches the customer the next morning. It did not: after two days of timer runs the row is still ' + JSON.stringify(row));
  } finally { clock.restore(); }
});

test('approved before the business’s texting registration came through: same loss, even after it is approved', async () => {
  const T = await boot();
  try {
    clock.set(DAY);
    const { A, a, item } = await ownerWithOnePastCustomerDue(T);
    // The card says "Sends as a text." because past.revive.textingOn is the global switch, not this business's registration.
    assert.equal((await a.state()).past.revive.textingOn, true);
    const ok = await a.post('/api/revive', { action: 'approve', id: item.id, text: '' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json().ok, true); assert.equal(ok.json().status, 'queued');
    assert.match(ok.json().result, /not registered/);

    assert.equal((await T.approveTexting(A.cid)).status, 200, 'the registration is approved later that day');
    await runTheTimerForTwoDays(T);
    const row = await T.get('SELECT status, result FROM biz_revive WHERE id = ?1', item.id);
    assert.equal(T.world.texts.filter(t => t.To === CUSTOMER).length, 1,
      'the approved message goes out once texting is on. It did not: the row is still ' + JSON.stringify(row) + ', and the owner cannot approve it again (it is no longer pending)');
  } finally { clock.restore(); }
});
