// Shared set-up for the "texter" stress tests: every text the system sends or receives. Not a test itself.
// It boots the real worker on the rehearsal harness (test/rehearsal/harness.js: fake D1 on node:sqlite, fake Twilio,
// Stripe, AI) and adds businesses straight into the database, the way the live rows look once a client is set up:
// app_clients (the owner's cell in `phone`), voice_lines (the business's own number, on air) and, when its texting
// registration is approved, sms_brands (status 'approved' with its own Messaging Service SID).
// Nothing here changes how the harness behaves, and nothing touches the internet.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('../../test/rehearsal/hooks.mjs', import.meta.url);   // must come before importing src
export const H = await import('../../test/rehearsal/harness.js');
export const { default: worker } = await import('../../src/index.js');
export const { CallRoom } = await import('../../src/voice.js');
export const SMS = await import('../../src/sms.js');

// A clock the tests can set: Date.now() and `new Date()` agree, so "now" is one moment everywhere in the worker.
const RealDate = Date;
export const clock = {
  set(ms) {
    const at = typeof ms === 'number' ? ms : RealDate.parse(ms);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(at); } static now() { return at; } }
    globalThis.Date = FakeDate;
  },
  restore() { globalThis.Date = RealDate; }
};

let nClient = 0, nSid = 0;
export function boot(extra) {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, Object.assign({ OPS_TEXT_TO: '+14783652533' }, extra || {}));
  // sms.js and fillweek.js make some tables once per process (a module-level flag), and the fixture schema lacks them,
  // so a second boot in the same file would run without them. Live D1 keeps them; make them here the same way.
  DB.raw.exec("CREATE TABLE IF NOT EXISTS sms_seen (sid TEXT PRIMARY KEY, at TEXT); CREATE TABLE IF NOT EXISTS sms_meta (k TEXT PRIMARY KEY, v TEXT); CREATE INDEX IF NOT EXISTS sms_log_client ON sms_log (client_id, at);" +
    "CREATE TABLE IF NOT EXISTS fillweek_cache (client_id TEXT PRIMARY KEY, at TEXT, day TEXT, say TEXT); CREATE TABLE IF NOT EXISTS fillweek_counts (client_id TEXT PRIMARY KEY, at TEXT, n INTEGER, due INTEGER, customers INTEGER); CREATE TABLE IF NOT EXISTS fillweek_tries (client_id TEXT PRIMARY KEY, at TEXT, result TEXT DEFAULT '');");
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site = H.makeClient(worker, env);
  const one = (sql, ...a) => DB.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();

  // One business. o: { cid, business, owner (owner's cell), number (its own line, E.164), town, approved, tier, feats }
  async function addClient(o) {
    o = Object.assign({ business: 'Sinclair Plumbing', owner: '+14785550101', town: 'Eatonton, GA', approved: true, tier: 'Pro', feats: '' }, o || {});
    const k = ++nClient;
    const cid = o.cid || ('client-' + k);
    const number = o.number || ('+1478555' + String(2000 + k).padStart(4, '0'));
    await run('INSERT INTO app_clients (client_id, code_hash, ref, business, owner_first, phone, tier, active, feats, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9)',
      cid, createHash('sha256').update('code-' + cid).digest('hex'), 'ref-' + k + '-x', o.business, o.ownerFirst || 'Dana', o.owner, o.tier, o.feats, '2026-10-01T00:00:00Z');
    await run("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, facts, updated) VALUES (?1, ?2, ?3, 1, 'plumbing', ?4, ?5, '2026-10-01T00:00:00Z')",
      number, cid, o.business, o.town, o.facts || '{}');
    if (o.approved) await SMS.setBrand(env, cid, 'MG' + String(k).padStart(32, 'c'), 'approved');
    return { cid, number, owner: o.owner, business: o.business };
  }
  // A text arriving at one of our numbers, signed the way Twilio signs it. sid: pass one to send the same text twice.
  async function sms(to, from, body, sid) {
    const params = { MessageSid: sid || ('SM' + createHash('md5').update(String(++nSid) + from + body).digest('hex')), From: from, To: to, Body: body };
    const href = 'https://alwaysopenoffice.com/voice/sms/' + env.VOICE_KEY;
    const r = await site.call('/voice/sms/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
    return Object.assign(r, { sid: params.MessageSid });
  }
  // A Google Calendar for one client (the three calls gcal.js makes: token refresh, events.list, events.insert),
  // answering the way Google's Calendar API v3 documents them. Events live in world.gcal.
  async function connectCalendar(cid, tz) {
    world.gcal = world.gcal || [];
    await run('CREATE TABLE IF NOT EXISTS gcal_tokens (client_id TEXT PRIMARY KEY, refresh TEXT NOT NULL, tz TEXT, connected_at TEXT)');
    await run("INSERT OR REPLACE INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES (?1, 'rt-test', ?2, '2026-10-01T00:00:00Z')", cid, tz || 'America/New_York');
    if (world.gcalFaked) return;
    world.gcalFaked = true;
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input.url || String(input));
      const method = (init && init.method) || 'GET';
      const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' });
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
        if (method === 'POST') { const e = JSON.parse(String(init.body)); e.id = 'ev' + (world.gcal.length + 1); e.status = 'confirmed'; world.gcal.push(e); return json(e); }
        const q = new URL(url).searchParams, lo = Date.parse(q.get('timeMin') || '') || 0, hi = Date.parse(q.get('timeMax') || '') || Infinity;
        return json({ kind: 'calendar#events', timeZone: tz || 'America/New_York', items: world.gcal.filter(e => Date.parse(e.end.dateTime) > lo && Date.parse(e.start.dateTime) < hi) });
      }
      return inner(input, init);
    };
  }
  // Every text that reached Twilio's Messages API, whichever list the harness filed it under.
  const sent = () => world.calls.filter(c => c.method === 'POST' && /\/Messages\.json$/.test(c.url)).map(c => Object.fromEntries(new URLSearchParams(c.body)));
  const sentTo = e164 => sent().filter(t => t.To === e164);
  // The text the webhook answered with (TwiML <Message>): it goes out from the number that was texted.
  const twimlMessage = r => { const m = /<Message>([\s\S]*?)<\/Message>/.exec(r.text || ''); return m ? m[1] : ''; };
  return { world, DB, env, site, one, all, run, addClient, sms, sent, sentTo, twimlMessage, connectCalendar };
}
