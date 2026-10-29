// Alerts to Christopher (not clients) when something breaks. One alert per error type per 15 minutes.
// Goes out by the phone push (NTFY_URL) and an email to MAIL_TO. Never includes keys, codes or customer details.
import { EmailMessage } from 'cloudflare:email';
import { push, isNight } from './push.js';
// The same problem alerts again at most every 3 hours, with a count of the ones held back (it used to be 15 minutes,
// which meant a push every 20 minutes all night for anything that stayed broken).
const GAP_MS = 3 * 3600e3;
// The only problems worth waking up for: callers can reach neither Max nor the voicemail backup.
const NIGHT_LOUD = new Set(['health:twilio-numbers']);
const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
// Keys, tokens, phone numbers and emails never travel in an alert, whatever a library put in its error message.
export const scrub = s => one(s)
  .replace(/\b(sk|rk|pk|whsec|xoxb|xoxp|ghp|AKIA)[_-][A-Za-z0-9_-]{8,}/g, '[key]')
  .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '[key]')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]')
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4}\b/g, '[phone]');

const alertsReady = new WeakSet();
async function ensureAlerts(env) {
  if (alertsReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_alerts (type TEXT PRIMARY KEY, at INTEGER, n INTEGER, prev INTEGER DEFAULT 0)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_night (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, type TEXT, detail TEXT)').run();
  try { await env.DB.prepare('ALTER TABLE ops_alerts ADD COLUMN prev INTEGER DEFAULT 0').run(); } catch (e) { /* already there */ }
  alertsReady.add(env.DB);
}
function enc(s) { return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?='; }

// type: short stable name, e.g. 'stripe-webhook', 'cron:billing', 'mail-send', 'max-call', 'deploy', 'health:d1'.
// who: the client_id (a code, not a name), or ''. Returns 'sent', 'limited' or 'off'.
export async function opsAlert(env, type, who, detail) {
  try {
    const key = one(type).slice(0, 60) || 'error';
    const now = Date.now();
    await ensureAlerts(env);
    // One statement decides whether this one goes out, so a burst of crashes in the same second is still one push.
    const row = await env.DB.prepare('INSERT INTO ops_alerts (type, at, n, prev) VALUES (?1, ?2, 0, 0) ON CONFLICT(type) DO UPDATE SET prev = CASE WHEN ?2 - at < ?3 THEN prev ELSE n END, n = CASE WHEN ?2 - at < ?3 THEN n + 1 ELSE 0 END, at = CASE WHEN ?2 - at < ?3 THEN at ELSE ?2 END RETURNING n, prev').bind(key, now, GAP_MS).first();
    if (!row || +row.n !== 0) return 'limited';   // held back: n counts the ones since the last push
    const more = row.prev ? ' (' + row.prev + ' more since the last alert)' : '';
    const title = 'Always Open problem: ' + key;
    const body = 'What broke: ' + scrub(detail).slice(0, 600) + more + (who ? '\nClient: ' + one(who).slice(0, 40) : '') + '\nTime: ' + new Date(now).toISOString();
    const jobs = [];
    // At night it arrives silently (push.js) and waits in ops_night for the 7 AM push; the email goes either way.
    const loud = NIGHT_LOUD.has(key);
    if (!loud && isNight(now)) await env.DB.prepare('INSERT INTO ops_night (at, type, detail) VALUES (?1, ?2, ?3)').bind(new Date(now).toISOString(), key, scrub(detail).slice(0, 200)).run().catch(() => {});
    if (env.NTFY_URL) jobs.push(push(env, { title, body, priority: 'high', tags: 'warning', loud }).catch(() => {}));
    if (env.EMAIL && env.MAIL_FROM && env.MAIL_TO) {
      const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
      const raw = ['From: "Always Open alerts" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + enc(title.slice(0, 120)),
        'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + body;
      jobs.push((async () => env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)))().catch(() => {}));
    }
    if (!jobs.length) return 'off';
    await Promise.all(jobs);
    return 'sent';
  } catch (e) { return 'off'; }
}

// Runs a background job; if it throws, one alert. Every run is written down (cron_runs), so /health can tell when the
// cron itself has stopped, and the ops board can show when each job last ran and how long it took.
const runsReady = new WeakSet();
export async function ensureRuns(env) {
  if (runsReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS cron_runs (name TEXT PRIMARY KEY, at TEXT, ms INTEGER, ok INTEGER, note TEXT)').run();
  runsReady.add(env.DB);
}
export async function noteRun(env, name, ok, ms, note) {
  try { await ensureRuns(env); await env.DB.prepare('INSERT OR REPLACE INTO cron_runs (name, at, ms, ok, note) VALUES (?1, ?2, ?3, ?4, ?5)').bind(name, new Date().toISOString(), Math.round(ms || 0), ok ? 1 : 0, one(note).slice(0, 200)).run(); } catch (e) { /* the run still counts */ }
}
export function watched(env, name, p) {
  const t0 = Date.now();
  return Promise.resolve(p)
    .then(r => noteRun(env, name, true, Date.now() - t0, '').then(() => r))
    .catch(e => noteRun(env, name, false, Date.now() - t0, (e && e.message) || e).then(() => opsAlert(env, 'cron:' + name, '', (e && e.message) || e)));
}
// The last run of every job, newest first.
export async function cronRuns(env) {
  await ensureRuns(env);
  return ((await env.DB.prepare('SELECT name, at, ms, ok, note FROM cron_runs ORDER BY at DESC').all()).results) || [];
}
// How long since the 10-minute cron last finished its tick. Null when it has never run.
export const CRON_LATE_MS = 25 * 60000;
export async function cronAge(env, now) {
  const r = await env.DB.prepare("SELECT at FROM cron_runs WHERE name = 'tick'").first().catch(() => null);
  return r && r.at ? (now || Date.now()) - Date.parse(r.at) : null;
}

// What the 10-minute check looks at. Returns [{name, ok, why}]. Secrets are checked for presence only, never printed.
export async function healthChecks(env) {
  const out = [];
  try { const r = await env.DB.prepare('SELECT 1 AS x').first(); out.push({ name: 'd1', ok: !!(r && r.x === 1), why: 'database did not answer' }); }
  catch (e) { out.push({ name: 'd1', ok: false, why: 'database error: ' + one(e && e.message).slice(0, 120) }); }
  if (env.STRIPE_KEY) {
    try {
      const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + env.STRIPE_KEY } });
      out.push({ name: 'stripe', ok: r.ok, why: r.ok ? '' : 'Stripe answered ' + r.status + (r.status === 401 ? ' (key rejected)' : '') });
    } catch (e) { out.push({ name: 'stripe', ok: false, why: 'Stripe unreachable' }); }
  } else out.push({ name: 'stripe', ok: false, why: 'Stripe key missing' });
  // Max's line: the call room, the voice key and a way to think must all be there, and the voice log must show the line is alive.
  const miss = [];
  out.push({ name: 'email', ok: !!(env.EMAIL && env.MAIL_FROM && env.MAIL_TO), why: 'The email connection is missing, so website requests and alerts are not being emailed (the deploy likely fell back to wrangler.noemail.toml)' });
  out.push({ name: 'texting', ok: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN), why: 'Twilio account SID or auth token missing' });
  if (!env.CALLROOM) miss.push('call room');
  if (!env.VOICE_KEY) miss.push('voice key');
  if (!env.ANTHROPIC_API_KEY && !env.AI) miss.push('model');
  out.push({ name: 'max-line', ok: !miss.length, why: 'Max line is missing: ' + miss.join(', ') });
  return out;
}

// ---------- the slow checks: once an hour, kept in a table, read by /health ----------
// Things that fail quietly: the Apple push key, ntfy, every live number still pointing at our webhook, and Google
// connections. Each is checked the way the real code uses it, and the result is kept so /health stays fast.
const SLOW_EVERY_MS = 60 * 60000, SLOW_STALE_MS = 3 * 60 * 60000;
const slowReady = new WeakSet();
async function ensureSlow(env) {
  if (slowReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS health_slow (name TEXT PRIMARY KEY, at TEXT, ok INTEGER, why TEXT)').run();
  slowReady.add(env.DB);
}
export async function slowChecks(env, h) {
  h = h || {};
  const out = [];
  const f = h.fetch || fetch;
  // Apple push: a push to a made-up device with our key. Apple answers 400 BadDeviceToken when the key is fine, 403 when it is not.
  if (!(env.APNS_KEY && env.APNS_KEY_ID)) out.push({ name: 'apple-push', ok: false, why: 'Apple push key or key ID missing: owners get no pushes' });
  else {
    try {
      const jwt = await (h.apnsJwt || (async () => (await import('./app.js')).apnsJwt(env)))();
      const r = await f('https://api.push.apple.com/3/device/' + '0'.repeat(64), { method: 'POST', headers: { authorization: 'bearer ' + jwt, 'apns-topic': 'com.christophergates.alwaysopen', 'apns-push-type': 'alert', 'content-type': 'application/json' }, body: '{"aps":{"alert":"check"}}' });
      const t = await r.text().catch(() => '');
      const fine = r.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(t);
      out.push({ name: 'apple-push', ok: fine, why: fine ? '' : 'Apple answered ' + r.status + ' ' + one(t).slice(0, 60) + ': owners may not be getting pushes' });
    } catch (e) { out.push({ name: 'apple-push', ok: false, why: 'Apple push could not be reached: ' + one(e && e.message).slice(0, 80) }); }
  }
  // Phone pushes: ntfy refuses this server now and then (its free tier is limited per address, and Workers share
  // addresses), so what matters is whether pushes are reaching the phone one way or another (push.js).
  try { const { pushHealth } = await import('./push.js'); const p = await pushHealth(env, h.now); out.push({ name: 'ntfy', ok: p.ok, why: p.why }); }
  catch (e) { out.push({ name: 'ntfy', ok: true, why: '' }); }
  // Twilio: every live number still points at our webhook and has the fallback.
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY) {
    try {
      const lines = ((await env.DB.prepare('SELECT number, business, transfer_to FROM voice_lines WHERE on_air = 1').all()).results) || [];
      const wrong = [];
      for (const l of lines) {
        if (/555-?01\d\d$|55501\d\d$/.test(l.number)) continue;   // the demo's made-up number
        const r = await f('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers.json?PhoneNumber=' + encodeURIComponent(l.number), { headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) } });
        const j = await r.json().catch(() => ({}));
        const pn = j.incoming_phone_numbers && j.incoming_phone_numbers[0];
        if (!pn) { wrong.push((l.business || l.number) + ' (not in the Twilio account)'); continue; }
        if (String(pn.voice_url || '') !== 'https://alwaysopenoffice.com/voice/in/' + env.VOICE_KEY) { wrong.push((l.business || l.number) + ' (webhook points elsewhere)'); continue; }
        if (!(await import('./voicemail.js')).hasVoicemail(pn.voice_fallback_url)) {
          // Our number without the voicemail backup yet (or with the old "call back later" one): set it now rather than
          // nag. Setting a fallback changes nothing about live calls.
          const { fallbackUrl } = await import('./provision.js');
          const u = await f('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/IncomingPhoneNumbers/' + pn.sid + '.json', { method: 'POST', headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ VoiceFallbackUrl: fallbackUrl(l.business, env.VOICE_KEY), VoiceFallbackMethod: 'GET' }).toString() });
          if (!u.ok) wrong.push((l.business || l.number) + ' (no voicemail backup, and Twilio would not take one: ' + u.status + ')');
          else { try { const vm = await import('./voicemail.js'); await vm.ensureVoicemail(env); await env.DB.prepare('INSERT OR REPLACE INTO vm_meta (k, v) VALUES (?1, ?2)').bind('fallback:' + l.number, new Date().toISOString()).run(); } catch (e) { /* only a note */ } }
        }
      }
      out.push({ name: 'twilio-numbers', ok: !wrong.length, why: wrong.length ? 'Max is not reachable the usual way on: ' + wrong.join(', ') : '' });
    } catch (e) { out.push({ name: 'twilio-numbers', ok: false, why: 'could not read the numbers from Twilio' }); }
  }
  // Backups: one in the last 8 days (backup.js), once the first one has run.
  try {
    const b = await (await import('./backup.js')).lastBackup(env);
    if (b) out.push({ name: 'backup', ok: Date.now() - Date.parse(b.at) < 8 * 864e5 && !/nowhere/.test(b.where_ || ''), why: /nowhere/.test(b.where_ || '') ? 'the last backup had nowhere to go: no R2 bucket and no email' : 'the last backup was ' + Math.round((Date.now() - Date.parse(b.at)) / 864e5) + ' days ago' });
  } catch (e) { /* not yet */ }
  // Google: no connection that Google refused is waiting on an owner (connections.js), and none has gone unchecked for two days.
  try {
    const rows = ((await env.DB.prepare("SELECT h.client_id, h.kind, h.broken_at, h.checked_at, c.business FROM connection_health h LEFT JOIN app_clients c ON c.client_id = h.client_id").all()).results) || [];
    const broken = rows.filter(r => r.broken_at).map(r => (r.business || r.client_id) + ' ' + r.kind);
    out.push({ name: 'google-connections', ok: !broken.length, why: broken.length ? 'waiting on a reconnect: ' + broken.join(', ') : '' });
  } catch (e) { out.push({ name: 'google-connections', ok: true, why: '' }); }
  return out;
}
export async function slowCron(env, now, h) {
  now = now || Date.now();
  await ensureSlow(env);
  const last = await env.DB.prepare("SELECT at FROM health_slow WHERE name = 'ran'").first().catch(() => null);
  if (last && now - Date.parse(last.at) < SLOW_EVERY_MS) return { skipped: true };
  const res = await slowChecks(env, Object.assign({ now }, h));
  const at = new Date(now).toISOString();
  for (const c of res) await env.DB.prepare('INSERT OR REPLACE INTO health_slow (name, at, ok, why) VALUES (?1, ?2, ?3, ?4)').bind(c.name, at, c.ok ? 1 : 0, c.why || '').run();
  await env.DB.prepare("INSERT OR REPLACE INTO health_slow (name, at, ok, why) VALUES ('ran', ?1, 1, '')").bind(at).run();
  for (const c of res) if (!c.ok) await opsAlert(env, 'health:' + c.name, '', c.why);
  return { checked: res.length, bad: res.filter(c => !c.ok).map(c => c.name) };
}
async function slowResults(env, now) {
  try {
    await ensureSlow(env);
    const rows = ((await env.DB.prepare("SELECT name, at, ok, why FROM health_slow WHERE name != 'ran'").all()).results) || [];
    return rows.filter(r => (now || Date.now()) - Date.parse(r.at) < SLOW_STALE_MS).map(r => ({ name: r.name, ok: !!r.ok, why: r.why || '' }));
  } catch (e) { return []; }
}

export async function healthCron(env) {
  const res = await healthChecks(env);
  for (const c of res) if (!c.ok) await opsAlert(env, 'health:' + c.name, '', c.why);
  await noteRun(env, 'tick', true, 0, res.filter(c => !c.ok).map(c => c.name).join(', '));
  return res;
}

// GET /health: "ok" (200) for the outside monitor, or "not ok: ..." (503) when a check fails or the 10-minute cron has
// not finished in 25 minutes. With the key, the detail: every check and the last run of every job.
// mode: true (the deploy's check) = the fast checks only; 'monitor' (the outside monitor, which can page at night) = the
// fast checks plus whether every number still reaches us; anything else = everything, for the ops board and 7 AM push.
// A late backup or one owner's Google connection shows on the board and in the morning, and never pages anyone.
export async function healthStatus(env, now, mode) {
  const slow = mode === true ? [] : (await slowResults(env, now)).filter(c => mode !== 'monitor' || c.name === 'twilio-numbers');
  const res = (await healthChecks(env)).concat(slow);
  const age = await cronAge(env, now);
  // No tick on record yet (a fresh database, or the minute after a deploy) is not a failure; a stale one is.
  const cron = { name: 'cron', ok: age == null || age < CRON_LATE_MS, why: age == null ? 'no cron tick recorded yet' : 'the 10-minute cron last finished ' + Math.round(age / 60000) + ' minutes ago' };
  const all = res.concat([cron]);
  return { ok: all.every(c => c.ok), checks: all, cronAge: age };
}
export async function healthDetail(env) {
  const h = await healthStatus(env);
  let runs = []; try { runs = await cronRuns(env); } catch (e) { runs = []; }
  return { ok: h.ok, checks: h.checks.map(c => ({ name: c.name, ok: c.ok })), cronAgeMinutes: h.cronAge == null ? null : Math.round(h.cronAge / 60000), runs };
}

// ---------- a catch for everything else ----------
// Any throw that nothing above caught: one row in `errors` (route with ids stripped, the message, when), one alert per
// route per 15 minutes, and a page that tells the visitor what to do. Never a stack, a key or a customer detail.
const errReady = new WeakSet();
export async function ensureErrors(env) {
  if (errReady.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, route TEXT, message TEXT, method TEXT)').run();
  errReady.add(env.DB);
}
// /app/LZbZ…/calls -> /app/*/calls, /q/abc123 -> /q/*, /i/9 -> /i/*
export function routeOf(path) {
  return String(path || '/').split('/').map((seg, i) => i && seg && (/^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d+$/.test(seg) || /^[a-f0-9]{24,}$/i.test(seg)) ? '*' : seg).join('/').slice(0, 80) || '/';
}
export async function recordError(env, route, method, e) {
  const message = scrub((e && e.message) || e).slice(0, 300);
  try { await ensureErrors(env); await env.DB.prepare('INSERT INTO errors (at, route, message, method) VALUES (?1, ?2, ?3, ?4)').bind(new Date().toISOString(), route, message, String(method || '').slice(0, 8)).run(); } catch (x) { /* still alert */ }
  try { await env.DB.prepare('DELETE FROM errors WHERE id < (SELECT MAX(id) FROM errors) - 500').run(); } catch (x) { /* fine */ }
  return opsAlert(env, 'crash:' + route, '', message + ' (' + method + ' ' + route + ')');
}
export async function recentErrors(env, n) {
  await ensureErrors(env);
  return ((await env.DB.prepare('SELECT at, route, message, method FROM errors ORDER BY id DESC LIMIT ?1').bind(n || 50).all()).results) || [];
}
const SORRY = 'Something went wrong on our side. Try again in a minute, or call (706) 460-2226.';
// What the visitor gets while the alert goes out. Twilio gets TwiML so the caller hears a sentence, not a tone.
export function crashResponse(path, accept) {
  if (path.startsWith('/voice/')) return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Matthew">Thanks for calling. We can\u2019t take your call right now. Please call back in a few minutes.</Say><Hangup/></Response>', { status: 200, headers: { 'content-type': 'text/xml' } });
  if (path.startsWith('/api/') || path.startsWith('/audit/') || path.startsWith('/stripe/') || path.startsWith('/meta/') || /application\/json/.test(accept || '')) return new Response(JSON.stringify({ ok: false, error: SORRY }), { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Always Open</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12151D;color:#EEF0F4;font:17px/1.5 system-ui,sans-serif;padding:24px}main{max-width:28em}h1{font-size:1.6rem;margin:0 0 10px}a{color:#FF6A5E}</style></head><body><main><h1>Something went wrong on our side.</h1><p>Try again in a minute. If it keeps happening, call <a href="tel:+17064602226">(706) 460-2226</a> and Max will take your details.</p></main></body></html>', { status: 500, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
export function crashed(req, env, ctx, e) {
  let path = '/'; try { path = new URL(req.url).pathname; } catch (x) { path = '/'; }
  const route = routeOf(path);
  const p = recordError(env, route, req.method, e).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  return crashResponse(path, req.headers && req.headers.get('accept'));
}
