// Self-serve signup and billing with Stripe (no SDK: plain HTTPS calls).
//   GET  /start                 pick a plan and fill in the business
//   POST /billing/checkout      -> Stripe Checkout (monthly subscription)
//   GET  /welcome?s=...         after paying: the private app link and next steps (creates the client if the webhook hasn't yet)
//   POST /billing/webhook       Stripe events: new signups, failed and paid invoices, pauses, plan changes, cancellations
//   POST /billing/setup         (x-key: LEADS_KEY) one-time: creates the Stripe webhook and the customer portal settings
// The client's own billing page (plan, card, pause, change, cancel with offers) lives at /app/<code>/billing (see billingPage).

import { noteSignup, expireCredits, REF_RE } from './referral.js';
import { firstLook } from './firstlook.js';
import { queueLine, provisionLine, lineEnded, forwardingOff, industryOf } from './provision.js';

import { PLANS as FACT_PLANS, MAX as FACT_MAX } from './facts.js';
import { seal, open } from './seal.js';

const SITE = 'https://alwaysopenoffice.com';
// prices and plan wording live in facts.js, the one place they are set
export const PLANS = FACT_PLANS;
const MAX = { cents: FACT_MAX.moreCents, blurb: FACT_MAX.blurb };
// Medical and dental offices are HIPAA covered entities: what Max takes down for them (who called and what they need)
// is patient health information, and we can't sign the business associate agreement that needs, nor get one from
// every company the call passes through (Nov 21, 2026 audit). So they can't sign up online, whatever kind of business
// is picked when the name reads as one. Law offices still can (regulated: Max only takes messages).
export const HEALTH_TYPE = 'Medical or dental office';
const TYPES = ['Contractor or trade', 'Dock, marine or outdoor', 'Salon, spa or fitness', 'Restaurant or shop', 'Insurance agency', 'Law office', HEALTH_TYPE, 'Other'];
const REGULATED = ['Insurance agency', 'Law office', 'Medical, dental or legal', HEALTH_TYPE];
const HEALTH_NAME = /\b(dental|dentists?|dentistry|orthodont\w*|endodont\w*|periodont\w*|oral surgery|pediatrics?|pediatricians?|dermatolog\w*|optometr\w*|ophthalmolog\w*|chiropract\w*|urgent care|family medicine|family practice|physicians?|medical (center|clinic|group|practice|office|associates)|health center|physical therap\w*|occupational therap\w*|speech therap\w*|counsel(ing|ling|ors?|lors?)|mental health|behavioral health|psychiatr\w*|psycholog\w*|psychotherap\w*|pharmac(y|ies|ists?)|home health|hospice|med ?spa|medical spa|botox|hearing aids?|audiolog\w*|podiatr\w*|orthop(a)?ed\w*|eye care|nursing)\b/i;
// Nov 24, 2026 audit: the name decided almost nothing, so physical therapy, counseling, pharmacies, home health and med
// spas signed up as ordinary clients. Looser words (a clinic, therapy, a doctor, or provision.js reading the name as
// medical) count too, except where the rest of the name says it is not a patient's: a car or phone repair "clinic", the
// "lawn doctor", a massage therapist (not a HIPAA office in the ordinary case). Vets and animal hospitals never are, and
// neither are counselors at law. ("psych" alone is left out: it would catch a psychic.)
const HEALTH_LOOSE = /\b(clinics?|therap\w*|doctors?)\b/i;
const NOT_PATIENT = /\b(vets?|veterinar\w*|animals?|pets?|equine|law|legal|attorneys?|lawyers?)\b/i;
const NOT_HEALTH_LOOSE = /\b(cars?|auto\w*|trucks?|phones?|computers?|repairs?|lawn|trees?|massage|golf|bikes?|small engine|drains?|rooter|dent|dryer|vents?|appliances?|plumb\w*|roof\w*|pools?|glass|ac)\b/i;
const TRADE_TYPES = ['Contractor or trade', 'Dock, marine or outdoor', 'Restaurant or shop'];   // a trade's "Drain Doctor" is no doctor
// Nov 24, 2026 audit: an insurance agency, law firm or financial adviser signed up as "Other" came out unregulated (Max
// booking, outbound calls, the map listing). Later that day the operator ruled that the terms win over what facts.js said,
// so tax preparers, accountants, bookkeepers, mortgage and lending offices and payroll services are regulated by name too.
// Whole words only: "Taxidermy", "Syntax", "Accountable Plumbing" and "Loan-a-Tool" are ordinary businesses.
const FINANCE_NAME = /\b(financial advis\w*|wealth|investment advis\w*|credit unions?|tax(es)? (prep\w*|services?)|taxes|accounting|accountants?|cpas?|bookkeep\w*|mortgages?|lend(ing|ers?)|loan officers?|loans|payroll services?|(?<!food |blood )bank|banking)\b/i;
const LAW_NAME = /\b(law|legal|attorneys?|lawyers?|LLP)\b|(&|\band\b).*\bP\.?\s?C\.?$/i;
export const HEALTH_NOTE = 'We aren’t set up to handle patient health information yet, so medical and dental offices can’t sign up online. Call (706) 460-2226 and we’ll tell you when we are.';
// The old combined choice from a page cached before Nov 21: a law office stays a law office, the rest are health offices.
function fixType(type, business) {
  if (type === 'Medical, dental or legal' || type === 'Medical, dental or vet') return /\b(law|legal|attorneys?|lawyers?)\b/i.test(business || '') ? 'Law office' : HEALTH_TYPE;
  return TYPES.includes(type) ? type : 'Other';
}
export function isHealthOffice(type, business) {
  const n = String(business || ''), t = fixType(type, n);
  if (t === HEALTH_TYPE) return true;
  if (NOT_PATIENT.test(n)) return false;
  return HEALTH_NAME.test(n) || (!TRADE_TYPES.includes(t) && (HEALTH_LOOSE.test(n) || industryOf(n, t) === 'medical') && !NOT_HEALTH_LOOSE.test(n));
}
// Regulated (insurance, legal, financial): Max only takes messages, no outbound calls, no map listing by default.
export function isRegulated(type, business) {
  const n = String(business || '').trim(), t = fixType(type, n);
  return REGULATED.includes(t) || /^(insurance|legal)$/.test(industryOf(n, t)) || FINANCE_NAME.test(n) || LAW_NAME.test(n);
}
export const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.payment_failed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted', 'charge.dispute.created', 'charge.dispute.closed'];

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
// Nov 24, 2026: the terms tick box was required but nothing recorded it. The version is the date printed on the public
// terms page (public/terms.html, "Last updated"): change it with that page. It and the time of the tick go into the
// Stripe session and the billing row, so a disputed agreement has its proof.
export const TERMS_VERSION = '2026-11-25';   // Nov 24: the AI line's number, its daily safety limits; Nov 25: the number is kept a year
const colsDone = new WeakSet();
export async function ensureBilling(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS billing (client_id TEXT PRIMARY KEY, session_id TEXT UNIQUE, customer TEXT, sub TEXT, plan TEXT, max INTEGER DEFAULT 0, status TEXT, business TEXT, owner TEXT, email TEXT, phone TEXT, town TEXT, type TEXT, code TEXT, ref TEXT, created TEXT, updated TEXT, paused_until TEXT, hq_synced INTEGER DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)')
  ]);
  if (colsDone.has(env.DB)) return;
  for (const col of ["terms_version TEXT DEFAULT ''", "agreed_at TEXT DEFAULT ''"]) { try { await env.DB.prepare('ALTER TABLE billing ADD COLUMN ' + col).run(); } catch (e) { /* already there */ } }
  colsDone.add(env.DB);
}
const rnd = (n, abc) => { abc = abc || 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(n * 2)); let o = ''; for (const x of b) { if (x < abc.length * Math.floor(256 / abc.length)) o += abc[x % abc.length]; if (o.length === n) break; } return o.length === n ? o : o + rnd(n - o.length, abc); };
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14).replace(/-+$/, '') || 'client';
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

// A billing row whose app row never got written (the request failed between the two): finished here, so a paid signup
// is never left without an app or a line. Otherwise returns the row as it is.
async function finishIfMissing(env, got, h) {
  if (!got || await env.DB.prepare('SELECT 1 AS x FROM app_clients WHERE client_id = ?1').bind(got.client_id).first()) return got;
  await env.DB.prepare("INSERT OR IGNORE INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, '', ?8, 1, ?9, '', ?10)")
    .bind(got.client_id, await sha256hex(got.code), got.ref, got.business || '', String(got.owner || '').split(' ')[0], isRegulated(got.type, got.business) ? 1 : 0, got.phone || '', got.plan, new Date().toISOString(), 'calls').run();
  try { await queueLine(env, got.client_id); if (h && h.later) h.later(provisionLine(env, got.client_id).catch(() => {})); } catch (e) { /* the timer picks it up */ }
  if (h && h.notify) await h.notify('New signup: ' + (got.business || 'a business'), got.plan + ' plan. Their app is live and Max’s line is being set up on its own.');
  return got;
}

// A paid checkout becomes a client with a private app link, right away. Safe to call twice (webhook and welcome page).
// "$1,250", "350", "about 400": whole dollars, $1 to $100,000. Anything else: not given.
export function avgJobOf(x) {
  const d = String(x || '').replace(/\.\d*$/, '').replace(/[^\d]/g, '');
  const n = d ? parseInt(d.slice(0, 7), 10) : 0;
  return n >= 1 && n <= 100000 ? n : 0;
}
export async function createFromSession(env, s, h) {
  await ensureBilling(env);
  const have = await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first();
  if (have) return finishIfMissing(env, have, h);
  const m = s.metadata || {};
  const email = s.customer_email || (s.customer_details && s.customer_details.email) || '';
  // Only the website's own checkout (/start) carries the plan and business. A payment through a Stripe Payment Link (sent
  // by hand) has neither: it is never made into a client or a phone line on its own; Christopher sets it up in HQ.
  // Complete but not paid (a bank debit still clearing, which can fail days later) is not a client yet: the
  // async_payment_succeeded event brings it back here once the money is in (Nov 10).
  if (s.payment_status && !/^(paid|no_payment_required)$/.test(s.payment_status)) return null;
  if (!Object.hasOwn(PLANS, String(m.plan))) {
    const known = email ? await env.DB.prepare('SELECT business FROM billing WHERE lower(email) = lower(?1)').bind(email).first().catch(() => null) : null;
    if (h && h.notify) await h.notify('Payment Link payment: ' + (email || 'no email'), '$' + ((+s.amount_total || 0) / 100).toFixed(2) + ' through a Stripe Payment Link. Nothing was set up on its own: add them in Always Open HQ, or send them alwaysopenoffice.com/start instead.' + (known ? ' Careful: ' + (known.business || 'a client') + ' already pays with this email, so this may be a second subscription.' : ''), 'high');
    return null;
  }
  const plan = m.plan;
  const cid = 'c-' + rnd(10, 'abcdefghjkmnpqrstuvwxyz23456789');
  const code = rnd(32), ref = slug(m.business) + '-' + rnd(4, 'abcdefghjkmnpqrstuvwxyz23456789');
  const now = new Date().toISOString();
  const reg = isRegulated(m.type, m.business) ? 1 : 0;
  // The billing row first, and only the request that wrote it goes on: the webhook and the welcome page often arrive
  // together, and only one of them may make the client and buy the number.
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO billing (client_id, session_id, customer, sub, plan, max, status, business, owner, email, phone, town, type, code, ref, created, updated, terms_version, agreed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?17, ?18)')
    .bind(cid, s.id, s.customer || '', s.subscription || '', plan, m.max === '1' ? 1 : 0, 'active', m.business || '', m.owner || '', email, m.phone || '', m.town || '', m.type || '', code, ref, now, String(m.terms_version || '').slice(0, 20), String(m.agreed_at || '').slice(0, 30)).run();
  if (!(ins.meta && ins.meta.changes)) return finishIfMissing(env, await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first(), h);
  // Nov 24, 2026: OR IGNORE. The other request (webhook or welcome page) can slip in right here, see the billing row
  // with no client yet, and make the client itself (finishIfMissing). A plain INSERT then threw on the unique ref, and
  // if this request was the buyer's welcome page, the buyer's first screen after paying was an error. When the other
  // one made it, it has also told Christopher, so this one does not tell him twice.
  const made = await env.DB.prepare("INSERT OR IGNORE INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, '', ?8, 1, ?9, '', ?10)")
    .bind(cid, await sha256hex(code), ref, m.business || '', String(m.owner || '').split(' ')[0], reg, m.phone || '', plan, now, 'calls').run();
  const mine = !!(made.meta && made.meta.changes);
  // The average job they gave at sign-up: the month report says what after-hours calls were worth from day one (Nov 25, 2026).
  if (mine && avgJobOf(m.avg_job)) {
    try {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_settings (client_id TEXT PRIMARY KEY, avg_job INTEGER DEFAULT 0, win_rate INTEGER DEFAULT 30, updated TEXT)').run();
      await env.DB.prepare('INSERT OR IGNORE INTO app_settings (client_id, avg_job, win_rate, updated) VALUES (?1, ?2, 30, ?3)').bind(cid, avgJobOf(m.avg_job), now).run();
    } catch (e) { /* they can set it in the app */ }
  }
  // the same owner again (lost their link, say): a second number and subscription, so the push says so (Nov 10). The
  // business's name counts too (Nov 24, 2026): a second sign-up with another email and phone got through unflagged.
  const again = await env.DB.prepare("SELECT business FROM billing WHERE client_id != ?1 AND ((?2 != '' AND lower(email) = lower(?2)) OR (?3 != '' AND phone = ?3) OR (?4 != '' AND lower(trim(business)) = lower(?4))) LIMIT 1").bind(cid, email, m.phone || '', String(m.business || '').trim()).first().catch(() => null);
  try { await noteSignup(env, { clientId: cid, ref: m.ref, email, phone: m.phone, business: m.business, source: 'link' }); } catch (e) { /* the signup stands without it */ }
  // Max's line is bought and connected on its own (provision.js); the timer retries if this first try can't finish.
  let first = null;
  try { await queueLine(env, cid); if (h && h.later) { first = provisionLine(env, cid).catch(() => null); h.later(first); } } catch (e) { /* the timer picks it up */ }
  if (mine && h && h.notify) await h.notify('New signup: ' + (m.business || 'a business'), plan + ' plan' + (m.max === '1' ? ' + extra Max minutes' : '') + ', ' + (m.town || '') + '. ' + (m.owner || '') + ', ' + (m.phone || '') + '. Paid by card.' + (again ? ' Already a client as ' + (again.business || 'another business') + ' (same name, email or phone): check this is not a second sign-up by mistake.' : '') + ' Their app is live and Max’s line is being set up on its own.');
  const row = await env.DB.prepare('SELECT * FROM billing WHERE session_id = ?1').bind(s.id).first();
  // The welcome email, once (only the request that wrote the billing row gets here), after the first try at Max's number.
  const mail = (async () => {
    const r = await welcomeMail(env, row, first ? await first : null).catch(e => 'failed: ' + String((e && e.message) || e).slice(0, 120));
    if (r !== 'sent') { try { await (await import('./ops.js')).opsAlert(env, 'mail-send', cid, 'The welcome email to ' + (m.business || 'a new client') + ' did not go out (' + r + '). They have no copy of their private app link: send it to them from Always Open HQ.'); } catch (e) { /* the welcome page showed it */ } }
  })();
  if (h && h.later) h.later(mail); else await mail;
  return row;
}

// Nov 24, 2026: the private app link was shown once on /welcome and never sent, so a buyer who closed the tab (or whose
// bank was still clearing) had no way in until the day-2 nudge, and none at all if the number purchase failed.
export const SUPPORT_PHONE = '(706) 460-2226';
async function welcomeMail(env, b, line) {
  if (!b || !b.email) return 'failed: no email on the signup';
  const { sendNeon } = await import('./clientmail.js'), { neonEmail } = await import('./neonmail.js');
  const link = SITE + '/app/' + b.code, firstName = String(b.owner || '').split(' ')[0], p = PLANS[b.plan] || {};
  const num = line && line.status === 'live' && line.numberText;
  return sendNeon(env, b.email, Object.assign({ subject: 'Your Always Open app' + (b.business ? ' for ' + b.business : '') }, neonEmail({
    tone: 'ok', sign: 'YOU’RE IN', title: (firstName ? 'Welcome, ' + firstName + '.' : 'Welcome.') + ' This is your app.', who: b.business || '',
    preheader: 'Your private app link. Keep this email.',
    doThis: ['Tap the button and save the app to your phone. The link opens your account without a password, so keep it to yourself.'],
    lines: [
      { k: 'Plan', v: b.plan + ', ' + money(p.cents || 0) + ' a month' + (+b.max ? ', plus 300 more Max minutes' : '') },
      num ? { k: 'Max’s number', v: num, ok: true } : { k: 'Max’s number', v: 'Being set up now. It shows up in your app when it is ready.' },
      { k: 'Send calls to Max', v: link + '/help/forwarding' },
      { k: 'Our promise', v: 'Try it for a month. If it’s not worth it, tell us within 30 days and we refund that month.' },
      { k: 'Questions', v: 'Text or call Chris: ' + SUPPORT_PHONE }],
    button: { text: 'Open my app', url: link }
  })));
}

// A client added by hand from Always Open HQ (opshq.js): someone who paid outside the website's checkout, by a Stripe
// Payment Link or a check. The website only makes a client on its own from its own checkout, so until Nov 11, 2026 these
// had to be typed into the database. No Stripe subscription is attached, so the nightly paying-and-served check leaves
// them alone and their plan changes only when it is changed here. A phone number is bought only when asked for
// (o.line): otherwise the owner taps "Set up Max" in their app. Returns the private app link, to send to the owner.
export async function createByHand(env, o) {
  await ensureBilling(env);
  const one = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const business = one(o.business, 80), owner = one(o.owner, 60), email = one(o.email, 120), phone = one(o.phone, 24), town = one(o.town, 60);
  const type = fixType(o.type, business), plan = Object.hasOwn(PLANS, String(o.plan)) ? String(o.plan) : '';
  if (business.length < 2) return { ok: false, error: 'Add the business name.' };
  if (isHealthOffice(type, business)) return { ok: false, error: 'Medical and dental offices can’t be clients yet: we can’t handle patient health information until we can sign a HIPAA business associate agreement.' };
  if (!plan) return { ok: false, error: 'Pick a plan.' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'That email does not look right.' };
  const dup = await env.DB.prepare("SELECT client_id, business FROM billing WHERE lower(business) = lower(?1) AND COALESCE(status, '') != 'canceled'").bind(business).first().catch(() => null);
  if (dup) return { ok: false, error: (dup.business || business) + ' is already a client.' };
  const cid = 'c-' + rnd(10, 'abcdefghjkmnpqrstuvwxyz23456789'), code = rnd(32), ref = slug(business) + '-' + rnd(4, 'abcdefghjkmnpqrstuvwxyz23456789');
  const now = new Date().toISOString(), reg = isRegulated(type, business) ? 1 : 0, line = o.line === true && !reg;
  await env.DB.prepare("INSERT INTO billing (client_id, session_id, customer, sub, plan, max, status, business, owner, email, phone, town, type, code, ref, created, updated, hq_synced) VALUES (?1, ?2, '', '', ?3, 0, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, 1)")
    .bind(cid, 'hand:' + cid, plan, business, owner, email, phone, town, type, code, ref, now).run();
  await env.DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, owner_first, regulated, banned, phone, review_link, tier, active, updated, qr, feats) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, '', ?8, 1, ?9, '', ?10)")
    .bind(cid, await sha256hex(code), ref, business, owner.split(' ')[0], reg, phone, plan, now, line ? 'calls' : '').run();
  if (line) { try { await queueLine(env, cid); } catch (e) { /* the owner can still tap Set up Max */ } }
  return { ok: true, clientId: cid, business, plan, line, regulated: !!reg, link: 'https://alwaysopenoffice.com/app/' + code };
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
  const plan = Object.hasOwn(PLANS, String(v.plan)) ? v.plan : 'Growth';
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
<label>Kind of business<select name="type" id="type">${TYPES.map(t => `<option${t === v.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
<p class="err" id="hnote"${v.type === HEALTH_TYPE ? '' : ' hidden'}>${esc(HEALTH_NOTE)}</p>
<label>Your average job, roughly <span class="sub">(optional)</span><input name="avg_job" inputmode="numeric" maxlength="8" placeholder="$350" value="${esc(v.avg_job)}"></label>
<p class="fine" style="margin-top:-6px">Your monthly report turns the calls Max catches after hours into dollars with it. Change it any time in the app.</p>
<script>document.getElementById('type').addEventListener('change',function(){document.getElementById('hnote').hidden=this.value!==${JSON.stringify(HEALTH_TYPE)};});</script>
${REF_RE.test(v.ref || '') ? '<input type="hidden" name="ref" value="' + esc(v.ref) + '">' : ''}
<label class="opt"><input type="checkbox" name="agree" value="1" required><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>, and authorize monthly charges until I cancel.</span></label>
<button class="btn" type="submit">Continue to secure payment</button>
<p class="fine">Payment is handled by Stripe. We never see your card number.</p></form>`);
}

async function checkout(req, env) {
  const f = await req.formData();
  const v = {}; for (const k of ['plan', 'max', 'business', 'owner', 'phone', 'email', 'town', 'type', 'agree', 'ref', 'avg_job']) v[k] = String(f.get(k) || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 120);
  if (!Object.hasOwn(PLANS, String(v.plan))) v.plan = 'Growth';
  v.type = fixType(v.type, v.business);
  if (isHealthOffice(v.type, v.business)) return startPage(v, HEALTH_NOTE);
  if (!v.business || !v.owner || v.phone.replace(/\D/g, '').length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || !v.town) return startPage(v, 'Please fill in every box.');
  if (v.agree !== '1') return startPage(v, 'Please check the box to agree to the terms.');
  if (!env.STRIPE_KEY) return startPage(v, 'Online signup is not open yet. Call (706) 460-2226 or request the free audit, and we will set you up.');
  const items = [{ price_data: { currency: 'usd', unit_amount: PLANS[v.plan].cents, recurring: { interval: 'month' }, product_data: { name: 'Always Open ' + v.plan } }, quantity: 1 }];
  if (v.max === '1') items.push({ price_data: { currency: 'usd', unit_amount: MAX.cents, recurring: { interval: 'month' }, product_data: { name: 'More Max minutes' } }, quantity: 1 });
  const meta = { plan: v.plan, max: v.max === '1' ? '1' : '0', business: v.business, owner: v.owner, phone: v.phone, town: v.town, type: v.type, terms_version: TERMS_VERSION, agreed_at: new Date().toISOString() };
  if (REF_RE.test(v.ref || '')) meta.ref = v.ref;
  const avg = avgJobOf(v.avg_job); if (avg) meta.avg_job = String(avg);
  try {
    const s = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'subscription', line_items: items, customer_email: v.email, metadata: meta, subscription_data: { metadata: meta },
      allow_promotion_codes: 'true', billing_address_collection: 'auto',
      success_url: SITE + '/welcome?s={CHECKOUT_SESSION_ID}', cancel_url: SITE + '/start?plan=' + encodeURIComponent(v.plan) + (meta.ref ? '&ref=' + encodeURIComponent(meta.ref) : '')
    });
    return Response.redirect(s.url, 303);
  } catch (e) {
    // Nov 24, 2026: the buyer saw Stripe's own error text and nobody heard. Now Chris does, and the buyer gets a plain line.
    try { await (await import('./ops.js')).opsAlert(env, 'stripe-checkout', '', 'A buyer could not start paying (' + v.plan + ' plan, ' + v.business + '): Stripe said ' + String(e.message || e).slice(0, 200)); } catch (x) { /* the page still answers */ }
    return startPage(v, 'Payment could not start. Try again in a minute, or call ' + SUPPORT_PHONE + '.');
  }
}

async function welcome(env, url, h) {
  const id = url.searchParams.get('s') || '';
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id) || !env.STRIPE_KEY) return page('Welcome', '<h1>Welcome.</h1><p class="sub">We could not find that signup. Email hello@alwaysopenoffice.com and we will sort it out.</p>', 404);
  let s;
  try { s = await stripe(env, 'GET', 'checkout/sessions/' + id); } catch (e) { if (e && (e.status === 404 || e.status === 400)) return page('Welcome', '<h1>Welcome.</h1><p class="sub">We could not find that signup. Email hello@alwaysopenoffice.com and we will sort it out.</p>', 404); return page('Welcome', '<h1>Almost there.</h1><p class="sub">We could not confirm the payment yet. Refresh this page in a minute.</p>', 502); }
  if (s.status === 'complete' && s.payment_status && !/^(paid|no_payment_required)$/.test(s.payment_status)) return page('Welcome', '<h1>Your payment is on its way.</h1><p class="sub">Your bank is still clearing it. As soon as it lands we set everything up and email your private app link. Questions? Email hello@alwaysopenoffice.com.</p>', 202);
  if (s.status !== 'complete') return page('Welcome', '<h1>Payment not finished.</h1><p class="sub">Nothing was charged. <a href="/start">Start again</a>.</p>', 402);
  const b = await createFromSession(env, s, h);
  if (!b) return page('Welcome', '<h1>Thank you.</h1><p class="sub">Your payment went through. Chris will be in touch within one business day to set everything up. Questions? Email hello@alwaysopenoffice.com or call (706) 460-2226.</p>');
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
${line && line.status === 'live' ? `<div class="card"><h2>3. Max is ready</h2><p>Max, your phone assistant, has his own number for you: <b>${esc(line.numberText)}</b>. Forward the calls you miss to it and he answers them, any hour. Your phone still rings first.</p><div class="acts"><a class="btn" href="${esc(link)}/help/forwarding">Show me how to forward</a></div><p class="fine">The steps for Verizon, AT&amp;T, T-Mobile and landlines are also in your app, under Your first hour.</p></div>` : (line && line.status === 'failed' ? `<div class="card"><h2>3. Max</h2><p>Max, your phone assistant, comes with your plan. His number is taking longer than usual to set up. We keep trying on our own, and it shows up in your app as soon as it’s ready, with the steps to forward the calls you miss to him. Nothing for you to do.</p></div>` : `<div class="card"><h2>3. Max</h2><p>Max, your phone assistant, comes with your plan. His number is being set up right now and shows up in your app in a few minutes, with the steps to forward the calls you miss to him.</p></div>`)}
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
  // Nov 24, 2026: "try it for a month, and if it's not worth it we refund it" was dropped at cancel: inside the first 30
  // days the screen, the confirmation and Chris's push say so. The refund itself stays Chris's to make.
  const startMs = Date.parse(b.created || ''), refundable = startMs > 0 && Date.now() - startMs < 30 * 864e5;
  const REFUND_LINE = 'You are within your first 30 days, so your first month is refundable. Chris refunds it within one business day.';
  let note = url.searchParams.get('done') ? '<p class="ok">' + esc({ paused: 'Paused. Your next month is free and nothing else changes.', resumed: 'Welcome back. Billing picks up on your next date.', changed: 'Done. Your new plan starts now. The difference for the rest of this month was charged, or credited to your next bill.', canceled: 'Your plan ends at the end of this billing month. You can undo that here until then.' + (refundable ? ' ' + REFUND_LINE : ''), undone: 'Cancellation undone. Nothing changes.' }[url.searchParams.get('done')] || '') + '</p>' : '';
  if (req.method === 'POST') {
    const f = await req.formData(), a = String(f.get('a') || '');
    try {
      if (a === 'card') {
        const cfg = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'portal_id'").first();
        const open = id => stripe(env, 'POST', 'billing_portal/sessions', { customer: b.customer, return_url: SITE + base + '/billing', configuration: id || undefined });
        let ps;
        try { ps = await open(cfg ? cfg.v : ''); }
        catch (e) { if (!(cfg && /no such configuration/i.test(String(e.message || '')))) throw e; ps = await open(await makePortal(env)); }   // made with another key: made again, tried once more
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
        const rs = await stripe(env, 'POST', 'subscriptions/' + b.sub, { pause_collection: '' });
        await env.DB.prepare("UPDATE billing SET status = ?3, paused_until = NULL, updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id, String(statusOf(rs) || 'active')).run();
        return Response.redirect(SITE + base + '/billing?done=resumed', 303);
      }
      if (a === 'plan') {
        const plan = String(f.get('plan') || '');
        if (!Object.hasOwn(PLANS, plan) || plan === b.plan) return Response.redirect(SITE + base + '/billing', 303);
        const sub = await stripe(env, 'GET', 'subscriptions/' + b.sub + '?expand[]=items.data.price.product');
        const item = (sub.items.data || []).find(i => !/Max/.test((i.price && i.price.product && i.price.product.name) || '')) || sub.items.data[0];
        const prod = await stripe(env, 'POST', 'products', { name: 'Always Open ' + plan });
        await stripe(env, 'POST', 'subscriptions/' + b.sub, { items: [{ id: item.id, price_data: { currency: 'usd', unit_amount: PLANS[plan].cents, recurring: { interval: 'month' }, product: prod.id } }], proration_behavior: 'always_invoice', cancel_at_period_end: 'false', payment_behavior: 'error_if_incomplete' });   // a declined card refuses the change (Nov 10: Pro stuck at Starter's price)
        await env.DB.batch([
          env.DB.prepare('UPDATE billing SET plan = ?1, updated = ?2 WHERE client_id = ?3').bind(plan, new Date().toISOString(), c.client_id),
          env.DB.prepare('UPDATE app_clients SET tier = ?1 WHERE client_id = ?2').bind(plan, c.client_id)
        ]);
        if (h && h.notify) await h.notify((c.business || 'A client') + ' changed plan', b.plan + ' to ' + plan + ' (in the app).');
        return Response.redirect(SITE + base + '/billing?done=changed', 303);
      }
      if (a === 'cancel') {
        const cs = await stripe(env, 'POST', 'subscriptions/' + b.sub, { cancel_at_period_end: 'true' });
        await env.DB.prepare("UPDATE billing SET status = 'canceling', updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id).run();
        const why = 'Reason: ' + String(f.get('why') || 'not given').slice(0, 300);
        if (h && h.notify) {
          if (refundable) {
            const plan = (PLANS[b.plan] || {}).cents || 0, add = +b.max ? MAX.cents : 0;
            const by = new Date(startMs + 30 * 864e5).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
            await h.notify('REFUND DUE: ' + (c.business || 'A client') + ' canceled in the first month', (c.business || 'A client') + ' canceled within the 30 days, so the first month is theirs back: ' + money(plan) + ' for ' + b.plan + (add ? ' + ' + money(add) + ' for more Max minutes, ' + money(plan + add) + ' in all' : '') + ' (check the first invoice in Stripe). The 30 days end ' + by + '. They were told you refund it within one business day: Stripe, Payments, the first payment, Refund. ' + why, 'high');
          } else await h.notify((c.business || 'A client') + ' canceled', 'Ends at the end of their billing month. ' + why, 'high');
        }
        // the owner: turn forwarding off when the plan ends (Stripe's period end, else the next monthly date from signup)
        try {
          const it0 = cs && cs.items && cs.items.data && cs.items.data[0];
          let endMs = (+(cs && cs.current_period_end) || +(it0 && it0.current_period_end) || 0) * 1000;
          if (!endMs) { const e = new Date(startMs > 0 ? startMs : Date.now()); while (e.getTime() <= Date.now()) e.setUTCMonth(e.getUTCMonth() + 1); endMs = e.getTime(); }
          await forwardingOff(env, c.client_id, 'cancel', endMs + (await import('./provision.js')).KEEP_DAYS * 864e5, endMs);
        } catch (e) { /* told again when the plan ends */ }
        return Response.redirect(SITE + base + '/billing?done=canceled', 303);
      }
      if (a === 'undo') {
        const rs = await stripe(env, 'POST', 'subscriptions/' + b.sub, { cancel_at_period_end: 'false' });
        await env.DB.prepare("UPDATE billing SET status = ?3, updated = ?1 WHERE client_id = ?2").bind(new Date().toISOString(), c.client_id, String(statusOf(rs) || 'active')).run();
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
<div class="card"><h2>Still want to cancel?</h2><form method="post" style="display:grid;gap:10px"><input type="hidden" name="a" value="cancel"><label>What could we have done better? (optional)<input name="why" maxlength="300"></label><button class="btn quiet" type="submit">Cancel at the end of this month</button></form>${refundable ? '<p><b>' + esc(REFUND_LINE) + '</b></p>' : ''}<p class="fine">No fee. You keep everything through the end of the month you paid for. Your Google profile and reviews stay yours. Max’s number stops answering when the plan ends and is let go 60 days later.</p></div>
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
    // from a trade page (?from=plumbing): the kind of business is picked already
    const FROM = { plumbing: 'Contractor or trade', hvac: 'Contractor or trade', builders: 'Contractor or trade', 'auto-repair': 'Contractor or trade', marine: 'Dock, marine or outdoor', marinas: 'Dock, marine or outdoor', salons: 'Salon, spa or fitness', restaurants: 'Restaurant or shop', dental: HEALTH_TYPE, insurance: 'Insurance agency' };
    return startPage({ plan: url.searchParams.get('plan') || '', ref: url.searchParams.get('ref') || '', type: FROM[url.searchParams.get('from') || ''] || '' });
  }
  if (path === '/welcome') return welcome(env, url, h);
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (path === '/billing/checkout') return checkout(req, env);
  if (path === '/billing/webhook') {
    await ensureBilling(env);
    const body = await req.text();
    const secret = await webhookSecret(env, 'billing');
    if (!secret || !(await verifyStripe(secret, req.headers.get('stripe-signature'), body))) {
      // Nov 24, 2026: a 400 raises nothing in index.js, so a secret that no longer opens (STRIPE_KEY replaced) turned
      // away every paid signup in silence. With a sealed secret on file, a refusal is said (opsAlert holds repeats back).
      const sealed = await env.DB.prepare("SELECT 1 AS x FROM billing_config WHERE k = 'webhook_secret_sealed'").first().catch(() => null);
      if (sealed) { try { await (await import('./ops.js')).opsAlert(env, 'stripe-webhook', '', !secret ? 'Stripe events are being refused: the saved webhook signing secret will not open, so STRIPE_KEY was probably replaced. The 10-minute job makes a new endpoint and catches up paid signups; check Stripe, Webhooks, recent deliveries.' : 'A Stripe event was refused for a bad signature. If Stripe shows failed deliveries, the webhook signing secret no longer matches.'); } catch (e) { /* the 400 still goes */ } }
      return new Response('bad signature', { status: 400 });
    }
    const ev = JSON.parse(body), o = ev.data && ev.data.object || {};
    const bySub = async (sub, set, msg) => {
      if (!sub || typeof sub !== 'string') return;
      const b = await env.DB.prepare('SELECT client_id, business FROM billing WHERE sub = ?1').bind(sub).first();
      if (!b) return;
      await env.DB.prepare('UPDATE billing SET status = ?1, updated = ?2 WHERE client_id = ?3').bind(set, new Date().toISOString(), b.client_id).run();
      if (set === 'canceled') { await env.DB.prepare('UPDATE app_clients SET active = 0 WHERE client_id = ?1').bind(b.client_id).run(); await expireCredits(env, { stripe }, b.client_id); await lineEnded(env, b.client_id).catch(() => {}); }
      if (msg && h.notify) await h.notify((b.business || 'A client') + ': ' + msg, 'Stripe event ' + ev.type + '.', set === 'past_due' ? 'high' : 'default');
    };
    if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o.mode === 'subscription') await createFromSession(env, o, h);
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
  // the extra minutes changing: noted per month, so last month's overage is billed against what they had then (minutes.js)
  if (+max !== +b.max) { try { await (await import('./minutes.js')).noteAddon(env, b.client_id, +max === 1, Date.now()); } catch (e) { /* the 10-minute job marks months too */ } }
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
  await ops.opsAlert(env, 'stripe-dispute', ((b && b.client_id) || '') + ':' + String(o.id || ''), 'Chargeback: ' + biz + ' disputed ' + amt + '.' + why + ' Answer by ' + due + ' in the Stripe dashboard, Payments, Disputes, or the money and a fee are lost.' + hist);
}

// ---------- Stripe's webhook signing secrets ----------
// Two endpoints: billing (Always Open's own subscriptions) and connect (clients' own card payments, biz.js).
// Nov 21, 2026 audit: their signing secrets sat in billing_config in plain text, where anything that can read the
// database (a backup copy, a database tool, the HQ code that shares it) could forge Stripe's events: a fake "paid"
// signup, a fake cancellation. Now only a sealed copy is kept (seal.js; its key comes from STRIPE_KEY, which never
// touches the database), and sealWebhooks below replaces any endpoint whose secret was ever kept in plain text.
export const CONNECT_EVENTS = ['account.updated', 'checkout.session.completed'];
const HOOKS = {
  billing: { id: 'webhook_id', secret: 'webhook_secret', spec: () => ({ url: SITE + '/billing/webhook', enabled_events: EVENTS, description: 'Always Open billing', api_version: '2024-06-20' }) },
  connect: { id: 'connect_webhook_id', secret: 'connect_webhook_secret', spec: () => ({ url: SITE + '/stripe/webhook', connect: 'true', enabled_events: CONNECT_EVENTS, description: 'Always Open client payments' }) }
};
// Keeps a new endpoint: its id, and its secret sealed. A plain-text secret from before is removed in the same step.
export async function saveWebhook(env, which, w) {
  const h = HOOKS[which];
  if (!h || !w || !w.id || !w.secret) throw new Error('Stripe gave no ' + which + ' webhook endpoint');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO billing_config (k, v) VALUES (?1, ?2)').bind(h.id, w.id),
    env.DB.prepare('INSERT OR REPLACE INTO billing_config (k, v) VALUES (?1, ?2)').bind(h.secret + '_sealed', await seal(env, h.secret, w.secret)),
    env.DB.prepare('DELETE FROM billing_config WHERE k = ?1').bind(h.secret)
  ]);
}
// The signing secret of one endpoint ('billing' or 'connect'), or '' when there is none or it can't be opened. Then
// sealWebhooks makes a new endpoint within 10 minutes, and what was missed meanwhile is caught up anyway: a new
// signup by catchUp (then, and daily) or its welcome page, a status change by the daily Stripe check (checks.js payingServed).
export async function webhookSecret(env, which) {
  const h = HOOKS[which || 'billing'];
  const rows = ((await env.DB.prepare('SELECT k, v FROM billing_config WHERE k IN (?1, ?2)').bind(h.secret + '_sealed', h.secret).all().catch(() => ({}))).results) || [];
  const sealed = rows.find(r => r.k === h.secret + '_sealed'), plain = rows.find(r => r.k === h.secret);
  if (sealed) { try { return await open(env, h.secret, sealed.v); } catch (e) { return ''; } }
  return plain ? plain.v : '';   // a secret saved before Nov 21, 2026, until sealWebhooks replaces its endpoint
}
// Every 10 minutes (index.js). An endpoint whose secret is in plain text, or whose sealed secret can't be opened (STRIPE_KEY
// was replaced), gets a new endpoint with the same settings and a new secret, kept sealed; then the old endpoint is
// deleted at Stripe, so the old secret signs nothing anymore. Nobody has to touch the Stripe dashboard.
// A plain-text secret is only replaced 15 minutes after this code first runs: a deploy rolled back in its first minutes
// goes back to code that only knows the plain secret. An already-sealed endpoint costs one database read, no Stripe call.
export const SEAL_WAIT_MS = 15 * 60000;
export async function sealWebhooks(env, call, now) {
  if (!env.STRIPE_KEY) return 'no stripe';
  call = call || stripe; now = now || Date.now();
  const got = await env.DB.prepare("SELECT k, v FROM billing_config WHERE k LIKE '%webhook%' OR k = 'seal_seen'").all().catch(() => null);
  if (!got) return 'no billing set up';
  const cfg = Object.fromEntries((got.results || []).map(r => [r.k, r.v]));
  const del = k => env.DB.prepare('DELETE FROM billing_config WHERE k = ?1').bind(k).run();
  const out = [];
  let any = false, rekeyed = false;
  for (const [which, h] of Object.entries(HOOKS)) {
    // an old endpoint Stripe didn't delete last time (it was down): it is still signing with the old secret
    if (cfg[h.id + '_old']) {
      try { await call(env, 'DELETE', 'webhook_endpoints/' + cfg[h.id + '_old']); await del(h.id + '_old'); out.push(which + ': old endpoint deleted'); }
      catch (e) { if (e.status === 404) await del(h.id + '_old'); else out.push(which + ': old endpoint still there (' + (e.message || e) + ')'); }
    }
    const id = cfg[h.id];
    if (!id) continue;
    any = true;
    const sealed = cfg[h.secret + '_sealed'], plain = cfg[h.secret];
    const opens = sealed ? await open(env, h.secret, sealed).then(() => true, () => false) : false;
    if (opens) { if (plain) await del(h.secret); continue; }
    if (plain && !sealed) {
      // the wait starts at this code's first run; a mark hours old with the plain secret still there means this code
      // was rolled back and has just come back, so the wait starts over
      const seen = +cfg.seal_seen || 0, fresh = !seen || now - seen > 2 * 3600e3;
      if (fresh) { await env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('seal_seen', ?1)").bind(String(now)).run(); cfg.seal_seen = String(now); }
      if (fresh || now - seen < SEAL_WAIT_MS) { out.push(which + ': waiting to replace'); continue; }
    }
    if (which === 'billing' && sealed) rekeyed = true;   // the sealed secret stopped opening: STRIPE_KEY was replaced
    // the new endpoint copies the old one's settings (address, events, description, event version)
    let cur = null;
    try { cur = await call(env, 'GET', 'webhook_endpoints/' + id); } catch (e) { if (e.status !== 404) throw e; }
    const spec = h.spec();
    if (cur) {
      if (cur.url) spec.url = cur.url;
      if (Array.isArray(cur.enabled_events) && cur.enabled_events.length) spec.enabled_events = cur.enabled_events;
      if (cur.description) spec.description = cur.description;
      if (cur.api_version) spec.api_version = cur.api_version;
    }
    // the same key on a retry gets the same endpoint back, so a timeout here never leaves two
    const w = await call(env, 'POST', 'webhook_endpoints', spec, 'seal-' + which + '-' + id);
    await saveWebhook(env, which, w);
    if (cur && cur.status === 'disabled') await call(env, 'POST', 'webhook_endpoints/' + w.id, { disabled: 'true' }).catch(() => {});
    if (cur) {
      try { await call(env, 'DELETE', 'webhook_endpoints/' + id); }
      catch (e) { if (e.status !== 404) { await env.DB.prepare('INSERT OR REPLACE INTO billing_config (k, v) VALUES (?1, ?2)').bind(h.id + '_old', id).run(); out.push(which + ': replaced, old endpoint not deleted yet'); continue; } }
    }
    out.push(which + ': replaced');
  }
  // Nov 24, 2026: while the old secret would not open, every event was refused, and Stripe's retries die with the old
  // endpoint. A buyer who paid and never reached /welcome had no account: the paid sessions of the last 3 days are
  // made into clients now.
  if (rekeyed) {
    try { await makePortal(env, call); out.push('billing: portal settings made again'); } catch (e) { out.push('billing: portal settings not made (' + (e.message || e) + '), the card page makes them'); }
    try { const n = await catchUp(env, { notify: async (t, b, pr) => { try { await (await import('./app.js')).opsPing(env, t, b, pr || 'default', 'moneybag'); } catch (e) {} } }, call); out.push('billing: ' + n + ' paid signups caught up'); }
    catch (e) { out.push('billing: catch-up failed (' + (e.message || e) + '), the daily check tries again'); }
  }
  return out.join('; ') || (any ? 'sealed' : 'no endpoints');
}

// Paid checkouts of the last 3 days that have no billing row yet become clients (createFromSession claims each one
// with INSERT OR IGNORE, so a webhook or welcome page at the same moment still makes one). Run when the webhook was
// replaced after a key change, and once a day from checks.js payingServed whatever the cause. Returns how many.
export async function catchUp(env, h, call) {
  call = call || stripe; h = h || {};
  await ensureBilling(env);
  const since = Math.floor(Date.now() / 1000) - 3 * 86400, jobs = [];
  const hh = Object.assign({}, h, { later: p => jobs.push(p) });
  let after = '', pages = 0, made = 0;
  do {
    const j = await call(env, 'GET', 'checkout/sessions?limit=100&status=complete&created%5Bgte%5D=' + since + (after ? '&starting_after=' + encodeURIComponent(after) : ''));
    const list = (j && j.data) || [];
    for (const s of list) {
      if (!s || s.mode !== 'subscription' || (s.payment_status && !/^(paid|no_payment_required)$/.test(s.payment_status))) continue;
      if (!Object.hasOwn(PLANS, String((s.metadata || {}).plan))) continue;   // a Payment Link: pushed once by its own event, set up by hand
      if (await env.DB.prepare('SELECT 1 AS x FROM billing WHERE session_id = ?1').bind(s.id).first()) continue;
      if (await createFromSession(env, s, hh)) made++;
    }
    after = j && j.has_more && list.length ? list[list.length - 1].id : '';
  } while (after && ++pages < 5);
  await Promise.all(jobs.map(p => Promise.resolve(p).catch(() => {})));
  return made;
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

// The customer portal's settings ("Update card or see invoices"). Stripe keeps them per key and mode, so after STRIPE_KEY
// changes (a rotation, test to live) the saved id answers "No such configuration": they are made again then (Nov 24, 2026).
export async function makePortal(env, call) {
  const pc = await (call || stripe)(env, 'POST', 'billing_portal/configurations', {
    business_profile: { headline: 'Always Open billing', privacy_policy_url: SITE + '/privacy', terms_of_service_url: SITE + '/terms' },
    features: { invoice_history: { enabled: 'true' }, payment_method_update: { enabled: 'true' }, customer_update: { enabled: 'true', allowed_updates: ['email', 'address'] }, subscription_cancel: { enabled: 'false' } },
    default_return_url: SITE
  });
  if (!pc || !pc.id) throw new Error('Stripe gave no portal settings');
  await env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('portal_id', ?1)").bind(pc.id).run();
  return pc.id;
}

// One-time Stripe setup (webhook + portal settings). Runs by itself the first time the signup page loads.
export async function setupStripe(env) {
    await ensureBilling(env);
    const out = {};
    const have = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_id'").first();
    if (!have) {
      const w = await stripe(env, 'POST', 'webhook_endpoints', HOOKS.billing.spec());
      await saveWebhook(env, 'billing', w);
      out.webhook = 'created';
    } else out.webhook = 'already set up';
    try { await makePortal(env); out.portal = 'set up'; } catch (e) { out.portal = 'error: ' + e.message; }
    const acct = await stripe(env, 'GET', 'account').catch(() => ({}));
    out.account = acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name || acct.business_profile && acct.business_profile.name || '';
    out.live = /^sk_live_|^rk_live_/.test(env.STRIPE_KEY);
    return { ok: true, ...out };
}
