// A stand-in for Cloudflare, so the real worker code can run end to end on this machine:
//   - a D1 look-alike on SQLite, loaded with a copy of the live database layout (test/fixtures/schema.sql)
//   - fake Stripe, Twilio, Anthropic, Google Places and the phone push, answering the way their documents say
//   - a call room (Durable Object) driven by hand
// Nothing here touches the internet: any web address the code reaches for that isn't faked here is recorded and fails the run.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');

// Timers the worker sets (nudges, fillers) must never keep the test process alive.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); if (t && t.unref) t.unref(); return t; };

// ---------- D1 on SQLite ----------
export function makeDB(schemaFile) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaFile || join(ROOT, 'test', 'fixtures', 'schema.sql'), 'utf8'));
  const isRead = sql => /^\s*(select|with|pragma|explain)/i.test(sql) || /\bRETURNING\b/i.test(sql);   // D1 answers rows for RETURNING too
  const clean = args => args.map(v => {
    if (v === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return v;
  });
  const exec1 = (sql, args) => {
    const st = db.prepare(sql);
    if (isRead(sql)) return { results: st.all(...clean(args)).map(r => Object.assign({}, r)), success: true, meta: { changes: 0, last_row_id: 0 } };
    const r = st.run(...clean(args));
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql, args) => {
    const q = {
      sql, __args: args,
      bind: (...a) => stmt(sql, a),
      async run() { return exec1(sql, args); },
      async all() { return exec1(sql, args); },
      async first(col) { const r = exec1(sql, args).results[0]; if (!r) return null; return col ? r[col] : r; },
      async raw() { return exec1(sql, args).results.map(r => Object.values(r)); }
    };
    return q;
  };
  return {
    raw: db,
    prepare: sql => stmt(sql, []),
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map(s => exec1(s.sql, s.__args || [])); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}
// ---------- the fakes ----------
export class World {
  constructor() {
    this.calls = [];        // every web request the worker made: { method, url, body }
    this.unmocked = [];
    this.mail = [];         // emails the worker sent (from EmailMessage)
    this.pushes = [];       // phone pushes to Christopher (ntfy)
    this.texts = [];        // texts sent through Twilio
    this.dialed = [];       // outbound calls placed through Twilio
    this.aiSeen = [];       // every streamed request to Claude (to read the instructions Max was given)
    this.bought = [];       // phone numbers bought through Twilio
    this.sessions = new Map();
    this.aiScript = [];     // what the AI answers, in order, for streamed call replies
    this.aiNote = null;     // the call note JSON the AI writes when a call ends
    this.places = { places: [] };
    this.fail = {};         // switches: { twilioBuy: true, stripeCheckout: true, ... }
    this.n = 0;
  }
  id(prefix, len) { this.n++; return prefix + (String(this.n) + 'abcdef0123456789abcdef0123456789abcdef').slice(0, len || 32).padEnd(len || 32, '0'); }
}

const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });

function sseBody(text, model) {
  const enc = new TextEncoder();
  const parts = [];
  parts.push('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { model: model || 'claude-haiku-5-5', usage: { input_tokens: 400, cache_read_input_tokens: 0 } } }) + '\n\n');
  // a few words at a time, like a real stream
  const words = text.match(/\S+\s*/g) || [text];
  for (let i = 0; i < words.length; i += 3) parts.push('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: words.slice(i, i + 3).join('') } }) + '\n\n');
  parts.push('event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: Math.ceil(text.length / 4) } }) + '\n\n');
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
}

export function installFetch(world, env) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input.url || String(input));
    const method = (init && init.method) || (input && input.method) || 'GET';
    const body = init && init.body != null ? String(init.body) : '';
    world.calls.push({ method, url, body });
    const u = new URL(url);
    const host = u.hostname, path = u.pathname;
    const form = () => new URLSearchParams(body);

    // ---- push to Christopher's phone ----
    if (host === 'ntfy.example.test') { world.pushes.push({ title: (init.headers || {}).Title || (init.headers || {}).title || '', priority: (init.headers || {}).Priority || '', body }); return new Response('ok'); }

    // ---- Stripe ----
    if (host === 'api.stripe.com') {
      const p = path.replace('/v1/', '');
      if (world.fail.stripe) return json({ error: { message: 'Stripe is having a bad day' } }, 500);
      if (method === 'POST' && p === 'webhook_endpoints') return json({ id: 'we_test1', secret: 'whsec_rehearsal_secret' });
      if (method === 'POST' && p === 'billing_portal/configurations') return json({ id: 'bpc_test1' });
      if (method === 'POST' && p === 'billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/session/test' });
      if (method === 'GET' && p === 'account') return json({ settings: { dashboard: { display_name: 'Always Open (test)' } } });
      if (method === 'POST' && p === 'checkout/sessions') {
        const f = form(), id = 'cs_test_' + world.id('', 24);
        const metadata = {}; for (const [k, v] of f) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v; }
        const sess = { id, object: 'checkout.session', mode: 'subscription', status: 'complete', customer: 'cus_' + world.id('', 12), subscription: 'sub_' + world.id('', 12), customer_email: f.get('customer_email'), customer_details: { email: f.get('customer_email') }, metadata, _items: [...f].filter(([k]) => /line_items/.test(k)) };
        world.sessions.set(id, sess);
        return json({ id, url: 'https://checkout.stripe.com/c/pay/' + id });
      }
      const gs = p.match(/^checkout\/sessions\/(.+)$/);
      if (method === 'GET' && gs) { const s = world.sessions.get(gs[1]); return s ? json(s) : json({ error: { message: 'No such checkout.session' } }, 404); }
      if (method === 'POST' && p === 'accounts') { world.stripeAccounts = (world.stripeAccounts || []).concat([body]); if (world.fail.connectOff) return json({ error: { message: 'You can only create new accounts if you\u2019ve signed up for Connect' } }, 400); return json({ id: 'acct_' + world.id('', 16) }); }
      if (method === 'POST' && p === 'account_links') return json({ url: 'https://connect.stripe.com/setup/s/' + world.id('', 12) });
      if (method === 'GET' && /^accounts\/acct_/.test(p)) return json({ id: p.slice(9), charges_enabled: false });
      if (method === 'POST' && p === 'webhook_endpoints') return json({ id: 'we_test2', secret: 'whsec_x' });
      if (method === 'POST' && p === 'products') return json({ id: 'prod_' + world.id('', 10) });
      const sub = p.match(/^subscriptions\/([^?]+)/);
      if (sub && method === 'GET') return json({ id: sub[1], items: { data: [{ id: 'si_main', price: { product: { name: 'Always Open Growth' } } }] } });
      if (sub && method === 'POST') { world.stripeSubUpdates = (world.stripeSubUpdates || []).concat([[sub[1], body]]); return json({ id: sub[1] }); }
      if (/^(customers|invoices|coupons|customer_balance)/.test(p)) return json({ id: 'x', data: [] });
      world.unmocked.push(method + ' ' + url); return json({ error: { message: 'not faked: ' + p } }, 404);
    }

    // ---- Twilio ----
    if (host === 'api.twilio.com') {
      if (world.fail.twilioBuy && /IncomingPhoneNumbers\.json$/.test(path) && method === 'POST') return json({ message: 'Your account balance is too low' }, 402);
      if (/AvailablePhoneNumbers/.test(path)) {
        const ac = (u.searchParams.get('AreaCode') || (u.searchParams.get('NearNumber') || '+1478').replace(/\D/g, '').slice(1, 4) || '478');
        world.numCounter = (world.numCounter || 100) + 1;
        return json({ available_phone_numbers: [{ phone_number: '+1' + ac + '555' + String(world.numCounter).padStart(4, '0') }] });
      }
      if (/IncomingPhoneNumbers\.json$/.test(path) && method === 'POST') {
        const f = form(); world.bought.push(Object.fromEntries(f));
        return json({ sid: 'PN' + world.id('', 32).slice(0, 32).replace(/[^0-9a-f]/g, '0'), phone_number: f.get('PhoneNumber') }, 201);
      }
      if (/IncomingPhoneNumbers\/PN/.test(path) && method === 'DELETE') return new Response(null, { status: 204 });
      if (/Calls\.json$/.test(path) && method === 'POST') { const f = form(); const sid = 'CA' + world.id('', 32).replace(/[^0-9a-f]/g, '0').slice(0, 32).padEnd(32, '0'); world.dialed.push(Object.assign({ sid }, Object.fromEntries(f))); return json({ sid, status: 'queued' }, 201); }
      // Calls and recordings, for the voicemail backup (voicemail.js): world.twCalls, world.twRecs[callSid].
      if (/\/Calls\.json$/.test(path) && method === 'GET') return json({ calls: world.twCalls || [], next_page_uri: null });
      let vm = path.match(/\/Calls\/(CA[0-9a-f]{32})\/Recordings\.json$/);
      if (vm && method === 'GET') return json({ recordings: (world.twRecs || {})[vm[1]] || [] });
      vm = path.match(/\/Calls\/(CA[0-9a-f]{32})\.json$/);
      if (vm && method === 'GET') { const c = (world.twCalls || []).find(x => x.sid === vm[1]); return c ? json(c) : json({ message: 'not found' }, 404); }
      vm = path.match(/\/Recordings\/(RE[0-9a-f]{32})\.mp3$/);
      if (vm && method === 'GET') return world.fail.recording ? json({ message: 'not ready' }, 500) : new Response(new Uint8Array([73, 68, 51, 4]));
      vm = path.match(/\/Recordings\/(RE[0-9a-f]{32})\.json$/);
      if (vm && method === 'DELETE') { (world.twDeleted = world.twDeleted || []).push(vm[1]); return new Response(null, { status: 204 }); }
      if (/Messages\.json$/.test(path) && method === 'POST') { const f = form(); world.texts.push(Object.fromEntries(f)); return json({ sid: 'SM' + world.id('', 32), status: 'queued' }, 201); }
      world.unmocked.push(method + ' ' + url); return json({ message: 'not faked' }, 404);
    }
    if (host === 'messaging.twilio.com' || host === 'trusthub.twilio.com') { world.unmocked.push(method + ' ' + url); return json({ message: 'not faked' }, 404); }

    // ---- the AI ----
    if (host === 'api.anthropic.com') {
      const b = JSON.parse(body || '{}');
      if (world.fail.anthropic) return new Response('{"error":{"message":"overloaded"}}', { status: 529 });
      if (!b.stream) {
        const txt = JSON.stringify(typeof world.aiNote === 'function' ? world.aiNote(b) : (world.aiNote || { name: '', callback: '', reason: 'Left a message', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'They left a message.' }));
        return json({ model: b.model, content: [{ type: 'text', text: txt }], usage: { input_tokens: 300, output_tokens: 80 }, stop_reason: 'end_turn' });
      }
      world.aiSeen.push(b);
      const next = world.aiScript.length > 1 ? world.aiScript.shift() : (world.aiScript[0] || 'Okay, got it.');
      const text = typeof next === 'function' ? next(b) : next;
      return new Response(sseBody(text, b.model), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    // ---- Google Places (the first-look audit) ----
    if (host === 'places.googleapis.com') return json(world.places);

    // ---- Apple push, weather, anything else: not expected during a rehearsal ----
    world.unmocked.push(method + ' ' + url);
    return json({ message: 'not faked in the rehearsal' }, 404);
  };
}

// ---------- the worker's environment ----------
export function makeEnv(world, DB, extra) {
  class FakeEmail { async send(msg) { world.mail.push({ from: msg.from, to: msg.to, raw: msg.raw }); } }
  const env = Object.assign({
    DB,
    EMAIL: new FakeEmail(),
    MAIL_FROM: 'forms@example.test', MAIL_TO: 'owner@example.test',
    NTFY_URL: 'https://ntfy.example.test/topic',
    STRIPE_KEY: 'sk_test_rehearsal',
    LEADS_KEY: 'leads-key-rehearsal',
    VOICE_KEY: 'voice-key-rehearsal',
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'twilio-token-rehearsal',
    TWILIO_MESSAGING_SID: 'MG' + 'b'.repeat(32),
    ANTHROPIC_API_KEY: 'sk-ant-rehearsal',
    PLACES_KEY: 'places-key-rehearsal',
    IP_SALT: 'salt',
    GBP_DRAFTS: 'primary',
    ASSETS: { async fetch(req) {
      const p = new URL(req.url).pathname;
      const cand = p === '/' ? 'index.html' : (p.replace(/^\//, '').replace(/\/$/, '') + (/\.[a-z0-9]+$/i.test(p) ? '' : '.html'));
      const f = join(ROOT, 'public', cand);
      if (existsSync(f)) return new Response(readFileSync(f), { headers: { 'content-type': /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
      return new Response('Not found', { status: 404 });
    } }
  }, extra || {});
  return env;
}

// Twilio signs its webhooks; so does the rehearsal.
export function twilioSign(token, href, params) {
  let data = href;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac('sha1', token).update(data).digest('base64');
}
// Stripe signs its webhooks; so does the rehearsal.
export function stripeSign(secret, body) {
  const t = Math.floor(Date.now() / 1000);
  return 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');
}

// ---------- the call room ----------
export function makeRoom(CallRoom, env, name) {
  const store = new Map(), sockets = [];
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { store.set(k, structuredClone(v)); },
      async setAlarm() {}, async deleteAlarm() {}
    },
    getWebSockets: () => sockets,
    acceptWebSocket: ws => sockets.push(ws)
  };
  const room = new CallRoom(ctx, env);
  const ws = { sent: [], send(x) { this.sent.push(JSON.parse(x)); }, close() {} };
  sockets.push(ws);
  return { room, ws, store };
}
export function makeNamespace(CallRoom, env) {
  const rooms = new Map();
  return {
    idFromName: n => n,
    get(id) {
      if (!rooms.has(id)) rooms.set(id, makeRoom(CallRoom, env, id));
      return rooms.get(id).room;
    },
    _rooms: rooms
  };
}

// ---------- calling the worker ----------
export function makeClient(worker, env) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch(e => { pending.errors = (pending.errors || []).concat([e]); })); }, passThroughOnException() {} };
  async function settle() { let n = -1; while (pending.length !== n) { n = pending.length; await Promise.all(pending.slice()); } pending.length = 0; }
  async function call(path, o) {
    o = o || {};
    const headers = Object.assign({ 'cf-connecting-ip': o.ip || '203.0.113.7' }, o.headers || {});
    let body;
    if (o.form) { body = new URLSearchParams(o.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (o.multipart) { body = o.multipart; }
    else if (o.json) { body = JSON.stringify(o.json); headers['content-type'] = 'application/json'; }
    else if (o.body != null) body = o.body;
    const req = new Request('https://alwaysopenoffice.com' + path, { method: o.method || (body != null ? 'POST' : 'GET'), headers, body, redirect: 'manual' });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    await settle();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') || '', json() { return JSON.parse(text); } };
  }
  return { call, settle, ctx, pending };
}
