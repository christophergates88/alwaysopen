// Google Calendar: the owner connects their calendar once; Max then offers real open times and books them.
// Only the calendar.events scope is used. Refresh tokens live in gcal_tokens (one row per client).
import { sha256hex } from './app.js';
import { sealToken, openToken } from './seal.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const REDIRECT = 'https://alwaysopenoffice.com/google/callback';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
// Google Business Profile (reviews, replies and posts on the owner's own profile): see gbp.js. Every Google connection comes
// back to the one callback address registered with Google (/google/callback); the state says which kind it was.
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

export async function ensureGcal(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS gcal_tokens (client_id TEXT PRIMARY KEY, refresh TEXT NOT NULL, tz TEXT, connected_at TEXT)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS gcal_codes (hash TEXT PRIMARY KEY, at INTEGER)').run();
}

async function hmac(env, data) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GOOGLE_CLIENT_SECRET || 'x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function ownerFor(env, code) {
  if (!code || code.length < 12) return null;
  return env.DB.prepare('SELECT client_id FROM app_clients WHERE code_hash = ?1 AND active = 1').bind(await sha256hex(code)).first();
}

function page(title, text, status) {
  return new Response('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>' + title + '</title><body style="font:17px system-ui;background:#0a0a0a;color:#fff;padding:32px;max-width:520px;margin:auto"><h2 style="color:#ff3b3b">' + title + '</h2><p>' + text + '</p></body>',
    { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
}

// Nov 24, 2026: the calendar connect is a hard block. /google/connect sets a cookie holding a random nonce and signs the
// same nonce into the state. Back at the callback, only a matching cookie connects: that proves the Google sign-in
// finished in the browser where the owner started it. Anything else (the link passed to someone else, a second browser,
// cookies switched off) connects nothing and never uses the Google code. There is no "Yes, connect it" button: a
// stranger who is sent the link cannot join their calendar to someone else's business, whatever they press.
// The cookie is named after its own nonce, so two connects started in two tabs do not knock each other out, and it lasts
// as long as the state does (an hour), so a slow sign-in with a second step is not refused for being slow.
const CB_COOKIE = 'ao_gcal_', STATE_MS = 3600e3;
const cookieOf = (req, name) => { for (const p of String(req.headers.get('cookie') || '').split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim(); } return ''; };
const cookieName = nonce => CB_COOKIE + String(nonce).slice(0, 12);
const setCookie = (nonce, maxAge) => cookieName(nonce) + '=' + (maxAge ? nonce : '') + '; Max-Age=' + maxAge + '; Path=/google/callback; Secure; HttpOnly; SameSite=Lax';
// The client and nonce a calendar state names, or null when its signature or age fails. A state from before the nonce
// (three parts) is refused like any other bad one.
async function calState(env, raw) {
  const st = String(raw || '').split('.');
  if (st.length !== 4 || !/^[0-9a-f]{32}$/.test(st[2])) return null;
  if (st[3] !== await hmac(env, st.slice(0, 3).join('.')) || !(Date.now() - +st[1] <= STATE_MS)) return null;
  return { cid: st[0], nonce: st[2] };
}
// Constant-time compare, so the nonce cannot be guessed a character at a time.
function same(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
// The stop page. It does not name the business the link was for: a stranger learns nothing, and has nothing to press.
async function blocked(env, cid, profile) {
  try { await (await import('./ops.js')).opsAlert(env, 'gcal-blocked', cid, 'A Google ' + (profile ? 'Business Profile' : 'Calendar') + ' connect ' + (cid ? 'for this client ' : 'from the HQ board ') + 'was stopped: the Google sign-in finished in a different browser from the one that started it. Nothing was connected.'); } catch (e) { /* the page still answers */ }
  return page('Not connected', 'This Google sign-in finished in a different browser from the one where it was started, so we stopped it. Nothing was connected and nothing was shared.</p>' +
    '<p>If this is your business: open Always Open, tap ' + (profile ? 'the Google connect button' : 'Connect Google Calendar') + ' again, and finish in the window that opens.</p><p>If someone sent you this link, you can close this page.', 403);
}
const newNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
// A Google code works once. Claim it in our own table first, so a second press or a refresh gets a plain answer, not an error.
async function claimCode(env, code) {
  await ensureGcal(env);
  await env.DB.prepare('DELETE FROM gcal_codes WHERE at < ?1').bind(Date.now() - 864e5).run().catch(() => {});
  const r = await env.DB.prepare('INSERT OR IGNORE INTO gcal_codes (hash, at) VALUES (?1, ?2)').bind(await sha256hex(code), Date.now()).run();
  return !!(r.meta && r.meta.changes);
}
async function finishCalendar(env, cid, code, nonce) {
  if (!(await claimCode(env, code))) return page('Link already used', 'That link was already used. Start again from your app.', 400);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) return page('Not connected', 'Google did not finish connecting. Please try again from the app.', 400);
  await ensureGcal(env);
  let tz = '';
  try { const e = await fetch(API + '?maxResults=1', { headers: { authorization: 'Bearer ' + j.access_token } }); tz = ((await e.json()) || {}).timeZone || ''; } catch (e) { /* set on first use */ }
  await env.DB.prepare('INSERT OR REPLACE INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES (?1, ?2, ?3, ?4)').bind(cid, await sealToken(env, 'gcal_tokens.refresh', j.refresh_token), tz, new Date().toISOString()).run();
  try { await (await import('./connections.js')).markOk(env, cid, 'calendar'); } catch (e) { /* fine */ }
  const ok = page('Calendar connected', 'Max can now offer open times from your Google Calendar and book them for callers. You can close this page and go back to the app.');
  ok.headers.set('set-cookie', setCookie(nonce, 0));
  return ok;
}

// The profile connect is bound to its browser the same way as the calendar (Nov 24, 2026): without that, an owner could
// pass the Google page to someone else and end up managing that person's Business Profile from their own account.
async function gbpStart(env, kind, who) {
  const ts = String(Date.now()), nonce = newNonce(), body = kind + '.' + who + '.' + ts + '.' + nonce;
  const state = body + '.' + await hmac(env, body);
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', redirect_uri: REDIRECT, response_type: 'code', scope: GBP_SCOPE, access_type: 'offline', prompt: 'consent', state });
  return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': setCookie(nonce, STATE_MS / 1000), 'cache-control': 'no-store' } });
}
// An owner connects their own profile from the app (only once Google has approved our access), or Christopher connects
// Always Open's Google account (the manager on client profiles) from the HQ board, which lets the worker watch for approval.
async function handleGbp(req, env, url) {
  if (url.pathname === '/google/gbp') {
    const { isOn } = await import('./launch.js');
    if (!(await isOn(env, 'google'))) return page('Coming soon', 'Connecting your Google Business Profile here is coming soon. Until then we work from the invite you send us, and nothing changes for you.', 404);
    const c = await ownerFor(env, url.searchParams.get('code') || '');
    if (!c) return page('Link not valid', 'Open this from the Always Open app, signed in as the owner.', 403);
    return gbpStart(env, 'gbp', c.client_id);
  }
  if (url.pathname === '/google/gbp-hq') {
    const { boardOk } = await import('./opsboard.js');
    if (!(await boardOk(env, url.searchParams.get('t') || ''))) return page('Link not valid', 'Open this from the HQ board link.', 403);
    return gbpStart(env, 'hq', 'agency');
  }
  return new Response('Not found', { status: 404 });
}
async function gbpCallback(req, env, url, st) {
  if (st.length !== 5 || !/^[0-9a-f]{32}$/.test(st[3]) || st[4] !== await hmac(env, st.slice(0, 4).join('.')) || !(Date.now() - +st[2] <= STATE_MS)) return page('Link expired', 'Please start again.', 400);
  if (!url.searchParams.get('code')) return page('Not connected', 'Google did not give access. You can try again any time.', 400);
  if (!same(cookieOf(req, cookieName(st[3])), st[3])) return blocked(env, st[0] === 'hq' ? '' : st[1], true);
  const done = (title, text) => { const r = page(title, text); r.headers.set('set-cookie', setCookie(st[3], 0)); return r; };
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) return page('Not connected', 'Google did not finish connecting. Please try again.', 400);
  const gbp = await import('./gbp.js');
  if (st[0] === 'hq') {
    await gbp.saveRefresh(env, gbp.AGENCY, j.refresh_token);
    try { await (await import('./launch.js')).launchCron(env, { force: true }); } catch (e) { /* the hourly check runs anyway */ }
    return done('Connected', 'Always Open’s Google account is connected. The worker now checks every hour whether Google has approved the access, and turns everything on by itself when it has. You can close this page.');
  }
  await gbp.saveRefresh(env, st[1], j.refresh_token);
  try { await gbp.mapLocations(env); } catch (e) { /* the daily pass maps it */ }
  return done('Google profile connected', 'Thank you. Nothing is posted to your profile without your approval in the app. You can close this page.');
}

export async function handleGoogle(req, env, url) {
  const path = url.pathname;
  if (path === '/google/gbp' || path === '/google/gbp-hq') return handleGbp(req, env, url);
  if (path === '/google/connect') {
    const c = await ownerFor(env, url.searchParams.get('code') || '');
    if (!c) return page('Link not valid', 'Open this from the Always Open app, signed in as the owner.', 403);
    const ts = String(Date.now()), nonce = newNonce();
    const state = c.client_id + '.' + ts + '.' + nonce + '.' + await hmac(env, c.client_id + '.' + ts + '.' + nonce);
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': setCookie(nonce, STATE_MS / 1000), 'cache-control': 'no-store' } });
  }
  if (path === '/google/callback') {
    // Google comes back with a plain GET. Nothing else is taken here (the old confirmation button posted to this address).
    if (req.method !== 'GET') return page('Not connected', 'Please tap Connect Google Calendar in the app again.', 405);
    const st = String(url.searchParams.get('state') || '').split('.');
    if (st[0] === 'gbp' || st[0] === 'hq') return gbpCallback(req, env, url, st);
    const s2 = await calState(env, url.searchParams.get('state'));
    if (!s2) return page('Link expired', 'Please tap Connect Google Calendar in the app again.', 400);
    const code = url.searchParams.get('code');
    if (!code) return page('Not connected', 'Google did not give access. You can try again from the app any time.', 400);
    if (!same(cookieOf(req, cookieName(s2.nonce)), s2.nonce)) return blocked(env, s2.cid);
    return finishCalendar(env, s2.cid, code, s2.nonce);
  }
  if (path === '/google/disconnect' && req.method === 'POST') {
    let code = '';
    try { code = String((await req.json()).code || ''); } catch (e) { /* none */ }
    const c = await ownerFor(env, code);
    if (!c) return new Response('{"ok":false}', { status: 403, headers: { 'content-type': 'application/json' } });
    await ensureGcal(env);
    await env.DB.prepare('DELETE FROM gcal_tokens WHERE client_id = ?1').bind(c.client_id).run();
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  }
  return new Response('Not found', { status: 404 });
}

export async function gcalStatus(env, cid) {
  try {
    await ensureGcal(env);
    const r = await env.DB.prepare('SELECT connected_at FROM gcal_tokens WHERE client_id = ?1').bind(cid).first();
    let needsReconnect = false;
    try { const cn = await import('./connections.js'); needsReconnect = !!r && (await cn.brokenFor(env, cid)).some(b => b.kind === 'calendar'); } catch (e) { needsReconnect = false; }
    return { connected: !!r, since: r ? r.connected_at : '', needsReconnect };
  } catch (e) { return { connected: false, since: '', needsReconnect: false }; }
}

// Null when no calendar is connected, or when Google refused the refresh. With strict, a refusal throws instead, so a
// caller can tell "no calendar" from "calendar we could not read".
async function access(env, cid, strict) {
  await ensureGcal(env);
  const row = await env.DB.prepare('SELECT refresh, tz FROM gcal_tokens WHERE client_id = ?1').bind(cid).first();
  if (!row) return null;
  const refresh = await openToken(env, 'gcal_tokens.refresh', row.refresh).catch(() => '');
  if (!refresh) {
    try { await (await import('./connections.js')).markBroken(env, cid, 'calendar', 'its saved sign-in could not be opened'); } catch (e) { /* fine */ }
    if (strict) throw Object.assign(new Error('Google Calendar needs connecting again'), { calendar: true });
    return null;
  }
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  try { const cn = await import('./connections.js'); if (r.ok && j.access_token) await cn.markOk(env, cid, 'calendar'); else if (cn.refusedForGood(r.status, j)) await cn.markBroken(env, cid, 'calendar', j.error || ('Google answered ' + r.status)); } catch (e) { /* the cron will find it */ }
  if (r.ok && j.access_token) return { token: j.access_token, tz: row.tz || 'America/New_York' };
  if (strict) throw Object.assign(new Error('Google Calendar refused the connection (' + r.status + ')'), { calendar: true });
  return null;
}
export async function tryRefresh(env, cid) {
  await ensureGcal(env);
  const row = await env.DB.prepare('SELECT refresh FROM gcal_tokens WHERE client_id = ?1').bind(cid).first();
  if (!row) return { ok: false, status: 404, body: { error: 'no token' } };
  const refresh = await openToken(env, 'gcal_tokens.refresh', row.refresh).catch(() => '');
  if (!refresh) return { ok: false, status: 401, body: { error: 'invalid_grant', error_description: 'the saved sign-in could not be opened' } };
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !!j.access_token, status: r.status, body: j };
}

// Offset (minutes) of a time zone at a given instant, so slot times are built in the owner's own zone.
function tzOffset(tz, at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(at / 60000) * 60000) / 60000;
}
function localParts(tz, at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, wd: p.weekday };
}
export function spokenSlot(tz, at) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at).replace(':00', '');
}

// Busy stretches on the owner's calendar between two moments (availability.js). Null only when no calendar is connected.
// When a calendar is connected but can't be read (Google down, connection refused), this throws: offering times from a
// calendar we couldn't see would book callers over real appointments, so the caller must offer none.
export async function busyTimes(env, cid, from, to) {
  const a = await access(env, cid, true);
  if (!a) return null;
  const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const r = await fetch(API + '?' + q, { headers: { authorization: 'Bearer ' + a.token } });
  if (!r.ok) throw Object.assign(new Error('Google Calendar answered ' + r.status), { calendar: true });
  const j = await r.json();
  const busy = (j.items || []).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent').map(e => [Date.parse((e.start || {}).dateTime || (e.start || {}).date), Date.parse((e.end || {}).dateTime || (e.end || {}).date)]);
  return { tz: j.timeZone || a.tz, busy };
}

// Up to `max` one-hour openings over the next 7 days, weekdays 9 to 5 in the calendar's zone, at least 2 hours out.
export async function openSlots(env, cid, now, max, all) {   // all: every free hour, not spread out (to check a time someone picked)
  const a = await access(env, cid);
  if (!a) return null;
  now = now || Date.now();
  const q = new URLSearchParams({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + 8 * 864e5).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const r = await fetch(API + '?' + q, { headers: { authorization: 'Bearer ' + a.token } });
  if (!r.ok) return null;
  const j = await r.json();
  const tz = j.timeZone || a.tz;
  const busy = (j.items || []).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent').map(e => [Date.parse((e.start || {}).dateTime || (e.start || {}).date), Date.parse((e.end || {}).dateTime || (e.end || {}).date)]);
  // Max's own book too: a visit he pencilled in is not on Google until the owner confirms it (Nov 10: the booking page
  // then sold the hour inside it)
  try { const { ensureBookings } = await import('./availability.js'); await ensureBookings(env);
    const taken = ((await env.DB.prepare("SELECT start, end FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND end > ?2 AND start < ?3").bind(cid, now, now + 8 * 864e5).all()).results) || [];
    for (const t of taken) busy.push([+t.start, +t.end]); } catch (e) { /* the calendar alone */ }
  const out = [];
  for (let d = 0; d < 8 && out.length < (max || 6); d++) {
    // by calendar day, not 24-hour blocks (Nov 24, 2026: a late call the night before a clock change skipped or repeated a day)
    const b0 = localParts(tz, now), nd = new Date(Date.UTC(b0.y, b0.m - 1, b0.d + d, 12)), lp = { y: nd.getUTCFullYear(), m: nd.getUTCMonth() + 1, d: nd.getUTCDate(), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nd.getUTCDay()] };
    if (lp.wd === 'Sat' || lp.wd === 'Sun') continue;
    for (let h = 9; h < 17 && out.length < (max || 6); h++) {
      const guess = Date.UTC(lp.y, lp.m - 1, lp.d, h);
      const start = guess - tzOffset(tz, guess) * 60000, end = start + 3600e3;
      if (start < now + 2 * 3600e3) continue;
      if (busy.some(b => b[0] < end && b[1] > start)) continue;
      out.push({ start, end, say: spokenSlot(tz, start) });
      if (!all) h++;   // spread choices out
    }
  }
  return { tz, slots: out };
}

export async function bookSlot(env, cid, slot, who) {
  const a = await access(env, cid);
  if (!a) return false;
  // Claim the time in our own book first, in one statement: two people choosing the same hour at once get one booking,
  // and nothing overlaps a visit Max already holds.
  let claim = 0;
  try {
    const { ensureBookings } = await import('./availability.js'); await ensureBookings(env);
    const ts = new Date().toISOString();
    const r = await env.DB.prepare("INSERT INTO line_bookings (client_id, start, end, name, phone, reason, status, call_id, say, created, updated) SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'booked', '', ?7, ?8, ?8 WHERE NOT EXISTS (SELECT 1 FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND start < ?3 AND end > ?2)")
      .bind(cid, slot.start, slot.end, String(who.name || '').slice(0, 60), String(who.phone || '').slice(0, 20), String(who.reason || '').slice(0, 120), slot.say || '', ts).run();
    if (!(r.meta && r.meta.changes)) return false;
    claim = r.meta.last_row_id;
  } catch (e) { return false; }
  const body = { summary: 'Appointment: ' + (who.name || 'caller'), description: 'Booked ' + (who.via ? 'from ' + who.via : 'by Max, the Always Open phone assistant') + '.\nName: ' + (who.name || '') + '\nPhone: ' + (who.phone || '') + '\nReason: ' + (who.reason || ''),
    start: { dateTime: new Date(slot.start).toISOString() }, end: { dateTime: new Date(slot.end).toISOString() } };
  let ok = false;
  try { const r = await fetch(API, { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' }, body: JSON.stringify(body) }); ok = r.ok; } catch (e) { ok = false; }
  if (!ok && claim) await env.DB.prepare("UPDATE line_bookings SET status = 'cancelled' WHERE id = ?1").bind(claim).run().catch(() => {});
  return ok;
}
