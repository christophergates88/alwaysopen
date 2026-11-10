// Outreach calls to businesses (Brief 3, Part 8d): live since Nov 10, 2026 behind Christopher's kill switch and, for each
// client, the owner's own switch, which only turns on once the owner has signed the current Outreach terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const O = await import('../src/outreach.js');
const { makeDB } = await import('./rehearsal/harness.js');

const C = { client_id: 'c1', regulated: 0 };
const REG = { client_id: 'd1', regulated: 1 };
const THU_10AM_ET = Date.parse('2026-11-05T15:00:00Z');
const ok = { now: THU_10AM_ET, killSwitchOn: true, regulated: false, attested: true, pitch: 'We clean commercial kitchens.', pitchOn: true, optedOut: false, hoursOk: true };
const row = { line_type: 'landline', status: 'ready', last_called: '' };

test('live: with every gate open nothing blocks the call, and an unknown call id hangs up', async () => {
  assert.equal(O.OUTREACH_LIVE, true, 'Carter read the plan and Christopher said go (Nov 10, 2026)');
  assert.deepEqual(O.blockedBy(row, ok), []);
  const DB = makeDB(); await O.ensureOutreach({ DB });
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_lines (client_id TEXT, number TEXT, business TEXT, regulated INTEGER, owner_set TEXT)").run();
  const r = await O.outreachTwiml({ DB }, new URL('https://x/voice/or/k?id=999'), new FormData());
  assert.match(await r.text(), /<Hangup\/>/);
});

const SIGN = { version: O.TERMS_VERSION, name: 'Dana Whitfield', agree: true };
test('the terms: the owner is the caller, releases and indemnifies us, and signs by typing a full name', async () => {
  const txt = O.TERMS_TEXT;
  for (const w of [/you are the seller and the party on whose behalf each call is made/, /release and forever discharge Always Open and Lake Country Foam Party, LLC/, /defend, indemnify and hold harmless/, /not legal advice/i, /Georgia law governs/, /Telephone Consumer Protection Act/, /National Do Not Call Registry/]) assert.match(txt, w);
  const DB = makeDB(), env = { DB };
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { agree: false }))).ok, false, 'the box must be ticked');
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { version: '2026-01-01' }))).ok, false, 'an old version is refused');
  assert.equal((await O.agree(env, C, Object.assign({}, SIGN, { name: 'Dana' }))).ok, false, 'a full name');
  assert.equal((await O.agree(env, REG, SIGN)).ok, false, 'never for a regulated business');
  assert.equal((await O.agree(env, Object.assign({ staff: 'Tech Tom' }, C), SIGN)).ok, false, 'only the owner signs');
  assert.equal((await O.attest(env, C)).ok, false, 'the old one-tap confirmation no longer counts');
  assert.equal((await O.savePitch(env, C, 'We clean commercial kitchens.', true)).needTerms, true, 'no switching on before signing');
  assert.equal((await O.agree(env, C, SIGN, { by: 'Dana', ip: 'iphash', ua: 'iPhone' })).ok, true);
  const rec = await DB.prepare("SELECT version, hash, name, ip_hash, ua FROM outreach_terms WHERE client_id = 'c1'").first();
  assert.deepEqual([rec.version, rec.hash, rec.name, rec.ip_hash, rec.ua], [O.TERMS_VERSION, await O.termsHash(), 'Dana Whitfield', 'iphash', 'iPhone']);
  assert.equal((await O.savePitch(env, C, 'We clean commercial kitchens.', true)).ok, true, 'signed: it turns on');
  // a new version of the terms asks again
  await DB.prepare("UPDATE outreach_terms SET version = '2026-01-01' WHERE client_id = 'c1'").run();
  assert.equal(await O.attested(env, 'c1'), false);
});

test('every gate blocks on its own', () => {
  const only = (r, ctx) => O.blockedBy(r, Object.assign({}, ok, ctx)).filter(x => !/not live/.test(x));
  assert.deepEqual(only(row, { killSwitchOn: false }), ['kill switch off']);
  assert.deepEqual(only(row, { regulated: true }), ['regulated client']);
  assert.deepEqual(only(row, { attested: false }), ['no attestation']);
  assert.deepEqual(only(row, { pitchOn: false }), ['owner switch off']);
  assert.deepEqual(only(Object.assign({}, row, { line_type: 'mobile' }), {}), ['not a business landline']);
  assert.deepEqual(only(Object.assign({}, row, { line_type: 'nonFixedVoip' }), {}), ['not a business landline']);
  assert.deepEqual(only(row, { optedOut: true }), ['opted out']);
  assert.deepEqual(only(Object.assign({}, row, { last_called: new Date(THU_10AM_ET - 10 * 86400000).toISOString() }), {}), ['called in the last 30 days']);
  assert.deepEqual(only(Object.assign({}, row, { last_called: new Date(THU_10AM_ET - 31 * 86400000).toISOString() }), {}), []);
  assert.deepEqual(only(row, { hoursOk: false }), ['outside business hours']);
  assert.deepEqual(only(row, {}), []);
});

test('business hours: weekdays 9 to 5 where the number is', () => {
  assert.equal(O.businessHoursOk('+14785550100', THU_10AM_ET), true);
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-05T12:30:00Z')), false, '7:30 AM Eastern');
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-05T22:30:00Z')), false, '5:30 PM Eastern');
  assert.equal(O.businessHoursOk('+14785550100', Date.parse('2026-11-08T15:00:00Z')), false, 'Sunday');
});

test('import: attestation first, mobiles and unknowns skipped, never on a regulated line', async () => {
  const DB = makeDB(), env = { DB };
  const csv = 'business,phone,contact\nAce Diner,478-555-0101,Sam\nBob Cell,(478) 555-0102,Bob\nNo Idea,4785550103,\nAce Diner again,478 555 0101,Sam';
  const types = { '+14785550101': 'landline', '+14785550102': 'mobile', '+14785550103': '' };
  assert.equal((await O.importList(env, C, csv, p => types[p])).ok, false, 'terms not signed yet');
  assert.equal((await O.agree(env, REG, SIGN)).ok, false);
  assert.equal((await O.importList(env, REG, csv, p => types[p])).ok, false);
  await O.agree(env, C, SIGN);
  const r = await O.importList(env, C, csv, p => types[p]);
  assert.equal(r.ok, true);
  assert.equal(r.ready, 1);
  assert.equal(r.skipped, 2);
  const rows = (await DB.prepare("SELECT phone, status FROM outreach_lists WHERE client_id = 'c1' ORDER BY phone").all()).results;
  assert.deepEqual(rows.map(x => x.status), ['ready', 'skipped: mobile', 'skipped: unknown']);
});

test('the pitch is one honest sentence: no person claim, no promise, no tags', () => {
  assert.deepEqual(O.pitchProblems('We clean commercial kitchen hoods and can work around your hours.'), []);
  assert.ok(O.pitchProblems('This is not a robot, I am a real person from the shop.').length);
  assert.ok(O.pitchProblems('We can be there within the hour.').length);
  assert.ok(O.pitchProblems('x'.repeat(241)).length);
  assert.ok(O.pitchProblems('').length);
  assert.match(O.script('Ace Plumbing', 'We fix commercial plumbing.', 'Mike Lane'), /^Hi, this is Max, an automated assistant calling for Ace Plumbing\. This call is recorded\. .*say stop\.$/);
});

test('the cron calls only with the kill switch on, the terms signed and the owner switch on', async () => {
  const DB = makeDB(), env = { DB };
  await O.ensureOutreach(env);
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_lines (client_id TEXT, number TEXT, business TEXT, regulated INTEGER, owner_set TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)").run();
  await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('outreach_enabled', '0')").run();
  await DB.prepare("INSERT INTO voice_lines (client_id, number, business, regulated, owner_set) VALUES ('c1', '+14785550100', 'Ace', 0, '{}')").run();
  await DB.prepare("UPDATE voice_lines SET on_air = 1").run().catch(() => {});   // the line is on (the shared schema has the column)
  await O.agree(env, C, SIGN);
  await O.savePitch(env, C, 'We clean commercial kitchens.', true);
  await DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, line_type, status) VALUES ('c1','Diner','+14785550101','landline','ready')").run();
  let r = await O.outreachCron(env, THU_10AM_ET);
  assert.deepEqual([r.dialed, r.could], [0, 0], 'kill switch off: nothing');
  assert.equal((await DB.prepare("SELECT attempts FROM outreach_lists WHERE phone = '+14785550101'").first()).attempts, 0);
  await DB.prepare("UPDATE billing_config SET v = '1' WHERE k = 'outreach_enabled'").run();
  r = await O.outreachCron(env, Date.parse('2026-11-08T15:00:00Z'));
  assert.equal((await DB.prepare("SELECT attempts FROM outreach_lists WHERE phone = '+14785550101'").first()).attempts, 0, 'Sunday: not called');
  r = await O.outreachCron(env, THU_10AM_ET);
  assert.equal((await DB.prepare("SELECT attempts FROM outreach_lists WHERE phone = '+14785550101'").first()).attempts, 1, 'a weekday at 10 AM with every gate open: dialed (no Twilio here, so it records why)');
  // a paused line calls nobody
  await DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, line_type, status) VALUES ('c1','Cafe','+14785550109','landline','ready')").run();
  await DB.prepare("UPDATE voice_lines SET on_air = 0").run().catch(() => {});
  await O.outreachCron(env, THU_10AM_ET);
  assert.equal((await DB.prepare("SELECT attempts FROM outreach_lists WHERE phone = '+14785550109'").first()).attempts, 0, 'line paused: not called');
});

test('outreach is wired: the call routes, the status callback and the timer job', () => {
  const voice = fs.readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const w of [/outreachTwiml/, /outreachGather/, /outreachStatus/]) assert.match(voice, w);
  assert.match(index, /outreachCron/);
});

test('a call: Max says who he is and that it is recorded; stop is for good; yes is a lead; no answer is written down', async () => {
  const DB = makeDB(), env = { DB, VOICE_KEY: 'k' };
  await O.ensureOutreach(env);
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_lines (client_id TEXT, number TEXT, business TEXT, regulated INTEGER, owner_set TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, at TEXT, name TEXT, phone TEXT, need TEXT, sms_ok INTEGER, status TEXT)").run();
  await DB.prepare("INSERT INTO voice_lines (client_id, number, business, regulated, owner_set) VALUES ('c1', '+14785550100', 'Ace Hoods', 0, '{}')").run();
  await O.agree(env, C, SIGN); await O.savePitch(env, C, 'We clean commercial kitchen hoods.', true);
  for (const p of ['+14785550111', '+14785550112', '+14785550113']) await DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, line_type, status) VALUES ('c1','Diner',?1,'landline','called')").bind(p).run();
  const ids = (await DB.prepare('SELECT id FROM outreach_lists ORDER BY id').all()).results.map(x => x.id);
  const say = await (await O.outreachTwiml(env, new URL('https://x/voice/or/k?id=' + ids[0]), new FormData())).text();
  assert.match(say, /Hi, this is Max, an automated assistant calling for Ace Hoods\. This call is recorded\./);
  const f = o => { const d = new FormData(); for (const k in o) d.set(k, o[k]); return d; };
  assert.match(await (await O.outreachGather(env, new URL('https://x/voice/org/k?id=' + ids[0]), f({ SpeechResult: 'stop calling' }))).text(), /will not get these calls again/);
  assert.ok(await DB.prepare("SELECT 1 FROM outreach_optout WHERE phone10 = '4785550111'").first());
  assert.match(await (await O.outreachGather(env, new URL('https://x/voice/org/k?id=' + ids[1]), f({ Digits: '1' }))).text(), /will call you/);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM app_leads WHERE client_id = 'c1'").first()).n, 1);
  await O.outreachStatus(env, new URL('https://x/voice/orstatus/k?id=' + ids[2]), f({ CallStatus: 'no-answer' }));
  assert.equal((await DB.prepare('SELECT result FROM outreach_lists WHERE id = ?1').bind(ids[2]).first()).result, 'no-answer');
});
