// Checks and balances: owners reminded about drafts, new clients nudged to forward calls, client messages answered,
// spending spikes caught, paying matched with served, texts and mail records watched, chargebacks flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const C = await import('../src/checks.js');

const DAY = 864e5, HR = 3600e3;
const NOW = Date.parse('2026-10-29T15:00:00Z');     // Thursday 11 AM Eastern
const NIGHT = Date.parse('2026-10-30T03:00:00Z');   // 11 PM Eastern
const iso = t => new Date(t).toISOString();
async function setup() {
  const DB = H.makeDB(), env = { DB, BUSINESS_ADDRESS: '103 W Sumter St, Eatonton, GA 31024' };
  await C.ensureChecks(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, owner_first, active) VALUES ('c1', 'h1', 'Quillen Plumbing', 'Sam', 1), ('c2', 'h2', 'Larkspur Salon', '', 1), ('demo-plumbing', 'h3', 'Demo', '', 1)").run();
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business, owner, email, code, created, customer) VALUES ('c2', 'sub_2', 'active', 'Larkspur Salon', 'Jess Moore', 'jess@example.com', 'CODE2', ?1, 'cus_2')").bind(iso(NOW - 40 * DAY)).run();
  return { DB, env };
}
const item = (DB, id, cid, kind, stars, ago) => DB.prepare("INSERT INTO app_items (id, client_id, kind, title, stars, text, status, created) VALUES (?1, ?2, ?3, 'x', ?4, 'Thanks!', 'pending', ?5)").bind(id, cid, kind, stars, iso(NOW - ago)).run();

test('business hours and the promised reply time', () => {
  assert.equal(C.businessHours(Date.parse('2026-10-29T13:00:00Z'), Date.parse('2026-10-29T17:00:00Z')), 4, '9 AM to 1 PM Thursday');
  assert.equal(C.businessHours(Date.parse('2026-10-30T20:00:00Z'), Date.parse('2026-11-02T15:00:00Z')), 2, 'Friday 4 PM to Monday 10 AM: one hour Friday, one Monday');
  assert.equal(C.replyBy(NOW), 'Katie will reply within a few hours.');
  assert.equal(C.replyBy(NIGHT), 'Katie will reply by 10 AM tomorrow.');
  assert.equal(C.replyBy(Date.parse('2026-10-31T16:00:00Z')), 'Katie will reply by 10 AM Monday.', 'Saturday noon');
});

test('drafts waiting on an owner: reminded at 1 and 3 days (a low review after 6 hours), by push or else by email, never at night', async () => {
  const { DB, env } = await setup();
  await item(DB, 'r:1', 'c1', 'reply', 5, 26 * HR);
  await item(DB, 'r:2', 'c1', 'post', 0, 2 * HR);
  await item(DB, 'r:3', 'c2', 'reply', 2, 7 * HR);
  await item(DB, 'r:4', 'demo-plumbing', 'reply', 1, 9 * DAY);
  const pushes = [], mails = [];
  const h = { pushClient: async (cid, n) => { if (cid === 'c1') { pushes.push(cid + ' | ' + n.aps.alert.title + ' | ' + n.aps.alert.body); return 1; } return 0; }, mail: async (to, s, t) => { mails.push(to + ' | ' + s + ' | ' + t); return 'sent'; } };
  assert.deepEqual(await C.approvalNudges(env, NIGHT, h), { skipped: 'night' });
  const r = await C.approvalNudges(env, NOW, h);
  assert.deepEqual(r.nudged.map(x => [x.client, x.level, x.via]).sort(), [['c1', 1, 'push'], ['c2', 1, 'email']]);
  assert.match(pushes[0], /^c1 \| 2 things are waiting for your OK \| 2 replies and posts waiting, the oldest from Wednesday\. Open the app/);
  assert.match(mails[0], /^jess@example\.com \| A 2-star review is waiting for your OK \| Hi Jess,\n\nOur reply is ready\. Answering it today/);
  assert.match(mails[0], /https:\/\/alwaysopenoffice\.com\/app\/CODE2/);
  assert.deepEqual((await C.approvalNudges(env, NOW + HR, h)).nudged, [], 'once per level');
  const later = await C.approvalNudges(env, NOW + 2 * DAY, h);
  assert.deepEqual(later.nudged.map(x => [x.client, x.level]).sort(), [['c1', 2], ['c2', 1]].slice(0, 1).concat(later.nudged.find(x => x.client === 'c2') ? [['c2', 2]] : []).sort());
  const m = await C.morningChecks(env, NOW + 3 * DAY);
  assert.match(m, /^Waiting on owners: Quillen Plumbing \(2, oldest 4 days\), Larkspur Salon \(1, oldest 3 days\)\./);
  assert.doesNotMatch(m, /Demo/);
});

test('a new client whose line has had no calls: nudged on day 2 and day 5 with the steps, Christopher told on day 7', async () => {
  const { DB, env } = await setup();
  await DB.prepare("CREATE TABLE IF NOT EXISTS provision (client_id TEXT PRIMARY KEY, status TEXT DEFAULT 'queued', number TEXT DEFAULT '', number_sid TEXT DEFAULT '', tries INTEGER DEFAULT 0, error TEXT DEFAULT '', created TEXT, updated TEXT, ended TEXT DEFAULT '', warned TEXT DEFAULT '')").run();
  await DB.prepare("INSERT INTO provision (client_id, status, number, created) VALUES ('c2', 'live', '+14785551002', ?1), ('c1', 'live', '+14785551001', ?1)").bind(iso(NOW - 2.2 * DAY)).run();
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, test) VALUES ('CA1', 'c1', '+14785551001', ?1, '+14785550142', 'done', 0)").bind(iso(NOW - DAY)).run();
  const mails = [], pings = [];
  const h = { pushClient: async () => 0, mail: async (to, s, t) => { mails.push(s + ' | ' + t); return 'sent'; }, ping: async (t, b) => pings.push(t + ' | ' + b) };
  let r = await C.setupNudges(env, NOW, h);
  assert.deepEqual(r.nudged, [{ client: 'c2', step: 1, via: 'email' }], 'Quillen has had a real call, so only Larkspur');
  assert.match(mails[0], /^Max hasn’t had a call yet \| Hi Jess,\n\nForward your missed calls to Max’s line, \(478\) 555-1002/);
  assert.match(mails[0], /https:\/\/alwaysopenoffice\.com\/app\/CODE2\/help\/forwarding/);
  assert.deepEqual((await C.setupNudges(env, NOW + 2 * HR, h)).nudged, [], 'not twice');
  r = await C.setupNudges(env, NOW + 3 * DAY, h);
  assert.equal(r.nudged[0].step, 2);
  assert.match(mails[1], /^Your missed calls still aren’t reaching Max/);
  await C.setupNudges(env, NOW + 5 * DAY, h);
  assert.match(pings[0], /^Always Open: Larkspur Salon has had no calls in a week \|/);
  assert.match(await C.morningChecks(env, NOW + 5 * DAY), /No calls yet, forwarding probably off: Larkspur Salon\./);
});

test('client messages: one automatic note, then Christopher after 4 business hours with no answer; an answer stops it', async () => {
  const { DB, env } = await setup();
  const msg = (cid, text, at) => DB.prepare("INSERT INTO app_messages (client_id, at, by, text, dir) VALUES (?1, ?2, 'Sam', ?3, 'in')").bind(cid, iso(at), text).run();
  const t0 = Date.parse('2026-10-29T13:30:00Z');   // 9:30 AM Thursday
  await msg('c1', 'Can you change our Sunday hours?', t0);
  assert.equal(await C.ackMessage(env, 'c1', 'Sam Quillen', t0), 'Got it, Sam. Katie will reply within a few hours.');
  assert.equal(await C.ackMessage(env, 'c1', 'Sam', t0 + 60e3), '', 'once every 4 hours');
  await msg('c2', 'Hello?', t0);
  await DB.prepare("INSERT INTO app_messages (client_id, at, by, text, dir) VALUES ('c2', ?1, 'Katie', 'Hi Jess, done.', 'out')").bind(iso(t0 + HR)).run();
  const pings = [];
  const h = { ping: async (t, b) => pings.push(t + ' | ' + b) };
  assert.deepEqual(await C.messageTimer(env, t0 + 3 * HR, h), { reminded: 0 });
  assert.deepEqual(await C.messageTimer(env, t0 + 4.5 * HR, h), { reminded: 1 }, 'the automatic note is not an answer');
  assert.match(pings[0], /^Always Open: 1 client message waiting over 4 business hours \| Quillen Plumbing \(Sam\): Can you change our Sunday hours\?/);
  assert.deepEqual(await C.messageTimer(env, t0 + 5 * HR, h), { reminded: 0 }, 'once');
  assert.match(await C.morningChecks(env, Date.parse('2026-10-30T15:00:00Z')), /Unanswered client messages: Quillen Plumbing\./, 'a business day later');
});

test('spending: a day three times normal is one alert; a normal day is nothing', async () => {
  const { DB, env } = await setup();
  for (let d = 1; d <= 8; d++) for (let i = 0; i < 20; i++) await DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('c1', '4785550142', ?1, 'textback', 'queued')").bind(iso(NOW - d * DAY - (i + 1) * 60e3)).run();
  const alerts = [];
  const h = { alert: async (t, d) => alerts.push(t + ' | ' + d) };
  let r = await C.spendWatch(env, NOW, h);
  assert.equal(r.texts.today, 0); assert.equal(alerts.length, 0);
  for (let i = 0; i < 200; i++) await DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('c1', '4785550142', ?1, 'revive', 'queued')").bind(iso(NOW - (i + 1) * 60e3)).run();
  r = await C.spendWatch(env, NOW, h);
  assert.deepEqual([r.texts.today, r.texts.normal, r.texts.alert], [200, 20, true]);
  assert.match(alerts[0], /^spend:texts \| Spending spike: 200 texts sent in the last 24 hours, against about 20 on a normal day\./);
  await C.spendWatch(env, NOW + HR, h);
  assert.equal(alerts.length, 1, 'once a day');
});

test('the hourly text ceiling holds automatic texts, never what an owner types', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const S = await import('../src/sms.js');
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785551001', 'c1', 'Quillen Plumbing', 1)").run();
  await S.setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await S.ensureSms(env);
  for (let i = 0; i < 60; i++) await DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('c1', '4785550142', ?1, 'textback', 'queued')").bind(iso(Date.now() - i * 30e3)).run();
  const held = await S.sendText(env, { clientId: 'c1', to: '+14785550199', body: 'Sorry we missed you.', kind: 'textback' });
  assert.deepEqual(held, { ok: false, why: 'held: hourly ceiling', retry: true });
  assert.ok(world.pushes.some(p => /text-ceiling/.test(p.title)), 'Christopher hears about it');
  const typed = await S.sendText(env, { clientId: 'c1', to: '+14785550199', body: 'On my way.', kind: 'reply' });
  assert.equal(typed.ok, true);
});

test('paying and served: Stripe’s word wins; a confirmed cancellation is turned off, the rest are notes', async () => {
  const { DB, env } = await setup();
  env.STRIPE_KEY = 'sk_test_x';
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business, created, updated) VALUES ('c1', 'sub_1', 'active', 'Quillen Plumbing', ?1, ?1)").bind(iso(NOW - 60 * DAY)).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785551001', 'c1', 'Quillen Plumbing', 1)").run();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c3', 'h4', 'Pickard Auto', 0)").run();
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business, created, updated) VALUES ('c3', 'sub_3', 'active', 'Pickard Auto', ?1, ?1)").bind(iso(NOW - 60 * DAY)).run();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c4', 'h5', 'Kessler Marine', 1)").run();
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business, created, updated) VALUES ('c4', 'sub_4', 'past_due', 'Kessler Marine', ?1, ?2)").bind(iso(NOW - 90 * DAY), iso(NOW - 20 * DAY)).run();
  await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('webhook_id', 'we_1')").run().catch(async () => { await DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run(); await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('webhook_id', 'we_1')").run(); });
  const status = { sub_1: 'canceled', sub_2: 'active', sub_3: 'active', sub_4: 'past_due' };
  const calls = [];
  const stripe = async (e, m, p, b) => {
    calls.push(m + ' ' + p);
    if (p === 'webhook_endpoints/we_1' && m === 'GET') return { enabled_events: ['checkout.session.completed', 'invoice.payment_failed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted'] };
    if (p === 'webhook_endpoints/we_1' && m === 'POST') { calls.push('events ' + b.enabled_events.join(',')); return {}; }
    const s = p.replace('subscriptions/', ''); return { status: status[s] };
  };
  const pings = [];
  const r = await C.payingServed(env, NOW, { stripe, ping: async (t, b) => pings.push(t + ' | ' + b) });
  assert.deepEqual(r.fixed, ['Quillen Plumbing (canceled in Stripe, still on: turned off)']);
  assert.deepEqual(r.notes.map(n => n.split(' ')[0] + ' ' + n.split(' ')[1]).sort(), ['Kessler Marine', 'Pickard Auto']);
  assert.equal((await DB.prepare("SELECT active FROM app_clients WHERE client_id = 'c1'").first()).active, 0);
  assert.equal((await DB.prepare("SELECT status FROM billing WHERE client_id = 'c1'").first()).status, 'canceled');
  assert.ok(calls.some(c => /^events .*charge\.dispute\.created,charge\.dispute\.closed$/.test(c)), 'the webhook now listens for chargebacks');
  assert.match(pings[0], /^Always Open: billing and service checked \|/);
});

test('texts carriers stopped delivering, and missing mail records, are each one alert', async () => {
  const env = { DB: H.makeDB(), TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  await C.ensureChecks(env);
  const msgs = [];
  for (let i = 0; i < 20; i++) msgs.push({ direction: 'outbound-api', status: i < 6 ? 'undelivered' : 'delivered', error_code: i < 6 ? 30007 : null, date_sent: new Date(NOW - i * HR / 2).toUTCString() });
  msgs.push({ direction: 'inbound', status: 'received', date_sent: new Date(NOW).toUTCString() });
  const alerts = [];
  const h = { fetch: async url => /Messages\.json/.test(url) ? new Response(JSON.stringify({ messages: msgs })) : new Response('{}', { status: 404 }), alert: async (t, d) => alerts.push(t + ' | ' + d) };
  const r = await C.textDelivery(env, NOW, h);
  assert.deepEqual(r, { sent: 20, failed: 6, alert: true });
  assert.match(alerts[0], /^text-delivery \| 6 of 20 texts in the last 24 hours were not delivered\. Twilio error codes: 30007 \(6\)\. 30007 means carriers are filtering/);
  assert.equal((await C.textDelivery(env, NOW + HR, h)).alert, undefined, 'once a day');
  const dns = { 'alwaysopenoffice.com': ['v=spf1 include:_spf.mx.cloudflare.net ~all'], '_dmarc.alwaysopenoffice.com': [] };
  const hd = { fetch: async url => { const n = new URL(url).searchParams.get('name'); return new Response(JSON.stringify({ Answer: (dns[n] || []).map(d => ({ data: '"' + d + '"' })) })); }, alert: async (t, d) => alerts.push(t + ' | ' + d) };
  assert.deepEqual(await C.mailRecords(env, NOW, hd), { spf: true, dmarc: false, alert: true });
  assert.match(alerts[1], /^mail-records \| The mail records for alwaysopenoffice\.com are missing: DMARC\./);
  dns['_dmarc.alwaysopenoffice.com'] = ['v=DMARC1; p=none'];
  assert.deepEqual(await C.mailRecords(env, NOW + DAY, hd), { spf: true, dmarc: true });
});

test('a chargeback reaches Christopher the same day with the deadline and the client’s history', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const B = await import('../src/billing.js');
  await B.ensureBilling(env);
  await DB.prepare("INSERT INTO billing (client_id, sub, status, business, customer, created) VALUES ('c1', 'sub_1', 'active', 'Quillen Plumbing', 'cus_1', ?1)").bind(iso(Date.now() - 95 * DAY)).run();
  for (let i = 0; i < 3; i++) await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, 'c1', '+14785551001', ?2, 'done', 0)").bind('CA' + i, iso(Date.now() - i * DAY)).run();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => /charges\/ch_1/.test(String(url)) ? new Response(JSON.stringify({ id: 'ch_1', customer: 'cus_1' })) : real(url, init);
  try {
    await B.dispute(env, 'charge.dispute.created', { charge: 'ch_1', amount: 29900, reason: 'product_not_received', evidence_details: { due_by: Math.floor(Date.parse('2026-11-07T17:00:00Z') / 1000) } }, {});
  } finally { globalThis.fetch = real; }
  const p = world.pushes.find(x => /stripe-dispute/.test(x.title));
  assert.ok(p, 'alerted');
  assert.match(p.body, /Chargeback: Quillen Plumbing disputed \$299\.00\. Reason given: product not received\. Answer by Saturday, November 7 in the Stripe dashboard/);
  assert.match(p.body, /3 calls answered by Max, 0 replies and posts they approved, 3 months as a client/);
});

test('sales call-backs: a real caller Max promised a call gets one push about 90 business minutes later; test calls never', async () => {
  const C = await import('../src/checks.js');
  const DB = H.makeDB(), env = { DB };
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_calls (id TEXT PRIMARY KEY, test INTEGER)").run();
  await (await import('../src/leadmail.js')).ensureLeadMail(env);
  await DB.prepare("INSERT INTO app_calls (id, client_id, test) VALUES ('CAreal', 'always-open', 0), ('CAtest', 'always-open', 1)").run();
  const thu8pm = Date.parse('2026-10-30T00:14:00Z');
  await DB.prepare("INSERT INTO leads (at, name, business, phone, plan, town, origin, grade, status) VALUES (?1, 'Caller at +14787182248', '', '+14787182248', 'Growth', '', 'phone CAreal', '', 'new'), (?1, 'Me', '', '+14783652533', '', '', 'phone CAtest', '', 'new'), (?1, '', 'Quillen Plumbing', '(478) 555-0142', '', 'Eatonton, GA', 'letter 4', 'D', 'letter')").bind(new Date(thu8pm).toISOString()).run();
  const pings = [], h = { ping: async (t, b, p) => pings.push([t, b, p]) };
  const fri = t => Date.parse('2026-10-30T' + t + ':00-04:00');
  assert.deepEqual(await C.salesCallbacks(env, thu8pm + 3600e3, h), { waiting: 'outside business hours' });
  assert.deepEqual((await C.salesCallbacks(env, fri('10:00'), h)).told, [], 'one business hour is too soon');
  assert.deepEqual((await C.salesCallbacks(env, fri('10:31'), h)).told, ['Caller at +14787182248']);
  assert.deepEqual(pings[0], ['Always Open: call Caller at +14787182248 back', 'Max told them Katie would call. +14787182248 · Growth plan · called Thursday. If it’s done, ignore this.', 'high']);
  assert.deepEqual((await C.salesCallbacks(env, fri('11:00'), h)).told, [], 'once');
  // The letter's lead counts from its "Call me".
  await C.markCallMe(env, 3, fri('13:00'));
  assert.deepEqual((await C.salesCallbacks(env, fri('14:00'), h)).told, []);
  assert.deepEqual((await C.salesCallbacks(env, fri('14:31'), h)).told, ['Quillen Plumbing']);
  assert.match(pings[1][1], /^They asked for a call from their mailed letter\. \(478\) 555-0142 · Eatonton, GA · grade D · asked Friday\./);
  assert.equal(pings.length, 2, 'never the test call');
});
