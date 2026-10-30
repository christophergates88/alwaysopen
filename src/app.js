// Always Open for clients: a private app per client at /app/<code>, used by the web page and the iPhone app.
// The code is a long random secret; D1 keeps only its SHA-256 (app_clients.code_hash), so a database copy can't open anyone's app.
// Always Open HQ (the artifact) keeps D1 in step through the Cloudflare connector: it writes clients, drafts and month numbers,
// and reads back approvals, messages, finished jobs and photos. Approvals ping Christopher's phone right away (ntfy).
// Every 10 minutes the cron sends iPhone notifications for new drafts and new replies from Always Open (when APNs is set up).
import { opsAlert } from './ops.js';
import { DISCLOSURE } from './disclosure.js';
import { EmailMessage } from 'cloudflare:email';
import { apiVersions, versionsOn, queueReviewRequest, sendReviewRequest, reviewReqValid } from './reviews.js';
import { billingPage } from './billing.js';
import { helpPage } from './onboard.js';
import { referralState } from './referral.js';
import { appHtml } from './apppage.js';
import { gcalStatus } from './gcal.js';
import { apiInvoice, invoicesFor, metaStatus, sendInvoiceReminder, metaPublish } from './extras.js';
import { apiImport, apiRevive, pastState } from './past.js';
import { apiRivals, rivalsState } from './rivals.js';
import { lostState } from './lost.js';
import { callbackState, apiCallbacks } from './callbacks.js';
import { apiHandoff, handoffState } from './handoff.js';
import { apiCheckins, checkinState, scheduleCheckin } from './checkin.js';
import { apiAnswer, answerState } from './answerrate.js';
import { apiFullMax, fullMaxState } from './fullmax.js';
import { upgradesState } from './upgrades.js';
import { textingPage, textingState } from './a2p.js';
import { apiFirstLook, firstLookDue, shareState } from './firstlook.js';
import { langOf, langBar, t as tr, bizState, finishOnboarding, apiWork, apiQuote, apiStripe, apiInbox, inboxApi, insightsApi, apiTeam, apiPrefs, markOnboard, staffRole, logAct, actText, MONEY_ROUTES, weeklyLine, weeklyNumbers } from './biz.js';

import { apiMap, mapState } from './map.js';
import { monthAnalytics } from './insights.js';
import { renderMonthPage } from './monthpage.js';
import { ensureAuto, autoReady, autoCron, autoNote, autoFail } from './autotext.js';
import { publishItem, mergeMonths } from './gbp.js';
import { lineStatus } from './provision.js';
import { FACT_KEYS, cleanFacts, knowOut, startInterview, applyPending } from './interview.js';
import { dialOut } from './callbacks.js';
import { bookingOut, cleanBooking } from './availability.js';
import { VOICES, voiceKeyOf, voicesOut, cleanName } from './voices.js';

const CODE_RE = /^[A-Za-z0-9]{24,64}$/;
const FAIL_LIMIT = 20;            // wrong codes per sender per hour, then a pause
const MSG_PER_HOUR = 20;
const JOBS_PER_DAY = 60;
const PHOTOS_PER_DAY = 20;
const PHOTO_MAX = 1572864;        // 1.5 MB after the app shrinks it
const PUSH_GAP_MS = 10 * 60000;   // at most one "approved" ping per client per 10 minutes
const RAW_ROUTES = new Set(['/api/photo', '/api/greeting-audio']);   // image and audio bodies, not JSON
const BODY_MAX = 1600000;         // the largest JSON body any route takes (a past-customer list, past.js)
const BUNDLE = 'com.christophergates.alwaysopen';
const TEAM = 'Z44959336K';
const SITE = 'https://alwaysopenoffice.com';
const H = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// ---------- Compliance Guard (same rules as Always Open HQ) ----------
export const CG_RULES = [
  { why: 'Promises an outcome', kinds: 'all', re: /\b(guarantee[sd]?|guaranteed|promise[sd]?|100 ?%|always covered|never (be )?denied|risk[- ]free)\b|garantiz\w*/i },
  { why: 'Talks about rates or prices', kinds: 'all', re: /\$\s?\d|\b\d+(\.\d+)?\s?%|\b(lowest|cheapest|best|great|low|lower|competitive|affordable) (rates?|prices?|premiums?)\b|\bsave (money|you|up to|big)\b|\bdiscounts?\b|\bquotes?\b|\bdescuentos?\b|\bahorr\w+/i },
  { why: 'Confirms they are a client', kinds: 'reply', re: /\byour (policy|policies|claim|account|coverage|premium|renewal|agent|deductible|plan|bill)\b|\bas (our|a valued) (client|customer|policyholder|patient)\b|\bthank(s| you) for being (a|our) (loyal |valued )?(client|customer|policyholder|patient)\b|\bwe insure you\b|\bsu (p[oó]liza|reclamo|reclamaci[oó]n|cuenta|cobertura|prima|agente)\b/i },
  { why: 'Mentions claim details', kinds: 'reply', re: /\bclaim (number|#|was|has been|is|got)\b|\badjuster\b|\bsettlement\b|\bpayout\b|\bwe paid\b|\bdenied\b|\bdeductible\b/i },
  { why: 'Sounds like advice', kinds: 'all', re: /\byou should (buy|get|add|switch|increase|raise|drop|carry)\b|\byou need (to (buy|add|switch|increase|carry)|more coverage|umbrella)\b|\b(we|i) recommend (you|that you)\b/i },
  { why: 'Testimonial about an outcome', kinds: 'post', re: /\bsaved (me|us|them)\b|\bgot (me|us) a better\b|\bcut (my|our) (bill|premium)\b/i }
];
// For every business (not only regulated ones): the baseline Compliance Guard.
export const CG_ALL = [
  { why: 'Promises a ranking or "the best" (nobody can promise that)', kinds: 'all', re: /(#\s?1\b(?!\s*(priority|concern|goal|focus))|\bnumber (one|1)\b|\bno\.? ?1\b|\btop[- ]ranked\b|\b(first|top) (place|page|spot|result) on google\b|\branks? (first|#1|number one) on google\b|\bbest in (town|the (city|county|state|area|country|business))\b)/i },
  { why: 'Sounds hostile or accuses the reviewer', kinds: 'reply', re: /\b(liar|liars|lying|fake review|scam(mer)?|idiot|stupid|ridiculous|you people|shut up|get lost)\b/i }
];
// For every client: Google doesn't allow offering anything in return for a review, and neither do we.
const ASK_RE = /\b(leave|write|post|give|drop)\s+(us\s+|me\s+)?(a\s+|an\s+|your\s+)?([\w-]+\s+){0,2}reviews?\b|\breview us\b|\bd[eé]j[a-z]*\s+(una\s+|su\s+)?rese[ñn]a/i;
const FOR_RE = /\bfor\s+(a\s+|an\s+|your\s+|the\s+)?([\w-]+\s+){0,2}reviews?\b|\bpor\s+(su\s+|una\s+)?rese[ñn]a/i;
const PERK_RE = /(\b(discount|percent off|free|gift ?card|coupon|giveaway|raffle|prize|drawing|entered|entry|reward|credit|gratis|descuento|regalo)\b|\d+\s?%\s?off\b)/i;
const PERK_STRONG = /(\b(discount|percent off|gift ?card|coupon|giveaway|raffle|prize|drawing|entered|entry|reward|credit|descuento|regalo)\b|\d+\s?%\s?off\b)/i;

export function guard(text, c, kind) {
  const t = String(text || ''), hits = [];
  const run = list => { for (const r of list) {
    if (r.kinds !== 'all' && r.kinds !== kind) continue;
    const m = t.match(r.re);
    if (m) hits.push({ w: m[0], why: r.why });
  } };
  run(CG_ALL);
  if (c && +c.regulated) run(CG_RULES);
  String(c && c.banned || '').split(/\n/).map(x => x.trim()).filter(Boolean).forEach(b => {
    if (t.toLowerCase().indexOf(b.toLowerCase()) > -1) hits.push({ w: b, why: 'On your do-not-use list' });
  });
  for (const s of t.split(/(?<=[.!?\n])/)) {
    const perk = (ASK_RE.test(s) && s.match(PERK_RE)) || (FOR_RE.test(s) && s.match(PERK_STRONG));
    if (perk) { hits.push({ w: perk[0], why: 'Offers something for a review (Google does not allow it)' }); break; }
  }
  return hits;
}

// What Compliance Guard checks for this client, in plain words (shown in the app).
export function guardSummary(c) {
  const reg = !!(c && +c.regulated);
  const base = ['No offer of anything in return for a review (Google does not allow it)', 'No promise of a ranking or of being “the best”', 'No hostile words aimed at a reviewer', 'Your own do-not-use list'];
  const strict = ['No promised outcomes', 'No rates or prices', 'No confirming someone is a client or patient', 'No claim details', 'No advice', 'No testimonials about outcomes'];
  return { regulated: reg, base, strict: reg ? strict : [], note: 'Everything is a draft until you approve it. Compliance Guard is a safeguard, not legal advice.' };
}

// ---------- entry points ----------
export async function handleApp(req, env, ctx, url) {
  const m = url.pathname.match(/^\/app\/([^/]+)(\/.*)?$/);
  if (!m) return gone(404);
  const code = m[1];
  const sub = (m[2] || '').replace(/\/+$/, '');
  const api = sub.startsWith('/api/');
  const ip = await ipKey(req, env);
  const since = new Date(Date.now() - 3600000).toISOString();
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_fail WHERE ip_hash = ?1 AND at > ?2').bind(ip, since).first();
  if (fails && fails.n >= FAIL_LIMIT) return api ? aj({ ok: false, error: 'Too many tries. Please wait an hour.' }, 429) : gone(429);
  let c = null, linkHash = '';
  if (CODE_RE.test(code)) {
    const h = linkHash = await sha256hex(code);
    c = await env.DB.prepare('SELECT * FROM app_clients WHERE code_hash = ?1 AND active = 1').bind(h).first();
    // Staff links: an office worker gets their own link to the same business (HQ adds and removes them).
    if (!c) {
      try {
        const st = await env.DB.prepare('SELECT client_id, name FROM app_staff WHERE code_hash = ?1').bind(h).first();
        if (st) { c = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1 AND active = 1').bind(st.client_id).first(); if (c) { c.staff = st.name || 'Staff'; c.role = await staffRole(env, h); } }
      } catch (e) { c = null; }
    }
  }
  if (!c) {
    ctx.waitUntil(env.DB.prepare('INSERT INTO app_fail (ip_hash, at) VALUES (?1, ?2)').bind(ip, new Date().toISOString()).run()
      .then(() => env.DB.prepare('DELETE FROM app_fail WHERE at < ?1').bind(new Date(Date.now() - 86400000).toISOString()).run())
      .catch(() => {}));
    return api ? aj({ ok: false, error: 'This link is not working any more. Ask Always Open for a new one.' }, 404) : gone(404);
  }
  // Multi-location: an owner's link can open any location linked to the same group (?loc=<client_id>). Staff stay on their own location.
  let locations = [];
  try {
    await ensureLocations(env);
    const g = await env.DB.prepare('SELECT group_id FROM app_locations WHERE client_id = ?1').bind(c.client_id).first();
    if (g && !c.staff) {
      locations = ((await env.DB.prepare('SELECT l.client_id, c.business, l.label FROM app_locations l JOIN app_clients c ON c.client_id = l.client_id WHERE l.group_id = ?1 AND c.active = 1 ORDER BY l.sort, c.business').bind(g.group_id).all()).results || []);
      const want = url.searchParams.get('loc') || req.headers.get('x-loc') || '';
      if (want && want !== c.client_id && locations.some(x => x.client_id === want)) {
        const o = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1 AND active = 1').bind(want).first();
        if (o) c = o;
      }
    }
  } catch (e) { locations = []; }
  c.locations = locations.map(x => ({ id: x.client_id, name: x.label || x.business || '', current: x.client_id === c.client_id }));
  c.linkHash = linkHash;   // which link opened this (the owner's or a staff link): phones register under it (apiDevice)
  const base = '/app/' + code;
  const meth = req.method;
  if (!c.staff) c.role = 'owner';
  // Team roles: techs never see money or billing. Every change records who made it (staff links can't pick another name).
  if (api && c.role === 'tech' && MONEY_ROUTES.indexOf(sub) > -1) return aj({ ok: false, error: 'Ask the owner for this one.' }, 403);
  // Every handler reads its body as JSON whatever the content type says, so the staff name is set here for any body
  // (not only application/json), and again inside each handler of this file (whoBy).
  let body = null;
  if (api && meth === 'POST' && !RAW_ROUTES.has(sub) && +(req.headers.get('content-length') || 0) <= BODY_MAX) {
    const raw = await req.text();
    try { body = JSON.parse(raw); } catch (e) { body = null; }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (c.staff) body.by = c.staff;
      c.whoName = c.staff || oneLine(String(body.by || '')).slice(0, 40) || c.owner_first || 'Owner';
    } else body = null;
    const hh = new Headers(req.headers); hh.delete('content-length');
    req = new Request(req.url, { method: 'POST', headers: hh, body: body ? JSON.stringify(body) : raw });
  } else if (api && meth === 'POST' && !RAW_ROUTES.has(sub) && c.staff) {
    return aj({ ok: false, error: 'That is too big to send.' }, 413);
  }
  if (api && meth === 'POST' && sub === '/api/photo' && c.staff) url.searchParams.set('by', c.staff);
  const res = await route();
  if (body && res.status === 200 && actText(sub, body)) ctx.waitUntil(logAct(env, c, actText(sub, body)));
  return res;
  async function route() {
  try {
    if (sub === '') {
      if (meth === 'GET' || meth === 'HEAD') return new Response(appHtml({ base, business: c.business || '' }), { headers: { ...H, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
    } else if (sub === '/manifest.webmanifest') {
      return manifest(base);
    } else if (sub === '/texting') {
      if (c.staff) return gone(404);
      if (meth !== 'GET' && meth !== 'POST') return gone(404);
      return await textingPage(env, c, base, req);
    } else if (sub === '/billing') {
      if (c.staff) return gone(404);
      return await billingPage(env, c, base, req, url, { notify: (t, b, pr) => ntfy(env, t, b, pr || 'default', 'moneybag') });
    } else if (sub.startsWith('/help/')) {
      // First-hour help pages (owner only). Opening one ticks its step in "Your first hour".
      if (c.staff) return gone(404);
      if (meth === 'GET' || meth === 'HEAD') {
        const which = sub.slice(6), html = await helpPage(env, c, which, base);
        if (!html) return gone(404);
        if (meth === 'GET') await markOnboard(env, c.client_id, which === 'forwarding' ? 'forward' : which);
        return new Response(html, { headers: { ...H, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
      }
    } else if (sub.startsWith('/record/')) {
      if (meth === 'GET' || meth === 'HEAD') return await recordPage(env, c, sub.slice(8), base);
    } else if (sub.startsWith('/month/')) {
      // The month on one page (monthpage.js): a past month, or this month so far.
      if (meth === 'GET' || meth === 'HEAD') return await monthPageFor(env, c, sub.slice(7), base);
    } else if (sub === '/year') {
      // Twelve months and everything since they joined, on one page (trends.js, yearpage.js).
      if (meth === 'GET' || meth === 'HEAD') return await yearPageFor(env, c, base);
    } else if (sub === '/api/trends' && meth === 'GET') {
      // The same numbers for the iPhone app: months oldest first, the running totals, and the plain-words lines.
      const t = await (await import('./trends.js')).trendsFor(env, c);
      return new Response(JSON.stringify({ ok: true, months: t.months, since: t.since, lines: t.lines, avgJob: t.noMoney ? 0 : t.avgJob, page: '/year' }), { headers: { ...H, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } else if (sub === '/api/state' && meth === 'GET') {
      return await apiState(env, c, ctx);
    } else if (sub === '/api/decide' && meth === 'POST') {
      return await apiDecide(req, env, ctx, c);
    } else if (sub === '/api/message' && meth === 'POST') {
      return await apiMessage(req, env, ctx, c);
    } else if (sub === '/api/job' && meth === 'POST') {
      return await apiJob(req, env, ctx, c);
    } else if (sub === '/api/greeting-audio' && meth === 'POST') {
      return await apiGreetingAudio(req, env, c);
    } else if (sub === '/api/photo' && meth === 'POST') {
      return await apiPhoto(req, env, ctx, c, url);
    } else if (sub === '/api/device' && meth === 'POST') {
      return await apiDevice(req, env, c);
    } else if (sub === '/api/call' && meth === 'POST') {
      return await apiCall(req, env, c);
    } else if (sub === '/api/line' && meth === 'POST') {
      return await apiLine(req, env, ctx, c);
    } else if (sub === '/api/results' && meth === 'POST') {
      await ensureSettings(env);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const avg = Math.max(0, Math.min(1000000, Math.round(+b.avgJob || 0))), win = Math.max(1, Math.min(100, Math.round(+b.winRate || 30)));
      await env.DB.prepare('INSERT INTO app_settings (client_id, avg_job, win_rate, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(client_id) DO UPDATE SET avg_job = excluded.avg_job, win_rate = excluded.win_rate, updated = excluded.updated')
        .bind(c.client_id, avg, win, new Date().toISOString()).run();
      return aj({ ok: true, avgJob: avg, winRate: win });
    } else if (sub === '/api/lead' && meth === 'POST') {
      await ensureLeads(env);
      let b = {}; try { b = await req.json(); } catch (e) {}
      const id = +b.id || 0, done = b.action !== 'open';
      const r = await env.DB.prepare('UPDATE app_leads SET status = ?1, done_at = ?2 WHERE id = ?3 AND client_id = ?4').bind(done ? 'done' : 'new', done ? new Date().toISOString() : null, id, c.client_id).run();
      return aj({ ok: changed(r) }, changed(r) ? 200 : 404);
    } else if (sub === '/api/invoice' && meth === 'POST') {
      return await apiInvoice(req, env, c);
    } else if (sub === '/api/followup' && meth === 'POST') {
      return await apiFollowup(req, env, ctx, c);
    } else if (sub === '/api/work' && meth === 'POST') {
      return await apiWork(req, env, c);
    } else if (sub === '/api/quote' && meth === 'POST') {
      return await apiQuote(req, env, c);
    } else if (sub === '/api/stripe' && meth === 'POST') {
      return await apiStripe(req, env, c);
    } else if (sub === '/api/inbox' && meth === 'GET') {
      return await inboxApi(env, c);
    } else if (sub === '/api/inbox' && meth === 'POST') {
      return await apiInbox(req, env, c);
    } else if (sub === '/api/insights' && meth === 'POST') {
      return await insightsApi(req, env, c);
    } else if (sub === '/api/team' && meth === 'POST') {
      return await apiTeam(req, env, c);
    } else if (sub === '/api/prefs' && meth === 'POST') {
      return await apiPrefs(req, env, c);
    } else if (sub === '/api/import' && meth === 'POST') {
      return await apiImport(req, env, c);
    } else if (sub === '/api/revive' && meth === 'POST') {
      return await apiRevive(req, env, c);
    } else if (sub === '/api/versions' && meth === 'POST') {
      return await apiVersions(req, env, c);
    } else if (sub === '/api/rivals' && meth === 'POST') {
      return await apiRivals(req, env, c, ctx);
    } else if (sub === '/api/firstlook' && meth === 'POST') {
      const r = await apiFirstLook(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/fillweek' && meth === 'POST') {
      const r = await (await import('./fillweek.js')).apiFill(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/fullmax' && meth === 'POST') {
      const r = await apiFullMax(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/answer' && meth === 'POST') {
      const r = await apiAnswer(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/checkins' && meth === 'POST') {
      const r = await apiCheckins(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/handoff' && meth === 'POST') {
      const r = await apiHandoff(req, env, c);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/callbacks' && meth === 'POST') {
      const ln = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(c.client_id).first();
      const r = await apiCallbacks(req, env, c, ln);
      return aj(r, r.ok ? 200 : 400);
    } else if (sub === '/api/map' && meth === 'POST') {
      const r = await apiMap(req, env, c);
      if (r.status === 200) await markOnboard(env, c.client_id, 'map');
      return r;
    }
  } catch (e) {
    return api ? aj({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500) : gone(500);
  }
  return api ? aj({ ok: false, error: 'Not found' }, 404) : gone(404);
  }
}

// Universal links: a tap on an /app/ link opens the iPhone app when it's installed.
export function aasa() {
  const body = { applinks: { details: [{ appIDs: [TEAM + '.' + BUNDLE], components: [{ '/': '/app/*', comment: 'Client app links' }] }] } };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
}

// A photo a client sent, for Christopher (HQ links here). The id is a long random token.
export async function photoGet(env, url) {
  const id = url.pathname.slice(3);
  if (!/^[A-Za-z0-9]{32}$/.test(id)) return new Response('Not found', { status: 404, headers: H });
  const row = await env.DB.prepare('SELECT mime, data FROM app_photos WHERE id = ?1').bind(id).first();
  if (!row || !row.data) return new Response('Not found', { status: 404, headers: H });
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return new Response(bytes, { headers: { ...H, 'content-type': /^image\/(jpeg|png|webp)$/.test(row.mime || '') ? row.mime : 'image/jpeg', 'content-disposition': 'inline; filename="photo-' + id.slice(0, 6) + '.jpg"' } });
}

// One-time check that this Worker can reach Apple's push service (it only answers over HTTP/2).
export async function apnsReach() {
  try {
    const r = await fetch('https://api.sandbox.push.apple.com/3/device/' + '0'.repeat(64), {
      method: 'POST',
      headers: { authorization: 'bearer x.y.z', 'apns-topic': BUNDLE, 'apns-push-type': 'alert', 'content-type': 'application/json' },
      body: '{"aps":{"alert":"test"}}'
    });
    return aj({ ok: true, status: r.status, body: (await r.text()).slice(0, 300) });
  } catch (e) {
    return aj({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
}

// ---------- API ----------
let liveTable = false;
async function apiState(env, c, ctx) {
  // This month so far (insights.js) runs alongside everything else; a failure here never stops the app from loading.
  const monthNowP = monthFor(env, c, 'now').then(monthNowOut).catch(() => null);
  const cid = c.client_id;
  const f = features(c);
  await ensureAuto(env).catch(() => {});
  const qs = [
    env.DB.prepare("SELECT id, kind, title, context, stars, text, checked, photo, created FROM app_items WHERE client_id = ?1 AND status = 'pending' ORDER BY created LIMIT 50").bind(cid),
    env.DB.prepare("SELECT id, kind, title, status, text, decided_text, decided_at, decided_by, updated FROM app_items WHERE client_id = ?1 AND status != 'pending' ORDER BY COALESCE(decided_at, updated) DESC LIMIT 20").bind(cid),
    env.DB.prepare('SELECT month, data FROM app_months WHERE client_id = ?1 ORDER BY month DESC LIMIT 13').bind(cid),
    env.DB.prepare('SELECT id, at, by, text, dir FROM app_messages WHERE client_id = ?1 ORDER BY id DESC LIMIT 40').bind(cid),
    env.DB.prepare('SELECT COUNT(*) AS n FROM app_jobs WHERE client_id = ?1 AND at > ?2').bind(cid, monthStart()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM app_photos WHERE client_id = ?1 AND at > ?2').bind(cid, monthStart())
  ];
  qs.push(env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(cid));
  qs.push(env.DB.prepare("SELECT id, title, context, stars, text, decided_text, status, created, decided_at FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post', 'invoice', 'reviewreq') ORDER BY created DESC LIMIT 60").bind(cid));
  qs.push(env.DB.prepare("SELECT id, kind, name, phone, amount, due, note, status, created, by, done_at, consent, appt_at, auto_conf, auto_rem, auto_fu FROM app_followups WHERE client_id = ?1 AND (status = 'open' OR (status = 'done' AND done_at > ?2)) ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE WHEN due = '' THEN 1 ELSE 0 END, due, created DESC LIMIT 60").bind(cid, new Date(Date.now() - 30 * 86400000).toISOString()));
  if (f.calls) qs.push(env.DB.prepare("SELECT id, at, caller, caller_name, reason, details, wants, callback, urgency, summary, transcript, outcome, status, handled_by, handled_at FROM app_calls WHERE client_id = ?1 AND outcome NOT IN ('live', 'spam') AND test = 0 AND at > ?2 ORDER BY at DESC LIMIT 40").bind(cid, new Date(Date.now() - 60 * 86400000).toISOString()));
  const res = await env.DB.batch(qs);
  const rows = i => (res[i] && res[i].results) || [];
  let leads = [];
  try {
    leads = (await env.DB.prepare("SELECT id, at, name, phone, need, sms_ok, status, done_at FROM app_leads WHERE client_id = ?1 AND (status = 'new' OR done_at > ?2) ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, at DESC LIMIT 40")
      .bind(cid, new Date(Date.now() - 14 * 86400000).toISOString()).all()).results || [];
  } catch (e) { leads = []; }
  // Results this month: real counts from Max's calls, the request form and Google reviews; the dollar figure uses the owner's own numbers.
  let results = null;
  try {
    await ensureSettings(env);
    const ms = monthStart();
    const rr = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND outcome NOT IN ('live', 'spam') AND test = 0").bind(cid, ms),
      env.DB.prepare('SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at >= ?2').bind(cid, ms),
      env.DB.prepare("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post', 'invoice', 'reviewreq') AND created >= ?2").bind(cid, ms),
      env.DB.prepare('SELECT avg_job, win_rate FROM app_settings WHERE client_id = ?1').bind(cid)
    ]);
    const n = i => ((rr[i].results || [])[0] || {}).n || 0, st = (rr[3].results || [])[0] || {};
    results = { calls: n(0), requests: n(1), reviews: n(2), avgJob: +st.avg_job || 0, winRate: st.win_rate == null ? 30 : +st.win_rate };
  } catch (e) { results = null; }
  const versions = versionsOn(env);
  const inv = await invoicesFor(env, cid);
  if (results) results.unpaid = inv.unpaid;
  let bill = null;
  try { bill = await env.DB.prepare('SELECT plan, status, max, paused_until FROM billing WHERE client_id = ?1').bind(cid).first(); } catch (e) { bill = null; }
  const line = rows(6)[0] || null;
  const monthNow = await monthNowP;
  let months = rows(2).map(r => {
    const d = parse(r.data) || {};
    return { month: r.month, label: d.label || r.month, stats: numbersOnly(d.stats), prev: d.prev || null, note: d.note || '', record: !!(d.record && (d.record.revs || d.record.posts)),
      insights: d.a && Array.isArray(d.a.insights) ? d.a.insights.map(x => x.t) : [], next: (d.a && d.a.next) || '', page: '/month/' + r.month };
  });
  // Google's own numbers (calls, direction requests, website clicks) once the Business Profile access is on.
  try { months = await mergeMonths(env, cid, months); } catch (e) { /* the HQ record alone */ }
  // Jobs, estimates, payments, insights, team and onboarding (biz.js). Results money uses real job totals once there are jobs.
  let biz = {};
  try { biz = await bizState(env, c); } catch (e) { biz = {}; }
  try { Object.assign(biz, await pastState(env, c)); } catch (e) { /* past customers are optional */ }
  try { Object.assign(biz, await rivalsState(env, c, ctx)); } catch (e) { /* competitor watch is optional */ }
  if (results && biz.jobTotals && biz.jobTotals.count) { results.paidMonth = biz.jobTotals.paidMonth; results.booked = biz.jobTotals.booked; results.real = true; }
  const tech = c.role === 'tech';
  if (tech) results = results ? { calls: results.calls, requests: results.requests, reviews: results.reviews } : null;
  let called = false;
  try { called = !!(await env.DB.prepare('SELECT id FROM app_calls WHERE client_id = ?1 LIMIT 1').bind(cid).first()); } catch (e) {}
  const out = {
    ok: true,
    now: new Date().toISOString(),
    client: {
      business: c.business || '', first: c.owner_first || '', regulated: !!+c.regulated, tier: c.tier || '', phone: c.staff ? '' : (c.phone || ''),
      reviewLink: /^https:\/\//.test(c.review_link || '') ? c.review_link : '',
      refLink: c.ref ? SITE + '/?ref=' + encodeURIComponent(c.ref) + '#contact' : SITE + '/#contact',
      qr: qrOut(c.qr)
    },
    features: Object.assign({}, f, { line: !!line, versions }),
    line: lineOut(line, c),
    reviews: rows(7).map(r => ({ id: r.id, name: r.title || '', stars: +r.stars || 0, review: r.context || '', reply: r.decided_text || r.text || '', status: r.status, at: r.created || '', decidedAt: r.decided_at || '' })),
    followups: f.followups ? rows(8).map(fuOut) : [],
    items: rows(0).map(r => ({ id: r.id, kind: r.kind, title: r.title || '', context: r.context || '', stars: +r.stars || 0, text: r.text || '', checked: !!+r.checked || guard(r.text || '', c, r.kind).length === 0, photo: /^https:\/\/alwaysopenoffice\.com\/p\/[A-Za-z0-9]{32}$/.test(r.photo || '') ? '/p/' + r.photo.slice(-32) : '', created: r.created || '' })),
    done: rows(1).map(r => ({ id: r.id, kind: r.kind, title: r.title || '', status: r.status, text: r.decided_text || r.text || '', at: r.decided_at || r.updated || '', by: r.decided_by || '' })),
    months,
    monthNow,
    messages: rows(3).reverse().map(r => ({ id: r.id, at: r.at, by: r.by || '', text: r.text || '', dir: r.dir === 'out' ? 'out' : 'in' })),
    counts: { jobs: (rows(4)[0] || {}).n || 0, photos: (rows(5)[0] || {}).n || 0 },
    leads: leads.map(r => ({ id: r.id, at: r.at || '', name: r.name || '', phone: r.phone || '', need: r.need || '', text: !!+r.sms_ok, status: r.status === 'new' ? 'new' : 'done' })),
    results,
    billing: bill && !c.staff ? { plan: bill.plan || '', status: bill.status || '', max: !!+bill.max, pausedUntil: bill.paused_until || '' } : null,
    locations: c.locations || [],
    calendar: c.staff ? null : await gcalStatus(env, c.client_id),
    quoteLink: c.ref ? SITE + '/q/' + encodeURIComponent(c.ref) : '',
    bookLink: c.ref ? SITE + '/b/' + encodeURIComponent(c.ref) : '',
    invoices: inv.invoices,
    unpaid: inv.unpaid,
    meta: c.staff ? null : await metaStatus(env, cid),
    calls: f.calls ? rows(9).map(callOut) : []
  };
  const bprefs = biz.prefs; delete biz.prefs;
  Object.assign(out, biz);
  if (tech) { out.invoices = []; out.unpaid = 0; out.billing = null; out.quotes = []; }
  out.me = { name: c.staff || c.owner_first || 'Owner', role: c.role || 'owner' };
  out.complianceGuard = guardSummary(c);
  if (cid === 'demo-plumbing') {
    out.sample = true;
    try { out.sampleWeekly = weeklyLine(await weeklyNumbers(env, cid, Date.now())); } catch (e) { out.sampleWeekly = ''; }
  }
  out.referrals = c.staff ? null : await referralState(env, c);
  try { out.lost = (c.regulated || tech) ? null : await lostState(env, cid); } catch (e) { out.lost = null; }
  try { out.callbacks = await callbackState(env, cid); } catch (e) { out.callbacks = null; }
  try { out.handoff = (c.regulated || c.staff) ? null : await handoffState(env, cid); } catch (e) { out.handoff = null; }
  try { out.checkins = c.regulated ? null : await checkinState(env, cid); } catch (e) { out.checkins = null; }
  try { out.answer = f.calls ? await answerState(env, cid) : null; } catch (e) { out.answer = null; }
  // Calls Max is on right now, for the live card on Today.
  try {
    if (!liveTable) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS call_live (id TEXT PRIMARY KEY, heard TEXT, said TEXT, turns INTEGER, updated TEXT)').run(); liveTable = true; }
    const rows = f.calls ? ((await env.DB.prepare("SELECT c.id, c.at, c.caller, c.caller_name, l.heard, l.said, l.turns, l.updated FROM app_calls c LEFT JOIN call_live l ON l.id = c.id WHERE c.client_id = ?1 AND c.outcome = 'live' AND c.test = 0 AND c.at > ?2 ORDER BY c.at DESC LIMIT 3").bind(cid, new Date(Date.now() - 20 * 60000).toISOString()).all()).results || []) : [];
    out.live = rows.map(r => ({ id: r.id, at: r.at, numberText: fmtNum(r.caller || ''), name: r.caller_name || '', heard: r.heard || '', said: r.said || '', turns: +r.turns || 0, updated: r.updated || r.at }));
  } catch (e) { out.live = []; }
  try { out.fullMax = c.staff ? null : await fullMaxState(env, c); } catch (e) { out.fullMax = null; }
  try { out.after = (line && !c.staff && !+c.regulated) ? await afterState(env, cid, line) : null; } catch (e) { out.after = null; }
  try { out.maxStats = (f.calls && line) ? await (await import('./grades.js')).ownerStats(env, cid) : null; } catch (e) { out.maxStats = null; }
  try { out.minutes = (f.calls && line && !c.staff) ? await (await import('./minutes.js')).meterFor(env, cid) : null; } catch (e) { out.minutes = null; }
  try { out.money = (f.calls && line && !tech) ? await (await import('./money.js')).moneyState(env, cid) : null; } catch (e) { out.money = null; }
  try { out.reconnect = c.staff ? [] : await (await import('./connections.js')).brokenFor(env, cid); } catch (e) { out.reconnect = []; }
  try { out.fillWeek = c.staff || cid === 'demo-plumbing' ? null : await (await import('./fillweek.js')).fillState(env, c); } catch (e) { out.fillWeek = null; }
  try { out.upgrades = c.staff ? null : await upgradesState(env, c); } catch (e) { out.upgrades = null; }
  try { out.texting = c.staff || cid === 'demo-plumbing' ? null : await textingState(env, c); } catch (e) { out.texting = null; }
  try { out.firstLookDue = cid === 'demo-plumbing' ? false : await firstLookDue(env, c); } catch (e) { out.firstLookDue = false; }
  try { out.share = c.staff || cid === 'demo-plumbing' ? null : await shareState(env, c, out.client && out.client.refLink); } catch (e) { out.share = null; }
  try { out.map = c.staff ? null : await mapState(env, c); } catch (e) { out.map = null; }
  try { out.autoText = f.followups ? await autoReady(env, c) : false; } catch (e) { out.autoText = false; }
  try { out.aiCheck = (c.tier === 'Growth' || c.tier === 'Pro') ? await (await import('./aicheck.js')).aiCheckState(env, cid) : null; } catch (e) { out.aiCheck = null; }
  try { const ls = line ? null : await lineStatus(env, cid); out.lineSetup = ls ? ls.status : ''; } catch (e) { out.lineSetup = ''; }
  out.onboarding = c.staff ? null : finishOnboarding(Object.assign({ __called: called }, out), bprefs);
  return aj(out);
}

// One AI-answered call as the client's app shows it. Numbers go out as +1XXXXXXXXXX (for tel: links) and 478-555-0142.
function callOut(r) {
  const num = e => /^\+1\d{10}$/.test(e || '') ? e : '';
  const fmt = e => num(e) ? e.slice(2, 5) + '-' + e.slice(5, 8) + '-' + e.slice(8) : '';
  const back = num(r.callback) || num(r.caller);
  const t = parse(r.transcript);
  return {
    id: r.id, at: r.at || '', name: r.caller_name || '', number: num(r.caller), numberText: fmt(r.caller), callback: back, callbackText: fmt(back),
    reason: r.reason || '', details: r.details || '', when: r.wants || '', urgent: r.urgency === 'urgent', summary: r.summary || '',
    outcome: r.outcome || '', status: r.status === 'handled' ? 'handled' : 'new', by: r.handled_by || '', handledAt: r.handled_at || '',
    transcript: Array.isArray(t) ? t.filter(x => x && x.t).map(x => ({ w: x.w === 'caller' ? 'caller' : 'ai', t: String(x.t) })) : []
  };
}

async function apiCall(req, env, c) {
  if (!features(c).calls) return aj({ ok: false, error: 'The phone line is not on for your account.' }, 403);
  const b = await readJson(req, 2000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const id = clean(b.id, 40);
  const by = whoBy(c, b.by);
  const st = b.action === 'reopen' ? 'new' : 'handled';
  if (!/^CA[0-9a-f]{32}$/.test(id)) return aj({ ok: false, error: 'Bad request' }, 400);
  const now = new Date().toISOString();
  const r = await env.DB.prepare('UPDATE app_calls SET status = ?1, handled_by = ?2, handled_at = ?3, hq_synced = 0 WHERE id = ?4 AND client_id = ?5')
    .bind(st, st === 'handled' ? by : '', st === 'handled' ? now : '', id, c.client_id).run();
  if (!changed(r)) return aj({ ok: false, error: 'That call is gone. Pull down to refresh.' }, 404);
  return aj({ ok: true, status: st, at: now });
}

// ---------- the AI line (Max), from the owner's side ----------
// What the owner can see and change: on or off, hours, what Max should know, where urgent calls go, and the greeting
// (which must still say it is an AI and that calls are recorded). Changes apply to the next call; Chris gets a ping.
// The owner's changes live in their own column (owner_set) because HQ rewrites the rest of the row whenever Chris saves
// the client's AI line card. Each change remembers what HQ had then (base): the owner's value counts until Chris
// changes that same thing in HQ. The owner can turn the line off; only HQ can turn a paused line back on.
export function withOwner(row) {
  if (!row) return row;
  const o = parse(row.owner_set) || {}, f = parse(row.facts) || {};
  const pick = (k, cur) => { const x = o[k]; return x && typeof x === 'object' && typeof x.v === 'string' && String(x.base == null ? '' : x.base) === String(cur == null ? '' : cur) ? x.v : cur; };
  f.hours = pick('hours', String(f.hours || ''));
  f.greeting = pick('greeting', String(f.greeting || ''));
  if (typeof o.owner === 'string') f.owner = o.owner;
  // What the owner told Max (typed on the Max tab, or approved after Max's interview call) wins over HQ's facts.
  if (o.facts && typeof o.facts === 'object') for (const k of FACT_KEYS) if (typeof o.facts[k] === 'string') f[k] = o.facts[k];
  // The owner's pick of voice and name for the assistant, and their own recorded greeting.
  if (o.voice && VOICES[o.voice] && voiceKeyOf(f.voice) !== o.voice) f.voice = VOICES[o.voice].id;   // same voice as HQ set: keep HQ's tuning
  if (typeof o.name === 'string' && o.name) f.name = o.name;
  if (typeof o.greetAudio === 'string' && /^[A-Za-z0-9]{32}$/.test(o.greetAudio)) f.greetAudio = o.greetAudio; else delete f.greetAudio;
  const out = Object.assign({}, row, { facts: JSON.stringify(f) });
  // Spanish: the owner can switch it on or off from the app (spanish_owner wins over HQ's setting).
  if (typeof o.spanish === 'boolean') out.spanish = o.spanish ? 1 : 0;
  out.transfer_to = pick('transferTo', row.transfer_to || '');
  out.transfer_when = pick('transferWhen', row.transfer_when || 'never');
  if (!/^\+1\d{10}$/.test(out.transfer_to || '')) { out.transfer_to = ''; out.transfer_when = 'never'; }
  out.hq_on = +row.on_air ? 1 : 0;
  out.on_air = out.hq_on && !o.off ? 1 : 0;
  out.owner_at = typeof o.at === 'string' ? o.at : '';
  return out;
}
function fmtNum(e) { return /^\+1\d{10}$/.test(e || '') ? '(' + e.slice(2, 5) + ') ' + e.slice(5, 8) + '-' + e.slice(8) : ''; }
// The same rule as greetingOk in voice.js: Max adds the disclosure sentence (DISCLOSURE there) to every greeting himself,
// so the owner's greeting only has to be a sensible length and must not say Max is not an AI, is a person, or that calls
// are not recorded ("this is Sarah, no AI here" is refused).
function greetOk(g) {
  const t = oneLine(String(g || ''));
  const denies = [
    /\b(?:[Nn]o|NO|[Nn]ot|NOT|[Nn]ever|[Nn]othing|[Ii]sn['’]?t|[Aa]in['’]?t|[Aa]ren['’]?t|[Ww]ithout|[Dd]on['’]?t|[Dd]o not|[Dd]oesn['’]?t|[Dd]oes not)\b(?:\s+[\w'’]+){0,3}?\s+(?:an?\s+)?(?:AI|A\.I\.?|SI|S\.I\.?)(?![\w])|\b(?:AI|A\.I\.?)\s+(?:could|can|will|would|won['’]?t|can['’]?t)\s+(?:never\s+)?(?:replace|beat|do)\b/,
    /\b(?:no|not|never|nothing|isn['’]?t|ain['’]?t|aren['’]?t|without|won['’]?t be|will not be|don['’]?t|do not|doesn['’]?t|does not)\b(?:\s+[\w'’]+){0,3}?\s+(?:an?\s+)?(?:robots?|bots?|machines?|computers?|automated|automation|automatic|artificial|recorded|recording|recordings|record)\b|\b(?:robots?|machines?|computers?)\s+(?:could|can|will|would)\s+never\b/i,
    /\b(?:real|live|actual)\s+(?:person|human|people|receptionist)\b|\b(?:a|an)\s+human\b|\bhuman being\b|\bI['’]?m\s+(?:a\s+)?(?:person|human)\b|\bI am\s+(?:a\s+)?(?:person|human)\b|\b(?:at|from|on) the front desk\b/i
  ];
  return t.length >= 10 && t.length <= 320 && !/[<>]/.test(t) && !denies.some(re => re.test(t));
}
// Why a greeting was refused, in words the owner can act on.
function greetWhy(g) {
  const t = oneLine(String(g || ''));
  if (t.length < 10) return 'That greeting is too short. Leave it empty for the standard one.';
  if (t.length > 320) return 'That greeting is too long. Keep it to a sentence or two.';
  if (/[<>]/.test(t)) return 'Take out the < and > signs and try again.';
  return 'Max always tells callers he is an automated assistant and that the call may be recorded, so the greeting can’t say otherwise. Keep it to your welcome.';
}
// The "After the call" card: three switches, and whether texts can go out yet (one answer for every text feature).
async function afterState(env, cid, line) {
  const o = parse(line.owner_set) || {};
  const { checkinsOn } = await import('./checkin.js');
  const { senderFor, TEXTING_ON, textingReady } = await import('./sms.js');
  let canText = false;
  try { canText = !!(TEXTING_ON && textingReady(env) && await senderFor(env, cid)); } catch (e) { canText = false; }
  return { promise: o.callbacksOff !== true, textback: o.textback !== false, checkins: await checkinsOn(env, cid), canText };
}
function lineOut(raw, c) {
  if (!raw) return null;
  const l = withOwner(raw), f = parse(l.facts) || {};
  const biz = l.business || (c && c.business) || 'us';
  return {
    number: l.number, numberText: fmtNum(l.number), onAir: !!l.on_air, paused: !l.hq_on, name: oneLine(String(f.name || '')).replace(/[^A-Za-z .'-]/g, '').slice(0, 30) || 'Max',
    hours: oneLine(String(f.hours || '')), owner: String(f.owner || ''), greeting: oneLine(String(f.greeting || '')), spanish: !!+l.spanish,
    defaultGreeting: 'Hi, thanks for calling ' + biz + '! ' + DISCLOSURE + ' What can I do for you?',
    transferTo: l.transfer_to, transferText: fmtNum(l.transfer_to), transferWhen: l.transfer_when === 'urgent' || l.transfer_when === 'asked' ? l.transfer_when : 'never',
    updated: [l.updated || '', l.owner_at || ''].sort().pop(),
    ...knowOut(raw.facts, raw.owner_set),
    booking: +raw.regulated ? null : bookingOut(l),
    voice: voiceKeyOf(f.voice), voices: voicesOut(), greetingAudio: f.greetAudio ? SITE + '/a/' + f.greetAudio : ''
  };
}
async function apiLine(req, env, ctx, c) {
  const raw = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(c.client_id).first();
  if (!raw) return aj({ ok: false, error: 'You don’t have a phone line yet. Ask us to set up Max.' }, 403);
  const b = await readJson(req, 6000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const by = whoBy(c, b.by);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM voice_log WHERE kind = 'line-edit' AND at > ?1 AND detail LIKE ?2")
    .bind(new Date(Date.now() - 3600000).toISOString(), '%"cid":"' + c.client_id + '"%').first();
  if (n && n.n >= 30) return aj({ ok: false, error: 'That is a lot of changes in an hour. Please wait a bit, or message us in Ask us.' }, 429);
  const l = withOwner(raw), f = parse(l.facts) || {}, hq = parse(raw.facts) || {}, o = parse(raw.owner_set) || {};
  const changes = [];
  // Max's interview: call the owner now, or keep/throw away what the last interview heard.
  if (b.action === 'interview') {
    if (c.role === 'tech') return aj({ ok: false, error: 'Ask the owner for this one.' }, 403);
    const r = await startInterview(env, c, raw, b.phone || c.phone || '', dialOut, env.VOICE_KEY);
    return aj(r, r.ok ? 200 : 422);
  }
  if (b.action === 'keep-facts' || b.action === 'drop-facts') {
    if (!o.pending) return aj({ ok: true, unchanged: true, line: lineOut(raw, c) });
    const r = applyPending(o, b.action === 'keep-facts');
    changes.push(...r.changes);
  }
  if (b.voice != null) {
    if (!VOICES[b.voice]) return aj({ ok: false, error: 'Pick one of the voices listed.' }, 422);
    if (b.voice !== voiceKeyOf(f.voice)) { o.voice = b.voice; changes.push('voice: ' + VOICES[b.voice].label); }
  }
  if (b.name != null) {
    const nm = cleanName(b.name);
    if (b.name && !nm) return aj({ ok: false, error: 'Use letters only for the name.' }, 422);
    if ((nm || 'Max') !== (oneLine(String(f.name || '')) || 'Max')) { o.name = nm; changes.push('name: ' + (nm || 'Max')); }
  }
  if (b.action === 'remove-greeting-audio' && o.greetAudio) {
    await env.DB.prepare('DELETE FROM line_audio WHERE id = ?1 AND client_id = ?2').bind(o.greetAudio, c.client_id).run().catch(() => {});
    delete o.greetAudio; changes.push('removed the recorded greeting');
  }
  if (b.after && typeof b.after === 'object' && !+raw.regulated) {
    // "After the call": promise a call-back time, text after a missed call, check in a few days after a job.
    if (typeof b.after.promise === 'boolean' && b.after.promise === (o.callbacksOff === true)) { if (b.after.promise) delete o.callbacksOff; else o.callbacksOff = true; changes.push(b.after.promise ? 'Max promises a call-back time' : 'Max no longer promises a call-back time'); }
    if (typeof b.after.textback === 'boolean' && b.after.textback === (o.textback === false)) { if (b.after.textback) delete o.textback; else o.textback = false; changes.push(b.after.textback ? 'texts back after a missed call' : 'no text after a missed call'); }
    if (typeof b.after.checkins === 'boolean') {
      const { checkinsOn, ensureCheckins } = await import('./checkin.js');
      if ((await checkinsOn(env, c.client_id)) !== b.after.checkins) {
        await ensureCheckins(env);
        await env.DB.prepare('INSERT INTO checkin_prefs (client_id, on_, updated) VALUES (?1,?2,?3) ON CONFLICT(client_id) DO UPDATE SET on_ = excluded.on_, updated = excluded.updated').bind(c.client_id, b.after.checkins ? 1 : 0, new Date().toISOString()).run();
        changes.push(b.after.checkins ? 'check-in calls on' : 'check-in calls off');
      }
    }
  }
  if (b.booking && typeof b.booking === 'object' && !+raw.regulated) {
    const nb = cleanBooking(b.booking, o.book);
    if (JSON.stringify(nb) !== JSON.stringify(o.book || {})) { o.book = nb; changes.push('booking: ' + ({ book: 'Max books open times', hold: 'Max pencils in a time for you to confirm', off: 'Max takes a message' })[nb.mode || 'hold'] + ', ' + (nb.slotMin || 60) + '-minute visits'); }
  }
  if (b.facts && typeof b.facts === 'object') {
    const nf = cleanFacts(b.facts), cur = parse(withOwner(raw).facts) || {};
    o.facts = Object.assign({}, o.facts || {});
    for (const k of Object.keys(nf)) if (nf[k] !== String(cur[k] || '')) { o.facts[k] = nf[k]; changes.push(k + ': ' + (nf[k] ? nf[k].slice(0, 120) : '(cleared)')); }
  }
  let tTo = l.transfer_to, tWhen = l.transfer_when === 'urgent' || l.transfer_when === 'asked' ? l.transfer_when : 'never';
  if (typeof b.spanish === 'boolean' && (b.spanish ? 1 : 0) !== (+l.spanish ? 1 : 0)) { o.spanish = b.spanish; changes.push(b.spanish ? 'Answers Spanish-speaking callers in Spanish' : 'English only'); }
  if (typeof b.onAir === 'boolean' && (b.onAir ? 1 : 0) !== l.on_air) {
    if (b.onAir && !l.hq_on) return aj({ ok: false, error: 'Your line is paused on our side. Message us in Ask us to turn it back on.' }, 409);
    if (b.onAir) delete o.off; else o.off = true;
    changes.push(b.onAir ? 'turned the phone line on' : 'turned the phone line off');
  }
  if (b.hours != null) { const h = oneLine(clean(b.hours, 300)); if (h !== String(f.hours || '')) { o.hours = { v: h, base: String(hq.hours || '') }; changes.push('hours: ' + (h || '(cleared)')); } }
  if (b.owner != null) { const t = clean(b.owner, 800).replace(/[\[\]<>{}]/g, ''); if (t !== String(f.owner || '')) { o.owner = t; changes.push('what Max should know: ' + (t ? t.slice(0, 300) : '(cleared)')); } }
  if (b.greeting != null) {
    const g0 = oneLine(clean(b.greeting, 320));
    // Every greeting must tell callers they are talking to an AI and that the call may be recorded. If theirs doesn't, we add that sentence.
    const DISC = ' I’m an S.I., and this call may be recorded.';
    const g = greetOk(g0) || !g0 ? g0 : (g0.slice(0, 320 - DISC.length).trim() + DISC);
    if (g && !greetOk(g)) return aj({ ok: false, error: greetWhy(g) }, 422);
    if (g !== String(f.greeting || '')) { o.greeting = { v: g, base: String(hq.greeting || '') }; changes.push('greeting: ' + (g || '(back to the standard one)')); }
  }
  if (b.transferTo != null) {
    const d = String(b.transferTo).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d && !/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return aj({ ok: false, error: 'Add a 10-digit number for urgent calls, or leave it blank.' }, 422);
    const e = d ? '+1' + d : '';
    if (e !== tTo) { tTo = e; changes.push('urgent calls go to: ' + (fmtNum(e) || 'nobody')); }
  }
  if (b.transferWhen != null) {
    const w = b.transferWhen === 'urgent' || b.transferWhen === 'asked' || b.transferWhen === 'never' ? b.transferWhen : '';
    if (!w) return aj({ ok: false, error: 'Bad request' }, 400);
    if (w !== tWhen) { tWhen = w; changes.push('put callers through: ' + ({ never: 'never', urgent: 'only if urgent', asked: 'when they ask or it is urgent' })[w]); }
  }
  if (tWhen !== 'never' && !tTo) tWhen = 'never';   // nobody to put them through to
  if (tTo !== l.transfer_to) o.transferTo = { v: tTo, base: raw.transfer_to || '' };
  if (tWhen !== l.transfer_when) o.transferWhen = { v: tWhen, base: raw.transfer_when || 'never' };
  if (!changes.length) return aj({ ok: true, unchanged: true, line: lineOut(raw, c) });
  const now = new Date().toISOString();
  o.at = now; o.by = by;
  const set = JSON.stringify(o);
  await env.DB.prepare('UPDATE voice_lines SET owner_set = ?1 WHERE number = ?2 AND client_id = ?3').bind(set, raw.number, c.client_id).run();
  const after = Object.assign({}, raw, { owner_set: set });
  ctx.waitUntil(Promise.all([
    env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'line-edit', ?2)").bind(now, JSON.stringify({ cid: c.client_id, by, changes }).slice(0, 2000)).run(),
    ntfy(env, 'Phone line changed: ' + (c.business || 'a client'), by + ' changed ' + changes.join('; ').slice(0, 1500) + ' (in their app; HQ’s phone line card still shows the old values)', withOwner(after).on_air ? 'default' : 'high', 'telephone_receiver')
  ]).catch(() => {}));
  return aj({ ok: true, line: lineOut(after, c) });
}

// ---------- follow-ups: quotes, invoices and appointments the owner wants chased ----------
// On the due day the owner gets a reminder, and the app drafts a short text they send from their own phone.
const FU_KINDS = { quote: 'Quote', invoice: 'Invoice', appointment: 'Appointment' };
const FU_PER_DAY = 40;
function fuOut(r) {
  const d = /^\d{10}$/.test(r.phone || '') ? r.phone : '';
  return { id: r.id, kind: FU_KINDS[r.kind] ? r.kind : 'quote', name: r.name || '', phone: d ? '+1' + d : '', phoneText: d ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : '', amount: r.amount || '', due: r.due || '', note: r.note || '', status: r.status === 'done' ? 'done' : 'open', at: r.created || '', by: r.by || '', doneAt: r.done_at || '',
    consent: !!+r.consent, apptAt: r.appt_at || '', texted: autoNote(r), notTexted: autoFail(r) };
}
async function apiFollowup(req, env, ctx, c) {
  if (!features(c).followups) return aj({ ok: false, error: 'Quote and invoice follow-ups come with the Pro plan.' }, 403);
  const b = await readJson(req, 4000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const by = whoBy(c, b.by);
  const now = new Date().toISOString();
  if (b.action === 'done' || b.action === 'reopen' || b.action === 'remove') {
    const id = parseInt(b.id, 10);
    if (!(id > 0)) return aj({ ok: false, error: 'Bad request' }, 400);
    const st = b.action === 'done' ? 'done' : (b.action === 'remove' ? 'removed' : 'open');
    const r = await env.DB.prepare('UPDATE app_followups SET status = ?1, done_at = ?2, hq_synced = 0 WHERE id = ?3 AND client_id = ?4')
      .bind(st, st === 'open' ? '' : now, id, c.client_id).run();
    if (!changed(r)) return aj({ ok: false, error: 'That one is gone. Pull down to refresh.' }, 404);
    return aj({ ok: true, id, status: st, at: now });
  }
  const kind = FU_KINDS[b.kind] ? b.kind : 'quote';
  const nm = oneLine(clean(b.name, 60));
  const phone = String(b.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const amount = oneLine(clean(b.amount, 20));
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due || '')) ? String(b.due) : '';
  const note = oneLine(clean(b.note, 200));
  const consent = b.consent === true && !!phone ? 1 : 0;
  let apptAt = '';
  if (kind === 'appointment' && due && /^\d{1,2}:\d{2}$/.test(String(b.time || ''))) {
    const [hh, mm] = String(b.time).split(':').map(Number);
    if (hh < 24 && mm < 60) { const cb = await import('./callbacks.js'); apptAt = new Date(cb.fromLocal(await cb.tzFor(env, c.client_id), due, hh, mm)).toISOString(); }
  }
  if (!nm) return aj({ ok: false, error: 'Add the customer\u2019s name.' }, 400);
  if (phone && !/^[2-9]\d{2}[2-9]\d{6}$/.test(phone)) return aj({ ok: false, error: 'Add a 10-digit number, or leave it blank.' }, 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_followups WHERE client_id = ?1 AND created > ?2').bind(c.client_id, new Date(Date.now() - 86400000).toISOString()).first();
  if (n && n.n >= FU_PER_DAY) return aj({ ok: false, error: 'That is the most for one day. Add the rest tomorrow.' }, 429);
  await ensureAuto(env);
  const ins = await env.DB.prepare("INSERT INTO app_followups (client_id, kind, name, phone, amount, due, note, consent, status, created, by, hq_synced, appt_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, ?10, 0, ?11)")
    .bind(c.client_id, kind, nm, phone, amount, due, note, consent, now, by, apptAt).run();
  const id = ins && ins.meta && ins.meta.last_row_id;
  if (consent && kind === 'appointment' && id) ctx.waitUntil(autoCron(env, Date.now(), [id]).catch(() => {}));
  ctx.waitUntil(throttledPing(env, c, 'New follow-up from ' + (c.business || 'a client'), FU_KINDS[kind] + ' for ' + nm + (amount ? ' (' + amount + ')' : '') + (due ? ', due ' + due : '') + '.'));
  return aj({ ok: true, followup: fuOut({ id, kind, name: nm, phone, amount, due, note, status: 'open', created: now, by, done_at: '', consent, appt_at: apptAt }) });
}

async function apiDecide(req, env, ctx, c) {
  const b = await readJson(req, 12000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const id = clean(b.id, 120);
  const action = b.action === 'approve' ? 'approve' : (b.action === 'skip' ? 'skip' : '');
  const by = whoBy(c, b.by);
  if (!id || !action) return aj({ ok: false, error: 'Bad request' }, 400);
  const it = await env.DB.prepare('SELECT * FROM app_items WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).first();
  if (!it) return aj({ ok: false, error: 'That one is gone. Pull down to refresh.' }, 404);
  if (it.status !== 'pending') return aj({ ok: false, error: it.status === 'closed' ? 'Always Open already took care of this one.' : 'Already handled.', status: it.status, by: it.decided_by || '' }, 409);
  const now = new Date().toISOString();
  if (action === 'skip') {
    const r = await env.DB.prepare("UPDATE app_items SET status = 'skipped', decided_at = ?1, decided_by = ?2, hq_synced = 0, updated = ?1 WHERE id = ?3 AND client_id = ?4 AND status = 'pending'")
      .bind(now, by, id, c.client_id).run();
    if (!changed(r)) return aj({ ok: false, error: 'Already handled.' }, 409);
    ctx.waitUntil(decisionPing(env, c, it, 'skipped', by));
    return aj({ ok: true, status: 'skipped', at: now });
  }
  const edited = b.text == null ? '' : clean(b.text, 3000);
  const r = await approveItem(env, ctx, c, it, edited, by);
  return aj(r.body, r.status);
}

// The one approve path: the owner's tap, the notification button, and Full Max all go through here. Guard runs every time.
export async function approveItem(env, ctx, c, it, edited, by) {
  const now = new Date().toISOString();
  const finalText = (edited || String(it.text || '')).trim();
  if (!finalText) return { status: 400, body: { ok: false, error: 'The text is empty.' } };
  const hits = guard(finalText, c, it.kind);
  if (hits.length) return { status: 422, body: { ok: false, error: 'Please change the flagged words first.', hits } };
  const r = await env.DB.prepare("UPDATE app_items SET status = 'approved', decided_text = ?1, decided_at = ?2, decided_by = ?3, hq_synced = 0, checked = ?4, updated = ?2 WHERE id = ?5 AND client_id = ?6 AND status = 'pending'")
    .bind(finalText, now, by, 1, it.id, c.client_id).run();
  if (!changed(r)) return { status: 409, body: { ok: false, error: 'Already handled.' } };
  const later = p => (ctx && ctx.waitUntil ? ctx.waitUntil(p) : p.catch(() => {}));
  later(decisionPing(env, c, it, finalText === String(it.text || '').trim() ? 'approved' : 'approved with changes', by));
  if (it.kind === 'reviewreq') later(sendReviewRequest(env, c, it, finalText).catch(() => {}));
  if (it.kind === 'invoice') later(sendInvoiceReminder(env, c, it, finalText, (to, s, x) => mailTo(env, to, s, x, c.business)).catch(() => {}));
  if (it.kind === 'post' && /^https:\/\/alwaysopenoffice\.com\/p\/[A-Za-z0-9]{32}$/.test(it.photo || '')) later(metaPublish(env, c.client_id, finalText, it.photo).catch(() => {}));
  // Once Google has approved our access, the approved reply or post goes straight to the client's Google profile.
  if (it.kind === 'post' || it.kind === 'reply' || it.kind === 'review' || !it.kind) later(publishItem(env, c, Object.assign({}, it, { decided_at: now }), finalText).catch(() => {}));
  return { status: 200, body: { ok: true, status: 'approved', at: now, edited: finalText !== String(it.text || '').trim() } };
}

async function apiMessage(req, env, ctx, c) {
  const b = await readJson(req, 8000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const kind = b.kind === 'hours' ? 'hours' : 'note';
  let text = clean(b.text, 1000);
  const by = whoBy(c, b.by);
  if (!text) return aj({ ok: false, error: 'Type a message first.' }, 400);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_messages WHERE client_id = ?1 AND dir = 'in' AND at > ?2")
    .bind(c.client_id, new Date(Date.now() - 3600000).toISOString()).first();
  if (n && n.n >= MSG_PER_HOUR) return aj({ ok: false, error: 'That is a lot of messages in an hour. Please call or email us instead.' }, 429);
  if (kind === 'hours') text = 'Hours change: ' + text;
  const at = new Date().toISOString();
  const ins = await env.DB.prepare("INSERT INTO app_messages (client_id, at, by, text, hq_synced, dir, notified) VALUES (?1, ?2, ?3, ?4, 0, 'in', 1)")
    .bind(c.client_id, at, by, text).run();
  const id = ins && ins.meta && ins.meta.last_row_id;
  // "Got it, Katie will reply by …" so nobody wonders whether it went through (checks.js; once every 4 hours at most).
  try { await (await import('./checks.js')).ackMessage(env, c.client_id, by); } catch (e) { /* the message itself is saved */ }
  const title = (kind === 'hours' ? 'Hours change from ' : 'Message from ') + (c.business || 'a client');
  ctx.waitUntil(Promise.all([
    ntfy(env, title, by + ': ' + text.slice(0, 700), kind === 'hours' ? 'high' : 'default', kind === 'hours' ? 'clock4' : 'speech_balloon'),
    mail(env, title, [by + ' at ' + (c.business || 'a client') + ' wrote in the Always Open app:', '', text, '', 'Answer from Always Open HQ (Clients, Client app) so it shows in their app.'].join('\r\n'))
  ]));
  return aj({ ok: true, id, at, text });
}

async function apiJob(req, env, ctx, c) {
  if (!features(c).jobs) return aj({ ok: false, error: 'Review requests after each job come with the Growth and Pro plans.' }, 403);
  const b = await readJson(req, 4000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const first = oneLine(clean(b.first, 40));
  const phone = String(b.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const job = oneLine(clean(b.job, 80));
  const by = whoBy(c, b.by);
  if (!first) return aj({ ok: false, error: "Add the customer's first name." }, 400);
  const email = oneLine(clean(b.email, 120)).toLowerCase();
  if (email && !reviewReqValid(email)) return aj({ ok: false, error: 'That email does not look right.' }, 400);
  if (!phone && !email) return aj({ ok: false, error: 'Add a 10-digit cell number or an email.' }, 400);
  if (phone && !/^[2-9]\d{2}[2-9]\d{6}$/.test(phone)) return aj({ ok: false, error: 'Add a 10-digit cell number.' }, 400);
  if (b.consent !== true) return aj({ ok: false, error: 'Check the box only if they agreed to hear from you. Without it we can’t send anything.' }, 400);
  if (email && !phone) {
    const q = await queueReviewRequest(env, c, first, email, job, by);
    if (!q.ok) return aj(q, 400);
    if (q.duplicate) return aj(q);
    return aj({ ok: true, at: new Date().toISOString(), draft: true, message: 'The email is drafted. Approve it in Approve and it goes out.' });
  }
  if (email) ctx.waitUntil(queueReviewRequest(env, c, first, email, job, by).catch(() => {}));
  const day = new Date(Date.now() - 86400000).toISOString();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_jobs WHERE client_id = ?1 AND at > ?2').bind(c.client_id, day).first();
  if (n && n.n >= JOBS_PER_DAY) return aj({ ok: false, error: 'That is the most for one day. Send the rest tomorrow.' }, 429);
  const dup = await env.DB.prepare("SELECT id FROM app_jobs WHERE client_id = ?1 AND phone = ?2 AND at > ?3")
    .bind(c.client_id, phone, new Date(Date.now() - 60 * 86400000).toISOString()).first();
  if (dup) return aj({ ok: true, duplicate: true, message: 'Already on the list. Each customer gets one request.' });
  const at = new Date().toISOString();
  await env.DB.prepare('INSERT INTO app_jobs (client_id, at, first, phone, job, by, consent, hq_synced) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0)')
    .bind(c.client_id, at, first, phone, job, by).run();
  ctx.waitUntil(throttledPing(env, c, 'Finished job from ' + (c.business || 'a client'), 'A review request is waiting in Always Open HQ, Reviews.'));
  let checkin = false;
  if (b.callOk === true) { try { checkin = !!(await scheduleCheckin(env, c, first, phone, job)); } catch (e) {} }
  return aj({ ok: true, at, checkin, message: checkin ? 'Added. Max checks in with them in three days.' : undefined });
}

// The owner's own greeting, recorded on their phone (WAV or MP3, up to about 15 seconds). Twilio plays it first; Max still says
// he is an S.I. and the call may be recorded right after it, because a recording can't be trusted to say so.
const AUDIO_MAX = 700000;
async function apiGreetingAudio(req, env, c) {
  if (c.staff) return aj({ ok: false, error: 'Only the owner can change the greeting.' }, 403);
  const raw = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(c.client_id).first();
  if (!raw) return aj({ ok: false, error: 'You don\u2019t have a phone line yet.' }, 403);
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const mime = /^audio\/(wav|x-wav|wave)$/.test(type) ? 'audio/wav' : (/^audio\/(mpeg|mp3)$/.test(type) ? 'audio/mpeg' : '');
  if (!mime) return aj({ ok: false, error: 'Send a WAV or MP3 recording.' }, 415);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > AUDIO_MAX) return aj({ ok: false, error: 'That recording is too long. Keep it under 15 seconds.' }, 413);
  if (buf.byteLength < 2000) return aj({ ok: false, error: 'That recording did not come through. Try again.' }, 400);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS line_audio (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, mime TEXT, data BLOB, created TEXT)").run();
  const o = parse(raw.owner_set) || {}, id = token(32), at = new Date().toISOString();
  if (o.greetAudio) await env.DB.prepare('DELETE FROM line_audio WHERE id = ?1').bind(o.greetAudio).run().catch(() => {});
  await env.DB.prepare('INSERT INTO line_audio (id, client_id, mime, data, created) VALUES (?1,?2,?3,?4,?5)').bind(id, c.client_id, mime, new Uint8Array(buf), at).run();
  o.greetAudio = id; o.at = at;
  await env.DB.prepare('UPDATE voice_lines SET owner_set = ?1 WHERE number = ?2').bind(JSON.stringify(o), raw.number).run();
  return aj({ ok: true, line: lineOut(Object.assign({}, raw, { owner_set: JSON.stringify(o) }), c) });
}
export async function audioGet(env, url) {
  const id = url.pathname.slice(3).replace(/\.(wav|mp3)$/, '');
  if (!/^[A-Za-z0-9]{32}$/.test(id)) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT mime, data FROM line_audio WHERE id = ?1').bind(id).first().catch(() => null);
  if (!row || !row.data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { 'content-type': row.mime || 'audio/wav', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}
async function apiPhoto(req, env, ctx, c, url) {
  if (!features(c).photos) return aj({ ok: false, error: 'Posts from your photos come with the Growth and Pro plans.' }, 403);
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return aj({ ok: false, error: 'Send a JPEG or PNG photo.' }, 415);
  const len = +(req.headers.get('content-length') || 0);
  if (len > PHOTO_MAX) return aj({ ok: false, error: 'That photo is too big. Try another one.' }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > PHOTO_MAX) return aj({ ok: false, error: 'That photo is too big. Try another one.' }, 413);
  if (buf.byteLength < 300) return aj({ ok: false, error: 'That photo did not come through. Try again.' }, 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_photos WHERE client_id = ?1 AND at > ?2')
    .bind(c.client_id, new Date(Date.now() - 86400000).toISOString()).first();
  if (n && n.n >= PHOTOS_PER_DAY) return aj({ ok: false, error: 'That is the most photos for one day. Send more tomorrow.' }, 429);
  const note = clean(url.searchParams.get('note'), 300);
  const by = whoBy(c, url.searchParams.get('by'));
  const id = token(32), at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_photos (id, client_id, at, note, by, mime, size, data, status, hq_synced) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'new', 0)")
    .bind(id, c.client_id, at, note, by, type, buf.byteLength, buf).run();
  ctx.waitUntil(ntfy(env, 'New photo from ' + (c.business || 'a client'), (note ? by + ': ' + note : by + ' sent a photo for a post.'), 'default', 'camera', SITE + '/p/' + id));
  return aj({ ok: true, at });
}

async function apiDevice(req, env, c) {
  const b = await readJson(req, 2000);
  if (!b) return aj({ ok: false, error: 'Bad request' }, 400);
  const tok = String(b.token || '').toLowerCase();
  if (!/^[0-9a-f]{64,200}$/.test(tok)) return aj({ ok: false, error: 'Bad token' }, 400);
  if (b.remove === true) {
    await env.DB.prepare('DELETE FROM app_devices WHERE token = ?1 AND client_id = ?2').bind(tok, c.client_id).run();
    return aj({ ok: true, removed: true });
  }
  await ensureDeviceLinks(env);
  // Live Activity tokens: 'start' (push-to-start, one per phone) or 'update' (one per running activity, tied to a call).
  if (b.live === 'start' || b.live === 'update') {
    await ensureLive(env);
    await env.DB.prepare("INSERT INTO app_live (token, client_id, kind, call_sid, env, updated, code_hash) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(token) DO UPDATE SET client_id = ?2, kind = ?3, call_sid = ?4, env = ?5, updated = ?6, code_hash = ?7")
      .bind(tok, c.client_id, b.live, String(b.call || '').slice(0, 64), b.env === 'sandbox' ? 'sandbox' : 'production', new Date().toISOString(), c.linkHash || '').run();
    return aj({ ok: true });
  }
  const now = new Date().toISOString();
  // The phone is tied to the link it signed in with: when HQ removes that staff member, replaces a leaked code or turns
  // the client off, that phone stops getting this business's notifications (devicesFor).
  await env.DB.prepare("INSERT INTO app_devices (token, client_id, platform, env, created, last_seen, code_hash) VALUES (?1, ?2, 'ios', ?3, ?4, ?4, ?5) ON CONFLICT(token) DO UPDATE SET client_id = ?2, env = ?3, last_seen = ?4, code_hash = ?5")
    .bind(tok, c.client_id, b.env === 'sandbox' ? 'sandbox' : 'production', now, c.linkHash || '').run();
  await env.DB.prepare('DELETE FROM app_devices WHERE client_id = ?1 AND token NOT IN (SELECT token FROM app_devices WHERE client_id = ?1 ORDER BY last_seen DESC LIMIT 20)')
    .bind(c.client_id).run();
  return aj({ ok: true });
}

// ---------- the month, on one page (insights.js + monthpage.js) ----------
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const labelOf = ym => MONTH_NAMES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
const prevYm = ym => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
async function storedA(env, cid, ym) {
  const row = await env.DB.prepare('SELECT data FROM app_months WHERE client_id = ?1 AND month = ?2').bind(cid, ym).first().catch(() => null);
  const d = parse(row && row.data) || null;
  return d && d.a ? Object.assign({ label: d.label || labelOf(ym) }, d.a) : null;
}
// One month's analytics for a client: whole past months from the report (or worked out now for older ones), or this
// month from the 1st in the business's own time to now. Techs never see money.
export async function monthFor(env, c, which, now) {
  now = now || Date.now();
  const { tzFor, local, fromLocal } = await import('./callbacks.js');
  const tz = await tzFor(env, c.client_id);
  const mtd = which === 'now', ym = mtd ? local(tz, now).day.slice(0, 7) : which;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const start = new Date(fromLocal(tz, ym + '-01', 0, 0)).toISOString();
  const nextYm = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 7);
  const end = mtd ? new Date(now).toISOString() : new Date(fromLocal(tz, nextYm + '-01', 0, 0)).toISOString();
  const row = mtd ? null : await env.DB.prepare('SELECT data FROM app_months WHERE client_id = ?1 AND month = ?2').bind(c.client_id, ym).first().catch(() => null);
  const d = parse(row && row.data) || {};
  let a = d.a || null, money = null;
  if (!a) {
    try { money = mtd ? (await (await import('./money.js')).moneyState(env, c.client_id, now)).thisMonth : await (await import('./money.js')).caughtFor(env, c.client_id, Date.parse(ym + '-15T12:00:00Z')); } catch (e) { money = null; }
    a = await monthAnalytics(env, c.client_id, start, end, { tz, prev: await storedA(env, c.client_id, prevYm(ym)), money, regulated: !!+c.regulated });
  }
  if (c.role === 'tech') a = Object.assign({}, a, { worth: null, work: Object.assign({}, a.work, { won: { n: a.work.won.n, amount: 0 }, followups: Object.assign({}, a.work.followups, { quoteAmount: 0 }) }) });
  let stats = numbersOnly(d.stats) || {};
  if (mtd || stats.posts == null) {
    const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND kind = 'post' AND status IN ('approved', 'closed') AND COALESCE(decided_at, created) >= ?2 AND COALESCE(decided_at, created) < ?3").bind(c.client_id, start, end).first().catch(() => null);
    stats = Object.assign({}, stats, { posts: +(p && p.n) || 0, replies: a.reviews.replied });
  }
  return { month: ym, label: d.label || labelOf(ym), mtd, a, stats, record: !!(d.record && (d.record.revs || d.record.posts)), through: mtd ? local(tz, now).day : '' };
}
async function monthPageFor(env, c, which, base) {
  const m = await monthFor(env, c, which);
  if (!m) return gone(404);
  const sent = m.mtd ? 'through ' + new Date(Date.parse(m.through + 'T12:00:00Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  let since = '';
  try { const T = await import('./trends.js'); since = T.sinceLine((await T.trendsFor(env, c)).since, { noMoney: c.role === 'tech' || !!+c.regulated }); } catch (e) { since = ''; }
  const html = renderMonthPage({ business: c.business || '', label: m.label, mtd: m.mtd, sentText: sent, regulated: !!+c.regulated, a: m.a, stats: m.stats, back: base, record: m.record ? base + '/record/' + m.month : '', year: base + '/year', since });
  return new Response(html, { headers: { ...H, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
}
async function yearPageFor(env, c, base) {
  const t = await (await import('./trends.js')).trendsFor(env, c);
  const html = (await import('./yearpage.js')).renderYearPage({ business: c.business || '', back: base, month: base + '/month/now', t, regulated: !!+c.regulated });
  return new Response(html, { headers: { ...H, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
}
// The Home card's numbers: this month so far, short.
function monthNowOut(m) {
  if (!m) return null;
  const a = m.a, w = a.work;
  return { month: m.month, label: m.label, calls: a.calls.n, after: a.calls.after, leads: a.calls.leads + w.requests, booked: w.bookedCalls + w.fill.booked,
    reviews: a.reviews.n, replied: a.reviews.replied, followups: w.followups.done, posts: m.stats.posts || 0, checkYes: w.checkins.yes, checkNo: w.checkins.no,
    worth: a.worth ? a.worth.mid : 0, insight: (a.insights[0] && a.insights[0].t) || '', page: '/month/now', year: '/year' };
}

// ---------- the monthly record, as a page they can save as a PDF ----------
async function recordPage(env, c, month, base) {
  if (!/^\d{4}-\d{2}$/.test(month)) return gone(404);
  const row = await env.DB.prepare('SELECT data FROM app_months WHERE client_id = ?1 AND month = ?2').bind(c.client_id, month).first();
  const d = parse(row && row.data) || {};
  const r = d.record || null;
  const label = d.label || month;
  const item = x => '<div class="it"><b>' + esc([x.d, x.head].filter(Boolean).join(' · ')) + '</b>' + (x.q ? '<p class="q">' + esc(x.q) + '</p>' : '') + (x.t ? '<p>' + esc(x.t) + '</p>' : '') + (x.by ? '<p class="by">' + esc(x.by) + '</p>' : '') + '</div>';
  const revs = r && Array.isArray(r.revs) ? r.revs : [], posts = r && Array.isArray(r.posts) ? r.posts : [];
  const body = !r ? '<p class="empty">The record for ' + esc(label) + ' is not ready yet. It is made in the first days of the next month.</p>' :
    '<p class="box">' + esc(r.intro || '') + '</p>' + (r.cg ? '<p class="box">' + esc(r.cg) + '</p>' : '') +
    '<h2>Reviews and replies (' + revs.length + ')</h2>' + (revs.length ? revs.map(item).join('') : '<p class="empty">No reviews this month.</p>') +
    '<h2>Posts (' + posts.length + ')</h2>' + (posts.length ? posts.map(item).join('') : '<p class="empty">No posts recorded this month.</p>');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Record ' + esc(label) + ' · ' + esc(c.business || '') + '</title>' +
    '<style>:root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#fff;--soft:#F5F4F0}' +
    '@media (prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--soft:#1A1F2B}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    'main{max-width:760px;margin:0 auto;padding:24px 16px 48px}.top{display:flex;justify-content:space-between;gap:12px;font:500 12px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--slate);border-bottom:2px solid var(--ink);padding-bottom:8px}' +
    'h1{font-size:1.8rem;margin:18px 0 0;line-height:1.1}.sub{color:var(--slate);margin:4px 0 16px}h2{font-size:1.15rem;margin:26px 0 8px}' +
    '.box{background:var(--soft);border-radius:10px;padding:12px 14px;margin:10px 0}.it{border-top:1px solid var(--line);padding:10px 0}.it p{margin:4px 0}.q{color:var(--slate)}.by{font:12.5px ui-monospace,Menlo,monospace;color:var(--slate)}' +
    '.empty{color:var(--slate)}.bar{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}.bar button,.bar a{font:600 15px system-ui,sans-serif;padding:10px 16px;border-radius:10px;border:2px solid var(--ink);background:transparent;color:var(--ink);text-decoration:none;cursor:pointer}' +
    '.bar button{background:#D92D20;border-color:#D92D20;color:#fff}@media print{.bar{display:none}body{background:#fff;color:#000}.box{background:#f3f3f3}}</style></head><body><main>' +
    '<div class="bar"><button type="button" id="pdf">Save as PDF</button><a href="' + esc(base) + '">Back to the app</a></div>' +
    '<div class="top"><span>Always Open</span><span>Record of public communications</span></div>' +
    '<h1>' + esc(c.business || '') + '</h1><p class="sub">' + esc(label) + '</p>' + body +
    (r && r.made ? '<p class="by" style="margin-top:28px">Prepared by Always Open on ' + esc(r.made) + '.</p>' : '') +
    '</main><script>document.getElementById("pdf").addEventListener("click",function(){window.print();});</script></body></html>';
  return new Response(html, { headers: { ...H, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP } });
}

function manifest(base) {
  const m = {
    name: 'Always Open', short_name: 'Always Open', id: base, start_url: base, scope: base,
    display: 'standalone', background_color: '#F5F4F0', theme_color: '#D92D20',
    description: 'Approve replies and posts, see your month, and message Always Open.',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(m), { headers: { ...H, 'content-type': 'application/manifest+json' } });
}

// ---------- cron: iPhone notifications and tidying ----------
export async function appCron(env, at) {
  const now = at || Date.now();
  try {
    const items = await env.DB.prepare("SELECT id, client_id, kind, title, text FROM app_items WHERE status = 'pending' AND notified = 0 ORDER BY created LIMIT 200").all();
    const msgs = await env.DB.prepare("SELECT id, client_id, text FROM app_messages WHERE dir = 'out' AND notified = 0 ORDER BY id LIMIT 200").all();
    const byClient = {};
    for (const it of (items.results || [])) (byClient[it.client_id] = byClient[it.client_id] || { items: [], msgs: [] }).items.push(it);
    for (const m of (msgs.results || [])) (byClient[m.client_id] = byClient[m.client_id] || { items: [], msgs: [] }).msgs.push(m);
    const ready = !!(env.APNS_KEY && env.APNS_KEY_ID);
    for (const cid of Object.keys(byClient)) {
      const g = byClient[cid];
      if (ready) {
        const devs = await devicesFor(env, cid);
        if (devs.length) {
          const notes = [];
          // Up to 3 waiting items each get their own notification with an Approve button; more than that, one summary.
          if (g.items.length >= 1 && g.items.length <= 3) for (const it of g.items) {
            notes.push({ aps: { alert: { title: it.kind === 'post' ? 'A post is ready for your OK' : (it.kind === 'invoice' ? 'An invoice reminder is ready for your OK' : (it.kind === 'reviewreq' ? 'A review request is ready for your OK' : 'A review reply is ready for your OK')), body: ((it.title ? it.title + '\n' : '') + (it.kind === 'review' || !it.kind ? 'Our reply: ' : '') + String(it.text || '')).slice(0, 900) }, sound: 'default', category: 'APPROVE', 'thread-id': 'approve' }, item: it.id, kind: it.kind });
          } else if (g.items.length > 1) {
            notes.push({ aps: { alert: { title: g.items.length + ' things are ready for your OK', body: 'Review replies and posts from Always Open. Open the app to approve.' }, sound: 'default', 'thread-id': 'approve' } });
          }
          for (const m of g.msgs.slice(-3)) notes.push({ aps: { alert: { title: 'Always Open', body: String(m.text || '').slice(0, 900) }, sound: 'default', 'thread-id': 'messages' }, screen: 'ask' });
          for (const n of notes) for (const d of devs) await apnsSend(env, d, n);
        }
      }
      await markNotified(env, 'app_items', g.items.map(x => x.id));
      await markNotified(env, 'app_messages', g.msgs.map(x => x.id));
    }
  } catch (e) { /* the next run tries again */ }
  // Follow-ups due today (Eastern time) or earlier: one reminder to the owner's phone each, sent between 8 AM and 8 PM
  try {
    const et = eastern(now);
    if (et.hour >= 8 && et.hour < 20) await remindFollowups(env, now, et.day);
  } catch (e) { /* the next run tries again */ }
  try {
    // Photos stay 60 days. A finished job's phone number is cleared a week after HQ has it.
    await env.DB.prepare('DELETE FROM app_photos WHERE at < ?1').bind(new Date(now - 60 * 86400000).toISOString()).run();
    await env.DB.prepare("UPDATE app_jobs SET phone = '' WHERE hq_synced = 1 AND phone != '' AND at < ?1").bind(new Date(now - 7 * 86400000).toISOString()).run();
    await env.DB.prepare('DELETE FROM app_fail WHERE at < ?1').bind(new Date(now - 86400000).toISOString()).run();
  } catch (e) { /* ignore */ }
}

// The day and hour in Eastern time (most clients are in Georgia).
function eastern(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}

async function remindFollowups(env, now, today) {
  await ensureAuto(env);
  const due = await env.DB.prepare("SELECT id, client_id, kind, name, amount, consent, auto_conf, auto_rem, auto_fu FROM app_followups WHERE status = 'open' AND due != '' AND due <= ?1 AND (reminded IS NULL OR reminded = '') ORDER BY due LIMIT 100").bind(today).all();
  const by = {};
  for (const r of (due.results || [])) (by[r.client_id] = by[r.client_id] || []).push(r);
  // Customers who said yes to texts get ours (autotext.js), so the owner isn't asked to send the same one. One we
  // couldn't send (they opted out, the text failed) comes back to the owner here, and the app says why (autoFail).
  const ours = x => +x.consent && !autoFail(x);
  for (const cid of Object.keys(by)) {
    if (!by[cid].some(ours)) continue;
    const cl = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(cid).first().catch(() => null);
    if (cl && await autoReady(env, cl).catch(() => false)) { by[cid] = by[cid].filter(x => !ours(x)); if (!by[cid].length) delete by[cid]; }
  }
  const ready = !!(env.APNS_KEY && env.APNS_KEY_ID);
  for (const cid of Object.keys(by)) {
    const list = by[cid];
    if (ready) {
      const devs = await devicesFor(env, cid);
      const one = list[0], label = (({ quote: 'Quote', invoice: 'Invoice', appointment: 'Appointment' })[one.kind] || 'Follow-up') + ' for ' + one.name + (one.amount ? ' (' + one.amount + ')' : '');
      const note = list.length === 1 ? { aps: { alert: { title: 'Follow up today', body: label + '. Tap to text them.' }, sound: 'default', 'thread-id': 'followups' }, screen: 'home' }
        : { aps: { alert: { title: list.length + ' follow-ups due', body: label + ' and ' + (list.length - 1) + ' more. Tap to see them.' }, sound: 'default', 'thread-id': 'followups' }, screen: 'home' };
      for (const d of devs) await apnsSend(env, d, note);
    }
    const ph = list.map((_, i) => '?' + (i + 2)).join(',');
    await env.DB.prepare('UPDATE app_followups SET reminded = ?1 WHERE id IN (' + ph + ')').bind(new Date(now).toISOString(), ...list.map(x => x.id)).run();
  }
}

async function markNotified(env, table, ids) {
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    await env.DB.prepare('UPDATE ' + table + ' SET notified = 1 WHERE id IN (' + part.map((_, j) => '?' + (j + 1)).join(',') + ')').bind(...part).run();
  }
}

let jwtCache = null;
export async function apnsJwt(env) {
  if (jwtCache && Date.now() - jwtCache.at < 40 * 60000) return jwtCache.jwt;
  const pem = String(env.APNS_KEY).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'ES256', kid: env.APNS_KEY_ID }) + '.' + enc({ iss: env.APNS_TEAM_ID || TEAM, iat: Math.floor(Date.now() / 1000) });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head));
  jwtCache = { jwt: head + '.' + b64url(new Uint8Array(sig)), at: Date.now() };
  return jwtCache.jwt;
}
async function apnsSend(env, dev, payload) {
  try {
    const host = dev.env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const r = await fetch(host + '/3/device/' + dev.token, {
      method: 'POST',
      headers: { authorization: 'bearer ' + await apnsJwt(env), 'apns-topic': BUNDLE, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.status === 410 || r.status === 400) {
      const t = await r.text();
      if (r.status === 410 || /BadDeviceToken|DeviceTokenNotForTopic/.test(t)) await env.DB.prepare('DELETE FROM app_devices WHERE token = ?1').bind(dev.token).run();
    }
  } catch (e) { /* one bad send never stops the rest */ }
}

const liveReady = new WeakSet();
async function ensureLive(env) {
  if (liveReady.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_live (token TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT NOT NULL, call_sid TEXT DEFAULT '', env TEXT DEFAULT 'production', updated TEXT, code_hash TEXT DEFAULT '')").run();
  liveReady.add(env.DB);
}
// Phone tokens remember the link (code hash) they signed in with. Only phones whose link still opens this business get
// its notifications: the owner's current link, a staff link HQ hasn't removed, or the owner's link of another location in
// the same group. A client that is turned off gets none. Tokens from before this was kept have no link and get none
// until the app opens once and sends its token again.
const devReady = new WeakSet();
async function ensureDeviceLinks(env) {
  if (devReady.has(env.DB)) return;
  await ensureLive(env);
  await ensureLocations(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_staff (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT, created TEXT)').run();
  for (const t of ['app_devices', 'app_live']) { try { await env.DB.prepare('ALTER TABLE ' + t + " ADD COLUMN code_hash TEXT DEFAULT ''").run(); } catch (e) { /* already there */ } }
  devReady.add(env.DB);
}
// A phone registered before links were recorded (code_hash '') keeps getting pushes while the client is active, as it
// always did: the iPhone app only sends its token again when it is linked, so cutting those off would silently stop
// every existing owner's pushes. Each new registration records its link and is held to it.
const LINK_OK = "c.active = 1 AND (COALESCE(d.code_hash, '') = '' OR d.code_hash = c.code_hash" +
  ' OR EXISTS (SELECT 1 FROM app_staff s WHERE s.code_hash = d.code_hash AND s.client_id = d.client_id)' +
  ' OR EXISTS (SELECT 1 FROM app_clients o JOIN app_locations lo ON lo.client_id = o.client_id JOIN app_locations ld ON ld.group_id = lo.group_id WHERE o.code_hash = d.code_hash AND o.active = 1 AND ld.client_id = d.client_id))';
async function devicesFor(env, cid) {
  try {
    await ensureDeviceLinks(env);
    return ((await env.DB.prepare('SELECT d.token, d.env FROM app_devices d JOIN app_clients c ON c.client_id = d.client_id WHERE d.client_id = ?1 AND ' + LINK_OK).bind(cid).all()).results) || [];
  } catch (e) { return []; }
}
async function liveFor(env, cid, kind, callSid) {
  try {
    await ensureDeviceLinks(env);
    return ((await env.DB.prepare('SELECT d.token, d.env FROM app_live d JOIN app_clients c ON c.client_id = d.client_id WHERE d.client_id = ?1 AND d.kind = ?2' + (callSid == null ? '' : ' AND d.call_sid = ?3') + ' AND ' + LINK_OK).bind(...(callSid == null ? [cid, kind] : [cid, kind, callSid])).all()).results) || [];
  } catch (e) { return []; }
}
// Live Activity push (lock screen and Dynamic Island while Max is on a call). event: start | update | end.
async function liveSend(env, dev, event, state, attrs, alert, dismissAt) {
  try {
    const host = dev.env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const aps = { timestamp: Math.floor(Date.now() / 1000), event, 'content-state': state };
    if (event === 'start') { aps['attributes-type'] = 'CallAttributes'; aps.attributes = attrs; }
    if (alert) aps.alert = alert;
    if (dismissAt) aps['dismissal-date'] = Math.floor(dismissAt / 1000);
    const r = await fetch(host + '/3/device/' + dev.token, { method: 'POST', headers: { authorization: 'bearer ' + await apnsJwt(env), 'apns-topic': BUNDLE + '.push-type.liveactivity', 'apns-push-type': 'liveactivity', 'apns-priority': '10', 'content-type': 'application/json' }, body: JSON.stringify({ aps }) });
    if (r.status === 410 || r.status === 400) { const t = await r.text(); if (r.status === 410 || /BadDeviceToken|DeviceTokenNotForTopic/.test(t)) await env.DB.prepare('DELETE FROM app_live WHERE token = ?1').bind(dev.token).run(); }
    return r.ok;
  } catch (e) { return false; }
}
// A call just started on this client's line: light up the lock screen on every phone that gave us a push-to-start token.
export async function liveCallStart(env, cid, callId, business, callerText) {
  if (!(env.APNS_KEY && env.APNS_KEY_ID)) return 0;
  await ensureLive(env);
  const devs = await liveFor(env, cid, 'start');
  for (const d of devs) await liveSend(env, d, 'start', { name: '', reason: 'Max has the call', caller: callerText || '', status: 'live' }, { business: business || '', callId }, { title: 'Max has a call', body: (callerText ? 'From ' + callerText + '. ' : '') + 'Keep going.' });
  return devs.length;
}
// The call ended: show the name, what they wanted, and let it fade after a few minutes.
export async function liveCallEnd(env, cid, callId, name, reason, summary, outcome) {
  if (!(env.APNS_KEY && env.APNS_KEY_ID)) return 0;
  await ensureLive(env);
  const devs = await liveFor(env, cid, 'update', callId);
  const st = { name: name || '', reason: reason || '', caller: '', status: outcome === 'hangup' ? 'hungup' : (outcome === 'failed' ? 'failed' : 'done'), summary: String(summary || '').slice(0, 240) };
  for (const d of devs) await liveSend(env, d, 'end', st, null, null, Date.now() + 10 * 60e3);
  await env.DB.prepare("DELETE FROM app_live WHERE kind = 'update' AND call_sid = ?1").bind(callId).run().catch(() => {});
  return devs.length;
}

// For the AI phone line: push a note to every phone signed in to this client's app. Returns how many phones.
export async function pushClient(env, cid, note) {
  if (!(env.APNS_KEY && env.APNS_KEY_ID)) return 0;
  const devs = await devicesFor(env, cid);
  for (const d of devs) await apnsSend(env, d, note);
  return devs.length;
}
// Mail to Chris only (calls to Always Open's own number). Returns 'sent', 'off' or 'failed: ...'.
export async function mailOwner(env, subject, text) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return 'off';
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const raw = [
    'From: "Always Open phone line" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + encodeHeader(oneLine(subject).slice(0, 140)),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'
  ].join('\r\n') + '\r\n\r\n' + text;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); return 'sent'; } catch (e) {
    const why = String((e && e.message) || e).slice(0, 180);
    try { await (await import('./ops.js')).opsAlert(env, 'mail-send', '', 'An email to you could not be sent: ' + why); } catch (x) {}
    return 'failed: ' + why;
  }
}
// loud: true only for the few things worth waking up for (push.js lets everything else arrive silently at night).
export async function opsPing(env, title, body, priority, tags, click, loud) { return ntfy(env, title, body, priority, tags, click, loud); }

// ---------- pings to Christopher ----------
async function decisionPing(env, c, it, what, by) {
  const kind = it.kind === 'post' ? 'a post' : 'a review reply';
  return throttledPing(env, c, (c.business || 'A client') + ': ' + by + ' ' + what + ' ' + kind, 'Open Always Open HQ to see it. Approved items are ready to post.');
}
async function throttledPing(env, c, title, body) {
  const now = new Date().toISOString();
  const r = await env.DB.prepare("UPDATE app_clients SET pushed_at = ?1 WHERE client_id = ?2 AND (pushed_at IS NULL OR pushed_at = '' OR pushed_at < ?3)")
    .bind(now, c.client_id, new Date(Date.now() - PUSH_GAP_MS).toISOString()).run();
  if (changed(r)) await ntfy(env, title, body, 'default', 'white_check_mark');
}
async function ntfy(env, title, body, priority, tags, click, loud) {
  // Straight to the phone, or queued for the Mac relay when ntfy refuses this server (see push.js).
  const { push } = await import('./push.js');
  return push(env, { title, body, priority: priority || 'default', tags: tags || 'bell', click, loud: !!loud });
}
// Mail to a client's customer (invoice reminders the owner approved). Returns 'sent', 'off' or 'failed'.
export async function mailTo(env, to, subject, text, biz, opts) {
  if (env.SEND_MAIL) {
    const msg = { to, from: { email: 'reminders@alwaysopenoffice.com', name: ascii(biz || 'Always Open').replace(/"/g, '').slice(0, 60) }, subject: oneLine(subject).slice(0, 140), text };
    const rt = opts && /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(opts.replyTo || '') ? opts.replyTo : '';
    try {
      await env.SEND_MAIL.send(rt ? Object.assign({ replyTo: rt }, msg) : msg);
      return 'sent';
    } catch (e) {
      if (rt) { try { await env.SEND_MAIL.send(msg); return 'sent'; } catch (e2) { /* fall through to the old path */ } }
    }
  }
  if (!env.EMAIL || !env.MAIL_FROM) return 'off';
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const raw = [
    'From: "' + ascii(biz || 'Always Open').replace(/"/g, '') + '" <' + env.MAIL_FROM + '>', 'To: <' + to + '>', 'Subject: ' + encodeHeader(oneLine(subject).slice(0, 140)),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'
  ].join('\r\n') + '\r\n\r\n' + text;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, to, raw)); return 'sent'; } catch (e) { await opsAlert(env, 'mail-send', '', 'A customer email could not be sent: ' + String((e && e.message) || e).slice(0, 200)); return 'failed'; }
}
async function mail(env, subject, text) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO) return;
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const raw = [
    'From: "Always Open app" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + encodeHeader(oneLine(subject).slice(0, 140)),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'
  ].join('\r\n') + '\r\n\r\n' + text;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); } catch (e) { /* the push still went */ }
}

// ---------- helpers ----------
export function features(c) {
  const growth = c.tier === 'Growth' || c.tier === 'Pro', pro = c.tier === 'Pro';
  const reg = !!+c.regulated;
  const extra = String(c.feats || '').split(',').map(s => s.trim()).filter(Boolean);
  const has = k => extra.indexOf(k) > -1;
  // follow-ups and text-back reach a business's own customers, so never for regulated clients (they never hand over customer data)
  return { jobs: growth && !reg, photos: growth && !reg, qr: /^https:\/\//.test(c.review_link || ''), hours: true, refer: true, calls: has('calls'),
    competitors: growth, followups: (pro || has('followups')) && !reg, textback: (pro || has('textback')) && !reg, tier: c.tier || '' };
}
function qrOut(q) {
  const m = String(q || '').match(/^(\d{2,3})\|([Mhvz0-9 .-]+)$/);
  return m ? { n: +m[1], d: m[2] } : null;
}
function gone(status) {
  const t = status === 429 ? 'Please wait a little' : (status === 500 ? 'Something went wrong' : 'This link is not working');
  const p = status === 429 ? 'Too many tries from this connection. Please wait an hour and try again.' :
    (status === 500 ? 'Please try again in a minute.' : 'Ask Always Open for a new link: email hello@alwaysopenoffice.com or call (706) 460-2226.');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Always Open</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F4F0;color:#171B26;font:17px/1.5 system-ui,-apple-system,sans-serif;padding:24px}@media (prefers-color-scheme:dark){body{background:#12151D;color:#EEF0F4}}div{max-width:420px}h1{font-size:1.5rem;margin:0 0 8px}a{color:inherit}</style></head>' +
    '<body><div><h1>' + t + '</h1><p>' + p + '</p><p><a href="/">alwaysopenoffice.com</a></p></div></body></html>';
  return new Response(html, { status, headers: { ...H, 'content-type': 'text/html; charset=utf-8' } });
}
function aj(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...H, 'content-type': 'application/json; charset=utf-8' } });
}
async function readJson(req, max) {
  const len = +(req.headers.get('content-length') || 0);
  if (len > max) return null;
  let t = '';
  try { t = await req.text(); } catch (e) { return null; }
  if (!t || t.length > max) return null;
  try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
}
function changed(r) { return !!(r && r.meta && r.meta.changes); }
// Who did it: a staff link is always its own name, whatever the body says; the owner may type theirs.
function whoBy(c, by) { return (c && c.staff) || oneLine(clean(by, 40)) || 'Owner'; }
// Month tiles are numbers (or null for "not known yet"). Anything else in stats (an HQ-written label, say) is dropped, because the
// iPhone app reads stats as numbers only and one string there used to make it throw the whole screen away.
function numbersOnly(o) {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v === null || (typeof v === 'number' && isFinite(v))) out[k] = v;
  return out;
}
function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }
function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max); }
function oneLine(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim(); }
function ascii(s) { return String(s).replace(/[^\x20-\x7E]/g, '').slice(0, 120); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function encodeHeader(s) {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = ''; for (const x of bytes) bin += String.fromCharCode(x);
  return '=?UTF-8?B?' + btoa(bin) + '?=';
}
function b64url(bytes) {
  let bin = ''; for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function token(n) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = [];
  const r = crypto.getRandomValues(new Uint8Array(n * 2));
  for (let i = 0; i < r.length && out.length < n; i++) if (r[i] < 248) out.push(abc[r[i] % 62]);
  while (out.length < n) out.push(abc[crypto.getRandomValues(new Uint8Array(1))[0] % 62]);
  return out.join('');
}
export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function ipKey(req, env) {
  return (await sha256hex((req.headers.get('cf-connecting-ip') || '') + '|' + (env.IP_SALT || 'salt'))).slice(0, 24);
}


// ---------- quote and booking requests: a public form per client at /q/<ref> ----------
// Customers of a client send what they need; the owner gets a push and sees it under New requests in the app.
export async function handleQuote(req, env, ctx, url) {
  const ref = decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, '');
  const c = /^[a-z0-9-]{3,40}$/.test(ref) ? await env.DB.prepare('SELECT client_id, business, ref, regulated FROM app_clients WHERE ref = ?1 AND active = 1').bind(ref).first() : null;
  const lang = langOf(req, url), T = (k, v) => tr(lang, k, v);
  if (!c) return quotePage(404, T('notFound'), '<p>' + T('notAvail') + '</p>', lang);
  await ensureLeads(env);
  if (req.method === 'GET') return quoteForm(c, '', null, lang, url);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const form = await req.formData();
  const val = (k, n) => String(form.get(k) || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
  const name = val('name', 80), phone = val('phone', 30), need = val('need', 1200), smsOk = form.get('sms_ok') === 'yes' ? 1 : 0;
  const t = +form.get('t') || 0, bot = val('website', 100);
  if (bot || (t && Date.now() - t < 2500)) return quotePage(200, T('thanks'), '<p>' + T('gotIt') + '</p>', lang);
  if (!name || phone.replace(/\D/g, '').length < 10 || need.length < 3) return quoteForm(c, T('errReq'), { name, phone, need }, lang, url);
  const ip = await ipKey(req, env), hour = new Date(Date.now() - 3600000).toISOString();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_leads WHERE ip_hash = ?1 AND at > ?2').bind(ip, hour).first();
  if (n && n.n >= 5) return quotePage(429, T('thanks'), '<p>' + esc(T('already', { b: c.business })) + '</p>', lang);
  const at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_leads (client_id, at, name, phone, need, sms_ok, status, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'new', ?7)").bind(c.client_id, at, name, phone, need, smsOk, ip).run();
  ctx.waitUntil(pushClient(env, c.client_id, { aps: { alert: { title: 'New request from ' + name, body: need.slice(0, 300) }, sound: 'default', 'thread-id': 'leads' }, screen: 'home' }).catch(() => {}));
  return quotePage(200, T('sent'), '<p>' + esc(T('sentLine', { n: name.split(' ')[0], b: c.business, t: smsOk ? T('orText') : '' })) + '</p>', lang);
}
function quoteForm(c, err, v, lang, url) {
  v = v || {}; lang = lang || 'en';
  const T = (k, x) => tr(lang, k, x);
  return quotePage(err ? 400 : 200, T('reqTitle', { b: c.business }), (url ? langBar(url, lang) : '') +
    '<p class="sub">' + esc(T('reqSub', { b: c.business })) + '</p>' + (err ? '<p class="err">' + esc(err) + '</p>' : '') +
    '<form method="post"><input type="hidden" name="t" value="' + Date.now() + '"><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<label>' + T('name') + '<input name="name" autocomplete="name" required value="' + esc(v.name || '') + '"></label>' +
    '<label>' + T('phone') + '<input name="phone" type="tel" autocomplete="tel" required value="' + esc(v.phone || '') + '"></label>' +
    '<label>' + T('need') + '<textarea name="need" rows="4" required>' + esc(v.need || '') + '</textarea></label>' +
    '<label class="opt"><input type="checkbox" name="sms_ok" value="yes"><span>' + T('smsReq') + '</span></label>' +
    '<button>' + T('sendReq') + '</button></form>' +
    '<p class="fine">' + esc(T('fineReq', { b: c.business })) + '</p>', lang);
}
function quotePage(status, title, inner, lang) {
  const html = '<!doctype html><html lang="' + (lang === 'es' ? 'es' : 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><meta name="robots" content="noindex">' +
    '<style>:root{--paper:#F5F4F0;--card:#fff;--ink:#171B26;--slate:#586075;--line:#DCDAD3;--red:#D92D20}@media (prefers-color-scheme:dark){:root{--paper:#12151D;--card:#1A1F2B;--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif;padding:24px 16px}main{max-width:480px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;display:grid;gap:14px}' +
    'h1{margin:0;font-size:1.6rem;line-height:1.15}.sub,.fine{color:var(--slate);margin:0}.fine{font-size:13px}.err{color:var(--red);margin:0;font-weight:600}form{display:grid;gap:12px}label{display:grid;gap:6px;font-weight:600}' +
    'input,textarea{font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink)}.opt{display:grid;grid-template-columns:22px 1fr;gap:10px;font-weight:500;font-size:14px;color:var(--slate)}.opt input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--red)}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px}button{font:700 16px system-ui,sans-serif;padding:14px;border:0;border-radius:11px;background:var(--red);color:#fff;cursor:pointer}</style></head><body><main><h1>' + esc(title) + '</h1>' + inner + '</main></body></html>';
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}

async function ensureLeads(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT, name TEXT, phone TEXT, need TEXT, sms_ok INTEGER DEFAULT 0, status TEXT DEFAULT 'new', done_at TEXT, ip_hash TEXT)").run();
}

async function ensureLocations(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_locations (client_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, label TEXT, sort INTEGER DEFAULT 0)').run();
}

// HQ links or unlinks locations: POST {group, client_id, label, sort} or {client_id, remove: true}, x-key = LEADS_KEY.
export async function handleLocations(req, env, keyOk) {
  if (!keyOk) return aj({ ok: false, error: 'not allowed' }, 403);
  await ensureLocations(env);
  if (req.method === 'GET') return aj({ ok: true, locations: (await env.DB.prepare('SELECT * FROM app_locations ORDER BY group_id, sort').all()).results || [] });
  let b = {}; try { b = await req.json(); } catch (e) {}
  const cid = String(b.client_id || '').slice(0, 80);
  if (!cid) return aj({ ok: false, error: 'client_id needed' }, 400);
  if (b.remove) { await env.DB.prepare('DELETE FROM app_locations WHERE client_id = ?1').bind(cid).run(); return aj({ ok: true, removed: cid }); }
  const grp = String(b.group || '').slice(0, 80);
  if (!grp) return aj({ ok: false, error: 'group needed' }, 400);
  await env.DB.prepare('INSERT INTO app_locations (client_id, group_id, label, sort) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(client_id) DO UPDATE SET group_id = excluded.group_id, label = excluded.label, sort = excluded.sort')
    .bind(cid, grp, String(b.label || '').slice(0, 80), Math.round(+b.sort || 0)).run();
  return aj({ ok: true, client_id: cid, group: grp });
}

async function ensureSettings(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_settings (client_id TEXT PRIMARY KEY, avg_job INTEGER DEFAULT 0, win_rate INTEGER DEFAULT 30, updated TEXT)').run();
}
