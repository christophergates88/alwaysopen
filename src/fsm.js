// Jobber and Housecall Pro (Nov 25, 2026). Owners who run their work in Jobber or Housecall Pro were told "Jobber doesn't
// connect" and kept the receptionist their app already sells. Now the visits Max books go straight in, so nobody types
// them twice: in Jobber as a request with the visit on the calendar (an assessment at the booked time), in Housecall Pro
// as a job on the schedule when the customer already has an address there, or else as a lead with the time in its notes.
// The owner can also send every new lead, not only booked visits.
//
// Connecting, from the app's "Jobber or Housecall Pro" page (/app/<code>/booking-software):
//   Jobber: OAuth 2.0 with PKCE through Always Open's Jobber app (JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, made once by
//     Christopher in Jobber's Developer Center; in Draft it may connect up to 5 paying Jobber accounts, then Jobber's App
//     Review). Bound to the browser that started it, like the Google connect (gcal.js): a cookie holds the nonce the
//     state is signed with, so a link passed to someone else connects nothing. Tokens are sealed (seal.js) with the app
//     secret; the access token lasts an hour and is refreshed as needed.
//   Housecall Pro: the owner pastes an API key (Housecall Pro's MAX plan: My Apps, App Store, API). It is checked once
//     against Housecall Pro and sealed.
// Every push is written down (fsm_sync) and tried again by the 10-minute job, three times in all. A push that keeps
// failing goes to Christopher with what the service said, and the call's note in the app says so. Nothing here ever
// changes or deletes anything already in the owner's Jobber or Housecall Pro: it only adds.
import { seal, open } from './seal.js';

const SITE = 'https://alwaysopenoffice.com';
const JOBBER_AUTH = 'https://api.getjobber.com/api/oauth/authorize';
const JOBBER_TOKEN = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_API = 'https://api.getjobber.com/api/graphql';
export const JOBBER_VERSION = '2025-04-16';
export const JOBBER_REDIRECT = SITE + '/fsm/jobber/callback';
const HCP_API = 'https://api.housecallpro.com';
const STATE_MS = 3600e3, TRIES = 3, DAY = 864e5;
const COOKIE = 'ao_fsm_';
const one = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = t => new Date(t).toISOString();
const digits = p => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const gq = s => JSON.stringify(String(s == null ? '' : s));   // a GraphQL string literal (same escapes as JSON)
const quick = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined);   // a hung service never holds up a call's write-up
export const NAMES = { jobber: 'Jobber', hcp: 'Housecall Pro' };

const ready = new WeakSet();
export async function ensureFsm(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fsm_links (client_id TEXT PRIMARY KEY, kind TEXT, status TEXT DEFAULT 'on', account TEXT DEFAULT '', secret TEXT DEFAULT '', access TEXT DEFAULT '', expires INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, connected_at TEXT, error TEXT DEFAULT '', updated TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fsm_sync (call_id TEXT PRIMARY KEY, client_id TEXT, kind TEXT, at TEXT, status TEXT DEFAULT 'new', tries INTEGER DEFAULT 0, result TEXT DEFAULT '', error TEXT DEFAULT '', data TEXT DEFAULT '{}')").run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fsm_pkce (nonce TEXT PRIMARY KEY, client_id TEXT, verifier TEXT, at INTEGER)').run();
  ready.add(env.DB);
}
// What a sealed value is sealed with: Jobber's tokens with the Jobber app's own secret; a Housecall Pro key with the
// worker's own key (seal.js default).
const sealWith = (env, kind) => kind === 'jobber' ? env.JOBBER_CLIENT_SECRET : undefined;
export async function linkFor(env, cid) {
  await ensureFsm(env);
  return env.DB.prepare("SELECT * FROM fsm_links WHERE client_id = ?1").bind(cid).first().catch(() => null);
}
export const jobberReady = env => !!(env.JOBBER_CLIENT_ID && env.JOBBER_CLIENT_SECRET);

// ---------- Jobber: connect ----------
async function hmac(env, data) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JOBBER_CLIENT_SECRET || 'x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookieName = nonce => COOKIE + String(nonce).slice(0, 12);
const setCookie = (nonce, maxAge) => cookieName(nonce) + '=' + (maxAge ? nonce : '') + '; Max-Age=' + maxAge + '; Path=/fsm/jobber/callback; Secure; HttpOnly; SameSite=Lax';
const cookieOf = (req, name) => { for (const p of String(req.headers.get('cookie') || '').split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim(); } return ''; };
function same(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// From the app (the owner is already signed in by their link): off to Jobber's sign-in, with the state and PKCE.
export async function jobberStart(env, cid, now) {
  await ensureFsm(env);
  now = now || Date.now();
  const nonce = rand(16), verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await env.DB.prepare('DELETE FROM fsm_pkce WHERE at < ?1').bind(now - STATE_MS).run().catch(() => {});
  await env.DB.prepare('INSERT INTO fsm_pkce (nonce, client_id, verifier, at) VALUES (?1, ?2, ?3, ?4)').bind(nonce, cid, verifier, now).run();
  const body = cid + '.' + now + '.' + nonce, state = body + '.' + await hmac(env, body);
  const q = new URLSearchParams({ response_type: 'code', client_id: env.JOBBER_CLIENT_ID || '', redirect_uri: JOBBER_REDIRECT, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return new Response(null, { status: 302, headers: { location: JOBBER_AUTH + '?' + q, 'set-cookie': setCookie(nonce, STATE_MS / 1000), 'cache-control': 'no-store' } });
}
function page(title, text, status) {
  return new Response('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><body style="font:17px/1.5 system-ui;background:#0F131B;color:#ECEEF3;padding:32px;max-width:520px;margin:0 auto"><h1 style="font-size:24px">' + esc(title) + '</h1><p>' + text + '</p></body>',
    { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
}
// GET /fsm/jobber/callback: Jobber comes back with a code. Only the browser that started it connects.
export async function jobberCallback(req, env, url, h) {
  h = h || {};
  if (req.method !== 'GET') return page('Not connected', 'Please tap Connect Jobber in the app again.', 405);
  if (!jobberReady(env)) return page('Not connected', 'Jobber is not switched on here yet.', 400);
  const st = String(url.searchParams.get('state') || '').split('.');
  const now = h.now || Date.now();
  if (st.length !== 4 || !/^[0-9a-f]{32}$/.test(st[2]) || st[3] !== await hmac(env, st.slice(0, 3).join('.')) || !(now - +st[1] <= STATE_MS)) return page('Link expired', 'Please tap Connect Jobber in the app again.', 400);
  const code = url.searchParams.get('code');
  if (!code) return page('Not connected', 'Jobber did not give access. You can try again from the app any time.', 400);
  const cid = st[0], nonce = st[2];
  if (!same(cookieOf(req, cookieName(nonce)), nonce)) {
    try { await (await import('./ops.js')).opsAlert(env, 'fsm-blocked', cid, 'A Jobber connect for this client was stopped: it finished in a different browser from the one that started it. Nothing was connected.'); } catch (e) { /* the page says it */ }
    return page('Not connected', 'This Jobber sign-in finished in a different browser from the one where it was started, so we stopped it. Nothing was connected. If this is your business, tap Connect Jobber in the app again and finish in the window that opens.', 403);
  }
  await ensureFsm(env);
  // the verifier works once: taken out as it is used
  const pk = await env.DB.prepare('DELETE FROM fsm_pkce WHERE nonce = ?1 AND client_id = ?2 RETURNING verifier').bind(nonce, cid).first().catch(() => null);
  if (!pk) return page('Link already used', 'That link was already used. Start again from your app.', 400);
  const f = h.fetch || fetch;
  const r = await f(JOBBER_TOKEN, { method: 'POST', signal: quick(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.JOBBER_CLIENT_ID, client_secret: env.JOBBER_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: JOBBER_REDIRECT, code_verifier: pk.verifier }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token || !j.refresh_token) return page('Not connected', 'Jobber did not finish connecting. Please try again from the app.', 400);
  let account = '';
  try { const a = await gql(env, j.access_token, '{ account { id name } }', f); account = one(a && a.account && a.account.name).slice(0, 80); } catch (e) { account = ''; }
  const at = iso(now);
  await env.DB.prepare("INSERT OR REPLACE INTO fsm_links (client_id, kind, status, account, secret, access, expires, leads, connected_at, error, updated) VALUES (?1, 'jobber', 'on', ?2, ?3, ?4, ?5, COALESCE((SELECT leads FROM fsm_links WHERE client_id = ?1), 0), ?6, '', ?6)")
    .bind(cid, account, await seal(env, 'fsm.jobber.refresh', j.refresh_token, env.JOBBER_CLIENT_SECRET), await seal(env, 'fsm.jobber.access', j.access_token, env.JOBBER_CLIENT_SECRET), now + (+j.expires_in || 3600) * 1000 - 60e3, at).run();
  const ok = page('Jobber connected', 'From now on, the visits Max books go straight into ' + (account ? esc(account) + '’s ' : 'your ') + 'Jobber as requests, with the time on your calendar. You can close this page and go back to the app.');
  ok.headers.set('set-cookie', setCookie(nonce, 0));
  return ok;
}
async function gql(env, token, query, f) {
  const r = await (f || fetch)(JOBBER_API, { method: 'POST', signal: quick(), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'X-JOBBER-GRAPHQL-VERSION': env.JOBBER_API_VERSION || JOBBER_VERSION }, body: JSON.stringify({ query }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { const e = new Error('Jobber turned the sign-in down (401)'); e.auth = true; throw e; }
  if (!r.ok || (j.errors && j.errors.length)) throw new Error('Jobber: ' + one((j.errors && j.errors[0] && j.errors[0].message) || j.message || ('answered ' + r.status)).slice(0, 200));
  return j.data || {};
}
// A Jobber access token that works now: the stored one, or a fresh one from the refresh token (kept if Jobber rotates it).
async function jobberToken(env, link, f, now) {
  if (+link.expires > (now || Date.now()) && link.access) { try { return await open(env, 'fsm.jobber.access', link.access, env.JOBBER_CLIENT_SECRET); } catch (e) { /* refresh below */ } }
  const refresh = await open(env, 'fsm.jobber.refresh', link.secret, env.JOBBER_CLIENT_SECRET);
  const r = await (f || fetch)(JOBBER_TOKEN, { method: 'POST', signal: quick(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.JOBBER_CLIENT_ID || '', client_secret: env.JOBBER_CLIENT_SECRET || '', grant_type: 'refresh_token', refresh_token: refresh }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error('Jobber would not renew the sign-in (' + r.status + ')'); e.auth = true; throw e; }
  await env.DB.prepare('UPDATE fsm_links SET access = ?1, expires = ?2, secret = ?3, updated = ?4 WHERE client_id = ?5')
    .bind(await seal(env, 'fsm.jobber.access', j.access_token, env.JOBBER_CLIENT_SECRET), (now || Date.now()) + (+j.expires_in || 3600) * 1000 - 60e3,
      j.refresh_token ? await seal(env, 'fsm.jobber.refresh', j.refresh_token, env.JOBBER_CLIENT_SECRET) : link.secret, iso(now || Date.now()), link.client_id).run();
  return j.access_token;
}

// ---------- Housecall Pro: connect ----------
async function hcp(key, method, path, body, f) {
  const r = await (f || fetch)(HCP_API + path, { method, signal: quick(), headers: Object.assign({ authorization: 'Token ' + key, accept: 'application/json' }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) { const e = new Error('Housecall Pro turned the API key down (' + r.status + ')'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('Housecall Pro: ' + one(j.message || j.error || (j.errors && JSON.stringify(j.errors)) || ('answered ' + r.status)).slice(0, 200));
  return j;
}
export async function hcpConnect(env, cid, key, h) {
  h = h || {};
  key = String(key || '').replace(/^\s*(token|bearer)\s+/i, '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) return { ok: false, error: 'That doesn’t look like a Housecall Pro API key. Copy the whole key from Housecall Pro: My Apps, App Store, API.' };
  let co = null;
  try { co = await hcp(key, 'GET', '/company', null, h.fetch); } catch (e) { return { ok: false, error: e.auth ? 'Housecall Pro didn’t accept that key. Check it’s a key for your own account (the API needs Housecall Pro’s MAX plan).' : 'Housecall Pro didn’t answer just now. Try again in a minute.' }; }
  await ensureFsm(env);
  const at = iso(h.now || Date.now()), account = one(co && (co.name || (co.company && co.company.name))).slice(0, 80);
  await env.DB.prepare("INSERT OR REPLACE INTO fsm_links (client_id, kind, status, account, secret, access, expires, leads, connected_at, error, updated) VALUES (?1, 'hcp', 'on', ?2, ?3, '', 0, COALESCE((SELECT leads FROM fsm_links WHERE client_id = ?1), 0), ?4, '', ?4)")
    .bind(cid, account, await seal(env, 'fsm.hcp.key', key), at).run();
  return { ok: true, account };
}
export async function disconnect(env, cid, h) {
  const link = await linkFor(env, cid);
  if (!link) return false;
  // Jobber is told too, so our app shows as disconnected on their side (best effort)
  if (link.kind === 'jobber' && link.status === 'on' && jobberReady(env)) { try { await gql(env, await jobberToken(env, link, h && h.fetch), 'mutation { appDisconnect { app { name } userErrors { message } } }', h && h.fetch); } catch (e) { /* removed here either way */ } }
  await env.DB.prepare('DELETE FROM fsm_links WHERE client_id = ?1').bind(cid).run();
  return true;
}

// ---------- the push ----------
// What goes over: the caller, what they need, and the visit when one was booked. From the write-up (voice.js writeUp),
// for a real call on a client's line. o: { note, summary, booked: { ok, held, at } | null, tz }.
export async function fsmPush(env, call, o, h) {
  h = h || {};
  const link = await linkFor(env, call.client_id);
  if (!link || link.status !== 'on') return 'not connected';
  const note = o.note || {};
  const booked = !!(o.booked && o.booked.ok);
  if (!booked && !(+link.leads && (one(note.name) || one(note.callback)) && one(note.reason))) return 'not sent';
  let slot = null;
  if (booked) { try { slot = await env.DB.prepare("SELECT start, end, say, status FROM line_bookings WHERE client_id = ?1 AND call_id = ?2 AND status != 'cancelled' ORDER BY start DESC LIMIT 1").bind(call.client_id, call.id).first(); } catch (e) { slot = null; } }
  const data = {
    name: one(note.name || call.caller_name).slice(0, 60), phone: digits(note.callback || call.caller), reason: one(note.reason).slice(0, 120) || 'Call to Max', details: one(note.details).slice(0, 400),
    summary: one(o.summary).slice(0, 500), urgent: !!note.urgent, when: slot ? slot.say : one(o.booked && o.booked.at), start: slot ? +slot.start : 0, end: slot ? +slot.end : 0, held: !!(o.booked && o.booked.held)
  };
  await env.DB.prepare("INSERT OR IGNORE INTO fsm_sync (call_id, client_id, kind, at, data) VALUES (?1, ?2, ?3, ?4, ?5)").bind(call.id, call.client_id, link.kind, iso(h.now || Date.now()), JSON.stringify(data)).run();
  return sendOne(env, call.id, h);
}
// One try for one call. Marks the row; on the last failed try, Christopher hears and the call's note says so.
async function sendOne(env, callId, h) {
  h = h || {};
  const row = await env.DB.prepare('SELECT * FROM fsm_sync WHERE call_id = ?1').bind(callId).first();
  if (!row || row.status === 'sent') return row ? 'sent' : 'none';
  const link = await linkFor(env, row.client_id);
  if (!link || link.status !== 'on') { await env.DB.prepare("UPDATE fsm_sync SET status = 'dropped', error = 'not connected' WHERE call_id = ?1").bind(callId).run(); return 'not connected'; }
  let data = {}; try { data = JSON.parse(row.data || '{}'); } catch (e) { data = {}; }
  const now = h.now || Date.now(), tries = (+row.tries || 0) + 1;
  try {
    const result = link.kind === 'jobber' ? await toJobber(env, link, data, h, now) : await toHcp(env, link, data, h);
    await env.DB.prepare("UPDATE fsm_sync SET status = 'sent', tries = ?1, result = ?2, error = '' WHERE call_id = ?3").bind(tries, result.slice(0, 200), callId).run();
    await noteCall(env, callId, ' Sent to ' + NAMES[link.kind] + (/lead/.test(result) ? ' as a lead.' : /request/.test(result) ? ' as a request.' : '.'));
    return 'sent';
  } catch (e) {
    const msg = one((e && e.message) || e).slice(0, 200);
    const last = tries >= TRIES || e.auth;
    await env.DB.prepare('UPDATE fsm_sync SET status = ?1, tries = ?2, error = ?3 WHERE call_id = ?4').bind(last ? 'failed' : 'retry', tries, msg, callId).run();
    if (e.auth) await env.DB.prepare("UPDATE fsm_links SET status = 'error', error = ?1, updated = ?2 WHERE client_id = ?3").bind(msg, iso(now), row.client_id).run();
    if (last) {
      await noteCall(env, callId, ' Could not reach ' + NAMES[link.kind] + (e.auth ? ': reconnect it in the app.' : '; add this one by hand.'));
      const text = NAMES[link.kind] + ' push failed for this client' + (e.auth ? ' (the sign-in stopped working; the owner was asked to reconnect)' : ' after ' + tries + ' tries') + ': ' + msg;
      try { if (h.alert) await h.alert('fsm-push', row.client_id, text); else await (await import('./ops.js')).opsAlert(env, 'fsm-push', row.client_id, text); } catch (x) { /* the row keeps it */ }
      if (e.auth) { try { await (await import('./app.js')).pushClient(env, row.client_id, { aps: { alert: { title: 'Reconnect ' + NAMES[link.kind], body: NAMES[link.kind] + ' stopped accepting Max’s visits. Open Jobber or Housecall Pro in the app and connect it again.' }, sound: 'default' }, screen: 'home' }); } catch (x) { /* the alert went */ } }
    }
    return last ? 'failed' : 'retry';
  }
}
async function noteCall(env, callId, text) {
  try { await env.DB.prepare("UPDATE app_calls SET summary = TRIM(COALESCE(summary, '') || ?1), hq_synced = 0 WHERE id = ?2").bind(text, callId).run(); } catch (e) { /* the push stands */ }
}
// Every 10 minutes: pushes that failed, tried again (at most 3 tries, within a day of the call).
export async function fsmCron(env, h) {
  h = h || {};
  await ensureFsm(env);
  const now = h.now || Date.now();
  const rows = ((await env.DB.prepare("SELECT call_id FROM fsm_sync WHERE status IN ('new', 'retry') AND at > ?1 ORDER BY at LIMIT 10").bind(iso(now - DAY)).all()).results) || [];
  let sent = 0;
  for (const r of rows) if ((await sendOne(env, r.call_id, h)) === 'sent') sent++;
  await env.DB.prepare("UPDATE fsm_sync SET status = 'failed', error = CASE WHEN error = '' THEN 'not sent within a day' ELSE error END WHERE status IN ('new', 'retry') AND at <= ?1").bind(iso(now - DAY)).run();
  await env.DB.prepare('DELETE FROM fsm_sync WHERE at < ?1').bind(iso(now - 90 * DAY)).run();
  return { tried: rows.length, sent };
}

// The words both services get.
function lines(d) {
  const who = [d.name, d.phone ? '(' + d.phone.slice(0, 3) + ') ' + d.phone.slice(3, 6) + '-' + d.phone.slice(6) : ''].filter(Boolean).join(', ');
  return [
    d.start ? (d.held ? 'Penciled in by Max for ' + d.when + ': please confirm the time with them.' : 'Booked by Max for ' + d.when + '.') : (d.when ? 'Asked for: ' + d.when + '.' : 'Taken by Max, Always Open’s phone assistant.'),
    d.urgent ? 'Urgent.' : '', who ? 'Caller: ' + who + '.' : '', d.details ? 'Details: ' + d.details : '', d.summary ? 'Max’s note: ' + d.summary : ''
  ].filter(Boolean).join('\n');
}
const nameParts = n => { const p = one(n).split(' ').filter(Boolean); return { first: (p[0] || 'Caller').slice(0, 40), last: p.slice(1).join(' ').slice(0, 60) }; };

async function toJobber(env, link, d, h, now) {
  const f = h.fetch;
  const token = await jobberToken(env, link, f, now);
  // the caller, if Jobber already has them (by phone), or a new client
  let clientId = '';
  if (d.phone) {
    // a search Jobber can't run (its schema moved on) only means a new client, never a lost visit
    try {
      const found = await gql(env, token, '{ clients(first: 10, searchTerm: ' + gq(d.phone) + ') { nodes { id phones { number } } } }', f);
      const hit = ((found.clients && found.clients.nodes) || []).find(c => (c.phones || []).some(p => digits(p.number) === d.phone));
      if (hit) clientId = hit.id;
    } catch (e) { if (e.auth) throw e; }
  }
  if (!clientId) {
    const n = nameParts(d.name);
    const make = desc => gql(env, token, 'mutation { clientCreate(input: { firstName: ' + gq(n.first) + ', lastName: ' + gq(n.last || '(last name?)') + (d.phone ? ', phones: [{ number: ' + gq(d.phone) + ', primary: true' + desc + ' }]' : '') + ' }) { client { id } userErrors { message } } }', f);
    let made;
    try { made = await make(', description: MAIN'); } catch (e) { if (e.auth) throw e; made = await make(''); }
    const ue = made.clientCreate && made.clientCreate.userErrors;
    if (ue && ue.length) throw new Error('Jobber would not add the client: ' + one(ue[0].message));
    clientId = made.clientCreate && made.clientCreate.client && made.clientCreate.client.id;
    if (!clientId) throw new Error('Jobber did not return the new client');
  }
  const title = (d.reason + (d.start ? ' (' + d.when + (d.held ? ', to confirm' : '') + ')' : '')).slice(0, 250);
  const sched = d.start ? ', schedule: { startAt: ' + gq(iso(d.start)) + ', endAt: ' + gq(iso(d.end || d.start + 3600e3)) + ' }' : '';
  const ask = q => gql(env, token, 'mutation { requestCreate(input: { clientId: ' + gq(clientId) + ', title: ' + gq(title) + q + ' }) { request { id } userErrors { message } } }', f);
  let r = null, why = '';
  try { r = await ask(', assessment: { instructions: ' + gq(lines(d)) + sched + ' }'); why = (r.requestCreate && r.requestCreate.userErrors || []).map(x => x.message).join('; '); }
  catch (e) { if (e.auth) throw e; why = e.message; }
  // the visit on the calendar didn't take (a Jobber rule we didn't expect): the request still goes in, the time in its title
  if (why || !(r && r.requestCreate && r.requestCreate.request)) {
    r = await ask('');
    const ue = r.requestCreate && r.requestCreate.userErrors;
    if (ue && ue.length) throw new Error('Jobber would not add the request: ' + one(ue[0].message));
    return 'request ' + ((r.requestCreate && r.requestCreate.request && r.requestCreate.request.id) || '') + ' (no visit on the calendar: ' + one(why).slice(0, 80) + ')';
  }
  return 'request ' + r.requestCreate.request.id;
}

async function toHcp(env, link, d, h) {
  const f = h.fetch;
  const key = await open(env, 'fsm.hcp.key', link.secret);
  let cust = null;
  if (d.phone) {
    const found = await hcp(key, 'GET', '/customers?q=' + encodeURIComponent(d.phone) + '&page_size=10', null, f);
    cust = (found.customers || []).find(c => [c.mobile_number, c.home_number, c.work_number].some(p => digits(p) === d.phone)) || null;
  }
  if (!cust) {
    const n = nameParts(d.name);
    cust = await hcp(key, 'POST', '/customers', { first_name: n.first, last_name: n.last || undefined, mobile_number: d.phone || undefined, notifications_enabled: false, tags: ['Always Open'], notes: lines(d) }, f);
    if (!cust || !cust.id) throw new Error('Housecall Pro did not return the new customer');
  }
  const addr = (cust.addresses || [])[0];
  // booked, with an address on file: a job on the schedule, and Max's note on it
  if (d.start && addr && addr.id) {
    try {
      const job = await hcp(key, 'POST', '/jobs', { customer_id: cust.id, address_id: addr.id, schedule: { scheduled_start: iso(d.start), scheduled_end: iso(d.end || d.start + 3600e3), arrival_window: 0 } }, f);
      if (job && job.id) {
        try { await hcp(key, 'POST', '/jobs/' + encodeURIComponent(job.id) + '/notes', { content: (d.reason + '\n' + lines(d)).slice(0, 2000) }, f); } catch (e) { /* the job stands */ }
        return 'job ' + job.id;
      }
    } catch (e) { if (e.auth) throw e; /* a lead below */ }
  }
  // no address yet (or the job didn't take): a lead, which lands in their Job inbox (API Leads)
  const lead = await hcp(key, 'POST', '/leads', { customer_id: cust.id }, f);
  return 'lead ' + ((lead && lead.id) || '');
}

// ---------- the owner's page: /app/<code>/booking-software ----------
const CSS = ':root{--ink:#ECEEF3;--slate:#A3ACBF;--line:#262E40;--paper:#0F131B;--card:#171C27;--sign:#FF6A5E;--ok:#5CC9A4}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,sans-serif}' +
  'main{max-width:560px;margin:0 auto;padding:22px 16px 48px}h1{font-size:26px;line-height:1.2;margin:0 0 8px}h2{font-size:19px;margin:0 0 6px}.sub{color:var(--slate)}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin:16px 0}' +
  '.btn{display:inline-block;padding:13px 18px;border-radius:12px;border:0;background:var(--sign);color:#1A0605;font:700 16px system-ui;text-decoration:none;cursor:pointer}.btn.line{background:transparent;color:var(--ink);border:1.5px solid var(--line)}' +
  'input[type=text],input[type=password]{width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--line);background:#0B0E14;color:var(--ink);font:inherit;margin:8px 0}.ok{color:var(--ok);font-weight:700}.err{color:var(--sign);font-weight:700}label.opt{display:flex;gap:10px;align-items:flex-start;margin:12px 0 0}ol{padding-left:20px;margin:8px 0}';
const shell = (title, inner) => new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body><main>' + inner + '</main></body></html>',
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
export async function fsmPage(env, c, base, req, url, h) {
  h = h || {};
  await ensureFsm(env);
  const back = '<p><a class="btn line" href="' + esc(base) + '">Back to the app</a></p>';
  if (+c.regulated) return shell('Booking software', '<h1>Booking software</h1><p class="sub">Your line takes messages only, so there is nothing to send. Message us in Ask us if you need it.</p>' + back);
  if (req.method === 'GET' && url.searchParams.get('go') === 'jobber') {
    if (!jobberReady(env)) return shell('Jobber', '<h1>Jobber</h1><p class="sub">Connecting Jobber is being switched on. Message us in Ask us and Chris will tell you when it’s ready.</p>' + back);
    return jobberStart(env, c.client_id, h.now);
  }
  let msg = '';
  if (req.method === 'POST') {
    let f = {}; try { const fd = await req.formData(); for (const [k, v] of fd.entries()) f[k] = String(v); } catch (e) { f = {}; }
    if (f.action === 'hcp') { const r = await hcpConnect(env, c.client_id, f.key, h); msg = r.ok ? '<p class="ok">Housecall Pro connected' + (r.account ? ': ' + esc(r.account) : '') + '.</p>' : '<p class="err">' + esc(r.error) + '</p>'; }
    else if (f.action === 'leads') { await env.DB.prepare('UPDATE fsm_links SET leads = ?1, updated = ?2 WHERE client_id = ?3').bind(f.leads === '1' ? 1 : 0, iso(h.now || Date.now()), c.client_id).run(); msg = '<p class="ok">Saved.</p>'; }
    else if (f.action === 'off') { await disconnect(env, c.client_id, h); msg = '<p class="ok">Disconnected. Nothing was changed in your account there.</p>'; }
  }
  const link = await linkFor(env, c.client_id);
  const intro = '<h1>Jobber or Housecall Pro</h1><p class="sub">Connect the software you run your jobs in, and the visits Max books go straight in, so nobody types them twice. Nothing already in your account is changed or deleted.</p>';
  if (link) {
    const name = NAMES[link.kind] + (link.account ? ' (' + esc(link.account) + ')' : '');
    const what = link.kind === 'jobber' ? 'Each visit Max books goes in as a request, with the time on your Jobber calendar.' : 'Each visit Max books goes on your schedule as a job when the customer already has an address in Housecall Pro; otherwise it comes in as a lead with the time in its notes. Turn on API Leads in your Job inbox to see them there.';
    const state = link.status === 'on' ? '<p class="ok">Connected: ' + name + '</p>' : '<p class="err">' + name + ' stopped accepting Max’s visits. Connect it again below.</p>';
    return shell('Jobber or Housecall Pro', intro + msg + '<div class="card">' + state + '<p class="sub">' + esc(what) + '</p>' +
      '<form method="post"><input type="hidden" name="action" value="leads"><label class="opt"><input type="checkbox" name="leads" value="1"' + (+link.leads ? ' checked' : '') + ' onchange="this.form.submit()"><span>Also send every new lead Max takes, not only booked visits.</span></label><noscript><button class="btn line" type="submit">Save</button></noscript></form>' +
      (link.status !== 'on' && link.kind === 'jobber' ? '<p><a class="btn" href="' + esc(base) + '/booking-software?go=jobber">Connect Jobber again</a></p>' : '') +
      '<form method="post" style="margin-top:14px"><input type="hidden" name="action" value="off"><button class="btn line" type="submit">Disconnect</button></form></div>' + (link.kind === 'hcp' && link.status !== 'on' ? hcpCard() : '') + back);
  }
  return shell('Jobber or Housecall Pro', intro + msg +
    '<div class="card"><h2>Jobber</h2><p class="sub">Sign in to Jobber and allow Always Open. Each booked visit becomes a request with the time on your calendar.</p>' +
    (jobberReady(env) ? '<p><a class="btn" href="' + esc(base) + '/booking-software?go=jobber">Connect Jobber</a></p>' : '<p class="sub"><b>Being switched on.</b> Message us in Ask us and Chris will tell you when it’s ready.</p>') + '</div>' + hcpCard() + back);
}
function hcpCard() {
  return '<div class="card"><h2>Housecall Pro</h2><p class="sub">Housecall Pro connects with an API key, which comes with its MAX plan.</p><ol class="sub"><li>In Housecall Pro, tap My Apps (the 3×3 squares), then App Store.</li><li>Open API, and create a key.</li><li>Paste it here.</li></ol>' +
    '<form method="post"><input type="hidden" name="action" value="hcp"><input type="password" name="key" required autocomplete="off" placeholder="Your Housecall Pro API key" aria-label="Housecall Pro API key"><button class="btn" type="submit">Connect Housecall Pro</button></form></div>';
}
// For the app's settings line.
export async function fsmState(env, cid) {
  const link = await linkFor(env, cid);
  return link ? { kind: link.kind, name: NAMES[link.kind], status: link.status, account: link.account || '', leads: !!+link.leads } : null;
}
