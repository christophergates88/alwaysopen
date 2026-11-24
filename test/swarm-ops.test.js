// Nov 24, 2026 "no 3 AM surprises" fixes: hung jobs, the 7 AM title, Twilio 401, backup gaps, send-mail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const keep = setInterval(() => {}, 1000);   // the harness unrefs timers; the timeout test needs the process up
after(() => clearInterval(keep));
const ops = await import('../src/ops.js');
const { watched, noteRun, healthStatus } = ops;

const envFor = (db, extra) => Object.assign({ DB: db, STRIPE_KEY: '', EMAIL: {}, MAIL_FROM: 'a@b.c', MAIL_TO: 'd@e.f', TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'y', CALLROOM: {}, VOICE_KEY: 'k', AI: {}, SEND_MAIL: {} }, extra || {});
const ago = ms => new Date(Date.now() - ms).toISOString();

test('E1: a job that never settles is recorded as failed with "timed out" and alerts', async () => {
  const db = makeDB(), env = envFor(db);
  await noteRun(env, 'minutes', true, 5, '');
  await watched(env, 'minutes', new Promise(() => {}), 40);
  const row = db.raw.prepare("SELECT ok, note FROM cron_runs WHERE name = 'minutes'").get();
  assert.equal(row.ok, 0); assert.match(row.note, /timed out/);
  assert.ok(db.raw.prepare("SELECT type FROM ops_alerts WHERE type = 'cron:minutes'").get(), 'the usual cron alert was raised');
});

test('E1: the jobs check is in full health only, and names failed or stalled jobs', async () => {
  const db = makeDB(), env = envFor(db);
  await noteRun(env, 'tick', true, 0, ''); await noteRun(env, 'storm', true, 1, ''); await noteRun(env, 'minutes', true, 1, '');
  for (const n of ['silence', 'rivals', 'maxweek', 'radar', 'board']) await noteRun(env, n, true, 1, '');
  const set = (n, ms) => db.raw.prepare('UPDATE cron_runs SET at = ? WHERE name = ?').run(ago(ms), n);
  for (const n of ['silence', 'rivals', 'maxweek', 'radar', 'board']) set(n, 6 * 864e5);   // weekly: fine
  let h = await healthStatus(env, Date.now(), false);
  assert.equal(h.checks.find(c => c.name === 'jobs').ok, true);
  set('minutes', 2 * 864e5);                                   // stopped being stamped while the others are fresh
  await noteRun(env, 'map', false, 1, 'Google answered 500');   // failed last run
  set('radar', 10 * 864e5);                                    // weekly job missed its Sunday
  h = await healthStatus(env, Date.now(), false);
  const j = h.checks.find(c => c.name === 'jobs');
  assert.equal(j.ok, false);
  for (const n of ['minutes', 'map', 'radar']) assert.match(j.why, new RegExp(n));
  assert.doesNotMatch(j.why, /storm|silence/);
  for (const mode of [true, 'monitor']) assert.ok(!(await healthStatus(env, Date.now(), mode)).checks.some(c => c.name === 'jobs'), 'not in mode ' + mode);
  assert.equal((await healthStatus(env, Date.now(), 'monitor')).ok, true, 'the outside monitor is not paged by it');
});

test('E2: the 7 AM title says all good only when everything is, and names the first thing wrong otherwise', async () => {
  const { morningText, morningEmail, morningCron } = await import('../src/morning.js');
  const c = { calls: 14, leads: 3, booked: 1, drafts: 0, errors: 0 }, ok = { ok: true, checks: [{ name: 'd1', ok: true }, { name: 'jobs', ok: true }] };
  assert.equal(morningText(ok, c, [], 'The 4 AM test call passed.').title, 'Always Open: all good');
  const t = morningText(ok, c, [], 'The 4 AM test call failed: Max never answered.');
  assert.notEqual(t.title, 'Always Open: all good'); assert.match(t.title, /test call/i); assert.equal(t.urgent, true);
  assert.match(morningText(ok, c, [], '', { backup: true }).title, /backup model/);
  const j = morningText({ ok: false, checks: [{ name: 'jobs', ok: false, why: 'minutes (last ran 2 days ago)' }] }, c, [], '');
  assert.match(j.title, /background job/);
  assert.equal(morningEmail(ok, c, [], 'The 4 AM test call failed: x.').sign, '1 THING');
  assert.equal(morningEmail(ok, c, [], '', { backup: true }).tone, 'bad');
  // through the cron: backup-until in the future => high priority, not "all good"
  const db = makeDB(), env = { DB: db };
  await db.prepare('CREATE TABLE IF NOT EXISTS drill_meta (k TEXT PRIMARY KEY, v TEXT)').run();
  const seven = Date.parse('2026-10-29T11:20:00Z');
  await db.prepare("INSERT INTO drill_meta (k, v) VALUES ('backup-until', ?1)").bind(new Date(seven + 3600e3).toISOString()).run();
  const pings = [];
  await morningCron(env, seven, { health: async () => ok, ping: async (t, b, pr) => pings.push([t, pr]), mail: async () => {} });
  assert.deepEqual(pings, [['Always Open: Max is answering on his backup model', 'high']]);
});

test('E3: Twilio refusing the key (401/403) is a failed number check, loud at night; a timeout or 500 stays unknown', async () => {
  const run = async status => {
    const db = makeDB(), env = envFor(db, { NTFY_URL: 'https://ntfy.example.test/x' });
    db.raw.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry) VALUES ('+17064441000','cl0','Biz',1,'plumber')").run();
    const f = async u => String(u).includes('twilio.com') ? new Response('{"code":20003}', { status }) : new Response('{}', { status: 200 });
    return (await ops.slowChecks(env, { fetch: f, apnsJwt: async () => 'x', now: Date.now() })).find(c => c.name === 'twilio-numbers');
  };
  for (const st of [401, 403]) { const r = await run(st); assert.equal(r.ok, false, String(st)); assert.match(r.why, /Twilio refused our key.*token on the Worker/); }
  const five = await run(503); assert.equal(five.ok, true); assert.match(five.why, /did not answer/);
  assert.ok(ops.explainAlert('health:twilio-numbers', '').urgent);
});

test('E6: send-mail is a full-health check, red when the SEND_MAIL binding is missing, and absent from plain and core health', async () => {
  const find = (h, n) => h.checks.find(c => c.name === n);
  assert.equal(find(await healthStatus(envFor(makeDB()), Date.now(), false), 'send-mail').ok, true);
  const bare = envFor(makeDB(), { SEND_MAIL: undefined });
  const full = await healthStatus(bare, Date.now(), false);
  assert.equal(find(full, 'send-mail').ok, false); assert.equal(full.ok, false);
  for (const mode of [true, 'monitor']) assert.ok(!find(await healthStatus(bare, Date.now(), mode), 'send-mail'));
});

test('E4: a table that cannot be read is named, alerted and turns the backup check red; a table not made yet is not a failure', async () => {
  const B = await import('../src/backup.js');
  const db = makeDB();
  db.raw.prepare("INSERT INTO leads (at, name, email, status) VALUES ('2026-10-01', 'Dana', 'd@e.f', 'new')").run();
  const real = db.prepare.bind(db);
  const broken = { prepare: sql => { if (/^SELECT \* FROM leads\b/.test(sql)) throw new Error('D1_ERROR: database disk image is malformed'); if (/^SELECT \* FROM app_staff\b/.test(sql)) throw new Error('D1_ERROR: no such table: app_staff: SQLITE_ERROR'); return real(sql); }, batch: (...a) => db.batch(...a), raw: db.raw };
  const env = envFor(broken, { NTFY_URL: 'https://ntfy.example.test/x' });
  const d = await B.dump(env);
  assert.deepEqual(d.failed, ['leads'], 'only the table that errored, not the one that does not exist');
  const sent = [];
  const r = await B.runBackup(env, Date.parse('2026-11-01T08:30:00Z'), { send: async raw => sent.push(raw) });
  assert.equal(sent.length, 1, 'the backup still goes out');
  assert.deepEqual(r.failed, ['leads']);
  assert.match(db.raw.prepare("SELECT failed FROM backup_runs").get().failed, /leads/);
  assert.ok(db.raw.prepare("SELECT type FROM ops_alerts WHERE type = 'backup'").get(), 'alerted through opsAlert backup');
  const slow = (await ops.slowChecks(envFor(db), { fetch: async () => new Response('{}'), apnsJwt: async () => 'x', now: Date.now() })).find(c => c.name === 'backup');
  assert.equal(slow.ok, false); assert.match(slow.why, /leads/);
  for (const t of ['outcalls', 'outcall_prefs', 'answer_prefs', 'app_jobs', 'max_timecards', 'fullmax', 'social_posts', 'mail_queue', 'provision', 'rival_list', 'rival_profile']) assert.ok(B.TABLES.includes(t), t);
  for (const t of ['billing_config', 'voice_log', 'sms_log', 'app_photos', 'line_audio', 'hear_max']) assert.ok(!B.TABLES.includes(t), t);
  assert.deepEqual(B.SECRET_COLUMNS.mail_queue, ['token']);
});

test('E4: no backup row at all is red once the oldest job row is more than 8 days old, and not before', async () => {
  const check = async oldMs => {
    const db = makeDB(), env = envFor(db);
    await noteRun(env, 'tick', true, 0, '');
    db.raw.prepare('UPDATE cron_runs SET at = ?').run(ago(oldMs));
    return (await ops.slowChecks(env, { fetch: async () => new Response('{}'), apnsJwt: async () => 'x', now: Date.now() })).find(c => c.name === 'backup');
  };
  assert.equal(await check(2 * 864e5), undefined, 'a young system with no backup yet is fine');
  const old = await check(9 * 864e5);
  assert.equal(old.ok, false); assert.match(old.why, /no backup has ever run/);
});
