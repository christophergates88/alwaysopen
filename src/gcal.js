// Google Calendar: the owner connects their calendar once; Max then offers real open times and books them.
// Only the calendar.events scope is used. Refresh tokens live in gcal_tokens (one row per client).
import { sha256hex } from './app.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const REDIRECT = 'https://alwaysopenoffice.com/google/callback';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
// Google Business Profile (reviews, replies and posts on the owner's own profile). Off until Google approves our API access.
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const GBP_REDIRECT = 'https://alwaysopenoffice.com/google/gbp/callback';

export async function ensureGcal(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS gcal_tokens (client_id TEXT PRIMARY KEY, refresh TEXT NOT NULL, tz TEXT, connected_at TEXT)').run();
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
    { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handleGbp(req, env, url) {
  const flag = String(env.GBP_ON || '').toLowerCase();
  if (!(flag === '1' || flag === 'true' || flag === 'on')) return page('Coming soon', 'Connecting your Google Business Profile here is coming soon. Until then we work from the invite you send us, and nothing changes for you.', 404);
  if (url.pathname === '/google/gbp') {
    const c = await ownerFor(env, url.searchParams.get('code') || '');
    if (!c) return page('Link not valid', 'Open this from the Always Open app, signed in as the owner.', 403);
    const ts = String(Date.now());
    const state = 'gbp.' + c.client_id + '.' + ts + '.' + await hmac(env, 'gbp.' + c.client_id + '.' + ts);
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', redirect_uri: GBP_REDIRECT, response_type: 'code', scope: GBP_SCOPE, access_type: 'offline', prompt: 'consent', state });
    return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, 302);
  }
  if (url.pathname === '/google/gbp/callback') {
    const st = String(url.searchParams.get('state') || '').split('.');
    if (st.length !== 4 || st[0] !== 'gbp' || st[3] !== await hmac(env, st.slice(0, 3).join('.')) || Date.now() - +st[2] > 3600e3) return page('Link expired', 'Please start again from the app.', 400);
    if (!url.searchParams.get('code')) return page('Not connected', 'Google did not give access. You can try again from the app any time.', 400);
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: GBP_REDIRECT, grant_type: 'authorization_code' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) return page('Not connected', 'Google did not finish connecting. Please try again from the app.', 400);
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS gbp_tokens (client_id TEXT PRIMARY KEY, refresh TEXT NOT NULL, connected_at TEXT)').run();
    await env.DB.prepare('INSERT OR REPLACE INTO gbp_tokens (client_id, refresh, connected_at) VALUES (?1, ?2, ?3)').bind(st[1], j.refresh_token, new Date().toISOString()).run();
    return page('Google profile connected', 'Thank you. Nothing is posted to your profile without your approval in the app. You can close this page.');
  }
  return new Response('Not found', { status: 404 });
}

export async function handleGoogle(req, env, url) {
  const path = url.pathname;
  if (path === '/google/gbp' || path === '/google/gbp/callback') return handleGbp(req, env, url);
  if (path === '/google/connect') {
    const c = await ownerFor(env, url.searchParams.get('code') || '');
    if (!c) return page('Link not valid', 'Open this from the Always Open app, signed in as the owner.', 403);
    const ts = String(Date.now());
    const state = c.client_id + '.' + ts + '.' + await hmac(env, c.client_id + '.' + ts);
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, 302);
  }
  if (path === '/google/callback') {
    const st = String(url.searchParams.get('state') || '').split('.');
    if (st.length !== 3 || st[2] !== await hmac(env, st[0] + '.' + st[1]) || Date.now() - +st[1] > 3600e3) return page('Link expired', 'Please tap Connect Google Calendar in the app again.', 400);
    if (!url.searchParams.get('code')) return page('Not connected', 'Google did not give access. You can try again from the app any time.', 400);
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) return page('Not connected', 'Google did not finish connecting. Please try again from the app.', 400);
    await ensureGcal(env);
    let tz = '';
    try { const e = await fetch(API + '?maxResults=1', { headers: { authorization: 'Bearer ' + j.access_token } }); tz = ((await e.json()) || {}).timeZone || ''; } catch (e) { /* set on first use */ }
    await env.DB.prepare('INSERT OR REPLACE INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES (?1, ?2, ?3, ?4)').bind(st[0], j.refresh_token, tz, new Date().toISOString()).run();
    return page('Calendar connected', 'Max can now offer open times from your Google Calendar and book them for callers. You can close this page and go back to the app.');
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
  try { await ensureGcal(env); const r = await env.DB.prepare('SELECT connected_at FROM gcal_tokens WHERE client_id = ?1').bind(cid).first(); return { connected: !!r, since: r ? r.connected_at : '' }; }
  catch (e) { return { connected: false, since: '' }; }
}

async function access(env, cid) {
  await ensureGcal(env);
  const row = await env.DB.prepare('SELECT refresh, tz FROM gcal_tokens WHERE client_id = ?1').bind(cid).first();
  if (!row) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: row.refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.access_token ? { token: j.access_token, tz: row.tz || 'America/New_York' } : null;
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

// Up to `max` one-hour openings over the next 7 days, weekdays 9 to 5 in the calendar's zone, at least 2 hours out.
export async function openSlots(env, cid, now, max) {
  const a = await access(env, cid);
  if (!a) return null;
  now = now || Date.now();
  const q = new URLSearchParams({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + 8 * 864e5).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const r = await fetch(API + '?' + q, { headers: { authorization: 'Bearer ' + a.token } });
  if (!r.ok) return null;
  const j = await r.json();
  const tz = j.timeZone || a.tz;
  const busy = (j.items || []).filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent').map(e => [Date.parse((e.start || {}).dateTime || (e.start || {}).date), Date.parse((e.end || {}).dateTime || (e.end || {}).date)]);
  const out = [];
  for (let d = 0; d < 8 && out.length < (max || 6); d++) {
    const lp = localParts(tz, now + d * 864e5);
    if (lp.wd === 'Sat' || lp.wd === 'Sun') continue;
    for (let h = 9; h < 17 && out.length < (max || 6); h++) {
      const guess = Date.UTC(lp.y, lp.m - 1, lp.d, h);
      const start = guess - tzOffset(tz, guess) * 60000, end = start + 3600e3;
      if (start < now + 2 * 3600e3) continue;
      if (busy.some(b => b[0] < end && b[1] > start)) continue;
      out.push({ start, end, say: spokenSlot(tz, start) });
      h++;   // spread choices out
    }
  }
  return { tz, slots: out };
}

export async function bookSlot(env, cid, slot, who) {
  const a = await access(env, cid);
  if (!a) return false;
  const body = { summary: 'Appointment: ' + (who.name || 'caller'), description: 'Booked ' + (who.via ? 'from ' + who.via : 'by Max, the Always Open phone assistant') + '.\nName: ' + (who.name || '') + '\nPhone: ' + (who.phone || '') + '\nReason: ' + (who.reason || ''),
    start: { dateTime: new Date(slot.start).toISOString() }, end: { dateTime: new Date(slot.end).toISOString() } };
  const r = await fetch(API, { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok;
}
