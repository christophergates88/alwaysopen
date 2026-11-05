// Outreach calls to businesses (Brief 3, Part 8d): every gate holds, and nothing dials while OUTREACH_LIVE is false.
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

test('nothing dials: OUTREACH_LIVE is false, and the call routes hang up while it is', async () => {
  assert.equal(O.OUTREACH_LIVE, false, 'turning outreach on is a deliberate one-line change after the lawyer review');
  assert.deepEqual(O.blockedBy(row, ok), ['not live (lawyer review)']);
  const r = await O.outreachTwiml({}, new URL('https://x/voice/or/k?id=1'), new FormData());
  assert.match(await r.text(), /<Hangup\/>/);
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
  assert.equal((await O.importList(env, C, csv, p => types[p])).ok, false, 'no attestation yet');
  assert.equal((await O.attest(env, REG)).ok, false);
  assert.equal((await O.importList(env, REG, csv, p => types[p])).ok, false);
  await O.attest(env, C, 'Dana');
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

test('the cron dials nobody and counts who could be called once it is live', async () => {
  const DB = makeDB(), env = { DB };
  await O.ensureOutreach(env);
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_lines (client_id TEXT, number TEXT, business TEXT, regulated INTEGER, owner_set TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)").run();
  await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('outreach_enabled', '1')").run();
  await DB.prepare("INSERT INTO voice_lines (client_id, number, business, regulated, owner_set) VALUES ('c1', '+14785550100', 'Ace', 0, '{}')").run();
  await O.attest(env, C);
  await O.savePitch(env, C, 'We clean commercial kitchens.', true);
  await DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, line_type, status) VALUES ('c1','Diner','+14785550101','landline','ready')").run();
  const r = await O.outreachCron(env, THU_10AM_ET);
  assert.equal(r.dialed, 0);
  assert.equal(r.could, 1);
});

test('outreach is wired nowhere that dials: no route, no cron call', () => {
  const voice = fs.readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(voice + index, /outreachTwiml|outreachGather|outreachCron/, 'routes and the cron are added only when it goes live');
});
