// Customers sign up for a business's texts themselves (Nov 22, 2026). Until now the only OK to contact was the owner's
// word ("they told me it's fine", marked one person at a time, past.js). This is the customer's own, in writing:
//   - the web: the owner shares a link or a QR code (/ok/<code>); the customer types their name and mobile number,
//     ticks an unticked box under the exact words of what they will get, and taps Sign me up. One text comes back from
//     the business's own number, and their YES to it confirms (it proves the number is theirs).
//   - a text: JOIN (or SUBSCRIBE, SIGN UP) to the business's number gets the same words back, and YES confirms.
// Every step is kept in biz_consent: the words shown and their fingerprint, when, from where (IP and browser for the web)
// and the id of the YES text, so the consent can be shown later. STOP ends it at once (sms.js endConsent). Once
// confirmed, the customer is OK to contact (biz_customers.agreed = 1, agreed_how = 'self'), the same as the owner
// marking them, so the messages that wait for an OK (past customers, Fill my week) may go to them. Nothing else changes:
// every text still goes through sendText (opt-outs, daytime, the ceilings, the business's own registered texting).
import { sendText, ownNumber, senderFor, ph10 } from './sms.js';
import { ensurePast } from './past.js';
import { qrSvg } from './qr.js';

const SITE = 'https://alwaysopenoffice.com';
export const PENDING_HOURS = 48;          // a YES counts this long after the sign-up text
const PER_IP_HOUR = 5;                    // web sign-ups from one address in an hour, every business together
const PER_CLIENT_DAY = 150;               // sign-up texts for one business in a day
const AGAIN_MS = 24 * 3600e3;             // one sign-up text per number per business a day
const MIN_FILL_MS = 2500;                 // a form sent faster than this is a bot
const JOIN = new Set(['join', 'subscribe', 'sign up', 'signup', 'sign me up', 'opt in', 'optin', 'texts please']);
const YES = new Set(['yes', 'y', 'yes please', 'yess', 'yes i agree', 'i agree', 'si', 'sí', 'confirm']);
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

const made = new WeakSet();
export async function ensureConsent(env) {
  if (env.DB && made.has(env.DB)) return;
  await ensurePast(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_consent (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, phone10 TEXT NOT NULL, name TEXT DEFAULT '', how TEXT DEFAULT 'web', status TEXT DEFAULT 'pending', words TEXT DEFAULT '', words_v TEXT DEFAULT '', page TEXT DEFAULT '', ip TEXT DEFAULT '', ua TEXT DEFAULT '', asked_at TEXT, text_sid TEXT DEFAULT '', confirmed_at TEXT DEFAULT '', confirm_sid TEXT DEFAULT '', ended_at TEXT DEFAULT '', ended_why TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS biz_consent_p ON biz_consent (client_id, phone10, status)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS biz_consent_ip ON biz_consent (ip, asked_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS consent_links (client_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created TEXT)')
  ]);
  made.add(env.DB);
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pretty = p10 => p10 ? '(' + p10.slice(0, 3) + ') ' + p10.slice(3, 6) + '-' + p10.slice(6) : '';
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
async function fingerprint(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map(x => ALPHA[x % ALPHA.length]).join('');
}
// Plain text, the same everywhere, so the business name can't change what the customer agreed to.
export function bizName(s) { return clean(s, 60).replace(/[&"]/g, '') || 'this business'; }

// The exact words beside the box on the page. Kept with each sign-up (and its fingerprint), so what they agreed to
// can be shown later word for word.
export function pageWords(biz) {
  return 'Yes, text me at this number. ' + biz + ' may send me texts about my appointments, jobs and estimates, and now ' +
    'and then an offer or an opening in their schedule, about 4 texts a month at most. Texts may be sent by an ' +
    'automated system. Message and data rates may apply. Reply STOP to end, HELP for help. Saying yes is not a ' +
    'condition of buying anything.';
}
// The one text that asks for the YES (the web and JOIN both). GSM characters only, so it stays one or two segments.
export function askText(biz) {
  return biz + ': reply YES to get our texts (appointments, jobs, offers). Up to 4 msgs/mo. Msg & data rates may apply. Reply STOP to end, HELP for help.';
}
export const doneText = biz => biz + ": you're signed up for our texts. Reply STOP any time to end.";

// The business's sign-up link (made once, kept).
export async function signupLink(env, cid) {
  await ensureConsent(env);
  let r = await env.DB.prepare('SELECT code FROM consent_links WHERE client_id = ?1').bind(cid).first();
  if (!r) {
    for (let i = 0; i < 5 && !r; i++) {
      const code = newCode();
      await env.DB.prepare('INSERT OR IGNORE INTO consent_links (client_id, code, created) VALUES (?1, ?2, ?3)').bind(cid, code, new Date().toISOString()).run().catch(() => null);
      r = await env.DB.prepare('SELECT code FROM consent_links WHERE client_id = ?1').bind(cid).first();
    }
  }
  return r ? SITE + '/ok/' + r.code : '';
}
// For the owner's app: the link, whether it works yet (the business texts from its own registered number), and how
// many customers signed up themselves.
export async function signupState(env, cid) {
  await ensureConsent(env);
  const number = await ownNumber(env, cid);
  const sender = number ? await senderFor(env, cid).catch(() => null) : null;
  const c = await env.DB.prepare('SELECT regulated FROM app_clients WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const ready = !!(number && sender) && !(c && +c.regulated);
  return { url: ready ? await signupLink(env, cid) : '', ready, self: await selfCount(env, cid) };
}
export async function selfCount(env, cid) {
  await ensureConsent(env);
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM biz_customers WHERE client_id = ?1 AND agreed = 1 AND optout = 0 AND agreed_how = 'self'").bind(cid).first().catch(() => null);
  return +(r && r.n) || 0;
}

// Who the link belongs to, and whether that business can text yet (its own number, its registered texting).
async function businessFor(env, code) {
  if (!/^[a-z0-9]{6,20}$/.test(code || '')) return null;
  const l = await env.DB.prepare('SELECT client_id FROM consent_links WHERE code = ?1').bind(code).first().catch(() => null);
  if (!l) return null;
  const c = await env.DB.prepare('SELECT client_id, business, active, regulated, banned FROM app_clients WHERE client_id = ?1').bind(l.client_id).first().catch(() => null);
  if (!c || !+c.active || c.banned) return null;
  const number = await ownNumber(env, c.client_id);
  const sender = number ? await senderFor(env, c.client_id).catch(() => null) : null;
  return { cid: c.client_id, biz: bizName(c.business), number, ready: !!(number && sender) && !+c.regulated, regulated: !!+c.regulated };
}
async function optedOut(env, cid, p10) {
  const a = await env.DB.prepare('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, p10).first().catch(() => null);
  if (a) return true;
  const b = await env.DB.prepare('SELECT 1 AS x FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 AND optout = 1').bind(cid, p10).first().catch(() => null);
  return !!b;
}
const confirmedRow = (env, cid, p10) => env.DB.prepare("SELECT id FROM biz_consent WHERE client_id = ?1 AND phone10 = ?2 AND status = 'confirmed' ORDER BY id DESC LIMIT 1").bind(cid, p10).first().catch(() => null);
const pendingRow = (env, cid, p10, since) => env.DB.prepare("SELECT id, asked_at, name FROM biz_consent WHERE client_id = ?1 AND phone10 = ?2 AND status = 'pending' AND asked_at > ?3 ORDER BY id DESC LIMIT 1").bind(cid, p10, since).first().catch(() => null);

// ---------- the page ----------
const STYLE = 'body{margin:0;background:#0b0d12;color:#eef1f6;font:17px/1.5 -apple-system,system-ui,"Segoe UI",Roboto,Arial,sans-serif}' +
  'main{max-width:520px;margin:0 auto;padding:28px 18px 40px}h1{font-size:28px;line-height:1.2;margin:0 0 6px}' +
  '.sub{color:#b9c0cc;margin:0 0 22px}form{background:#151922;border:1px solid #262c38;border-radius:14px;padding:18px}' +
  'label{display:block;font-weight:600;margin:0 0 14px}input[type=text],input[type=tel]{display:block;width:100%;box-sizing:border-box;margin-top:6px;' +
  'font-size:18px;padding:12px;border-radius:10px;border:1px solid #39404f;background:#0e1118;color:#fff}' +
  '.box{display:flex;gap:12px;align-items:flex-start;font-weight:400;font-size:15px;line-height:1.45;color:#dfe4ec}' +
  '.box input{width:24px;height:24px;flex:none;margin-top:2px}button{width:100%;font-size:18px;font-weight:700;padding:14px;border:0;' +
  'border-radius:12px;background:#ff3b5c;color:#fff;margin-top:6px}.fine{font-size:13px;color:#9aa3b2;margin:16px 0 0}' +
  '.fine a{color:#c9d2e0}.msg{background:#1d2430;border-radius:12px;padding:14px 16px;margin:0 0 18px}.bad{border-left:4px solid #ff3b5c}' +
  '.ok{border-left:4px solid #2fd27b}.hp{position:absolute;left:-5000px}';
function shell(title, inner) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + esc(title) + '</title><style>' + STYLE + '</style></head><body><main>' + inner + '</main></body></html>';
}
const html = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const fine = b => '<p class="fine">' + esc(b.biz) + ' uses Always Open to send its texts. We keep your sign-up (your name, number, the time and the words above) ' +
  'to show you agreed, and never sell or share your number. <a href="' + SITE + '/privacy">Privacy</a> · <a href="' + SITE + '/terms">Terms</a></p>';
function formPage(b, o) {
  o = o || {};
  const words = pageWords(b.biz);
  return shell('Texts from ' + b.biz,
    '<h1>Texts from ' + esc(b.biz) + '</h1><p class="sub">Appointment reminders, job updates and the odd opening in their schedule.</p>' +
    (o.note ? '<div class="msg ' + (o.bad ? 'bad' : 'ok') + '">' + o.note + '</div>' : '') +
    '<form method="post" action="/ok/' + esc(o.code) + '" autocomplete="on">' +
    '<label>Your name<input type="text" name="name" maxlength="80" autocomplete="name" required value="' + esc(o.name || '') + '"></label>' +
    '<label>Mobile number<input type="tel" name="phone" maxlength="20" autocomplete="tel" inputmode="tel" required value="' + esc(o.phone || '') + '"></label>' +
    '<label class="box"><input type="checkbox" name="agree" value="yes" required><span>' + esc(words) + '</span></label>' +
    '<input type="hidden" name="t" value="' + (o.now || Date.now()) + '"><label class="hp" aria-hidden="true">Leave empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label>' +
    '<button type="submit">Sign me up</button></form>' +
    (b.number ? '<p class="fine">Or text <b>JOIN</b> to ' + esc(pretty(ph10(b.number))) + ' and reply YES.</p>' : '') + fine(b));
}
const notReady = b => html(shell('Texts from ' + b.biz, '<h1>Texts from ' + esc(b.biz) + '</h1><div class="msg bad">' +
  (b.regulated ? 'This business can’t sign people up for texts here.' : 'Texts from ' + esc(b.biz) + ' aren’t switched on yet. Please check back soon.') + '</div>'));
const notFound = () => html(shell('Sign-up link', '<h1>That link isn’t right</h1><div class="msg bad">Ask the business for their text sign-up link or QR code.</div>'), 404);

// GET /ok/<code> (the page), POST /ok/<code> (the sign-up), GET /ok/<code>/qr.svg (the code to print).
export async function handleSignup(req, env, url, now) {
  now = now || Date.now();
  await ensureConsent(env);
  const parts = url.pathname.split('/').filter(Boolean);   // ['ok', code, 'qr.svg'?]
  const code = String(parts[1] || '').toLowerCase();
  const b = await businessFor(env, code);
  if (!b || parts.length > 3 || (parts[2] && parts[2] !== 'qr.svg')) return notFound();
  if (parts[2] === 'qr.svg') {
    if (req.method !== 'GET') return new Response('', { status: 405, headers: { Allow: 'GET' } });
    return new Response(qrSvg(SITE + '/ok/' + code, 'Texts from ' + b.biz + ': scan to sign up'), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
  }
  if (!b.ready) return notReady(b);
  if (req.method === 'GET' || req.method === 'HEAD') return html(formPage(b, { code, now }));
  if (req.method !== 'POST') return new Response('', { status: 405, headers: { Allow: 'GET, POST' } });
  const len = +(req.headers.get('content-length') || 0);
  if (len > 4000) return html(formPage(b, { code, now, bad: true, note: 'That didn’t go through. Try again.' }), 413);
  let f; try { f = new URLSearchParams(await req.text()); } catch (e) { f = new URLSearchParams(); }
  const name = clean(f.get('name'), 80), raw = clean(f.get('phone'), 20), p10 = ph10(raw), t = +f.get('t') || 0;
  const again = (note, status) => html(formPage(b, { code, now, name, phone: raw, bad: true, note }), status || 400);
  // a bot fills the hidden field, or sends the form faster than a person can (or from a page left open for days)
  if (f.get('website') || !t || now - t < MIN_FILL_MS || now - t > 86400e3) return again('That didn’t go through. Please fill it in again.');
  if (!name) return again('Please type your name.');
  if (!p10 || /^(\d)\1{9}$/.test(p10) || /^[01]/.test(p10)) return again('Please type a 10-digit US mobile number.');
  if (f.get('agree') !== 'yes') return again('Tick the box to say yes to the texts.');
  if (p10 === ph10(b.number)) return again('That’s the business’s own number. Please type your mobile number.');
  if (await optedOut(env, b.cid, p10)) {
    return html(formPage(b, { code, now, name, phone: raw, bad: true, note: 'You asked ' + esc(b.biz) + ' to stop texting you. To turn texts back on, text <b>START</b> to ' + esc(pretty(ph10(b.number))) + '.' }), 409);
  }
  if (await confirmedRow(env, b.cid, p10)) return html(formPage(b, { code, now, note: 'You’re already signed up for texts from ' + esc(b.biz) + '. Reply STOP to any of their texts to end them.' }));
  const ip = clean(req.headers.get('cf-connecting-ip') || '', 64), ua = clean(req.headers.get('user-agent') || '', 200);
  const hourAgo = new Date(now - 3600e3).toISOString(), dayAgo = new Date(now - 86400e3).toISOString();
  const fromIp = ip ? await env.DB.prepare('SELECT COUNT(*) AS n FROM biz_consent WHERE ip = ?1 AND asked_at > ?2').bind(ip, hourAgo).first() : null;
  if (fromIp && +fromIp.n >= PER_IP_HOUR) return again('Too many sign-ups from here in the last hour. Try again later.', 429);
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM biz_consent WHERE client_id = ?1 AND asked_at > ?2 AND text_sid != \'\'').bind(b.cid, dayAgo).first();
  if (today && +today.n >= PER_CLIENT_DAY) return again('Sign-ups are paused for today. Please try again tomorrow.', 429);
  const recent = await pendingRow(env, b.cid, p10, new Date(now - AGAIN_MS).toISOString());
  if (recent) return html(formPage(b, { code, now, note: 'We already texted ' + esc(pretty(p10)) + '. Reply <b>YES</b> to that text from ' + esc(pretty(ph10(b.number))) + ' and you’re in.' }));
  const words = pageWords(b.biz), nowIso = new Date(now).toISOString();
  const ins = await env.DB.prepare("INSERT INTO biz_consent (client_id, phone10, name, how, status, words, words_v, page, ip, ua, asked_at) VALUES (?1,?2,?3,'web','pending',?4,?5,?6,?7,?8,?9)")
    .bind(b.cid, p10, name, words, await fingerprint(words), SITE + '/ok/' + code, ip, ua, nowIso).run();
  const id = ins.meta.last_row_id;
  const sent = await sendText(env, { clientId: b.cid, to: p10, body: askText(b.biz), kind: 'consent' }).catch(e => ({ ok: false, why: String(e && e.message || e) }));
  if (!sent.ok) {
    await env.DB.prepare("UPDATE biz_consent SET status = 'expired', ended_at = ?1, ended_why = ?2 WHERE id = ?3").bind(nowIso, 'text did not go: ' + String(sent.why || '').slice(0, 80), id).run();
    return again('We couldn’t text that number just now. Try again in a few minutes, or text <b>JOIN</b> to ' + esc(pretty(ph10(b.number))) + '.', 502);
  }
  await env.DB.prepare('UPDATE biz_consent SET text_sid = ?1 WHERE id = ?2').bind(sent.sid || '', id).run();
  return html(shell('Check your phone', '<h1>Almost done</h1><div class="msg ok">We just texted ' + esc(pretty(p10)) + ' from ' + esc(b.biz) + ' (' + esc(pretty(ph10(b.number))) +
    '). Reply <b>YES</b> to that text and you’re signed up. It counts for 48 hours.</div>' + fine(b)));
}

// ---------- texts (from sms.js handleSms, for a business whose texting is registered) ----------
// JOIN starts a sign-up by text; YES to a sign-up text (from the web or JOIN) in the last 48 hours confirms it.
// Returns { reply, mark, note } for the inbox and the answer, or null when the text is something else.
export async function consentFromText(env, cid, from10, body, biz, msgSid, now) {
  now = now || Date.now();
  const w = String(body || '').replace(/[‘’]/g, "'").trim().toLowerCase().replace(/[\s.!]+$/, '').replace(/\s+/g, ' ');
  const isJoin = JOIN.has(w), isYes = YES.has(w);
  if (!isJoin && !isYes) return null;
  await ensureConsent(env);
  const name = bizName(biz), nowIso = new Date(now).toISOString();
  if (isYes) {
    const p = await pendingRow(env, cid, from10, new Date(now - PENDING_HOURS * 3600e3).toISOString());
    if (!p) return null;   // a YES to something else (a Fill my week offer, a question): not ours
    await env.DB.prepare("UPDATE biz_consent SET status = 'confirmed', confirmed_at = ?1, confirm_sid = ?2 WHERE id = ?3").bind(nowIso, String(msgSid || '').slice(0, 40), p.id).run();
    await env.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, agreed, agreed_at, agreed_how, opt_token, source, created, updated) VALUES (?1,?2,?3,?4,?2,1,?5,'self',?6,'self',?5,?5) " +
      "ON CONFLICT(client_id, ckey) DO UPDATE SET name = CASE WHEN name = '' THEN excluded.name ELSE name END, phone = CASE WHEN phone = '' THEN excluded.phone ELSE phone END, " +
      "agreed = CASE WHEN optout = 1 THEN agreed ELSE 1 END, agreed_at = CASE WHEN optout = 1 THEN agreed_at ELSE excluded.agreed_at END, agreed_how = CASE WHEN optout = 1 THEN agreed_how ELSE 'self' END, updated = excluded.updated")
      .bind(cid, from10, clean(p.name, 80), pretty(from10), nowIso, newCode() + newCode()).run();
    return { reply: doneText(name), mark: 'Signed up for texts', note: 'they signed up for your texts.' };
  }
  if (await confirmedRow(env, cid, from10)) return { reply: "You're already signed up for texts from " + name + '. Reply STOP any time to end.', mark: 'Asked to join (already signed up)', note: 'they asked to join your texts (already signed up).' };
  if (await pendingRow(env, cid, from10, new Date(now - 10 * 60e3).toISOString())) return { reply: '', mark: 'Asked to join', note: 'they asked to join your texts.' };
  const words = askText(name);
  await env.DB.prepare("INSERT INTO biz_consent (client_id, phone10, how, status, words, words_v, asked_at, text_sid) VALUES (?1,?2,'keyword','pending',?3,?4,?5,?6)")
    .bind(cid, from10, words, await fingerprint(words), nowIso, String(msgSid || '').slice(0, 40)).run();
  return { reply: words, mark: 'Asked to join', note: 'they asked to join your texts.' };
}

// STOP (sms.js), or the business removing the customer (past.js): every open sign-up for that number ends.
export async function endConsent(env, cid, p10, why, now) {
  if (!p10) return 0;
  await ensureConsent(env);
  const r = await env.DB.prepare("UPDATE biz_consent SET status = 'revoked', ended_at = ?1, ended_why = ?2 WHERE client_id = ?3 AND phone10 = ?4 AND status IN ('pending', 'confirmed')")
    .bind(new Date(now || Date.now()).toISOString(), clean(why, 80), cid, p10).run();
  return r.meta.changes || 0;
}
