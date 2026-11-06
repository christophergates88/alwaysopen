// Build Brief 7, Part 2: the timecard reply, the timecard's Monday log, Compliance Guard's three lines, the Storm Desk and
// Rate-Shock Radar cards' state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
H.installFetch(world, env);
const TC = await import('../src/timecard.js');
const { guardChecks } = await import('../src/app.js');

const CID = 'b7-plumber';
await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, phone) VALUES (?1, 'h-b7', 'B7 Plumbing', 1, 'Growth', '4785550111')").bind(CID).run();
await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, facts, updated) VALUES ('+14785550112', ?1, 'B7 Plumbing', 1, 'plumbing', 'Eatonton, GA', '{}', '2026-11-01')").bind(CID).run();
const MON = Date.parse('2026-11-09T13:04:00Z');   // Monday 8:04 AM Eastern
for (const [i, at, reason, summary] of [[1, '2026-11-03T02:10:00Z', 'Water heater', 'Water heater leaking in the garage; wants someone tomorrow.'], [2, '2026-11-04T23:40:00Z', 'Clog', 'Kitchen sink clogged; booked Thursday.'], [3, '2026-11-05T15:00:00Z', 'Estimate', 'Price for a new toilet.']])
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, reason, summary, outcome, status, test, transcript) VALUES (?1, ?2, '+14785550112', ?3, '+14045550123', 'Caller', ?4, ?5, 'done', 'handled', 0, '[]')").bind('CAb7' + i, CID, at, reason, summary).run();

test('a question back within a day of the timecard is answered from that week’s calls, and kept with the card', async () => {
  await TC.ensureTimecards(env);
  await DB.prepare("INSERT INTO max_timecards (client_id, week, at, nums, status) VALUES (?1, '2026-11-02', ?2, '{}', 'sent')").bind(CID, new Date(MON).toISOString()).run();
  let seen = '';
  const brain = async (sys, msgs) => { seen = sys + '\n' + msgs[0].content; return 'Two after-hours calls: a water heater leak and a kitchen clog. The clog booked Thursday.'; };
  const a = await TC.timecardReply(env, CID, 'what did the after hours calls come from?', MON + 90 * 60e3, { brain });
  assert.match(a, /water heater/);
  assert.match(seen, /under 40 words/); assert.match(seen, /\(after hours\)/); assert.match(seen, /Price for a new toilet/);
  const row = await DB.prepare('SELECT qa FROM max_timecards WHERE client_id = ?1').bind(CID).first();
  assert.equal(JSON.parse(row.qa)[0].q, 'what did the after hours calls come from?');
  const st = await TC.timecardState(env, CID, MON + 2 * 3600e3);
  assert.equal(st.sent, true); assert.equal(st.when, 'Monday 8:04 AM'); assert.equal(st.qa.length, 1);
  assert.equal(await TC.timecardReply(env, CID, 'Closed Friday for a funeral', MON + 3600e3, { brain }), null, 'not a question: still a note for Max');
  assert.equal(await TC.timecardReply(env, CID, 'how many booked?', MON + 30 * 3600e3, { brain }), null, 'more than a day later: a note for Max');
});

test('an answer is kept under 40 words', () => {
  const long = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
  assert.ok(TC.clip40(long).split(' ').length <= 40);
  assert.ok(TC.isQuestion('which calls were urgent')); assert.ok(TC.isQuestion('Busy week?')); assert.ok(!TC.isQuestion('No jobs in Macon'));
});

test('every Monday send and skip is written down with the reason', async () => {
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, phone) VALUES ('b7-off', 'h-b7off', 'Off Line Co', 1, 'Growth', '4785550133')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, facts, updated) VALUES ('+14785550134', 'b7-off', 'Off Line Co', 0, 'plumbing', '{}', '2026-11-01')").run();
  const sent = [];
  const r = await TC.timecardCron(env, Date.parse('2026-11-16T13:30:00Z'), { send: async (cid, to, body) => { sent.push(cid); return { ok: true }; }, push: async () => {} });
  assert.ok(r.sent >= 1);
  const log = ((await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'timecard'").all()).results || []).map(x => JSON.parse(x.detail));
  assert.ok(log.some(x => x.cid === CID && x.what === 'sent'));
  assert.ok(log.some(x => x.cid === 'b7-off' && x.what === 'skipped' && /line is off/.test(x.why)));
  await TC.timecardCron(env, Date.parse('2026-11-16T13:40:00Z'), { send: async () => ({ ok: true }), push: async () => {} });
  const again = ((await DB.prepare("SELECT COUNT(*) AS n FROM voice_log WHERE kind = 'timecard'").all()).results)[0].n;
  assert.equal(again, log.length, 'written once a week, not every 10 minutes');
});

test('Compliance Guard shows the three checks: the website’s for regulated businesses, the real ones for everyone else', () => {
  const ok = guardChecks('Thank you for reaching out. Please contact our office directly.', { regulated: 1 }, 'reply');
  assert.deepEqual(ok.map(x => x.label), ['No claim details mentioned', 'No rates, discounts or promises', 'Approved wording only']);
  assert.ok(ok.every(x => x.ok));
  const bad = guardChecks('Your claim was denied, but we can get you lower rates.', { regulated: 1 }, 'reply');
  assert.equal(bad[0].ok, false); assert.equal(bad[1].ok, false);
  const plumber = guardChecks('Thanks, we are the #1 plumber in town!', { regulated: 0 }, 'reply');
  assert.equal(plumber[0].label, 'No promise of a ranking'); assert.equal(plumber[0].ok, false);
});

test('Rate-Shock Radar: insurance agencies only, a resting card on a calm week, the text and post on a wave', async () => {
  const R = await import('../src/radar.js');
  assert.equal(await R.radarState(env, { client_id: CID }), null, 'a plumber has no radar card');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, regulated) VALUES ('b7-ins', 'h-b7ins', 'B7 Insurance', 1, 'Growth', 1)").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, facts, updated) VALUES ('+14785550144', 'b7-ins', 'B7 Insurance', 1, 1, 'insurance', 'eatonton georgia', '{}', '2026-11-01')").run();
  let s = await R.radarState(env, { client_id: 'b7-ins' });
  assert.equal(s.town, 'Eatonton, GA'); assert.equal(s.wave, false); assert.equal(s.lastWeek, '');
  await R.noteSeen(env, 'b7-ins', '2026-W46', { town: 'Eatonton, GA', wave: false, rate: 0, low: 1 }, '2026-11-09T12:17:00Z');
  s = await R.radarState(env, { client_id: 'b7-ins' });
  assert.equal(s.lastWeek, '2026-W46'); assert.equal(s.wave, false);
  await R.noteSeen(env, 'b7-ins', '2026-W47', { town: 'Eatonton, GA', wave: true, rate: 4, low: 3, why: 'rate' }, '2026-11-16T12:17:00Z');
  await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, text, status, created) VALUES ('radar:b7-ins:2026-W47', 'b7-ins', 'post', 'What moves insurance rates', 'Rate-Shock Radar', 'Rates can change at renewal.', 'pending', '2026-11-16T12:17:00Z')").run();
  s = await R.radarState(env, { client_id: 'b7-ins' });
  assert.equal(s.wave, true); assert.match(s.text, /^Do this: call your renewals this week/); assert.equal(s.post.status, 'pending');
});

test('the real-text test sends the Always Open line’s own timecard to Christopher once, only when asked', async () => {
  const e2 = Object.assign({}, env, { OPS_TEXT_TO: '+14785550199' });
  await DB.prepare('CREATE TABLE IF NOT EXISTS drill_meta (k TEXT PRIMARY KEY, v TEXT)').run();
  const sent = [];
  const send = async (cid, to, body) => { sent.push([cid, to, body]); return { ok: true }; };
  assert.equal(await TC.timecardTest(e2, Date.parse('2026-11-06T14:00:00Z'), { send }), null, 'not asked for: nothing');
  await DB.prepare("INSERT OR REPLACE INTO drill_meta (k, v) VALUES ('timecard-test', 'requested')").run();
  const r = await TC.timecardTest(e2, Date.parse('2026-11-06T14:00:00Z'), { send });
  assert.deepEqual(r, { sent: true });
  assert.equal(sent[0][0], 'always-open'); assert.equal(sent[0][1], '+14785550199'); assert.match(sent[0][2], /^Max’s timecard, Oct 26–Nov 1\./);
  assert.equal(await TC.timecardTest(e2, Date.parse('2026-11-06T14:10:00Z'), { send }), null, 'once');
  assert.equal(sent.length, 1);
});
