// Mailed grade letters: the Prospector's finds get a printed, mailed letter with no one lifting a finger.
//
// The Prospector (a weekly scheduled task) adds each business it qualifies to mail_queue: name and town only. On
// weekdays between 10 AM and 3 PM Eastern, this runs a fresh audit for each queued business, and mails a one-page
// letter through Lob (print, envelope and First-Class postage, about $1.42 each in color with its address page):
//   - their grade and the three things we'd fix first (letter.js), signed by the Always Open team;
//   - a QR code to their own live audit page (/your-audit/<token>), where they can have a copy emailed or ask Katie to
//     call. Letter leads are never emailed unless they ask for that copy, and they get no follow-ups (followCron only
//     reads status 'new'; theirs is 'letter'). The first time someone opens the page, Christopher gets a push.
// Guardrails: nothing goes until Christopher turns it on with his caps ("Turn on mailed letters" on the Mac posts to
// /ops/mail-on); at most the daily cap (5) and the monthly ceiling ($60) are spent; only grade C, D or F businesses
// are mailed (a B or better has nothing to fix); Google's top match must carry the name that was queued; never a
// client, someone already in the pipeline, or the same business twice in 180 days, checked by name and by Google's
// place ID (two spellings of one business are one business). Google's details are looked up fresh for each letter and
// never kept: the lead row holds the name the Prospector queued and the place ID (which Google allows us to store), the
// address goes straight to Lob, and the letter's page is held only for the minute Lob takes to fetch it, then cleared.
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
  try { await env.DB.prepare("ALTER TABLE mail_queue ADD COLUMN place_id TEXT DEFAULT ''").run(); } catch (e) { /* already there */ }
  ready.add(env.DB);
}
const meta = async (env, k) => { const r = await env.DB.prepare('SELECT v FROM mail_meta WHERE k = ?1').bind(k).first().catch(() => null); return r ? r.v : ''; };
const setMeta = (env, k, v) => env.DB.prepare('INSERT OR REPLACE INTO mail_meta (k, v, at) VALUES (?1, ?2, ?3)').bind(k, String(v), new Date().toISOString()).run();
const one = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm = s => one(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(llc|inc|co|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
// Words that half the businesses in a trade share; a name has to match on more than these.
const GENERIC = new Set(('plumbing plumber plumbers heating cooling air conditioning hvac electric electrical electrician electricians service services ' +
  'company companies repair repairs auto automotive salon salons spa dental dentistry family construction builder builders contracting contractor contractors ' +
  'roofing roofer marine boat boats restaurant grill cafe insurance agency group solutions pro pros home homes lawn landscaping cleaning pest control ' +
  'center shop store studio drain drains sewer septic mechanical care clinic of ga georgia').split(' '));
// Is Google's top match the business that was queued? Enough of the queued name's words (town words aside) must be in
// Google's name, including at least one that isn't a trade word. "Sinclair Plumbing" is not "Sinclair Dental".
export function nameMatch(queued, google, town) {
  const t = new Set(norm(town).split(' ').filter(Boolean));
  const a = norm(queued).split(' ').filter(w => w && !t.has(w) && !/^[a-z]$/.test(w)), b = norm(google).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  const ca = a.join(''), cb = b.join('');
  if (ca === cb || (ca.length >= 6 && cb.includes(ca)) || (cb.length >= 6 && ca.includes(cb))) return true;   // "A1 Plumbing" is "A-1 Plumbing"
  const same = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const hit = w => b.some(y => same(w, y));
  const own = a.filter(w => !GENERIC.has(w));
  if (!own.length) return a.every(hit);
  return own.some(hit) && a.filter(hit).length / a.length >= 0.6;
}
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
  return { on: true, daily: d, monthly: '$' + m, lob: env.LOB_KEY ? (testKey(env) ? 'test key: up to ' + PROOFS + ' proofs in Lob, nothing mailed' : 'live key') : 'no Lob key yet', returnAddress: fromAddress(env) ? 'set' : 'missing: set BUSINESS_ADDRESS' };
}

const testKey = env => /^test_/.test(env.LOB_KEY || '');
const PROOFS = 3;
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

// The same business found under another spelling: by Google's place ID (clients' own profiles, leads, letters already
// sent) and by Google's name against our clients. Nothing of Google's but the place ID is written down.
async function knownPlace(env, row, pid, gname, now) {
  const all = async (sql, ...a) => { try { return ((await env.DB.prepare(sql).bind(...a).all()).results) || []; } catch (e) { return []; } };
  const clients = await all('SELECT business FROM app_clients');
  if (gname && clients.some(c => nameMatch(c.business, gname, ''))) return 'already a client';
  if (!pid) return '';
  if ((await all("SELECT 1 AS x FROM rival_profile WHERE place_id = ?1 AND found = 1 LIMIT 1", pid)).length) return 'already a client';
  if ((await all("SELECT 1 AS x FROM leads WHERE place_id = ?1 AND COALESCE(origin, '') NOT LIKE 'letter%' AND at > ?2 LIMIT 1", pid, new Date(now - 365 * DAY).toISOString())).length) return 'already in the pipeline';
  if ((await all("SELECT 1 AS x FROM mail_queue WHERE place_id = ?1 AND id != ?2 AND (status = 'sending' OR (status IN ('sent', 'proof') AND sent_at > ?3)) LIMIT 1", pid, row.id, new Date(now - REPEAT_DAYS * DAY).toISOString())).length) return 'mailed in the last 6 months';
  return '';
}

// One letter, start to finish.
async function sendOne(env, row, now, h) {
  const why = await known(env, row, now);
  if (why) return skip(env, row, why);
  let a;
  try { a = await (h.run || runAudit)(env, row.q, row.town); } catch (e) { return skip(env, row, 'audit failed: ' + String((e && e.message) || e).slice(0, 80)); }
  if (!a || !a.found) return skip(env, row, 'not found on Google');
  // Google's top hit has to be the business that was queued, or the letter would grade someone else.
  if (!nameMatch(row.q, a.business.name, row.town)) return skip(env, row, 'Google’s top match has a different name');
  const pid = String(a.business.id || '').slice(0, 200);
  if (pid) await env.DB.prepare('UPDATE mail_queue SET place_id = ?1 WHERE id = ?2').bind(pid, row.id).run();
  const dup = await knownPlace(env, row, pid, a.business.name, now);
  if (dup) return skip(env, row, dup);
  if (a.business.status && a.business.status !== 'OPERATIONAL') return skip(env, row, 'not open (' + a.business.status.toLowerCase() + ')');
  if (/^[AB]$/.test(a.grade)) { await env.DB.prepare('UPDATE mail_queue SET grade = ?1, score = ?2 WHERE id = ?3').bind(a.grade, a.score, row.id).run(); return skip(env, row, 'already in good shape (' + a.grade + ')'); }
  const to = splitAddress(a.business.address);
  if (!to) return skip(env, row, 'no mailing address on Google');
  // Their private audit page: a lead row the QR code opens (the page runs the audit fresh each time).
  await (await import('./leadmail.js')).ensureLeadMail(env);
  const t = tok(), link = SITE + '/your-audit/' + t;
  // The lead keeps the name the Prospector queued (ours) and Google's place ID, never Google's display name.
  const ins = await env.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, type, plan, link, notes, origin, ip_hash, status, sms_ok, ref, token, audit, audit_at, grade, place_id) VALUES (?1, '', '', '', ?2, ?3, ?4, '', '', ?5, ?6, '', 'letter', 'no', '', ?7, 'letter', ?1, ?8, ?9)")
    .bind(new Date(now).toISOString(), one(row.q).slice(0, 120), row.town, row.kind || '', 'Mailed a grade letter (' + a.grade + ').', 'letter ' + row.id, t, a.grade, pid).run();
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
    const proof = testKey(env);
    await env.DB.prepare("UPDATE mail_queue SET status = ?1, html = '', letter_id = ?2, sent_at = ?3, expected = ?4, cost = ?5, note = ?6 WHERE id = ?7")
      .bind(proof ? 'proof' : 'sent', String(sent.id || ''), new Date(now).toISOString(), proof ? '' : String(sent.expected_delivery_date || ''), proof ? 0 : COST_CENTS, proof ? 'proof: made in Lob, not mailed' : '', row.id).run();
    return proof ? 'proof' : 'sent';
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
  let left;
  if (testKey(env)) {
    // Test key: up to three proofs, made in Lob's dashboard and never mailed, so he can see and scan a real one.
    const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'proof'").first();
    left = PROOFS - (+p.n || 0);
    if (left <= 0) return { waiting: PROOFS + ' proofs made; the live key mails' };
  } else {
    // Live key: proofs go back in line (their test pages are retired), then the caps.
    const old = ((await env.DB.prepare("SELECT lead_id FROM mail_queue WHERE status = 'proof'").all()).results) || [];
    for (const o of old) if (o.lead_id) await env.DB.prepare("DELETE FROM leads WHERE id = ?1 AND origin LIKE 'letter%'").bind(o.lead_id).run().catch(() => {});
    if (old.length) await env.DB.prepare("UPDATE mail_queue SET status = 'queued', token = '', letter_id = '', lead_id = NULL, sent_at = '', note = '' WHERE status = 'proof'").run();
    const daily = +(await meta(env, 'daily')) || DEFAULTS.daily, monthly = +(await meta(env, 'monthly_cents')) || DEFAULTS.monthly;
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'sent' AND sent_at >= ?1").bind(new Date(now - 14 * 3600e3).toISOString()).first();
    const month = await env.DB.prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM mail_queue WHERE status = 'sent' AND substr(sent_at, 1, 7) = ?1").bind(new Date(now).toISOString().slice(0, 7)).first();
    left = Math.min(daily - (+today.n || 0), Math.floor((monthly - (+month.c || 0)) / COST_CENTS));
    if (left <= 0) return { waiting: 'cap reached', today: +today.n || 0, month: '$' + ((+month.c || 0) / 100).toFixed(2) };
  }
  const rows = ((await env.DB.prepare("SELECT * FROM mail_queue WHERE status = 'queued' ORDER BY added LIMIT ?1").bind(Math.min(left, 3)).all()).results) || [];
  const out = [];
  for (const r of rows) out.push({ q: r.q, result: await sendOne(env, r, now, h) });
  const sent = out.filter(x => x.result === 'sent' || x.result === 'proof');
  if (sent.length && h.ping !== false) {
    const ping = h.ping || (async (t, b) => (await import('./app.js')).opsPing(env, t, b, 'default', 'envelope'));
    const names = ((await env.DB.prepare("SELECT q, grade, expected FROM mail_queue WHERE status IN ('sent', 'proof') AND sent_at = ?1").bind(new Date(now).toISOString()).all()).results) || [];
    const list = names.map(n => n.q + ' (' + n.grade + ')' + (n.expected ? ', lands about ' + n.expected : '')).join('\n');
    if (testKey(env)) await ping('Always Open: ' + (sent.length === 1 ? 'a proof letter is' : sent.length + ' proof letters are') + ' ready in Lob', list + '\nNot mailed. See it in Lob\u2019s dashboard under Letters, and scan its code with your phone to test the push.');
    else await ping('Always Open: mailed ' + sent.length + (sent.length === 1 ? ' grade letter' : ' grade letters'), list + '\nYou get a push the moment one of them scans their code.');
  }
  const failed = out.filter(x => /^failed/.test(x.result));
  if (failed.length) { try { await (await import('./ops.js')).opsAlert(env, 'mail', '', failed.map(f => f.q + ': ' + f.result).join('; ')); } catch (x) { /* noted in the queue */ } }
  return { mailed: out.filter(x => x.result === 'sent').length, proofs: out.filter(x => x.result === 'proof').length, results: out };
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
