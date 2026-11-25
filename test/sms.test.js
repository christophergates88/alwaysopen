// node --test test/  — texting rules: no send without the account, STOP is honored, after-hours holds, replies go any time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendText, handleSms, ph10 } from '../src/sms.js';

function fakeDB(rows = {}) {
  const log = [];
  const db = { log, prepare(sql) { return { bind(...a) { return { async first() { for (const k in rows) if (sql.includes(k)) return rows[k]; return null; }, async run() { log.push([sql, a]); return {}; }, async all() { return { results: [] }; } }; }, async first() { return null; }, async run() { log.push([sql]); return {}; } }; }, async batch() {} };
  return db;
}

test('ph10 normalizes', () => { assert.equal(ph10('(478) 555-0142'), '4785550142'); assert.equal(ph10('+14785550142'), '4785550142'); assert.equal(ph10('12345'), ''); });

test('no account means nothing sends', async () => {
  const r = await sendText({ DB: fakeDB() }, { clientId: 'c1', to: '4785550142', body: 'hi', kind: 'reply' });
  assert.equal(r.ok, false); assert.equal(r.why, 'texting not set up');
});

test('opted out numbers are skipped', async () => {
  const env = { DB: fakeDB({ 'sms_optout WHERE': { x: 1 } }), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  const r = await sendText(env, { clientId: 'c1', to: '4785550142', body: 'hi', kind: 'reply' });
  assert.equal(r.why, 'opted out');
});

// Nov 24, 2026: on a fixed clock. It used to read the real one, so it failed every night once texts also waited for the
// customer's own 8 AM to 9 PM (a 478 number is Georgia), and a deploy after 9 PM Eastern could not pass.
test('after-hours holds non-reply kinds, by the business clock and by the customer\'s', async (t) => {
  const env = { DB: fakeDB(), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  const send = tz => sendText(env, { clientId: 'c1', to: '4785550142', body: 'hi', kind: 'revive', tz });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-24T17:00:00Z') });   // noon in Georgia, 5 AM at GMT-12
  assert.notEqual((await send('America/New_York')).why, 'after hours', 'daytime for both');
  const early = await send('Etc/GMT+12');
  assert.equal(early.why, 'after hours', 'the business clock'); assert.equal(early.retry, true);
  t.mock.timers.setTime(Date.parse('2026-11-25T03:00:00Z'));   // 10 PM in Georgia, 3 PM at GMT-12
  const late = await send('Etc/GMT+12');
  assert.equal(late.why, 'after hours', 'the customer\'s clock'); assert.equal(late.retry, true);
});

test('STOP records an opt-out and sends nothing back', async () => {
  const db = fakeDB({ 'FROM voice_lines WHERE number': { client_id: 'c1', business: 'Sinclair Plumbing' } });
  const form = new URLSearchParams({ From: '+14785550142', To: '+14785550100', Body: 'STOP' });
  const res = await handleSms({}, { DB: db }, form, true);
  assert.equal(res.status, 200);
  assert.ok(db.log.some(([sql]) => sql.includes('sms_optout')));
  assert.ok(!(await res.text()).includes('<Message>'));
});

test('a bad signature is refused', async () => {
  const res = await handleSms({}, { DB: fakeDB() }, new URLSearchParams(), false);
  assert.equal(res.status, 403);
});

test('a client without its own texting registration is never texted for', async () => {
  const env = { DB: fakeDB(), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_MESSAGING_SID: 'MG' + '0'.repeat(32) };
  const r = await sendText(env, { clientId: 'sinclair-plumbing', to: '4785550142', body: 'hi', kind: 'reply' });
  assert.equal(r.ok, false); assert.equal(r.why, 'texting not registered for this business');
});
