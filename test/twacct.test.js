// A Twilio sub-account for each new client (twacct.js, Nov 22, 2026). Off (the default): nothing changes, every business
// is in the main account. On: a new business's number, texts, calls, texting registration and webhooks live in its own
// sub-account; a business set up before stays in the main account; if Twilio can't make one, the main account is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');

const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const T = await import('../src/twacct.js');
const { provisionLine, lineEnded, provisionCron } = await import('../src/provision.js');
const { sendText, setBrand, smsSweep } = await import('../src/sms.js');
const { dialOut } = await import('../src/callbacks.js');
const { vmSweep } = await import('../src/voicemail.js');
const { textDelivery } = await import('../src/checks.js');
const { checkForm, advance } = await import('../src/a2p.js');
const site = H.makeClient(worker, env);
const MAIN = env.TWILIO_ACCOUNT_SID;
const paths = () => world.twPaths || [];
const since = n => paths().slice(n);
const subKeyOf = sid => 'subkey-' + sid.slice(-8);   // what the fake Twilio hands out as a sub-account's key

async function client(cid, business) {
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, phone, active) VALUES (?1, ?2, ?3, '4785550101', 1)").bind(cid, 'h-' + cid, business).run();
  await DB.prepare("INSERT INTO billing (client_id, business, phone, town, type, email) VALUES (?1, ?2, '478-555-0101', 'Eatonton, GA', 'Contractor or trade', ?3)").bind(cid, business, cid + '@example.test').run();
}
const lineOf = cid => DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1').bind(cid).first();

test('off (the default): a new business is set up in the main account, exactly as before', async () => {
  assert.equal(T.subaccountsOn(env), false);
  await client('c-old', 'Sinclair Plumbing');
  const n = paths().length;
  const r = await provisionLine(env, 'c-old');
  assert.equal(r.status, 'live');
  const mine = since(n);
  assert.ok(!mine.some(p => /\/Accounts\.json$/.test(p)), 'no sub-account asked for');
  assert.ok(mine.length && mine.every(p => p.includes('/Accounts/' + MAIN + '/')), mine.join('\n'));
  assert.equal(await T.accountOf(env, 'c-old'), MAIN);
  assert.deepEqual(await T.allAccounts(env), [MAIN]);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM tw_accounts').first()).n, 0);
});

let SUB = '';
test('on: a new business gets a sub-account of its own, and its number is bought there', async () => {
  env.TWILIO_SUBACCOUNTS = 'on';
  await client('c-new', 'Lakeside Dental');
  const n = paths().length;
  const r = await provisionLine(env, 'c-new');
  assert.equal(r.status, 'live');
  assert.equal(world.subs.length, 1);
  SUB = world.subs[0].sid;
  assert.match(world.subs[0].name, /^Always Open client c-new: Lakeside Dental/);
  const mine = since(n);
  assert.equal(mine[0], 'POST /2010-04-01/Accounts.json');
  assert.ok(mine.includes('POST /2010-04-01/Accounts/' + SUB + '/IncomingPhoneNumbers.json'), mine.join('\n'));
  assert.ok(!mine.some(p => p.includes('/Accounts/' + MAIN + '/')), 'nothing of it in the main account');
  assert.equal(await T.accountOf(env, 'c-new'), SUB);
  assert.equal(await T.accountOfNumber(env, (await lineOf('c-new')).number), SUB);
  // asked again (a retry, the welcome page and the webhook at once): the same sub-account, never a second
  assert.equal(await T.subaccountFor(env, 'c-new', 'Lakeside Dental'), SUB);
  assert.equal(world.subs.length, 1);
  // a business set up before stays in the main account, and Always Open's own line too
  assert.equal(await T.accountOf(env, 'c-old'), MAIN);
  assert.equal(await T.accountOf(env, 'always-open'), MAIN);
  assert.deepEqual(await T.allAccounts(env), [MAIN, SUB]);
});

test('its texts and calls go out of its own account; the older business’s stay in the main account', async () => {
  await setBrand(env, 'c-new', 'MG' + 'c'.repeat(32), 'approved');
  await setBrand(env, 'c-old', 'MG' + 'd'.repeat(32), 'approved');
  let n = paths().length;
  const a = await sendText(env, { clientId: 'c-new', to: '4785550111', body: 'Lakeside Dental: see you at 3.', kind: 'reply' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(since(n), ['POST /2010-04-01/Accounts/' + SUB + '/Messages.json']);
  assert.equal(world.texts.at(-1).MessagingServiceSid, 'MG' + 'c'.repeat(32));
  n = paths().length;
  const b = await sendText(env, { clientId: 'c-old', to: '4785550112', body: 'Sinclair Plumbing: on the way.', kind: 'reply' });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(since(n), ['POST /2010-04-01/Accounts/' + MAIN + '/Messages.json']);
  n = paths().length;
  const d = await dialOut(env, await lineOf('c-new'), '+14785550113', '/voice/out/' + env.VOICE_KEY, '/voice/outstatus/' + env.VOICE_KEY);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.deepEqual(since(n), ['POST /2010-04-01/Accounts/' + SUB + '/Calls.json']);
});

test('webhooks from its number are checked with its own key; an account that isn’t ours is never asked about', async () => {
  T.forgetKeys();
  const to = (await lineOf('c-new')).number, href = 'https://alwaysopenoffice.com/voice/sms/' + env.VOICE_KEY;
  const post = (params, key) => site.call('/voice/sms/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(key, href, params) } });
  let n = paths().length;
  const good = { MessageSid: 'SM' + 'e'.repeat(32), AccountSid: SUB, From: '+14785550114', To: to, Body: 'What time do you open?' };
  assert.equal((await post(good, subKeyOf(SUB))).status, 200, 'signed with the sub-account’s key');
  assert.deepEqual(since(n).filter(p => /^GET \/2010-04-01\/Accounts\/AC[0-9a-f]{32}\.json$/.test(p)), ['GET /2010-04-01/Accounts/' + SUB + '.json'], 'its key fetched once');
  const forged = Object.assign({}, good, { MessageSid: 'SM' + 'f'.repeat(32) });
  assert.equal((await post(forged, 'not-the-key')).status, 403);
  n = paths().length;
  const stranger = 'AC' + '9'.repeat(32), other = Object.assign({}, good, { AccountSid: stranger, MessageSid: 'SM' + '1'.repeat(32) });
  assert.equal((await post(other, 'any-key')).status, 403);
  assert.ok(!since(n).some(p => p.includes(stranger)), 'never asks Twilio about an account that is not ours');
  // the main account's own webhooks pass as before
  const mainHook = { MessageSid: 'SM' + '2'.repeat(32), AccountSid: MAIN, From: '+14785550115', To: (await lineOf('c-old')).number, Body: 'Do you do water heaters?' };
  assert.equal((await post(mainHook, env.TWILIO_AUTH_TOKEN)).status, 200);
});

test('the sweeps and the daily text check read every account', async () => {
  let n = paths().length;
  await smsSweep(env, Date.now(), {});   // the first run only marks the start
  await smsSweep(env, Date.now() + 60e3, {});
  let got = since(n);
  for (const a of [MAIN, SUB]) assert.ok(got.includes('GET /2010-04-01/Accounts/' + a + '/Messages.json'), 'texts in ' + a + '\n' + got.join('\n'));
  n = paths().length;
  await vmSweep(env, Date.now(), {});
  got = since(n);
  for (const a of [MAIN, SUB]) assert.ok(got.includes('GET /2010-04-01/Accounts/' + a + '/Calls.json'), 'calls in ' + a + '\n' + got.join('\n'));
  n = paths().length;
  await textDelivery(env, Date.now(), {});
  got = since(n);
  for (const a of [MAIN, SUB]) assert.ok(got.includes('GET /2010-04-01/Accounts/' + a + '/Messages.json'), 'delivery in ' + a);
});

test('its texting registration is made in its own account, with its own key', async () => {
  T.forgetKeys();
  const good = { legal: 'Lakeside Dental LLC', btype: 'Limited Liability Corporation', ein: '12-3456789', industry: 'HEALTHCARE', website: 'https://lakesidedental.example', street: '1 Main St', city: 'Eatonton', state: 'ga', zip: '31024', first: 'Pat', last: 'Lee', title: 'Owner', position: 'CEO', email: 'pat@lakesidedental.example', phone: '(478) 555-0101', agree: 'on' };
  await DB.prepare("INSERT INTO a2p_reg (client_id, status, step, form, sids, created, updated) VALUES ('c-new', 'submitted', 'profile', ?1, '{}', ?2, ?2)").bind(JSON.stringify(checkForm(good).form), new Date().toISOString()).run();
  const harness = globalThis.fetch, seen = [];
  env.TWILIO_PRIMARY_PROFILE_SID = 'BU' + 'p'.repeat(32);
  let k = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url), m = (init && init.method) || 'GET', h = (init && init.headers) || {};
    seen.push({ m, u, auth: h.Authorization || h.authorization || '' });
    const sid = p => p + String(++k).padStart(32, '0');
    const body = /\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\.json$/.test(u) ? { sid: u.match(/AC[0-9a-f]{32}/)[0], auth_token: subKeyOf(u.match(/AC[0-9a-f]{32}/)[0]) }
      : u.includes('/Evaluations') ? { status: 'compliant' }
      : /CustomerProfiles\/BU[^/]+$/.test(u) && m === 'GET' ? { status: 'twilio-approved' }
      : /BrandRegistrations\/BN/.test(u) ? { status: 'APPROVED' }
      : /Compliance\/Usa2p\/Usecases/.test(u) ? { us_app_to_person_usecases: [{ code: 'LOW_VOLUME' }, { code: 'MIXED' }] }
      : /Compliance\/Usa2p$/.test(u) && m === 'GET' ? { compliance: [{ campaign_status: 'VERIFIED' }] }
      : /Compliance\/Usa2p$/.test(u) ? { sid: sid('QE') }
      : /IncomingPhoneNumbers\.json\?/.test(u) ? { incoming_phone_numbers: [{ sid: 'PN' + '3'.repeat(32) }] }
      : /CustomerProfiles$|TrustProducts$/.test(u) ? { sid: sid('BU') }
      : /EndUsers$/.test(u) ? { sid: sid('IT') }
      : /Addresses\.json$/.test(u) ? { sid: sid('AD') }
      : /SupportingDocuments$/.test(u) ? { sid: sid('RD') }
      : /BrandRegistrations$/.test(u) ? { sid: sid('BN') }
      : /v1\/Services$/.test(u) ? { sid: 'MG' + 'e'.repeat(32) }
      : u.startsWith('https://ntfy.example.test') ? {}
      : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  let st;
  try { for (let i = 0; i < 14 && st !== 'approved'; i++) st = await advance(env, 'c-new'); }
  finally { globalThis.fetch = harness; }
  assert.equal(st, 'approved');
  const own = 'Basic ' + btoa(SUB + ':' + subKeyOf(SUB)), main = 'Basic ' + btoa(MAIN + ':' + env.TWILIO_AUTH_TOKEN);
  const newer = seen.filter(c => /^https:\/\/(trusthub|messaging)\.twilio\.com\//.test(c.u));
  assert.ok(newer.length > 8, 'the whole registration ran');
  for (const c of newer) assert.equal(c.auth, own, c.m + ' ' + c.u + ' with the sub-account’s own key');
  const old = seen.filter(c => /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\//.test(c.u));
  assert.ok(old.some(c => /\/Addresses\.json$/.test(c.u)) && old.some(c => /IncomingPhoneNumbers/.test(c.u)));
  for (const c of old) assert.ok(c.u.includes('/Accounts/' + SUB + '/'), c.u);
  const keyAsk = seen.filter(c => c.u === 'https://api.twilio.com/2010-04-01/Accounts/' + SUB + '.json');
  assert.equal(keyAsk.length, 1, 'its key asked for once');
  assert.equal(keyAsk[0].auth, main, 'with the main account’s key');
  // the primary (reseller) profile is still Always Open's, from the main account
  assert.ok(seen.some(c => /EntityAssignments$/.test(c.u)));
  const brand = await DB.prepare("SELECT messaging_sid, status FROM sms_brands WHERE client_id = 'c-new'").first();
  assert.deepEqual({ ...brand }, { messaging_sid: 'MG' + 'e'.repeat(32), status: 'approved' });
});

test('if Twilio can’t make a sub-account, the line is set up in the main account and Christopher hears about it', async () => {
  world.fail.subaccount = true;
  await client('c-fail', 'Oconee Smiles');
  const n = paths().length, p0 = world.pushes.length;
  const r = await provisionLine(env, 'c-fail');
  world.fail.subaccount = false;
  assert.equal(r.status, 'live');
  const mine = since(n);
  assert.equal(mine[0], 'POST /2010-04-01/Accounts.json');
  assert.ok(mine.includes('POST /2010-04-01/Accounts/' + MAIN + '/IncomingPhoneNumbers.json'), mine.join('\n'));
  assert.equal(await T.accountOf(env, 'c-fail'), MAIN);
  assert.ok(world.pushes.slice(p0).some(p => /no sub-account/.test(p.title)), JSON.stringify(world.pushes.slice(p0).map(p => p.title)));
});

test('a business that leaves: its number is released from its own account, not looked for in the main one', async () => {
  await DB.prepare("UPDATE app_clients SET active = 0 WHERE client_id = 'c-new'").run();
  await lineEnded(env, 'c-new');
  const n = paths().length;
  await provisionCron(env, Date.now() + 61 * 864e5);
  const del = since(n).filter(p => p.startsWith('DELETE'));
  assert.equal(del.length, 1, del.join('\n'));
  assert.match(del[0], new RegExp('^DELETE /2010-04-01/Accounts/' + SUB + '/IncomingPhoneNumbers/PN'));
  assert.equal((await DB.prepare("SELECT status FROM provision WHERE client_id = 'c-new'").first()).status, 'released');
});

test('off again: nothing new is made, and the businesses already in sub-accounts keep working there', async () => {
  env.TWILIO_SUBACCOUNTS = 'off';
  await client('c-later', 'Putnam Pest Control');
  const subs = world.subs.length;
  assert.equal((await provisionLine(env, 'c-later')).status, 'live');
  assert.equal(world.subs.length, subs);
  assert.equal(await T.accountOf(env, 'c-later'), MAIN);
  assert.equal(await T.accountOf(env, 'c-new'), SUB, 'switching off never moves anyone');
});
