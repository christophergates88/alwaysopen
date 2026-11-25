// Your business name on Max's calls (Nov 25, 2026): once the texting registration's business profile is approved, Max's
// number is added to it and SHAKEN/STIR, Voice Integrity and CNAM are filed and watched, one step a pass. Sole
// proprietors don't qualify; our own line is filed under the primary profile as ALWAYS OPEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const C = await import('../src/callerid.js');

test('the caller name follows the carriers\' rules: 15 characters, letters first, trade words shortened before anything is cut', () => {
  assert.equal(C.cnamName('Sinclair Plumbing'), 'SINCLAIR PLUMB');
  assert.equal(C.cnamName('Always Open'), 'ALWAYS OPEN');
  assert.equal(C.cnamName('Gates Insurance Agency'), 'GATES INS AGCY');
  assert.equal(C.cnamName('Smith Brothers Heating & Air Conditioning Inc.'), 'SMITH BROS HTG');
  assert.equal(C.cnamName("Mike's HVAC & Plumbing, LLC"), 'MIKES HVAC');
  for (const n of ['Sinclair Plumbing', 'A-1 Électric Service', "O'Neil & Sons Roofing and Gutters of Middle Georgia", '#1 Pizza']) {
    const s = C.cnamName(n);
    assert.ok(s.length <= 15 && /^[A-Z][A-Z0-9., ]*$/.test(s), n + ' -> ' + s);
  }
});

function fakeTwilio() {
  const t = { calls: [], tp: {}, n: 0, eval: 'compliant', fail: 0 };
  t.fetch = async (url, init) => {
    const u = new URL(String(url)), method = (init && init.method) || 'GET', body = new URLSearchParams(init && init.body ? String(init.body) : '');
    t.calls.push({ method, path: u.pathname + u.search, body: Object.fromEntries(body) });
    const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
    if (t.fail > 0) { t.fail--; return json({ message: 'Service unavailable', code: 20500 }, 503); }
    const p = u.pathname;
    if (u.hostname === 'api.twilio.com' && /IncomingPhoneNumbers\.json$/.test(p)) return json({ incoming_phone_numbers: [{ sid: 'PN' + 'o'.repeat(32), phone_number: u.searchParams.get('PhoneNumber') }] });
    if (u.hostname !== 'trusthub.twilio.com') return json({ message: 'not faked' }, 404);
    let m;
    if ((m = p.match(/^\/v1\/CustomerProfiles\/(\w+)\/ChannelEndpointAssignments$/))) return method === 'GET' ? json({ results: t.assigned ? [{ channel_endpoint_sid: t.assigned }] : [] }) : (t.assigned = body.get('ChannelEndpointSid'), json({ sid: 'RA1' }));
    if (p === '/v1/TrustProducts' && method === 'POST') { const sid = 'BUtp' + (++t.n); t.tp[sid] = { status: 'draft', policy: body.get('PolicySid'), name: body.get('FriendlyName'), linked: [] }; return json({ sid, status: 'draft' }); }
    if (p === '/v1/EndUsers' && method === 'POST') return json({ sid: 'ITeu' + (++t.n), type: body.get('Type'), attributes: JSON.parse(body.get('Attributes')) });
    if ((m = p.match(/^\/v1\/TrustProducts\/(\w+)\/EntityAssignments$/))) { t.tp[m[1]].linked.push(body.get('ObjectSid')); return json({ sid: 'BV1' }); }
    if ((m = p.match(/^\/v1\/TrustProducts\/(\w+)\/ChannelEndpointAssignments$/))) { t.tp[m[1]].number = body.get('ChannelEndpointSid'); return json({ sid: 'RA2' }); }
    if ((m = p.match(/^\/v1\/TrustProducts\/(\w+)\/Evaluations$/))) return json({ status: t.eval, results: t.eval === 'compliant' ? [] : [{ fields: [{ passed: false, friendly_name: 'Business Name', failure_reason: 'does not match' }] }] });
    if ((m = p.match(/^\/v1\/TrustProducts\/(\w+)$/))) { if (method === 'POST') t.tp[m[1]].status = body.get('Status'); return json({ sid: m[1], status: t.tp[m[1]].status }); }
    return json({ message: 'not faked: ' + p }, 404);
  };
  return t;
}

async function setup(extra) {
  const DB = H.makeDB();
  const env = Object.assign({ DB, TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', MAIL_TO: 'owner@example.test' }, extra || {});
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h', 'Sinclair Plumbing', 1), ('c2', 'h2', 'Joe Handyman', 1)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS provision (client_id TEXT PRIMARY KEY, status TEXT DEFAULT 'queued', number TEXT DEFAULT '', number_sid TEXT DEFAULT '', tries INTEGER DEFAULT 0, error TEXT DEFAULT '', created TEXT, updated TEXT, ended TEXT DEFAULT '', warned TEXT DEFAULT '')").run();
  await DB.prepare("INSERT INTO provision (client_id, status, number, number_sid) VALUES ('c1', 'live', '+14785550101', ?1), ('c2', 'live', '+14785550102', ?2)").bind('PN' + '1'.repeat(32), 'PN' + '2'.repeat(32)).run();
  const { ensureA2p } = await import('../src/a2p.js');
  await ensureA2p(env);
  return { DB, env };
}
const row = (env, cid) => env.DB.prepare('SELECT * FROM caller_id WHERE client_id = ?1').bind(cid).first();

test('once the business profile is approved: the number joins it, the three are filed, and the owner hears when all are approved', async () => {
  const { DB, env } = await setup();
  const tw = fakeTwilio(), real = globalThis.fetch; globalThis.fetch = tw.fetch;
  const told = [], alerts = [];
  const h = t => ({ now: t, tell: async (cid, ti, b) => told.push([cid, ti, b]), alert: async (ty, who, tx) => alerts.push(ty + ' ' + who + ' ' + tx) });
  try {
    let t = Date.parse('2026-11-25T15:00:00Z');
    // no texting registration yet: waiting, and nothing is asked of Twilio
    await C.callerIdCron(env, h(t));
    assert.equal((await row(env, 'c1')).status, 'waiting');
    assert.equal(tw.calls.length, 0);
    // the registration's profile still in review: still waiting
    await DB.prepare("INSERT INTO a2p_reg (client_id, status, step, form, sids) VALUES ('c1', 'in_review', 'wait_profile', '{}', ?1), ('c2', 'in_review', 'sp_wait_brand', ?2, '{}')").bind(JSON.stringify({ profile: 'BUprofile1' }), JSON.stringify({ noEin: true })).run();
    t += 2 * 3600e3; await C.callerIdCron(env, h(t));
    assert.equal((await row(env, 'c1')).status, 'waiting');
    assert.equal((await row(env, 'c2')).status, 'not_eligible', 'a sole proprietor\'s starter profile does not qualify');
    // approved (the registration moved on to the brand): filed, one step a pass
    await DB.prepare("UPDATE a2p_reg SET step = 'wait_brand' WHERE client_id = 'c1'").run();
    for (let i = 0; i < 6; i++) { t += 2 * 3600e3; await C.callerIdCron(env, h(t)); }
    const r = await row(env, 'c1');
    assert.equal(r.status, 'in_review', r.error); assert.equal(r.step, 'wait');
    assert.equal(tw.assigned, 'PN' + '1'.repeat(32), 'Max\'s number joined the business profile first');
    const tps = Object.values(tw.tp);
    assert.deepEqual(tps.map(x => x.policy).sort(), Object.values(C.POLICY).sort());
    for (const x of tps) { assert.ok(x.linked.includes('BUprofile1'), 'each carries the business profile'); assert.equal(x.number, 'PN' + '1'.repeat(32)); assert.equal(x.status, 'pending-review'); }
    const eus = tw.calls.filter(c => c.path === '/v1/EndUsers').map(c => c.body);
    assert.deepEqual(JSON.parse(eus.find(b => b.Type === 'cnam_information').Attributes), { cnam_display_name: 'SINCLAIR PLUMB' });
    assert.equal(JSON.parse(eus.find(b => b.Type === 'voice_integrity_information').Attributes).use_case, 'Appointment Scheduling');
    // under review, looked at hourly, not every pass
    const n = tw.calls.length;
    await C.callerIdCron(env, h(t + 10 * 60e3));
    assert.equal(tw.calls.filter(c => /TrustProducts\/BUtp/.test(c.path)).length, tw.calls.slice(0, n).filter(c => /TrustProducts\/BUtp/.test(c.path)).length);
    // all three approved: live, and the owner is told once
    for (const x of tps) x.status = 'twilio-approved';
    t += 2 * 3600e3; await C.callerIdCron(env, h(t));
    assert.equal((await row(env, 'c1')).status, 'live');
    assert.equal(told.length, 1); assert.equal(told[0][0], 'c1'); assert.match(told[0][2], /"SINCLAIR PLUMB"/);
    t += 2 * 3600e3; await C.callerIdCron(env, h(t));
    assert.equal(told.length, 1, 'once');
    assert.equal(alerts.length, 0);
    const st = await C.callerIdState(env, 'c1');
    assert.equal(st.label, 'On: Max\'s calls show "SINCLAIR PLUMB" and are signed as your business.');
    assert.match((await C.callerIdState(env, 'c2')).label, /Not available for sole proprietors yet/);
  } finally { globalThis.fetch = real; }
});

test('our own line is filed under the primary profile as ALWAYS OPEN; a refusal or a turned-down filing reaches Christopher', async () => {
  const { DB, env } = await setup({ TWILIO_PRIMARY_PROFILE_SID: 'BUprimary' });
  await DB.prepare("DELETE FROM app_clients WHERE client_id IN ('c1', 'c2')").run();
  const tw = fakeTwilio(), real = globalThis.fetch; globalThis.fetch = tw.fetch;
  const alerts = [];
  const h = t => ({ now: t, tell: async () => {}, alert: async (ty, who, tx) => alerts.push(ty + ' ' + who + ' ' + tx) });
  try {
    let t = Date.parse('2026-11-25T15:00:00Z');
    for (let i = 0; i < 6; i++) { t += 2 * 3600e3; await C.callerIdCron(env, h(t)); }
    const r = await row(env, 'always-open');
    assert.equal(r.status, 'in_review', r.error);
    assert.ok(tw.calls.some(c => /IncomingPhoneNumbers\.json\?PhoneNumber=%2B17064602226/.test(c.path)), 'the line\'s number looked up');
    assert.ok(Object.values(tw.tp).every(x => x.linked.includes('BUprimary')));
    assert.match(tw.calls.find(c => c.path === '/v1/EndUsers' && c.body.Type === 'cnam_information').body.Attributes, /ALWAYS OPEN/);
    // the caller name turned down: a fix for Christopher, the calls still go
    Object.values(tw.tp).forEach((x, i) => { x.status = i === 2 ? 'twilio-rejected' : 'twilio-approved'; });
    t += 2 * 3600e3; await C.callerIdCron(env, h(t));
    assert.equal((await row(env, 'always-open')).status, 'needs_fix');
    assert.equal(alerts.length, 1); assert.match(alerts[0], /^caller-id always-open .*the caller name was turned down/);
  } finally { globalThis.fetch = real; }

  // a filing Twilio's own check flags, and Twilio refusing five times in a row
  const s2 = await setup();
  await s2.DB.prepare("INSERT INTO a2p_reg (client_id, status, step, form, sids) VALUES ('c1', 'approved', '', '{}', ?1)").bind(JSON.stringify({ profile: 'BUprofile1' })).run();
  const tw2 = fakeTwilio(); tw2.eval = 'noncompliant';
  const al2 = [];
  globalThis.fetch = tw2.fetch;
  try {
    let t = Date.parse('2026-11-25T15:00:00Z');
    for (let i = 0; i < 4; i++) { t += 2 * 3600e3; await C.callerIdCron(s2.env, { now: t, alert: async (ty, who, tx) => al2.push(tx) }); }
    const r = await row(s2.env, 'c1');
    assert.equal(r.status, 'needs_fix'); assert.match(r.error, /Twilio flagged: Business Name: does not match/);
    assert.equal(al2.length, 1);
    await s2.DB.prepare("UPDATE caller_id SET status = 'filing', step = 'vi', error = '' WHERE client_id = 'c1'").run();
    tw2.fail = 99;
    for (let i = 0; i < 5; i++) { t += 2 * 3600e3; await C.callerIdCron(s2.env, { now: t, alert: async (ty, who, tx) => al2.push(tx) }); }
    const r2 = await row(s2.env, 'c1');
    assert.equal(r2.status, 'needs_fix'); assert.match(r2.error, /^Twilio kept refusing/);
    assert.equal(al2.length, 2);
  } finally { globalThis.fetch = real; }
});
