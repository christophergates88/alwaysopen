// BUG: three things keep running, on Always Open's Twilio bill, for a client whose subscription has ended
// (customer.subscription.deleted: app off, Max's line off the air).
//   1. Max still phones their customers. A call-back promised before the end ("he will call you at 10:45") is still
//      chased by the every-10-minutes job: Max rings the customer to set a new time on behalf of a business that is no
//      longer a client and whose owner can no longer open the app to see it.
//   2. Their line still works as free call forwarding. Calls to the ended line are put through to the owner's phone
//      (two paid call legs, counted nowhere) for the 60 days the number is kept. The terms say the line stops answering.
//   3. Their texting registration carries on. A registration form sent the day before they left is walked through
//      Twilio after they are gone, including the two steps carriers charge for (the brand and the campaign, which then
//      bills every month and is never removed).
// Cause: src/callbacks.js:384 and :390 (callbackCron never looks at app_clients.active; placeCall at :286-293 neither),
//        src/voice.js:160-165 (a line that is off the air dials transfer_to, whoever switched it off),
//        src/a2p.js:296 (a2pCron takes every 'submitted' / 'in_review' row), src/provision.js:143-150 (lineEnded
//        leaves callbacks, the transfer number and the registration as they were).
// Severity: medium. Free service and carrier fees for a business that has stopped paying, and calls made in its name
// that nobody is watching. (Check-in calls, follow-up texts, invoice reminders, the timecard, the monthly report, review
// replies and posts were all tried after a cancellation and stopped as they should.)
// Smallest fix: join app_clients and require active = 1 in both callbackCron queries and in a2pCron; in incoming(), do
// not dial transfer_to when the line's client is not active; have lineEnded cancel pending call-backs.
// Run: node --test stress/money/06-after-the-plan-ends-it-keeps-spending.test.js   (3 pass, 3 fail)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock } from './_h.mjs';

const ck = clock('2026-11-10T15:00:00Z');   // Tuesday, 10 AM Eastern
after(() => ck.restore());
const w = await boot({ TWILIO_PRIMARY_PROFILE_SID: 'BU' + 'f'.repeat(32) });
const stay = await w.signup({ plan: 'Pro', business: 'Staying Plumbing', phone: '(706) 555-0111', email: 'stay@example.com' });
const left = await w.signup({ plan: 'Pro', business: 'Leaving Plumbing', phone: '(706) 555-0122', email: 'left@example.com' });

// Twilio's registration addresses (the harness does not fake them): every request is written down and answered "fine".
const reg = [];
const inner = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url, u = new URL(url), method = (init && init.method) || 'GET';
  if (u.hostname !== 'trusthub.twilio.com' && u.hostname !== 'messaging.twilio.com' && !/\/Addresses\.json$/.test(u.pathname)) return inner(input, init);
  reg.push({ method, what: u.hostname.split('.')[0] + u.pathname.replace('/v1', '').replace(/[A-Z]{2}[0-9a-f]{32}/g, 'SID'), body: init && init.body ? String(init.body) : '' });
  const sid = 'XX' + String(reg.length).padStart(32, '0');
  if (method === 'GET' && /CustomerProfiles\/[^/]+$/.test(u.pathname)) return Response.json({ sid, status: 'twilio-approved' });
  if (method === 'GET' && /BrandRegistrations\/[^/]+$/.test(u.pathname)) return Response.json({ sid, status: 'APPROVED' });
  if (method === 'GET' && /Usa2p\/Usecases/.test(u.pathname)) return Response.json({ us_app_to_person_usecases: [{ code: 'LOW_VOLUME' }] });
  if (method === 'GET' && /Usa2p$/.test(u.pathname)) return Response.json({ compliance: [{ campaign_status: 'IN_PROGRESS' }] });
  return Response.json({ sid, status: 'compliant' }, { status: method === 'POST' ? 201 : 200 });
};

// A caller asks for a call back; Max names a time and the worker keeps the promise.
async function callbackCall(c, from, name) {
  w.world.aiScript = ['He is on a job. He will call you back at the time I gave. [END]'];
  w.world.aiNote = { name, callback: from, reason: 'Leaking pipe', details: '', when: '', urgent: false, callback_wanted: true, callback_at: '', booked: '', spam: false, summary: name + ' wants a call back about a leaking pipe.' };
  const sid = w.newSid();
  await w.hook('in', { CallSid: sid, To: c.number, From: from });
  await w.openRoom(sid, from);
  await w.say(sid, 'Hi, this is ' + name + '. I have a leaking pipe, can he call me back?');
  await w.hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' });
  await w.site.settle();
  await w.hook('status', { CallSid: sid, CallStatus: 'completed', CallDuration: '62' });
}
const TEXTING = { legal: 'Leaving Plumbing LLC', btype: 'Limited Liability Corporation', ein: '12-3456789', industry: 'CONSTRUCTION', website: 'https://leavingplumbing.example', street: '1 Main St', city: 'Eatonton', state: 'GA', zip: '31024', first: 'Dana', last: 'Sinclair', title: 'Owner', position: 'CEO', email: 'left@example.com', phone: '7065550122', agree: 'on' };
let due = 0;

test('both businesses are set up the same way: a transfer number, one promised call-back each, and the texting form sent by the one about to leave', async () => {
  for (const c of [stay, left]) assert.equal((await w.site.call(c.A('/api/line'), { json: { transferTo: '478 555 0109', transferWhen: 'urgent', by: 'Dana' } })).status, 200);
  await callbackCall(stay, '+14785550181', 'Sue');
  await callbackCall(left, '+14785550182', 'Gus');
  const cbs = await w.all('SELECT client_id, phone, due_at, status FROM callbacks ORDER BY id');
  assert.deepEqual(cbs.map(r => [r.client_id, r.phone, r.status]), [[stay.cid, '+14785550181', 'pending'], [left.cid, '+14785550182', 'pending']]);
  due = Date.parse(cbs[1].due_at);
  const r = await w.site.call(left.A('/texting'), { form: TEXTING });
  assert.equal(r.status, 200);
  assert.deepEqual(await w.get('SELECT status, step FROM a2p_reg WHERE client_id = ?1', left.cid), { status: 'submitted', step: 'profile' });
  assert.equal(reg.length, 0, 'nothing has gone to Twilio for the registration yet');
});

test('Stripe says the subscription is over: the app is off and Max is off the air', async () => {
  ck.add(10 * 60e3);
  w.S.subs.get(left.sub).status = 'canceled';
  assert.equal((await w.event('customer.subscription.deleted', { id: left.sub, status: 'canceled' })).status, 200);
  assert.equal((await w.get('SELECT active FROM app_clients WHERE client_id = ?1', left.cid)).active, 0);
  assert.equal((await w.get('SELECT on_air FROM voice_lines WHERE client_id = ?1', left.cid)).on_air, 0);
  assert.equal((await w.site.call(left.A('/api/state'))).status, 404, 'the owner can no longer open the app');
});

test('BUG 2: a call to the ended line is not put through to the old client\'s phone', async () => {
  const r = await w.hook('in', { CallSid: w.newSid(), To: left.number, From: '+14785550199' });
  assert.doesNotMatch(r.text, /<Dial/, 'the ended line still forwards callers to the owner at our cost: ' + r.text.replace(/^<\?xml[^>]*>/, ''));
});

test('the every-10-minutes job, from just after the cancellation until the call-back time has passed', async () => {
  for (let t = ck.now() + 10 * 60e3; t <= due + 30 * 60e3; t += 10 * 60e3) { ck.set(t); await w.cron(); }
  const dials = w.world.dialed.filter(d => /\/voice\/out\//.test(d.Url)).map(d => [d.To, d.From]);
  assert.ok(dials.some(d => d[0] === '+14785550181' && d[1] === stay.number), 'control: for the paying client, Max phones Sue when the owner misses the promised time');
});

test('BUG 1: Max does not phone the customers of a business that is no longer a client', () => {
  const dials = w.world.dialed.filter(d => /\/voice\/out\//.test(d.Url) && d.From === left.number).map(d => d.To + ' from ' + d.From);
  assert.deepEqual(dials, [], 'after the subscription ended, Max phoned the old client\'s customer to set a new call-back time');
});

test('BUG 3: nothing more is filed with carriers for a business that left before its texting registration began', async () => {
  const fees = reg.filter(x => x.method === 'POST' && /a2p\/BrandRegistrations$|Compliance\/Usa2p$/.test(x.what)).map(x => x.what);
  assert.deepEqual({ requestsToTwilio: reg.length, feeSteps: fees }, { requestsToTwilio: 0, feeSteps: [] },
    'every one of these was sent after the client was gone; the registration now stands at ' + JSON.stringify(await w.get('SELECT status, step FROM a2p_reg WHERE client_id = ?1', left.cid)));
});
