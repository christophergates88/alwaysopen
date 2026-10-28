// The dress rehearsal: one made-up business goes through Always Open from sign-up to its first report.
// It runs the real worker code against a copy of the live database layout, with Stripe, Twilio and the AI faked
// (test/rehearsal/harness.js). Nothing here touches the internet or any real account.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const { CallRoom } = await import('../src/voice.js');
env.CALLROOM = H.makeNamespace(CallRoom, env);
const site = H.makeClient(worker, env);
const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;

const CUSTOMER = { plan: 'Growth', max: '1', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' };
let sessionId = '', cid = '', code = '', lineNumber = '';
const S = {};   // things carried from one step to the next

test('the sign-up page opens and sets Stripe up by itself the first time', async () => {
  const r = await site.call('/start?plan=Growth');
  assert.equal(r.status, 200);
  assert.match(r.text, /Start Always Open today/);
  for (const p of ['Starter', 'Growth', 'Pro']) assert.match(r.text, new RegExp(p));
  const w = await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'");
  assert.ok(w && w.v, 'the Stripe webhook secret was saved');
});

test('the home page and the legal pages are served', async () => {
  for (const p of ['/', '/terms', '/privacy']) { const r = await site.call(p); assert.equal(r.status, 200, p); }
});

test('sign-up rejects an empty form and a missing agreement', async () => {
  const a = await site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, { business: '' }) });
  assert.match(a.text, /fill in every box/);
  const b = await site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, { agree: '' }) });
  assert.match(b.text, /agree to the terms/);
  assert.equal((await all('SELECT * FROM billing')).length, 0);
});

test('checkout sends the customer to Stripe with the right plan and nothing leaks', async () => {
  const r = await site.call('/billing/checkout', { form: CUSTOMER });
  assert.equal(r.status, 303);
  assert.match(r.location, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  sessionId = r.location.split('/').pop();
  const s = world.sessions.get(sessionId);
  assert.equal(s.metadata.plan, 'Growth');
  assert.equal(s.metadata.business, 'Sinclair Plumbing');
  assert.equal(s.metadata.max, '1');
  const prices = s._items.filter(([k]) => /unit_amount/.test(k)).map(([, v]) => v);
  assert.deepEqual(prices, ['29900', '14900'], 'Growth plus the extra Max minutes');
});

test('a Stripe outage on checkout shows a plain message, not a crash', async () => {
  world.fail.stripe = true;
  const r = await site.call('/billing/checkout', { form: CUSTOMER });
  world.fail.stripe = false;
  assert.equal(r.status, 200);
  assert.match(r.text, /Payment could not start/);
});

test('Stripe tells us the payment worked: the client, the app and Max’s line all appear', async () => {
  const s = world.sessions.get(sessionId);
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
  const secret = (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
  const r = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
  assert.equal(r.status, 200, r.text);
  const b = await get('SELECT * FROM billing WHERE session_id = ?1', sessionId);
  assert.ok(b, 'billing row');
  cid = b.client_id; code = b.code;
  assert.equal(b.plan, 'Growth'); assert.equal(b.max, 1); assert.equal(b.status, 'active');
  assert.equal(b.email, 'dana@sinclairplumbing.example');
  const c = await get('SELECT * FROM app_clients WHERE client_id = ?1', cid);
  assert.equal(c.active, 1); assert.equal(c.tier, 'Growth'); assert.equal(c.owner_first, 'Dana'); assert.equal(c.regulated, 0);
  assert.equal(c.feats, 'calls', 'the phone line is on in the app from the first minute');
  const p = await get('SELECT * FROM provision WHERE client_id = ?1', cid);
  assert.equal(p.status, 'live', 'Max’s line was bought and connected: ' + (p && p.error));
  const line = await get('SELECT * FROM voice_lines WHERE client_id = ?1', cid);
  assert.equal(line.on_air, 1);
  assert.equal(line.industry, 'plumbing');
  lineNumber = line.number;
  assert.match(lineNumber, /^\+1478555\d{4}$/, 'a number near the owner (478)');
  assert.equal(world.bought.length, 1);
  assert.match(world.bought[0].VoiceUrl, /\/voice\/in\//);
  assert.match(world.bought[0].SmsUrl, /\/voice\/sms\//);
  assert.ok(world.pushes.some(x => /New signup/.test(x.title)), 'Christopher got a push about the signup');
  assert.ok(world.pushes.some(x => /Max is live/.test(x.title)), 'and one that Max is live');
});

test('the same Stripe event arriving twice does not make a second client or buy a second number', async () => {
  const s = world.sessions.get(sessionId);
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
  const secret = (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
  const r = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body) } });
  assert.equal(r.status, 200);
  assert.equal((await all('SELECT * FROM billing')).length, 1);
  assert.equal((await all('SELECT * FROM app_clients')).length, 1);
  assert.equal(world.bought.length, 1);
});

test('a forged Stripe event is refused', async () => {
  const body = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { id: 'cs_evil', mode: 'subscription', metadata: { plan: 'Pro', business: 'Evil Co' } } } });
  const r = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': 't=1,v1=deadbeef' } });
  assert.equal(r.status, 400);
  assert.equal((await all("SELECT * FROM billing WHERE business = 'Evil Co'")).length, 0);
});

test('the welcome page shows the private link, Max’s number and the next steps', async () => {
  world.places = { places: [] };
  const r = await site.call('/welcome?s=' + sessionId);
  assert.equal(r.status, 200);
  assert.match(r.text, /Welcome to Always Open, Dana/);
  assert.ok(r.text.includes('/app/' + code), 'the private app link is on the page');
  const n = lineNumber.replace('+1', '');
  assert.ok(r.text.includes('(' + n.slice(0, 3) + ') ' + n.slice(3, 6) + '-' + n.slice(6)), 'Max’s number is on the page');
  assert.match(r.text, /Forward the calls you miss/);
  assert.match(r.text, /Register for texting/);
  assert.match(r.text, /hello@alwaysopenoffice\.com/);
  assert.equal(world.bought.length, 1, 'opening the welcome page does not buy another number');
});

test('the welcome page for a made-up or unpaid session says so', async () => {
  const bad = await site.call('/welcome?s=cs_test_doesnotexist12345');
  assert.ok(bad.status === 502 || bad.status === 404, 'status ' + bad.status);
  const none = await site.call('/welcome?s=nonsense');
  assert.equal(none.status, 404);
});

test('the client’s app opens with their private link and not without it', async () => {
  const page = await site.call('/app/' + code);
  assert.equal(page.status, 200);
  assert.match(page.text, /Sinclair Plumbing/);
  const wrong = await site.call('/app/' + 'x'.repeat(32));
  assert.equal(wrong.status, 404);
  const st = await site.call('/app/' + code + '/api/state');
  assert.equal(st.status, 200, st.text.slice(0, 300));
  S.state = st.json();
  assert.equal(S.state.ok, true);
  assert.equal(S.state.client.business, 'Sinclair Plumbing');
  assert.equal(S.state.client.tier, 'Growth');
  assert.equal(S.state.features.calls, true);
  assert.equal(S.state.features.line, true);
  assert.ok(S.state.line, 'Max’s line shows in the app');
  assert.ok(S.state.billing && S.state.billing.plan === 'Growth' && S.state.billing.max === true);
});

test('every part of the app that a new client can reach answers without an error', async () => {
  const bad = [];
  for (const p of ['/help/forwarding', '/help/google', '/help/qr', '/texting', '/billing', '/manifest.webmanifest']) {
    const r = await site.call('/app/' + code + p);
    if (r.status !== 200) bad.push(p + ' -> ' + r.status);
  }
  assert.deepEqual(bad, []);
  const fwd = await site.call('/app/' + code + '/help/forwarding');
  assert.match(fwd.text, /\*71/); assert.match(fwd.text, /\*\*61\*/);
  const n = lineNumber.replace('+1', '');
  assert.ok(fwd.text.includes('(' + n.slice(0, 3) + ') ' + n.slice(3, 6) + '-' + n.slice(6)));
  const st = (await site.call('/app/' + code + '/api/state')).json();
  const done = (st.onboarding && (st.onboarding.steps || st.onboarding.list || [])).filter(x => x.done).map(x => x.key || x.id || x.title);
  S.onboardingDone = done;
});


// ---------- the first week of use ----------
const nowIso = () => new Date().toISOString();
const A = p => '/app/' + code + p;
async function hqItem(id, o, forClient) {
  await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',1,0,?8,?8,0,'')")
    .bind(id, forClient || cid, o.kind || 'reply', o.title || '', o.context || '', o.stars || 0, o.text, nowIso()).run();
}
const decide = (id, action, text) => site.call(A('/api/decide'), { json: Object.assign({ id, action }, text ? { text } : {}) });

test('review replies waiting for approval: approve, edit, skip, and the Compliance Guard stops a reply that offers a perk', async () => {
  await hqItem('r1', { title: 'Pat M.', context: 'Fast and fair. Fixed our leak the same day.', stars: 5, text: 'Thank you, Pat! We are glad we could get that leak fixed for you the same day.' });
  await hqItem('r2', { title: 'Lee T.', context: 'Showed up late.', stars: 2, text: 'Sorry about the wait, Lee. Come back for a free service call and leave us a better review.' });
  await hqItem('p1', { kind: 'post', title: 'Water heater tip', text: 'Flush your water heater once a year to keep it running longer.' });
  await hqItem('other1', { title: 'Someone else', text: 'Not yours.' }, 'c-someoneelse');
  const st = (await site.call(A('/api/state'))).json();
  assert.equal(st.items.length, 3, 'three things wait for the owner, and not the other business’s');
  assert.equal(st.items.find(i => i.id === 'r2').checked, false, 'the risky reply is flagged before anyone taps');
  assert.equal(st.items.find(i => i.id === 'r1').checked, true);

  const ok = await decide('r1', 'approve');
  assert.equal(ok.status, 200); assert.equal(ok.json().status, 'approved');
  const blocked = await decide('r2', 'approve');
  assert.equal(blocked.status, 422); assert.ok(blocked.json().hits.length >= 1, 'the Guard names the problem words');
  const fixed = await decide('r2', 'approve', 'Sorry about the wait, Lee. We have talked with the crew about arrival times and would like to make it right. Please call us.');
  assert.equal(fixed.status, 200); assert.equal(fixed.json().edited, true);
  const skip = await decide('p1', 'skip');
  assert.equal(skip.status, 200);
  assert.equal((await decide('r1', 'approve')).status, 409, 'a second tap is refused politely');
  assert.equal((await decide('other1', 'approve')).status, 404, 'one client can never touch another’s items');

  const rows = await all("SELECT id, status, hq_synced, decided_by FROM app_items WHERE client_id = ?1 ORDER BY id", cid);
  assert.deepEqual(rows.map(r => r.id + ':' + r.status + ':' + r.hq_synced), ['p1:skipped:0', 'r1:approved:0', 'r2:approved:0']);
  const after = (await site.call(A('/api/state'))).json();
  assert.equal(after.items.length, 0);
  assert.equal(after.done.length, 3);
  assert.equal(world.calls.filter(c => /mybusiness|businessprofile/.test(c.url)).length, 0, 'nothing was sent to Google for a client Google cannot reach yet');
});

test('a message to the team reaches Christopher by push and email', async () => {
  const before = world.pushes.length, mails = world.mail.length;
  const r = await site.call(A('/api/message'), { json: { text: 'We are closed Monday for the holiday.', kind: 'hours' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await all('SELECT * FROM app_messages WHERE client_id = ?1', cid)).length, 1);
  assert.ok(world.pushes.length > before && world.mail.length > mails);
  assert.ok(world.pushes.at(-1).title.startsWith('Hours change'));
  assert.equal((await site.call(A('/api/message'), { json: { text: '  ' } })).status, 400);
});

test('"finished a job" adds the customer once and needs their OK to be contacted', async () => {
  const noConsent = await site.call(A('/api/job'), { json: { first: 'Sam', phone: '478-555-0188', job: 'water heater' } });
  assert.equal(noConsent.status, 400);
  const ok = await site.call(A('/api/job'), { json: { first: 'Sam', phone: '478-555-0188', job: 'water heater', consent: true } });
  assert.equal(ok.status, 200, ok.text);
  const again = await site.call(A('/api/job'), { json: { first: 'Sam', phone: '(478) 555-0188', job: 'water heater', consent: true } });
  assert.equal(again.json().duplicate, true, 'each customer gets one request');
  assert.equal((await all('SELECT * FROM app_jobs WHERE client_id = ?1', cid)).length, 1);
  assert.equal((await site.call(A('/api/job'), { json: { first: 'Kim', email: 'kim@example.com', job: 'sink', consent: true } })).status, 400, 'an emailed request needs the Google review link first, and says so');
});

// ---------- a phone call ----------
const KEY = env.VOICE_KEY;
let callN = 0;
const newSid = () => 'CA' + String(++callN).padStart(32, '0').replace(/0/g, 'a').replace(/(\d)/g, '$1');
function hook(kind, params, query) {
  const q = query ? '?' + query : '';
  const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + KEY + q;
  return site.call('/voice/' + kind + '/' + KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
}
const wsOf = sid => env.CALLROOM._rooms.get(sid);
const say = async (sid, words) => { const r = wsOf(sid); await r.room.webSocketMessage(r.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true })); };
const heard = sid => wsOf(sid).ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
async function startCall(from, extra) {
  const sid = 'CA' + (++callN).toString(16).padStart(32, '0');
  const r = await hook('in', Object.assign({ CallSid: sid, To: lineNumber, From: from }, extra || {}));
  return { sid, r };
}
async function openRoom(sid, from) {
  const room = env.CALLROOM.get(sid); const w = wsOf(sid);
  await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
}

test('a call comes in: Max answers with the disclosure, the owner sees it live, then gets a note with the details', async () => {
  world.aiScript = ['Oh no, a leak. I can get someone out to you. What is your name and the best number to reach you?', 'Thanks Dana. I will pass this to the team, and someone will call you back today. Anything else I should tell them? [END]'];
  world.aiNote = { name: 'Dana', callback: '+14785550142', reason: 'Leaking water heater', details: 'Eatonton, water pooling in the garage', when: 'today', urgent: true, callback_wanted: true, callback_at: '', booked: 'yes', spam: false, summary: 'Dana has a leaking water heater in Eatonton and wants a call today.' };
  const { sid, r } = await startCall('+14785550142');
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /<ConversationRelay/);
  const greet = r.text.match(/welcomeGreeting="([^"]*)"/)[1];
  S.greeting = greet;
  assert.match(greet, /Sinclair Plumbing/);
  assert.match(greet, /record/i, 'the greeting says the call may be recorded');
  assert.match(greet, /(\bAI\b|S\.I\.|\bSI\b|automated|virtual|assistant)/i, 'the greeting says it is not a person');
  const row = await get('SELECT * FROM app_calls WHERE id = ?1', sid);
  assert.equal(row.outcome, 'live'); assert.equal(row.client_id, cid); assert.equal(row.test, 0);
  S.callSid = sid;

  await openRoom(sid, '+14785550142');
  const realNow = Date.now; Date.now = () => realNow() + 2500; // the live snapshot writes at most every 1.5 s; callers speak after the greeting, so the first words land after that
  await say(sid, 'Hi, my water heater is leaking all over the garage. I am in Eatonton.');
  const live = (await site.call(A('/api/state'))).json();
  assert.equal(live.live.length, 1, 'the live call card shows while Max is on the phone');
  assert.match(live.live[0].heard, /water heater/);
  await say(sid, 'It is Dana, four seven eight, five five five, zero one four two.');
  Date.now = realNow;
  const said = heard(sid);
  assert.match(said, /leak/); assert.match(said, /call you back/);

  const end = await hook('after', { CallSid: sid, SessionDuration: '95', SessionStatus: 'ended' });
  assert.equal(end.status, 200); assert.match(end.text, /<Hangup\/>/);
  await site.settle();
  const done = await get('SELECT * FROM app_calls WHERE id = ?1', sid);
  assert.equal(done.outcome, 'done');
  assert.equal(done.caller_name, 'Dana'); assert.equal(done.callback, '+14785550142'); assert.equal(done.urgency, 'urgent');
  assert.equal(done.turns, 2);
  assert.match(done.summary, /leaking water heater/);
  const tr = JSON.parse(done.transcript);
  assert.ok(tr.some(x => x.w === 'caller') && tr.some(x => x.w === 'ai'));
  assert.equal(await get('SELECT * FROM call_live WHERE id = ?1', sid), null, 'the live card is cleared when the call ends');
  const st = (await site.call(A('/api/state'))).json();
  assert.equal(st.live.length, 0);
  assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0].callbackText, '478-555-0142');
  assert.equal(st.calls[0].urgent, true);
  assert.equal(st.results.calls, 1, 'the call counts on the Results tab');
  const g = await get('SELECT * FROM call_grades WHERE id = ?1', sid);
  assert.ok(g, 'the call was graded');
  assert.equal(g.hangup_early, 0); assert.equal(g.spam, 0); assert.equal(g.turns, 2);
  assert.deepEqual(st.maxStats, { days: 30, calls: 1, booked: g.booked, hungUp: 0 }, 'the owner sees the 30-day line on the Max tab');
  S.callBack = await all('SELECT * FROM callbacks WHERE client_id = ?1', cid);
  // Twilio's own call-status ping afterwards changes nothing but the billed length
  await hook('status', { CallSid: sid, CallStatus: 'completed', CallDuration: '97' });
  assert.equal((await get('SELECT seconds FROM app_calls WHERE id = ?1', sid)).seconds, 97);
});

test('a caller who hangs up with nothing said is logged, and no text goes out until the business has its own texting registration', async () => {
  const { sid, r } = await startCall('+14785550177');
  assert.match(r.text, /ConversationRelay/);
  await openRoom(sid, '+14785550177');
  await hook('after', { CallSid: sid, SessionDuration: '4', SessionStatus: 'ended' });
  await site.settle();
  const row = await get('SELECT * FROM app_calls WHERE id = ?1', sid);
  assert.equal(row.outcome, 'hangup');
  assert.match(row.summary, /hung up/);
  assert.equal(world.texts.length, 0, 'no text-back for a business with no carrier registration');
  const log = await all("SELECT status, why FROM sms_log WHERE client_id = ?1 AND kind = 'textback'", cid);
  assert.deepEqual(log.map(l => l.why), ['not registered']);
});

test('once the business’s texting registration is approved, a hang-up gets one text back and the note says so', async () => {
  const mg = 'MG' + 'c'.repeat(32);
  const reg = await site.call('/ops/sms-brand', { json: { client: cid, mg, status: 'approved' }, headers: { 'x-key': env.LEADS_KEY } });
  assert.equal(reg.status, 200);
  const { sid } = await startCall('+14785550166');
  await openRoom(sid, '+14785550166');
  await hook('after', { CallSid: sid, SessionDuration: '3', SessionStatus: 'ended' });
  await site.settle();
  assert.equal(world.texts.length, 1);
  assert.equal(world.texts[0].To, '+14785550166');
  assert.equal(world.texts[0].MessagingServiceSid, mg);
  assert.equal(world.texts[0].From, lineNumber, 'it comes from the business’s own number, so replies reach their line');
  assert.match(world.texts[0].Body, /Sinclair Plumbing/); assert.match(world.texts[0].Body, /STOP/);
  const row = await get('SELECT summary FROM app_calls WHERE id = ?1', sid);
  assert.match(row.summary, /We texted them back/, 'the owner’s note says a text went out');
});

test('a number the owner listed as a tester is marked as a test: no live card, not counted', async () => {
  await DB.prepare("UPDATE voice_lines SET facts = ?1 WHERE client_id = ?2").bind(JSON.stringify({ testers: '+14785550101' }), cid).run();
  const before = (await site.call(A('/api/state'))).json().calls.length;
  const { sid } = await startCall('+14785550101');
  assert.equal((await get('SELECT test FROM app_calls WHERE id = ?1', sid)).test, 1);
  const st = (await site.call(A('/api/state'))).json();
  assert.equal(st.live.length, 0);
  await openRoom(sid, '+14785550101');
  await hook('after', { CallSid: sid, SessionDuration: '5', SessionStatus: 'ended' });
  await site.settle();
  assert.equal((await site.call(A('/api/state'))).json().calls.length, before, 'test calls stay out of the owner’s list');
});

test('a sixth call from the same number in an hour gets a short message instead of the AI', async () => {
  const caller = '+14785550199';
  for (let i = 0; i < 5; i++) await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, test) VALUES (?1,?2,?3,?4,?5,'done',0)").bind('CA' + String(900 + i).padStart(32, '0'), cid, lineNumber, nowIso(), caller).run();
  const { r } = await startCall(caller);
  assert.doesNotMatch(r.text, /ConversationRelay/);
  assert.match(r.text, /call you back/);
});

test('a text to the business line: a customer’s message lands in the inbox, STOP is honored, START brings them back', async () => {
  const from = '+14785550188';
  const t = (body) => hook('sms', { From: from, To: lineNumber, Body: body, MessageSid: 'SM' + Math.random().toString(16).slice(2).padEnd(32, '0') });
  await t('Hi, do you do water softeners?');
  assert.equal((await all("SELECT * FROM biz_msgs WHERE client_id = ?1 AND dir = 'in'", cid)).length, 1);
  await t('STOP');
  assert.equal((await all('SELECT * FROM sms_optout WHERE client_id = ?1', cid)).length, 1);
  const r = await t('START');
  assert.match(r.text, /back on the list/);
  assert.equal((await all('SELECT * FROM sms_optout WHERE client_id = ?1', cid)).length, 0);
});

test('a forged call webhook (bad Twilio signature) is refused', async () => {
  const r = await site.call('/voice/in/' + KEY, { form: { CallSid: 'CA' + 'e'.repeat(32), To: lineNumber, From: '+14785550123' }, headers: { 'x-twilio-signature': 'bogus' } });
  assert.equal(r.status, 403);
  const r2 = await site.call('/voice/in/wrong-key', { form: { CallSid: 'CA' + 'e'.repeat(32) } });
  assert.equal(r2.status, 404);
});

// ---------- the first monthly report ----------
test('next month, the first report is written once, from what actually happened, and the client is told', async () => {
  const { monthReportCron } = await import('../src/report.js');
  const d = new Date(), at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 3, 15);
  const first = await monthReportCron(env, at);
  assert.equal(first.made, 1, JSON.stringify(first));
  const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 7);
  const m = await get('SELECT data FROM app_months WHERE client_id = ?1 AND month = ?2', cid, key);
  const data = JSON.parse(m.data);
  assert.equal(data.stats.reviews, 2, 'two reviews came in');
  assert.equal(data.stats.replies, 2, 'both were answered');
  assert.equal(data.stats.posts, 0, 'the skipped post is not counted as published');
  assert.match(data.note, /Max answered \d+ calls?/);
  assert.equal(data.record.revs.length, 2);
  assert.ok(data.record.revs.some(r => /Reply approved/.test(r.t)));
  const again = await monthReportCron(env, at);
  assert.equal(again.made, 0, 'a second pass does not write it again');
  assert.equal((await all('SELECT * FROM app_months WHERE client_id = ?1', cid)).length, 1);
  assert.equal((await get('SELECT result FROM report_runs WHERE client_id = ?1', cid)).result, 'made');
  const st = (await site.call(A('/api/state'))).json();
  assert.ok(st.months.some(x => x.month === key && x.record), 'the report shows in the app with its record');
});

test('card payments: when Connect is off the owner sees "coming soon"; once it is on, Connect makes an account Stripe carries the risk on', async () => {
  world.fail.connectOff = true;
  let r = await site.call(A('/api/stripe'), { json: { action: 'connect' } });
  assert.equal(r.status, 503); assert.equal(r.json().comingSoon, true);
  let st = (await site.call(A('/api/state'))).json();
  assert.equal(st.stripe.available, false, 'the step hides while Connect is off');
  // a day later it checks again by itself
  await DB.prepare("UPDATE billing_config SET v = ?1 WHERE k = 'connect_off_at'").bind(new Date(Date.now() - 25 * 3600e3).toISOString()).run();
  st = (await site.call(A('/api/state'))).json();
  assert.equal(st.stripe.available, true, 'after a day the step comes back');
  world.fail.connectOff = false;
  r = await site.call(A('/api/stripe'), { json: { action: 'connect' } });
  assert.equal(r.status, 200, r.text); assert.match(r.json().url, /^https:\/\/connect\.stripe\.com\//);
  const made = new URLSearchParams(world.stripeAccounts.at(-1));
  assert.equal(made.get('controller[losses][payments]'), 'stripe', 'Stripe, not Always Open, carries chargebacks and negative balances');
  assert.equal(made.get('controller[fees][payer]'), 'account');
  assert.equal(made.get('controller[stripe_dashboard][type]'), 'full', 'the owner gets their own full Stripe dashboard');
  assert.equal(made.get('type'), null);
  assert.equal(made.get('metadata[ao_client]'), cid);
  assert.equal(await get("SELECT v FROM billing_config WHERE k = 'connect_off'"), null);
});

test('a month written by HQ with a label inside its numbers still reaches the iPhone app as numbers only', async () => {
  // Lake Country Foam Party's October row looked like this; the app reads stats as numbers and threw the whole state away.
  const data = { label: 'August 2026', stats: { label: 'August 2026', reviews: 0, rating: null, count: null, replies: 0, posts: 0, calls: null, clicks: null, directions: null },
    prev: { label: 'July 2026', reviews: 0, rating: null }, record: { revs: [], posts: [] } };
  await DB.prepare('INSERT OR REPLACE INTO app_months (client_id, month, data, hash, updated) VALUES (?1, ?2, ?3, ?4, ?5)').bind(cid, '2026-08', JSON.stringify(data), 'hq:1', nowIso()).run();
  const st = (await site.call(A('/api/state'))).json();
  const m = st.months.find(x => x.month === '2026-08');
  assert.ok(m, 'the month is there');
  for (const [k, v] of Object.entries(m.stats)) assert.ok(v === null || typeof v === 'number', 'stats.' + k + ' is a number or empty');
  assert.equal(m.label, 'August 2026');
  for (const mo of st.months) for (const v of Object.values(mo.stats)) assert.ok(v === null || typeof v === 'number');
});

test('Max calls the owner, asks about the business, and what he heard waits for the owner before he uses it', async () => {
  let st = (await site.call(A('/api/state'))).json();
  const teach = st.onboarding.steps.find(x => x.key === 'teach');
  assert.ok(teach && !teach.done, 'a "Teach Max" setup step is waiting');
  assert.ok(Array.isArray(st.line.know) && st.line.know.some(x => x.key === 'area'), 'the Max tab gets the questions as fields');
  const before = world.dialed.length;
  const r = await site.call(A('/api/line'), { json: { action: 'interview', phone: '478 555 0101', by: 'Dana' } });
  assert.equal(r.status, 200, r.text);
  const out = world.dialed[before];
  assert.equal(out.To, '+14785550101'); assert.equal(out.From, lineNumber);
  const id = /[?&]i=(\d+)/.exec(out.Url)[1];
  const sid = out.sid;
  const tw = await hook('iv', { CallSid: sid, From: lineNumber, To: '+14785550101', AnsweredBy: 'human' }, 'i=' + id);
  assert.match(tw.text, /<ConversationRelay/); assert.match(tw.text, /few quick questions/); assert.match(tw.text, /S\.I\./, 'Max still says he is not a person');
  world.aiNote = b => /phone interview/.test(JSON.stringify(b.system || '')) ? {
    services: 'Plumbing repairs and water heaters. We don’t do septic.', area: 'Eatonton, Madison and Greensboro, about 30 miles out.', prices: '$89 service call, waived if we do the work.',
    urgent: 'Water leaking now, or no water at all.', next: 'Dana calls back within the hour.', booking: 'Max books open times; jobs take about two hours.', intake: '', website: '', address: '',
    spanish: true, book: 'book', slot_minutes: 120 } : { name: '', callback: '', reason: 'Asked about service area', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'They asked if we come to Greensboro.', next_step: true };
  world.aiScript = ['Which towns do you cover, and how far out do you go?', 'Any prices you are happy for me to give callers?', 'Thanks, Dana. I will send this to your app so you can check it. Goodbye. [END]'];
  await openRoom(sid, '+14785550101');
  await say(sid, 'We do plumbing repairs and water heaters. No septic.');
  assert.match(JSON.stringify(world.aiSeen.at(-1).system), /on the phone with the owner/, 'Max is in interview mode, not taking a customer call');
  await say(sid, 'Eatonton, Madison and Greensboro, about thirty miles.');
  await say(sid, 'Eighty-nine dollar service call, waived if we do the work.');
  await hook('after', { CallSid: sid, SessionDuration: '150', SessionStatus: 'ended' });
  await site.settle();
  assert.equal((await get('SELECT outcome FROM app_calls WHERE id = ?1', sid)).outcome, 'interview');
  st = (await site.call(A('/api/state'))).json();
  assert.equal(st.line.pending.items.length, 6, 'what Max heard waits for the owner');
  assert.equal(st.line.know.find(x => x.key === 'area').value, '', 'nothing Max heard is used until the owner says so');
  assert.equal(st.calls.some(c => c.id === sid), false, 'the interview is not a customer call');
  const keep = await site.call(A('/api/line'), { json: { action: 'keep-facts', by: 'Dana' } });
  assert.equal(keep.status, 200, keep.text);
  st = (await site.call(A('/api/state'))).json();
  assert.equal(st.line.pending, null);
  assert.match(st.line.know.find(x => x.key === 'area').value, /Greensboro/);
  assert.equal(st.line.spanish, true, 'the owner said yes to Spanish');
  assert.equal(st.onboarding.steps.find(x => x.key === 'teach').done, true);
  const os = JSON.parse((await get('SELECT owner_set FROM voice_lines WHERE number = ?1', lineNumber)).owner_set);
  assert.deepEqual(os.book, { mode: 'book', slotMin: 120 });

  // A customer asks about the area: Max's instructions now hold the owner's answers and a plumber's intake questions.
  world.aiScript = ['Yes, we come out to Greensboro. What is going on?'];
  const c2 = await startCall('+14785550123');
  await openRoom(c2.sid, '+14785550123');
  await say(c2.sid, 'Hi, do you come out to Greensboro?');
  const sys = JSON.stringify(world.aiSeen.at(-1).system);
  assert.match(sys, /Where we work: Eatonton, Madison and Greensboro/);
  assert.match(sys, /Prices we can share: \$89 service call/);
  assert.match(sys, /is the water shut off/, 'a plumber’s intake question, since the owner gave none');
  await hook('after', { CallSid: c2.sid, SessionDuration: '30', SessionStatus: 'ended' });
  await site.settle();

  // The same answers can be typed in; unknown fields are ignored, and what is typed is used at once.
  const typed = await site.call(A('/api/line'), { json: { facts: { prices: '$99 service call', password: 'x' }, by: 'Dana' } });
  assert.equal(typed.status, 200, typed.text);
  assert.equal(typed.json().line.know.find(x => x.key === 'prices').value, '$99 service call');
  assert.equal(JSON.parse((await get('SELECT owner_set FROM voice_lines WHERE number = ?1', lineNumber)).owner_set).facts.password, undefined);
});

test('Max books a visit with no calendar connected: the owner gets a job with the time, the caller gets a text, nobody gets the same time twice', async () => {
  // The owner chose "book" on the interview call (2-hour visits). Two callers are on the line at once and both want the first time.
  const ca = await startCall('+14785550161'), cb = await startCall('+14785550162');
  await openRoom(ca.sid, '+14785550161'); await openRoom(cb.sid, '+14785550162');
  const offered = JSON.parse(JSON.stringify(wsOf(ca.sid).store.get('s').line.slots));
  assert.ok(offered.length >= 2, 'Max has open times to offer without any calendar');
  const sys = () => JSON.stringify(world.aiSeen.at(-1).system);
  world.aiNote = { name: 'Rita', callback: '+14785550161', reason: 'Clogged drain', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Rita booked a visit for a clogged drain.', next_step: true };
  world.aiScript = ['Great, Rita. You are booked for ' + offered[0].say + '. [BOOK 1 | Rita | Clogged drain]'];
  await say(ca.sid, 'Yes, the first one works. This is Rita, my kitchen drain is clogged.');
  assert.match(sys(), /Offer the first two/); assert.match(sys(), /tell them it is booked/);
  world.aiScript = ['Okay, Ben. You are booked for ' + offered[0].say + '. [BOOK 1 | Ben | Running toilet]'];
  await say(cb.sid, 'The first time is good, I am Ben, toilet keeps running.');
  const textsBefore = world.texts.length;
  await hook('after', { CallSid: ca.sid, SessionDuration: '60', SessionStatus: 'ended' });
  world.aiNote = { name: 'Ben', callback: '+14785550162', reason: 'Running toilet', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Ben wanted the same time.', next_step: false };
  await hook('after', { CallSid: cb.sid, SessionDuration: '60', SessionStatus: 'ended' });
  await site.settle();
  const books = await all("SELECT * FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled'", cid);
  assert.equal(books.filter(b => b.start === offered[0].start).length, 1, 'one booking for that time');
  const ja = await get("SELECT * FROM biz_jobs WHERE source = 'call' AND source_id = ?1", ca.sid);
  assert.equal(ja.stage, 'booked'); assert.ok(ja.title.includes(offered[0].say));
  assert.match((await get('SELECT wants FROM app_calls WHERE id = ?1', ca.sid)).wants, /^Booked: /);
  assert.match((await get('SELECT wants FROM app_calls WHERE id = ?1', cb.sid)).wants, /someone else just took/, 'the owner is told to call the second caller');
  const sent = world.texts.slice(textsBefore);
  assert.equal(sent.length, 1, 'only the caller who got the time is texted');
  assert.equal(sent[0].To, '+14785550161'); assert.match(sent[0].Body, /^Booked: .* with Sinclair Plumbing\. Reply CHANGE/);

  // The owner cancels from the job card: the time opens again and the customer hears about it.
  const cancel = await site.call(A('/api/work'), { json: { action: 'cancel-booking', id: ja.id, by: 'Dana' } });
  assert.equal(cancel.status, 200, cancel.text); assert.equal(cancel.json().told, true);
  assert.match(world.texts.at(-1).Body, /is cancelled/);
  assert.equal((await get("SELECT status FROM line_bookings WHERE call_id = ?1", ca.sid)).status, 'cancelled');
  assert.equal((await get('SELECT stage FROM biz_jobs WHERE id = ?1', ja.id)).stage, 'new');

  // Pencil-in mode, set from the app: Max never says booked, the job waits for the owner to confirm.
  const set = await site.call(A('/api/line'), { json: { booking: { mode: 'hold', slotMin: 60 }, by: 'Dana' } });
  assert.equal(set.status, 200, set.text); assert.equal(set.json().line.booking.mode, 'hold');
  const cc = await startCall('+14785550163'); await openRoom(cc.sid, '+14785550163');
  world.aiNote = { name: 'Lou', callback: '+14785550163', reason: 'Leak', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Lou penciled in a visit.', next_step: true };
  world.aiScript = ['Okay, Lou, you are penciled in and the team will confirm. [BOOK 1 | Lou | Leak]'];
  await say(cc.sid, 'First one please, this is Lou, a leak under the sink.');
  assert.match(sys(), /penciled in/); assert.match(sys(), /Never say it is booked/);
  await hook('after', { CallSid: cc.sid, SessionDuration: '40', SessionStatus: 'ended' });
  await site.settle();
  assert.equal((await get("SELECT status FROM line_bookings WHERE call_id = ?1", cc.sid)).status, 'held');
  assert.equal((await get("SELECT stage FROM biz_jobs WHERE source = 'call' AND source_id = ?1", cc.sid)).stage, 'new');
  assert.match(world.texts.at(-1).Body, /penciled in/);
});

test('after the call: one card with three switches, check-ins on by default for a plumber, and an on-the-way text from the job card', async () => {
  let st = (await site.call(A('/api/state'))).json();
  assert.deepEqual(st.after, { promise: true, textback: true, checkins: true, canText: true }, 'a plumber starts with all three on');
  const off = await site.call(A('/api/line'), { json: { after: { promise: false, checkins: false }, by: 'Dana' } });
  assert.equal(off.status, 200, off.text);
  st = (await site.call(A('/api/state'))).json();
  assert.deepEqual(st.after, { promise: false, textback: true, checkins: false, canText: true });
  // With call-back promises off, Max is not given a time to promise.
  const c = await startCall('+14785550171'); await openRoom(c.sid, '+14785550171');
  assert.equal(wsOf(c.sid).store.get('s').line.cbSlot, undefined);
  await hook('after', { CallSid: c.sid, SessionDuration: '3', SessionStatus: 'ended' }); await site.settle();
  await site.call(A('/api/line'), { json: { after: { promise: true, checkins: true }, by: 'Dana' } });
  const c2 = await startCall('+14785550172'); await openRoom(c2.sid, '+14785550172');
  assert.ok(wsOf(c2.sid).store.get('s').line.cbSlot, 'back on: Max has a call-back time inside the business hours');
  await hook('after', { CallSid: c2.sid, SessionDuration: '3', SessionStatus: 'ended' }); await site.settle();
  // On the way: a booked job with a number gets one text from the business.
  const job = await get("SELECT id FROM biz_jobs WHERE client_id = ?1 AND phone = '+14785550163'", cid);
  await site.call(A('/api/work'), { json: { action: 'stage', id: job.id, stage: 'booked', by: 'Dana' } });
  const ow = await site.call(A('/api/work'), { json: { action: 'onway', id: job.id, by: 'Dana', minutes: 20 } });
  assert.equal(ow.status, 200, ow.text);
  assert.equal(world.texts.at(-1).To, '+14785550163');
  assert.equal(world.texts.at(-1).Body, 'Dana from Sinclair Plumbing is on the way, about 20 minutes out. Reply STOP to end texts.');
});

test('hard callers: a robocall is ended in one line, two asks for a person get a transfer, an upset caller gets "I hear you" and an urgent note, a rambler gets one question, a wrong number is hidden', async () => {
  const extraOf = () => { const sys = world.aiSeen.at(-1).system; return sys.length > 1 ? sys[sys.length - 1].text : ''; };
  // Robocall: no AI at all, one line, marked spam, never shown to the owner.
  const seen = world.aiSeen.length;
  const r = await startCall('+18005550199'); await openRoom(r.sid, '+18005550199');
  await say(r.sid, 'This is a recorded message. Your Google business listing is about to be suspended. Press one to speak to a specialist.');
  assert.equal(world.aiSeen.length, seen, 'Max did not ask the AI what to say to a robocall');
  assert.match(heard(r.sid), /pass that along\. Goodbye/);
  await hook('after', { CallSid: r.sid, SessionDuration: '8', SessionStatus: 'ended' }); await site.settle();
  assert.equal((await get('SELECT outcome FROM app_calls WHERE id = ?1', r.sid)).outcome, 'spam');
  assert.equal((await site.call(A('/api/state'))).json().calls.some(c => c.id === r.sid), false);

  // Wants a person, twice: the second time Max is told to stop and put them through.
  await site.call(A('/api/line'), { json: { transferTo: '478 555 0109', transferWhen: 'urgent', by: 'Dana' } });
  const p = await startCall('+14785550181'); await openRoom(p.sid, '+14785550181');
  world.aiScript = ['I can take care of most things. What do you need?'];
  await say(p.sid, 'Can I talk to a real person please?');
  assert.doesNotMatch(extraOf(), /asked for a person twice/);
  world.aiScript = ['Sure, connecting you now. [TRANSFER]'];
  await say(p.sid, 'No, I want to speak to a real person.');
  assert.match(extraOf(), /asked for a person twice.*\[TRANSFER\]/);
  assert.equal(wsOf(p.sid).store.get('s').transfer, true, 'the call is being put through');
  const tw = await hook('after', { CallSid: p.sid, SessionDuration: '20', SessionStatus: 'ended', HandoffData: '{"reason":"transfer"}' });
  assert.match(tw.text, /<Dial[^>]*><Number[^>]*>\+14785550109<\/Number><\/Dial>/);
  await site.settle();

  // Upset: the reaction is "I hear you." or "I understand.", Max is told not to argue, and the owner's note is urgent.
  const u = await startCall('+14785550182'); await openRoom(u.sid, '+14785550182');
  world.aiScript = ['I am sorry. I will make sure Dana calls you personally today. What is the best number?'];
  world.aiNote = { name: 'Gus', callback: '+14785550182', reason: 'No call back about a leak', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'Gus is upset nobody called back.', upset: true };
  await say(u.sid, 'This is the third time I have called and nobody ever calls me back. This is ridiculous.');
  const first = wsOf(u.sid).ws.sent.filter(m => m.type === 'text')[0].token;
  assert.match(first, /^(I hear you\.|I understand\.)$/);
  assert.match(extraOf(), /caller is upset/);
  await hook('after', { CallSid: u.sid, SessionDuration: '50', SessionStatus: 'ended' }); await site.settle();
  assert.equal((await get('SELECT urgency FROM app_calls WHERE id = ?1', u.sid)).urgency, 'urgent');

  // A rambler: one question back.
  const m = await startCall('+14785550183'); await openRoom(m.sid, '+14785550183');
  world.aiScript = ['Got it. Is the water shut off right now?'];
  await say(m.sid, ('So we bought the house last spring and the previous owners had done some work on the bathroom and ever since then the water heater has been making this noise and my husband thinks it is the element but I think it might be the tank because there was a little water on the floor last week and then it dried up so we were not sure and now ').repeat(2));
  assert.match(extraOf(), /said a lot at once/);
  world.aiNote = { name: '', callback: '', reason: 'Wrong number', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'They wanted the pizza place.', wrong_number: true };
  await hook('after', { CallSid: m.sid, SessionDuration: '40', SessionStatus: 'ended' }); await site.settle();
  const wn = await get('SELECT outcome, reason FROM app_calls WHERE id = ?1', m.sid);
  assert.deepEqual([wn.outcome, wn.reason], ['spam', 'Wrong number'], 'a wrong number is kept out of the owner’s list');
});

test('peek: what the Home screen gets for the map and the upgrades', async t => {
  const st = (await site.call(A('/api/state'))).json();
  t.diagnostic('map: ' + JSON.stringify(st.map));
  t.diagnostic('upgrades: ' + JSON.stringify(st.upgrades && st.upgrades.list.map(u => u.id + ':' + u.fit)));
});
