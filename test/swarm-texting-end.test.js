// Nov 25, 2026: carriers bill every approved texting campaign each month ($2 to $10) until it is deleted, and nothing
// deleted them, so every client who left kept costing that for good. 60 days after a plan ends the client's campaign is
// deleted and texting is marked ended; the brand and Messaging Service stay (no monthly fee). A client who comes back
// restarts at the campaign step by itself, with no new form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const P = await import('../src/provision.js');
const A = await import('../src/a2p.js');
const S = await import('../src/sms.js');

const DAY = 864e5, LINE = '+14785550100';
const MG = 'MG' + '1'.repeat(32), BN = 'BN' + '2'.repeat(32), QE = 'QE' + '3'.repeat(32), QE2 = 'QE' + '4'.repeat(32);
const sha = s => createHash('sha256').update(s).digest('hex');

async function setup(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  // Twilio's texting-registration API, as far as these tests need it
  const tw = { campaigns: o.campaigns || [QE], refuse: 0, deleted: [], made: [] };
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input.url || String(input)), u = new URL(url), method = (init && init.method) || 'GET';
    if (u.hostname !== 'messaging.twilio.com') return inner(input, init);
    const p = u.pathname.replace('/v1/', '');
    const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && p === 'Services/' + MG + '/Compliance/Usa2p') return json({ compliance: tw.campaigns.map(sid => ({ sid, campaign_status: 'VERIFIED' })) });
    if (method === 'DELETE' && p.startsWith('Services/' + MG + '/Compliance/Usa2p/')) {
      if (tw.refuse > 0) { tw.refuse--; return json({ message: 'try later' }, 503); }
      const sid = p.split('/').pop(); tw.deleted.push(sid); tw.campaigns = tw.campaigns.filter(x => x !== sid); return new Response(null, { status: 204 });
    }
    if (method === 'GET' && p.startsWith('Services/' + MG + '/Compliance/Usa2p/Usecases')) return json({ us_app_to_person_usecases: [{ code: 'LOW_VOLUME' }] });
    if (method === 'POST' && p === 'Services/' + MG + '/Compliance/Usa2p') { tw.made.push(new URLSearchParams(String(init.body))); tw.campaigns.push(QE2); return json({ sid: QE2 }); }
    return json({ message: 'not faked' }, 404);
  };
  await P.provisionCron(env, Date.now());   // makes the provision table
  await A.ensureA2p(env);
  const ended = new Date(Date.now() - (o.endedDaysAgo || 0) * DAY).toISOString();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, ref, active, tier) VALUES ('c1', ?1, 'Sinclair Plumbing', 'sinclair', 0, 'Pro')").bind(sha('x')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES (?1, 'c1', 'Sinclair Plumbing', 0, 'plumbing', 'Eatonton, GA', '2026-10-01')").bind(LINE).run();
  await DB.prepare("INSERT INTO provision (client_id, status, number, number_sid, created, updated, ended) VALUES ('c1', 'live', ?1, ?2, ?3, ?3, ?3)").bind(LINE, 'PN' + 'a'.repeat(32), ended).run();
  if (o.texting !== false) {
    const sids = o.sids || { profile: 'BU' + '5'.repeat(32), trust: 'BU' + '6'.repeat(32), brand: BN, mg: MG, campaign: QE };
    await DB.prepare("INSERT INTO a2p_reg (client_id, status, step, form, sids, created, updated) VALUES ('c1', 'approved', 'done', ?1, ?2, ?3, ?3)").bind(JSON.stringify({ legal: 'Sinclair Plumbing LLC', ein: '' }), JSON.stringify(sids), ended).run();
    await S.setBrand(env, 'c1', MG, 'approved');
  }
  const reg = () => DB.prepare("SELECT status, step, sids FROM a2p_reg WHERE client_id = 'c1'").first();
  const brand = () => DB.prepare("SELECT status FROM sms_brands WHERE client_id = 'c1'").first();
  const prov = () => DB.prepare("SELECT texting_off, ended FROM provision WHERE client_id = 'c1'").first();
  const t0 = Date.parse(ended);
  return { world, DB, env, tw, reg, brand, prov, t0, restore: () => { globalThis.fetch = inner; } };
}

test('gone 60 days: the campaign is deleted at Twilio, texting is marked ended, Christopher is told; not before, and only once', async () => {
  const w = await setup();
  try {
    await P.provisionCron(w.env, w.t0 + 59 * DAY);
    assert.deepEqual(w.tw.deleted, [], 'kept inside the come-back window');
    await P.provisionCron(w.env, w.t0 + 60 * DAY + 60e3);
    assert.deepEqual(w.tw.deleted, [QE]);
    const r = await w.reg(), sids = JSON.parse(r.sids);
    assert.equal(r.status, 'ended');
    assert.equal(sids.campaign, undefined);
    assert.equal(sids.brand, BN, 'the brand stays: no monthly fee, and a returning client builds on it');
    assert.equal(sids.mg, MG);
    assert.equal((await w.brand()).status, 'ended', 'texting is off');
    assert.ok((await w.prov()).texting_off);
    assert.ok(w.world.pushes.some(p => /texting registration cancelled/.test(p.title)));
    assert.deepEqual((await A.textingState(w.env, { client_id: 'c1' })).label, 'Stopped when your plan ended');
    await P.provisionCron(w.env, w.t0 + 61 * DAY);
    assert.deepEqual(w.tw.deleted, [QE], 'once');
  } finally { w.restore(); }
});

test('a campaign whose sid we never stored is found on the client\'s service and deleted too', async () => {
  const w = await setup({ sids: { brand: BN, mg: MG, campaign: 'created' } });
  try {
    await P.provisionCron(w.env, w.t0 + 60 * DAY + 60e3);
    assert.deepEqual(w.tw.deleted, [QE]);
  } finally { w.restore(); }
});

test('Twilio refuses the delete: it is tried again on the next run, and only marked done once it goes', async () => {
  const w = await setup();
  try {
    w.tw.refuse = 1;
    await P.provisionCron(w.env, w.t0 + 60 * DAY + 60e3);
    assert.deepEqual(w.tw.deleted, []);
    assert.equal((await w.prov()).texting_off, '');
    assert.equal((await w.reg()).status, 'approved');
    await P.provisionCron(w.env, w.t0 + 60 * DAY + 11 * 60e3);
    assert.deepEqual(w.tw.deleted, [QE]);
    assert.ok((await w.prov()).texting_off);
  } finally { w.restore(); }
});

test('a client who never set up texting: nothing is sent to Twilio, and it is marked done', async () => {
  const w = await setup({ texting: false });
  try {
    await P.provisionCron(w.env, w.t0 + 60 * DAY + 60e3);
    assert.deepEqual(w.tw.deleted, []);
    assert.ok((await w.prov()).texting_off);
    assert.ok(!w.world.pushes.some(p => /texting registration cancelled/.test(p.title)), 'nothing to tell');
  } finally { w.restore(); }
});

test('a client who comes back after that: texting restarts at the campaign step by itself, on the brand they have', async () => {
  const w = await setup({ endedDaysAgo: 90 });
  try {
    await P.provisionCron(w.env, Date.now());
    assert.equal((await w.reg()).status, 'ended');
    await w.DB.prepare("UPDATE app_clients SET active = 1 WHERE client_id = 'c1'").run();
    await P.provisionCron(w.env, Date.now());
    const r = await w.reg();
    assert.equal(r.status, 'submitted'); assert.equal(r.step, 'campaign');
    assert.equal((await w.prov()).texting_off, '');
    assert.ok(w.world.pushes.some(p => /a client came back/.test(p.title) && /restarts by itself/.test(p.body || p.message || JSON.stringify(p))));
    assert.equal(await A.advance(w.env, 'c1'), 'in_review', 'a new campaign is filed under the same brand');
    assert.equal(w.tw.made.length, 1);
    assert.equal(w.tw.made[0].get('BrandRegistrationSid'), BN);
  } finally { w.restore(); }
});

test('a client who comes back with no brand on file fills the texting form again', async () => {
  const w = await setup({ endedDaysAgo: 90, sids: { mg: MG } });
  try {
    await P.provisionCron(w.env, Date.now());
    await w.DB.prepare("UPDATE app_clients SET active = 1 WHERE client_id = 'c1'").run();
    await P.provisionCron(w.env, Date.now());
    assert.equal((await w.reg()).status, 'none');
  } finally { w.restore(); }
});
