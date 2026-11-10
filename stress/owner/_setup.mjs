// Shared setup for the "owner" stress tests. Not a test itself.
// It boots the real worker on the rehearsal harness (test/rehearsal/harness.js: fake Cloudflare, Twilio, Stripe, AI),
// and signs businesses up through the real checkout + signed Stripe webhook, so each has its own /app/<code>.
// Nothing here touches the internet.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
register('../../test/rehearsal/hooks.mjs', import.meta.url);   // must come before importing src
const H = await import('../../test/rehearsal/harness.js');

// A clock the tests can set. The repo's own tests fake time by replacing Date.now (test/night.test.js); this does the
// same and also makes `new Date()` agree with it, so "now" is one moment everywhere in the worker.
const RealDate = Date;
export const clock = {
  set(ms) {
    const at = typeof ms === 'number' ? ms : RealDate.parse(ms);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(at); } static now() { return at; } }
    globalThis.Date = FakeDate;
  },
  restore() { globalThis.Date = RealDate; },
  real: () => RealDate.now()
};

// The rehearsal harness has no Google Calendar. This adds the three calls the worker makes to it, answering the way
// Google's Calendar API v3 documents them: the token exchange, events.list (items between timeMin and timeMax, with the
// calendar's timeZone) and events.insert. Events live in world.gcal. Everything else still goes to the harness.
// world.gcalLagMs (optional) makes each calendar call take that long, the way a real one takes a few hundred ms.
export function fakeGoogleCalendar(world) {
  world.gcal = world.gcal || [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input.url || String(input));
    const method = (init && init.method) || 'GET';
    const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.test', refresh_token: 'rt-test', expires_in: 3599, token_type: 'Bearer' });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
      if (world.gcalLagMs) await sleep(world.gcalLagMs);
      if (method === 'POST') { const e = JSON.parse(String(init.body)); e.id = 'ev' + (world.gcal.length + 1); e.status = 'confirmed'; world.gcal.push(e); return json(e); }
      const q = new URL(url).searchParams, lo = Date.parse(q.get('timeMin') || '') || 0, hi = Date.parse(q.get('timeMax') || '') || Infinity;
      return json({ kind: 'calendar#events', timeZone: 'America/New_York', items: world.gcal.filter(e => Date.parse(e.end.dateTime) > lo && Date.parse(e.start.dateTime) < hi) });
    }
    return inner(input, init);
  };
}

export async function boot() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const { default: worker } = await import('../../src/index.js');
  const { CallRoom } = await import('../../src/voice.js');
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site = H.makeClient(worker, env);
  const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();
  const sha = s => createHash('sha256').update(s).digest('hex');
  let evt = 0, callN = 0, tokN = 0;

  // One business through the real sign-up: the form, Stripe checkout, then Stripe's signed "payment worked" event.
  async function signup(o) {
    await site.call('/start?plan=' + (o.plan || 'Growth'));
    const form = Object.assign({ plan: 'Growth', max: '0', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' }, o);
    const r = await site.call('/billing/checkout', { form });
    if (r.status !== 303) throw new Error('checkout did not redirect: ' + r.status + ' ' + r.text.slice(0, 200));
    const sessionId = r.location.split('/').pop();
    const s = world.sessions.get(sessionId);
    const body = JSON.stringify({ id: 'evt_' + (++evt), type: 'checkout.session.completed', data: { object: s } });
    const secret = (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
    const w = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
    if (w.status !== 200) throw new Error('webhook refused: ' + w.status + ' ' + w.text);
    await site.settle();
    const b = await get('SELECT * FROM billing WHERE session_id = ?1', sessionId);
    const line = await get('SELECT * FROM voice_lines WHERE client_id = ?1', b.client_id);
    return { cid: b.client_id, code: b.code, ref: b.ref, sub: b.sub, number: line ? line.number : '', business: b.business, base: '/app/' + b.code };
  }
  // A staff link, the way HQ adds one: a row in app_staff with the SHA-256 of the link's code.
  async function staffLink(cid, name, role) {
    const code = ('Staff' + (++tokN) + 'x'.repeat(40)).slice(0, 32).replace(/[^A-Za-z0-9]/g, 'q');
    const { ensureBiz } = await import('../../src/biz.js');
    await ensureBiz(env);
    await run("INSERT INTO app_staff (code_hash, client_id, name, created, role) VALUES (?1, ?2, ?3, ?4, ?5)", sha(code), cid, name, new Date().toISOString(), role || 'manager');
    return { code, base: '/app/' + code, hash: sha(code) };
  }
  // The app, as one person: api(path) is a GET, api(path, json) a POST.
  function as(base, ip) {
    return {
      base,
      get: (p, o) => site.call(base + p, Object.assign({ ip }, o || {})),
      post: (p, json, o) => site.call(base + p, Object.assign({ ip, json }, o || {})),
      raw: (p, o) => site.call(base + p, Object.assign({ ip }, o || {})),
      state: async () => (await site.call(base + '/api/state', { ip })).json()
    };
  }
  // Twilio webhooks, signed.
  function hook(kind, params, query) {
    const q = query ? '?' + query : '';
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  }
  const wsOf = sid => env.CALLROOM._rooms.get(sid);
  const say = async (sid, words) => { const r = wsOf(sid); await r.room.webSocketMessage(r.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true })); };
  async function startCall(to, from, extra) {
    const sid = 'CA' + (++callN).toString(16).padStart(32, '0');
    const r = await hook('in', Object.assign({ CallSid: sid, To: to, From: from }, extra || {}));
    return { sid, r };
  }
  async function openRoom(sid, from) {
    const room = env.CALLROOM.get(sid); const w = wsOf(sid);
    await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
  }
  // One whole call: rings in, the caller says something, the call ends and the note is written.
  async function fullCall(to, from, words, note) {
    if (note) world.aiNote = note;
    const { sid } = await startCall(to, from);
    await openRoom(sid, from);
    if (words) await say(sid, words);
    await hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' });
    await site.settle();
    return sid;
  }
  const sms = (to, from, body) => hook('sms', { From: from, To: to, Body: body, MessageSid: 'SM' + createHash('md5').update(from + body + Math.random()).digest('hex') });
  // The 10-minute timer, all of it. A few jobs pause on a real timer (map.js waits a second between lookups) and the
  // harness lets timers die with the process, so something has to hold the process open until they finish.
  const cron = async () => {
    const keep = setInterval(() => {}, 200);
    try { await worker.scheduled({ cron: '*/10 * * * *' }, env, site.ctx); await site.settle(); } finally { clearInterval(keep); }
  };
  const approveTexting = (cid) => site.call('/ops/sms-brand', { json: { client: cid, mg: 'MG' + 'c'.repeat(32), status: 'approved' }, headers: { 'x-key': env.LEADS_KEY } });
  return { H, world, DB, env, worker, site, get, all, run, sha, signup, staffLink, as, hook, startCall, openRoom, say, fullCall, sms, cron, approveTexting, wsOf };
}
