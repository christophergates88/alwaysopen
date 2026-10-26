// Customer booking page (/b/<ref>), invoice reminders with a pay link (/i/<token>), and Facebook/Instagram posting.
// Tables create themselves on first use. Nothing posts or sends without the owner's approval in the app.
import { openSlots, bookSlot, gcalStatus } from './gcal.js';
import { pushClient, sha256hex } from './app.js';

const SITE = 'https://alwaysopenoffice.com';
const GRAPH = 'https://graph.facebook.com/v21.0';
const META_REDIRECT = SITE + '/meta/callback';
const META_SCOPES = 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management';
export const TEXTING_ON = false;   // flips on when the Twilio campaign is approved

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const val = (f, k, n) => String(f.get(k) || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
function token(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); }

export function page(status, title, inner) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><meta name="robots" content="noindex">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&display=swap" rel="stylesheet">' +
    '<style>:root{--bg:#07080c;--card:#10131b;--ink:#f3f4f7;--slate:#9aa3b5;--line:#262c3a;--red:#ff3b30;--glow:rgba(255,59,48,.45)}*{box-sizing:border-box}' +
    'body{margin:0;background:radial-gradient(600px 300px at 50% -80px,rgba(255,59,48,.22),transparent),var(--bg);color:var(--ink);font:16px/1.55 Archivo,system-ui,sans-serif;padding:24px 16px}' +
    'main{max-width:520px;margin:0 auto;background:var(--card);border:1.5px solid var(--red);box-shadow:0 0 28px var(--glow);border-radius:20px;padding:24px;display:grid;gap:14px}' +
    'h1{margin:0;font:900 1.7rem/1.1 Archivo,system-ui;text-shadow:0 0 14px var(--glow)}.sub,.fine{color:var(--slate);margin:0}.fine{font-size:13px}.err{color:var(--red);margin:0;font-weight:700}' +
    'form{display:grid;gap:12px}label{display:grid;gap:6px;font-weight:700}input,textarea{font:inherit;padding:12px;border:1.5px solid var(--line);border-radius:10px;background:#0b0d13;color:var(--ink)}' +
    '.slots{display:grid;grid-template-columns:1fr 1fr;gap:8px;border:0;padding:0;margin:0}.slots legend{font-weight:700;margin-bottom:6px}.slot{display:block;font-weight:500}.slot input{position:absolute;opacity:0}' +
    '.slot span{display:block;padding:10px;border:1.5px solid var(--line);border-radius:10px;text-align:center;font-size:14px;cursor:pointer}.slot input:checked+span{border-color:var(--red);box-shadow:0 0 12px var(--glow)}.slot input:focus-visible+span{outline:2px solid #fff}' +
    '.opt{display:grid;grid-template-columns:22px 1fr;gap:10px;font-weight:500;font-size:14px;color:var(--slate)}.opt input{width:18px;height:18px;margin:2px 0 0;accent-color:var(--red)}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px}button,.btn{display:block;text-align:center;text-decoration:none;font:700 16px Archivo,system-ui;padding:14px;border:0;border-radius:11px;background:var(--red);color:#fff;cursor:pointer;box-shadow:0 0 18px var(--glow)}' +
    '.ghost{background:transparent;border:1.5px solid var(--line);box-shadow:none;color:var(--ink)}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}dt{color:var(--slate)}dd{margin:0;font-weight:700}.big{font:900 2.2rem Archivo,system-ui}</style></head><body><main><h1>' + esc(title) + '</h1>' + inner + '</main></body></html>';
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

// ---------------- booking page ----------------
export async function handleBooking(req, env, ctx, url) {
  const ref = decodeURIComponent(url.pathname.slice(3)).replace(/\/+$/, '');
  const c = /^[a-z0-9-]{3,40}$/.test(ref) ? await env.DB.prepare('SELECT client_id, business, ref FROM app_clients WHERE ref = ?1 AND active = 1').bind(ref).first() : null;
  if (!c) return page(404, 'Not found', '<p>This booking page is not available.</p>');
  if (!(await gcalStatus(env, c.client_id)).connected) return Response.redirect(SITE + '/q/' + encodeURIComponent(c.ref), 302);
  const open = await openSlots(env, c.client_id, Date.now(), 12).catch(() => null);
  if (!open) return Response.redirect(SITE + '/q/' + encodeURIComponent(c.ref), 302);
  if (req.method === 'GET') return bookForm(c, open, '');
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const f = await req.formData();
  const name = val(f, 'name', 80), phone = val(f, 'phone', 30), email = val(f, 'email', 120), reason = val(f, 'reason', 600), start = +f.get('slot') || 0;
  const smsOk = f.get('sms_ok') === 'yes' ? 1 : 0, t = +f.get('t') || 0;
  if (val(f, 'website', 100) || (t && Date.now() - t < 2500)) return page(200, 'Thank you', '<p>Your request was sent.</p>');
  const v = { name, phone, email, reason, start };
  if (!name || phone.replace(/\D/g, '').length < 10) return bookForm(c, open, 'Please add your name and a phone number.', v);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bookForm(c, open, 'That email does not look right.', v);
  const slot = open.slots.find(s => s.start === start);
  if (!slot) return bookForm(c, open, 'That time was just taken. Please pick another.', v);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT, name TEXT, phone TEXT, need TEXT, sms_ok INTEGER DEFAULT 0, status TEXT DEFAULT 'new', done_at TEXT, ip_hash TEXT)").run();
  const ip = (await sha256hex((req.headers.get('cf-connecting-ip') || '') + '|' + (env.IP_SALT || 'salt'))).slice(0, 24);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_leads WHERE ip_hash = ?1 AND at > ?2').bind(ip, new Date(Date.now() - 3600e3).toISOString()).first();
  if (n && n.n >= 5) return page(429, 'Thank you', '<p>We already have your booking. ' + esc(c.business) + ' will be in touch.</p>');
  const ok = await bookSlot(env, c.client_id, slot, { name, phone, reason: reason + (email ? '\nEmail: ' + email : ''), via: 'the online booking page' });
  if (!ok) return bookForm(c, open, 'We could not book that time. Please try another or try again.', v);
  const need = 'Booked ' + slot.say + (reason ? ': ' + reason : '') + (email ? ' (' + email + ')' : '');
  await env.DB.prepare("INSERT INTO app_leads (client_id, at, name, phone, need, sms_ok, status, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'new', ?7)").bind(c.client_id, new Date().toISOString(), name, phone, need, smsOk, ip).run();
  ctx.waitUntil(pushClient(env, c.client_id, { aps: { alert: { title: 'New booking: ' + name, body: need.slice(0, 300) }, sound: 'default', 'thread-id': 'leads' }, screen: 'home' }).catch(() => {}));
  return page(200, 'You’re booked', '<p>Thank you, ' + esc(name.split(' ')[0]) + '. ' + esc(c.business) + ' has you down for <b>' + esc(slot.say) + '</b>. They’ll reach out if anything changes.</p>');
}
function bookForm(c, open, err, v) {
  v = v || {};
  const slots = open.slots.length ? '<fieldset class="slots"><legend>Pick a time</legend>' + open.slots.map((s, i) => '<label class="slot"><input type="radio" name="slot" value="' + s.start + '"' + ((v.start ? v.start === s.start : i === 0) ? ' checked' : '') + ' required><span>' + esc(s.say) + '</span></label>').join('') + '</fieldset>'
    : '<p class="err">No open times this week. <a style="color:#fff" href="/q/' + esc(c.ref) + '">Send a request instead</a>.</p>';
  return page(err ? 400 : 200, 'Book with ' + c.business,
    '<p class="sub">Pick a time that works. ' + esc(c.business) + ' gets it on their calendar right away.</p>' + (err ? '<p class="err">' + esc(err) + '</p>' : '') +
    '<form method="post"><input type="hidden" name="t" value="' + Date.now() + '"><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' + slots +
    '<label>Your name<input name="name" autocomplete="name" required value="' + esc(v.name || '') + '"></label>' +
    '<label>Phone<input name="phone" type="tel" autocomplete="tel" required value="' + esc(v.phone || '') + '"></label>' +
    '<label>Email (optional)<input name="email" type="email" autocomplete="email" value="' + esc(v.email || '') + '"></label>' +
    '<label>What is it for?<textarea name="reason" rows="3">' + esc(v.reason || '') + '</textarea></label>' +
    '<label class="opt"><input type="checkbox" name="sms_ok" value="yes"><span>OK to text me about this appointment. Reply STOP to opt out.</span></label>' +
    (open.slots.length ? '<button>Book this time</button>' : '') + '</form>' +
    '<p class="fine">Your details go only to ' + esc(c.business) + '. Booking page by Always Open.</p>');
}

// ---------------- invoices ----------------
export async function ensureInvoices(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, token TEXT UNIQUE, number TEXT DEFAULT '', name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', amount INTEGER DEFAULT 0, due TEXT DEFAULT '', pay_link TEXT DEFAULT '', sms_ok INTEGER DEFAULT 0, status TEXT DEFAULT 'open', created TEXT, paid_at TEXT DEFAULT '', reminded TEXT DEFAULT '')").run();
}
const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
export function invOut(r) {
  return { id: r.id, number: r.number || '', name: r.name || '', phone: r.phone || '', email: r.email || '', amount: (+r.amount || 0) / 100, amountText: money(+r.amount || 0), due: r.due || '', status: r.status === 'paid' ? 'paid' : 'open', paidAt: r.paid_at || '', link: SITE + '/i/' + r.token, payLink: r.pay_link || '', text: !!+r.sms_ok };
}
export async function invoicesFor(env, cid) {
  try {
    await ensureInvoices(env);
    const rows = (await env.DB.prepare("SELECT * FROM app_invoices WHERE client_id = ?1 AND (status = 'open' OR paid_at > ?2) ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due LIMIT 60").bind(cid, new Date(Date.now() - 30 * 864e5).toISOString()).all()).results || [];
    const unpaid = rows.filter(r => r.status === 'open').reduce((a, r) => a + (+r.amount || 0), 0);
    return { invoices: rows.map(invOut), unpaid: unpaid / 100 };
  } catch (e) { return { invoices: [], unpaid: 0 }; }
}
// App: POST /api/invoice {action:'add', number,name,phone,email,amount,due,payLink,consent} | {action:'paid'|'open'|'delete', id}
export async function apiInvoice(req, env, c) {
  await ensureInvoices(env);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  const s = (k, n) => String(b[k] == null ? '' : b[k]).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
  if (b.action === 'add') {
    const name = s('name', 80), phone = s('phone', 30).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''), email = s('email', 120), pay = s('payLink', 500), due = s('due', 10);
    const cents = Math.round(parseFloat(String(b.amount).replace(/[$,]/g, '')) * 100);
    if (!name) return aj({ ok: false, error: 'Add the customer’s name.' }, 400);
    if (!(cents > 0 && cents < 1e9)) return aj({ ok: false, error: 'Add the amount.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return aj({ ok: false, error: 'Add the due date.' }, 400);
    if (!/^https:\/\/[^\s]+\.[^\s]+/.test(pay)) return aj({ ok: false, error: 'Add your pay link (it starts with https://).' }, 400);
    if (phone && !/^\d{10}$/.test(phone)) return aj({ ok: false, error: 'Add a 10-digit number, or leave it blank.' }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aj({ ok: false, error: 'That email does not look right.' }, 400);
    if (!phone && !email) return aj({ ok: false, error: 'Add a phone number or email so reminders can reach them.' }, 400);
    const tk = token(24), now = new Date().toISOString();
    const ins = await env.DB.prepare('INSERT INTO app_invoices (client_id, token, number, name, phone, email, amount, due, pay_link, sms_ok, created) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)')
      .bind(c.client_id, tk, s('number', 30), name, phone, email, cents, due, pay, b.consent === true && phone ? 1 : 0, now).run();
    const row = await env.DB.prepare('SELECT * FROM app_invoices WHERE id = ?1').bind(ins.meta.last_row_id).first();
    return aj({ ok: true, invoice: invOut(row) });
  }
  const id = +b.id || 0;
  if (b.action === 'delete') { const r = await env.DB.prepare('DELETE FROM app_invoices WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).run(); return aj({ ok: !!r.meta.changes }); }
  const paid = b.action === 'paid';
  const r = await env.DB.prepare('UPDATE app_invoices SET status = ?1, paid_at = ?2 WHERE id = ?3 AND client_id = ?4').bind(paid ? 'paid' : 'open', paid ? new Date().toISOString() : '', id, c.client_id).run();
  if (paid) await env.DB.prepare("UPDATE app_items SET status = 'closed', updated = ?1 WHERE client_id = ?2 AND kind = 'invoice' AND status = 'pending' AND id LIKE ?3").bind(new Date().toISOString(), c.client_id, 'inv-' + id + '-%').run();
  return aj({ ok: !!r.meta.changes });
}
// Public invoice page. "Mark paid" here only works for the owner (?code=...); customers just see Pay invoice.
export async function handleInvoicePage(req, env, url) {
  await ensureInvoices(env);
  const tk = url.pathname.slice(3).replace(/\/+$/, '');
  const inv = /^[A-Za-z0-9]{24}$/.test(tk) ? await env.DB.prepare('SELECT i.*, c.business FROM app_invoices i JOIN app_clients c ON c.client_id = i.client_id WHERE i.token = ?1').bind(tk).first() : null;
  if (!inv) return page(404, 'Not found', '<p>This invoice link is not available.</p>');
  if (req.method === 'POST') {
    const f = await req.formData();
    const code = String(f.get('code') || '');
    const own = code.length >= 24 && await env.DB.prepare('SELECT client_id FROM app_clients WHERE code_hash = ?1 AND client_id = ?2').bind(await sha256hex(code), inv.client_id).first();
    if (!own) return page(403, 'Not allowed', '<p>Only ' + esc(inv.business) + ' can mark this paid.</p>');
    await env.DB.prepare("UPDATE app_invoices SET status = 'paid', paid_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), inv.id).run();
    await env.DB.prepare("UPDATE app_items SET status = 'closed', updated = ?1 WHERE client_id = ?2 AND kind = 'invoice' AND status = 'pending' AND id LIKE ?3").bind(new Date().toISOString(), inv.client_id, 'inv-' + inv.id + '-%').run();
    inv.status = 'paid';
  }
  const paid = inv.status === 'paid';
  const owner = url.searchParams.get('code') || '';
  return page(200, (inv.number ? 'Invoice ' + inv.number : 'Invoice') + ' from ' + inv.business,
    '<p class="big">' + money(+inv.amount) + '</p><dl><dt>For</dt><dd>' + esc(inv.name) + '</dd><dt>Due</dt><dd>' + esc(inv.due) + '</dd><dt>Status</dt><dd>' + (paid ? 'Paid. Thank you!' : 'Open') + '</dd></dl>' +
    (paid ? '' : '<a class="btn" href="' + esc(inv.pay_link) + '" rel="noopener noreferrer">Pay invoice</a>') +
    (!paid && owner ? '<form method="post"><input type="hidden" name="code" value="' + esc(owner) + '"><button class="ghost">Mark paid</button></form>' : '') +
    '<p class="fine">Payment goes straight to ' + esc(inv.business) + ' through their own pay link. Questions? Contact ' + esc(inv.business) + ' directly.</p>');
}
export function reminderText(inv, biz, days) {
  return 'Hi ' + String(inv.name || '').split(' ')[0] + ', a friendly reminder from ' + biz + ' that invoice' + (inv.number ? ' #' + inv.number : '') + ' (' + money(+inv.amount) + ') was due ' + inv.due + '. You can see it and pay here: ' + SITE + '/i/' + inv.token + (days >= 7 ? ' If you already paid, thank you, and please ignore this.' : '');
}
// Cron: on due+3 and due+7 a reminder draft lands in the owner's Approve list.
export async function invoiceCron(env, at) {
  try {
    await ensureInvoices(env);
    const now = at || Date.now();
    const rows = (await env.DB.prepare("SELECT i.*, c.business FROM app_invoices i JOIN app_clients c ON c.client_id = i.client_id WHERE i.status = 'open' AND c.active = 1 LIMIT 500").all()).results || [];
    let made = 0;
    for (const inv of rows) {
      const late = Math.floor((now - Date.parse(inv.due + 'T12:00:00Z')) / 864e5);
      const step = late >= 7 ? 7 : (late >= 3 ? 3 : 0);
      if (!step || String(inv.reminded || '').split(',').includes(String(step))) continue;
      const id = 'inv-' + inv.id + '-' + step, ts = new Date(now).toISOString();
      await env.DB.prepare("INSERT OR IGNORE INTO app_items (id, client_id, kind, title, context, text, status, hq_synced, created, updated) VALUES (?1, ?2, 'invoice', ?3, ?4, ?5, 'pending', 1, ?6, ?6)")
        .bind(id, inv.client_id, 'Invoice reminder: ' + inv.name + ' (' + money(+inv.amount) + ')', (inv.number ? 'Invoice #' + inv.number + ', ' : '') + step + ' days past due ' + inv.due, reminderText(inv, inv.business, step), ts).run();
      await env.DB.prepare('UPDATE app_invoices SET reminded = ?1 WHERE id = ?2').bind((inv.reminded ? inv.reminded + ',' : '') + step, inv.id).run();
      made++;
    }
    return made;
  } catch (e) { return 0; }
}
// After the owner approves a reminder: email it when we can, text only with consent and once texting is on.
export async function sendInvoiceReminder(env, c, it, text, mailer) {
  const m = /^inv-(\d+)-/.exec(it.id || '');
  if (!m) return 'none';
  const inv = await env.DB.prepare('SELECT * FROM app_invoices WHERE id = ?1 AND client_id = ?2').bind(+m[1], c.client_id).first();
  if (!inv || inv.status === 'paid') return 'none';
  let out = [];
  if (inv.email && mailer) out.push('email:' + await mailer(inv.email, 'Invoice reminder from ' + (c.business || ''), text));
  if (TEXTING_ON && inv.sms_ok && inv.phone) out.push('text:queued');
  return out.join(',') || 'manual';
}

// ---------------- Facebook and Instagram ----------------
export function metaReady(env) { return !!(env.META_APP_ID && env.META_APP_SECRET); }
export async function ensureMeta(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta_pages (client_id TEXT PRIMARY KEY, page_id TEXT, page_name TEXT, page_token TEXT, ig_id TEXT, connected_at TEXT)').run();
}
export async function metaStatus(env, cid) {
  if (!metaReady(env)) return { available: false, connected: false, page: '', instagram: false };
  try { await ensureMeta(env); const r = await env.DB.prepare('SELECT page_name, ig_id FROM meta_pages WHERE client_id = ?1').bind(cid).first(); return { available: true, connected: !!r, page: r ? r.page_name || '' : '', instagram: !!(r && r.ig_id) }; }
  catch (e) { return { available: true, connected: false, page: '', instagram: false }; }
}
async function hmac(env, data) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.META_APP_SECRET || 'x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export async function handleMeta(req, env, url) {
  const msg = (t, x, s) => page(s || 200, t, '<p>' + x + '</p>');
  if (!metaReady(env)) return msg('Coming soon', 'Facebook and Instagram posting is coming soon.', 404);
  await ensureMeta(env);
  const p = url.pathname;
  if (p === '/meta/connect') {
    const code = url.searchParams.get('code') || '';
    const c = code.length >= 24 ? await env.DB.prepare('SELECT client_id FROM app_clients WHERE code_hash = ?1 AND active = 1').bind(await sha256hex(code)).first() : null;
    if (!c) return msg('Link not valid', 'Open this from the Always Open app, signed in as the owner.', 403);
    const ts = String(Date.now()), state = c.client_id + '.' + ts + '.' + await hmac(env, c.client_id + '.' + ts);
    return Response.redirect('https://www.facebook.com/v21.0/dialog/oauth?' + new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: META_REDIRECT, state, scope: META_SCOPES, response_type: 'code' }), 302);
  }
  if (p === '/meta/callback') {
    const st = String(url.searchParams.get('state') || '').split('.');
    if (st.length !== 3 || st[2] !== await hmac(env, st[0] + '.' + st[1]) || Date.now() - +st[1] > 3600e3) return msg('Link expired', 'Please tap Connect Facebook in the app again.', 400);
    if (!url.searchParams.get('code')) return msg('Not connected', 'Facebook did not give access. You can try again from the app any time.', 400);
    const t = await (await fetch(GRAPH + '/oauth/access_token?' + new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: META_REDIRECT, code: url.searchParams.get('code') }))).json().catch(() => ({}));
    if (!t.access_token) return msg('Not connected', 'Facebook did not finish connecting. Please try again.', 400);
    const ll = await (await fetch(GRAPH + '/oauth/access_token?' + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: t.access_token }))).json().catch(() => ({}));
    const pages = await (await fetch(GRAPH + '/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=' + encodeURIComponent(ll.access_token || t.access_token))).json().catch(() => ({}));
    const pg = (pages.data || [])[0];
    if (!pg) return msg('No page found', 'We could not find a Facebook Page on that account. Make sure you picked your business Page, then try again.', 400);
    await env.DB.prepare('INSERT OR REPLACE INTO meta_pages (client_id, page_id, page_name, page_token, ig_id, connected_at) VALUES (?1,?2,?3,?4,?5,?6)')
      .bind(st[0], pg.id, pg.name || '', pg.access_token, (pg.instagram_business_account || {}).id || '', new Date().toISOString()).run();
    return msg('Facebook connected', 'Approved posts will now go to ' + esc(pg.name || 'your Page') + ((pg.instagram_business_account) ? ' and your Instagram' : '') + '. Nothing posts until you approve it in the app.');
  }
  if (p === '/meta/disconnect' && req.method === 'POST') {
    let code = ''; try { code = String((await req.json()).code || ''); } catch (e) {}
    const c = code.length >= 24 ? await env.DB.prepare('SELECT client_id FROM app_clients WHERE code_hash = ?1').bind(await sha256hex(code)).first() : null;
    if (!c) return aj({ ok: false }, 403);
    await env.DB.prepare('DELETE FROM meta_pages WHERE client_id = ?1').bind(c.client_id).run();
    return aj({ ok: true });
  }
  return new Response('Not found', { status: 404 });
}
// Only called after the owner approves a post that has a photo.
export async function metaPublish(env, cid, text, photoUrl) {
  if (!metaReady(env) || !photoUrl) return 'off';
  await ensureMeta(env);
  const m = await env.DB.prepare('SELECT * FROM meta_pages WHERE client_id = ?1').bind(cid).first();
  if (!m) return 'off';
  const out = [];
  const post = async (path, params) => { const r = await fetch(GRAPH + path, { method: 'POST', body: new URLSearchParams(Object.assign({ access_token: m.page_token }, params)) }); return r.json().catch(() => ({})); };
  const fb = await post('/' + m.page_id + '/photos', { url: photoUrl, caption: text });
  out.push('fb:' + (fb.id ? 'ok' : 'fail'));
  if (m.ig_id) {
    const cr = await post('/' + m.ig_id + '/media', { image_url: photoUrl, caption: text });
    const pub = cr.id ? await post('/' + m.ig_id + '/media_publish', { creation_id: cr.id }) : {};
    out.push('ig:' + (pub.id ? 'ok' : 'fail'));
  }
  return out.join(',');
}
