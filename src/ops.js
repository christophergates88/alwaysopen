// Alerts to Christopher (not clients) when something breaks. One alert per error type per 15 minutes.
// Goes out by the phone push (NTFY_URL) and an email to MAIL_TO. Never includes keys, codes or customer details.
import { EmailMessage } from 'cloudflare:email';
const GAP_MS = 15 * 60000;
const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const asc = s => one(s).replace(/[^\x20-\x7E]/g, '');

function enc(s) { return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?='; }

// type: short stable name, e.g. 'stripe-webhook', 'cron:billing', 'mail-send', 'max-call', 'deploy', 'health:d1'.
// who: the client_id (a code, not a name), or ''. Returns 'sent', 'limited' or 'off'.
export async function opsAlert(env, type, who, detail) {
  try {
    const key = one(type).slice(0, 60) || 'error';
    const now = Date.now();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_alerts (type TEXT PRIMARY KEY, at INTEGER, n INTEGER)').run();
    const row = await env.DB.prepare('SELECT at, n FROM ops_alerts WHERE type = ?1').bind(key).first();
    if (row && now - row.at < GAP_MS) {
      await env.DB.prepare('UPDATE ops_alerts SET n = n + 1 WHERE type = ?1').bind(key).run();
      return 'limited';
    }
    const more = row && row.n ? ' (' + row.n + ' more since the last alert)' : '';
    await env.DB.prepare('INSERT INTO ops_alerts (type, at, n) VALUES (?1, ?2, 0) ON CONFLICT(type) DO UPDATE SET at = ?2, n = 0').bind(key, now).run();
    const title = 'Always Open problem: ' + key;
    const body = 'What broke: ' + one(detail).slice(0, 600) + more + (who ? '\nClient: ' + one(who).slice(0, 40) : '') + '\nTime: ' + new Date(now).toISOString();
    const jobs = [];
    if (env.NTFY_URL) jobs.push(fetch(env.NTFY_URL, { method: 'POST', headers: { Title: asc(title), Priority: 'high', Tags: 'warning' }, body }).catch(() => {}));
    if (env.EMAIL && env.MAIL_FROM && env.MAIL_TO) {
      const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
      const raw = ['From: "Always Open alerts" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + enc(title.slice(0, 120)),
        'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + body;
      jobs.push(env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)).catch(() => {}));
    }
    if (!jobs.length) return 'off';
    await Promise.all(jobs);
    return 'sent';
  } catch (e) { return 'off'; }
}

// Runs a background job; if it throws, one alert.
export function watched(env, name, p) {
  return Promise.resolve(p).catch(e => opsAlert(env, 'cron:' + name, '', (e && e.message) || e));
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

export async function healthCron(env) {
  const res = await healthChecks(env);
  for (const c of res) if (!c.ok) await opsAlert(env, 'health:' + c.name, '', c.why);
  return res;
}

// Owner-only detail for GET /health with the key; the plain answer stays "ok".
export async function healthDetail(env) {
  const res = await healthChecks(env);
  return { ok: res.every(c => c.ok), checks: res.map(c => ({ name: c.name, ok: c.ok })) };
}
