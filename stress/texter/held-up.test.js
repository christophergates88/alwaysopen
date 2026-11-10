// What held up: attacks on the texting rules that the code handled correctly. All of these pass.
// Run: node --test stress/texter/held-up.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, SMS, clock } from './_kit.mjs';

const NOW = Date.parse('2026-11-10T15:00:00Z');   // Tuesday, 10 AM Eastern
const review = (T, cid, to) => SMS.sendText(T.env, { clientId: cid, to, kind: 'review', tz: 'America/New_York', body: 'Thanks for letting us help. Reply STOP to end texts.' });

test('an opt-out holds whatever way the number is written, for every kind, and only for that business', async () => {
  const T = boot(); clock.set(NOW);
  try {
    const A = await T.addClient({}), B = await T.addClient({ business: 'Oconee Heating' });
    await T.sms(A.number, '+14785550188', 'stop');
    for (const to of ['+14785550188', '4785550188', '(478) 555-0188', '478.555.0188', '1-478-555-0188'])
      for (const kind of ['reply', 'test', 'textback', 'booking', 'onway', 'tap', 'confirm', 'review', 'revive', 'fillweek', 'invoice', 'timecard'])
        assert.equal((await SMS.sendText(T.env, { clientId: A.cid, to, kind, tz: 'America/New_York', body: 'x' })).why, 'opted out', kind + ' to ' + to);
    assert.equal((await review(T, B.cid, '+14785550188')).ok, true, 'another business is a different sender');
    assert.equal(T.sentTo('+14785550188').length, 1);
    await T.sms(A.number, '+14785550188', 'START');
    assert.equal((await review(T, A.cid, '+14785550188')).ok, true, 'START puts them back');
  } finally { clock.restore(); }
});

test('no text goes for a business without an approved registration, and Always Open\'s campaign never sends for a client', async () => {
  const T = boot(); clock.set(NOW);
  try {
    const A = await T.addClient({ approved: false });
    for (const kind of ['reply', 'test', 'textback', 'booking', 'tap', 'review'])
      assert.equal((await SMS.sendText(T.env, { clientId: A.cid, to: '+14785550188', kind, tz: 'America/New_York', body: 'x' })).why, 'texting not registered for this business');
    await SMS.setBrand(T.env, A.cid, 'MG' + 'd'.repeat(32), 'pending');
    assert.equal((await review(T, A.cid, '+14785550188')).ok, false);
    await SMS.setBrand(T.env, A.cid, 'MG' + 'd'.repeat(32), 'approved');
    assert.equal((await review(T, A.cid, '+14785550188')).ok, true);
    const t = T.sent()[0];
    assert.equal(t.MessagingServiceSid, 'MG' + 'd'.repeat(32), 'the client\'s own service, not Always Open\'s');
    assert.equal(t.From, A.number);
  } finally { clock.restore(); }
});

test('the daytime gate holds automatic kinds at night and lets answers go', async () => {
  const T = boot(); clock.set('2026-11-11T03:30:00Z');   // 10:30 PM Eastern
  try {
    const A = await T.addClient({});
    for (const kind of ['review', 'revive', 'fillweek', 'invoice', 'timecard', 'reminder', 'callsum']) assert.equal((await SMS.sendText(T.env, { clientId: A.cid, to: '+14785550188', kind, tz: 'America/New_York', body: 'x' })).why, 'after hours', kind);
    for (const kind of ['reply', 'textback', 'booking', 'confirm']) assert.equal((await SMS.sendText(T.env, { clientId: A.cid, to: '+14785550188', kind, tz: 'America/New_York', body: 'x' })).ok, true, kind);
  } finally { clock.restore(); }
});

test('the same Twilio webhook twice makes one inbox row and one reply', async () => {
  const T = boot();
  const A = await T.addClient({});
  const a = await T.sms(A.number, '+14785550188', 'HELP', 'SM' + 'e'.repeat(32));
  const b = await T.sms(A.number, '+14785550188', 'HELP', 'SM' + 'e'.repeat(32));
  assert.match(T.twimlMessage(a), /text line for Sinclair Plumbing/);
  assert.equal(T.twimlMessage(b), '');
  assert.equal((await T.all('SELECT id FROM biz_msgs WHERE client_id = ?1', A.cid)).length, 1);
});

test('a customer of two businesses: each text lands only in the inbox of the business it was sent to', async () => {
  const T = boot();
  const A = await T.addClient({}), B = await T.addClient({ business: 'Oconee Heating', owner: '+14785550102' });
  await T.sms(A.number, '+14785550188', 'Can you come Thursday?');
  await T.sms(B.number, '+14785550188', 'Is my furnace part in?');
  assert.deepEqual((await T.all('SELECT text FROM biz_msgs WHERE client_id = ?1', A.cid)).map(r => r.text), ['Can you come Thursday?']);
  assert.deepEqual((await T.all('SELECT text FROM biz_msgs WHERE client_id = ?1', B.cid)).map(r => r.text), ['Is my furnace part in?']);
});

test('a customer\'s text is never taken as the owner\'s Shoulder Tap answer or a note for Max; the owner\'s is', async () => {
  const T = boot(); clock.set(NOW);
  try {
    const A = await T.addClient({});
    const { ensureTaps } = await import('../../src/tap.js'); await ensureTaps(T.env);
    const sid = 'CA' + '7'.repeat(32);
    await T.run("INSERT INTO app_calls (id, client_id, number, at, caller, outcome) VALUES (?1, ?2, ?3, ?4, '+17065550123', 'live')", sid, A.cid, A.number, new Date(NOW - 60e3).toISOString());
    await T.run("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) VALUES ('tp' || ?1, ?2, ?3, 'ask', 'Can you come tonight?', ?4, 'open')", 'a'.repeat(24), sid, A.cid, new Date(NOW - 20e3).toISOString());
    const c = await T.sms(A.number, '+14785550188', 'Yes, I can be there at 7');
    assert.equal((await T.one('SELECT status FROM call_taps WHERE call_id = ?1', sid)).status, 'open');
    assert.equal(T.twimlMessage(c), '');
    assert.equal((await T.one('SELECT owner_set FROM voice_lines WHERE number = ?1', A.number)).owner_set, '{}');
    const o = await T.sms(A.number, A.owner, 'Yes, I can be there at 7');
    assert.notEqual((await T.one('SELECT status FROM call_taps WHERE call_id = ?1', sid)).status, 'open');
    assert.match(T.twimlMessage(o), /^(Got it|That call ended)/);
  } finally { clock.restore(); }
});

test('a number typed into the public booking page is not texted until it texts the business first', async () => {
  const T = boot(); clock.set(NOW);
  try {
    const A = await T.addClient({ tier: 'Growth' });
    await T.connectCalendar(A.cid, 'America/New_York');
    const page = await T.site.call('/b/' + (await T.one('SELECT ref FROM app_clients WHERE client_id = ?1', A.cid)).ref);
    const slot = /name="slot" value="(\d+)"/.exec(page.text)[1];
    const r = await T.site.call('/b/' + (await T.one('SELECT ref FROM app_clients WHERE client_id = ?1', A.cid)).ref, { form: { name: 'Pat Lowe', phone: '(478) 555-0188', slot, sms_ok: 'yes', t: String(NOW - 60000) } });
    assert.equal(r.status, 200);
    assert.match(r.text, /text YES to/);
    assert.equal(T.sentTo('+14785550188').length, 0, 'nothing before they text in');
    await T.sms(A.number, '+14785550188', 'YES');
    assert.match(T.sentTo('+14785550188').map(t => t.Body).join(' '), /You’re set for/);
  } finally { clock.restore(); }
});
