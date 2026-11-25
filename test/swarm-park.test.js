// Nov 25, 2026: Max's number stays ours and is kept a year after a plan ends (it was released after 60 days), so no one
// else gets it and a returning owner gets the same number back. Callers hear the neutral line for the first 60 days,
// then the carrier's not-in-service message (<Reject>: not billed, and no longer speaking for a business that has left).
// An owner who comes back is on the air again on their old number by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const B = await import('../src/billing.js');
const P = await import('../src/provision.js');
const V = await import('../src/voice.js');

const DAY = 864e5, LINE = '+14785550100', PN = 'PN' + 'a'.repeat(32), sha = s => createHash('sha256').update(s).digest('hex');
async function setup(endedDaysAgo) {
  const world = new H.World(), DB = H.makeDB(), mails = [];
  const env = H.makeEnv(world, DB, { SEND_MAIL: { send: async m => { mails.push(m); } } });
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await B.ensureBilling(env);
  await P.provisionCron(env, Date.now());   // makes the provision table
  const ended = new Date(Date.now() - endedDaysAgo * DAY).toISOString();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', ?1, 'Sinclair Plumbing', 0, 'Pro')").bind(sha('x')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES (?1, 'c1', 'Sinclair Plumbing', 0, 'plumbing', 'Eatonton, GA', '2026-10-01')").bind(LINE).run();
  await DB.prepare("INSERT INTO provision (client_id, status, number, number_sid, created, updated, ended) VALUES ('c1', 'live', ?1, ?2, ?3, ?3, ?3)").bind(LINE, PN, ended).run();
  await DB.prepare("INSERT INTO billing (client_id, plan, status, business, email, created) VALUES ('c1', 'Pro', 'canceled', 'Sinclair Plumbing', 'dana@sinclair.example', ?1)").bind(ended).run();
  const site = H.makeClient(worker, env);
  const call = sid => {
    const params = { CallSid: sid, To: LINE, From: '+14785550142' }, href = 'https://alwaysopenoffice.com/voice/in/' + env.VOICE_KEY;
    return site.call('/voice/in/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const released = () => world.calls.filter(c => c.method === 'DELETE' && /IncomingPhoneNumbers\/PN/.test(c.url)).length;
  const row = () => DB.prepare("SELECT p.status, p.ended, v.on_air FROM provision p LEFT JOIN voice_lines v ON v.client_id = p.client_id WHERE p.client_id = 'c1'").first();
  return { world, DB, env, mails, site, call, released, row, t0: Date.parse(ended) };
}

test('kept a year: not released at 60 days or 300, a week\'s notice with the year in the date, released at 365', async () => {
  const w = await setup(0);
  for (const d of [61, 300]) { await P.provisionCron(w.env, w.t0 + d * DAY); assert.equal(w.released(), 0, 'kept at day ' + d); }
  assert.equal(w.mails.length, 0, 'no notice yet');
  await P.provisionCron(w.env, w.t0 + 358 * DAY + 60e3);
  assert.equal(w.mails.length, 1, 'the week-before notice');
  const year = new Date(w.t0 + 365 * DAY).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const raw = JSON.stringify(w.mails[0]);
  assert.ok(raw.includes(year), 'the date carries its year: ' + year);
  assert.ok(w.world.pushes.some(p => /a Max number is released in a week/.test(p.title)), 'Christopher is told too');
  await P.provisionCron(w.env, w.t0 + 359 * DAY);
  assert.equal(w.mails.length, 1, 'told once');
  await P.provisionCron(w.env, w.t0 + 365 * DAY + 60e3);
  assert.equal(w.released(), 1, 'released after a year');
  assert.equal((await w.row()).status, 'released');
});

test('a caller to a parked number hears the neutral line for 60 days, then the carrier\'s not-in-service message', async () => {
  const w = await setup(10);
  const early = await w.call('CA' + '1'.repeat(32));
  assert.match(early.text, /Thanks for calling Sinclair Plumbing\. Nobody can take your call right now/);
  await w.DB.prepare("UPDATE provision SET ended = ?1 WHERE client_id = 'c1'").bind(new Date(Date.now() - 61 * DAY).toISOString()).run();
  const late = await w.call('CA' + '2'.repeat(32));
  assert.match(late.text, /^<\?xml[^>]*>\s*<Response><Reject reason="rejected"\/><\/Response>$/);
  assert.doesNotMatch(late.text, /Sinclair/);
});

test('an owner who comes back within the year gets the same number, on the air again by itself', async () => {
  const w = await setup(200);
  await w.DB.prepare("UPDATE app_clients SET active = 1 WHERE client_id = 'c1'").run();
  await P.provisionCron(w.env, Date.now());
  const r = await w.row();
  assert.equal(r.ended, ''); assert.equal(r.on_air, 1); assert.equal(r.status, 'live');
  assert.equal(w.released(), 0);
  assert.ok(w.world.pushes.some(p => /a client came back/.test(p.title)));
  const back = await w.call('CA' + '3'.repeat(32));
  assert.match(back.text, /<ConversationRelay/, 'Max answers again');
});

test('the terms say so', () => {
  const t = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
  assert.match(t, /We keep the number for a year, so no one else gets it and you get the same number back if you return, and then release it\. We do not transfer the number to you\./);
  assert.doesNotMatch(t, /60 days in case you come back/);
});
