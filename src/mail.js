// Mailed grade letters: the Prospector's finds get a printed, mailed letter with no one lifting a finger.
//
// The Prospector (a weekly scheduled task) adds each business it qualifies to mail_queue: name and town only. On
// weekdays between 10 AM and 3 PM Eastern, this runs a fresh audit for each queued business, and mails a one-page
// letter through Lob (print, envelope and First-Class postage, about $1.42 each in color with its address page):
//   - their grade and the three things we'd fix first (letter.js), signed by the Always Open team;
//   - a QR code to their own live audit page (/your-audit/<token>), where they can have a copy emailed and the usual
//     follow-ups start. The first time someone opens it, Christopher gets a push: that business is reading it now.
// Guardrails: nothing goes until Christopher turns it on with his caps ("Turn on mailed letters" on the Mac posts to
// /ops/mail-on); at most the daily cap (5) and the monthly ceiling ($60) are spent; only grade C, D or F businesses
// are mailed (a B or better has nothing to fix); never a client, someone already in the pipeline, or the same
// business twice in 180 days. Google's details are looked up fresh for each letter and never kept: the address goes
// straight to Lob, the letter's page is held only for the minute Lob takes to fetch it, then cleared.
import { runAudit } from './audit.js';
import { letterFor, mailPage } from './letter.js';
import { qrSvg } from './qr.js';

const SITE = 'https://alwaysopenoffice.com';
const LOB = 'https://api.lob.com/v1/';
const COST_CENTS = 142;                    // color letter, First Class, plus the address page (Lob's Developer plan)
const DEFAULTS = { daily: 5, monthly: 6000 };
const REPEAT_DAYS = 180;
const DAY = 864e5;

const ready = new WeakSet();
export async function ensureMail(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mail_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, q TEXT, town TEXT, kind TEXT DEFAULT '', added TEXT, status TEXT DEFAULT 'queued', grade TEXT DEFAULT '', score INTEGER, letter_id TEXT DEFAULT '', lead_id INTEGER, tried_at TEXT DEFAULT '', token TEXT DEFAULT '', html TEXT DEFAULT '', sent_at TEXT DEFAULT '', expected TEXT DEFAULT '', cost INTEGER DEFAULT 0, opened_at TEXT DEFAULT '', note TEXT DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mail_meta (k TEXT PRIMARY KEY, v TEXT, at TEXT)')
  ]);
  ready.add(env.DB);
}
const meta = async (env, k) => { const r = await env.DB.prepare('SELECT v FROM mail_meta WHERE k = ?1').bind(k).first().catch(() => null); return r ? r.v : ''; };
const setMeta = (env, k, v) => env.DB.prepare('INSERT OR REPLACE INTO mail_meta (k, v, at) VALUES (?1, ?2, ?3)').bind(k, String(v), new Date().toISOString()).run();
const one = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm = s => one(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(llc|inc|co|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
function tok() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(16)); return [...r].map(x => a[x % a.length]).join(''); }
function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, month: p.year + '-' + p.month, hour: +p.hour % 24, wd: p.weekday };
}

// "103 W Sumter St, Eatonton, GA 31024, USA" -> the parts Lob wants.
export function splitAddress(a) {
  const m = /^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,\s*(?:USA|United States))?$/.exec(one(a));
  return m ? { address_line1: m[1].slice(0, 64), address_city: m[2].slice(0, 200), address_state: m[3], address_zip: m[4] } : null;
}
// The return address is the business's real one (the BUSINESS_ADDRESS secret, also in every email's footer); without it, nothing mails.
function fromAddress(env) {
  const a = splitAddress(env.BUSINESS_ADDRESS || '');
  return a ? Object.assign({ name: 'Always Open' }, a) : null;
}

// The Prospector (or anyone with the key) adds businesses. Returns how many were new.
export async function queueLetters(env, items, now) {
  await ensureMail(env);
  let added = 0;
  for (const it of (items || []).slice(0, 30)) {
    const q = one(it.q || it.business).slice(0, 120), town = one(it.town).slice(0, 80);
    if (q.length < 2) continue;
    const slug = one(it.slug) || norm(q + ' ' + town).replace(/ /g, '-').slice(0, 90);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO mail_queue (slug, q, town, kind, added, status) VALUES (?1, ?2, ?3, ?4, ?5, 'queued')").bind(slug, q, town, one(it.kind).slice(0, 40), new Date(now || Date.now()).toISOString()).run();
    if (r.meta && r.meta.changes) added++;
  }
  return { added };
}

// Christopher's yes, with his caps.
export async function turnOn(env, daily, monthlyDollars) {
  await ensureMail(env);
  const d = Math.max(1, Math.min(25, parseInt(daily, 10) || DEFAULTS.daily));
  const m = Math.max(10, Math.min(500, parseInt(monthlyDollars, 10) || DEFAULTS.monthly / 100));
  await setMeta(env, 'enabled', 'yes'); await setMeta(env, 'daily', d); await setMeta(env, 'monthly_cents', m * 100);
  return { on: true, daily: d, monthly: '$' + m, lob: env.LOB_KEY ? (/^test_/.test(env.LOB_KEY) ? 'test key: letters are made in Lob but not mailed' : 'live key') : 'no Lob key yet', returnAddress: fromAddress(env) ? 'set' : 'missing: set BUSINESS_ADDRESS' };
}

async function skip(env, row, why) { await env.DB.prepare("UPDATE mail_queue SET status = 'skipped', note = ?1 WHERE id = ?2").bind(why, row.id).run(); return 'skipped: ' + why; }

// Someone we already know: a client, a lead, or a business we mailed in the last 180 days.
async function known(env, row, now) {
  const n = norm(row.q);
  if (!n) return 'no name';
  const clients = ((await env.DB.prepare('SELECT business FROM app_clients').all()).results) || [];
  if (clients.some(c => norm(c.business) === n)) return 'already a client';
  const leads = ((await env.DB.prepare("SELECT business FROM leads WHERE COALESCE(origin, '') NOT LIKE 'letter%' AND at > ?1").bind(new Date(now - 365 * DAY).toISOString()).all().catch(() => ({ results: [] }))).results) || [];
  if (leads.some(l => norm(l.business) === n)) return 'already in the pipeline';
  const mailed = ((await env.DB.prepare("SELECT q FROM mail_queue WHERE status = 'sent' AND sent_at > ?1 AND id != ?2").bind(new Date(now - REPEAT_DAYS * DAY).toISOString(), row.id).all()).results) || [];
  if (mailed.some(x => norm(x.q) === n)) return 'mailed in the last 6 months';
  return '';
}

async function lob(env, h, method, path, body, idem) {
  const f = (h && h.fetch) || fetch;
  const headers = { authorization: 'Basic ' + btoa(env.LOB_KEY + ':'), 'content-type': 'application/json' };
  if (idem) headers['idempotency-key'] = idem;
  const r = await f(LOB + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Lob answered ' + r.status)); e.status = r.status; throw e; }
  return j;
}

// One letter, start to finish.
async function sendOne(env, row, now, h) {
  const why = await known(env, row, now);
  if (why) return skip(env, row, why);
  let a;
  try { a = await (h.run || runAudit)(env, row.q, row.town); } catch (e) { return skip(env, row, 'audit failed: ' + String((e && e.message) || e).slice(0, 80)); }
  if (!a || !a.found) return skip(env, row, 'not found on Google');
  if (a.business.status && a.business.status !== 'OPERATIONAL') return skip(env, row, 'not open (' + a.business.status.toLowerCase() + ')');
  if (/^[AB]$/.test(a.grade)) { await env.DB.prepare('UPDATE mail_queue SET grade = ?1, score = ?2 WHERE id = ?3').bind(a.grade, a.score, row.id).run(); return skip(env, row, 'already in good shape (' + a.grade + ')'); }
  const to = splitAddress(a.business.address);
  if (!to) return skip(env, row, 'no mailing address on Google');
  // Their private audit page: a lead row the QR code opens (the page runs the audit fresh each time).
  await (await import('./leadmail.js')).ensureLeadMail(env);
  const t = tok(), link = SITE + '/your-audit/' + t;
  const ins = await env.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, type, plan, link, notes, origin, ip_hash, status, sms_ok, ref, token, audit, audit_at, grade) VALUES (?1, '', '', '', ?2, ?3, ?4, '', '', ?5, ?6, '', 'letter', 'no', '', ?7, 'letter', ?1, ?8)")
    .bind(new Date(now).toISOString(), one(a.business.name).slice(0, 120), row.town, row.kind || '', 'Mailed a grade letter (' + a.grade + ').', 'letter ' + row.id, t, a.grade).run();
  const leadId = ins && ins.meta && ins.meta.last_row_id;
  const L = letterFor(a, {
    offer: 'Try it for a month. If it isn’t worth it, you don’t pay. No contract and no setup fee.',
    mailed: true,
    contact: 'Questions? Call (706) 460-2226. Max answers any hour, and Katie calls you back.',
    sign: 'The Always Open team, Eatonton, Georgia'
  });
  L.qr = qrSvg(link, 'QR code to your live audit'); L.qrLink = link.replace('https://', '');
  const html = mailPage(L);
  await env.DB.prepare("UPDATE mail_queue SET status = 'sending', token = ?1, html = ?2, lead_id = ?3, grade = ?4, score = ?5, tried_at = ?6 WHERE id = ?7").bind(t, html, leadId || null, a.grade, a.score, new Date(now).toISOString(), row.id).run();
  try {
    const sent = await lob(env, h, 'POST', 'letters', {
      description: 'Grade letter: ' + one(a.business.name).slice(0, 200), to: Object.assign({ name: one(a.business.name).slice(0, 40) }, to), from: fromAddress(env),
      file: SITE + '/mail/letter/' + t, color: true, double_sided: false, address_placement: 'insert_blank_page', mail_type: 'usps_first_class', use_type: 'marketing',
      metadata: { queue: String(row.id) }
    }, 'ao-letter-' + row.id);
    await env.DB.prepare("UPDATE mail_queue SET status = 'sent', html = '', letter_id = ?1, sent_at = ?2, expected = ?3, cost = ?4, note = ?5 WHERE id = ?6")
      .bind(String(sent.id || ''), new Date(now).toISOString(), String(sent.expected_delivery_date || ''), COST_CENTS, /^test_/.test(env.LOB_KEY) ? 'test mode: not mailed' : '', row.id).run();
    return 'sent';
  } catch (e) {
    await env.DB.prepare("UPDATE mail_queue SET status = 'failed', html = '', note = ?1 WHERE id = ?2").bind(String((e && e.message) || e).slice(0, 160), row.id).run();
    if (leadId) await env.DB.prepare("DELETE FROM leads WHERE id = ?1 AND origin LIKE 'letter%'").bind(leadId).run().catch(() => {});
    return 'failed: ' + String((e && e.message) || e).slice(0, 80);
  }
}

// GET /mail/letter/<token>: the letter's page, for Lob to fetch while the letter is being made; gone right after.
export async function serveLetter(env, token) {
  await ensureMail(env);
  if (!/^[A-Za-z0-9]{16}$/.test(token || '')) return null;
  const r = await env.DB.prepare("SELECT html FROM mail_queue WHERE token = ?1 AND status = 'sending' AND html != ''").bind(token).first().catch(() => null);
  return r ? r.html : null;
}

// Every 10 minutes. Mails what's queued, within the caps, on weekdays 10 AM to 3 PM Eastern.
export async function mailCron(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!env.LOB_KEY) return { off: 'no Lob key' };
  if (!fromAddress(env)) return { off: 'no return address' };
  await ensureMail(env);
  if (await meta(env, 'enabled') !== 'yes') return { off: 'not turned on' };
  const e = eastern(now);
  if (/Sat|Sun/.test(e.wd) || e.hour < 10 || e.hour >= 15) return { waiting: 'outside mailing hours' };
  // A letter stuck "sending" (the Worker stopped mid-way) is retried; Lob's idempotency key keeps it to one letter.
  await env.DB.prepare("UPDATE mail_queue SET status = 'queued', html = '' WHERE status = 'sending' AND tried_at < ?1").bind(new Date(now - 30 * 60e3).toISOString()).run().catch(() => {});
  const daily = +(await meta(env, 'daily')) || DEFAULTS.daily, monthly = +(await meta(env, 'monthly_cents')) || DEFAULTS.monthly;
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'sent' AND sent_at >= ?1").bind(new Date(now - 14 * 3600e3).toISOString()).first();
  const month = await env.DB.prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM mail_queue WHERE status = 'sent' AND substr(sent_at, 1, 7) = ?1").bind(new Date(now).toISOString().slice(0, 7)).first();
  const left = Math.min(daily - (+today.n || 0), Math.floor((monthly - (+month.c || 0)) / COST_CENTS));
  if (left <= 0) return { waiting: 'cap reached', today: +today.n || 0, month: '$' + ((+month.c || 0) / 100).toFixed(2) };
  const rows = ((await env.DB.prepare("SELECT * FROM mail_queue WHERE status = 'queued' ORDER BY added LIMIT ?1").bind(Math.min(left, 3)).all()).results) || [];
  const out = [];
  for (const r of rows) out.push({ q: r.q, result: await sendOne(env, r, now, h) });
  const sent = out.filter(x => x.result === 'sent');
  if (sent.length && h.ping !== false) {
    const ping = h.ping || (async (t, b) => (await import('./app.js')).opsPing(env, t, b, 'default', 'envelope'));
    const names = ((await env.DB.prepare("SELECT q, grade, expected FROM mail_queue WHERE status = 'sent' AND sent_at = ?1").bind(new Date(now).toISOString()).all()).results) || [];
    await ping('Always Open: mailed ' + sent.length + (sent.length === 1 ? ' grade letter' : ' grade letters'), names.map(n => n.q + ' (' + n.grade + ')' + (n.expected ? ', lands about ' + n.expected : '')).join('\n') + (/^test_/.test(env.LOB_KEY) ? '\nTest mode: made in Lob, not mailed.' : '\nYou get a push the moment one of them scans their code.'));
  }
  const failed = out.filter(x => /^failed/.test(x.result));
  if (failed.length) { try { await (await import('./ops.js')).opsAlert(env, 'mail', '', failed.map(f => f.q + ': ' + f.result).join('; ')); } catch (x) { /* noted in the queue */ } }
  return { mailed: sent.length, results: out };
}

// The audit page (leadmail.js) calls this on a letter's first open: the hottest moment to call them.
export async function letterOpened(env, lead, h) {
  await ensureMail(env);
  const m = /^letter (\d+)$/.exec(lead.origin || '');
  if (!m) return false;
  const r = await env.DB.prepare("UPDATE mail_queue SET opened_at = ?1 WHERE id = ?2 AND (opened_at = '' OR opened_at IS NULL)").bind(new Date().toISOString(), +m[1]).run();
  if (!(r.meta && r.meta.changes)) return false;
  const ping = (h && h.ping) || (async (t, b) => (await import('./app.js')).opsPing(env, t, b, 'high', 'envelope_with_arrow'));
  await ping('Always Open: ' + one(lead.business) + ' just scanned their letter', one(lead.business) + (lead.town ? ' in ' + one(lead.town) : '') + ' is looking at their audit right now (grade ' + (lead.grade || '?') + '). A call today lands while it’s on their mind. Their number is on their Google profile.');
  return true;
}

// For the 7 AM push: letters landing today, and any opened since yesterday.
export async function mailMorning(env, now) {
  try {
    await ensureMail(env);
    const day = eastern(now || Date.now()).day;
    const landing = ((await env.DB.prepare("SELECT q FROM mail_queue WHERE status = 'sent' AND expected = ?1 LIMIT 6").bind(day).all()).results) || [];
    const opened = ((await env.DB.prepare("SELECT q FROM mail_queue WHERE opened_at > ?1 LIMIT 6").bind(new Date((now || Date.now()) - DAY).toISOString()).all()).results) || [];
    const parts = [];
    if (landing.length) parts.push('Letters landing today: ' + landing.map(x => x.q).join(', ') + '.');
    if (opened.length) parts.push('Letters scanned: ' + opened.map(x => x.q).join(', ') + '.');
    return parts.join(' ');
  } catch (e) { return ''; }
}
