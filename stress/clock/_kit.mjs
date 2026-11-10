// Shared set-up for the "clock" stress tests (the scheduled jobs, attacked with time). Not a test itself.
// It boots the real worker on the rehearsal harness (test/rehearsal/harness.js: fake D1 on node:sqlite, fake Twilio,
// Stripe, AI) and signs businesses up through the real checkout + signed Stripe webhook, the same way stress/owner does.
// Nothing here touches the internet, and nothing in src/ or test/ is changed.
//
// The clock: the worker reads both Date.now() and new Date(), so both are replaced (like stress/money/_h.mjs).
//   const ck = clock('2026-11-10T15:00:00Z'); ck.set(...); ck.add(ms); ck.restore();
//   at('2026-11-10 22:00', 'Pacific/Honolulu') gives the UTC instant of a wall-clock time in a zone.
//
// One world per test file: several src modules remember "my tables are ready" in a module-level flag (sms.js uses a
// plain `let ready`), so a second fresh database in the same process could miss tables. Each file boots once and uses
// several businesses.
import { register } from 'node:module';
register('../../test/rehearsal/hooks.mjs', import.meta.url);   // must come before importing src
export const H = await import('../../test/rehearsal/harness.js');
export const { default: worker } = await import('../../src/index.js');
export const { CallRoom } = await import('../../src/voice.js');

const RealDate = Date;
export function clock(start) {
  let t = typeof start === 'number' ? start : RealDate.parse(start);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(t); else super(...a); }
    static now() { return t; }
  }
  globalThis.Date = FakeDate;
  return { set(x) { t = typeof x === 'number' ? x : RealDate.parse(x); return t; }, add(ms) { t += ms; return t; }, now: () => t, restore() { globalThis.Date = RealDate; } };
}
export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;

// The UTC instant of a wall-clock time ('YYYY-MM-DD HH:MM') in an IANA zone. Exact for every time that exists.
export function at(wall, tz) {
  const [d, hm] = wall.split(' '), [hh, mm] = hm.split(':').map(Number);
  const guess = RealDate.parse(d + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00Z');
  for (let off = -14; off <= 14; off++) {
    const t = guess - off * HOUR, l = wallOf(t, tz);
    if (l.day === d && l.hour === hh && l.minute === mm) return t;
  }
  throw new Error('no such wall time: ' + wall + ' ' + tz);
}
export function wallOf(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new RealDate(t)).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24, minute: +p.minute, wd: p.weekday, text: p.weekday + ' ' + p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute };
}

// A throwaway signing key, so the worker sends owner pushes (to Apple's address, which the harness records and refuses).
import { generateKeyPairSync } from 'node:crypto';
const APNS = { APNS_KEY: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }), APNS_KEY_ID: 'TESTKEY123' };
// What the worker pushed to owners' phones: [{ token, title, body }].
export const ownerPushes = world => world.calls.filter(c => /api(\.sandbox)?\.push\.apple\.com\/3\/device\//.test(c.url)).map(c => { let j = {}; try { j = JSON.parse(c.body); } catch (e) {} const a = (j.aps && j.aps.alert) || {}; return { token: c.url.split('/').pop(), title: a.title || '', body: a.body || '' }; });

export async function boot() {
  const mail = [];
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, Object.assign({}, APNS, { SEND_MAIL: { send: async m => { mail.push(m); } } }));
  world.sent = mail;   // emails to owners and customers (the SEND_MAIL binding)
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site0 = H.makeClient(worker, env);
  // The harness lets timers go without holding the process open; hold it open while the worker works.
  const alive = async fn => { const keep = setInterval(() => {}, 20); try { return await fn(); } finally { clearInterval(keep); } };
  const site = { call: (p, o) => alive(() => site0.call(p, o)), settle: () => alive(() => site0.settle()), ctx: site0.ctx };
  const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();
  let evt = 0;
  async function secret() { return (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v; }
  async function stripeEvent(type, object) {
    const body = JSON.stringify({ id: 'evt_c' + (++evt), type, data: { object } });
    return site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(await secret(), body), 'content-type': 'application/json' } });
  }
  // One business through the real sign-up: the form, Stripe checkout, then Stripe's signed "payment worked" event.
  async function signup(o) {
    await site.call('/start?plan=' + ((o && o.plan) || 'Growth'));
    const form = Object.assign({ plan: 'Growth', max: '0', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' }, o || {});
    const r = await site.call('/billing/checkout', { form });
    if (r.status !== 303) throw new Error('checkout did not redirect: ' + r.status + ' ' + r.text.slice(0, 200));
    const s = world.sessions.get(r.location.split('/').pop());
    const w = await stripeEvent('checkout.session.completed', s);
    if (w.status !== 200) throw new Error('webhook refused: ' + w.status + ' ' + w.text);
    await site.settle();
    const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
    const line = await get('SELECT * FROM voice_lines WHERE client_id = ?1', b.client_id);
    return { cid: b.client_id, code: b.code, sub: b.sub, customer: b.customer, number: line ? line.number : '', tz: line ? line.tz : '', base: '/app/' + b.code, session: s };
  }
  function as(base) {
    return {
      get: (p, o) => site.call(base + p, o || {}),
      post: (p, json, o) => site.call(base + p, Object.assign({ json }, o || {})),
      state: async () => (await site.call(base + '/api/state')).json()
    };
  }
  // Twilio webhooks, signed.
  function hook(kind, params, query) {
    const q = query ? '?' + query : '';
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  }
  // What a customer hears when Max's outgoing call (outcalls) is answered, as plain words.
  const heard = async (kind, sid, query) => (await hook(kind, { CallSid: sid, AnsweredBy: 'human' }, query)).text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // One whole call to Max's line: rings in, the caller says something, the call ends and the note is written.
  let callN = 0;
  const wsOf = sid => env.CALLROOM._rooms.get(sid);
  async function fullCall(to, from, words, note) {
    if (note) world.aiNote = note;
    const sid = 'CA' + (900000 + (++callN)).toString(16).padStart(32, '0');
    await hook('in', { CallSid: sid, To: to, From: from });
    const room = env.CALLROOM.get(sid), w = wsOf(sid);
    await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    if (words) { const r = wsOf(sid); await r.room.webSocketMessage(r.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true })); }
    await hook('after', { CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' });
    await site.settle();
    return sid;
  }
  // The whole 10-minute timer, as Cloudflare runs it. cron(2): the same tick delivered to two isolates at once.
  const cron = async (copies) => {
    const keep = setInterval(() => {}, 20);
    try { await Promise.all(Array.from({ length: copies || 1 }, () => worker.scheduled({ cron: '*/10 * * * *' }, env, site.ctx))); await site.settle(); } finally { clearInterval(keep); }
  };
  const approveTexting = cid => site.call('/ops/sms-brand', { json: { client: cid, mg: 'MG' + 'c'.repeat(32), status: 'approved' }, headers: { 'x-key': env.LEADS_KEY } });
  return { H, world, DB, env, site, get, all, run, signup, as, hook, heard, cron, approveTexting, stripeEvent, fullCall };
}
