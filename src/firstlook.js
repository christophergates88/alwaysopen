// Two owner-first moments.
// 1) First look: right after payment (the welcome page) and on the app's first opens, the owner sees their audit score, the
//    top thing holding them back, and the one thing we'll do today, before any checklist. The audit is looked up live from
//    Google for that screen and not kept (Google's terms); only our own score is. Capped at a few lookups a day per business.
// 2) Share after the first good month: once a full month shows real wins in our own records (calls Max handled, bookings,
//    money paid), the owner gets one card to send their referral link to a friend. Never sends by itself; shown until they
//    share it or close it, then never again. Owner only.
import { runAudit } from './audit.js';

const SITE = 'https://alwaysopenoffice.com';
const DAILY_LOOKS = 3, SHOW_DAYS = 14;

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS firstlook_runs (client_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER DEFAULT 0, PRIMARY KEY (client_id, day))').run();
  ready = true;
}
async function onboardFlags(env, cid) {
  try { const r = await env.DB.prepare('SELECT onboard FROM biz_prefs WHERE client_id = ?1').bind(cid).first(); return JSON.parse((r && r.onboard) || '{}') || {}; } catch (e) { return {}; }
}
const markDone = async (env, cid, key) => { try { await (await import('./biz.js')).markOnboard(env, cid, key); } catch (e) {} };

// The one thing we'll do today: always something that works now, never a promise about later.
export function todayFor(s) {
  const reviewish = /review/i.test(s.findingTitle || '');
  if (reviewish && s.qr) return { key: 'qr', title: 'Your review card is ready', detail: 'Print it for the counter, the truck or the invoice. Every customer who scans it lands on your Google review page.', help: '/help/qr' };
  if (s.line && !s.forwarded) return { key: 'forward', title: 'Max is ready to answer your calls', detail: 'Forward the calls you miss to ' + s.lineText + ' and he answers them tonight. The steps for your phone take two minutes.', help: '/help/forwarding' };
  if (s.quoteLink) return { key: 'share', title: 'Your request link is live', detail: 'Customers can ask for a quote or book without calling. Put it on your Google profile and in your texts today.', link: s.quoteLink };
  return { key: 'app', title: 'Your app is ready', detail: 'Add it to your home screen. Everything we do for you lands there for your OK.' };
}

// Live audit for the first-look screen. Returns null when it can't or shouldn't run.
export async function firstLook(env, c, opts) {
  if (c.staff) return null;
  await ensure(env);
  const flags = await onboardFlags(env, c.client_id);
  if (!(opts && opts.force) && flags.firstlook) return null;
  const b = await env.DB.prepare('SELECT town, created FROM billing WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
  if (!(opts && opts.force) && b && b.created && Date.now() - Date.parse(b.created) > SHOW_DAYS * 864e5) return null;
  const line = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 AND on_air = 1 LIMIT 1').bind(c.client_id).first().catch(() => null);
  const d10 = line ? String(line.number).replace(/\D/g, '').slice(-10) : '';
  const base = { line: !!line, lineText: d10 ? '(' + d10.slice(0, 3) + ') ' + d10.slice(3, 6) + '-' + d10.slice(6) : '', forwarded: !!flags.forward, qr: /^https:\/\//.test(c.review_link || ''), quoteLink: c.ref ? SITE + '/q/' + encodeURIComponent(c.ref) : '' };
  let audit = null;
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare('SELECT n FROM firstlook_runs WHERE client_id = ?1 AND day = ?2').bind(c.client_id, day).first().catch(() => null);
  if (env.PLACES_KEY && c.business && (!used || +used.n < DAILY_LOOKS)) {
    await env.DB.prepare('INSERT INTO firstlook_runs (client_id, day, n) VALUES (?1, ?2, 1) ON CONFLICT(client_id, day) DO UPDATE SET n = n + 1').bind(c.client_id, day).run();
    try { audit = await Promise.race([runAudit(env, c.business, (b && b.town) || ''), new Promise(r => setTimeout(() => r(null), 8000))]); } catch (e) { audit = null; }
  }
  const top = audit && audit.found && audit.findings && audit.findings[0];
  const today = todayFor(Object.assign({ findingTitle: top ? top.title : '' }, base));
  return {
    found: !!(audit && audit.found), score: audit && audit.found ? audit.score : null, grade: audit && audit.found ? audit.grade : '',
    finding: top ? { title: top.title, saw: top.saw, fix: top.fix } : null,
    fine: audit && audit.found ? (audit.fine || []).slice(0, 2) : [],
    today, source: audit && audit.found ? 'Google Maps' : ''
  };
}

// ---------------- share after the first good month ----------------
function lastMonth(now) {
  const d = new Date(now), start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) };
}
// w.paid is whole dollars.
export function shareMessage(w, link) {
  const bits = [];
  if (w.calls) bits.push('Max picked up ' + w.calls + (w.calls === 1 ? ' call' : ' calls') + ' I couldn’t');
  if (w.bookings) bits.push(w.bookings + (w.bookings === 1 ? ' job got booked' : ' jobs got booked') + ' without me on the phone');
  if (w.paid) bits.push('$' + Math.round(w.paid).toLocaleString('en-US') + ' in invoices got paid');
  const what = bits.length ? 'Last month ' + bits.join(', ') + '.' : '';
  return ('I use Always Open for my business. ' + what + ' They start with a free audit of how you look online: ' + link + ' (If you sign up and stay three months, I get a month free.)').replace(/\s+/g, ' ').trim();
}
export async function shareState(env, c, refLink) {
  if (c.staff) return null;
  const flags = await onboardFlags(env, c.client_id);
  if (flags.share_month) return null;
  const b = await env.DB.prepare('SELECT created FROM billing WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
  const m = lastMonth(Date.now());
  if (!b || !b.created || b.created >= m.end) return null;   // no full month with us yet
  const one = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).first()) || {}; } catch (e) { return {}; } };
  const calls = await one("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome IN ('done','transferred','handoff')", c.client_id, m.start, m.end);
  const books = await one("SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND need LIKE 'Booked %'", c.client_id, m.start, m.end);
  const paid = await one("SELECT SUM(amount) AS s FROM app_invoices WHERE client_id = ?1 AND status = 'paid' AND paid_at >= ?2 AND paid_at < ?3", c.client_id, m.start, m.end);
  const w = { calls: +calls.n || 0, bookings: +books.n || 0, paid: Math.round((+paid.s || 0) / 100) };   // invoices are kept in cents
  if (!w.calls && !w.bookings && !w.paid) return null;   // only real wins
  return { month: m.label, wins: w, message: shareMessage(w, refLink), link: refLink };
}

// For the app's state (no Google lookup): should the app ask for the first look this session?
export async function firstLookDue(env, c) {
  if (c.staff) return false;
  const flags = await onboardFlags(env, c.client_id);
  if (flags.firstlook) return false;
  const b = await env.DB.prepare('SELECT created FROM billing WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
  return !!(b && b.created && Date.now() - Date.parse(b.created) <= SHOW_DAYS * 864e5);
}

// App: POST /api/firstlook {} -> the first-look screen (live). POST /api/firstlook {action:'done'|'share-done'} closes a card.
export async function apiFirstLook(req, env, c) {
  if (c.staff) return { ok: false, error: 'Only the owner sees this.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (b.action === 'done') { await markDone(env, c.client_id, 'firstlook'); return { ok: true }; }
  if (b.action === 'share-done') { await markDone(env, c.client_id, 'share_month'); return { ok: true }; }
  const f = await firstLook(env, c);
  return { ok: true, firstLook: f };
}
