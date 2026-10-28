// node --test test/  — texting rules: no send without the account, STOP is honored, after-hours holds, replies go any time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendText, handleSms, ph10 } from '../src/sms.js';

function fakeDB(rows = {}) {
  const log = [];
  const db = { log, prepare(sql) { return { bind(...a) { return { async first() { for (const k in rows) if (sql.includes(k)) return rows[k]; return null; }, async run() { log.push([sql, a]); return {}; }, async all() { return { results: [] }; } }; }, async first() { return null; }, async run() { log.push([sql]); return {}; } }; }, async batch() {} };
  return db;
}

test('ph10 normalizes', () => { assert.equal(ph10('(478) 365-2533'), '4783652533'); assert.equal(ph10('+14783652533'), '4783652533'); assert.equal(ph10('12345'), ''); });

test('no account means nothing sends', async () => {
  const r = await sendText({ DB: fakeDB() }, { clientId: 'c1', to: '4783652533', body: 'hi', kind: 'reply' });
  assert.equal(r.ok, false); assert.equal(r.why, 'texting not set up');
});

test('opted out numbers are skipped', async () => {
  const env = { DB: fakeDB({ 'sms_optout WHERE': { x: 1 } }), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  const r = await sendText(env, { clientId: 'c1', to: '4783652533', body: 'hi', kind: 'reply' });
  assert.equal(r.why, 'opted out');
});

test('after-hours holds non-reply kinds', async () => {
  const env = { DB: fakeDB(), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  const r = await sendText(env, { clientId: 'c1', to: '4783652533', body: 'hi', kind: 'revive', tz: 'Etc/GMT+12' });
  const h = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Etc/GMT+12' }).format(new Date());
  if (h < 8 || h >= 21) { assert.equal(r.why, 'after hours'); assert.equal(r.retry, true); }
  else assert.notEqual(r.why, 'after hours');
});

test('STOP records an opt-out and sends nothing back', async () => {
  const db = fakeDB({ 'FROM voice_lines WHERE number': { client_id: 'c1', business: 'Sinclair Plumbing' } });
  const form = new URLSearchParams({ From: '+14783652533', To: '+14785550100', Body: 'STOP' });
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
  const r = await sendText(env, { clientId: 'sinclair-plumbing', to: '4783652533', body: 'hi', kind: 'reply' });
  assert.equal(r.ok, false); assert.equal(r.why, 'texting not registered for this business');
});
