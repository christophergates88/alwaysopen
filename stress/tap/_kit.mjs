// Shared set-up for the Shoulder Tap stress tests (src/tap.js, the CallRoom in src/voice.js).
// mk() is the same world test/tap.test.js builds (business c1 "Quillen Plumbing", owner Mike on (478) 555-0101, a
// second business c2, Always Open's own line), with a few extra knobs. Nothing here changes how the worker behaves.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('../../test/rehearsal/hooks.mjs', import.meta.url);          // must come before importing src
export const H = await import('../../test/rehearsal/harness.js');
export const V = await import('../../src/voice.js');
export const T = await import('../../src/tap.js');
export const CB = await import('../../src/callbacks.js');
export const { setBrand } = await import('../../src/sms.js');
export const { default: worker } = await import('../../src/index.js');

export const LINE = '+14785551001', LINE3 = '+14785551003', CELL = '+14785557777', OWNER = '+14785550101', CALLER = '+14785550142',
  CALLER2 = '+14785550199', CODE = 'q'.repeat(32), CODE2 = 'z'.repeat(32), CODE3 = 'k'.repeat(32), OWN_LINE = '+17065550000', OPS = '+14783652533';
export const sidOf = n => 'CA' + String(n).padStart(32, '0');
export function zoneWhere(want) {
  for (let off = -11; off <= 12; off++) { const h = (new Date().getUTCHours() + off + 24) % 24; if (want(h)) return off === 0 ? 'Etc/GMT' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off); }
  throw new Error('no zone');
}
export const DAY_TZ = zoneWhere(h => h >= 11 && h <= 16);
const sha = s => createHash('sha256').update(s).digest('hex');

// o: { features, facts, ownerSet, transferTo, when, brand, phone, first, tz, ownFacts,
//      third: { phone, features, brand } adds business c3 "Second Shop" on LINE3 (owner's phone defaults to Mike's) }
export async function mk(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, Object.assign({ OPS_TEXT_TO: OPS }, o.env || {}));
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  if (o.brand !== false) await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first, regulated) VALUES ('c1', ?1, 'Quillen Plumbing', 1, 'Pro', 'calls', ?2, ?3, 0)")
    .bind(sha(CODE), o.phone === undefined ? '(478) 555-0101' : o.phone, o.first === undefined ? 'Mike' : o.first).run();
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first) VALUES ('c2', ?1, 'Other Shop', 1, 'Pro', 'calls', '(478) 555-0202', 'Pat')").bind(sha(CODE2)).run();
  const facts = Object.assign({ features: o.features === undefined ? ['tap'] : o.features }, o.facts || {});
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, transfer_to, transfer_when, updated, owner_set, tz, facts) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 0, 'plumbing', 'Eatonton, GA', ?2, ?3, '2026-10-01', ?4, ?5, ?6)")
    .bind(LINE, o.transferTo === undefined ? CELL : o.transferTo, o.when || 'urgent', JSON.stringify(o.ownerSet || {}), o.tz === undefined ? DAY_TZ : o.tz, JSON.stringify(facts)).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, updated, tz, facts) VALUES (?1, 'always-open', 'Always Open', 1, '2026-10-01', ?2, ?3)").bind(OWN_LINE, DAY_TZ, JSON.stringify(o.ownFacts || {})).run();
  if (o.third) {
    const t = o.third;
    if (t.brand !== false) await setBrand(env, 'c3', 'MG' + 'd'.repeat(32), 'approved');
    await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, feats, phone, owner_first) VALUES ('c3', ?1, 'Second Shop', 1, 'Pro', 'calls', ?2, 'Mike')").bind(sha(CODE3), t.phone || '(478) 555-0101').run();
    await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, transfer_to, transfer_when, updated, owner_set, tz, facts) VALUES (?1, 'c3', 'Second Shop', 1, 0, 'electrical', 'Eatonton, GA', '', 'urgent', '2026-10-01', '{}', ?2, ?3)")
      .bind(LINE3, DAY_TZ, JSON.stringify({ features: t.features || ['tap'] })).run();
  }
  const site = H.makeClient(worker, env);
  const hook = (kind, params, query) => {
    const q = query ? '?' + query : '', href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from, to, extra) => {
    const r = await hook('in', Object.assign({ CallSid: sid, To: to || LINE, From: from || CALLER }, extra || {}));
    if (!/<ConversationRelay/.test(r.text)) return { twiml: r.text };
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from: from || CALLER }));
    return Object.assign(x, { twiml: r.text, sid });
  };
  const send = (x, m) => x.room.webSocketMessage(x.ws, JSON.stringify(m));
  const say = async (x, words) => { await send(x, { type: 'prompt', voicePrompt: words, last: true }); if (x.room.tapJob) await x.room.tapJob; };
  const tokens = x => x.ws.sent.filter(m => m.type === 'text').map(m => m.token);
  const said = x => tokens(x).join('');
  const at = x => tokens(x).length, since = (x, m) => tokens(x).slice(m).join('').trim();
  let n = 0;
  const text = (from, body, to, sid) => hook('sms', { From: from, To: to || LINE, Body: body, MessageSid: sid || ('SM' + String(++n).padStart(32, '0')) });
  const taps = async () => (await DB.prepare('SELECT * FROM call_taps ORDER BY asked_at, rowid').all()).results;
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  const state = x => x.store.get('s');
  const app = (path, json, code) => site.call('/app/' + (code || CODE) + path, json ? { json } : {});
  const hangUp = async x => { await hook('after', { CallSid: x.sid, SessionDuration: '60', SessionStatus: 'ended' }); await site.settle(); };
  const extra = () => { const sys = world.aiSeen.at(-1).system; return sys.length > 1 ? sys[sys.length - 1].text : ''; };
  const prompt = () => world.aiSeen.at(-1).system[0].text;
  const ownerSet = async () => (await DB.prepare('SELECT owner_set FROM voice_lines WHERE number = ?1').bind(LINE).first()).owner_set;
  return { world, DB, env, site, hook, room, send, say, said, tokens, at, since, text, taps, row, state, app, hangUp, extra, prompt, ownerSet };
}
// A clock the test moves: Max's pauses are decided by Date.now.
export function clock() { const real = Date.now; let skew = 0; Date.now = () => real() + skew; return { add(ms) { skew += ms; }, stop() { Date.now = real; } }; }
export async function timed(fn) { const c = clock(); try { return await fn(c); } finally { c.stop(); } }
// Holds the next streamed AI reply once its text contains `marker`, until release(): the moment a real model is still
// writing the end of a reply while the start is already being spoken. Wraps the harness's fake fetch; restore() undoes it.
export function gateStream(marker) {
  const inner = globalThis.fetch;
  let open; const gate = new Promise(r => { open = r; });
  let armed = true;
  globalThis.fetch = async (input, init) => {
    const res = await inner(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (!armed || !/api\.anthropic\.com/.test(url) || !/event-stream/.test(res.headers.get('content-type') || '')) return res;
    armed = false;
    const parts = (await res.text()).split('\n\n').filter(Boolean).map(p => p + '\n\n');
    let acc = '', cut = parts.length;
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i].match(/"text":("(?:[^"\\]|\\.)*")/);
      if (m) acc += JSON.parse(m[1]);
      if (acc.includes(marker)) { cut = i + 1; break; }
    }
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ async start(c) {
      for (const p of parts.slice(0, cut)) c.enqueue(enc.encode(p));
      await gate;
      for (const p of parts.slice(cut)) c.enqueue(enc.encode(p));
      c.close();
    } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { release: () => open(), restore: () => { globalThis.fetch = inner; } };
}
export const tick = () => new Promise(r => setImmediate(r));
// What the owner's reply text got back from Twilio (the <Message> in the TwiML), or '' when none.
export const replyOf = r => { const m = String(r.text || '').match(/<Message>([\s\S]*?)<\/Message>/); return m ? m[1] : ''; };
