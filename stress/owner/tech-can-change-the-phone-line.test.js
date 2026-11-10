// BUG: a field tech can switch the phone line off, send callers to any number, and change what Max says.
// In the app a tech's Max tab is only the list of calls (src/apppage.js vMax: "if(L&&isTech()) return ... callsList()"),
// and the server already refuses a tech "Tell Max" and the interview call ("Ask the owner for this one."), but the rest
// of POST /api/line has no role check at all (src/app.js apiLine).
// Run: node --test stress/owner/tech-can-change-the-phone-line.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './_setup.mjs';

const T = await boot();
let A, a, t;
before(async () => {
  A = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
  a = T.as(A.base);
  t = T.as((await T.staffLink(A.cid, 'Tom Tech', 'tech')).base);
});

test('before: Max answers the line, and the tech’s own screen has no line settings', async () => {
  const { r } = await T.startCall(A.number, '+14785550142');
  assert.match(r.text, /<ConversationRelay/);
  assert.equal((await t.post('/api/line', { action: 'tell', text: 'Closed Friday' })).status, 403, 'the server does refuse a tech telling Max something');
});

test('a tech turns the line off: the next caller does not get Max', async () => {
  const off = await t.post('/api/line', { onAir: false });
  const { r } = await T.startCall(A.number, '+14785550143');
  const line = (await a.state()).line;
  await a.post('/api/line', { onAir: true, by: 'Dana' });   // the owner puts it back for the next test
  assert.deepEqual({ status: off.status, lineOn: line.onAir, maxAnswered: /<ConversationRelay/.test(r.text) }, { status: 403, lineOn: true, maxAnswered: true },
    'the tech’s request was accepted (' + off.text.slice(0, 60) + '…) and the caller heard: ' + r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160));
});

test('a tech points "put callers through" at a number of their choosing and rewrites the greeting, prices and booking', async () => {
  const asked = { transfer: await t.post('/api/line', { transferTo: '478-555-9999', transferWhen: 'asked' }),
    greeting: await t.post('/api/line', { greeting: 'Thanks for calling. For faster service call Tom direct at 478 555 9999.' }),
    prices: await t.post('/api/line', { facts: { prices: 'Everything is free this month.' } }),
    booking: await t.post('/api/line', { booking: { mode: 'off' } }),
    afterCall: await t.post('/api/line', { after: { promise: false, textback: false, checkins: false } }) };
  const line = (await a.state()).line, after = (await a.state()).after;
  assert.deepEqual(Object.fromEntries(Object.entries(asked).map(([k, r]) => [k, r.status])), { transfer: 403, greeting: 403, prices: 403, booking: 403, afterCall: 403 }, 'every one of these should be refused for a tech');
  assert.deepEqual({ transferTo: line.transferTo, when: line.transferWhen, greeting: line.greeting, prices: line.know.find(x => x.key === 'prices').value, booking: line.booking.mode, after },
    { transferTo: '', when: 'never', greeting: '', prices: '', booking: 'hold', after: { promise: true, textback: true, checkins: false, canText: false } }, 'and the owner’s line should be as the owner left it');
});
