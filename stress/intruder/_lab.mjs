// Shared set-up for the intruder's tests: the real worker on the rehearsal harness, one paying business signed up the
// way a real one arrives (Stripe checkout + signed webhook), and the helpers from test/rehearsal.test.js.
// Nothing here touches the internet. Each test file imports lab() and gets its own fresh world and database.
import { register } from 'node:module';
register('../../test/rehearsal/hooks.mjs', import.meta.url);          // must come before importing src
const H = await import('../../test/rehearsal/harness.js');

export { H };

export async function lab(extraEnv) {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, extraEnv);
  H.installFetch(world, env);
  const { default: worker } = await import('../../src/index.js');
  const { CallRoom } = await import('../../src/voice.js');
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site = H.makeClient(worker, env);
  const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();

  // ---- a business signs up: checkout, then Stripe's signed webhook ----
  async function signUp(over) {
    const CUSTOMER = Object.assign({ plan: 'Growth', max: '1', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' }, over || {});
    await site.call('/start?plan=' + CUSTOMER.plan);   // sets Stripe up the first time
    const co = await site.call('/billing/checkout', { form: CUSTOMER });
    if (co.status !== 303) throw new Error('checkout did not redirect: ' + co.status + ' ' + co.text.slice(0, 200));
    const sessionId = co.location.split('/').pop();
    const s = world.sessions.get(sessionId);
    const body = JSON.stringify({ id: 'evt_' + sessionId, type: 'checkout.session.completed', data: { object: s } });
    const secret = (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
    const wh = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
    if (wh.status !== 200) throw new Error('webhook failed: ' + wh.text);
    await site.settle();
    const b = await get('SELECT * FROM billing WHERE session_id = ?1', sessionId);
    const line = await get('SELECT * FROM voice_lines WHERE client_id = ?1', b.client_id);
    return { cid: b.client_id, code: b.code, ref: b.ref, sessionId, lineNumber: line && line.number, A: p => '/app/' + b.code + p };
  }

  // ---- Twilio webhooks, signed the way Twilio signs them (a stranger's call or text reaches the worker like this) ----
  const KEY = env.VOICE_KEY;
  let callN = 0;
  function hook(kind, params, query) {
    const q = query ? '?' + query : '';
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + KEY + q;
    return site.call('/voice/' + kind + '/' + KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  }
  const wsOf = sid => env.CALLROOM._rooms.get(sid);
  const say = async (sid, words) => { const r = wsOf(sid); await r.room.webSocketMessage(r.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true })); };
  const heard = sid => wsOf(sid).ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
  const sent = sid => wsOf(sid).ws.sent;
  async function startCall(to, from, extra) {
    const sid = 'CA' + (++callN).toString(16).padStart(32, '0');
    const r = await hook('in', Object.assign({ CallSid: sid, To: to, From: from }, extra || {}));
    return { sid, r };
  }
  async function openRoom(sid, from) {
    const room = env.CALLROOM.get(sid); const w = wsOf(sid);
    await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
  }
  const endCall = async (sid, extra) => { const r = await hook('after', Object.assign({ CallSid: sid, SessionDuration: '60', SessionStatus: 'ended' }, extra || {})); await site.settle(); return r; };
  const text = (to, from, body) => hook('sms', { From: from, To: to, Body: body, MessageSid: 'SM' + Math.random().toString(16).slice(2).padEnd(32, '0') });

  return { H, world, DB, env, worker, site, get, all, run, signUp, hook, wsOf, say, heard, sent, startCall, openRoom, endCall, text, KEY };
}
