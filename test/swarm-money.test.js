// Nov 24, 2026 swarm fixes (money): what the first real buyer would hit. One fake world for the whole file (several src
// modules remember "my tables are ready"), the real worker, the harness's fake Stripe and Twilio, plus a small wrapper
// below for the Stripe calls the harness does not fake (listing checkout sessions, the test/live mode rule for portal
// settings). Nothing here touches the internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const B = await import('../src/billing.js');
const P = await import('../src/provision.js');
const C = await import('../src/checks.js');

const mails = [];
const APNS = { APNS_KEY: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }), APNS_KEY_ID: 'TESTKEY123' };
const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, Object.assign({ SEND_MAIL: { send: async m => { if (world.fail.sendMail) throw new Error('mail is down'); mails.push(m); } } }, APNS));
H.installFetch(world, env);

// Stripe, as far as these tests need it beyond the harness: the list of checkout sessions (all sessions the checkout
// made), and the rule that an object made with one key does not exist for another (test vs live).
const madeBy = new Map();
const inner = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input.url || String(input)), u = new URL(url);
  if (u.hostname !== 'api.stripe.com' || world.fail.stripe) return inner(input, init);
  const key = ((init && init.headers) || {}).Authorization || '', method = (init && init.method) || 'GET';
  const p = u.pathname.replace('/v1/', ''), f = new URLSearchParams(String((init && init.body) || ''));
  if (method === 'GET' && p === 'checkout/sessions') { world.calls.push({ method, url, body: '' }); world.sessionLists = (world.sessionLists || 0) + 1; return new Response(JSON.stringify({ object: 'list', data: [...world.sessions.values()].reverse(), has_more: false }), { headers: { 'content-type': 'application/json' } }); }
  if (method === 'POST' && p === 'billing_portal/sessions' && f.get('configuration') && madeBy.get(f.get('configuration')) !== key) {
    world.calls.push({ method, url, body: String(init.body) });
    return new Response(JSON.stringify({ error: { message: "No such configuration: '" + f.get('configuration') + "'; a similar object exists in test mode, but a live mode key was used to make this request." } }), { status: 400 });
  }
  if (method === 'POST' && p === 'billing_portal/configurations') { world.portals = (world.portals || 0) + 1; const id = 'bpc_test' + world.portals; madeBy.set(id, key); return new Response(JSON.stringify({ id }), { headers: { 'content-type': 'application/json' } }); }
  return inner(input, init);
};

const site0 = H.makeClient(worker, env);
const alive = async fn => { const keep = setInterval(() => {}, 20); try { return await fn(); } finally { clearInterval(keep); } };
const site = { call: (path, o) => alive(() => site0.call(path, o)), settle: () => alive(() => site0.settle()) };
const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
const cron = () => alive(async () => { await worker.scheduled({ cron: '*/10 * * * *' }, env, site0.ctx); await site0.settle(); });
const pushesSince = n => world.pushes.slice(n);
const ownerPushes = () => world.calls.filter(c => /push\.apple\.com\/3\/device\//.test(c.url)).map(c => { let j = {}; try { j = JSON.parse(c.body); } catch (e) {} return (j.aps && j.aps.alert) || {}; });

const FORM = { plan: 'Growth', max: '0', owner: 'Dana Sinclair', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' };
let nForm = 0;
const formFor = o => Object.assign({}, FORM, { business: 'Biz ' + (++nForm), email: 'b' + nForm + '@buyer.example', phone: '(478) 555-' + String(1000 + nForm) }, o || {});
async function checkoutOnly(o) {
  const r = await site.call('/billing/checkout', { form: formFor(o) });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  return world.sessions.get(r.location.split('/').pop());
}
async function deliver(s, secret) {
  const body = JSON.stringify({ id: 'evt_' + s.id, type: 'checkout.session.completed', data: { object: s } });
  return site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret || await B.webhookSecret(env, 'billing'), body), 'content-type': 'application/json' } });
}
async function signup(o) {
  const s = await checkoutOnly(o);
  const w = await deliver(s);
  assert.equal(w.status, 200, w.text);
  const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
  return { s, b, base: '/app/' + b.code };
}

await site.call('/start?plan=Growth');   // makes the webhook and the portal settings, as the live site does on first load

// ---------- M1 ----------
test('M1: STRIPE_KEY replaced: the paid event is refused with an alert, then the 10-minute job catches the buyer up', async () => {
  const s = await checkoutOnly({ business: 'Rotated Roofing' });
  env.STRIPE_KEY = 'sk_live_rotated';
  const n = world.pushes.length;
  const w = await deliver(s, 'whsec_rehearsal_secret');   // Stripe still signs with the endpoint's real secret
  assert.equal(w.status, 400);
  assert.ok(pushesSince(n).some(p => /stripe-webhook|Stripe/i.test(p.title + p.body) && /sign|secret/i.test(p.body)), JSON.stringify(pushesSince(n)));
  assert.equal(await get('SELECT 1 AS x FROM billing WHERE session_id = ?1', s.id), null);
  await cron();
  const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
  assert.ok(b, 'the buyer has an account after the 10-minute job');
  assert.ok(await get('SELECT 1 AS x FROM app_clients WHERE client_id = ?1', b.client_id));
  assert.ok(pushesSince(n).some(p => /New signup: Rotated Roofing/.test(p.title)), JSON.stringify(pushesSince(n).map(p => p.title)));
  // the new endpoint's secret opens with the new key, so the next event is accepted
  assert.ok(await B.webhookSecret(env, 'billing'));
});

test('M1: a bad signature while a sealed secret exists is alerted; a good one is not', async () => {
  const s = await checkoutOnly();
  await DB.prepare('DELETE FROM ops_alerts').run();   // the alert above holds repeats back for 3 hours
  let n = world.pushes.length;
  assert.equal((await deliver(s, 'whsec_wrong')).status, 400);
  assert.ok(pushesSince(n).some(p => /sign/i.test(p.body)));
  n = world.pushes.length;
  assert.equal((await deliver(s)).status, 200);
  assert.ok(!pushesSince(n).some(p => /signature/i.test(p.body)));
});

test('M1: the daily paying check makes an account for a paid session that never got one', async () => {
  const s = await checkoutOnly({ business: 'Closed Tab Plumbing' });   // no webhook, no /welcome
  const pings = [];
  await C.payingServed(env, Date.now(), { ping: async (t, b) => pings.push(t + ' | ' + b) });
  const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
  assert.ok(b, 'caught up by the daily check');
  assert.ok(pings.some(x => /New signup: Closed Tab Plumbing/.test(x)), JSON.stringify(pings));
  // run again: still one account
  await C.payingServed(env, Date.now(), { ping: async () => {} });
  assert.equal((await get('SELECT COUNT(*) AS n FROM billing WHERE session_id = ?1', s.id)).n, 1);
});

// ---------- M2 ----------
test('M2: one welcome email to the buyer with the app link as the button, the plan, Max, forwarding help, the refund line and Chris', async () => {
  const n = mails.length;
  const { s, b } = await signup({ business: 'Welcome Plumbing', email: 'owner@welcome.example' });
  await site.call('/welcome?s=' + s.id);   // the welcome page too: still one email
  await site.settle();
  const mine = mails.slice(n).filter(m => m.to === 'owner@welcome.example');
  assert.equal(mine.length, 1, JSON.stringify(mails.slice(n).map(m => [m.to, m.subject])));
  const m = mine[0], link = 'https://alwaysopenoffice.com/app/' + b.code;
  assert.ok(m.html.includes('href="' + link + '"'), 'the app link is the button');
  assert.match(m.text, /Growth/);
  assert.ok(m.text.includes(link + '/help/forwarding'));
  assert.match(m.text, /Max’s number: \(\d{3}\) \d{3}-\d{4}|Max’s number: Being set up/);
  assert.ok(m.text.includes('Try it for a month. If it’s not worth it, tell us within 30 days and we refund that month.'));
  assert.match(m.text, /Text or call Chris: \(706\) 460-2226/);
  assert.doesNotMatch(m.text + m.html, /\bAI\b|front desk|Katie/);
  // the link code is never in a push
  assert.ok(!world.pushes.some(p => (p.title + p.body).includes(b.code)));
});

test('M2: a welcome email that cannot be sent raises mail-send for Chris, without the link', async () => {
  await DB.prepare('DELETE FROM ops_alerts').run();
  world.fail.sendMail = true; const save = env.EMAIL; env.EMAIL = { send: async () => { throw new Error('routing is down'); } };
  const n = world.pushes.length;
  let b;
  try { ({ b } = await signup({ business: 'Mailless Mowing' })); await site.settle(); } finally { world.fail.sendMail = false; env.EMAIL = save; }
  const got = pushesSince(n).filter(p => /Mailless Mowing/.test(p.body) && /welcome email/i.test(p.body));
  assert.equal(got.length, 1, JSON.stringify(pushesSince(n)));
  assert.ok(!got[0].body.includes(b.code));
});

// ---------- M3 ----------
test('M3: a cancel in the first 30 days says the first month is refunded, and Chris gets REFUND DUE at high priority', async () => {
  const { b, base } = await signup({ business: 'Early Exit Electric', plan: 'Pro', max: '1' });
  const screen = await site.call(base + '/billing?step=cancel');
  assert.match(screen.text, /first month is refundable/i);
  assert.match(screen.text, /Chris refunds it within one business day/);
  assert.doesNotMatch(screen.text, /phone numbers stay yours/);
  const n = world.pushes.length;
  const r = await site.call(base + '/billing?step=cancel', { form: { a: 'cancel', why: 'not for us' } });
  assert.equal(r.status, 303);
  const push = pushesSince(n).find(p => /^REFUND DUE/.test(p.title));
  assert.ok(push, JSON.stringify(pushesSince(n).map(p => p.title)));
  assert.match(push.title, /Early Exit Electric/);
  assert.match(push.body, /\$499/);
  assert.match(push.body, /\$\d+ in all|\+ \$\d+/);
  const ends = new Date(Date.parse(b.created) + 30 * 864e5).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  assert.ok(push.body.includes(ends), push.body);
  assert.equal(push.priority, 'high');
  const done = await site.call(r.location.replace('https://alwaysopenoffice.com', ''));
  assert.match(done.text, /first month is refundable/i);
});

test('M3: a cancel after the first 30 days changes nothing about refunds', async () => {
  const { b, base } = await signup({ business: 'Old Hand Hauling' });
  await DB.prepare('UPDATE billing SET created = ?1 WHERE client_id = ?2').bind(new Date(Date.now() - 40 * 864e5).toISOString(), b.client_id).run();
  const screen = await site.call(base + '/billing?step=cancel');
  assert.doesNotMatch(screen.text, /refundable/i);
  const n = world.pushes.length;
  const r = await site.call(base + '/billing?step=cancel', { form: { a: 'cancel' } });
  assert.ok(!pushesSince(n).some(p => /REFUND/.test(p.title)));
  assert.ok(pushesSince(n).some(p => /Old Hand Hauling canceled/.test(p.title)));
  const done = await site.call(r.location.replace('https://alwaysopenoffice.com', ''));
  assert.doesNotMatch(done.text, /refundable/i);
});

// ---------- M4 ----------
async function subEvent(type, obj) {
  const body = JSON.stringify({ id: 'evt_' + type + Math.random(), type, data: { object: obj } });
  return site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(await B.webhookSecret(env, 'billing'), body), 'content-type': 'application/json' } });
}
test('M4: the owner is told to turn call forwarding off at cancel, when the plan ends, and a week before the number goes', async () => {
  const { b, base } = await signup({ business: 'Forward Fencing', plan: 'Pro', email: 'own@fwd.example' });
  await site.settle();
  const line = await get('SELECT number FROM voice_lines WHERE client_id = ?1', b.client_id);
  assert.ok(line, 'Max’s number was bought');
  await DB.prepare("CREATE TABLE IF NOT EXISTS sms_log (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, to10 TEXT NOT NULL, at TEXT, kind TEXT DEFAULT '', sid TEXT DEFAULT '', status TEXT DEFAULT '', why TEXT DEFAULT '', len INTEGER DEFAULT 0)").run();
  await DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES (?1, '4785550199', ?2, 'missed', 'sent')").bind(b.client_id, new Date().toISOString()).run();
  const mine = () => mails.filter(m => m.to === 'own@fwd.example' && /forwarding/i.test(m.subject));
  const dev = await site.call(base + '/api/device', { json: { token: 'ab'.repeat(32) } });
  assert.equal(dev.status, 200, dev.text);
  const push0 = ownerPushes().length;
  await site.call(base + '/billing', { form: { a: 'cancel' } });
  await site.settle();
  assert.equal(mine().length, 1, JSON.stringify(mails.filter(m => m.to === 'own@fwd.example').map(m => m.subject)));
  const t = mine()[0].text;
  assert.match(t, /Turn off call forwarding so your callers reach you/);
  for (const code of ['*73', '##004#', '*93#']) assert.ok(t.includes(code), code + ' in ' + t);
  assert.match(t, /goes away on \w+day, \w+ \d+/);
  assert.match(t, /Want to keep this number\? Tell Chris before \w+day, \w+ \d+\./);
  assert.doesNotMatch(t, /\bAI\b|Katie/);
  assert.ok(ownerPushes().slice(push0).some(a => /call forwarding/i.test(a.title + a.body)), JSON.stringify(ownerPushes().slice(push0)));
  // the plan ends (Stripe's event, twice: told once)
  await subEvent('customer.subscription.deleted', { id: b.sub, status: 'canceled' });
  await subEvent('customer.subscription.deleted', { id: b.sub, status: 'canceled' });
  assert.equal(mine().length, 2);
  assert.match(mine()[1].text, /Turn off call forwarding so your callers reach you/);
  // a week before the number is released
  await P.provisionCron(env, Date.now() + 54 * 864e5);
  assert.equal(mine().length, 3);
  const rel = new Date(Date.now() + 60 * 864e5).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  assert.ok(mine()[2].text.includes(rel), mine()[2].text);
  await P.provisionCron(env, Date.now() + 55 * 864e5);
  assert.equal(mine().length, 3, 'the week-before note goes once');
});

test('M4: a Growth owner who texted nobody gets no keep-the-number line', async () => {
  const { b, base } = await signup({ business: 'Plain Painting', email: 'own@plain.example' });
  await site.settle();
  await site.call(base + '/billing', { form: { a: 'cancel' } });
  await site.settle();
  const m = mails.filter(x => x.to === 'own@plain.example' && /forwarding/i.test(x.subject));
  assert.equal(m.length, 1);
  assert.doesNotMatch(m[0].text, /keep this number/);
});

// ---------- M5 ----------
test('M5: after STRIPE_KEY changes, the 10-minute job remakes the portal settings and "Update card" works', async () => {
  const { base } = await signup({ business: 'Card Update Carpentry' });
  env.STRIPE_KEY = 'sk_live_second';
  await cron();
  const r = await site.call(base + '/billing', { form: { a: 'card' } });
  assert.equal(r.status, 303, (r.text.match(/<p class="err">[^<]*/) || [''])[0]);
  assert.match(r.location, /^https:\/\/billing\.stripe\.com\//);
});

test('M5: a portal settings id Stripe no longer knows is remade once and the card page still opens', async () => {
  const { base } = await signup({ business: 'Stale Portal Pools' });
  await DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('portal_id', 'bpc_from_another_key')").run();
  madeBy.set('bpc_from_another_key', 'Bearer sk_test_somewhere_else');
  const r = await site.call(base + '/billing', { form: { a: 'card' } });
  assert.equal(r.status, 303, (r.text.match(/<p class="err">[^<]*/) || [''])[0]);
  assert.notEqual((await get("SELECT v FROM billing_config WHERE k = 'portal_id'")).v, 'bpc_from_another_key');
});

// ---------- M6 ----------
const byHand = (business, type) => B.createByHand(env, { business, owner: 'Pat Doe', email: 'pat@example.com', phone: '4785550123', town: 'Macon, GA', type: type || 'Other', plan: 'Growth' });
test('M6: offices that hold patient health information are refused, whatever kind was picked', async () => {
  for (const [business, type] of [['Peachtree Physical Therapy'], ['Lakeside Counseling & Mental Health'], ['Glow Med Spa & Botox', 'Salon, spa or fitness'], ['Main Street Pharmacy'],
    ['Heritage Home Health Care'], ['Milledgeville Hearing Aid Center'], ['Lake Oconee Physical Therapy', 'Salon, spa or fitness'], ['Oconee Medical Spa', 'Salon, spa or fitness'],
    ['Sunrise Hospice'], ['Smith Podiatry'], ['Bone & Joint Orthopedics'], ['Clear View Eye Care'], ['Magnolia Nursing Home'], ['Downtown Walk-In Clinic'], ['Oconee Audiology'],
    ['Lakeside Psychiatry'], ['Hope Family Counselors'], ['Middle Georgia Speech Therapy']]) {
    const r = await byHand(business, type);
    assert.equal(r.ok, false, business + ' was accepted');
    assert.match(r.error, /HIPAA/);
  }
  const r = await site.call('/billing/checkout', { form: formFor({ business: 'Peachtree Physical Therapy', type: 'Other' }) });
  assert.match(r.text, /We aren’t set up to handle patient health information/);
});

test('M6: vets, the car clinic, the lawn doctor, a phone repair clinic and a massage therapist are not health offices', async () => {
  for (const [business, type] of [['Oconee Veterinary Clinic'], ['Lake Country Animal Hospital'], ['Mike’s Car Clinic', 'Contractor or trade'], ['Lawn Doctor of Eatonton', 'Contractor or trade'],
    ['Phone Repair Clinic', 'Restaurant or shop'], ['Phone Repair Clinic'], ['The Car Clinic'], ['Drain Doctor', 'Contractor or trade'], ['The AC Doctor'], ['Serenity Massage Therapy', 'Salon, spa or fitness'], ['Serenity Massage Therapy'], ['Madame Zora Psychic Readings'], ['Pet Pharmacy Plus'], ['Smith Counselors at Law', 'Law office']]) {
    assert.equal(B.isHealthOffice(type || 'Other', business), false, business);
  }
  assert.equal(B.isHealthOffice('Salon, spa or fitness', 'Serenity Massage & Physical Therapy'), true);
});

test('M6: insurance, law and financial-advice offices typed as "Other" come out regulated; ordinary trades do not', async () => {
  for (const business of ['Smith Insurance Agency', 'Jones Law Firm', 'Smith & Jones, P.C.', 'Gates Financial Advisors', 'Oconee Wealth Management', 'Lake Federal Credit Union', 'Peoples Bank of Putnam', 'Baker Hughes LLP', 'Reid Legal Services', 'Carter Attorneys']) {
    const r = await byHand(business);
    assert.equal(r.ok, true, business + ': ' + r.error);
    assert.equal(r.regulated, true, business + ' came out unregulated');
  }
  for (const business of ['Banks Plumbing', 'Lawson Roofing', 'Smith & Sons Plumbing', 'Food Bank Catering', 'Oconee Pressure Washing']) {
    const r = await byHand(business);
    assert.equal(r.regulated, false, business + ' came out regulated');
  }
  // and through the website's own checkout
  const { b } = await signup({ business: 'Hart & Hill, P.C.', type: 'Other' });
  assert.equal((await get('SELECT regulated FROM app_clients WHERE client_id = ?1', b.client_id)).regulated, 1);
});

// ---------- M7 ----------
test('M7: when Twilio will not sell a number, the six quick tries become hourly ones, the owner is told once, the welcome page tells the truth', async () => {
  world.fail.twilioBuy = true;
  try {
    const s = await checkoutOnly({ business: 'Slow Number Siding', email: 'own@slow.example' });
    const pg = await site.call('/welcome?s=' + s.id);   // the welcome page makes the client and tries once
    assert.doesNotMatch(pg.text, /within the hour/);
    assert.match(pg.text, /taking longer than usual/);
    const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
    await site.call('/app/' + b.code + '/api/device', { json: { token: 'cd'.repeat(32) } });
    const p0 = world.pushes.length, o0 = ownerPushes().length;
    const back = mins => DB.prepare('UPDATE provision SET updated = ?1 WHERE client_id = ?2').bind(new Date(Date.now() - mins * 60e3).toISOString(), b.client_id).run();
    const tries = async () => +(await get('SELECT tries FROM provision WHERE client_id = ?1', b.client_id)).tries;
    for (let i = 0; i < 12 && await tries() < 6; i++) { await back(10); await P.provisionCron(env); }
    assert.equal(await tries(), 6);
    await back(10); await P.provisionCron(env);
    assert.equal(await tries(), 6, 'no quick tries after six');
    await back(61); await P.provisionCron(env);
    assert.equal(await tries(), 7, 'then once an hour');
    await back(61); await P.provisionCron(env);
    assert.equal(await tries(), 8);
    const ops = pushesSince(p0).filter(p => /could not set up Max/.test(p.title));
    assert.ok(ops.length <= 2, 'Chris’s two pushes stay two: ' + ops.length);
    assert.doesNotMatch(ops.map(p => p.body).join(' '), /stopped trying/);
    const slow = mails.filter(m => m.to === 'own@slow.example' && /taking longer/i.test(m.subject + m.text));
    assert.equal(slow.length, 1, 'the owner is told once');
    assert.match(slow[0].text, /Max’s number is taking longer than usual\. Chris has been told\. Nothing for you to do\./);
    assert.equal(ownerPushes().slice(o0).filter(a => /taking longer/.test(a.title + a.body)).length, 1);
    world.fail.twilioBuy = false;
    await back(61); await P.provisionCron(env);
    assert.ok(await get('SELECT number FROM voice_lines WHERE client_id = ?1', b.client_id), 'the hourly try gets the number once Twilio sells again');
  } finally { world.fail.twilioBuy = false; }
});

// ---------- M8 ----------
test('M8: Stripe failing at checkout shows a plain message and alerts Chris', async () => {
  await DB.prepare('DELETE FROM ops_alerts').run();
  const n = world.pushes.length;
  world.fail.stripe = true;
  let r;
  try { r = await site.call('/billing/checkout', { form: formFor({ business: 'Down Day Docks' }) }); } finally { world.fail.stripe = false; }
  assert.match(r.text, /Payment could not start\. Try again in a minute, or call \(706\) 460-2226\./);
  assert.doesNotMatch(r.text, /bad day/);
  assert.ok(pushesSince(n).some(p => /bad day/.test(p.body) || /checkout/i.test(p.title + p.body)), JSON.stringify(pushesSince(n)));
});

// ---------- M10 ----------
test('M10: the terms version and the time they were agreed to go into Stripe and into the billing row', async () => {
  assert.equal(B.TERMS_VERSION, '2026-11-24');
  // the version is the date the terms page shows, so a change to the page and a change to the version go together
  const { readFileSync } = await import('node:fs');
  const shown = (readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8').match(/Last updated ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1];
  assert.equal(new Date(shown + ' 12:00 UTC').toISOString().slice(0, 10), B.TERMS_VERSION, 'terms page says ' + shown);
  const t0 = Date.now();
  const { s, b } = await signup({ business: 'Terms Kept Tile' });
  assert.equal(s.metadata.terms_version, '2026-11-24');
  assert.ok(Date.parse(s.metadata.agreed_at) >= t0 - 1000, s.metadata.agreed_at);
  assert.equal(b.terms_version, '2026-11-24');
  assert.equal(b.agreed_at, s.metadata.agreed_at);
});

// ---------- M9 ----------
test('M9: the same business name with a new email and phone is flagged in the signup push, and still signs up', async () => {
  await signup({ business: 'Twice Over Tree Service' });
  const n = world.pushes.length;
  const { b } = await signup({ business: '  twice over tree service ' });
  assert.ok(b, 'not blocked');
  const p = pushesSince(n).find(x => /New signup/.test(x.title));
  assert.match(p.body, /Already a client as Twice Over Tree Service/);
});
