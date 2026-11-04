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

// m: { subject, html, text }. Returns 'sent', 'off' or 'failed: ...'.
export async function sendNeon(env, to, m, opts) {
  opts = opts || {};
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(String(to || ''))) return 'failed: bad address';
  const subject = one(m.subject).slice(0, 140);
  if (env.SEND_MAIL) {
    const msg = { to, from: { email: FROM, name: one(opts.fromName || 'Always Open').replace(/"/g, '').slice(0, 60) }, replyTo: opts.replyTo || REPLY, subject, html: m.html, text: m.text };
    try { await env.SEND_MAIL.send(msg); return 'sent'; } catch (e) {
      try { const t = Object.assign({}, msg); delete t.replyTo; await env.SEND_MAIL.send(t); return 'sent'; } catch (e2) { /* fall through */ }
    }
  }
  if (!env.EMAIL || !env.MAIL_FROM) return 'off';
  try {
    const { EmailMessage } = await import('cloudflare:email');
    const raw = rawEmail({ fromName: opts.fromName || 'Always Open', from: env.MAIL_FROM, to, subject, replyTo: opts.replyTo || REPLY }, m.text, m.html);
    await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, to, raw));
    return 'sent';
  } catch (e) { return 'failed: ' + one((e && e.message) || e).slice(0, 120); }
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
  return Object.assign({ subject: 'Your week at ' + biz + ': ' + pl(calls, 'call', 'calls') + ', ' + pl(books, 'booking', 'bookings') }, neonEmail({
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
  const biz = one(c.business) || 'your business', month = one(label).split(' ')[0] || 'Last month';
  const s = (data && data.stats) || {};
  const stats = [];
  const add = (v, a, b) => { if (v != null && v !== '' && +v >= 0) stats.push({ n: String(v), label: +v === 1 ? a : b }); };
  add(s.calls, 'call answered', 'calls answered');
  if (s.afterHours != null) add(s.afterHours, 'after hours', 'after hours');
  add(s.reviews, 'review', 'reviews');
  if (s.caught) stats.push({ n: money0(s.caught), label: 'Max caught' });
  else add(s.posts != null ? s.posts : s.replies, 'post', 'posts');
  const note = one(data && data.note).split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
  return Object.assign({ subject: 'Your ' + month + ' report is ready: ' + biz }, neonEmail({
    tone: 'info', sign: month.toUpperCase().slice(0, 12) + ' REPORT', title: 'One page: what Always Open did for ' + biz + ' in ' + month + '.', who: biz,
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
    note: 'Questions or anything to change? Just reply to this email. Katie answers.'
  }));
}
