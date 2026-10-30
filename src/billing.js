// Self-serve signup and billing with Stripe (no SDK: plain HTTPS calls).
//   GET  /start                 pick a plan and fill in the business
//   POST /billing/checkout      -> Stripe Checkout (monthly subscription)
//   GET  /welcome?s=...         after paying: the private app link and next steps (creates the client if the webhook hasn't yet)
//   POST /billing/webhook       Stripe events: new signups, failed and paid invoices, pauses, plan changes, cancellations
//   POST /billing/setup         (x-key: LEADS_KEY) one-time: creates the Stripe webhook and the customer portal settings
// The client's own billing page (plan, card, pause, change, cancel with offers) lives at /app/<code>/billing (see billingPage).

import { noteSignup, expireCredits, REF_RE } from './referral.js';
import { firstLook } from './firstlook.js';
import { queueLine, provisionLine, lineEnded } from './provision.js';

const SITE = 'https://alwaysopenoffice.com';
export const PLANS = {
  Starter: { cents: 14900, blurb: 'Every review answered, your Google profile kept current, Max answering your calls (300 minutes a month), a monthly report and your own app.' },
  Growth: { cents: 29900, blurb: 'Starter, plus review requests after every job, posts from your photos, competitor watch and Storm Desk.' },
  Pro: { cents: 49900, blurb: 'Growth, plus follow-up reminders and missed-call text-back from your own number.' }
};
const MAX = { cents: 14900, blurb: '300 more minutes of Max a month, for when your phone rings more than the 300 that come with every plan.' };
const TYPES = ['Contractor or trade', 'Dock, marine or outdoor', 'Salon, spa or fitness', 'Restaurant or shop', 'Insurance agency', 'Medical, dental or legal', 'Other'];
const REGULATED = ['Insurance agency', 'Medical, dental or legal'];
export const EVENTS = ['checkout.session.completed', 'invoice.payment_failed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.dispute.created', 'charge.dispute.closed'];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (c / 100).toFixed(0);

// ---------- Stripe ----------
function form(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'object' ? form(x, key + '[' + i + ']', out) : out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(x)));
    else if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
export async function stripe(env, method, path, body, idem) {
  const headers = { Authorization: 'Bearer ' + env.STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' };
  if (idem) headers['Idempotency-Key'] = idem;   // a retry after a timeout can't charge twice
  const r = await fetch('https://api.stripe.com/v1/' + path, { method, headers, body: body ? form(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Stripe ' + r.status)); e.status = r.status; throw e; }
  return j;
}
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyStripe(secret, header, body, now) {
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')).filter(x => x.length === 2).map(([a, b]) => [a.trim(), b.trim()]));
  const sigs = String(header || '').split(',').filter(x => x.trim().startsWith('v1=')).map(x => x.trim().slice(3));
  const t = +parts.t;
  if (!t || !sigs.length || Math.abs((now || Date.now()) / 1000 - t) > 300) return false;
  const want = await hmacHex(secret, t + '.' + body);
  return sigs.some(s => s.length === want.length && [...s].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

// ---------- storage ----------
export async function ensureBilling(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS billing (client_id TEXT PRIMARY KEY, session_id TEXT UNIQUE, customer TEXT, sub TEXT, plan TEXT, max INTEGER DEFAULT 0, status TEXT, business TEXT, owner TEXT, email TEXT, phone TEXT, town TEXT, type TEXT, code TEXT, ref TEXT, created TEXT, updated TEXT, paused_until TEXT, hq_synced INTEGER DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)')
  ]);
}
const rnd = (n, abc) => { abc = abc || 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(n * 2)); let o = ''; for (const x of b) { if (x < abc.length * Math.floor(256 / abc.length)) o += abc[x % abc.length]; if (o.length === n) break; } return o.length === n ? o : o + rnd(n - o.length, abc); };
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14).replace(/-+$/, '') || 'client';
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

// A paid checkout becomes a client with a private app link, right away. Safe to call twice (webhook and welcome page).
export async function createFromSession(env, s, h) {
  await ensureBilling(env);
  const have = await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first();
  if (have) return have;
  const m = s.metadata || {};
  const email = s.customer_email || (s.customer_details && s.customer_details.email) || '';
  // Only the website's own checkout (/start) carries the plan and business. A payment through a Stripe Payment Link (sent
  // by hand) has neither: it is never made into a client or a phone line on its own; Christopher sets it up in HQ.
  if (!PLANS[m.plan]) {
    const known = email ? await env.DB.prepare('SELECT business FROM billing WHERE lower(email) = lower(?1)').bind(email).first().catch(() => null) : null;
    if (h && h.notify) await h.notify('Payment Link payment: ' + (email || 'no email'), '$' + ((+s.amount_total || 0) / 100).toFixed(2) + ' through a Stripe Payment Link. Nothing was set up on its own: add them in Always Open HQ, or send them alwaysopenoffice.com/start instead.' + (known ? ' Careful: ' + (known.business || 'a client') + ' already pays with this email, so this may be a second subscription.' : ''), 'high');
    return null;
  }
  const plan = m.plan;
  const cid = 'c-' + rnd(10, 'abcdefghjkmnpqrstuvwxyz23456789');
  const code = rnd(32), ref = slug(m.business) + '-' + rnd(4, 'abcdefghjkmnpqrstuvwxyz23456789');
  const now = new Date().toISOString();
  const reg = REGULATED.indexOf(m.type) > -1 ? 1 : 0;
  // The billing row first, and only the request that wrote it goes on: the webhook and the welcome page often arrive
  // together, and only one of them may make the client and buy the number.
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO billing (client_id, session_id, customer, sub, plan, max, status, business, owner, email, phone, town, type, code, ref, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)')
    .bind(cid, s.id, s.customer || '', s.subscription || '', plan, m.max === '1' ? 1 : 0, 'active', m.business || '', m.owner || '', email, m.phone || '', m.town || '', m.type || '', code, ref, now).run();
  if (!(ins.meta && ins.meta.changes)) return await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first();
  await env.DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, '', ?8, 1, ?9, '', ?10)")
    .bind(cid, await sha256hex(code), ref, m.business || '', String(m.owner || '').split(' ')[0], reg, m.phone || '', plan, now, 'calls').run();
  try { await noteSignup(env, { clientId: cid, ref: m.ref, email, phone: m.phone, business: m.business, source: 'link' }); } catch (e) { /* the signup stands without it */ }
  // Max's line is bought and connected on its own (provision.js); the timer retries if this first try can't finish.
  try { await queueLine(env, cid); if (h && h.later) h.later(provisionLine(env, cid).catch(() => {})); } catch (e) { /* the timer picks it up */ }
  if (h && h.notify) await h.notify('New signup: ' + (m.business || 'a business'), plan + ' plan' + (m.max === '1' ? ' + extra Max minutes' : '') + ', ' + (m.town || '') + '. ' + (m.owner || '') + ', ' + (m.phone || '') + '. Paid by card. Their app is live and Max’s line is being set up on its own.');
  return await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first();
}

// ---------- pages ----------
function page(title, inner, status) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Always Open</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,500..900&family=Instrument+Sans:wght@400;600;700&family=DM+Mono:wght@500&display=swap">
<style>:root{--paper:#F5F4F0;--card:#fff;--ink:#171B26;--slate:#586075;--line:#DCDAD3;--red:#D92D20;--ok:#1C6B54;--night:#0F131B;--night2:#171D2C;--display:"Archivo","Arial Narrow",Arial,sans-serif;--body:"Instrument Sans",system-ui,sans-serif;--mono:"DM Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root{--paper:#12151D;--card:#1A1F2B;--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--ok:#5CC9A4}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--body)}
.top{background:radial-gradient(600px 300px at 90% 0,rgba(217,45,32,.3),transparent 60%),linear-gradient(165deg,var(--night2),var(--night));color:#ECEEF3;padding:16px}
.top a{color:inherit;text-decoration:none;font:850 1.3rem var(--display);font-stretch:90%;display:inline-flex;gap:10px;align-items:center}
main{max-width:640px;margin:0 auto;padding:24px 16px 60px;display:grid;gap:18px}
h1{font:850 clamp(2rem,6vw,2.6rem)/1 var(--display);font-stretch:92%;margin:0}h2{font:800 1.25rem var(--display);margin:0}
p{margin:0}.sub{color:var(--slate)}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;display:grid;gap:12px}
label{display:grid;gap:6px;font-weight:600}input,select{font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);width:100%;min-width:0}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}@media (max-width:560px){.row{grid-template-columns:1fr}}
.plans{display:grid;gap:10px}.plan{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:start;padding:14px;border:1.5px solid var(--line);border-radius:12px;cursor:pointer;font-weight:500}
.plan:has(input:checked){border-color:var(--red);box-shadow:0 0 0 3px rgba(217,45,32,.15)}.plan input{width:18px;height:18px;margin:3px 0 0;accent-color:var(--red)}.plan b{font:800 1.1rem var(--display)}.plan .p{font:850 1.2rem var(--display)}
.opt{display:grid;grid-template-columns:22px 1fr;gap:10px;font-weight:500}.opt input{width:18px;height:18px;margin:3px 0 0;accent-color:var(--red)}
.btn{display:inline-flex;justify-content:center;align-items:center;font:700 16px var(--body);padding:14px 20px;border-radius:11px;border:2px solid var(--red);background:var(--red);color:#fff;text-decoration:none;cursor:pointer;box-shadow:0 0 16px rgba(217,45,32,.35)}
.btn.line{background:transparent;color:var(--ink);border-color:var(--ink);box-shadow:none}.btn.quiet{background:transparent;color:var(--slate);border-color:var(--line);box-shadow:none}
.mono{font:500 12px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--slate)}.err{color:var(--red);font-weight:600}.ok{color:var(--ok);font-weight:600}
.link{font:500 14px var(--mono);word-break:break-all;padding:12px;border:1px dashed var(--line);border-radius:10px;background:var(--paper)}
ol{margin:0;padding-left:1.2em;display:grid;gap:8px}.fine{font-size:13px;color:var(--slate)}.acts{display:flex;flex-wrap:wrap;gap:10px}
</style></head><body><div class="top"><a href="/"><svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>Always Open</a></div><main>${inner}</main></body></html>`;
  return new Response(html, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}

function startPage(v, err) {
  v = v || {};
  const plan = PLANS[v.plan] ? v.plan : 'Growth';
  return page('Start', `<div><p class="mono">Sign up</p><h1>Start Always Open today.</h1></div>
<p class="sub">Month to month, no setup fee, cancel any time. If the first month isn't worth it, tell us within 30 days and we refund it.</p>
${err ? '<p class="err">' + esc(err) + '</p>' : ''}
<form method="post" action="/billing/checkout" class="card">
<h2>Your plan</h2><div class="plans">${Object.entries(PLANS).map(([k, p]) => `<label class="plan"><input type="radio" name="plan" value="${k}"${k === plan ? ' checked' : ''}><span><b>${k}</b><br><span class="sub">${esc(p.blurb)}</span></span><span class="p">${money(p.cents)}<span class="sub">/mo</span></span></label>`).join('')}</div>
<label class="opt"><input type="checkbox" name="max" value="1"${v.max === '1' ? ' checked' : ''}><span><b>Add 300 more Max minutes, ${money(MAX.cents)}/mo.</b> <span class="sub">${esc(MAX.blurb)}</span></span></label>
<h2>Your business</h2>
<label>Business name<input name="business" required maxlength="120" autocomplete="organization" value="${esc(v.business)}"></label>
<div class="row"><label>Your name<input name="owner" required maxlength="80" autocomplete="name" value="${esc(v.owner)}"></label><label>Mobile phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel" value="${esc(v.phone)}"></label></div>
<div class="row"><label>Email<input name="email" type="email" required maxlength="120" autocomplete="email" value="${esc(v.email)}"></label><label>Town and state<input name="town" required maxlength="80" placeholder="Eatonton, GA" value="${esc(v.town)}"></label></div>
<label>Kind of business<select name="type">${TYPES.map(t => `<option${t === v.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
${REF_RE.test(v.ref || '') ? '<input type="hidden" name="ref" value="' + esc(v.ref) + '">' : ''}
<label class="opt"><input type="checkbox" name="agree" value="1" required><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>, and authorize monthly charges until I cancel.</span></label>
<button class="btn" type="submit">Continue to secure payment</button>
<p class="fine">Payment is handled by Stripe. We never see your card number.</p></form>`);
}

async function checkout(req, env) {
  const f = await req.formData();
  const v = {}; for (const k of ['plan', 'max', 'business', 'owner', 'phone', 'email', 'town', 'type', 'agree', 'ref']) v[k] = String(f.get(k) || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 120);
  if (!PLANS[v.plan]) v.plan = 'Growth';
  if (TYPES.indexOf(v.type) < 0) v.type = 'Other';
  if (!v.business || !v.owner || v.phone.replace(/\D/g, '').length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || !v.town) return startPage(v, 'Please fill in every box.');
  if (v.agree !== '1') return startPage(v, 'Please check the box to agree to the terms.');
  if (!env.STRIPE_KEY) return startPage(v, 'Online signup is not open yet. Call (706) 460-2226 or request the free audit, and we will set you up.');
  const items = [{ price_data: { currency: 'usd', unit_amount: PLANS[v.plan].cents, recurring: { interval: 'month' }, product_data: { name: 'Always Open ' + v.plan } }, quantity: 1 }];
  if (v.max === '1') items.push({ price_data: { currency: 'usd', unit_amount: MAX.cents, recurring: { interval: 'month' }, product_data: { name: 'More Max minutes' } }, quantity: 1 });
  const meta = { plan: v.plan, max: v.max === '1' ? '1' : '0', business: v.business, owner: v.owner, phone: v.phone, town: v.town, type: v.type };
  if (REF_RE.test(v.ref || '')) meta.ref = v.ref;
  try {
    const s = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'subscription', line_items: items, customer_email: v.email, metadata: meta, subscription_data: { metadata: meta },
      allow_promotion_codes: 'true', billing_address_collection: 'auto',
      success_url: SITE + '/welcome?s={CHECKOUT_SESSION_ID}', cancel_url: SITE + '/start?plan=' + v.plan
    });
    return Response.redirect(s.url, 303);
  } catch (e) { return startPage(v, 'Payment could not start: ' + String(e.message || e).slice(0, 160)); }
}

async function welcome(env, url, h) {
  const id = url.searchParams.get('s') || '';
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id) || !env.STRIPE_KEY) return page('Welcome', '<h1>Welcome.</h1><p class="sub">We could not find that signup. Email hello@alwaysopenoffice.com and we will sort it out.</p>', 404);
  let s;
  try { s = await stripe(env, 'GET', 'checkout/sessions/' + id); } catch (e) { if (e && (e.status === 404 || e.status === 400)) return page('Welcome', '<h1>Welcome.</h1><p class="sub">We could not find that signup. Email hello@alwaysopenoffice.com and we will sort it out.</p>', 404); return page('Welcome', '<h1>Almost there.</h1><p class="sub">We could not confirm the payment yet. Refresh this page in a minute.</p>', 502); }
  if (s.status !== 'complete') return page('Welcome', '<h1>Payment not finished.</h1><p class="sub">Nothing was charged. <a href="/start">Start again</a>.</p>', 402);
  const b = await createFromSession(env, s, h);
  if (!b) return page('Welcome', '<h1>Thank you.</h1><p class="sub">Your payment went through. Katie will be in touch today to set everything up. Questions? Email hello@alwaysopenoffice.com or call (706) 460-2226.</p>');
  const link = SITE + '/app/' + b.code;
  // Max's number, bought just now (or a moment ago by the webhook). Wait a few seconds for it, never longer.
  let line = null;
  try {
    for (let i = 0; i < 4 && !(line && line.status === 'live'); i++) {
      // The setup keeps running after this page is sent (waitUntil), so a slow Twilio never leaves a number half set up.
      const p = provisionLine(env, b.client_id);
      if (h && h.later) h.later(p.catch(() => {}));
      line = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 9000))]);
      if (!line || line.status === 'live' || line.status === 'failed') break;
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) { line = null; }
  // The owner first: their score, what holds them back most, and the one thing we'll do today. Looked up live, not kept.
  let fl = null;
  try { const cl0 = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(b.client_id).first(); if (cl0) fl = await firstLook(env, cl0, { force: true }); } catch (e) { fl = null; }
  const hero = !fl ? '' : (fl.found ? '<div class="card"><p class="mono">Your first look</p><h2>Your score: ' + fl.score + ' (' + esc(fl.grade) + ')</h2>' + (fl.finding ? '<p><b>What holds you back most:</b> ' + esc(fl.finding.title) + '. ' + esc(fl.finding.saw) + '</p><p class="fine">' + esc(fl.finding.fix) + '</p>' : '<p>Nothing big is holding you back. We keep it that way.</p>') + '<p class="fine">Google Maps. Looked up just now.</p></div>' : '') +
    '<div class="card"><p class="mono">The one thing we\u2019ll do today</p><h2>' + esc(fl.today.title) + '</h2><p>' + esc(fl.today.detail) + '</p>' + (fl.today.help ? '<div class="acts"><a class="btn" href="' + esc(link + fl.today.help) + '">Show me how</a></div>' : (fl.today.link ? '<div class="link">' + esc(fl.today.link) + '</div>' : '')) + '</div>';
  return page('Welcome', `<div><p class="mono">You're in</p><h1>Welcome to Always Open, ${esc(String(b.owner || '').split(' ')[0] || 'friend')}.</h1></div>
<p class="sub">${esc(b.business)} is on the ${esc(b.plan)} plan${b.max ? ' with 300 more Max minutes' : ''}. A receipt is on its way to ${esc(b.email)}.</p>
${hero}
<div class="card"><h2>1. Open your app</h2><p>This is your private link. It opens your account without a password, so keep it to yourself. Save it now.</p><div class="link">${esc(link)}</div>
<div class="acts"><a class="btn" href="${esc(link)}">Open my app</a></div><p class="fine">On an iPhone, the Always Open app opens this link too. On other phones, tap Share, then Add to Home Screen.</p></div>
<div class="card"><h2>2. Your first hour</h2><p>Your app opens with a short checklist: share your request link, add your hours, and send your missed calls to Max. Your request link and your app work from the first minute. Each step ticks itself when it’s done.</p></div>
${line && line.status === 'live' ? `<div class="card"><h2>3. Max is ready</h2><p>Max, your phone assistant, has his own number for you: <b>${esc(line.numberText)}</b>. Forward the calls you miss to it and he answers them, any hour. Your phone still rings first.</p><div class="acts"><a class="btn" href="${esc(link)}/help/forwarding">Show me how to forward</a></div><p class="fine">The steps for Verizon, AT&amp;T, T-Mobile and landlines are also in your app, under Your first hour.</p></div>` : `<div class="card"><h2>3. Max</h2><p>Max, your phone assistant, comes with your plan. His number is being set up right now and shows up in your app within the hour, with the steps to forward the calls you miss to him.</p></div>`}
<div class="card"><h2>4. Texting under your business name</h2><p>Phone carriers require every business that texts customers to be registered. One short form, with your legal business name and EIN, and we handle the rest. Approval usually takes a few days, and calls, Max and email work in the meantime.</p><div class="acts"><a class="btn" href="${esc(link)}/texting">Register for texting</a></div></div>
<div class="card"><h2>Optional: invite us to your Google profile</h2><ol>
<li>Open <a href="https://business.google.com" target="_blank" rel="noopener">business.google.com</a> and sign in.</li>
<li>Choose your business, then <b>More → Business Profile settings → People and access → Add</b>.</li>
<li>Add <b>hello@alwaysopenoffice.com</b> as a <b>Manager</b>. You stay the owner and can remove us any time.</li></ol><p class="fine">Everything above works without this. Once you invite us, we can answer your reviews and keep your profile current.</p></div>
<div class="card"><h2>What happens next</h2><p>Once you invite us to your Google profile (above), a reply to each new review shows up in the app for your OK. Questions? Message us from Ask us in the app.</p></div>`);
}

// The free month's pause: once in any 12 months, and not while paused or ending.
async function canPause(env, b) {
  if (b.status === 'paused' || b.status === 'canceling' || b.status === 'canceled') return false;
  const last = await env.DB.prepare('SELECT v FROM billing_config WHERE k = ?1').bind('paused:' + b.client_id).first().catch(() => null);
  return !(last && Date.now() - Date.parse(last.v) < 365 * 864e5);
}

// ---------- client billing page (from the app) ----------
export async function billingPage(env, c, base, req, url, h) {
  await ensureBilling(env);
  const b = await env.DB.prepare('SELECT * FROM billing WHERE client_id = ?1').bind(c.client_id).first();
  if (!b || !b.sub) return page('Your plan', '<h1>Your plan</h1><p class="sub">Your billing is handled directly with us. To change or cancel, message us in Ask us or email hello@alwaysopenoffice.com.</p><div class="acts"><a class="btn line" href="' + esc(base) + '">Back to the app</a></div>');
  const step = url.searchParams.get('step') || '';
  let note = url.searchParams.get('done') ? '<p class="ok">' + esc({ paused: 'Paused. Your next month is free and nothing else changes.', resumed: 'Welcome back. Billing picks up on your next date.', changed: 'Done. Your new plan starts now. The difference for the rest of this month was charged, or credited to your next bill.', canceled: 'Your plan ends at the end of this billing month. You can undo that here until then.', undone: 'Cancellation undone. Nothing changes.' }[url.searchParams.get('done')] || '') + '</p>' : '';
  if (req.method === 'POST') {
    const f = await req.formData(), a = String(f.get('a') || '');
    try {
      if (a === 'card') {
        const cfg = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'portal_id'").first();
        const ps = await stripe(env, 'POST', 'billing_portal/sessions', { customer: b.customer, return_url: SITE + base + '/billing', configuration: cfg ? cfg.v : undefined });
        return Response.redirect(ps.url, 303);
      }
      if (a === 'pause') {
        // One free month a year: the offer on the cancel screen, not a way to stop paying for good.
        if (!(await canPause(env, b))) return Response.redirect(SITE + base + '/billing', 303);
        const until = Math.floor(Date.now() / 1000) + 31 * 86400;
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { pause_collection: { behavior: 'void', resumes_at: until } });
        await env.DB.batch([
          env.DB.prepare("UPDATE billing SET status = 'paused', paused_until = ?1, updated = ?2 WHERE client_id = ?3").bind(new Date(until * 1000).toISOString(), new Date().toISOString(), c.client_id),
          env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES (?1, ?2)").bind('paused:' + c.client_id, new Date().toISOString())
        ]);
        if (h && h.notify) await h.notify((c.business || 'A client') + ' paused for a month', 'From the cancel screen. Billing resumes ' + new Date(until * 1000).toDateString() + '.');
        return Response.redirect(SITE + base + '/billing?done=paused', 303);
      }
      if (a === 'resume') {
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { pause_collection: '' });
        await env.DB.prepare("UPDATE billing SET status = 'active', paused_until = NULL, updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id).run();
        return Response.redirect(SITE + base + '/billing?done=resumed', 303);
      }
      if (a === 'plan') {
        const plan = String(f.get('plan') || '');
        if (!PLANS[plan] || plan === b.plan) return Response.redirect(SITE + base + '/billing', 303);
        const sub = await stripe(env, 'GET', 'subscriptions/' + b.sub + '?expand[]=items.data.price.product');
        const item = (sub.items.data || []).find(i => !/Max/.test((i.price && i.price.product && i.price.product.name) || '')) || sub.items.data[0];
        const prod = await stripe(env, 'POST', 'products', { name: 'Always Open ' + plan });
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { items: [{ id: item.id, price_data: { currency: 'usd', unit_amount: PLANS[plan].cents, recurring: { interval: 'month' }, product: prod.id } }], proration_behavior: 'always_invoice', cancel_at_period_end: 'false' });
        await env.DB.batch([
          env.DB.prepare('UPDATE billing SET plan = ?1, updated = ?2 WHERE client_id = ?3').bind(plan, new Date().toISOString(), c.client_id),
          env.DB.prepare('UPDATE app_clients SET tier = ?1 WHERE client_id = ?2').bind(plan, c.client_id)
        ]);
        if (h && h.notify) await h.notify((c.business || 'A client') + ' changed plan', b.plan + ' to ' + plan + ' (in the app).');
        return Response.redirect(SITE + base + '/billing?done=changed', 303);
      }
      if (a === 'cancel') {
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { cancel_at_period_end: 'true' });
        await env.DB.prepare("UPDATE billing SET status = 'canceling', updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id).run();
        if (h && h.notify) await h.notify((c.business || 'A client') + ' canceled', 'Ends at the end of their billing month. Reason: ' + String(f.get('why') || 'not given').slice(0, 300), 'high');
        return Response.redirect(SITE + base + '/billing?done=canceled', 303);
      }
      if (a === 'undo') {
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { cancel_at_period_end: 'false' });
        await env.DB.prepare("UPDATE billing SET status = 'active', updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id).run();
        return Response.redirect(SITE + base + '/billing?done=undone', 303);
      }
    } catch (e) { note = '<p class="err">That did not go through: ' + esc(String(e.message || e).slice(0, 160)) + '. Try again, or message us.</p>'; }
  }
  const status = { active: 'Active', past_due: 'Payment failed: please update your card', paused: 'Paused until ' + (b.paused_until ? new Date(b.paused_until).toDateString() : 'next month'), canceling: 'Ends at the end of this billing month', canceled: 'Canceled' }[b.status] || b.status;
  const btn = (a, label, cls, extra) => `<form method="post" style="display:inline">${extra || ''}<input type="hidden" name="a" value="${a}"><button class="btn ${cls || ''}" type="submit">${label}</button></form>`;
  if (step === 'cancel' && b.status !== 'canceling') {
    const pausable = await canPause(env, b);
    const lower = b.plan === 'Pro' ? 'Growth' : (b.plan === 'Growth' ? 'Starter' : '');
    return page('Before you go', `<h1>Before you go.</h1><p class="sub">Most people who cancel just need a break or a smaller plan. Either is one tap.</p>
${pausable ? `<div class="card"><h2>Take a month off, free</h2><p>Pause billing for one month. Your reviews, records and app stay put, and everything picks up after.</p><div class="acts">${btn('pause', 'Pause for a month', '')}</div></div>` : ''}
${lower ? `<div class="card"><h2>Switch to ${lower}, ${money(PLANS[lower].cents)}/mo</h2><p>${esc(PLANS[lower].blurb)}</p><div class="acts">${btn('plan', 'Switch to ' + lower, 'line', '<input type="hidden" name="plan" value="' + lower + '">')}</div></div>` : ''}
<div class="card"><h2>Still want to cancel?</h2><form method="post" style="display:grid;gap:10px"><input type="hidden" name="a" value="cancel"><label>What could we have done better? (optional)<input name="why" maxlength="300"></label><button class="btn quiet" type="submit">Cancel at the end of this month</button></form><p class="fine">No fee. You keep everything through the end of the month you paid for. Your Google profile, reviews and phone numbers stay yours.</p></div>
<div class="acts"><a class="btn line" href="${esc(base)}/billing">Keep my plan</a></div>`);
  }
  return page('Your plan', `<div><p class="mono">${esc(c.business || '')}</p><h1>Your plan</h1></div>${note}
<div class="card"><h2>${esc(b.plan)}${b.max ? ' + 300 more Max minutes' : ''}</h2><p class="sub">${esc(status)}</p><p>${esc((PLANS[b.plan] || {}).blurb || '')}</p>
<div class="acts">${btn('card', 'Update card or see invoices', 'line')}${b.status === 'paused' ? btn('resume', 'Resume now', '') : ''}${b.status === 'canceling' ? btn('undo', 'Undo cancellation', '') : ''}</div></div>
<div class="card"><h2>Change plan</h2><div class="acts">${Object.keys(PLANS).filter(k => k !== b.plan).map(k => btn('plan', k + ' · ' + money(PLANS[k].cents) + '/mo', 'line', '<input type="hidden" name="plan" value="' + k + '">')).join('')}</div><p class="fine">Changes start now. The difference for the rest of this month is charged now, or credited to your next bill for a smaller plan.</p></div>
${b.status !== 'canceling' && b.status !== 'canceled' ? `<p><a href="${esc(base)}/billing?step=cancel" class="sub">Cancel my plan</a></p>` : ''}
<div class="acts"><a class="btn quiet" href="${esc(base)}">Back to the app</a></div>`);
}

// ---------- router ----------
export async function handleBilling(req, env, url, h) {
  const path = url.pathname;
  if (path === '/start') {
    if (env.STRIPE_KEY) {
      try { await ensureBilling(env); const w = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_id'").first(); if (!w) await setupStripe(env); } catch (e) { /* the page still works; setup retries next load */ }
    }
    return startPage({ plan: url.searchParams.get('plan') || '', ref: url.searchParams.get('ref') || '' });
  }
  if (path === '/welcome') return welcome(env, url, h);
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (path === '/billing/checkout') return checkout(req, env);
  if (path === '/billing/webhook') {
    await ensureBilling(env);
    const body = await req.text();
    const row = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_secret'").first();
    if (!row || !(await verifyStripe(row.v, req.headers.get('stripe-signature'), body))) return new Response('bad signature', { status: 400 });
    const ev = JSON.parse(body), o = ev.data && ev.data.object || {};
    const bySub = async (sub, set, msg) => {
      if (!sub || typeof sub !== 'string') return;
      const b = await env.DB.prepare('SELECT client_id, business FROM billing WHERE sub = ?1').bind(sub).first();
      if (!b) return;
      await env.DB.prepare('UPDATE billing SET status = ?1, updated = ?2 WHERE client_id = ?3').bind(set, new Date().toISOString(), b.client_id).run();
      if (set === 'canceled') { await env.DB.prepare('UPDATE app_clients SET active = 0 WHERE client_id = ?1').bind(b.client_id).run(); await expireCredits(env, { stripe }, b.client_id); await lineEnded(env, b.client_id).catch(() => {}); }
      if (msg && h.notify) await h.notify((b.business || 'A client') + ': ' + msg, 'Stripe event ' + ev.type + '.', set === 'past_due' ? 'high' : 'default');
    };
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') await createFromSession(env, o, h);
    else if (ev.type === 'invoice.payment_failed') await bySub(invoiceSub(o), 'past_due', 'payment failed. Stripe retries automatically and emails them.');
    else if (ev.type === 'invoice.paid' && o.billing_reason !== 'subscription_create') await bySub(invoiceSub(o), 'active', '');
    else if (ev.type === 'customer.subscription.deleted') await bySub(o.id, 'canceled', 'subscription ended. Their app is off.');
    // Stripe's own status after retries run out (unpaid, past_due, paused): kept so the daily check sees it (checks.js).
    else if (ev.type === 'customer.subscription.updated' && /^(active|trialing|past_due|unpaid|paused)$/.test(o.status || '')) await subUpdated(env, o, h);
    else if (ev.type === 'charge.dispute.created' || ev.type === 'charge.dispute.closed') await dispute(env, ev.type, o, h);
    return new Response('ok');
  }
  if (path === '/billing/setup') {
    if (!env.LEADS_KEY || !(await h.sameKey(req.headers.get('x-key') || '', env.LEADS_KEY))) return h.json({ ok: false, error: 'Wrong key.' }, 403);
    if (!env.STRIPE_KEY) return h.json({ ok: false, error: 'No Stripe key yet.' }, 400);
    return h.json(await setupStripe(env), 200);
  }
  return new Response('Not found', { status: 404 });
}

// The subscription id on an invoice: top level in older Stripe versions, under parent in newer ones.
export function invoiceSub(o) {
  const v = o && (o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription));
  return typeof v === 'string' ? v : (v && v.id) || '';
}
// Our status from Stripe's: a pause and a cancellation at the period's end both read "active" in Stripe.
export function statusOf(o) {
  if (o.pause_collection) return 'paused';
  if (o.cancel_at_period_end === true || o.cancel_at_period_end === 'true') return 'canceling';
  return o.status;
}
// A subscription changed in Stripe (by us, by the portal, or by hand in the dashboard): status, plan and the Max add-on.
export async function subUpdated(env, o, h, call) {
  call = call || stripe;
  const b = await env.DB.prepare('SELECT client_id, plan, max, status FROM billing WHERE sub = ?1').bind(o.id).first().catch(() => null);
  if (!b) return;
  const status = statusOf(o);
  let plan = b.plan, max = b.max;
  try {
    const sub = await call(env, 'GET', 'subscriptions/' + o.id + '?expand[]=items.data.price.product');
    const items = (sub.items && sub.items.data) || [];
    const name = i => String((i.price && i.price.product && i.price.product.name) || '');
    max = items.some(i => /Max/.test(name(i))) ? 1 : 0;
    const main = items.find(i => !/Max/.test(name(i)));
    const byName = main && Object.keys(PLANS).find(k => new RegExp('\\b' + k + '\\b').test(name(main)));
    const byCents = main && Object.keys(PLANS).find(k => PLANS[k].cents === +(main.price && main.price.unit_amount));
    plan = byName || byCents || plan;
  } catch (e) { /* the status still updates; the plan waits for the next event or the daily check */ }
  await env.DB.batch([
    env.DB.prepare('UPDATE billing SET status = ?1, plan = ?2, max = ?3, updated = ?4 WHERE client_id = ?5').bind(status, plan, max, new Date().toISOString(), b.client_id),
    env.DB.prepare('UPDATE app_clients SET tier = ?1 WHERE client_id = ?2').bind(plan, b.client_id)
  ]);
  if (plan !== b.plan && h && h.notify) await h.notify('Plan changed in Stripe', b.plan + ' to ' + plan + ' for ' + b.client_id + '.');
}

// A chargeback. The deadline to answer is short and missing it loses the payment and a fee, so Christopher hears the
// same day, with the client's history (calls Max took, replies and posts, months as a client) as the evidence.
export async function dispute(env, type, o, h) {
  let cust = '';
  try { if (o.charge) cust = String((await stripe(env, 'GET', 'charges/' + (typeof o.charge === 'string' ? o.charge : o.charge.id))).customer || ''); } catch (e) { cust = ''; }
  const b = cust ? await env.DB.prepare('SELECT client_id, business, created FROM billing WHERE customer = ?1').bind(cust).first() : null;
  const amt = '$' + ((+o.amount || 0) / 100).toFixed(2), biz = (b && b.business) || 'a customer we could not match';
  if (type === 'charge.dispute.closed') {
    if (h.notify) await h.notify('Chargeback closed: ' + biz, 'The ' + amt + ' dispute closed as "' + (o.status || '?') + '" (won means the money stays with you).', 'default');
    return;
  }
  const due = o.evidence_details && o.evidence_details.due_by ? new Date(o.evidence_details.due_by * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' }) : 'soon';
  let hist = '';
  if (b) {
    const q = async sql => { const r = await env.DB.prepare(sql).bind(b.client_id).first().catch(() => null); return +(r && r.n) || 0; };
    const calls = await q("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam')");
    const done = await q("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND status = 'approved'");
    const months = b.created ? Math.max(1, Math.round((Date.now() - Date.parse(b.created)) / (30 * 864e5))) : 0;
    hist = ' Their history, your evidence: ' + calls + ' calls answered by Max, ' + done + ' replies and posts they approved, ' + months + (months === 1 ? ' month' : ' months') + ' as a client, plus their monthly reports.';
  }
  const why = o.reason ? ' Reason given: ' + String(o.reason).replace(/_/g, ' ') + '.' : '';
  const ops = await import('./ops.js');
  await ops.opsAlert(env, 'stripe-dispute', (b && b.client_id) || '', 'Chargeback: ' + biz + ' disputed ' + amt + '.' + why + ' Answer by ' + due + ' in the Stripe dashboard, Payments, Disputes, or the money and a fee are lost.' + hist);
}

// The webhook endpoint listens for every event in EVENTS. One set up before an event was added gets it here (checks.js
// runs this once a day), so a new event never depends on remembering to change Stripe by hand.
export async function ensureEvents(env, call) {
  call = call || stripe;
  const w = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_id'").first().catch(() => null);
  if (!w || !w.v) return 'no endpoint';
  const ep = await call(env, 'GET', 'webhook_endpoints/' + w.v);
  const have = ep.enabled_events || [];
  if (have.includes('*') || EVENTS.every(e => have.includes(e))) return 'ok';
  await call(env, 'POST', 'webhook_endpoints/' + w.v, { enabled_events: EVENTS });
  return 'added';
}

// One-time Stripe setup (webhook + portal settings). Runs by itself the first time the signup page loads.
export async function setupStripe(env) {
    await ensureBilling(env);
    const out = {};
    const have = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_id'").first();
    if (!have) {
      const w = await stripe(env, 'POST', 'webhook_endpoints', { url: SITE + '/billing/webhook', enabled_events: EVENTS, description: 'Always Open billing', api_version: '2024-06-20' });
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('webhook_id', ?1)").bind(w.id),
        env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('webhook_secret', ?1)").bind(w.secret)
      ]);
      out.webhook = 'created';
    } else out.webhook = 'already set up';
    try {
      const pc = await stripe(env, 'POST', 'billing_portal/configurations', {
        business_profile: { headline: 'Always Open billing', privacy_policy_url: SITE + '/privacy', terms_of_service_url: SITE + '/terms' },
        features: { invoice_history: { enabled: 'true' }, payment_method_update: { enabled: 'true' }, customer_update: { enabled: 'true', allowed_updates: ['email', 'address'] }, subscription_cancel: { enabled: 'false' } },
        default_return_url: SITE
      });
      await env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('portal_id', ?1)").bind(pc.id).run();
      out.portal = 'set up';
    } catch (e) { out.portal = 'error: ' + e.message; }
    const acct = await stripe(env, 'GET', 'account').catch(() => ({}));
    out.account = acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name || acct.business_profile && acct.business_profile.name || '';
    out.live = /^sk_live_|^rk_live_/.test(env.STRIPE_KEY);
    return { ok: true, ...out };
}
