// No 3 AM surprises: from 10 PM to 7 AM Eastern, problems arrive silently and wait in the 7 AM push; only callers
// reaching nobody is loud. The same problem repeats at most every 3 hours, and the outside monitor only goes red for
// what hurts callers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const P = await import('../src/push.js');
const O = await import('../src/ops.js');
const M = await import('../src/morning.js');

const DAY = Date.parse('2026-10-29T15:00:00Z');     // 11 AM Eastern
const NIGHT = Date.parse('2026-10-30T07:00:00Z');   // 3 AM Eastern
const ntfy = log => async (url, init) => { log.push({ title: init.headers.Title, priority: init.headers.Priority }); return new Response('ok'); };

test('night is 10 PM to 7 AM Eastern', () => {
  assert.equal(P.isNight(DAY), false);
  assert.equal(P.isNight(NIGHT), true);
  assert.equal(P.isNight(Date.parse('2026-10-30T01:59:00Z')), false, '9:59 PM');
  assert.equal(P.isNight(Date.parse('2026-10-30T02:00:00Z')), true, '10 PM');
  assert.equal(P.isNight(Date.parse('2026-10-30T11:00:00Z')), false, '7 AM');
});

test('at night a push arrives silently unless it is marked loud; by day nothing changes', async () => {
  const env = { DB: H.makeDB(), NTFY_URL: 'https://ntfy.example.test/t' }, log = [];
  await P.push(env, { title: 'Problem', priority: 'high' }, { fetch: ntfy(log), now: NIGHT });
  await P.push(env, { title: 'Callers reach nobody', priority: 'high', loud: true }, { fetch: ntfy(log), now: NIGHT });
  await P.push(env, { title: 'Problem', priority: 'high' }, { fetch: ntfy(log), now: DAY });
  assert.deepEqual(log.map(x => x.priority), ['low', 'high', 'high']);
});

test('problem alerts: silent and listed for the morning at night, loud only when callers reach nobody, repeats every 3 hours at most', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const real = Date.now;
  try {
    Date.now = () => NIGHT;
    assert.equal(await O.opsAlert(env, 'health:backup', '', 'the last backup was 9 days ago'), 'sent');
    assert.equal(await O.opsAlert(env, 'crash:/app/*', '', 'TypeError'), 'sent');
    assert.equal(await O.opsAlert(env, 'health:twilio-numbers', '', 'Max is not reachable the usual way on: Quillen Plumbing (webhook points elsewhere)'), 'sent');
    assert.deepEqual(world.pushes.map(p => p.priority), ['low', 'low', 'high'], 'only callers-reach-nobody makes a sound at 3 AM');
    assert.equal(world.mail.length, 3, 'every one still goes by email');
    Date.now = () => NIGHT + 40 * 60e3;
    assert.equal(await O.opsAlert(env, 'health:backup', '', 'the last backup was 9 days ago'), 'limited', 'not again 40 minutes later');
    Date.now = () => NIGHT + 3 * 3600e3 + 60e3;
    assert.equal(await O.opsAlert(env, 'health:backup', '', 'the last backup was 9 days ago'), 'sent', 'again after 3 hours, with the count');
    assert.match(world.pushes[3].body, /\(1 more since the last alert\)/);
    const night = await M.nightList(env);
    assert.deepEqual(night.map(r => [r.type, r.n]), [['health:backup', 2], ['crash:/app/*', 1]], 'the loud one is not repeated in the morning list');
    assert.deepEqual(await M.nightList(env), [], 'cleared once read');
    const t = M.morningText({ ok: true, checks: [] }, { calls: 3, leads: 1, booked: 1, errors: 0, drafts: 2 }, night);
    assert.match(t.body, /Overnight, quietly: health:backup \(2\), crash:\/app\/\*\. They are in your email\.$/);
    assert.doesNotMatch(M.morningText({ ok: true, checks: [] }, { calls: 0, leads: 0, booked: 0, errors: 0, drafts: 0 }, []).body, /Overnight/);
  } finally { Date.now = real; }
});

test('the outside monitor sees the site, the database, the jobs and the phone lines; not a late backup', async () => {
  const DB = H.makeDB();
  const env = { DB, STRIPE_KEY: '', EMAIL: {}, MAIL_FROM: 'a@b.c', MAIL_TO: 'd@e.f', TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'y', CALLROOM: {}, VOICE_KEY: 'k', AI: {} };
  await DB.prepare('CREATE TABLE IF NOT EXISTS health_slow (name TEXT PRIMARY KEY, at TEXT, ok INTEGER, why TEXT)').run();
  const at = new Date().toISOString();
  await DB.prepare("INSERT INTO health_slow (name, at, ok, why) VALUES ('backup', ?1, 0, 'late'), ('google-connections', ?1, 0, 'one owner'), ('twilio-numbers', ?1, 1, '')").bind(at).run();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}');
  try {
    const names = h => h.checks.filter(c => !c.ok).map(c => c.name).sort();
    assert.deepEqual(names(await O.healthStatus(env, Date.now(), 'monitor')), ['stripe'], 'the Stripe key is missing in this test; the backup and one owner’s Google are not the monitor’s business');
    assert.deepEqual(names(await O.healthStatus(env, Date.now())), ['backup', 'google-connections', 'stripe'], 'the ops board and the 7 AM push still see everything');
    await DB.prepare("UPDATE health_slow SET ok = 0, why = 'webhook points elsewhere' WHERE name = 'twilio-numbers'").run();
    assert.ok(names(await O.healthStatus(env, Date.now(), 'monitor')).includes('twilio-numbers'), 'a number that no longer reaches us does turn the monitor red');
  } finally { globalThis.fetch = real; }
});
