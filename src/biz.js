// Jobs, quotes, Stripe Connect payments, the shared inbox, review insights, team roles, onboarding and the weekly summary.
// Tables create themselves on first use. Nothing is sent to a customer or posted without the owner (or their team) tapping it.
import { pushClient, sha256hex, mailTo } from './app.js';
import { page, ensureInvoices, invOut } from './extras.js';
import { TEXTING_ON, replyText } from './sms.js';
import { lostSince, LABELS as LOST_LABELS } from './lost.js';
import { buildRevive } from './past.js';
import { rivalLine } from './rivals.js';

const SITE = 'https://alwaysopenoffice.com';
const GRAPH = 'https://graph.facebook.com/v21.0';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n);
const now = () => new Date().toISOString();
function token(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); }
export const money = cents => '$' + ((+cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: (+cents || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
function monthStart(d) { d = d || new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }
const cents = v => { const x = Math.round(parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')) * 100); return x > 0 && x < 1e10 ? x : 0; };

const READY = new WeakSet();
export async function ensureBiz(env) {
  if (env.DB && READY.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', title TEXT DEFAULT '', stage TEXT DEFAULT 'new', amount INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', source_id TEXT DEFAULT '', quote_id INTEGER DEFAULT 0, invoice_id INTEGER DEFAULT 0, created TEXT, updated TEXT, by TEXT DEFAULT '')"),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS biz_jobs_src ON biz_jobs (client_id, source, source_id)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, token TEXT UNIQUE, number TEXT DEFAULT '', name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', items TEXT DEFAULT '[]', tax_rate REAL DEFAULT 0, notes TEXT DEFAULT '', subtotal INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, total INTEGER DEFAULT 0, status TEXT DEFAULT 'open', job_id INTEGER DEFAULT 0, invoice_id INTEGER DEFAULT 0, created TEXT, accepted_at TEXT DEFAULT '', by TEXT DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_stripe (client_id TEXT PRIMARY KEY, account TEXT, ready INTEGER DEFAULT 0, checked TEXT, created TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_pay (session TEXT PRIMARY KEY, client_id TEXT, invoice_id INTEGER, account TEXT, created TEXT, paid INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, channel TEXT, thread TEXT, name TEXT DEFAULT '', text TEXT, dir TEXT DEFAULT 'in', at TEXT, by TEXT DEFAULT '', status TEXT DEFAULT 'new', ext_id TEXT DEFAULT '')"),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS biz_msgs_ext ON biz_msgs (channel, ext_id)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_insights (client_id TEXT NOT NULL, month TEXT NOT NULL, data TEXT, reviews INTEGER DEFAULT 0, at TEXT, PRIMARY KEY (client_id, month))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT, who TEXT, role TEXT, what TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_prefs (client_id TEXT PRIMARY KEY, weekly_off INTEGER DEFAULT 0, weekly_sent TEXT DEFAULT '', onboard TEXT DEFAULT '{}')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_staff (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT, created TEXT)")
  ]);
  for (const sql of ["ALTER TABLE app_staff ADD COLUMN role TEXT DEFAULT 'manager'"]) { try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ } }
  READY.add(env.DB);
}

// ---------------- language for customer pages ----------------
export function langOf(req, url) {
  const q = url.searchParams.get('lang');
  if (q === 'es' || q === 'en') return q;
  const al = String(req.headers.get('accept-language') || '').trim().toLowerCase();
  return /^es\b/.test(al) ? 'es' : 'en';
}
export function langBar(url, lang) {
  const u = new URL(url.toString());
  const to = l => { u.searchParams.set('lang', l); return esc(u.pathname + u.search); };
  return '<p class="fine" style="text-align:right;margin:0">' + (lang === 'es' ? '<a style="color:inherit" href="' + to('en') + '" lang="en">English</a> | <b>Español</b>' : '<b>English</b> | <a style="color:inherit" href="' + to('es') + '" lang="es">Español</a>') + '</p>';
}
export const TR = {
  en: {
    reqTitle: 'Request from {b}', reqSub: 'Tell {b} what you need. They get it on their phone right away.', name: 'Your name', phone: 'Phone', need: 'What do you need?',
    smsReq: 'OK to text me about this request. Reply STOP to opt out.', sendReq: 'Send my request', fineReq: 'Your details go only to {b}. Request form by Always Open.',
    errReq: 'Please add your name, a phone number and what you need.', sent: 'Request sent', thanks: 'Thank you', sentLine: 'Thank you, {n}. {b} has your request and will call you back{t}.', orText: ' or text you',
    already: 'We already have your request. {b} will be in touch.', gotIt: 'Your request was sent.', notAvail: 'This page is not available.', notFound: 'Not found',
    bookTitle: 'Book with {b}', bookSub: 'Pick a time that works. {b} gets it on their calendar right away.', pick: 'Pick a time', email: 'Email (optional)', reason: 'What is it for?',
    smsBook: 'OK to text me about this appointment. Reply STOP to opt out.', bookBtn: 'Book this time', fineBook: 'Your details go only to {b}. Booking page by Always Open.',
    noSlots: 'No open times this week.', sendInstead: 'Send a request instead', errBook: 'Please add your name and a phone number.', badEmail: 'That email does not look right.',
    taken: 'That time was just taken. Please pick another.', cantBook: 'We could not book that time. Please try another or try again.', booked: 'You’re booked', bookedLine: 'Thank you, {n}. {b} has you down for {s}. They’ll reach out if anything changes.',
    alreadyBook: 'We already have your booking. {b} will be in touch.',
    invoice: 'Invoice', from: 'from', for: 'For', due: 'Due', status: 'Status', paidThanks: 'Paid. Thank you!', open: 'Open', payInv: 'Pay invoice', payCard: 'Pay by card',
    fineInv: 'Payment goes straight to {b} through their own pay link. Questions? Contact {b} directly.', fineInvStripe: 'Secure card payment by Stripe. The money goes straight to {b}. Questions? Contact {b} directly.',
    markPaid: 'Mark paid', onlyOwner: 'Only {b} can mark this paid.', notAllowed: 'Not allowed', invGone: 'This invoice link is not available.', payDone: 'Thank you! Your payment is being confirmed.',
    quote: 'Estimate', item: 'Item', qty: 'Qty', price: 'Price', amount: 'Amount', subtotal: 'Subtotal', tax: 'Tax', total: 'Total', notes: 'Notes', accept: 'Accept this estimate',
    accepted: 'Accepted. Thank you!', acceptedLine: 'Thank you, {n}. {b} has your OK and will be in touch to schedule.', fineQuote: 'Estimate from {b}. Questions? Contact {b} directly. Page by Always Open.',
    quoteGone: 'This estimate link is not available.', invoiced: 'Invoiced', yourName: 'Type your name to accept', errAccept: 'Please type your name to accept.'
  },
  es: {
    reqTitle: 'Solicitud a {b}', reqSub: 'Dígale a {b} lo que necesita. Lo reciben en su teléfono al instante.', name: 'Su nombre', phone: 'Teléfono', need: '¿Qué necesita?',
    smsReq: 'Acepto recibir mensajes de texto sobre esta solicitud. Responda STOP para no recibir más.', sendReq: 'Enviar mi solicitud', fineReq: 'Sus datos van solo a {b}. Formulario de Always Open.',
    errReq: 'Por favor escriba su nombre, un teléfono y lo que necesita.', sent: 'Solicitud enviada', thanks: 'Gracias', sentLine: 'Gracias, {n}. {b} tiene su solicitud y le devolverá la llamada{t}.', orText: ' o le enviará un mensaje',
    already: 'Ya tenemos su solicitud. {b} se comunicará con usted.', gotIt: 'Su solicitud fue enviada.', notAvail: 'Esta página no está disponible.', notFound: 'No encontrado',
    bookTitle: 'Reserve con {b}', bookSub: 'Elija un horario. {b} lo recibe en su calendario al instante.', pick: 'Elija un horario', email: 'Correo electrónico (opcional)', reason: '¿Para qué es?',
    smsBook: 'Acepto recibir mensajes de texto sobre esta cita. Responda STOP para no recibir más.', bookBtn: 'Reservar este horario', fineBook: 'Sus datos van solo a {b}. Página de reservas de Always Open.',
    noSlots: 'No hay horarios libres esta semana.', sendInstead: 'Envíe una solicitud', errBook: 'Por favor escriba su nombre y un teléfono.', badEmail: 'Ese correo no parece correcto.',
    taken: 'Ese horario se acaba de ocupar. Por favor elija otro.', cantBook: 'No pudimos reservar ese horario. Pruebe otro o inténtelo de nuevo.', booked: 'Su cita está reservada', bookedLine: 'Gracias, {n}. {b} lo tiene anotado para {s}. Le avisarán si algo cambia.',
    alreadyBook: 'Ya tenemos su reserva. {b} se comunicará con usted.',
    invoice: 'Factura', from: 'de', for: 'Para', due: 'Vence', status: 'Estado', paidThanks: 'Pagada. ¡Gracias!', open: 'Pendiente', payInv: 'Pagar factura', payCard: 'Pagar con tarjeta',
    fineInv: 'El pago va directo a {b} por su propio enlace de pago. ¿Preguntas? Comuníquese con {b}.', fineInvStripe: 'Pago seguro con tarjeta por Stripe. El dinero va directo a {b}. ¿Preguntas? Comuníquese con {b}.',
    markPaid: 'Marcar pagada', onlyOwner: 'Solo {b} puede marcarla pagada.', notAllowed: 'No permitido', invGone: 'Este enlace de factura no está disponible.', payDone: '¡Gracias! Estamos confirmando su pago.',
    quote: 'Presupuesto', item: 'Concepto', qty: 'Cant.', price: 'Precio', amount: 'Importe', subtotal: 'Subtotal', tax: 'Impuesto', total: 'Total', notes: 'Notas', accept: 'Aceptar este presupuesto',
    accepted: 'Aceptado. ¡Gracias!', acceptedLine: 'Gracias, {n}. {b} tiene su aprobación y se comunicará para programar.', fineQuote: 'Presupuesto de {b}. ¿Preguntas? Comuníquese con {b}. Página de Always Open.',
    quoteGone: 'Este enlace de presupuesto no está disponible.', invoiced: 'Facturado', yourName: 'Escriba su nombre para aceptar', errAccept: 'Por favor escriba su nombre para aceptar.'
  }
};
export function t(lang, k, v) { let s = (TR[lang] || TR.en)[k] || TR.en[k] || k; for (const x in (v || {})) s = s.split('{' + x + '}').join(v[x]); return s; }

// ---------------- activity log (who did what) ----------------
export async function logAct(env, c, what) {
  try { await ensureBiz(env); await env.DB.prepare('INSERT INTO biz_activity (client_id, at, who, role, what) VALUES (?1,?2,?3,?4,?5)').bind(c.client_id, now(), c.staff || c.whoName || 'Owner', c.role || 'owner', cl(what, 300)).run(); } catch (e) { /* the action still happened */ }
}
const ACT = {
  '/api/decide': b => (b.action === 'skip' ? 'Skipped ' : 'Approved ') + (b.text ? 'with changes: ' : '') + 'item ' + cl(b.id, 60),
  '/api/call': b => (b.action === 'reopen' ? 'Reopened a call' : 'Marked a call handled'),
  '/api/lead': b => (b.action === 'open' ? 'Reopened request #' : 'Marked request done #') + (+b.id || 0),
  '/api/invoice': b => b.action === 'add' ? 'Added an invoice for ' + cl(b.name, 60) : (b.action === 'paid' ? 'Marked invoice #' + (+b.id || 0) + ' paid' : (b.action === 'delete' ? 'Deleted invoice #' + (+b.id || 0) : 'Marked invoice #' + (+b.id || 0) + ' unpaid')),
  '/api/quote': b => b.action === 'add' ? 'Wrote an estimate for ' + cl(b.name, 60) : (b.action === 'invoice' ? 'Turned estimate #' + (+b.id || 0) + ' into an invoice' : 'Deleted estimate #' + (+b.id || 0)),
  '/api/work': b => b.action === 'stage' ? 'Moved job #' + (+b.id || 0) + ' to ' + cl(b.stage, 10) : (b.action === 'add' ? 'Added a job for ' + cl(b.name, 60) : (b.action === 'amount' ? 'Set job #' + (+b.id || 0) + ' amount' : 'Deleted job #' + (+b.id || 0))),
  '/api/inbox': b => 'Sent a Facebook reply',
  '/api/followup': b => b.action === 'add' || !b.id ? 'Added a follow-up' : 'Updated a follow-up',
  '/api/job': b => 'Sent a review request for ' + cl(b.first, 40),
  '/api/message': b => 'Messaged Always Open',
  '/api/line': b => 'Changed Max settings',
  '/api/team': b => 'Changed a team role',
  '/api/prefs': b => 'Changed settings',
  '/api/stripe': b => 'Started Stripe setup',
  '/api/revive': b => b.action === 'refresh' ? '' : (b.action === 'approve' ? '' : (b.action === 'skip' ? 'Skipped a past-customer message' : (b.action === 'agree' ? 'Marked a customer OK to contact' : ''))),
  '/api/import': b => b.action === 'agree' ? 'Changed who is OK to contact' : (b.action === 'forget' ? 'Removed a customer' : (b.action === 'wipe' ? 'Removed all imported customers' : ''))
};
export function actText(sub, b) { const f = ACT[sub]; return f ? f(b || {}) : ''; }

// Roles: owner (their own link), manager, tech. Techs never see money or billing.
export const MONEY_ROUTES = ['/api/invoice', '/api/quote', '/api/stripe', '/api/results', '/api/team', '/api/prefs', '/api/import', '/api/revive'];
export async function staffRole(env, codeHash) {
  try { await ensureBiz(env); const r = await env.DB.prepare('SELECT role FROM app_staff WHERE code_hash = ?1').bind(codeHash).first(); const x = r && r.role; return x === 'tech' || x === 'owner' ? x : 'manager'; } catch (e) { return 'manager'; }
}
export async function apiTeam(req, env, c) {
  if (c.staff) return aj({ ok: false, error: 'Only the owner can change roles.' }, 403);
  await ensureBiz(env);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const role = ['manager', 'tech'].includes(b.role) ? b.role : '';
  if (!role || !/^[0-9a-f]{12}$/.test(String(b.id || ''))) return aj({ ok: false, error: 'Bad request' }, 400);
  const r = await env.DB.prepare('UPDATE app_staff SET role = ?1 WHERE client_id = ?2 AND substr(code_hash, 1, 12) = ?3').bind(role, c.client_id, b.id).run();
  return aj({ ok: !!(r.meta && r.meta.changes) });
}
async function team(env, c) {
  if (c.staff) return [];
  try { return ((await env.DB.prepare('SELECT substr(code_hash, 1, 12) AS id, name, role FROM app_staff WHERE client_id = ?1 ORDER BY name').bind(c.client_id).all()).results || []).map(r => ({ id: r.id, name: r.name || 'Staff', role: r.role === 'tech' ? 'tech' : 'manager' })); } catch (e) { return []; }
}

// ---------------- jobs ----------------
const STAGES = ['new', 'quoted', 'booked', 'done', 'paid'];
// New requests, bookings and Max's calls become jobs on their own (last 60 days, once each).
export async function syncJobs(env, cid) {
  await ensureBiz(env);
  const since = new Date(Date.now() - 60 * 864e5).toISOString(), ts = now();
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO biz_jobs (client_id, name, phone, title, stage, source, source_id, created, updated) SELECT client_id, COALESCE(name,''), COALESCE(phone,''), substr(COALESCE(need,''), 1, 200), CASE WHEN need LIKE 'Booked %' THEN 'booked' ELSE 'new' END, 'lead', CAST(id AS TEXT), at, ?2 FROM app_leads WHERE client_id = ?1 AND at > ?3")
      .bind(cid, ts, since).run();
  } catch (e) { /* no leads table yet */ }
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO biz_jobs (client_id, name, phone, title, stage, source, source_id, created, updated) SELECT client_id, COALESCE(caller_name,''), COALESCE(NULLIF(callback,''), caller, ''), substr(COALESCE(NULLIF(reason,''), summary, 'Phone call'), 1, 200), 'new', 'call', id, at, ?2 FROM app_calls WHERE client_id = ?1 AND at > ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited')")
      .bind(cid, ts, since).run();
  } catch (e) { /* no calls table yet */ }
}
function jobOut(r, money) {
  return { id: r.id, name: r.name || '', phone: r.phone || '', title: r.title || '', stage: STAGES.includes(r.stage) ? r.stage : 'new', amount: money ? (+r.amount || 0) / 100 : null, source: r.source || 'manual', quoteId: +r.quote_id || 0, invoiceId: +r.invoice_id || 0, created: r.created || '', updated: r.updated || '' };
}
export async function apiWork(req, env, c) {
  await ensureBiz(env);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  const id = +b.id || 0, ts = now(), money = c.role !== 'tech';
  if (b.action === 'add') {
    const name = cl(b.name, 80);
    if (!name) return aj({ ok: false, error: 'Add the customer’s name.' }, 400);
    const ins = await env.DB.prepare("INSERT INTO biz_jobs (client_id, name, phone, title, stage, amount, source, source_id, created, updated, by) VALUES (?1,?2,?3,?4,'new',?5,'manual',?6,?7,?7,?8)")
      .bind(c.client_id, name, cl(b.phone, 30), cl(b.title, 200), money ? cents(b.amount) : 0, token(12), ts, c.staff || 'Owner').run();
    return aj({ ok: true, job: jobOut(await env.DB.prepare('SELECT * FROM biz_jobs WHERE id = ?1').bind(ins.meta.last_row_id).first(), money) });
  }
  if (b.action === 'stage') {
    if (!STAGES.includes(b.stage)) return aj({ ok: false, error: 'Bad request' }, 400);
    if (!money && b.stage === 'paid') return aj({ ok: false, error: 'Ask the owner to mark it paid.' }, 403);
    const r = await env.DB.prepare('UPDATE biz_jobs SET stage = ?1, updated = ?2 WHERE id = ?3 AND client_id = ?4').bind(b.stage, ts, id, c.client_id).run();
    if (b.stage === 'paid') {
      const j = await env.DB.prepare('SELECT invoice_id FROM biz_jobs WHERE id = ?1').bind(id).first();
      if (j && +j.invoice_id) await markInvoicePaid(env, c.client_id, +j.invoice_id);
    }
    return aj({ ok: !!r.meta.changes });
  }
  if (b.action === 'onway') {
    // "I'm on the way": one text from the business's own number.
    const j = await env.DB.prepare('SELECT * FROM biz_jobs WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).first();
    const d = String((j && j.phone) || '').replace(/\D/g, '').slice(-10);
    if (!j || d.length !== 10) return aj({ ok: false, error: 'That job has no phone number to text.' }, 400);
    const who = cl(b.by, 40) || c.owner_first || 'We';
    const mins = Math.round(+b.minutes || 0);
    const { sendText } = await import('./sms.js');
    const r = await sendText(env, { clientId: c.client_id, to: '+1' + d, kind: 'onway', body: who + ' from ' + (c.business || 'us') + ' is on the way' + (mins >= 5 && mins <= 240 ? ', about ' + mins + ' minutes out.' : '.') + ' Reply STOP to end texts.' });
    return aj(r.ok ? { ok: true, message: 'Texted ' + (j.name || 'them') + '.' } : { ok: false, error: /registered|not set up|texting/.test(r.why || '') ? 'Texting turns on once your texting registration is approved.' : (r.why === 'opted out' ? 'They asked not to get texts.' : 'Could not send. Try again.') }, r.ok ? 200 : 409);
  }
  if (b.action === 'cancel-booking') {
    // A visit Max booked from a call: the time opens up again, the job goes back to new, and the customer is told (when texting is on).
    const j = await env.DB.prepare("SELECT * FROM biz_jobs WHERE id = ?1 AND client_id = ?2").bind(id, c.client_id).first();
    if (!j || j.source !== 'call') return aj({ ok: false, error: 'That job was not booked by Max.' }, 400);
    const { cancelForCall } = await import('./availability.js');
    const bk = await cancelForCall(env, c.client_id, j.source_id);
    if (!bk) return aj({ ok: false, error: 'That visit is already cancelled.' }, 409);
    await env.DB.prepare("UPDATE biz_jobs SET stage = 'new', title = ?1, updated = ?2 WHERE id = ?3").bind(String(j.title || '').replace(/\s*\([^)]*\)\s*$/, '') + ' (visit cancelled)', ts, id).run();
    let told = false;
    if (b.tell !== false && /^\+1\d{10}$/.test(bk.phone || '')) {
      try { const { sendText } = await import('./sms.js'); const r = await sendText(env, { clientId: c.client_id, to: bk.phone, kind: 'booking', body: 'Your ' + bk.say + ' visit with ' + (c.business || 'us') + ' is cancelled. Reply here or call to set a new time. Reply STOP to end texts.' }); told = !!r.ok; } catch (e) {}
    }
    return aj({ ok: true, told });
  }
  if (b.action === 'amount') {
    if (!money) return aj({ ok: false, error: 'Not allowed' }, 403);
    const r = await env.DB.prepare('UPDATE biz_jobs SET amount = ?1, updated = ?2 WHERE id = ?3 AND client_id = ?4').bind(cents(b.amount), ts, id, c.client_id).run();
    return aj({ ok: !!r.meta.changes });
  }
  if (b.action === 'delete') { const r = await env.DB.prepare('DELETE FROM biz_jobs WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).run(); return aj({ ok: !!r.meta.changes }); }
  return aj({ ok: false, error: 'Bad request' }, 400);
}
// Marks an invoice paid and closes its reminders and job (owner tap, invoice page, or Stripe).
export async function markInvoicePaid(env, cid, invId) {
  await ensureInvoices(env); await ensureBiz(env);
  const ts = now();
  await env.DB.prepare("UPDATE app_invoices SET status = 'paid', paid_at = CASE WHEN paid_at = '' OR paid_at IS NULL THEN ?1 ELSE paid_at END WHERE id = ?2 AND client_id = ?3").bind(ts, invId, cid).run();
  await env.DB.prepare("UPDATE app_items SET status = 'closed', updated = ?1 WHERE client_id = ?2 AND kind = 'invoice' AND status = 'pending' AND id LIKE ?3").bind(ts, cid, 'inv-' + invId + '-%').run().catch(() => {});
  await env.DB.prepare("UPDATE biz_jobs SET stage = 'paid', updated = ?1 WHERE client_id = ?2 AND invoice_id = ?3").bind(ts, cid, invId).run();
}

// ---------------- quotes (estimates) ----------------
function quoteItems(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 40) : [];
  return list.map(x => ({ desc: cl(x && x.desc, 160), qty: Math.max(0, Math.min(100000, Math.round((+(x && x.qty) || 1) * 100) / 100)), price: cents(x && x.price) })).filter(x => x.desc && x.qty > 0);
}
function quoteTotals(items, rate) {
  const sub = items.reduce((a, x) => a + Math.round(x.qty * x.price), 0);
  const tax = Math.round(sub * (rate || 0) / 100);
  return { sub, tax, total: sub + tax };
}
function quoteOut(r) {
  let items = []; try { items = JSON.parse(r.items || '[]'); } catch (e) {}
  return { id: r.id, number: r.number || '', name: r.name || '', phone: r.phone || '', email: r.email || '', items: items.map(x => ({ desc: x.desc, qty: x.qty, price: x.price / 100 })), taxRate: +r.tax_rate || 0, notes: r.notes || '',
    subtotal: (+r.subtotal || 0) / 100, tax: (+r.tax || 0) / 100, total: (+r.total || 0) / 100, totalText: money(+r.total), status: r.status || 'open', jobId: +r.job_id || 0, invoiceId: +r.invoice_id || 0, link: SITE + '/e/' + r.token, created: r.created || '', acceptedAt: r.accepted_at || '' };
}
export async function apiQuote(req, env, c) {
  await ensureBiz(env); await ensureInvoices(env);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  const ts = now();
  if (b.action === 'add') {
    const name = cl(b.name, 80), email = cl(b.email, 120), phone = cl(b.phone, 30).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const items = quoteItems(b.items), rate = Math.max(0, Math.min(20, Math.round((+b.taxRate || 0) * 1000) / 1000));
    if (!name) return aj({ ok: false, error: 'Add the customer’s name.' }, 400);
    if (!items.length || !items.some(x => x.price > 0)) return aj({ ok: false, error: 'Add at least one line with a price.' }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aj({ ok: false, error: 'That email does not look right.' }, 400);
    const tt = quoteTotals(items, rate), tk = token(24);
    let jobId = +b.jobId || 0;
    if (jobId && !(await env.DB.prepare('SELECT id FROM biz_jobs WHERE id = ?1 AND client_id = ?2').bind(jobId, c.client_id).first())) jobId = 0;
    if (!jobId) {
      const j = await env.DB.prepare("INSERT INTO biz_jobs (client_id, name, phone, email, title, stage, amount, source, source_id, created, updated, by) VALUES (?1,?2,?3,?4,?5,'quoted',?6,'quote',?7,?8,?8,?9)")
        .bind(c.client_id, name, phone, email, items[0].desc, tt.total, tk, ts, c.staff || 'Owner').run();
      jobId = j.meta.last_row_id;
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM biz_quotes WHERE client_id = ?1').bind(c.client_id).first();
    const ins = await env.DB.prepare('INSERT INTO biz_quotes (client_id, token, number, name, phone, email, items, tax_rate, notes, subtotal, tax, total, job_id, created, by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)')
      .bind(c.client_id, tk, cl(b.number, 30) || String(1001 + ((n && n.n) || 0)), name, phone, email, JSON.stringify(items), rate, cl(b.notes, 1500), tt.sub, tt.tax, tt.total, jobId, ts, c.staff || 'Owner').run();
    await env.DB.prepare("UPDATE biz_jobs SET quote_id = ?1, amount = ?2, stage = CASE WHEN stage = 'new' THEN 'quoted' ELSE stage END, updated = ?3 WHERE id = ?4").bind(ins.meta.last_row_id, tt.total, ts, jobId).run();
    return aj({ ok: true, quote: quoteOut(await env.DB.prepare('SELECT * FROM biz_quotes WHERE id = ?1').bind(ins.meta.last_row_id).first()) });
  }
  const id = +b.id || 0;
  const q = await env.DB.prepare('SELECT * FROM biz_quotes WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).first();
  if (!q) return aj({ ok: false, error: 'That estimate is gone. Pull down to refresh.' }, 404);
  if (b.action === 'delete') { await env.DB.prepare('DELETE FROM biz_quotes WHERE id = ?1').bind(id).run(); return aj({ ok: true }); }
  if (b.action === 'invoice') {
    if (+q.invoice_id) return aj({ ok: false, error: 'This estimate is already an invoice.' }, 409);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due || '')) ? b.due : new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const pay = cl(b.payLink, 500), st = await stripeStatus(env, c.client_id);
    if (!st.ready && !/^https:\/\/[^\s]+\.[^\s]+/.test(pay)) return aj({ ok: false, error: 'Add your pay link (it starts with https://), or connect Stripe to take cards.' }, 400);
    const em = cl(b.email, 120), ph = cl(b.phone, 30).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (em && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) q.email = em;
    if (/^\d{10}$/.test(ph)) q.phone = ph;
    if (!q.phone && !q.email) return aj({ ok: false, error: 'Add their email or cell so reminders can reach them.' }, 400);
    const tk = token(24);
    const ins = await env.DB.prepare('INSERT INTO app_invoices (client_id, token, number, name, phone, email, amount, due, pay_link, sms_ok, created) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)')
      .bind(c.client_id, tk, q.number || '', q.name, q.phone || '', q.email || '', +q.total, due, pay, b.consent === true && q.phone ? 1 : 0, ts).run();
    const invId = ins.meta.last_row_id;
    await env.DB.prepare("UPDATE biz_quotes SET invoice_id = ?1, status = 'invoiced' WHERE id = ?2").bind(invId, id).run();
    if (+q.job_id) await env.DB.prepare("UPDATE biz_jobs SET invoice_id = ?1, amount = ?2, stage = CASE WHEN stage IN ('paid') THEN stage ELSE 'done' END, updated = ?3 WHERE id = ?4 AND client_id = ?5").bind(invId, +q.total, ts, +q.job_id, c.client_id).run();
    return aj({ ok: true, invoice: invOut(await env.DB.prepare('SELECT * FROM app_invoices WHERE id = ?1').bind(invId).first()) });
  }
  return aj({ ok: false, error: 'Bad request' }, 400);
}
// Public estimate page: /e/<token>. The customer can accept; the owner is told right away.
export async function handleEstimate(req, env, ctx, url) {
  await ensureBiz(env);
  const lang = langOf(req, url);
  const tk = url.pathname.slice(3).replace(/\/+$/, '');
  const q = /^[A-Za-z0-9]{24}$/.test(tk) ? await env.DB.prepare('SELECT q.*, c.business FROM biz_quotes q JOIN app_clients c ON c.client_id = q.client_id WHERE q.token = ?1').bind(tk).first() : null;
  if (!q) return page(404, t(lang, 'notFound'), '<p>' + t(lang, 'quoteGone') + '</p>', lang);
  const b = q.business || '';
  let err = '';
  if (req.method === 'POST' && q.status === 'open') {
    const f = await req.formData();
    const who = cl(f.get('who'), 80);
    if (!who) err = t(lang, 'errAccept');
    else {
      const ts = now();
      await env.DB.prepare("UPDATE biz_quotes SET status = 'accepted', accepted_at = ?1 WHERE id = ?2 AND status = 'open'").bind(ts, q.id).run();
      if (+q.job_id) await env.DB.prepare("UPDATE biz_jobs SET stage = 'booked', updated = ?1 WHERE id = ?2 AND stage IN ('new', 'quoted')").bind(ts, +q.job_id).run();
      await env.DB.prepare('INSERT INTO biz_activity (client_id, at, who, role, what) VALUES (?1,?2,?3,?4,?5)').bind(q.client_id, ts, who, 'customer', 'Accepted estimate #' + (q.number || q.id) + ' (' + money(+q.total) + ')').run();
      ctx.waitUntil(pushClient(env, q.client_id, { aps: { alert: { title: 'Estimate accepted: ' + q.name, body: (q.number ? '#' + q.number + ', ' : '') + money(+q.total) + '. Accepted by ' + who + '.' }, sound: 'default', 'thread-id': 'jobs' }, screen: 'home' }).catch(() => {}));
      return page(200, t(lang, 'accepted'), langBar(url, lang) + '<p>' + esc(t(lang, 'acceptedLine', { n: who.split(' ')[0], b })) + '</p>', lang);
    }
  }
  let items = []; try { items = JSON.parse(q.items || '[]'); } catch (e) {}
  const rows = items.map(x => '<tr><td>' + esc(x.desc) + '</td><td class="n">' + esc(x.qty) + '</td><td class="n">' + money(x.price) + '</td><td class="n">' + money(Math.round(x.qty * x.price)) + '</td></tr>').join('');
  const status = q.status === 'accepted' ? t(lang, 'accepted') : (q.status === 'invoiced' ? t(lang, 'invoiced') : t(lang, 'open'));
  return page(err ? 400 : 200, t(lang, 'quote') + (q.number ? ' #' + q.number : '') + ' ' + t(lang, 'from') + ' ' + b, langBar(url, lang) +
    '<p class="big">' + money(+q.total) + '</p><dl><dt>' + t(lang, 'for') + '</dt><dd>' + esc(q.name) + '</dd><dt>' + t(lang, 'status') + '</dt><dd>' + esc(status) + '</dd></dl>' +
    '<table><thead><tr><th>' + t(lang, 'item') + '</th><th class="n">' + t(lang, 'qty') + '</th><th class="n">' + t(lang, 'price') + '</th><th class="n">' + t(lang, 'amount') + '</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="3">' + t(lang, 'subtotal') + '</td><td class="n">' + money(+q.subtotal) + '</td></tr>' + (+q.tax ? '<tr><td colspan="3">' + t(lang, 'tax') + ' (' + (+q.tax_rate) + '%)</td><td class="n">' + money(+q.tax) + '</td></tr>' : '') +
    '<tr><td colspan="3"><b>' + t(lang, 'total') + '</b></td><td class="n"><b>' + money(+q.total) + '</b></td></tr></tfoot></table>' +
    (q.notes ? '<p><b>' + t(lang, 'notes') + ':</b> ' + esc(q.notes).replace(/\n/g, '<br>') + '</p>' : '') + (err ? '<p class="err">' + esc(err) + '</p>' : '') +
    (q.status === 'open' ? '<form method="post"><label>' + t(lang, 'yourName') + '<input name="who" autocomplete="name" required></label><button>' + t(lang, 'accept') + '</button></form>' : '') +
    '<p class="fine">' + esc(t(lang, 'fineQuote', { b })) + '</p>', lang);
}

// ---------------- Stripe Connect: owners take card payments on their invoices ----------------
async function sx(env, method, path, body, account) {
  const enc = (o, p, out) => { for (const k in o) { const v = o[k], key = p ? p + '[' + k + ']' : k; if (v == null) continue; if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'object' ? enc(x, key + '[' + i + ']', out) : out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(x))); else if (typeof v === 'object') enc(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v)); } return out; };
  const h = { Authorization: 'Bearer ' + env.STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' };
  if (account) h['Stripe-Account'] = account;
  const r = await fetch('https://api.stripe.com/v1/' + path, { method, headers: h, body: body ? enc(body, '', []).join('&') : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Stripe ' + r.status); e.status = r.status; throw e; }
  return j;
}
export async function stripeStatus(env, cid, refresh) {
  if (!env.STRIPE_KEY) return { available: false, connected: false, ready: false };
  try {
    await ensureBiz(env);
    let off = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'connect_off'").first().catch(() => null);
    // "Coming soon" lasts a day, then the next owner who taps Connect checks with Stripe again (so turning on Connect needs no code change).
    if (off && off.v) {
      const at = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'connect_off_at'").first().catch(() => null);
      if (!at || !at.v || Date.now() - Date.parse(at.v) > 24 * 3600e3) { await env.DB.prepare("DELETE FROM billing_config WHERE k IN ('connect_off', 'connect_off_at')").run(); off = null; }
    }
    const row = await env.DB.prepare('SELECT * FROM biz_stripe WHERE client_id = ?1').bind(cid).first();
    if (!row) return { available: !(off && off.v), connected: false, ready: false, note: off && off.v ? off.v : '' };
    if (!+row.ready && refresh && (!row.checked || Date.now() - Date.parse(row.checked) > 2 * 60e3)) {
      const a = await sx(env, 'GET', 'accounts/' + row.account).catch(() => null);
      const ok = a && a.charges_enabled ? 1 : 0;
      await env.DB.prepare('UPDATE biz_stripe SET ready = ?1, checked = ?2 WHERE client_id = ?3').bind(ok, now(), cid).run();
      row.ready = ok;
    }
    return { available: true, connected: true, ready: !!+row.ready };
  } catch (e) { return { available: false, connected: false, ready: false }; }
}
async function connectWebhook(env) {
  const have = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'connect_webhook_secret'").first().catch(() => null);
  if (have) return;
  const w = await sx(env, 'POST', 'webhook_endpoints', { url: SITE + '/stripe/webhook', connect: 'true', enabled_events: ['account.updated', 'checkout.session.completed'], description: 'Always Open client payments' });
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('connect_webhook_id', ?1)").bind(w.id),
    env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('connect_webhook_secret', ?1)").bind(w.secret)
  ]);
}
// App: POST /api/stripe {action:'connect'} -> {ok, url} (Stripe's own onboarding page). The owner finishes there.
export async function apiStripe(req, env, c) {
  if (c.staff) return aj({ ok: false, error: 'Only the owner can connect Stripe.' }, 403);
  if (!env.STRIPE_KEY) return aj({ ok: false, error: 'Card payments are coming soon.' }, 503);
  await ensureBiz(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run();
  let row = await env.DB.prepare('SELECT * FROM biz_stripe WHERE client_id = ?1').bind(c.client_id).first();
  try {
    if (!row) {
      const bill = await env.DB.prepare('SELECT email FROM billing WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
      // The client's own Stripe account, like a Standard account: they get the full Stripe Dashboard, Stripe charges them its fees directly,
      // and Stripe (not Always Open) carries refunds, chargebacks and negative balances.
      const a = await sx(env, 'POST', 'accounts', { controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, stripe_dashboard: { type: 'full' } }, country: 'US', email: bill && bill.email ? bill.email : undefined, business_profile: { name: c.business || undefined, url: undefined }, capabilities: { card_payments: { requested: 'true' }, transfers: { requested: 'true' } }, metadata: { ao_client: c.client_id } });
      await env.DB.prepare("INSERT INTO biz_stripe (client_id, account, ready, checked, created) VALUES (?1,?2,0,'',?3)").bind(c.client_id, a.id, now()).run();
      row = { account: a.id };
      await env.DB.prepare("DELETE FROM billing_config WHERE k IN ('connect_off', 'connect_off_at')").run();
    }
    await connectWebhook(env).catch(() => {});
    const link = await sx(env, 'POST', 'account_links', { account: row.account, refresh_url: SITE + '/stripe/again', return_url: SITE + '/stripe/done', type: 'account_onboarding' });
    return aj({ ok: true, url: link.url });
  } catch (e) {
    const msg = String(e.message || '');
    if (/connect/i.test(msg) && /(sign(ed)? up|enable|platform|not.*(activated|set up))/i.test(msg)) {
      await env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('connect_off', ?1)").bind('Card payments are coming soon.').run();
      await env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('connect_off_at', ?1)").bind(new Date().toISOString()).run();
      return aj({ ok: false, comingSoon: true, error: 'Card payments are coming soon. For now, add your own pay link to each invoice.' }, 503);
    }
    return aj({ ok: false, error: 'Stripe did not answer. Please try again in a minute.' }, 502);
  }
}
// /i/<token>/pay: a Stripe Checkout page on the owner's own Stripe account. Money goes to them, no Always Open fee.
export async function handleInvoicePay(req, env, url) {
  await ensureInvoices(env); await ensureBiz(env);
  const tk = url.pathname.split('/')[2] || '';
  const inv = /^[A-Za-z0-9]{24}$/.test(tk) ? await env.DB.prepare('SELECT i.*, c.business FROM app_invoices i JOIN app_clients c ON c.client_id = i.client_id WHERE i.token = ?1').bind(tk).first() : null;
  if (!inv || inv.status === 'paid' || req.method !== 'POST') return Response.redirect(SITE + '/i/' + tk, 303);
  const st = await env.DB.prepare('SELECT * FROM biz_stripe WHERE client_id = ?1 AND ready = 1').bind(inv.client_id).first();
  if (!st) return Response.redirect(SITE + '/i/' + tk, 303);
  try {
    const s = await sx(env, 'POST', 'checkout/sessions', {
      mode: 'payment', customer_email: inv.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: +inv.amount, product_data: { name: (inv.number ? 'Invoice #' + inv.number : 'Invoice') + ' from ' + (inv.business || '') } } }],
      metadata: { ao_invoice: String(inv.id), ao_client: inv.client_id },
      payment_intent_data: { metadata: { ao_invoice: String(inv.id), ao_client: inv.client_id } },
      success_url: SITE + '/i/' + tk + '?paid=1', cancel_url: SITE + '/i/' + tk
    }, st.account);
    await env.DB.prepare('INSERT OR REPLACE INTO biz_pay (session, client_id, invoice_id, account, created) VALUES (?1,?2,?3,?4,?5)').bind(s.id, inv.client_id, inv.id, st.account, now()).run();
    return Response.redirect(s.url, 303);
  } catch (e) { return Response.redirect(SITE + '/i/' + tk + '?err=1', 303); }
}
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function stripeSigOk(secret, header, body) {
  const parts = String(header || '').split(','), tt = +((parts.find(x => x.trim().startsWith('t=')) || '').trim().slice(2));
  const sigs = parts.filter(x => x.trim().startsWith('v1=')).map(x => x.trim().slice(3));
  if (!tt || !sigs.length || Math.abs(Date.now() / 1000 - tt) > 300) return false;
  const want = await hmacHex(secret, tt + '.' + body);
  return sigs.includes(want);
}
// /stripe/webhook (Connect events), /stripe/done and /stripe/again (where Stripe sends the owner back).
export async function handleStripe(req, env, ctx, url) {
  const p = url.pathname;
  if (p === '/stripe/done') return page(200, 'Back to the app', '<p>Thanks. Stripe is checking your details. Open the Always Open app: when Stripe finishes, your invoices get a Pay by card button.</p>');
  if (p === '/stripe/again') return page(200, 'Link expired', '<p>That Stripe link expired. Open the Always Open app and tap Connect Stripe again.</p>');
  if (p !== '/stripe/webhook' || req.method !== 'POST') return new Response('Not found', { status: 404 });
  await ensureBiz(env);
  const body = await req.text();
  const row = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'connect_webhook_secret'").first().catch(() => null);
  if (!row || !(await stripeSigOk(row.v, req.headers.get('stripe-signature'), body))) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(body), o = (ev.data && ev.data.object) || {};
  if (ev.type === 'account.updated') {
    await env.DB.prepare('UPDATE biz_stripe SET ready = ?1, checked = ?2 WHERE account = ?3').bind(o.charges_enabled ? 1 : 0, now(), o.id).run();
  } else if (ev.type === 'checkout.session.completed' && o.payment_status === 'paid') {
    const pay = await env.DB.prepare('SELECT * FROM biz_pay WHERE session = ?1').bind(o.id).first();
    const invId = pay ? +pay.invoice_id : +((o.metadata || {}).ao_invoice || 0);
    const cid = pay ? pay.client_id : String((o.metadata || {}).ao_client || '');
    const acct = await env.DB.prepare('SELECT client_id FROM biz_stripe WHERE account = ?1').bind(ev.account || '').first();
    if (invId && cid && acct && acct.client_id === cid) {
      await markInvoicePaid(env, cid, invId);
      await env.DB.prepare('UPDATE biz_pay SET paid = 1 WHERE session = ?1').bind(o.id).run();
      const inv = await env.DB.prepare('SELECT name, amount, number FROM app_invoices WHERE id = ?1').bind(invId).first();
      await env.DB.prepare('INSERT INTO biz_activity (client_id, at, who, role, what) VALUES (?1,?2,?3,?4,?5)').bind(cid, now(), 'Stripe', 'system', 'Card payment received for invoice ' + (inv && inv.number ? '#' + inv.number : '#' + invId)).run();
      if (inv) ctx.waitUntil(pushClient(env, cid, { aps: { alert: { title: 'Paid: ' + inv.name, body: money(+inv.amount) + ' came in by card' + (inv.number ? ' for invoice #' + inv.number : '') + '.' }, sound: 'default', 'thread-id': 'money' }, screen: 'home' }).catch(() => {}));
    }
  }
  return new Response('ok');
}

// ---------------- shared inbox ----------------
// One list: requests and bookings, Max's calls, Facebook Page messages, texts (once texting is on), and Google reviews.
export async function inbox(env, c) {
  await ensureBiz(env);
  const cid = c.client_id, since = new Date(Date.now() - 30 * 864e5).toISOString(), out = [];
  const q = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).all()).results || []; } catch (e) { return []; } };
  for (const r of await q("SELECT id, at, name, phone, need, status FROM app_leads WHERE client_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT 40", cid, since))
    out.push({ id: 'lead-' + r.id, channel: /^Booked /.test(r.need || '') ? 'booking' : 'request', at: r.at, name: r.name || '', text: r.need || '', phone: r.phone || '', open: r.status === 'new', canReply: false });
  for (const r of await q("SELECT id, at, caller_name, caller, callback, summary, reason, status FROM app_calls WHERE client_id = ?1 AND at > ?2 AND test = 0 AND outcome NOT IN ('live', 'spam') ORDER BY at DESC LIMIT 40", cid, since))
    out.push({ id: 'call-' + r.id, channel: 'call', at: r.at, name: r.caller_name || '', text: r.summary || r.reason || 'Phone call', phone: r.callback || r.caller || '', open: r.status !== 'handled', canReply: false });
  const msgs = await q("SELECT * FROM biz_msgs WHERE client_id = ?1 AND at > ?2 ORDER BY at DESC LIMIT 80", cid, since);
  const threads = {};
  for (const m of msgs) { const k = m.channel + ':' + m.thread; (threads[k] = threads[k] || []).push(m); }
  for (const k in threads) {
    const list = threads[k], last = list[0], lastIn = list.find(x => x.dir === 'in');
    if (last.channel === 'text' && !TEXTING_ON) continue;
    out.push({ id: 'msg-' + last.channel + '-' + last.thread, channel: last.channel === 'facebook' ? 'facebook' : 'text', at: last.at, name: (lastIn && lastIn.name) || last.name || '', text: last.text || '', open: last.dir === 'in' && last.status === 'new',
      canReply: last.channel === 'text' ? TEXTING_ON : (last.channel === 'facebook' && !!lastIn && Date.now() - Date.parse(lastIn.at) < 24 * 3600e3), thread: list.slice(0, 12).reverse().map(x => ({ dir: x.dir, text: x.text, at: x.at, by: x.by || '' })) });
  }
  for (const r of await q("SELECT id, title, context, stars, status, created FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post', 'invoice', 'reviewreq') AND created > ?2 ORDER BY created DESC LIMIT 30", cid, since))
    out.push({ id: 'rev-' + r.id, channel: 'google', at: r.created, name: r.title || '', text: (r.stars ? r.stars + '★ ' : '') + (r.context || ''), open: r.status === 'pending', canReply: false });
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out.slice(0, 100);
}
// App: POST /api/inbox {action:'reply', id:'msg-facebook-<psid>', text} — sent only when someone on the team taps Send.
export async function apiInbox(req, env, c) {
  await ensureBiz(env);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const m = /^msg-facebook-(\d{3,40})$/.exec(String(b.id || ''));
  if (b.action === 'read') {
    const k = /^msg-(facebook|text)-(.+)$/.exec(String(b.id || ''));
    if (k) await env.DB.prepare("UPDATE biz_msgs SET status = 'read' WHERE client_id = ?1 AND channel = ?2 AND thread = ?3").bind(c.client_id, k[1], k[2]).run();
    return aj({ ok: true });
  }
  const tm = /^msg-text-(\d{10})$/.exec(String(b.id || ''));
  if (b.action === 'reply' && tm) {
    const text = cl(b.text, 1000);
    if (!text) return aj({ ok: false, error: 'Type a reply first.' }, 400);
    const r = await replyText(env, c, tm[1], text);
    if (!r.ok) return aj(r, 409);
    await logAct(env, c, 'Replied to a text');
    return aj({ ok: true });
  }
  if (b.action !== 'reply' || !m) return aj({ ok: false, error: 'Bad request' }, 400);
  const text = cl(b.text, 1000);
  if (!text) return aj({ ok: false, error: 'Type a reply first.' }, 400);
  const pg = await env.DB.prepare('SELECT page_id, page_token FROM meta_pages WHERE client_id = ?1').bind(c.client_id).first().catch(() => null);
  if (!pg) return aj({ ok: false, error: 'Connect Facebook first.' }, 409);
  const lastIn = await env.DB.prepare("SELECT at FROM biz_msgs WHERE client_id = ?1 AND channel = 'facebook' AND thread = ?2 AND dir = 'in' ORDER BY at DESC LIMIT 1").bind(c.client_id, m[1]).first();
  if (!lastIn || Date.now() - Date.parse(lastIn.at) > 24 * 3600e3) return aj({ ok: false, error: 'Facebook only allows replies within 24 hours of their last message. Call them or reply from Facebook.' }, 409);
  const r = await fetch(GRAPH + '/' + pg.page_id + '/messages?access_token=' + encodeURIComponent(pg.page_token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipient: { id: m[1] }, messaging_type: 'RESPONSE', message: { text } }) });
  const j = await r.json().catch(() => ({}));
  if (!j.message_id) return aj({ ok: false, error: 'Facebook did not take the reply. Try again, or reply from Facebook.' }, 502);
  await env.DB.prepare("INSERT OR IGNORE INTO biz_msgs (client_id, channel, thread, name, text, dir, at, by, status, ext_id) VALUES (?1,'facebook',?2,'',?3,'out',?4,?5,'read',?6)").bind(c.client_id, m[1], text, now(), c.staff || 'Owner', j.message_id).run();
  await env.DB.prepare("UPDATE biz_msgs SET status = 'read' WHERE client_id = ?1 AND channel = 'facebook' AND thread = ?2").bind(c.client_id, m[1]).run();
  return aj({ ok: true });
}
// Meta webhook for Page messages: GET verifies the subscription, POST is signed with the app secret.
export async function metaWebhook(req, env, ctx, url) {
  if (!env.META_APP_SECRET) return new Response('Not found', { status: 404 });
  if (req.method === 'GET') {
    const want = env.META_VERIFY_TOKEN || 'alwaysopen-inbox';
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === want) return new Response(url.searchParams.get('hub.challenge') || '', { headers: { 'content-type': 'text/plain' } });
    return new Response('Forbidden', { status: 403 });
  }
  const body = await req.text();
  const sig = String(req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
  if (!sig || sig !== await hmacHex(env.META_APP_SECRET, body)) return new Response('bad signature', { status: 400 });
  await ensureBiz(env);
  let ev = {}; try { ev = JSON.parse(body); } catch (e) {}
  for (const en of (ev.entry || [])) {
    const pg = await env.DB.prepare('SELECT client_id, page_token FROM meta_pages WHERE page_id = ?1').bind(String(en.id || '')).first().catch(() => null);
    if (!pg) continue;
    for (const m of (en.messaging || [])) {
      if (!m.message || m.message.is_echo || !m.sender) continue;
      const psid = String(m.sender.id), text = cl(m.message.text || (m.message.attachments ? '[photo or file]' : ''), 2000);
      let name = '';
      try { const u = await (await fetch(GRAPH + '/' + psid + '?fields=name&access_token=' + encodeURIComponent(pg.page_token))).json(); name = cl(u.name, 80); } catch (e) {}
      // A message to Always Open's own Page goes to Christopher's phone; answer it in Facebook.
      if (pg.client_id === 'always-open') { ctx.waitUntil((async () => (await import('./app.js')).opsPing(env, 'Facebook message to Always Open' + (name ? ' from ' + name : ''), text.slice(0, 300), 'high', 'speech_balloon', 'https://www.facebook.com/messages/'))().catch(() => {})); continue; }
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO biz_msgs (client_id, channel, thread, name, text, dir, at, status, ext_id) VALUES (?1,'facebook',?2,?3,?4,'in',?5,'new',?6)")
        .bind(pg.client_id, psid, name, text, new Date(+m.timestamp || Date.now()).toISOString(), String(m.message.mid || token(16))).run();
      if (ins.meta && ins.meta.changes) ctx.waitUntil(pushClient(env, pg.client_id, { aps: { alert: { title: 'Facebook message' + (name ? ' from ' + name : ''), body: text.slice(0, 200) }, sound: 'default', 'thread-id': 'inbox' }, screen: 'home' }).catch(() => {}));
    }
  }
  return new Response('ok');
}

// ---------------- review insights ----------------
async function askClaude(env, system, user, max) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE } : {}),
    body: JSON.stringify({ model: env.INSIGHT_MODEL || 'claude-haiku-5-5', max_tokens: max || 600, system, messages: [{ role: 'user', content: user }] })
  });
  const j = await r.json().catch(() => ({}));
  return (j.content || []).map(x => x.text || '').join('');
}
// Once a day per client: what this month's reviews praise and complain about. Cached by month.
export async function buildInsights(env, cid, month, force) {
  await ensureBiz(env);
  month = month || new Date().toISOString().slice(0, 7);
  const start = month + '-01T00:00:00.000Z', end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString();
  const revs = ((await env.DB.prepare("SELECT stars, context FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post', 'invoice', 'reviewreq') AND created >= ?2 AND created < ?3 AND context != '' LIMIT 80").bind(cid, start, end).all()).results) || [];
  const have = await env.DB.prepare('SELECT * FROM biz_insights WHERE client_id = ?1 AND month = ?2').bind(cid, month).first();
  if (!force && have && (+have.reviews === revs.length || Date.now() - Date.parse(have.at) < 20 * 3600e3)) return have;
  if (revs.length < 2) return have || null;
  const sys = 'You summarize customer reviews for a small business owner. Return only JSON: {"praise":[{"theme":"...","count":n}],"complaints":[{"theme":"...","count":n}],"summary":"one or two plain sentences"}. ' +
    'Themes are short (2 to 6 words), from what customers actually wrote, most common first, at most 4 each. Count how many reviews mention each. If there are no complaints, use an empty list. ' +
    'Describe only what reviews say. Do not give legal, medical, financial or insurance advice, and do not name or quote individual customers.';
  const text = await askClaude(env, sys, 'This month\'s reviews:\n' + revs.map((r, i) => (i + 1) + '. ' + (r.stars ? r.stars + ' stars: ' : '') + String(r.context).slice(0, 600)).join('\n'), 700).catch(() => '');
  let data = null; try { data = JSON.parse(String(text).replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch (e) { data = null; }
  if (!data || !Array.isArray(data.praise)) return have || null;
  const clean = l => (Array.isArray(l) ? l : []).slice(0, 4).map(x => ({ theme: cl(x && x.theme, 60), count: Math.max(1, Math.min(999, +(x && x.count) || 1)) })).filter(x => x.theme);
  const out = JSON.stringify({ praise: clean(data.praise), complaints: clean(data.complaints), summary: cl(data.summary, 300) });
  await env.DB.prepare('INSERT OR REPLACE INTO biz_insights (client_id, month, data, reviews, at) VALUES (?1,?2,?3,?4,?5)').bind(cid, month, out, revs.length, now()).run();
  return { data: out, reviews: revs.length, at: now(), month };
}
function insightsOut(r) {
  if (!r) return null;
  let d = {}; try { d = JSON.parse(r.data || '{}'); } catch (e) {}
  return { month: r.month || '', reviews: +r.reviews || 0, praise: d.praise || [], complaints: d.complaints || [], summary: d.summary || '', at: r.at || '' };
}

// ---------------- onboarding ----------------
async function prefs(env, cid) {
  const r = await env.DB.prepare('SELECT * FROM biz_prefs WHERE client_id = ?1').bind(cid).first();
  let ob = {}; try { ob = JSON.parse((r && r.onboard) || '{}'); } catch (e) {}
  return { weeklyOff: !!(r && +r.weekly_off), weeklySent: (r && r.weekly_sent) || '', onboard: ob };
}
export async function apiPrefs(req, env, c) {
  if (c.staff) return aj({ ok: false, error: 'Only the owner can change this.' }, 403);
  await ensureBiz(env);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const p = await prefs(env, c.client_id);
  if (typeof b.weekly === 'boolean') p.weeklyOff = !b.weekly;
  if (b.onboard === 'shared') p.onboard.shared = now();
  if (b.onboard === 'dismiss') p.onboard.dismissed = now();
  await env.DB.prepare('INSERT INTO biz_prefs (client_id, weekly_off, weekly_sent, onboard) VALUES (?1,?2,?3,?4) ON CONFLICT(client_id) DO UPDATE SET weekly_off = excluded.weekly_off, onboard = excluded.onboard')
    .bind(c.client_id, p.weeklyOff ? 1 : 0, p.weeklySent, JSON.stringify(p.onboard)).run();
  return aj({ ok: true, weekly: !p.weeklyOff });
}
function onboarding(p, s) {
  // "Your first hour": the things that pay off right away come first.
  const steps = [];
  const v = k => !!(p.onboard && p.onboard[k]);
  steps.push({ key: 'share', label: 'Share your request link', done: v('shared'), hint: 'Customers can ask for a quote or book without calling. Put it on your site, your Google profile and your texts.' });
  if (s.qr) steps.push({ key: 'qr', label: 'Print your review QR card', done: v('qr'), hint: 'One page for the counter, the truck or the invoice.', help: '/help/qr' });
  steps.push({ key: 'hours', label: 'Add your hours', done: !!s.hours, hint: 'So Max and your Google profile tell customers the right thing.' });
  if (s.line && !s.regulated) steps.push({ key: 'teach', label: 'Teach Max about your business', done: !!s.taught, hint: 'What you do, where, prices you share and what counts as urgent. Max can call you and ask, or you can type it in. About three minutes.' });
  if (s.line) steps.push({ key: 'forward', label: 'Forward your missed calls to Max', done: v('forward'), hint: 'Your phone still rings first. Steps for Verizon, AT&T, T-Mobile and landlines.', help: '/help/forwarding' });
  if (s.line) steps.push({ key: 'max', label: 'Test Max by calling your line', done: !!s.called, hint: 'Call it and see what he says.' });
  if (s.texting && !s.texting.regulated) steps.push({ key: 'texting', label: 'Register texting under your business name', done: v('texting') || ['submitted', 'in_review', 'approved', 'needs_help'].includes(s.texting.status), hint: 'Carriers require it before we text your customers. One form; approval usually takes a few days.', help: '/texting' });
  steps.push({ key: 'calendar', label: 'Connect Google Calendar', done: !!s.calendar, hint: 'Lets Max book real open times.' });
  if (s.metaAvailable) steps.push({ key: 'facebook', label: 'Connect Facebook', done: !!s.meta });
  if (s.stripeAvailable) steps.push({ key: 'stripe', label: 'Connect Stripe for card payments', done: !!s.stripe });
  if (s.map) steps.push({ key: 'map', label: 'Check your Always Open map listing', done: v('map'), hint: s.map.regulated ? 'Off unless you turn it on. If you do, it shows your name, type and town, plus a business number or address only if you add one.' : 'You are on the public Always Open map by default: your name, type and town. Add a business number or address, or turn it off, in Settings.' });
  steps.push({ key: 'google', label: 'Invite us to your Google profile (optional)', done: v('google'), hint: 'Everything above works without it. Once you invite us, we answer reviews and keep your profile current.', help: '/help/google' });
  const left = steps.filter(x => !x.done).length;
  return { steps, left, show: left > 0 && !p.onboard.dismissed };
}

// ---------------- what the app's state gets from here ----------------
export async function bizState(env, c, base) {
  const cid = c.client_id, money = c.role !== 'tech', owner = !c.staff;
  try { await ensureBiz(env); } catch (e) { return {}; }
  await syncJobs(env, cid).catch(() => {});
  const jobs = ((await env.DB.prepare("SELECT * FROM biz_jobs WHERE client_id = ?1 AND source != 'import' AND (stage != 'paid' OR updated > ?2) ORDER BY CASE stage WHEN 'new' THEN 0 WHEN 'quoted' THEN 1 WHEN 'booked' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, updated DESC LIMIT 80").bind(cid, new Date(Date.now() - 30 * 864e5).toISOString()).all()).results) || [];
  const ms = monthStart();
  const tot = await env.DB.prepare("SELECT SUM(CASE WHEN stage = 'paid' AND updated >= ?2 THEN amount ELSE 0 END) AS paid, SUM(CASE WHEN stage IN ('booked', 'done') THEN amount ELSE 0 END) AS booked, COUNT(*) AS n FROM biz_jobs WHERE client_id = ?1 AND source != 'import'").bind(cid, ms).first();
  const quotes = money ? (((await env.DB.prepare("SELECT * FROM biz_quotes WHERE client_id = ?1 AND (status = 'open' OR created > ?2) ORDER BY created DESC LIMIT 40").bind(cid, new Date(Date.now() - 45 * 864e5).toISOString()).all()).results) || []).map(quoteOut) : [];
  const p = await prefs(env, cid);
  const st = await stripeStatus(env, cid, true);
  const ins = insightsOut(await env.DB.prepare('SELECT * FROM biz_insights WHERE client_id = ?1 ORDER BY month DESC LIMIT 1').bind(cid).first());
  const act = owner ? (((await env.DB.prepare('SELECT at, who, role, what FROM biz_activity WHERE client_id = ?1 ORDER BY id DESC LIMIT 60').bind(cid).all()).results) || []) : [];
  return {
    role: c.role || 'owner',
    jobs: jobs.map(r => jobOut(r, money)),
    jobTotals: money ? { paidMonth: (+(tot && tot.paid) || 0) / 100, booked: (+(tot && tot.booked) || 0) / 100, count: +(tot && tot.n) || 0 } : null,
    quotes,
    stripe: owner ? st : null,
    insights: ins,
    team: owner ? await team(env, c) : [],
    activity: act,
    weekly: owner ? !p.weeklyOff : null,
    prefs: p
  };
}
export function finishOnboarding(state, p) {
  try {
    const L = state.line;
    const ob = onboarding(p || { onboard: {} }, {
      hours: !!(L && L.hours) || (state.messages || []).some(m => /^Hours change:/.test(m.text || '')),
      qr: !!(state.client && state.client.qr), calendar: !!(state.calendar && state.calendar.connected), meta: !!(state.meta && state.meta.connected), metaAvailable: !!(state.meta && state.meta.available),
      taught: !!(L && L.knows), regulated: !!(state.client && state.client.regulated), stripe: !!(state.stripe && state.stripe.ready), stripeAvailable: !!(state.stripe && state.stripe.available), line: !!L, called: !!state.__called, map: state.map || null, texting: state.texting || null
    });
    return ob;
  } catch (e) { return null; }
}
export async function inboxApi(env, c) { return aj({ ok: true, inbox: await inbox(env, c) }); }
export async function insightsApi(req, env, c) {
  let b = {}; try { b = await req.json(); } catch (e) {}
  const r = await buildInsights(env, c.client_id, '', !!b.refresh);
  return aj({ ok: true, insights: insightsOut(r ? Object.assign({ month: new Date().toISOString().slice(0, 7) }, r) : null) });
}

// ---------------- cron: insights once a day, weekly summary on Monday morning ----------------
function localParts(tz, at) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
    const o = {}; for (const x of f.formatToParts(new Date(at))) o[x.type] = x.value;
    return { wd: o.weekday, hour: +o.hour % 24, day: o.year + '-' + o.month + '-' + o.day };
  } catch (e) { return localParts('America/New_York', at); }
}
export async function weeklyNumbers(env, cid, at) {
  const since = new Date(at - 7 * 864e5).toISOString();
  const one = async (sql, ...p) => { try { const r = await env.DB.prepare(sql).bind(...p).first(); return r || {}; } catch (e) { return {}; } };
  const calls = await one("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND at > ?2 AND test = 0 AND outcome NOT IN ('live', 'spam')", cid, since);
  const books = await one("SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at > ?2 AND need LIKE 'Booked %'", cid, since);
  const reqs = await one("SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1 AND at > ?2 AND need NOT LIKE 'Booked %'", cid, since);
  const revs = await one("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND kind NOT IN ('post', 'invoice', 'reviewreq') AND created > ?2", cid, since);
  const unpaid = await one("SELECT SUM(amount) AS s FROM app_invoices WHERE client_id = ?1 AND status = 'open'", cid);
  const paid = await one("SELECT SUM(amount) AS s FROM app_invoices WHERE client_id = ?1 AND status = 'paid' AND paid_at > ?2", cid, since);
  let lost = null; try { lost = await lostSince(env, cid, since); } catch (e) {}
  const hg = await one('SELECT COUNT(*) AS n FROM handoffs WHERE from_id = ?1 AND at > ?2', cid, since), ht = await one('SELECT COUNT(*) AS n FROM handoffs WHERE to_id = ?1 AND at > ?2', cid, since);
  return { calls: +calls.n || 0, bookings: +books.n || 0, requests: +reqs.n || 0, reviews: +revs.n || 0, unpaid: +unpaid.s || 0, paid: +paid.s || 0, lost, handoffs: { given: +hg.n || 0, taken: +ht.n || 0 } };
}
export function weeklyLine(n) {
  const pl = (x, a, b) => x + ' ' + (x === 1 ? a : b);
  const parts = [pl(n.calls, 'call', 'calls'), pl(n.bookings, 'booking', 'bookings'), pl(n.requests, 'request', 'requests'), pl(n.reviews, 'review', 'reviews')];
  const rv = n.revive && n.revive.count ? ' ' + n.revive.count + ' past ' + (n.revive.count === 1 ? 'customer looks' : 'customers look') + ' ready to hear from you' + (n.revive.value ? ' (about ' + money(n.revive.value) + ')' : '') + '.' : '';
  const lost = n.lost && n.lost.total ? ' ' + n.lost.total + (n.lost.total === 1 ? ' caller did not book' : ' callers did not book') + ': ' + ['price','timing','distance','notus','other'].filter(r => n.lost[r]).sort((x, y) => n.lost[y] - n.lost[x]).map(r => n.lost[r] + ' ' + LOST_LABELS[r]).join(', ') + '.' : '';
  const ho = n.handoffs && (n.handoffs.given || n.handoffs.taken) ? ' Hand-offs: ' + (n.handoffs.taken ? n.handoffs.taken + ' caller' + (n.handoffs.taken === 1 ? '' : 's') + ' sent to you by nearby businesses' : '') + (n.handoffs.taken && n.handoffs.given ? ', ' : '') + (n.handoffs.given ? n.handoffs.given + ' sent on to a neighbor' : '') + '.' : '';
  return 'Last week: ' + parts.join(', ') + '. ' + (n.paid ? money(n.paid) + ' came in. ' : '') + (n.unpaid ? money(n.unpaid) + ' waiting.' : 'Nothing waiting to be paid.') + rv + lost + ho + (n.rivals ? ' ' + n.rivals : '');
}
export async function bizCron(env, at) {
  at = at || Date.now();
  try { await ensureBiz(env); } catch (e) { return { weekly: 0, insights: 0 }; }
  const clients = ((await env.DB.prepare('SELECT c.client_id, c.business, c.owner_first, b.email FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id WHERE c.active = 1 AND c.client_id != \'demo-plumbing\' LIMIT 500').all().catch(async () => env.DB.prepare('SELECT client_id, business, owner_first, NULL AS email FROM app_clients WHERE active = 1 AND client_id != \'demo-plumbing\' LIMIT 500').all())).results) || [];
  let weekly = 0, insights = 0;
  for (const c of clients) {
    let tz = 'America/New_York';
    try { const g = await env.DB.prepare('SELECT tz FROM gcal_tokens WHERE client_id = ?1').bind(c.client_id).first(); if (g && g.tz) tz = g.tz; } catch (e) {}
    const lp = localParts(tz, at);
    if (lp.wd === 'Mon' && lp.hour === 8) {
      const p = await prefs(env, c.client_id);
      if (!p.weeklyOff && p.weeklySent !== lp.day) {
        await env.DB.prepare("INSERT INTO biz_prefs (client_id, weekly_sent) VALUES (?1, ?2) ON CONFLICT(client_id) DO UPDATE SET weekly_sent = excluded.weekly_sent").bind(c.client_id, lp.day).run();
        const wn = await weeklyNumbers(env, c.client_id, at);
        try { wn.revive = await buildRevive(env, c.client_id, at); } catch (e) { /* the weekly note still goes */ }
        try { const ac = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(c.client_id).first(); wn.rivals = await rivalLine(env, ac, at); } catch (e) { /* so does this */ }
        const line = weeklyLine(wn);
        await pushClient(env, c.client_id, { aps: { alert: { title: 'Your week at ' + (c.business || 'your business'), body: line }, sound: 'default', 'thread-id': 'weekly' }, screen: 'home' }).catch(() => {});
        if (c.email) await mailTo(env, c.email, 'Your week at ' + (c.business || 'your business'), (c.owner_first ? 'Hi ' + c.owner_first + ',\n\n' : '') + line + '\n\nOpen the Always Open app for the details.\n\nYou can turn this weekly note off in the app under Settings.', 'Always Open').catch(() => {});
        // A text version goes out only once texting is approved and switched on.
        weekly++;
      }
    }
    if (lp.hour === 6 && new Date(at).getUTCMinutes() < 10) { const r = await buildInsights(env, c.client_id).catch(() => null); if (r) insights++; }
  }
  return { weekly, insights };
}

// Opening a help page ticks its step.
export async function markOnboard(env, cid, key) {
  try {
    await ensureBiz(env);
    const p = await prefs(env, cid);
    if (p.onboard[key]) return;
    p.onboard[key] = now();
    await env.DB.prepare('INSERT INTO biz_prefs (client_id, weekly_off, weekly_sent, onboard) VALUES (?1,?2,?3,?4) ON CONFLICT(client_id) DO UPDATE SET onboard = excluded.onboard')
      .bind(cid, p.weeklyOff ? 1 : 0, p.weeklySent, JSON.stringify(p.onboard)).run();
  } catch (e) { /* the page still shows */ }
}
