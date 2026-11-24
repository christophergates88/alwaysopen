// Nov 24, 2026 swarm fixes for the owner app: what a brand-new, empty account sees on day one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const { CallRoom } = await import('../src/voice.js');
const BILL = await import('../src/billing.js');
const IN = await import('../src/insights.js');
const FL = await import('../src/firstlook.js');
const TC = await import('../src/timecard.js');
const fs = await import('node:fs');
const PAGE = fs.readFileSync(new URL('../src/apppage.js', import.meta.url), 'utf8');

async function boot() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site = H.makeClient(worker, env);
  let evt = 0;
  async function signup(plan, business) {
    await site.call('/start?plan=' + plan);
    const form = { plan, max: '0', business, owner: 'Pat Miller', phone: '(478) 555-0142', email: 'pat@' + plan.toLowerCase() + 'shop.example', town: 'Milledgeville, GA', type: 'Contractor or trade', agree: '1' };
    const r = await site.call('/billing/checkout', { form });
    const sid = r.location.split('/').pop(); const s = world.sessions.get(sid);
    const body = JSON.stringify({ id: 'evt_' + (++evt), type: 'checkout.session.completed', data: { object: s } });
    const secret = await BILL.webhookSecret(env, 'billing');
    await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
    await site.settle();
    const b = await DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(sid).first();
    return { cid: b.client_id, code: b.code, plan };
  }
  const state = async c => JSON.parse((await site.call('/app/' + c.code + '/api/state')).text);
  return { world, DB, env, site, signup, state };
}

test('A1: the first-hour checklist is drawn on Today and the Max tab has a permanent forwarding row', () => {
  const today = PAGE.slice(PAGE.indexOf('function vToday()'), PAGE.indexOf('function exampleCall()'));
  assert.match(today, /bizTop\(\)/);
  assert.ok(today.indexOf('bizTop()') < today.indexOf("'<h2>Quick</h2>"), 'checklist sits above the quick row');
  const max = PAGE.slice(PAGE.indexOf('function fwdRow()'), PAGE.indexOf('function timecardCard()'));
  assert.match(max, /Send my calls to Max/);
  assert.match(max, /BASE\+'\/help\/forwarding'/);
  assert.match(max.slice(max.indexOf('function vMax()')), /fwdRow\(\)/);
});

test('A2: no phone line yet says so, and never claims Max is on the clock', async () => {
  assert.match(PAGE, /Max’s number is being set up<\/h3><p>Nothing for you to do\. It shows up here when it’s ready\./);
  assert.match(PAGE, /It’s taking longer than usual\. Chris has been told\./);
  const B = await boot(); const c = await B.signup('Pro', 'Pro Plumbing');
  await B.DB.prepare('DELETE FROM voice_lines WHERE client_id = ?1').bind(c.cid).run();
  const s = await B.state(c);
  assert.ok(!s.line, 'no line in state');
  assert.ok('lineSetup' in s);
  const today = PAGE.slice(PAGE.indexOf('function vToday()'), PAGE.indexOf('function exampleCall()'));
  assert.match(today, /lineCard\(\)/);
  assert.match(PAGE.slice(PAGE.indexOf('function vMax()')), /lineCard\(\)/);
  assert.match(PAGE.slice(PAGE.indexOf('function dayTimeline()'), PAGE.indexOf('function vToday()')), /if\(noLine\(\)\)return ''/);
  assert.match(PAGE.slice(PAGE.indexOf('function clockCard()'), PAGE.indexOf('function clockSheet()')), /noLine\(\)/);
});

test('A3: Money tab links to the billing page', () => {
  const money = PAGE.slice(PAGE.indexOf('function vMoney()'), PAGE.indexOf('function askSheet()'));
  assert.match(money, /Your plan and card/);
  assert.match(money, /BASE\+'\/billing'/);
});

test('A4: a brand-new account has under an hour on the clock and no timecard for a week before signup', async () => {
  const B = await boot();
  for (const plan of ['Starter', 'Pro']) {
    const c = await B.signup(plan, plan + ' Shop');
    const s = await B.state(c);
    assert.ok(s.clock, plan + ' has a clock');
    assert.ok(s.clock.onMin < 60, plan + ' on-the-clock minutes ' + s.clock.onMin);
    assert.equal(s.timecard || null, null, plan + ' has no timecard for a week that ended before signup');
  }
});

test('A4: a client older than the month keeps the month start, and the demo is unchanged', async () => {
  const B = await boot(); const c = await B.signup('Pro', 'Old Shop');
  await B.DB.prepare('UPDATE billing SET created = ?2 WHERE client_id = ?1').bind(c.cid, '2026-01-05T12:00:00.000Z').run();
  const s = await B.state(c);
  const day = new Date().getUTCDate();
  assert.ok(s.clock.onMin >= (day - 1) * 24 * 60 - 1500, 'old client clock runs from the first of the month: ' + s.clock.onMin);
  const K = await import('../src/clock.js');
  assert.equal(await K.signedUpAt(B.env, 'demo-plumbing'), 0);
});

test('A5: the Starter tip never names a button Starter does not have', () => {
  const a = { lost: { n: 0, top: [] }, calls: { after: 0, n: 0 }, reviews: { n: 0, replyHrs: null }, work: { jobsLogged: 0, fill: { offers: 0 } } };
  assert.match(IN.nextStep(a, { regulated: false, plan: 'Pro' }), /Finished a job/);
  const t = IN.nextStep(a, { regulated: false, plan: 'Starter' });
  assert.ok(!/Finished a job/.test(t), t);
  assert.ok(t.length > 20);
});

test('A6: the Money tab says the month so far is live now', () => {
  assert.ok(!/Your numbers show up here in the first days of next month/.test(PAGE));
  assert.ok(!/Your first record is made in the first days of next month/.test(PAGE));
  assert.match(PAGE, /Your month so far is live now<\/b><span>It is also sent to you on the 2nd\./);
  assert.match(PAGE, /Your month so far is live now\. Your first record is also sent on the 2nd\./);
  assert.match(PAGE, /function monthLive\(\)/);
});

test('A7: day-one switch card does not claim Max answers every call until a real call has come in', () => {
  assert.match(PAGE, /S\.realCall/);
  assert.match(PAGE, /reaches him once you forward your missed calls/);
});

test('A8: the website card hides its percentage when no website is on file', () => {
  const up = PAGE.slice(PAGE.indexOf('function upItem('), PAGE.indexOf('function upCard()'));
  assert.match(up, /addon-website/);
  assert.match(up, /nofit\?''/);
  assert.match(up, /website on file/);
});

test('A9: a real first call counts as forwarded on the first-look card', async () => {
  const B = await boot(); const c = await B.signup('Pro', 'Fwd Shop');
  const cl = { client_id: c.cid, business: 'Fwd Shop', review_link: '', ref: 'x' };
  const before = await FL.firstLook(B.env, cl, { force: true });
  assert.equal(before.today.key, 'forward');
  await B.DB.prepare("INSERT INTO app_calls (id, client_id, at, caller, caller_name, reason, summary, transcript, outcome, status, urgency, test, turns) VALUES ('CAx', ?1, ?2, '+14785550199', 'Tom', 'x', 'x', '[]', 'done', 'new', '', 0, 2)").bind(c.cid, new Date().toISOString()).run();
  const after = await FL.firstLook(B.env, cl, { force: true });
  assert.notEqual(after.today.key, 'forward');
  const s = await B.state(c);
  assert.equal(s.realCall, true);
});
