// Funding watch: every paid service Always Open runs on, checked so clients never lose service because an account ran dry.
// Pushes go to Christopher's phone (and email) only. Each alert repeats on its own schedule until it's fixed:
// a warning once a day, an urgent one every 4 hours.
//   Twilio (calls, texts, numbers, carrier fees): prepaid. Balance read every hour, days left worked out from the last week's spending.
//   Claude (Max's voice brain): prepaid credits. No balance API, so the hourly test call and every live call watch for the
//     "credit balance is too low" answer. Max falls back to the backup model on his own, but the push goes out at once.
//   Google Maps (Places lookups): card billing. A billing or quota refusal on any lookup sends a push.
//   Yearly renewals (domain, Apple Developer): RENEWALS in wrangler.toml, reminders 30, 7 and 1 days before.
const pushOps = async (...a) => { try { return await (await import('./app.js')).opsPing(...a); } catch (e) { return 0; } };
const mailOps = async (env, subject, text) => { try { return await (await import('./app.js')).mailOwner(env, subject, text); } catch (e) { return 'off'; } };

const TWILIO_WARN_DAYS = 10, TWILIO_URGENT_DAYS = 3, TWILIO_WARN_USD = 25, TWILIO_URGENT_USD = 10;
const WARN_EVERY = 24 * 3600e3, URGENT_EVERY = 4 * 3600e3;

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS funding_log (at TEXT NOT NULL, service TEXT NOT NULL, value REAL, PRIMARY KEY (at, service))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS funding_alerts (k TEXT PRIMARY KEY, at INTEGER)'),
  ]);
  ready = true;
}

// One push per key per gap. level: 'warn' | 'urgent' | 'ok' (ok clears the key so the next problem alerts right away).
export async function fundAlert(env, key, level, title, body) {
  await ensure(env);
  if (level === 'ok') { await env.DB.prepare('DELETE FROM funding_alerts WHERE k LIKE ?1').bind(key + '%').run(); return 'cleared'; }
  const k = key + ':' + level, now = Date.now();
  const row = await env.DB.prepare('SELECT at FROM funding_alerts WHERE k = ?1').bind(k).first();
  if (row && now - row.at < (level === 'urgent' ? URGENT_EVERY : WARN_EVERY)) return 'limited';
  await env.DB.prepare('INSERT INTO funding_alerts (k, at) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET at = excluded.at').bind(k, now).run();
  await pushOps(env, title, body, level === 'urgent' ? 'urgent' : 'high', level === 'urgent' ? 'rotating_light' : 'moneybag');
  await mailOps(env, title, body);
  return 'sent';
}

// Spending per day from hourly balance readings: only the drops count (top-ups are ignored).
export function burnPerDay(readings) {
  const r = readings.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (r.length < 2) return 0;
  let spent = 0;
  for (let i = 1; i < r.length; i++) { const d = r[i - 1].value - r[i].value; if (d > 0) spent += d; }
  const days = (Date.parse(r[r.length - 1].at) - Date.parse(r[0].at)) / 864e5;
  return days >= 0.25 ? spent / days : 0;
}
export function twilioLevel(balance, perDay) {
  const daysLeft = perDay > 0 ? balance / perDay : Infinity;
  if (balance < TWILIO_URGENT_USD || daysLeft < TWILIO_URGENT_DAYS) return { level: 'urgent', daysLeft };
  if (balance < TWILIO_WARN_USD || daysLeft < TWILIO_WARN_DAYS) return { level: 'warn', daysLeft };
  return { level: 'ok', daysLeft };
}
const usd = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
const daysText = d => !isFinite(d) ? 'no spending yet to measure' : (d < 1 ? 'less than a day' : 'about ' + Math.floor(d) + (Math.floor(d) === 1 ? ' day' : ' days')) + ' at the current pace';

async function twilio(env) {
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return null;
  const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Balance.json', { headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) } });
  if (!r.ok) { await fundAlert(env, 'twilio-read', 'warn', 'Always Open: could not read the Twilio balance', 'Twilio answered ' + r.status + ' when we asked for the balance. If this keeps happening, check the account at console.twilio.com.'); return null; }
  const j = await r.json();
  const balance = +j.balance;
  if (!isFinite(balance)) return null;
  const at = new Date().toISOString();
  await env.DB.prepare('INSERT OR REPLACE INTO funding_log (at, service, value) VALUES (?1, ?2, ?3)').bind(at, 'twilio', balance).run();
  const rows = ((await env.DB.prepare("SELECT at, value FROM funding_log WHERE service = 'twilio' AND at > ?1 ORDER BY at").bind(new Date(Date.now() - 7 * 864e5).toISOString()).all()).results) || [];
  const perDay = burnPerDay(rows), lv = twilioLevel(balance, perDay);
  const body = 'Twilio balance: ' + usd(balance) + ', spending about ' + usd(perDay) + ' a day, so ' + daysText(lv.daysLeft) + '. Calls, Max, texts and carrier fees all draw from it. Add funds or turn on auto-recharge: console.twilio.com, Billing.';
  if (lv.level === 'ok') await fundAlert(env, 'twilio', 'ok');
  else await fundAlert(env, 'twilio', lv.level, lv.level === 'urgent' ? 'Always Open: Twilio is almost out of money' : 'Always Open: Twilio balance is getting low', body);
  return { balance, perDay, daysLeft: lv.daysLeft, level: lv.level };
}

// Called from Max's brain when Claude refuses, and from the hourly test call.
export function isCreditError(msg) { return /credit balance|billing|insufficient|quota|payment required/i.test(String(msg || '')); }
export async function claudeProblem(env, msg) {
  if (!isCreditError(msg)) return;
  await fundAlert(env, 'claude', 'urgent', 'Always Open: Claude credits are out', 'Claude answered: "' + String(msg).slice(0, 160) + '". Max switched to the backup model and calls are still answered, but he sounds less natural. Add credits or turn on auto-reload at console.anthropic.com, Billing.');
}
async function claudeHourly(env) {
  try {
    const r = await env.DB.prepare("SELECT detail FROM voice_log WHERE kind = 'claude-check' ORDER BY at DESC LIMIT 1").first();
    if (!r) return null;
    const j = JSON.parse(r.detail || '{}');
    if (j.ok) { await fundAlert(env, 'claude', 'ok'); return { ok: true }; }
    if (j.key && isCreditError(j.error)) await claudeProblem(env, j.error);
    return { ok: false, error: String(j.error || '').slice(0, 120) };
  } catch (e) { return null; }
}

// Called from the Places helper when Google refuses a lookup.
export async function googleProblem(env, status, text) {
  if (status !== 403 && status !== 429 && !/billing|quota|exceeded/i.test(String(text || ''))) return;
  await fundAlert(env, 'google', status === 429 ? 'warn' : 'urgent', status === 429 ? 'Always Open: Google lookups hit a limit' : 'Always Open: Google stopped our lookups',
    'Google answered ' + status + ' (' + String(text || '').slice(0, 160) + '). Free audits and competitor checks stop until it’s fixed. Check billing and quotas at console.cloud.google.com.');
}

// "alwaysopenoffice.com:2027-10-24|Apple Developer:2027-04-02"
export function renewalsDue(spec, now) {
  const out = [];
  for (const part of String(spec || '').split('|')) {
    const m = /^\s*(.+?)\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(part);
    if (!m) continue;
    const days = Math.ceil((Date.parse(m[2] + 'T12:00:00Z') - now) / 864e5);
    for (const at of [30, 7, 1]) if (days <= at && days > (at === 30 ? 7 : at === 7 ? 1 : -1)) { out.push({ name: m[1], date: m[2], days, bucket: at }); break; }
  }
  return out;
}

export async function fundingCron(env) {
  await ensure(env);
  // Hourly is enough; the worker cron runs every 10 minutes.
  const last = await env.DB.prepare("SELECT at FROM funding_log WHERE service = 'tick' ORDER BY at DESC LIMIT 1").first();
  if (last && Date.now() - Date.parse(last.at) < 55 * 60000) return { skipped: true };
  await env.DB.prepare("INSERT OR REPLACE INTO funding_log (at, service, value) VALUES (?1, 'tick', 0)").bind(new Date().toISOString()).run();
  await env.DB.prepare('DELETE FROM funding_log WHERE at < ?1').bind(new Date(Date.now() - 30 * 864e5).toISOString()).run();
  const t = await twilio(env).catch(() => null);
  const c = await claudeHourly(env);
  for (const r of renewalsDue(env.RENEWALS, Date.now())) {
    await fundAlert(env, 'renew:' + r.name + ':' + r.bucket, r.days <= 1 ? 'urgent' : 'warn', 'Always Open: ' + r.name + ' renews ' + (r.days <= 1 ? 'tomorrow' : 'in ' + r.days + ' days'),
      r.name + ' renews on ' + r.date + '. Make sure the card on file works, or service stops.');
  }
  return { twilio: t, claude: c };
}

// For the HQ board.
export async function fundingState(env) {
  await ensure(env);
  const rows = ((await env.DB.prepare("SELECT at, value FROM funding_log WHERE service = 'twilio' AND at > ?1 ORDER BY at").bind(new Date(Date.now() - 7 * 864e5).toISOString()).all()).results) || [];
  if (!rows.length) return { twilio: 'not read yet' };
  const bal = rows[rows.length - 1].value, perDay = burnPerDay(rows), lv = twilioLevel(bal, perDay);
  return { twilio: usd(bal) + ', ' + daysText(lv.daysLeft) + (lv.level === 'ok' ? '' : (lv.level === 'urgent' ? ' (URGENT)' : ' (low)')) };
}
