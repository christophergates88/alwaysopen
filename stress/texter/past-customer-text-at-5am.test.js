// BUG: past-customer messages ("revive" texts) use Eastern time for the 8 AM to 9 PM rule, whatever the business's zone.
// What a real person sees: a plumber in San Diego approves a note to a past customer in the evening. It is held for the
// night, then goes out at 8:00 AM Eastern, which is 5:00 AM in San Diego: the customer's phone buzzes at 5 AM with a
// marketing text. Full Max sends the same texts on its own every 10 minutes, so it does the same thing without any
// tap. In Pensacola (Central) it is 7 AM; in Honolulu, 3 AM. Every other text that waits for daytime passes the
// business's zone (review asks, invoices, Fill my week, timecards, reminders); these are marketing texts, the kind
// the quiet-hours rule matters most for.
//
// CAUSE: src/past.js:456. approveRevive calls sendText(..., kind: 'revive') with no tz, so sendText's daytime check
//   (src/sms.js:98 -> textDaytime(o.tz)) falls back to America/New_York (src/sms.js:49). The same call serves
//   sendHeldRevive (src/past.js:468, the held texts from the night) and Full Max (src/fullmax.js:125).
// SEVERITY: high (marketing texts before 8 AM local time, every morning, for every business outside Eastern time).
// SMALLEST FIX: in approveRevive pass tz: await tzFor(env, cid) (callbacks.js), as checkin.js:158 and extras.js:221 do.
//
// Run: node --test stress/texter/past-customer-text-at-5am.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_kit.mjs';
const { sendHeldRevive, approveRevive, ensurePast } = await import('../../src/past.js');
const { tzFor } = await import('../../src/callbacks.js');
const { sendText } = await import('../../src/sms.js');

// Tuesday Nov 10, 2026, 13:05 UTC = 8:05 AM Eastern = 5:05 AM Pacific (PST, UTC-8) = 7:05 AM Central.
const EARLY = '2026-11-10T13:05:00Z';
const CUSTOMER = '+16195550147';

async function pastCustomer(T, cid, phone, status) {
  await ensurePast(T.env);
  await T.run("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, agreed, agreed_at, opt_token, source, created, updated) VALUES (?1, 'k1', 'Pat Lowe', ?2, ?3, 1, '2026-01-01', ?4, 'import', '2026-01-01', '2026-01-01')",
    cid, phone, phone.slice(-10), ('tok' + cid).replace(/[^A-Za-z0-9]/g, '').padEnd(16, 'x').slice(0, 16));
  const r = await T.run("INSERT INTO biz_revive (client_id, ckey, name, phone, reason, draft, status, created, updated) VALUES (?1, 'k1', 'Pat Lowe', ?2, 'Water heater is 9 years old', 'Hi Pat, it has been a while since we flushed your water heater. Want us to come by?', ?3, ?4, ?4)",
    cid, phone, status, '2026-11-10T04:00:00Z');
  return r.meta.last_row_id;
}

test('control: a San Diego business is in Pacific time, and its review ask at 5 AM Pacific waits', async () => {
  const T = boot();
  clock.set(EARLY);
  try {
    const A = await T.addClient({ business: 'Harbor Plumbing', town: 'San Diego, CA', number: '+16195550100', owner: '+16195550101' });
    assert.equal(await tzFor(T.env, A.cid), 'America/Los_Angeles');
    const r = await sendText(T.env, { clientId: A.cid, to: CUSTOMER, body: 'Thanks for letting Harbor Plumbing help. Reply STOP to end texts.', kind: 'review', tz: await tzFor(T.env, A.cid) });
    assert.equal(r.why, 'after hours');
    assert.equal(T.sentTo(CUSTOMER).length, 0);
  } finally { clock.restore(); }
});

test('control: a Georgia business\'s held past-customer text goes at 8:05 AM Eastern, as it should', async () => {
  const T = boot();
  clock.set(EARLY);
  try {
    const A = await T.addClient({ business: 'Sinclair Plumbing', town: 'Eatonton, GA', number: '+14785550100' });
    await pastCustomer(T, A.cid, '+14785550147', 'queued');
    await sendHeldRevive(T.env);
    assert.equal(T.sentTo('+14785550147').length, 1);
  } finally { clock.restore(); }
});

test('a San Diego business\'s past-customer text, held overnight, goes out at 5:05 AM Pacific', async () => {
  const T = boot();
  clock.set(EARLY);
  try {
    const A = await T.addClient({ business: 'Harbor Plumbing', town: 'San Diego, CA', number: '+16195550100', owner: '+16195550101' });
    await pastCustomer(T, A.cid, CUSTOMER, 'queued');
    await sendHeldRevive(T.env);
    const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(Date.parse(EARLY));
    assert.equal(T.sentTo(CUSTOMER).length, 0, 'a past-customer marketing text went to a San Diego customer at ' + local + ' their time');
  } finally { clock.restore(); }
});

test('Full Max\'s path (approveRevive) sends a Pensacola business\'s past-customer text at 7:05 AM Central', async () => {
  const T = boot();
  clock.set(EARLY);
  try {
    const A = await T.addClient({ business: 'Gulf Breeze HVAC', town: 'Pensacola, FL', number: '+18505550100', owner: '+18505550101' });
    assert.equal(await tzFor(T.env, A.cid), 'America/Chicago');
    const id = await pastCustomer(T, A.cid, '+18505550147', 'pending');
    const row = await T.one('SELECT * FROM biz_revive WHERE id = ?1', id);
    const r = await approveRevive(T.env, { client_id: A.cid, business: 'Gulf Breeze HVAC', staff: 'Max' }, row, '');
    assert.equal(T.sentTo('+18505550147').length, 0, 'sent at 7:05 AM Central (result: ' + JSON.stringify(r.body) + ')');
  } finally { clock.restore(); }
});
