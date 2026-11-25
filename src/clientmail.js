// Neon emails to business owners (Always Open's own clients), and the pure builders for each one.
// Sending: Cloudflare's send binding when bound (any address, HTML plus text), else the routing binding (verified
// addresses only), else 'off'. Emails a client's own customers receive (invoices, review requests from the business)
// do NOT come through here: those stay branded as that business (app.js mailTo).
import { neonEmail, rawEmail } from './neonmail.js';

const FROM = 'reminders@alwaysopenoffice.com';
const REPLY = 'hello@alwaysopenoffice.com';
const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
export const money0 = n => '$' + Math.round(+n || 0).toLocaleString('en-US');
const pl = (x, a, b) => x + ' ' + (x === 1 ? a : b);

// A small record of real sends to people other than the operator, one row per stream ('leads': prospect mail from
// leadmail.js; 'clients': sendNeon) in checks_meta: when one last went out, and when and why one last failed. Nothing
// else watches the path all of this mail depends on (the health check only sees the operator-only binding), so a health
// check can read it with mailSendState(env) (Nov 24, 2026).
let metaReady = new WeakSet();
export async function noteMailSend(env, stream, to, result) {
  try {
    if (!env || !env.DB || !/^(sent|failed)/.test(String(result))) return;
    if (env.MAIL_TO && one(to).toLowerCase() === one(env.MAIL_TO).toLowerCase()) return;   // the operator's own mail proves nothing
    if (!metaReady.has(env.DB)) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS checks_meta (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run(); metaReady.add(env.DB); }
    const k = 'mailsend:' + stream, now = new Date().toISOString();
    let v = {}; try { const r = await env.DB.prepare('SELECT v FROM checks_meta WHERE k = ?1').bind(k).first(); v = JSON.parse((r && r.v) || '{}') || {}; } catch (e) { v = {}; }
    if (result === 'sent') v.okAt = now; else { v.errAt = now; v.err = one(result).replace(/^failed:\s*/, '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').slice(0, 160); }
    await env.DB.prepare('INSERT OR REPLACE INTO checks_meta (k, at, v) VALUES (?1, ?2, ?3)').bind(k, now, JSON.stringify(v)).run();
  } catch (e) { /* a record that cannot be written never stops the mail */ }
}
// { leads: { okAt, errAt, err }, clients: { okAt, errAt, err } }: ISO times, '' when never.
export async function mailSendState(env) {
  const out = {};
  for (const stream of ['leads', 'clients']) {
    let v = {}; try { const r = await env.DB.prepare('SELECT v FROM checks_meta WHERE k = ?1').bind('mailsend:' + stream).first(); v = JSON.parse((r && r.v) || '{}') || {}; } catch (e) { v = {}; }
    out[stream] = { okAt: v.okAt || '', errAt: v.errAt || '', err: v.err || '' };
  }
  return out;
}

// m: { subject, html, text }. Returns 'sent', 'off' or 'failed: ...'. opts.who: the client's code, for the alert.
// A failure is never silent (Nov 24, 2026: a failed month report or Monday note was swallowed): Christopher is told
// through opsAlert('mail-send'), which says it once per client per 3 hours.
export async function sendNeon(env, to, m, opts) {
  const r = await sendNeonRaw(env, to, m, opts || {});
  if (r !== 'failed: bad address') await noteMailSend(env, 'clients', to, r);
  if (/^failed/.test(r)) { try { await (await import('./ops.js')).opsAlert(env, 'mail-send', one((opts && opts.who) || ''), 'An email to a client could not be sent: ' + r.replace(/^failed:\s*/, '')); } catch (e) { /* the result is still returned */ } }
  return r;
}
async function sendNeonRaw(env, to, m, opts) {
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(String(to || ''))) return 'failed: bad address';
  const subject = one(m.subject).slice(0, 140);
  let why = '';
  if (env.SEND_MAIL) {
    const msg = { to, from: { email: FROM, name: one(opts.fromName || 'Always Open').replace(/"/g, '').slice(0, 60) }, replyTo: opts.replyTo || REPLY, subject, html: m.html, text: m.text };
    try { await env.SEND_MAIL.send(msg); return 'sent'; } catch (e) {
      why = one((e && e.message) || e).slice(0, 120);
      try { const t = Object.assign({}, msg); delete t.replyTo; await env.SEND_MAIL.send(t); return 'sent'; } catch (e2) { why = one((e2 && e2.message) || e2).slice(0, 120) || why; }
    }
  }
  if (!env.EMAIL || !env.MAIL_FROM) return why ? 'failed: ' + why : 'off';
  try {
    const { EmailMessage } = await import('cloudflare:email');
    const raw = rawEmail({ fromName: opts.fromName || 'Always Open', from: env.MAIL_FROM, to, subject, replyTo: opts.replyTo || REPLY }, m.text, m.html);
    await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, to, raw));
    return 'sent';
  } catch (e) { return 'failed: ' + (why || one((e && e.message) || e).slice(0, 120)); }
}

// ---------- the weekly note (Monday) ----------
// n: weeklyNumbers() plus optional revive and rivals. c: { business, owner_first }.
export function weeklyEmail(c, n, lostLabels) {
  const biz = one(c.business) || 'your business';
  const calls = +n.calls || 0, books = +n.bookings || 0, reqs = +n.requests || 0, revs = +n.reviews || 0;
  const doThis = [];
  if (n.unpaid) doThis.push(money0(n.unpaid) + ' in invoices is still open. Open the app and send the reminders.');
  if (n.revive && n.revive.count) doThis.push(pl(n.revive.count, 'past customer looks', 'past customers look') + ' ready to hear from you' + (n.revive.value ? ' (about ' + money0(n.revive.value) + ')' : '') + '. Open the app and approve the texts.');
  const lines = [];
  if (n.paid) lines.push({ k: 'Paid', v: money0(n.paid) + ' came in', ok: true });
  if (!n.unpaid) lines.push({ k: 'Invoices', v: 'Nothing waiting to be paid', ok: true });
  if (n.lost && n.lost.total) {
    const L = lostLabels || {};
    const why = ['price', 'timing', 'distance', 'notus', 'other'].filter(r => n.lost[r]).sort((x, y) => n.lost[y] - n.lost[x]).map(r => n.lost[r] + ' ' + (L[r] || r)).join(', ');
    lines.push({ k: 'Didn’t book', v: pl(n.lost.total, 'caller', 'callers') + (why ? ': ' + why : ''), bad: true });
  }
  if (n.handoffs && n.handoffs.taken) lines.push({ k: 'Hand-offs', v: pl(n.handoffs.taken, 'caller', 'callers') + ' sent to you by nearby businesses', ok: true });
  if (n.handoffs && n.handoffs.given) lines.push({ k: 'Hand-offs', v: n.handoffs.given + ' sent on to a neighbor' });
  if (n.rivals) lines.push({ k: 'Competitors', v: one(n.rivals).slice(0, 180) });
  const busy = calls + books + reqs + revs;
  return Object.assign({ subject: 'Your week' + (one(c.business) ? ' at ' + biz : '') + ': ' + pl(calls, 'call', 'calls') + ', ' + pl(books, 'booking', 'bookings') }, neonEmail({
    tone: doThis.length ? 'bad' : 'ok', sign: doThis.length ? (doThis.length === 1 ? '1 THING' : doThis.length + ' THINGS') : (busy ? 'GOOD WEEK' : 'QUIET WEEK'),
    title: (c.owner_first ? one(c.owner_first) + ', here' : 'Here') + '’s last week at ' + biz + '.', who: biz,
    preheader: pl(calls, 'call', 'calls') + ', ' + pl(books, 'booking', 'bookings') + ' last week.',
    doThis, stats: [{ n: String(calls), label: calls === 1 ? 'call' : 'calls' }, { n: String(books), label: books === 1 ? 'booking' : 'bookings' }, { n: String(reqs), label: reqs === 1 ? 'request' : 'requests' }, { n: String(revs), label: revs === 1 ? 'review' : 'reviews' }],
    linesTitle: lines.length ? 'The rest' : '', lines: lines.slice(0, 5),
    note: 'Open the Always Open app for the details. You can turn this weekly note off in the app under Settings.'
  }));
}

// ---------- the monthly report is ready ----------
// data: buildMonth()'s answer (stats, note, label). Only the counts the report already shows.
export function reportEmail(c, label, data) {
  // With no month or business on file the words stay natural: "Your last month report is ready", not "Your Last month report is ready: your business" (Nov 24, 2026).
  const biz = one(c.business) || 'your business', month = one(label).split(' ')[0], mon = month || 'last month';
  const s = (data && data.stats) || {};
  const stats = [];
  const add = (v, a, b) => { if (v != null && v !== '' && +v >= 0) stats.push({ n: String(v), label: +v === 1 ? a : b }); };
  add(s.calls, 'call answered', 'calls answered');
  if (s.afterHours != null) add(s.afterHours, 'after hours', 'after hours');
  add(s.reviews, 'review', 'reviews');
  if (s.caught) stats.push({ n: money0(s.caught), label: 'Max caught' });
  else add(s.posts != null ? s.posts : s.replies, 'post', 'posts');
  const note = one(data && data.note).split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
  // Dollars in the subject when Max caught any after hours and the owner's average job is set (money.js subjectLine)
  const caught = s.caught && s.afterHours ? (+s.afterHours === 1 ? '1 after-hours call' : s.afterHours + ' after-hours calls') + ' caught, about ' + money0(s.caught) + ' of work' : '';
  return Object.assign({ subject: caught ? 'Your ' + mon + ' report: ' + caught : 'Your ' + mon + ' report is ready' + (one(c.business) ? ': ' + biz : '') }, neonEmail({
    tone: 'info', sign: mon.toUpperCase().slice(0, 12) + ' REPORT', title: 'One page: what Always Open did for ' + biz + ' in ' + mon + '.', who: biz,
    preheader: note, stats: stats.slice(0, 4), note: (note && note.length > 2 ? note + ' ' : '') + 'Open the Always Open app to see the page and save it as a PDF.'
  }));
}

// ---------- review ask for Always Open itself ----------
export function askEmail(c, words, link, second) {
  return Object.assign({ subject: second ? 'A few months with Always Open' : 'A month with Always Open' }, neonEmail({
    tone: 'info', sign: second ? 'A FEW MONTHS IN' : 'ONE MONTH IN', title: 'Hi ' + (one(c.first) || 'there') + ', it’s the Always Open team.',
    lines: words ? [{ v: words.charAt(0).toUpperCase() + words.slice(1) + '.', ok: true }] : [],
    doThis: ['Leave an honest Google review of Always Open. Good or bad, it helps other owners decide.'],
    button: /^https:\/\//.test(link || '') ? { text: 'Leave a review', url: link } : null,
    note: 'Questions or anything to change? Just reply to this email. Chris answers.'
  }));
}
