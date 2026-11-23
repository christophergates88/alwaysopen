// Nov 23, 2026 launch audit: the welcome email with the private app link, the high-priority signup push, the app's way
// to the plan page, the Monday cron, and the deploy's once-a-day customer email check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const B = await import('../src/billing.js');
const I = await import('../src/index.js');

function setup(extra) {
  const world = new H.World(), DB = H.makeDB(), sent = [];
  const env = H.makeEnv(world, DB, Object.assign({ SEND_MAIL: { send: async m => { sent.push(m); } } }, extra || {}));
  H.installFetch(world, env);
  const pings = [];
  return { world, DB, env, sent, pings, h: { notify: async (t, b, p) => pings.push([t, b, p]) } };
}
const META = { plan: 'Growth', max: '0', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', town: 'Eatonton, GA', type: 'Contractor or trade' };
const session = (id, meta) => ({ id, mode: 'subscription', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_' + id, customer_email: 'dana@example.com', amount_total: 29900, metadata: meta });

test('a paid signup emails the owner their private app link, once, even when the webhook and the welcome page race', async () => {
  const { DB, env, sent, h } = setup();
  const s = session('cs_welcome1', META);
  const [a] = await Promise.all([B.createFromSession(env, s, h), B.createFromSession(env, s, h)]);
  await B.createFromSession(env, s, h);
  const mine = sent.filter(m => m.to === 'dana@example.com');
  assert.equal(mine.length, 1, 'one welcome email');
  assert.match(mine[0].subject, /^Your Always Open app: Sinclair Plumbing$/);
  assert.ok(mine[0].text.includes('https://alwaysopenoffice.com/app/' + a.code), 'the link is in the text copy');
  assert.ok(mine[0].html.includes('https://alwaysopenoffice.com/app/' + a.code), 'and on the button');
  assert.doesNotMatch(mine[0].text + mine[0].html, /\bAI\b|\bS\.I\./, 'house words: no "AI", no "S.I."');
  const row = await DB.prepare("SELECT v FROM billing_config WHERE k = ?1").bind('welcome:' + a.client_id).first();
  assert.match(row.v, /^sent /);
});

test('a new signup reaches Christopher at high priority; a welcome email that fails tells him too', async () => {
  const { env, h, pings } = setup({ SEND_MAIL: { send: async () => { throw new Error('domain not set up'); } }, EMAIL: { send: async () => { throw new Error('not verified'); } } });
  await B.createFromSession(env, session('cs_hi', META), h);
  const signup = pings.find(p => /^New signup: Sinclair Plumbing/.test(p[0]));
  assert.equal(signup[2], 'high');
  const fail = pings.find(p => /^Welcome email did not send/.test(p[0]));
  assert.ok(fail, 'told when the welcome email fails');
  assert.equal(fail[2], 'high');
  assert.doesNotMatch(fail[1], /\/app\//, 'the private link never goes into a push');
});

test('a Payment Link payment gets no welcome email (Christopher sets those up by hand)', async () => {
  const { env, sent, h } = setup();
  assert.equal(await B.createFromSession(env, session('cs_plink', {}), h), null);
  assert.equal(sent.length, 0);
});

test('the welcome email builder: the link, the plan and the add-on, in plain words', () => {
  const m = B.welcomeEmail({ owner: 'Dana Sinclair', business: 'Sinclair Plumbing', plan: 'Pro', max: 1 }, 'https://alwaysopenoffice.com/app/abc');
  assert.match(m.text, /Welcome to Always Open, Dana\./);
  assert.match(m.text, /Pro with 300 more Max minutes, month to month\./);
  assert.match(m.text, /https:\/\/alwaysopenoffice\.com\/app\/abc/);
  assert.match(m.text, /Chris sends a new one/);
});

test('the app shows owners a way to their plan page; nobody else', () => {
  const src = fs.readFileSync(new URL('../src/bizpage.js', import.meta.url), 'utf8');
  assert.match(src, /card\('plan','Your plan',gP,sP\)/);
  assert.match(src, /href="'\+BASE\+'\/billing"/);
  // S.billing is only ever sent to owners (app.js): staff links get null
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /billing: bill && !c\.staff \?/);
});

test('the weekly jobs run on Monday: the cron is named, and wrangler.toml matches the code', () => {
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const cron = /const RADAR_CRON = '([^']+)'/.exec(idx)[1];
  assert.equal(cron, '17 12 * * MON');
  assert.ok(toml.includes('"' + cron + '"'), 'the trigger in wrangler.toml is the same string');
  assert.doesNotMatch(toml, /"17 12 \* \* 1"/);
});

test('customer email check: a +customer-check copy of a Gmail address, at most once in 20 hours, failures named', async () => {
  assert.equal(I.customerCheckAddress('christophergates.cg@gmail.com'), 'christophergates.cg+customer-check@gmail.com');
  assert.equal(I.customerCheckAddress('someone+x@gmail.com'), 'someone+customer-check@gmail.com');
  assert.equal(I.customerCheckAddress('owner@example.test'), '');
  const { env, sent } = setup({ MAIL_TO: 'christophergates.cg@gmail.com' });
  const t = Date.parse('2026-11-23T15:00:00Z');
  assert.equal(await I.customerMailCheck(env, t), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'christophergates.cg+customer-check@gmail.com');
  assert.match(await I.customerMailCheck(env, t + 3600e3), /^checked /);
  assert.equal(sent.length, 1, 'not again within 20 hours');
  assert.equal(await I.customerMailCheck(env, t + 21 * 3600e3), 'sent');
  const bad = setup({ MAIL_TO: 'christophergates.cg@gmail.com', SEND_MAIL: { send: async () => { throw new Error('Email Sending is not enabled for this domain'); } } });
  assert.match(await I.customerMailCheck(bad.env, t), /^failed: Email Sending is not enabled/);
  assert.match(await I.customerMailCheck(bad.env, t + 60e3), /^failed/, 'a failure is tried again on the next deploy');
  assert.equal(await I.customerMailCheck(setup({ SEND_MAIL: undefined }).env, t), 'off');
});

test('the restore guide and the runbook name the business database, never Gates HQ’s', () => {
  const r = fs.readFileSync(new URL('../docs/restore.md', import.meta.url), 'utf8');
  assert.doesNotMatch(r, /time-travel (info|restore) alwaysopen /);
  assert.match(r, /time-travel restore alwaysopen-biz/);
  const rb = fs.readFileSync(new URL('../docs/runbook.md', import.meta.url), 'utf8');
  assert.doesNotMatch(rb, /S\.I\. assistant, and this call/);
});

test('someone who reaches the payment page and stops: Christopher hears once, at high priority, with who to call', async () => {
  const { DB, env, h, pings } = setup();
  const now = Date.parse('2026-11-24T15:00:00Z'), ago = m => Math.floor((now - m * 60e3) / 1000);
  const sessions = [
    { id: 'cs_open1', mode: 'subscription', created: ago(50), customer_email: 'pat@example.com', metadata: { plan: 'Growth', max: '0', business: 'Oconee Heating', owner: 'Pat Lee', phone: '(706) 555-0123', town: 'Madison, GA' } },
    { id: 'cs_link', mode: 'subscription', created: ago(60), customer_email: 'x@example.com', metadata: {} },                 // a Payment Link: not ours to chase
    { id: 'cs_pay', mode: 'payment', created: ago(60), metadata: { plan: 'Growth' } },                                      // not a signup
    { id: 'cs_fresh', mode: 'subscription', created: ago(20), metadata: { plan: 'Pro', business: 'Still Paying Co' } },      // still on the page
    { id: 'cs_old', mode: 'subscription', created: ago(26 * 60), metadata: { plan: 'Pro', business: 'Day Old Co' } }         // over a day
  ];
  let asked = '';
  const call = async (e, method, path) => { asked = path; return { data: sessions }; };
  assert.equal(await B.abandonedCheckouts(env, h, now, call), 1);
  assert.equal(asked, 'checkout/sessions?status=open&limit=25');
  const p = pings.find(x => /^Started signing up, didn’t pay: Oconee Heating/.test(x[0]));
  assert.ok(p);
  assert.equal(p[2], 'high');
  assert.match(p[1], /Pat Lee, \(706\) 555-0123, pat@example\.com\. Growth plan, Madison, GA\. They reached the payment page 50 minutes ago/);
  assert.equal(await B.abandonedCheckouts(env, h, now + 10 * 60e3, call), 0, 'never twice for one session');
  // someone who has paid since, under another session: nothing to chase
  await B.createFromSession(env, { id: 'cs_paid', mode: 'subscription', payment_status: 'paid', customer: 'cus_9', subscription: 'sub_9', customer_email: 'sam@example.com', metadata: Object.assign({}, META, { business: 'Sam Plumbing', phone: '(478) 555-0199' }) }, h);
  const later = [{ id: 'cs_open2', mode: 'subscription', created: ago(70), customer_email: 'SAM@example.com', metadata: { plan: 'Pro', business: 'Sam Plumbing', owner: 'Sam', phone: '(478) 555-0199' } }];
  assert.equal(await B.abandonedCheckouts(env, h, now, async () => ({ data: later })), 0);
  assert.equal(await B.abandonedCheckouts({ DB }, h, now, call), 'no stripe');
});
