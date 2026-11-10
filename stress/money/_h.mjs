// Shared setup for the "money" stress tests: one fresh world per call to boot(), the real worker code, the harness's
// fake Cloudflare / Stripe / Twilio / Anthropic. Nothing here touches the internet.
//
// The harness's fake Stripe is small (it answers every subscription with one "Always Open Growth" item and does not know
// invoice items, invoices, balances or cards). stripeModel() below wraps globalThis.fetch (the harness is not edited) with
// a slightly fuller stand-in that keeps what the worker itself sent: a subscription holds the line items the worker's own
// checkout created, a plan change edits them, a balance credit lowers the customer's balance, an Idempotency-Key replays
// the first answer, an unknown subscription id is a 404. It never invents an answer the worker did not cause, except
// where a test sets a Stripe-side fact on purpose (S.invoices, S.cards, S.declining, S.customers.get(id).address).
// The one assumption about Stripe that a finding rests on (file 03) is written out where it is made, below.
//
// Other things a test here should know:
//   - One world per test file. Several src modules remember "my tables are ready" in a module-level flag, so a second
//     fresh database in the same process would miss tables. Each file calls boot() once and uses several businesses.
//   - The clock replaces Date for the whole file (new Date() and Date.now()); the worker uses both.
//   - The harness lets timers go without holding the process open. cron() and site.call() below hold the loop open
//     until the work is done; without that the test process ends in the middle of a job that pauses.
//   - Owner pushes: a throwaway signing key is put in env.APNS_KEY, so the worker sends them to Apple's address, which
//     the harness records and refuses. ownerPushes(world) reads them back.
import { register } from 'node:module';
register('../../test/rehearsal/hooks.mjs', import.meta.url);          // must come before importing src
export const H = await import('../../test/rehearsal/harness.js');
export const { default: worker } = await import('../../src/index.js');
export const { CallRoom } = await import('../../src/voice.js');

export const CUSTOMER = { plan: 'Growth', max: '0', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' };

const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });

export function stripeModel(world) {
  const S = { subs: new Map(), customers: new Map(), products: new Map(), invoiceItems: [], invoices: [], balanceTx: [], cards: new Map(), charges: new Map(), idem: new Map(), declining: new Set(), n: 0, log: [] };
  const id = p => p + '_m' + (++S.n);
  const cust = c => { if (!S.customers.has(c)) S.customers.set(c, { id: c, balance: 0, address: null }); return S.customers.get(c); };
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input.url || String(input));
    const u = new URL(url);
    if (u.hostname !== 'api.stripe.com' || world.fail.stripe) return inner(input, init);
    const method = (init && init.method) || 'GET', p = u.pathname.replace('/v1/', ''), body = init && init.body != null ? String(init.body) : '';
    const f = new URLSearchParams(body), hdr = (init && init.headers) || {};
    const rec = () => { world.calls.push({ method, url, body }); S.log.push({ method, path: p + u.search, body: Object.fromEntries(f), idem: hdr['Idempotency-Key'] || '', account: hdr['Stripe-Account'] || '' }); };
    const idemKey = hdr['Idempotency-Key'];
    const once = make => { if (idemKey && S.idem.has(idemKey)) return json(S.idem.get(idemKey)); const o = make(); if (idemKey) S.idem.set(idemKey, o); return json(o); };
    if (world.fail.stripePath && world.fail.stripePath.test(method + ' ' + p)) { rec(); return json({ error: { message: 'Stripe is having a bad day' } }, 500); }

    // The worker's own checkout: let the harness make the session, then remember what was sold.
    if (method === 'POST' && p === 'checkout/sessions' && !hdr['Stripe-Account']) {
      const res = await inner(input, init), j = await res.clone().json();
      const s = world.sessions.get(j.id);
      if (s && f.get('mode') === 'subscription') {
        const items = [];
        for (let i = 0; f.has('line_items[' + i + '][price_data][unit_amount]'); i++) {
          items.push({ id: id('si'), quantity: +(f.get('line_items[' + i + '][quantity]') || 1), price: { unit_amount: +f.get('line_items[' + i + '][price_data][unit_amount]'), recurring: { interval: f.get('line_items[' + i + '][price_data][recurring][interval]') || 'month' }, product: { id: id('prod'), name: f.get('line_items[' + i + '][price_data][product_data][name]') || '' } } });
        }
        S.subs.set(s.subscription, { id: s.subscription, customer: s.customer, status: 'active', cancel_at_period_end: false, pause_collection: null, items: { data: items } });
        cust(s.customer);
      }
      S.log.push({ method, path: p, body: Object.fromEntries(f), idem: '', account: '' });
      return res;
    }
    let m;
    if ((m = p.match(/^subscriptions\/([^/?]+)$/))) {
      rec();
      const sub = S.subs.get(m[1]);
      if (!sub) return json({ error: { message: 'No such subscription: ' + m[1] } }, 404);
      if (method === 'POST') {
        world.stripeSubUpdates = (world.stripeSubUpdates || []).concat([[m[1], body]]);
        if (f.has('cancel_at_period_end')) sub.cancel_at_period_end = f.get('cancel_at_period_end') === 'true';
        if (f.has('pause_collection')) sub.pause_collection = null;
        if (f.has('pause_collection[behavior]')) sub.pause_collection = { behavior: f.get('pause_collection[behavior]'), resumes_at: +f.get('pause_collection[resumes_at]') || null };
        // A card that declines (S.declining holds the customer): Stripe's documented default for an update that needs a
        // payment is payment_behavior=allow_incomplete: the change is applied, the new invoice stays unpaid and the
        // subscription goes past_due. Only payment_behavior=error_if_incomplete makes Stripe refuse with a 402.
        if (f.has('items[0][id]') && S.declining.has(sub.customer)) {
          if (f.get('payment_behavior') === 'error_if_incomplete') return json({ error: { message: 'Your card was declined.' } }, 402);
          sub.status = 'past_due';
        }
        for (let i = 0; f.has('items[' + i + '][id]'); i++) {
          const it = sub.items.data.find(x => x.id === f.get('items[' + i + '][id]'));
          if (!it) return json({ error: { message: 'No such subscription item' } }, 400);
          // Stripe refuses an inline price with no amount (the stand-in errs on Stripe's side here, never the worker's).
          if (!f.has('items[' + i + '][price_data][unit_amount]')) return json({ error: { message: 'Missing required param: items[' + i + '][price_data][unit_amount].' } }, 400);
          const prod = S.products.get(f.get('items[' + i + '][price_data][product]'));
          it.price = { unit_amount: +f.get('items[' + i + '][price_data][unit_amount]'), recurring: { interval: 'month' }, product: prod || it.price.product };
        }
      }
      return json(sub);
    }
    if (method === 'POST' && p === 'products') { rec(); const o = { id: id('prod'), name: f.get('name') || '' }; S.products.set(o.id, o); return json(o); }
    if (method === 'POST' && p === 'invoiceitems') { rec(); return once(() => { const o = { id: id('ii'), customer: f.get('customer'), amount: +f.get('amount'), currency: f.get('currency'), description: f.get('description') }; S.invoiceItems.push(o); return o; }); }
    if (method === 'POST' && p === 'invoices') { rec(); return once(() => { const o = { id: id('in'), customer: f.get('customer'), status: 'draft', description: f.get('description') || '', made_by_worker: true }; S.invoices.push(o); return o; }); }
    if (method === 'POST' && (m = p.match(/^invoices\/([^/]+)\/finalize$/))) { rec(); const o = S.invoices.find(x => x.id === m[1]); if (o) o.status = 'open'; return json(o || { error: { message: 'No such invoice' } }, o ? 200 : 404); }
    if (method === 'GET' && p === 'invoices') { rec(); return json({ data: S.invoices.filter(x => x.customer === u.searchParams.get('customer') && !x.made_by_worker) }); }
    if (method === 'GET' && p === 'payment_methods') { rec(); return json({ data: (S.cards.get(u.searchParams.get('customer')) || []).map(fp => ({ card: { fingerprint: fp } })) }); }
    if (method === 'GET' && (m = p.match(/^charges\/([^/]+)$/))) { rec(); const c = S.charges.get(m[1]); return c ? json(c) : json({ error: { message: 'No such charge' } }, 404); }
    if ((m = p.match(/^customers\/([^/]+)\/balance_transactions$/))) {
      rec();
      if (method === 'GET') return json({ data: S.balanceTx.filter(t => t.customer === m[1]) });
      const meta = {}; for (const [k, v] of f) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) meta[mm[1]] = v; }
      return once(() => { const o = { id: id('cbtxn'), customer: m[1], amount: +f.get('amount'), description: f.get('description') || '', metadata: meta }; S.balanceTx.push(o); cust(m[1]).balance += o.amount; return o; });
    }
    if (method === 'GET' && (m = p.match(/^customers\/([^/]+)$/))) { rec(); return json(cust(decodeURIComponent(m[1]))); }
    return inner(input, init);
  };
  return S;
}

// A throwaway signing key, so the worker can send owner pushes (to Apple's address, which the harness records and refuses).
import { generateKeyPairSync } from 'node:crypto';
const APNS = { APNS_KEY: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }), APNS_KEY_ID: 'TESTKEY123' };
// What the worker pushed to owners' phones: [{ token, title, body }].
export const ownerPushes = world => world.calls.filter(c => /api(\.sandbox)?\.push\.apple\.com\/3\/device\//.test(c.url)).map(c => { let j = {}; try { j = JSON.parse(c.body); } catch (e) {} const a = (j.aps && j.aps.alert) || {}; return { token: c.url.split('/').pop(), title: a.title || '', body: a.body || '' }; });

// A fresh world: its own database, its own fakes, its own worker client.
export async function boot(extraEnv) {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, Object.assign({}, APNS, extraEnv || {}));
  H.installFetch(world, env);
  const S = stripeModel(world);
  env.CALLROOM = H.makeNamespace(CallRoom, env);
  const site0 = H.makeClient(worker, env);
  // The harness lets timers go without holding the process open; a page that waits a moment (the welcome page waits
  // two seconds for Max's number) would end the test process early. Every call here holds the loop open until it is done.
  const alive = async fn => { const keep = setInterval(() => {}, 20); try { return await fn(); } finally { clearInterval(keep); } };
  const site = { call: (p, o) => alive(() => site0.call(p, o)), settle: () => alive(() => site0.settle()), ctx: site0.ctx, pending: site0.pending };
  const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => DB.prepare(sql).bind(...a).run();
  await site.call('/start?plan=Growth');   // sets Stripe up (webhook secret) the way the live site does on first load
  const secret = async () => (await get("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
  // A signed Stripe event to /billing/webhook.
  let evN = 0;
  async function event(type, object, o) {
    const body = JSON.stringify({ id: (o && o.id) || ('evt_' + (++evN)), type, data: { object } });
    const sig = (o && o.sig) || H.stripeSign(await secret(), body);
    return site.call('/billing/webhook', { body, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });
  }
  // The subscription as Stripe would put it in a customer.subscription.* event right now.
  const subObj = sub => { const s = S.subs.get(sub); return { id: s.id, customer: s.customer, status: s.status, cancel_at_period_end: s.cancel_at_period_end, pause_collection: s.pause_collection }; };
  // Sign a business up the way a real one does: the checkout form, then Stripe's signed "paid" event.
  async function signup(form) {
    const r = await site.call('/billing/checkout', { form: Object.assign({}, CUSTOMER, form || {}) });
    if (r.status !== 303) throw new Error('checkout did not redirect: ' + r.status + ' ' + r.text.slice(0, 200));
    const sessionId = r.location.split('/').pop();
    const s = world.sessions.get(sessionId);
    const w = await event('checkout.session.completed', s);
    if (w.status !== 200) throw new Error('webhook ' + w.status + ' ' + w.text);
    const b = await get('SELECT * FROM billing WHERE session_id = ?1', sessionId);
    const line = b ? await get('SELECT * FROM voice_lines WHERE client_id = ?1', b.client_id) : null;
    return { sessionId, session: s, b, cid: b && b.client_id, code: b && b.code, sub: b && b.sub, customer: b && b.customer, number: line && line.number, A: p => '/app/' + (b && b.code) + p };
  }
  // The every-10-minutes run. The harness lets timers go without holding the process open, and a few jobs pause between
  // steps (a short setTimeout), so the loop is held open here until every job has finished.
  const cron = async () => {
    const keep = setInterval(() => {}, 20);
    try { await worker.scheduled({ cron: '*/10 * * * *' }, env, site.ctx); await site.settle(); } finally { clearInterval(keep); }
  };
  // Twilio webhooks, signed.
  const KEY = env.VOICE_KEY;
  function hook(kind, params, query) {
    const q = query ? '?' + query : '';
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + KEY + q;
    return site.call('/voice/' + kind + '/' + KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  }
  let callN = 0;
  const newSid = () => 'CA' + (++callN).toString(16).padStart(32, '0');
  const wsOf = sid => env.CALLROOM._rooms.get(sid);
  async function openRoom(sid, from) { const room = env.CALLROOM.get(sid); const w = wsOf(sid); await room.webSocketMessage(w.ws, JSON.stringify({ type: 'setup', callSid: sid, from })); }
  const say = async (sid, words) => { const r = wsOf(sid); await r.room.webSocketMessage(r.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true })); };
  return { world, DB, env, site, S, get, all, run, secret, event, subObj, signup, cron, hook, newSid, wsOf, openRoom, say };
}

// The clock. The worker reads both Date.now() and new Date(), so both are moved.
const RealDate = Date;
export function clock(start) {
  let t = typeof start === 'number' ? start : RealDate.parse(start);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(t); else super(...a); }
    static now() { return t; }
  }
  globalThis.Date = FakeDate;
  return { set(x) { t = typeof x === 'number' ? x : RealDate.parse(x); }, add(ms) { t += ms; }, now: () => t, restore() { globalThis.Date = RealDate; } };
}
export const DAY = 864e5;
