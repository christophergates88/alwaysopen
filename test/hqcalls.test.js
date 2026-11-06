// Gates HQ calls a business for Christopher: only approved calls dial, with the hour and daily limits; the call opens
// with the automated-assistant line, talks turn by turn, and a booking lands in his day with one push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { hqCallsTick, hqcAnswer, hqcTurn, hqcStatus, ensureHqCalls } from '../src/hqcalls.js';

const SID = 'CA' + 'b'.repeat(32);
const NOON = Date.parse('2026-11-06T17:00:00Z');   // 12 PM Eastern
const u = (k, id) => new URL('https://alwaysopenoffice.com/voice/' + k + '/k?id=' + id);
let replies = [], dials = [], pushes = [];
function env() {
  const DB = makeDB();
  globalThis.fetch = async (url, o) => {
    url = String(url);
    if (url.includes('twilio.com')) { dials.push(Object.fromEntries(new URLSearchParams(o.body))); return new Response(JSON.stringify({ sid: SID }), { status: 201 }); }
    if (url.includes('anthropic.com')) { const r = replies.shift(); return r ? new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(r) }] })) : new Response('x', { status: 500 }); }
    if (url.includes('ntfy')) { pushes.push(o.body); return new Response('ok'); }
    return new Response('{}');
  };
  return { DB, VOICE_KEY: 'k', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'x', NTFY_URL: 'https://ntfy.sh/test' };
}
async function add(e, o) {
  await ensureHqCalls(e);
  await e.DB.prepare("INSERT INTO hq_calls_out (at, number, business, goal, avail, status, approved_at) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)")
    .bind(new Date(NOON).toISOString(), o.number || '+14784530000', o.business || 'Take 5 Milledgeville', o.goal || 'Book an oil change Saturday morning.', o.status || 'approved', new Date(NOON - 60e3).toISOString()).run();
}
const form = o => new URLSearchParams(Object.assign({ CallSid: SID }, o));

test('a draft never dials; an approved call dials once, from the Always Open line', async () => {
  dials = []; const e = env();
  await add(e, { status: 'draft' });
  assert.equal(await hqCallsTick(e, NOON), 0);
  await e.DB.prepare("UPDATE hq_calls_out SET status = 'approved'").run();
  assert.equal(await hqCallsTick(e, NOON), 1);
  assert.equal(dials[0].From, '+17064602226'); assert.equal(dials[0].To, '+14784530000'); assert.equal(dials[0].TimeLimit, '600');
  assert.equal(await hqCallsTick(e, NOON), 0, 'one call at a time');
});

test('no calls at night; his own number is refused', async () => {
  dials = []; const e = env();
  await add(e, {});
  assert.equal(await hqCallsTick(e, Date.parse('2026-11-07T03:00:00Z')), 0);   // 10 PM Eastern: waits
  assert.equal(dials.length, 0);
  const e2 = env(); await add(e2, { number: '+14783652533' });
  await hqCallsTick(e2, NOON);
  const r = await e2.DB.prepare('SELECT status, result FROM hq_calls_out').first();
  assert.equal(r.status, 'failed'); assert.match(r.result, /can’t be called/);
});

test('the call opens as an automated assistant, books, and lands in his day with one push', async () => {
  dials = []; pushes = []; const e = env();
  await add(e, {}); await hqCallsTick(e, NOON);
  replies = [{ say: 'Hi, this is an automated assistant calling for Christopher Gates. He’d like an oil change Saturday morning.', end: false }];
  const a = await (await hqcAnswer(e, u('hqc', 1), form({}))).text();
  assert.match(a, /automated assistant calling for Christopher Gates/); assert.match(a, /<Gather input="speech"/);
  replies = [{ say: 'Great, Saturday at 9:30 for $89.99. Thank you!', end: true, outcome: 'done', summary: 'Booked Saturday 9:30 AM, $89.99.', booked: { date: '2026-11-07', t: '09:30', what: 'Oil change at Take 5', place: 'Milledgeville', price: 89.99 } }];
  const t = await (await hqcTurn(e, u('hqcg', 1), form({ SpeechResult: 'We can do 9:30 Saturday, 89.99.' }))).text();
  assert.match(t, /<Hangup\/>/);
  const r = await e.DB.prepare('SELECT * FROM hq_calls_out').first();
  assert.equal(r.status, 'done'); assert.match(r.summary, /9:30/);
  const p = await e.DB.prepare("SELECT * FROM hq_plans WHERE key = 'callout-1'").first();
  assert.equal(p.date, '2026-11-07'); assert.equal(p.t, '09:30'); assert.equal(p.src, 'call');
  assert.equal(pushes.length, 1);
  await hqcStatus(e, u('hqcstatus', 1), form({ CallStatus: 'completed' }));
  assert.equal(pushes.length, 1, 'no second push');
});

test('voicemail leaves a short callback note; no answer is reported', async () => {
  const e = env(); await add(e, {}); await hqCallsTick(e, NOON);
  const v = await (await hqcAnswer(e, u('hqc', 1), form({ AnsweredBy: 'machine_start' }))).text();
  assert.match(v, /call him back at 4 7 8/);
  const e2 = env(); await add(e2, {}); await hqCallsTick(e2, NOON);
  await hqcStatus(e2, u('hqcstatus', 1), form({ CallStatus: 'no-answer' }));
  assert.match((await e2.DB.prepare('SELECT summary FROM hq_calls_out').first()).summary, /Nobody answered/);
});

test('a wrong call SID gets a hang-up, not the conversation', async () => {
  const e = env(); await add(e, {}); await hqCallsTick(e, NOON);
  assert.match(await (await hqcAnswer(e, u('hqc', 1), form({ CallSid: 'CA' + 'c'.repeat(32) }))).text(), /<Response><Hangup\/>/);
});
