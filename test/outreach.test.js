// Outreach calls to businesses (Brief 3, Part 8d): live since Nov 10, 2026 behind Christopher's kill switch and, for each
// client, the owner's own switch, which only turns on once the owner has signed the current Outreach terms. Tightened the
// same day: Pro only; business caller ID and landline checked when added and again right before each call; California,
// Florida, Indiana, Minnesota and Oklahoma never called; hospitals, schools and emergency lines never called; the legal
// name and how to stop first on every call, then the owner's own number; caps per run, per day and across clients; every
// list and sentence read automatically, held for Christopher only when it needs a look.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const O = await import('../src/outreach.js');
const { makeDB } = await import('./rehearsal/harness.js');

const C = { client_id: 'c1', regulated: 0, tier: 'Pro', business: 'Ace Hoods' };
const G = { client_id: 'g1', regulated: 0, tier: 'Growth', business: 'Gail Cuts' };
const REG = { client_id: 'd1', regulated: 1, tier: 'Pro' };
const THU_10AM_ET = Date.parse('2026-11-05T15:00:00Z');
const ok = { now: THU_10AM_ET, killSwitchOn: true, regulated: false, pro: true, attested: true, pitch: 'We clean commercial kitchens.', pitchOn: true, pitchHeld: false,
  legal: 'Ace Hoods LLC', callback: '+14785550199', optedOut: false, anyClientAt: '', dayCount: 0, tickCount: 0, hoursOk: true };
const row = { phone: '+14785550101', line_type: 'landline', caller_type: 'BUSINESS', status: 'ready', last_called: '' };
const SIGN = { version: O.TERMS_VERSION, name: 'Dana Whitfield', agree: true };
const ON = { legal: 'Ace Hoods LLC', callback: '478-555-0199' };
const BIZ = () => ({ type: 'landline', callerType: 'BUSINESS', callerName: 'DINER' });
const form = o => { const d = new FormData(); for (const k in o) d.set(k, o[k]); return d; };

// Twilio stand-in: every dial is answered with a call id, and written down
function fakeTwilio() {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), to: new URLSearchParams(String((init && init.body) || '')).get('To') }); return new Response(JSON.stringify({ sid: 'CA' + calls.length }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  return { calls, done: () => { globalThis.fetch = real; } };
}
async function ready(env, client) {
  const DB = env.DB, c = client || C;
  await O.ensureOutreach(env);
  await DB.prepare("INSERT OR IGNORE INTO billing_config (k, v) VALUES ('outreach_enabled', '1')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, owner_set) VALUES (?1, ?2, ?3, 1, '{}')").bind(c.client_id === 'c1' ? '+14785550100' : '+14785550200', c.client_id, c.business || '').run();
  await DB.prepare("INSERT INTO app_clients (client_id, business, tier, active, regulated) VALUES (?1, ?2, ?3, 1, 0)").bind(c.client_id, c.business || '', c.tier).run();
  await O.agree(env, c, SIGN);
  assert.equal((await O.savePitch(env, c, 'We clean commercial kitchen hoods.', true, { legal: (c.business || 'Shop') + ' LLC', callback: c.client_id === 'c1' ? '478-555-0199' : '478-555-0299' })).ok, true);
}
const add = (DB, cid, phone, o) => DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, line_type, caller_type, status, last_called, attempts) VALUES (?1, ?2, ?3, 'landline', 'BUSINESS', ?4, ?5, ?6)")
  .bind(cid, (o && o.biz) || 'Diner', phone, (o && o.status) || 'ready', (o && o.last) || '', (o && o.attempts) || 0).run();
const attempts = async (DB, phone, cid) => ((await DB.prepare('SELECT attempts FROM outreach_lists WHERE phone = ?1 AND client_id = ?2').bind(phone, cid || 'c1').first()) || {}).attempts;

test('live: with every gate open nothing blocks the call, and an unknown call id hangs up', async () => {
  assert.equal(O.OUTREACH_LIVE, true, 'Carter read the plan and Christopher said go (Nov 10, 2026)');
  assert.deepEqual(O.blockedBy(row, ok), []);
  const DB = makeDB(); await O.ensureOutreach({ DB });
  const r = await O.outreachTwiml({ DB }, new URL('https://x/voice/or/k?id=999'), new FormData());
  assert.match(await r.text(), /<Hangup\/>/);
});

test('the terms: the owner is the caller, releases and indemnifies us, and signs by typing a full name (Pro only)', async () => {
  const txt = O.TERMS_TEXT;
  for (const w of [/you are the seller and the party on whose behalf each call is made/, /release and forever discharge Always Open and Lake Country Foam Party, LLC/, /defend, indemnify and hold harmless/, /not legal advice/i, /Georgia law governs/, /Telephone Consumer Protection Act/, /National Do Not Call Registry/, /California, Florida, Indiana, Minnesota and Oklahoma/, /legal name and call-back number you give us are your own/]) assert.match(txt, w);
  assert.doesNotMatch(txt, /\bAI\b/);
  const DB = makeDB(), env = { DB };
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { agree: false }))).ok, false, 'the box must be ticked');
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { version: '2026-11-10' }))).ok, false, 'the version before this one is refused');
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { name: 'Dana' }))).ok, false, 'a full name');
  assert.equal((await O.agree(env, REG, SIGN)).ok, false, 'never for a regulated business');
  assert.match((await O.agree(env, G, SIGN)).error, /Pro plan/, 'Pro only');
  assert.equal((await O.agree(env, Object.assign({ staff: 'Tech Tom' }, C), SIGN)).ok, false, 'only the owner signs');
  assert.equal((await O.attest(env, C)).ok, false, 'the old one-tap confirmation no longer counts');
  assert.equal((await O.savePitch(env, C, 'We clean commercial kitchens.', true, ON)).needTerms, true, 'no switching on before signing');
  assert.equal((await O.agree(env, C, SIGN, { by: 'Dana', ip: 'iphash', ua: 'iPhone' })).ok, true);
  const rec = await DB.prepare("SELECT version, hash, name, ip_hash, ua FROM outreach_terms WHERE client_id = 'c1'").first();
  assert.deepEqual([rec.version, rec.hash, rec.name, rec.ip_hash, rec.ua], [O.TERMS_VERSION, await O.termsHash(), 'Dana Whitfield', 'iphash', 'iPhone']);
  assert.equal((await O.savePitch(env, C, 'We clean commercial kitchens.', true, ON)).ok, true, 'signed: it turns on');
  // a new version of the terms asks again
  await DB.prepare("UPDATE outreach_terms SET version = '2026-01-01' WHERE client_id = 'c1'").run();
  assert.equal(await O.attested(env, 'c1'), false);
});

test('every gate blocks on its own', () => {
  const only = (r, ctx) => O.blockedBy(Object.assign({}, row, r), Object.assign({}, ok, ctx)).filter(x => !/not live/.test(x));
  const days = n => new Date(THU_10AM_ET - n * 86400000).toISOString();
  assert.deepEqual(only({}, { killSwitchOn: false }), ['kill switch off']);
  assert.deepEqual(only({}, { regulated: true }), ['regulated client']);
  assert.deepEqual(only({}, { pro: false }), ['not on Pro']);
  assert.deepEqual(only({}, { attested: false }), ['no attestation']);
  assert.deepEqual(only({}, { pitchOn: false }), ['owner switch off']);
  assert.deepEqual(only({}, { pitchHeld: true }), ['sentence being checked']);
  assert.deepEqual(only({}, { legal: '' }), ['no legal name or call-back number']);
  assert.deepEqual(only({}, { callback: '' }), ['no legal name or call-back number']);
  assert.deepEqual(only({ line_type: 'mobile' }, {}), ['not a business landline']);
  assert.deepEqual(only({ line_type: 'nonFixedVoip' }, {}), ['not a business landline']);
  assert.deepEqual(only({ caller_type: 'CONSUMER' }, {}), ['caller ID not a business'], 'a home landline');
  assert.deepEqual(only({ caller_type: '' }, {}), ['caller ID not a business'], 'no caller ID type');
  assert.deepEqual(only({ phone: '+14155550101' }, {}), ['state not called']);
  assert.deepEqual(only({}, { optedOut: true }), ['opted out']);
  assert.deepEqual(only({ last_called: days(10) }, {}), ['called in the last 30 days']);
  assert.deepEqual(only({ last_called: days(31) }, {}), []);
  assert.deepEqual(only({}, { anyClientAt: days(3) }), ['called by Always Open in the last 7 days'], 'another client called this business this week');
  assert.deepEqual(only({}, { anyClientAt: days(8) }), []);
  assert.deepEqual(only({}, { dayCount: 50 }), ['daily limit reached']);
  assert.deepEqual(only({}, { tickCount: 3 }), ['enough for this run']);
  assert.deepEqual(only({}, { hoursOk: false }), ['outside business hours']);
  assert.deepEqual(only({}, {}), []);
});

test('five states are never called, by area code; every other state is', () => {
  for (const [p, s] of [['+14155550100', 'CA'], ['+12135550100', 'CA'], ['+13055550100', 'FL'], ['+18135550100', 'FL'], ['+13175550100', 'IN'], ['+16125550100', 'MN'], ['+14055550100', 'OK'], ['+19185550100', 'OK'],
    ['+14785550100', ''], ['+17065550100', ''], ['+12125550100', ''], ['+15125550100', ''], ['+13125550100', ''], ['+12065550100', '']]) assert.equal(O.blockedState(p), s, p);
  assert.deepEqual(Object.keys(O.BLOCKED_STATES), ['CA', 'FL', 'IN', 'MN', 'OK']);
  assert.deepEqual(Object.values(O.BLOCKED_STATES).map(x => x.split(' ').length), [41, 23, 8, 8, 5]);
  const all = Object.values(O.BLOCKED_STATES).join(' ').split(' ');
  assert.equal(new Set(all).size, all.length, 'no area code listed twice');
});

test('one number on its own: business landlines only, never a home line, a cell, a hospital, a school or 911', () => {
  const v = (biz, lk, out) => O.rowVerdict({ phone: '+14785550101', business: biz }, Object.assign({ type: '', callerType: '', callerName: '' }, lk), out);
  assert.deepEqual(v('Ace Diner', { type: 'landline', callerType: 'BUSINESS' }), { ok: true, why: '' });
  assert.deepEqual(v('Ace Diner', { type: 'fixedVoip', callerType: 'BUSINESS' }), { ok: true, why: '' });
  assert.equal(v('Ace Diner', { type: 'landline', callerType: 'CONSUMER' }).why, 'home or personal line');
  assert.equal(v('Ace Diner', { type: 'landline', callerType: '' }).why, 'caller ID not listed as a business');
  assert.equal(v('Ace Diner', { type: 'mobile', callerType: 'BUSINESS' }).why, 'cell phone');
  assert.equal(v('Ace Diner', { type: 'nonFixedVoip', callerType: 'BUSINESS' }).why, 'cell phone');
  assert.equal(v('Ace Diner', { type: 'tollFree', callerType: 'BUSINESS' }).why, 'not a landline (tollFree)');
  assert.equal(v('Ace Diner', {}).why, 'unknown number');
  for (const s of ['Mercy Hospital', 'Lincoln Elementary School', 'Urgent Care of Macon', 'Bibb County Sheriff', 'Fire Station 4', 'Oak Grove Nursing Home', 'Poison Control', 'Dr. Patel']) assert.equal(v(s, { type: 'landline', callerType: 'BUSINESS' }).why, 'hospital, school or emergency line', s);
  assert.equal(v('Ace Diner', { type: 'landline', callerType: 'BUSINESS', callerName: 'MACON MEDICAL CENTER' }).why, 'hospital, school or emergency line', 'the caller ID name counts too');
  for (const s of ['24 Hour Emergency Plumbing', 'Church St Auto', 'Gems Jewelry']) assert.equal(v(s, { type: 'landline', callerType: 'BUSINESS' }).ok, true, s);
  assert.equal(v('Ace Diner', { type: 'landline', callerType: 'BUSINESS' }, true).why, 'asked not to be called');
  assert.equal(O.rowVerdict({ phone: '+19185550101', business: 'Tulsa Tire' }, { type: 'landline', callerType: 'BUSINESS', callerName: '' }).why, 'Oklahoma (not called)');
});

test('business hours: weekdays 9 to 5 where the number is', () => {
  assert.equal(O.businessHoursOk('+14785550100', THU_10AM_ET), true);
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-05T12:30:00Z')), false, '7:30 AM Eastern');
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-05T22:30:00Z')), false, '5:30 PM Eastern');
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-08T15:00:00Z')), false, 'Sunday');
});

test('import: Pro and signed terms first; every number checked; the free checks run before paying for a lookup', async () => {
  const DB = makeDB(), env = { DB };
  const csv = 'business,phone,contact\nAce Diner,478-555-0101,Sam\nBob Cell,(478) 555-0102,Bob\nNo Idea,4785550103,\nHome Line,478-555-0104,\nMercy Hospital,478-555-0105,\nLA Cafe,213-555-0106,\nTulsa Tire,918-555-0107,\nUnlisted Shop,478-555-0108,\nAce Diner again,478 555 0101,Sam';
  const lk = { '+14785550101': { type: 'landline', callerType: 'BUSINESS', callerName: 'ACE DINER' }, '+14785550102': { type: 'mobile', callerType: 'CONSUMER' }, '+14785550103': '',
    '+14785550104': { type: 'landline', callerType: 'CONSUMER', callerName: 'SMITH JOHN' }, '+14785550105': { type: 'landline', callerType: 'BUSINESS' }, '+14785550108': { type: 'fixedVoip', callerType: '' } };
  const asked = [], look = p => { asked.push(p); return lk[p]; };
  assert.equal((await O.importList(env, C, csv, look)).ok, false, 'terms not signed yet');
  assert.match((await O.importList(env, G, csv, look)).error, /Pro plan/, 'not on Pro');
  assert.equal((await O.importList(env, REG, csv, look)).ok, false);
  await O.agree(env, C, SIGN);
  const r = await O.importList(env, C, csv, look);
  assert.equal(r.ok, true);
  assert.deepEqual([r.ready, r.held, r.skipped], [1, 0, 7]);
  const st = Object.fromEntries((await DB.prepare("SELECT phone, status FROM outreach_lists WHERE client_id = 'c1'").all()).results.map(x => [x.phone, x.status]));
  assert.deepEqual(st, {
    '+14785550101': 'ready',
    '+14785550102': 'skipped: cell phone',
    '+14785550103': 'skipped: unknown number',
    '+14785550104': 'skipped: home or personal line',
    '+14785550105': 'skipped: hospital, school or emergency line',
    '+12135550106': 'skipped: California (not called)',
    '+19185550107': 'skipped: Oklahoma (not called)',
    '+14785550108': 'skipped: caller ID not listed as a business'
  });
  assert.deepEqual(asked.sort(), ['+14785550101', '+14785550102', '+14785550103', '+14785550104', '+14785550108'], 'states and hospitals are skipped without a lookup');
  const s = await O.outreachState(env, C);
  assert.equal(s.counts.skipped, 7);
  assert.ok(s.skippedList.some(x => x.b === 'Home Line' && x.why === 'home or personal line'));
  // when caller ID comes back empty for every landline, nothing is called and Christopher gets one push (the lookup is failing)
  const pushed = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { pushed.push(String((init && init.body) || '') + ' ' + JSON.stringify((init && init.headers) || {})); return new Response('ok'); };
  try {
    const e2 = await O.importList(Object.assign({}, env, { NTFY_URL: 'https://ntfy.example/ops' }), C, 'A,478-555-0191\nB,478-555-0192\nC,478-555-0193\nD,478-555-0194\nE,478-555-0195', () => ({ type: 'landline', callerType: '', callerName: '' }));
    assert.deepEqual([e2.ready, e2.skipped], [0, 5]);
  } finally { globalThis.fetch = real; }
  assert.ok(pushed.some(x => /caller ID lookups came back empty/.test(x)), 'one push says the lookup is failing');
});

test('a list that needs a look is held, Christopher gets a page with Approve and Reject, and approving lets it call', async () => {
  const DB = makeDB(), env = { DB };
  await O.agree(env, C, SIGN);
  const look = () => BIZ();
  const review = async (e, c, entries) => ({ hold: true, concerns: ['Several names look like people, not businesses.'], skip: [{ i: 2, why: 'looks like a person' }] });
  const r = await O.importList(env, C, 'Ace Diner,478-555-0121\nJane Doe,478-555-0122\nBolt Hardware,478-555-0123', look, review);
  assert.deepEqual([r.ready, r.held, r.skipped], [0, 2, 1]);
  assert.match(r.message, /being checked by Always Open/);
  const rv = await DB.prepare("SELECT id, kind, state FROM outreach_review WHERE client_id = 'c1'").first();
  assert.deepEqual([rv.kind, rv.state], ['list', 'held']);
  const u = new URL('https://x/ops/outreach-review?id=' + rv.id);
  const board = await O.outreachBoard(env);
  assert.equal(board.length, 1, 'held: on the ops board');
  assert.match(board[0].detail, /A list of 2 businesses, held .*\/ops\/outreach-review\?id=/);
  const page = await (await O.reviewPage(env, new Request(u), u)).text();
  for (const w of [/Several names look like people/, />Approve</, />Reject</, /Jane Doe/, /noindex/]) assert.match(page, w);
  await O.reviewPage(env, new Request(u, { method: 'POST', body: form({ act: 'approve' }) }), u);
  assert.deepEqual((await DB.prepare("SELECT status FROM outreach_lists WHERE client_id = 'c1' ORDER BY id").all()).results.map(x => x.status), ['ready', 'skipped: looks like a person', 'ready']);
  // a second tap changes nothing, and the page says so
  await O.reviewPage(env, new Request(u, { method: 'POST', body: form({ act: 'reject' }) }), u);
  assert.equal((await DB.prepare('SELECT state FROM outreach_review WHERE id = ?1').bind(rv.id).first()).state, 'approved');
  const idx = new URL('https://x/ops/outreach-review');
  assert.match(await (await O.reviewPage(env, new Request(idx), idx)).text(), /Nothing is waiting on you/);
  assert.deepEqual(await O.outreachBoard(env), [], 'decided: off the ops board');
});

test('a list made mostly of home phones is held even when the automatic read is unavailable; rejecting it calls nobody', async () => {
  const DB = makeDB(), env = { DB };
  await O.agree(env, C, SIGN);
  const home = { type: 'landline', callerType: 'CONSUMER' };
  const lk = { '+14785550141': BIZ(), '+14785550142': home, '+14785550143': BIZ(), '+14785550144': { type: 'mobile', callerType: 'CONSUMER' }, '+14785550145': home, '+14785550146': home };
  const r = await O.importList(env, C, 'A,478-555-0141\nB,478-555-0142\nC,478-555-0143\nD,478-555-0144\nE,478-555-0145\nF,478-555-0146', p => lk[p]);
  assert.deepEqual([r.ready, r.held, r.skipped], [0, 2, 4]);
  const rv = await DB.prepare("SELECT id, reasons FROM outreach_review WHERE client_id = 'c1'").first();
  assert.match(rv.reasons, /3 of 6 numbers are home phones/);
  const u = new URL('https://x/ops/outreach-review?id=' + rv.id);
  await O.reviewPage(env, new Request(u, { method: 'POST', body: form({ act: 'reject' }) }), u);
  assert.deepEqual((await DB.prepare("SELECT DISTINCT status FROM outreach_lists WHERE client_id = 'c1' AND status NOT LIKE 'skipped: home%' AND status NOT LIKE 'skipped: cell%'").all()).results.map(x => x.status), ['skipped: not approved']);
  // cell phones alone never hold a list: plenty of small businesses answer on a cell
  const cells = await O.importList(env, C, 'G,478-555-0147\nH,478-555-0148\nI,478-555-0149\nJ,478-555-0150\nK,478-555-0151\nL,478-555-0152', p => p.endsWith('7') ? BIZ() : { type: 'mobile', callerType: 'CONSUMER' });
  assert.deepEqual([cells.ready, cells.held, cells.skipped], [1, 0, 5]);
});

test('turning it on needs the legal name and a call-back number that is not the line Max calls from', async () => {
  const DB = makeDB(), env = { DB };
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785550100', 'c1', 'Ace Hoods', 1)").run();
  await O.agree(env, C, SIGN);
  const t = 'We clean commercial kitchen hoods.';
  assert.match((await O.savePitch(env, C, t, true, { legal: '', callback: '478-555-0199' })).error, /legal name/);
  assert.match((await O.savePitch(env, C, t, true, { legal: 'Ace Hoods LLC', callback: '' })).error, /call you back/);
  assert.match((await O.savePitch(env, C, t, true, { legal: 'Ace Hoods LLC', callback: '(478) 555-0100' })).error, /not the number Max calls from/);
  assert.equal((await O.savePitch(env, C, t, false, { legal: '', callback: '' })).ok, true, 'switched off, the sentence alone can be saved');
  assert.equal((await O.savePitch(env, C, t, true, ON)).ok, true);
  const p = await DB.prepare("SELECT legal, callback, review, on_ FROM outreach_pitch WHERE client_id = 'c1'").first();
  assert.deepEqual([p.legal, p.callback, p.review, p.on_], ['Ace Hoods LLC', '+14785550199', 'ok', 1]);
  assert.match((await O.savePitch(env, G, t, false)).error, /Pro plan/);
  const s = await O.outreachState(env, C);
  assert.deepEqual([s.pro, s.legal, s.callback, s.on, s.dailyCap], [true, 'Ace Hoods LLC', '+14785550199', true, 50]);
  assert.deepEqual(s.states, ['California', 'Florida', 'Indiana', 'Minnesota', 'Oklahoma']);
  assert.equal((await O.outreachState(env, G)).pro, false, 'the app shows Growth what Pro adds');
  assert.equal(await O.outreachState(env, REG), null, 'never shown to a regulated business');
});

test('the sentence is read too: one that needs a look waits for Christopher, and nothing is called until he approves', async () => {
  const DB = makeDB(), env = { DB, VOICE_KEY: 'k' };
  await ready(env);
  await add(DB, 'c1', '+14785550151');
  const holdIt = async () => ({ hold: true, concerns: ['It offers business loans, which needs a look.'], skip: [] });
  const r = await O.savePitch(env, C, 'We help businesses get loans fast.', true, ON, holdIt);
  assert.equal(r.held, true);
  assert.match(r.message, /checking your sentence/);
  assert.equal((await O.outreachState(env, C)).sentenceHeld, true);
  const tw = fakeTwilio();
  try { await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ }); } finally { tw.done(); }
  assert.equal(tw.calls.length, 0, 'held: nobody is called');
  const rv = await DB.prepare("SELECT id, kind, text FROM outreach_review WHERE client_id = 'c1' AND state = 'held'").first();
  assert.deepEqual([rv.kind, rv.text], ['sentence', 'We help businesses get loans fast.']);
  const u = new URL('https://x/ops/outreach-review?id=' + rv.id);
  assert.match(await (await O.reviewPage(env, new Request(u, { method: 'POST', body: form({ act: 'approve' }) }), u)).text(), /Approved/);
  assert.equal((await DB.prepare("SELECT review FROM outreach_pitch WHERE client_id = 'c1'").first()).review, 'ok');
  // a new sentence replaces one still waiting
  await O.savePitch(env, C, 'We fix walk-in coolers.', true, ON, holdIt);
  await O.savePitch(env, C, 'We fix walk-in freezers.', true, ON, holdIt);
  assert.deepEqual((await DB.prepare("SELECT state FROM outreach_review WHERE client_id = 'c1' AND kind = 'sentence' ORDER BY at, id").all()).results.map(x => x.state).sort(), ['approved', 'held', 'replaced']);
});

test('the cron calls only with the kill switch on, on Pro, in business hours, and checks the line again right before dialing', async () => {
  const DB = makeDB(), env = { DB, VOICE_KEY: 'k', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  await ready(env);
  await DB.prepare("UPDATE billing_config SET v = '0' WHERE k = 'outreach_enabled'").run();
  await add(DB, 'c1', '+14785550101');
  const tw = fakeTwilio();
  try {
    let r = await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.deepEqual([r.dialed, tw.calls.length], [0, 0], 'kill switch off: nothing');
    await DB.prepare("UPDATE billing_config SET v = '1' WHERE k = 'outreach_enabled'").run();
    await O.outreachCron(env, Date.parse('2026-11-08T15:00:00Z'), { lookup: BIZ });
    assert.equal(tw.calls.length, 0, 'Sunday: not called');
    r = await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.equal(r.dialed, 1);
    assert.deepEqual(tw.calls.map(x => x.to), ['+14785550101']);
    assert.equal((await DB.prepare("SELECT status FROM outreach_lists WHERE phone = '+14785550101'").first()).status, 'called');
    // the line changed hands since the list was added: a home line now, so it is skipped, not called
    await add(DB, 'c1', '+14785550102'); await add(DB, 'c1', '+14785550103');
    await O.outreachCron(env, THU_10AM_ET, { lookup: p => p === '+14785550102' ? { type: 'landline', callerType: 'CONSUMER' } : { type: 'mobile', callerType: 'BUSINESS' } });
    assert.equal(tw.calls.length, 1);
    assert.equal((await DB.prepare("SELECT status FROM outreach_lists WHERE phone = '+14785550102'").first()).status, 'skipped: home or personal line (checked before calling)');
    assert.equal((await DB.prepare("SELECT status FROM outreach_lists WHERE phone = '+14785550103'").first()).status, 'skipped: cell phone (checked before calling)');
    // a row in a state we don't call never dials, even if it got onto the list some other way
    await add(DB, 'c1', '+14155550104');
    await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.equal(tw.calls.length, 1);
    // off Pro: nothing
    await add(DB, 'c1', '+14785550105');
    await DB.prepare("UPDATE app_clients SET tier = 'Growth' WHERE client_id = 'c1'").run();
    await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.equal(tw.calls.length, 1, 'not on Pro: not called');
    await DB.prepare("UPDATE app_clients SET tier = 'Pro' WHERE client_id = 'c1'").run();
    // a paused line calls nobody
    await DB.prepare("UPDATE voice_lines SET on_air = 0").run();
    await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.equal(tw.calls.length, 1, 'line paused: not called');
    await DB.prepare("UPDATE voice_lines SET on_air = 1").run();
    await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.deepEqual(tw.calls.map(x => x.to), ['+14785550101', '+14785550105']);
  } finally { tw.done(); }
});

test('limits: 3 a run per client, 50 a day, one Outreach call per business a week across every client, and clients take turns', async () => {
  const DB = makeDB(), env = { DB, VOICE_KEY: 'k', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' };
  const C2 = { client_id: 'c2', regulated: 0, tier: 'Pro', business: 'Bolt Hoods' };
  await ready(env); await ready(env, C2);
  for (let i = 0; i < 5; i++) { await add(DB, 'c1', '+1478555016' + i); await add(DB, 'c2', '+1478555017' + i); }
  const tw = fakeTwilio();
  try {
    await O.outreachCron(env, THU_10AM_ET, { lookup: BIZ });
    assert.equal(tw.calls.length, 6, 'three each, both clients');
    assert.deepEqual(tw.calls.slice(0, 2).map(x => x.to).sort(), ['+14785550160', '+14785550170'], 'each client’s first, then each client’s second');
    await O.outreachCron(env, THU_10AM_ET + 600000, { lookup: BIZ });
    assert.equal(tw.calls.length, 10, 'the rest on the next run');
    // the daily limit
    for (let i = 0; i < 46; i++) await add(DB, 'c1', '+1706555' + String(1000 + i), { status: 'called', last: new Date(THU_10AM_ET - 3600000).toISOString(), attempts: 1 });
    await add(DB, 'c1', '+14785550199');
    await O.outreachCron(env, THU_10AM_ET + 1200000, { lookup: BIZ });
    assert.equal(await attempts(DB, '+14785550199'), 0, '50 in the last day: no more today');
    // another client called this business three days ago: it waits out the week; a business nobody called this week goes
    await add(DB, 'c1', '+14785550188', { status: 'called', last: new Date(THU_10AM_ET - 3 * 86400000).toISOString(), attempts: 1 });
    await add(DB, 'c2', '+14785550188'); await add(DB, 'c2', '+14785550187');
    await O.outreachCron(env, THU_10AM_ET + 1800000, { lookup: BIZ });
    assert.equal(await attempts(DB, '+14785550188', 'c2'), 0, 'called by another client this week: waits');
    assert.equal(await attempts(DB, '+14785550187', 'c2'), 1);
    await O.outreachCron(env, THU_10AM_ET + 5 * 86400000, { lookup: BIZ });   // the next Tuesday, 10 AM
    assert.equal(await attempts(DB, '+14785550188', 'c2'), 1, 'a week on: called');
  } finally { tw.done(); }
});

test('the pitch is one honest sentence: no person claim, no promise, no tags', () => {
  assert.deepEqual(O.pitchProblems('We clean commercial kitchen hoods and can work around your hours.'), []);
  assert.ok(O.pitchProblems('This is not a robot, I am a real person from the shop.').length);
  assert.ok(O.pitchProblems('We can be there within the hour.').length);
  assert.ok(O.pitchProblems('x'.repeat(241)).length);
  assert.ok(O.pitchProblems('').length);
  assert.ok(O.legalProblems('').length);
  assert.deepEqual(O.legalProblems('Ace Plumbing LLC'), []);
  assert.deepEqual(O.callbackProblems('478-555-0199', '+14785550100'), []);
  assert.ok(O.callbackProblems('478-555-0100', '+14785550100').length);
  assert.equal(O.speakPhone('+14785550199'), '4 7 8, 5 5 5, 0 1 9 9');
  const s = O.script('Ace Plumbing LLC', 'We fix commercial plumbing.', 'Mike Lane', '+14785550199', 'Ace Plumbing');
  assert.equal(s, 'Hi, this is Max, an automated assistant calling for Ace Plumbing LLC. To stop these calls, say stop or press 9 at any time. We fix commercial plumbing. You can reach Ace Plumbing at 4 7 8, 5 5 5, 0 1 9 9. Would you like Mike to give you a call about it? Say yes or no.');
  assert.doesNotMatch(s, /recorded/, 'Outreach calls are not recorded, so Max never says they are');
});

test('outreach is wired: the call routes, the status callback, the timer job, the review page, the call-back opt-out and the app', () => {
  const voice = fs.readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../src/apppage.js', import.meta.url), 'utf8');
  for (const w of [/outreachTwiml/, /outreachGather/, /outreachStatus/, /inboundOptOut/]) assert.match(voice, w);
  assert.match(index, /outreachCron/);
  assert.match(index, /'\/ops\/outreach-review'[\s\S]{0,400}boardOk[\s\S]{0,400}reviewPage/);
  assert.match(app, /legal: b\.legal, callback: b\.callback/);
  assert.match(app, /outreach: \(pro \|\| has\('outreach'\)\) && !reg/);
  for (const w of [/id="or-legal"/, /id="or-cb"/, /id="or-hear"/, /data-a="ask-outreach"/, /Comes with Pro/]) assert.match(page, w);
});

test('a call: who is calling and how to stop come first, then the sentence and the owner’s number; stop is for good; yes is a lead', async () => {
  const DB = makeDB(), env = { DB, VOICE_KEY: 'k' };
  await O.ensureOutreach(env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, owner_set) VALUES ('+14785550100', 'c1', 'Ace Hoods', 1, ?1)").bind(JSON.stringify({ ownerName: 'Mike Lane' })).run();
  await O.agree(env, C, SIGN); await O.savePitch(env, C, 'We clean commercial kitchen hoods.', true, ON);
  for (const p of ['+14785550111', '+14785550112', '+14785550113', '+14785550114', '+14785550115']) await add(DB, 'c1', p, { status: 'called', attempts: 1 });
  const ids = (await DB.prepare('SELECT id FROM outreach_lists ORDER BY id').all()).results.map(x => x.id);
  const at = (k, i) => new URL('https://x/voice/' + k + '/k?id=' + ids[i]);
  const say = await (await O.outreachTwiml(env, at('or', 0), new FormData())).text();
  assert.match(say, /Hi, this is Max, an automated assistant calling for Ace Hoods LLC\. To stop these calls, say stop or press 9 at any time\. We clean commercial kitchen hoods\. You can reach Ace Hoods at 4 7 8, 5 5 5, 0 1 9 9\. Would you like Mike to give you a call about it\? Say yes or no\./);
  assert.doesNotMatch(say, /recorded/);
  assert.match(await (await O.outreachTwiml(env, at('or', 0), form({ AnsweredBy: 'machine_start' }))).text(), /^(?![\s\S]*<Say>)[\s\S]*<Hangup\/>/, 'an answering machine: no message left');
  assert.match(await (await O.outreachGather(env, at('org', 0), form({ SpeechResult: 'stop calling' }))).text(), /will not get these calls again/);
  assert.ok(await DB.prepare("SELECT 1 FROM outreach_optout WHERE phone10 = '4785550111'").first());
  assert.match(await (await O.outreachGather(env, at('org', 3), form({ Digits: '9' }))).text(), /will not get these calls again/, 'press 9');
  assert.ok(await DB.prepare("SELECT 1 FROM outreach_optout WHERE phone10 = '4785550114'").first());
  const yes = await (await O.outreachGather(env, at('org', 1), form({ Digits: '1' }))).text();
  assert.match(yes, /Ace Hoods will call you\. If you need them sooner, the number is 4 7 8, 5 5 5, 0 1 9 9\./);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM app_leads WHERE client_id = 'c1'").first()).n, 1);
  assert.match(await (await O.outreachGather(env, at('org', 4), form({ SpeechResult: 'no thanks' }))).text(), /you can reach Ace Hoods at 4 7 8, 5 5 5, 0 1 9 9/);
  await O.outreachStatus(env, at('orstatus', 2), form({ CallStatus: 'no-answer' }));
  assert.equal((await DB.prepare('SELECT result FROM outreach_lists WHERE id = ?1').bind(ids[2]).first()).result, 'no-answer');
  // a sentence that is waiting for a look is never said, even on a call already ringing
  await DB.prepare("UPDATE outreach_pitch SET review = 'held'").run();
  assert.doesNotMatch(await (await O.outreachTwiml(env, at('or', 2), new FormData())).text(), /<Say>/);
});

test('a business that calls back and says "take us off your list" is never called again, for any client', async () => {
  const DB = makeDB(), env = { DB };
  await O.ensureOutreach(env);
  await add(DB, 'c1', '+14785550131', { status: 'called', attempts: 1 });
  await add(DB, 'c2', '+14785550131');
  assert.equal(await O.inboundOptOut(env, '+14785550131', 'Hi, can you come fix a leak today?', 'c1'), false, 'an ordinary call');
  assert.equal(await O.inboundOptOut(env, '+14785550199', 'take us off your list', 'c1'), false, 'a number Outreach never called');
  assert.equal(await O.inboundOptOut(env, '+14785550131', 'Yeah, you called us earlier. Please take us off your list.', 'c1'), true);
  assert.ok(await DB.prepare("SELECT 1 FROM outreach_optout WHERE phone10 = '4785550131'").first());
  assert.deepEqual((await DB.prepare("SELECT status FROM outreach_lists WHERE phone = '+14785550131' ORDER BY client_id").all()).results.map(x => x.status), ['optout', 'optout']);
  for (const w of ['Don’t call us again', 'stop calling this number', 'please remove us', 'do not call this number']) assert.ok(O.DNC_RE.test(w), w);
  for (const w of ['can you call me back', 'I need to remove a stump', 'we stopped by yesterday']) assert.ok(!O.DNC_RE.test(w), w);
});
