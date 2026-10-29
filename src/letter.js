// The grade letter: one printed page Christopher hands a business owner. Their grade from the one-click audit (audit.js),
// the three things we would fix first in plain words, one paragraph on what Always Open does for a business like theirs,
// the offer, and how to reach us. Built fresh from a live audit every time: Google's terms let us keep only our own score,
// so nothing from Google is stored here. Competitors appear only as an average ("the busiest nearby competitors"),
// never by name with their numbers.
//   GET  /audit/letter?t=<ops board token>&q=&town=&offer=&phone=   one letter, ready to print (works from a phone)
//   POST /audit/letter (x-key) { items: [{q, town}], offer, phone }  up to ten letters as one printable set + text versions
import { industryOf } from './provision.js';

export const DEFAULT_OFFER = 'Founding member: Starter at $149 a month, held for a year, starting the day you say yes.';
export const MAX_LETTERS = 10;
const SITE = 'alwaysopenoffice.com';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// What we do, in the words a business like theirs would use. Regulated fields get the public-pages-only version.
const TRADE = 'We run the back side of your company while you’re on the job. Every review gets a reply drafted for your OK, your Google listing stays current, and every call is answered in your company’s name, day and night, by Max, our phone line, with emergencies rung through to you. Every customer gets a review request after the job, and quotes get a follow-up so they don’t go cold.';
const PITCH = {
  trade: TRADE,
  salon: 'We run the back side of your salon while your hands are busy. Every review gets a reply drafted for your OK, your photos become posts on Google, and calls get answered and booked or taken as a message, with who called texted to you. Every client gets a review request after the visit.',
  restaurant: 'We run the back side of your restaurant through the rush. Every review gets a reply drafted for your OK, your holiday hours go up on Google before every holiday, and your specials get posted. The phone gets answered too: hours, directions, takeout questions and large-party requests, with anything that needs a person texted to you.',
  auto: 'We run the back side of your shop while you’re under a car. Every review gets a reply drafted for your OK, your Google listing stays current, and calls get answered in your shop’s name with the vehicle, the problem and the next open time. Every customer gets a review request after the repair, and estimates get a follow-up.',
  regulated: 'We run the back side of your office, carefully. Every public review gets a reply drafted for your OK and checked by Compliance Guard against your field’s rules, and your Google listing stays current. After hours, Max takes a clear message for the next business day; he never quotes, advises or takes client details beyond a name and number. We work only from public pages, never your client files.',
  events: 'We run the back side of your business while you’re working an event. Every review gets a reply drafted for your OK, your photos become posts, and every inquiry gets answered in your company’s name, with the date, the place and the headcount texted to you while it’s hot. Every customer gets a review request after the event.'
};
export function pitchFor(name, type) {
  const k = industryOf(String(name || '') + ' ' + String(type || ''), '');
  if (/^(insurance|dental|medical|legal)$/.test(k) || /insurance|dentist|doctor|lawyer|attorney|clinic|medical/i.test(type || '')) return { kind: 'regulated', text: PITCH.regulated };
  if (/^(salon|barber|fitness|pet grooming)$/.test(k) || /salon|barber|spa|gym|nail|beauty/i.test(type || '')) return { kind: 'salon', text: PITCH.salon };
  if (k === 'restaurant' || /restaurant|cafe|bakery|bar|diner|pizza/i.test(type || '')) return { kind: 'restaurant', text: PITCH.restaurant };
  if (k === 'auto repair' || /auto|car repair|mechanic|tire/i.test(type || '')) return { kind: 'auto', text: PITCH.auto };
  if (k === 'party rentals' || /event|party|rental/i.test(type || '')) return { kind: 'events', text: PITCH.events };
  return { kind: 'trade', text: PITCH.trade };
}

// The three findings worth a letter: worst first, each as what we saw and what we would do. Pure.
export function topThree(audit) {
  return (audit.findings || []).slice(0, 3).map(f => ({ title: f.title, saw: f.saw, fix: f.fix }));
}
function dateText(at) { return new Date(at || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }); }
function phoneText(p) { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; }

// The letter's content. Pure, so the words are tested without Google.
export function letterFor(audit, opts) {
  const o = opts || {}, b = audit.business || {};
  const pitch = pitchFor(b.name, b.type);
  const offer = clean(o.offer, 220) || DEFAULT_OFFER;
  const phone = phoneText(o.phone);
  const fixes = topThree(audit);
  const own = b.reviews ? b.rating.toFixed(1) + ' stars from ' + b.reviews + (b.reviews === 1 ? ' review' : ' reviews') + ' on Google today' : 'no Google reviews yet';
  return {
    name: b.name || 'Your business', address: b.address || '', date: dateText(audit.at), grade: audit.grade || '', score: audit.score || 0, own,
    areas: (audit.areas || []).map(a => ({ label: a.label, grade: a.grade })),
    fixes, fine: (audit.fine || []).slice(0, 4), pitch: pitch.text, kind: pitch.kind, offer,
    contact: phone ? 'Call or text me at ' + phone + '. To hear Max answer a call, dial (706) 460-2226.' : 'To hear Max answer a call, dial (706) 460-2226. To reach me, email hello@' + SITE + ' and I’ll come by.',
    sign: 'Christopher Gates, Always Open, Eatonton',
    gradeLink: SITE + '/#go-grade'
  };
}
// The text version for the days a message beats a printed page. Under 600 characters.
export function letterText(audit, opts) {
  const L = letterFor(audit, opts);
  const head = L.name + ': grade ' + L.grade + ' (' + L.score + ' of 100) on how you look to people searching Google.';
  const fx = L.fixes.length ? ' The three things I would fix first: ' + L.fixes.map((f, i) => (i + 1) + ') ' + f.title.toLowerCase()).join(', ') + '.' : ' Nothing major to fix; you’re in good shape.';
  const tail = ' Want me to walk you through it? ' + L.offer + ' Christopher, Always Open. See your grade: ' + L.gradeLink;
  let t = head + fx + tail;
  if (t.length > 600) t = head + fx + ' Christopher, Always Open. ' + L.gradeLink;
  return t.slice(0, 600);
}

const GC = { A: '#1C6B54', B: '#1C6B54', C: '#B7791F', D: '#C4271B', F: '#C4271B' };
function onePage(L) {
  const gc = GC[L.grade] || '#C4271B';
  return '<article class="page">' +
    '<header><div class="wm"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="6" fill="#D92D20"/><circle cx="11" cy="11" r="5.2" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="11" cy="11" r="2.1" fill="#fff"/></svg>Always Open</div><div class="dt">' + esc(L.date) + '</div></header>' +
    '<div class="head"><div><h1>' + esc(L.name) + ', graded</h1><p class="addr">' + esc(L.address) + '</p><p class="own">' + esc(L.own) + '</p></div>' +
    '<div class="grade" style="border-color:' + gc + ';color:' + gc + '"><b>' + esc(L.grade) + '</b><span>' + L.score + ' of 100</span></div></div>' +
    (L.areas.length ? '<p class="areas">' + L.areas.map(a => '<span><b style="color:' + (GC[a.grade] || '#C4271B') + '">' + esc(a.grade) + '</b> ' + esc(a.label) + '</span>').join('') + '</p>' : '') +
    '<p class="lead">This is how ' + esc(L.name) + ' looks to someone searching Google for what you do, checked this morning. ' + (L.fixes.length ? 'Here are the three things I would fix first.' : 'There is nothing major to fix, which is rare.') + '</p>' +
    (L.fixes.length ? '<ol class="fx">' + L.fixes.map(f => '<li><b>' + esc(f.title) + '.</b> ' + esc(f.saw) + ' <span>' + esc(f.fix) + '</span></li>').join('') + '</ol>' : '') +
    (L.fine.length ? '<p class="fine">Already good: ' + L.fine.map(esc).join('; ') + '.</p>' : '') +
    '<h2>What Always Open does for a business like yours</h2><p>' + esc(L.pitch) + ' You approve everything from your phone; nothing goes out in your name without your OK.</p>' +
    '<div class="offer"><b>' + esc(L.offer) + '</b></div>' +
    '<p class="contact">' + esc(L.contact) + '</p>' +
    '<footer><span>' + esc(L.sign) + '</span><span>See your grade any time: ' + esc(L.gradeLink) + '</span></footer>' +
    '</article>';
}
const CSS = '@page{size:letter;margin:0.75in}*{box-sizing:border-box}body{margin:0;background:#EDECE8;color:#171B26;font:11.5pt/1.45 "Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif}' +
  '.bar{position:sticky;top:0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:center;padding:12px 16px;background:#0F131B;color:#ECEEF3;font:600 15px system-ui,sans-serif}.bar button{font:700 16px system-ui,sans-serif;min-height:44px;padding:10px 18px;border-radius:11px;border:0;background:#D92D20;color:#fff;cursor:pointer}' +
  '.page{background:#fff;max-width:8.5in;margin:16px auto;padding:0.75in;min-height:11in;display:flex;flex-direction:column;gap:10pt}' +
  'header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #171B26;padding-bottom:8pt}.wm{display:flex;align-items:center;gap:8px;font:800 15pt "Archivo","Arial Narrow",Arial,sans-serif}.dt{font:500 9.5pt ui-monospace,Menlo,monospace;color:#586075}' +
  '.head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}h1{font:850 24pt/1.05 "Archivo","Arial Narrow",Arial,sans-serif;margin:6pt 0 2pt}.addr,.own{margin:0;color:#586075;font-size:10.5pt}' +
  '.grade{border:3px solid;border-radius:14px;padding:6pt 14pt;text-align:center;min-width:1.2in}.grade b{display:block;font:850 40pt/1 "Archivo","Arial Narrow",Arial,sans-serif}.grade span{font:500 9pt ui-monospace,Menlo,monospace}' +
  '.areas{display:flex;gap:14pt;margin:0;font-weight:600}.areas b{font:850 14pt "Archivo",Arial,sans-serif;margin-right:3pt}.lead{margin:2pt 0 0}' +
  '.fx{margin:0;padding-left:18pt;display:grid;gap:6pt}.fx li span{display:block;color:#1C6B54;font-weight:600}.fine{margin:0;color:#586075;font-size:10pt}' +
  'h2{font:800 13pt "Archivo","Arial Narrow",Arial,sans-serif;margin:6pt 0 0}p{margin:0}.offer{border:2px solid #D92D20;border-radius:12px;padding:9pt 12pt;color:#B4231A;font-size:12pt}.contact{font-weight:600}' +
  'footer{margin-top:auto;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid #DCDAD3;padding-top:8pt;font:500 9pt ui-monospace,Menlo,monospace;color:#586075}' +
  '@media (max-width:700px){.page{padding:20px 16px;min-height:0;margin:0}.head{flex-direction:column}h1{font-size:20pt}.areas{flex-wrap:wrap}}' +
  '@media print{body{background:#fff}.bar{display:none}.page{margin:0;padding:0;min-height:9.4in;max-width:none;break-after:page}.page:last-child{break-after:auto}}';
// The printable page for one or more letters.
export function letterPage(letters, missed) {
  const n = letters.length;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,500..900&family=Instrument+Sans:wght@400;600;700&display=swap">' +
    '<title>' + (n === 1 ? esc(letters[0].name) + ', graded' : n + ' grade letters') + '</title><style>' + CSS + '</style></head><body>' +
    '<div class="bar"><span>' + (n === 1 ? 'One letter' : n + ' letters, one per page') + (missed && missed.length ? '. Not found on Google: ' + esc(missed.join(', ')) : '') + '</span><button type="button" onclick="print()">Print or save PDF</button></div>' +
    letters.map(onePage).join('') + '</body></html>';
}

// Parse "Name, Town" lines from the batch box: up to ten, the town is everything after the last comma that looks like
// a place ("Eatonton" or "Eatonton, GA").
export function parseLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = clean(raw, 160);
    if (line.length < 2) continue;
    const m = /^(.*?),\s*([^,]+(?:,\s*[A-Za-z]{2})?)$/.exec(line);
    out.push(m ? { q: clean(m[1], 120), town: clean(m[2], 80) } : { q: clean(line, 120), town: '' });
    if (out.length >= MAX_LETTERS) break;
  }
  return out;
}

// Run the audits (three at a time) and build the letters. `run` is runAudit, injected for tests.
export async function buildLetters(env, items, opts, run) {
  const letters = [], texts = [], missed = [];
  const list = (items || []).slice(0, MAX_LETTERS);
  for (let i = 0; i < list.length; i += 3) {
    const got = await Promise.all(list.slice(i, i + 3).map(it => run(env, it.q, it.town).then(a => ({ it, a }), e => ({ it, err: String((e && e.message) || e) }))));
    for (const g of got) {
      if (g.err || !g.a || !g.a.found) { missed.push(g.it.q + (g.it.town ? ' (' + g.it.town + ')' : '')); continue; }
      letters.push(letterFor(g.a, opts)); texts.push({ name: g.a.business.name, text: letterText(g.a, opts) });
      try { await env.DB.prepare('INSERT INTO audits (at, q, town, kind, score, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(g.a.at, g.it.q, g.it.town, 'letter', g.a.score, JSON.stringify({ score: g.a.score, grade: g.a.grade })).run(); } catch (e) { /* the letter still prints */ }
    }
  }
  return { letters, texts, missed };
}
