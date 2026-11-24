// Fixes from the Nov 24, 2026 intruder audit: one IPv6 /64 is one sender everywhere (S1), a per-business hourly cap on
// online bookings, and the Hear Max recording callback checks Twilio's signature and only fetches from Twilio (S2).
// (S3, tying the Google Calendar connect link to one browser, was skipped on purpose: see the report.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const O = await import('../src/outreach.js');
const HM = await import('../src/hearmax.js');

const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = 'O'.repeat(30);
const v6 = i => '2001:db8:1:2::' + (i + 2).toString(16);   // same /64, a new address each time

async function setup() {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const q = (sql, ...a) => DB.prepare(sql).bind(...a).run();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('c1', ?1, 'sinclair', 'Sinclair Plumbing', 'Pro', 'Dana', 1)", sha(OWNER));
  await q("INSERT INTO voice_lines (number, client_id, business, on_air, updated) VALUES ('+14785550100', 'c1', 'Sinclair Plumbing', 1, '2026-10-01')");
  return { world, DB, env, q, all, site: H.makeClient(worker, env) };
}

test('senderKey: IPv4 unchanged, every address in one IPv6 /64 is one sender', async () => {
  const { senderKey } = await import('../src/sender.js');
  assert.equal(senderKey('198.51.100.7'), '198.51.100.7');
  assert.equal(senderKey(''), '');
  assert.equal(senderKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(senderKey('2001:DB8:1:2:ffff:aaaa:1:9'), '2001:db8:1:2::/64');
  assert.equal(senderKey('2001:0db8:0001:0002:0:0:0:5'), '2001:db8:1:2::/64');
  assert.notEqual(senderKey('2001:db8:1:3::1'), senderKey('2001:db8:1:2::1'));
  assert.equal(senderKey('::ffff:198.51.100.7'), '198.51.100.7');
});

test('/q/: a new address in the same /64 each time stops at the same limit one address gets', async () => {
  const { env, all, site } = await setup();
  let ok = 0;
  for (let i = 0; i < 12; i++) {
    const r = await site.call('/q/sinclair', { form: { name: 'Sender ' + i, phone: '478555' + String(1000 + i), need: 'junk request ' + i, t: String(Date.now() - 5000) }, ip: v6(i) });
    if (/Request sent/i.test(r.text)) ok++;
  }
  assert.equal(ok, 5);
  assert.equal((await all('SELECT COUNT(*) AS n FROM app_leads'))[0].n, 5);
});

test('the /app/<code> wrong-code lockout counts a whole /64 as one', async () => {
  const { all, site } = await setup();
  let locked = 0;
  for (let i = 0; i < 40; i++) { const r = await site.call('/app/' + 'x'.repeat(30), { ip: v6(i) }); if (r.status === 429) locked++; }
  assert.ok(locked > 0, 'a rotating /64 is locked out like one address');
  void all;
});

test('/b/: a rotating /64 is limited, and a business has a cap of 5 online bookings an hour from anyone', async () => {
  const { world, env, q, all, site } = await setup();
  await q("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES ('c1', 'r', 'America/New_York', 'x')");
  const harness = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/oauth2\.googleapis\.com\/token/.test(url)) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
    if (/googleapis\.com\/calendar\/v3/.test(url)) return new Response(JSON.stringify(init && init.method === 'POST' ? { id: 'ev1' } : { items: [], timeZone: 'America/New_York' }), { headers: { 'content-type': 'application/json' } });
    return harness(input, init);
  };
  try {
    const slots = [...(await site.call('/b/sinclair')).text.matchAll(/name="slot" value="(\d+)"/g)].map(m => m[1]);
    assert.ok(slots.length >= 8, 'slots ' + slots.length + 'the page offers times');
    const book = (i, ip) => site.call('/b/sinclair', { form: { name: 'Person ' + i, phone: '478555' + String(2000 + i), slot: slots[i], t: '0', website: '' }, ip });
    // one /64, a new address each time: five get in, the sixth is told they already booked
    const said = [];
    for (let i = 0; i < 6; i++) said.push((await book(i, v6(i))).text);
    assert.match(said[5], /already have your booking/);
    assert.equal(said.slice(0, 5).filter(t => /already have your booking/.test(t)).length, 0);
    assert.equal((await all("SELECT COUNT(*) AS n FROM app_leads WHERE need LIKE 'Booked %'"))[0].n, 5);
    // strangers from different networks: the business still stops at 5 an hour
    await q('DELETE FROM app_leads'); await q('DELETE FROM line_bookings');
    for (let i = 0; i < 8; i++) await book(i, '198.51.100.' + (i + 10));
    await site.settle();
    assert.equal((await all("SELECT COUNT(*) AS n FROM line_bookings WHERE status = 'booked'"))[0].n, 5);
    const pushesBefore = world.calls.filter(c => /push\.apple\.com/.test(c.url)).length;
    const r = await book(7, '198.51.100.99');
    assert.match(r.text, /Please call us to book/);
    assert.equal(world.calls.filter(c => /push\.apple\.com/.test(c.url)).length, pushesBefore, 'the owner is not pushed again');
    assert.doesNotMatch(r.text, /\bAI\b/);
  } finally { globalThis.fetch = harness; }
  void env;
});

test('/stop-calls and /audit/score count a whole /64 as one sender', async () => {
  const { env, DB, site } = await setup();
  await O.ensureOutreach(env);
  const form = o => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return f; };
  let blocked = 0;
  for (let i = 0; i < 25; i++) {
    const r = await O.stopPage(env, new Request('https://x/stop-calls', { method: 'POST', body: form({ phone: '478-555-' + String(1000 + i) }), headers: { 'cf-connecting-ip': v6(i) } }), new URL('https://x/stop-calls'));
    if (r.status === 429) blocked++;
  }
  assert.equal(blocked, 5, 'the 21st to 25th wait a day');
  // the audit checker: three an hour per sender; rows written for the /64 stop a new address in it
  const { senderKey } = await import('../src/sender.js');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(senderKey(v6(0)) + '|' + (env.IP_SALT || 'salt')));
  const h = [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  await DB.prepare('CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, q TEXT, town TEXT, kind TEXT, ip_hash TEXT, score INTEGER, data TEXT)').run();
  for (let i = 0; i < 3; i++) await DB.prepare("INSERT INTO audits (at, q, town, kind, ip_hash) VALUES (?1, 'x', 'y', 'score', ?2)").bind(new Date().toISOString(), h).run();
  const r = await site.call('/audit/score', { body: JSON.stringify({ q: 'Some Plumbing', town: 'Macon' }), ip: v6(77), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 429);
});

test('/voice/recorded/: needs Twilio’s signature, and only ever fetches from Twilio', async () => {
  const { world, env, DB, site } = await setup();
  await HM.arm(env, '478-555-0177', 'en').catch(() => {});
  await DB.prepare("UPDATE hear_max_arm SET status = 'calling', call_sid = 'CAarmed' WHERE k = 'arm'").run().catch(() => {});
  const params = { CallSid: 'CAarmed', RecordingSid: 'RE' + '1'.repeat(32), RecordingUrl: 'https://attacker.example/grab', RecordingDuration: '30', RecordingStatus: 'completed' };
  const path = '/voice/recorded/' + env.VOICE_KEY;
  const before = world.calls.length;
  const unsigned = await site.call(path, { form: params });
  await site.settle();
  assert.equal(unsigned.status, 403);
  const bad = await site.call(path, { form: params, headers: { 'x-twilio-signature': 'AAAA' } });
  assert.equal(bad.status, 403);
  assert.equal(world.calls.slice(before).filter(c => /attacker/.test(c.url)).length, 0, 'nothing left for the attacker address');
  // a signed callback is accepted
  const signed = await site.call(path, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, 'https://alwaysopenoffice.com' + path, params) } });
  assert.equal(signed.status, 200);
  // and even a signed one cannot name a foreign address
  const seen = [];
  const fd = new FormData(); for (const k in params) fd.set(k, params[k]);
  const out = await HM.recordedHook(env, fd, { fetch: async u => { seen.push(u); return new Response('x', { status: 404 }); } });
  assert.deepEqual(seen, []);
  assert.equal(out.ok, false);
  const fd2 = new FormData(); for (const k in params) fd2.set(k, params[k]); fd2.set('RecordingUrl', 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1');
  await HM.recordedHook(env, fd2, { fetch: async u => { seen.push(u); return new Response('x', { status: 404 }); } });
  assert.match(seen[0], /^https:\/\/api\.twilio\.com\//);
});
