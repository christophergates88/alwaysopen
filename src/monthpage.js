// The month, on one page: what Always Open did for a business, when the phone rang, why callers didn't book, reviews,
// check-ins, follow-ups, Google and the businesses nearby, what it all means, and one thing for next month.
// The owner opens it from the app (/app/<code>/month/<YYYY-MM> or /month/now), saves it as a PDF or forwards it.
// /sample-report on the website is the same page with a made-up plumber. Pure renderer: renderMonthPage(view).
import { insights, nextStep, BANDS } from './insights.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(+n || 0).toLocaleString('en-US');
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SUPPORT_NAME = 'Katie';

function delta(v, label) {
  if (v == null || !isFinite(v) || v === 0) return '';
  return '<em class="' + (v > 0 ? 'up' : 'down') + '">' + (v > 0 ? '▲ ' : '▼ ') + Math.abs(v) + ' from ' + esc(label) + '</em>';
}
function bars(vals, labels, peakIdx, aria) {
  const mx = Math.max(1, ...vals);
  return '<div class="bars" role="img" aria-label="' + esc(aria) + '">' + vals.map((v, i) =>
    '<div class="bar' + (i === peakIdx && v ? ' pk' : '') + '"><i style="height:' + Math.max(v ? 8 : 2, Math.round(v / mx * 100)) + '%"></i><b>' + v + '</b><span>' + esc(labels[i]) + '</span></div>').join('') + '</div>';
}

// view: { business, label, sentText, mtd, regulated, sample, a (insights.analyze output), stats (report stats), base, back, record }
export function renderMonthPage(v) {
  const a = v.a || {}, c = a.calls || { n: 0, after: 0, byBand: [0, 0, 0, 0, 0, 0], byDay: [0, 0, 0, 0, 0, 0, 0], callbacks: {} }, st = v.stats || {};
  const w = a.work || { fill: {}, checkins: {}, handoffs: {}, won: {}, followups: {} }, r = a.reviews || {}, vs = a.vs || null, vl = vs && vs.label ? vs.label.split(' ')[0] : 'last month';
  const month = String(v.label || '').split(' ')[0];
  const posts = +st.posts || 0;
  const booked = (w.bookedCalls || 0) + ((w.fill && w.fill.booked) || 0);
  const leads = (c.leads || 0) + (w.requests || 0);
  const tiles = [
    v.regulated ? [w.requests || 0, 'visit requests', 'taken any hour'] : [booked || (w.won && w.won.n) || 0, 'jobs booked', w.fill && w.fill.booked ? w.fill.booked + ' from Fill my week' : (leads ? pl(leads, 'lead', 'leads') + ' in all' : 'from calls and requests')],
    [r.n || 0, 'new reviews', r.avg ? 'averaging ' + r.avg.toFixed(1) + ' stars' : 'on Google', vs && vs.reviews],
    v.regulated ? [st.replies || r.replied || 0, 'replies checked', 'by Compliance Guard'] : [(w.followups && w.followups.done) || 0, 'follow-ups sent', w.followups && w.followups.quoteAmount ? 'on ' + money(w.followups.quoteAmount) + ' in quotes' : 'quotes, invoices, visits'],
    [posts, 'posts on Google', a.stormPosts ? a.stormPosts + ' storm-day' : 'approved by you']
  ];
  const worth = a.worth && a.worth.mid ? '<div class="worth"><span>What after-hours calls were worth</span><b>about ' + money(a.worth.mid) + '</b><small>' + pl(a.worth.leads || 0, 'lead', 'leads') + ' from ' + pl(a.worth.after || 0, 'after-hours call', 'after-hours calls') + ', at your win rate and average job (between ' + money(a.worth.low) + ' and ' + money(a.worth.high) + ').</small></div>'
    : (w.won && w.won.amount ? '<div class="worth"><span>Jobs booked, finished or paid</span><b>' + money(w.won.amount) + '</b><small>From the jobs in your app this month.</small></div>'
    : (v.regulated ? '<div class="worth calm"><span>On file</span><b>Every public word</b><small>Each review, reply and post this month is in your record, for your compliance contact.</small></div>' : ''));
  const ins = Array.isArray(a.insights) && a.insights.length ? a.insights : insights(a, { regulated: v.regulated });
  const next = a.next || nextStep(a, { regulated: v.regulated });
  const lost = a.lost && a.lost.n ? '<section class="half"><h2>Why callers didn’t book</h2><p class="sub">Max asks once, politely, when a caller decides not to go ahead.</p>' +
    a.lost.top.map(t => '<div class="hbar"><span>' + esc(t.label.charAt(0).toUpperCase() + t.label.slice(1)) + '</span><i style="width:' + Math.round(t.n / a.lost.n * 100) + '%"></i><b>' + t.n + '</b></div>').join('') + '</section>' : '';
  const rv = '<section class="half"><h2>Reviews</h2>' + (r.n ? '<ul class="facts"><li><b>' + r.n + '</b> new' + (r.avg ? ', averaging <b>' + r.avg.toFixed(1) + '</b> stars' : '') + '</li><li><b>' + (r.replyRate == null ? 0 : r.replyRate) + '%</b> with a reply' + (r.replyHrs != null ? ', in about <b>' + (r.replyHrs < 1 ? 'under an hour' : Math.round(r.replyHrs) + (Math.round(r.replyHrs) === 1 ? ' hour' : ' hours')) + '</b>' : '') + '</li>' +
    (st.rating ? '<li>Google rating <b>' + (+st.rating).toFixed(1) + '</b>' + (st.count ? ' from ' + st.count + ' reviews' : '') + '</li>' : '') +
    (a.rivals ? '<li>' + (a.rivals.leaderIsYou ? 'Most reviews of the <b>' + a.rivals.of + '</b> businesses near you' : '<b>' + ordinal(a.rivals.rank) + '</b> of ' + a.rivals.of + ' nearby on rating') + '</li>' : '') + '</ul>' : '<p class="sub">No new reviews this month.</p>') + '</section>';
  const chk = w.checkins || {}, hand = w.handoffs || {}, cb = c.callbacks || {};
  const other = [
    cb.set ? '<li><b>Call-backs:</b> ' + pl(cb.set, 'caller', 'callers') + ' got a call-back time from your calendar' + ((cb.kept || 0) === cb.set ? (cb.set === 1 ? ', and it was kept' : ', and all ' + cb.set + ' were kept') : ', ' + (cb.kept || 0) + ' kept') + (cb.missed ? ', ' + cb.missed + ' reset' : '') + '.</li>' : '',
    hand.out || hand.in ? '<li><b>Hand-offs:</b> ' + (hand.out ? pl(hand.out, 'caller', 'callers') + ' sent to a member nearby' : '') + (hand.out && hand.in ? ', ' : '') + (hand.in ? pl(hand.in, 'caller', 'callers') + ' sent to you' : '') + '.</li>' : '',
    c.textback ? '<li><b>Missed-call texts:</b> ' + pl(c.textback, 'caller', 'callers') + ' who hung up got a text back right away.</li>' : '',
    c.transferred ? '<li><b>Rung through to you:</b> ' + pl(c.transferred, 'urgent call', 'urgent calls') + '.</li>' : '',
    c.spanish ? '<li><b>In Spanish:</b> ' + pl(c.spanish, 'call', 'calls') + ', answered in Spanish.</li>' : '',
    w.fill && w.fill.offers ? '<li><b>Fill my week:</b> ' + pl(w.fill.offers, 'offer', 'offers') + ' to past customers who were due, ' + (w.fill.booked || 0) + ' booked.</li>' : ''
  ].filter(Boolean).join('');
  const checkBand = !v.regulated && (chk.yes || chk.no) ? '<section class="check"><h2>Three-day check-ins</h2><div class="ck"><div><b>' + (chk.yes || 0) + '</b><span>said the job held up' + (w.asks ? ', and got one review request' : '') + '</span></div>' +
    '<div><b>' + (chk.no || 0) + '</b><span>' + (chk.no ? 'told you about a problem first, so you could fix it before it became a review' : 'problems reported: nobody needed a second visit') + '</span></div></div>' +
    '<p class="sub">Three days after each job, Max calls to ask if it held up. A yes becomes a review ask. A no comes straight to you.</p></section>' : '';
  const g = a.google;
  const google = g && (g.calls != null || g.clicks != null || g.directions != null) ? '<section><h2>From your Google profile</h2><div class="trio">' +
    [[g.calls, 'calls from the Call button', vs && vs.googleCalls], [g.directions, 'direction requests'], [g.clicks, 'website visits']].map(x => '<div><b>' + (x[0] == null ? '–' : x[0]) + '</b><span>' + x[1] + '</span>' + delta(x[2], vl) + '</div>').join('') + '</div></section>' : '';
  const peakBand = c.n ? c.byBand.indexOf(Math.max(...c.byBand)) : -1, peakDay = c.n ? c.byDay.indexOf(Math.max(...c.byDay)) : -1;
  const when = c.n ? '<section><h2>When your phone rang</h2><p class="sub">' + (c.peak ? 'Busiest on ' + esc(c.peak.day) + 's, and ' + esc(c.peak.band) + '. ' : '') + (c.avgSec ? 'Calls ran about ' + Math.max(1, Math.round(c.avgSec / 60)) + (Math.round(c.avgSec / 60) <= 1 ? ' minute' : ' minutes') + '.' : '') + '</p>' +
    '<div class="when">' + bars(c.byBand, BANDS.map(b => b.replace(' to ', '–').replace(' AM', 'a').replace(' PM', 'p').replace('noon', '12p')), peakBand, 'Calls by time of day') + bars(c.byDay, DAYS, peakDay, 'Calls by day of the week') + '</div></section>' : '';
  const title = (v.business || 'Your business') + ' · ' + (v.label || '') + (v.mtd ? ' so far' : '');
  const actions = v.sample
    ? '<a class="btn" href="/#contact">Get this page for your business</a><a class="btn ghost" href="/">Back to Always Open</a>'
    : '<button class="btn" type="button" id="pdf">Save as PDF</button><button class="btn ghost" type="button" id="share" hidden>Share</button>' + (v.back ? '<a class="btn ghost" href="' + esc(v.back) + '">Back to the app</a>' : '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    (v.sample ? '<meta name="description" content="A sample of the one page every Always Open business gets on the 2nd of the month: calls answered, when the phone rang, why callers didn’t book, reviews, check-ins, follow-ups, what it was worth, and one thing for next month.">' : '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">') +
    '<title>' + esc(title) + '</title>' +
    '<style>' + CSS + '</style></head><body><main class="page">' +
    '<div class="tools">' + actions + '</div>' +
    '<div class="sheet"><header class="hd"><div class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>Always Open</div>' +
    '<h1>' + esc(v.business || 'Your business') + '</h1><p class="when-made">' + esc(v.label || '') + (v.mtd ? ', so far' : ', on one page') + (v.sentText ? ' · ' + esc(v.sentText) : '') + '</p></header>' +
    '<section class="lead"><div class="big"><b>' + (c.n || 0) + '</b><span>' + (v.regulated ? 'calls answered' : 'calls answered') + '<small>' + (c.n ? c.after + ' after hours or on a weekend' + (c.leads ? ', ' + pl(c.leads, 'lead', 'leads') + ' left their details' : '') : 'No calls to Max this month') + '</small>' + delta(vs && vs.calls, vl) + '</span></div>' + worth + '</section>' +
    '<section class="tiles">' + tiles.map(t => '<div><b>' + t[0] + '</b><span>' + esc(t[1]) + '</span><small>' + esc(t[2]) + '</small>' + delta(t[3], vl) + '</div>').join('') + '</section>' +
    checkBand +
    when +
    (lost || rv ? '<div class="two">' + (lost || '') + rv + '</div>' : '') +
    (other ? '<section><h2>Also this month</h2><ul class="list">' + other + '</ul></section>' : '') +
    google +
    (ins.length ? '<section class="means"><h2>What it means</h2><ol>' + ins.map(x => '<li>' + esc(x.t) + '</li>').join('') + '</ol></section>' : '') +
    '<section class="next"><h2>One thing for next month</h2><p>' + esc(next) + '</p></section>' +
    '<footer class="ft"><p>' + (v.record ? 'Every review, reply and post this month is in your <a href="' + esc(v.record) + '">record of public communications</a>. ' : 'Every review, reply and post is kept in a monthly record. ') +
    'Questions about this page? ' + SUPPORT_NAME + ' answers, usually the same business day: hello@alwaysopenoffice.com' + (v.sample ? '' : ', or Ask us in the app') + '.</p>' +
    '<p>Made by Always Open' + (v.sample ? '. Sample: made-up business and numbers.' : ' for ' + esc(v.business || 'your business') + (/\.$/.test(v.business || '') ? '' : '.') + ' Counts come from Max’s calls, your app and your Google profile.') + '</p></footer></div>' +
    '</main><script>(function(){var p=document.getElementById("pdf");if(p)p.onclick=function(){window.print();};var s=document.getElementById("share");if(s&&navigator.share){s.hidden=false;s.onclick=function(){navigator.share({title:document.title,url:location.href}).catch(function(){});};}})();</script></body></html>';
}
function ordinal(n) { return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); }

const CSS = ':root{--ink:#14171F;--slate:#5A6170;--line:#E2DED6;--paper:#FBFAF7;--card:#fff;--sign:#D92D20;--sign-soft:#FDECEA;--ok:#0E4A2E;--ok-soft:#E9F6EF}' +
  '*{box-sizing:border-box}html{background:#ECE9E2}body{margin:0;color:var(--ink);font:15px/1.5 "Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif}' +
  '.page{max-width:820px;margin:0 auto;padding:18px 16px 40px}' +
  '.tools{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}.btn{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;border-radius:12px;border:2px solid var(--sign);background:var(--sign);color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none;cursor:pointer}.btn.ghost{background:transparent;color:var(--sign)}' +
  '.hd,.lead,.tiles,section,.two,.ft{background:var(--paper)}' +
  '.hd{border-radius:18px 18px 0 0;padding:22px 24px 12px;border-bottom:1px solid var(--line)}' +
  '.brand{display:flex;align-items:center;gap:8px;font:800 14px system-ui,sans-serif;color:var(--slate)}.brand svg{width:22px;height:22px}' +
  'h1{font:850 clamp(1.7rem,4.5vw,2.3rem)/1.05 "Archivo","Arial Narrow",system-ui,sans-serif;font-stretch:90%;margin:10px 0 2px;letter-spacing:-.01em}.when-made{margin:0;color:var(--slate);font-size:14px}' +
  '.lead{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:center;padding:16px 24px}' +
  '.big{display:flex;align-items:baseline;gap:12px}.big b{font:850 4rem/.9 "Archivo","Arial Narrow",system-ui,sans-serif;font-stretch:88%}.big span{font-weight:700;font-size:1.05rem;line-height:1.25}.big small{display:block;font-weight:400;font-size:13px;color:var(--slate)}' +
  '.worth{background:var(--sign-soft);border-radius:14px;padding:12px 14px}.worth span{display:block;font-size:13px;font-weight:600}.worth b{display:block;font:850 1.7rem/1.1 "Archivo","Arial Narrow",system-ui,sans-serif;color:#B42318}.worth small{display:block;font-size:12.5px;color:var(--slate);margin-top:2px}.worth.calm{background:var(--ok-soft)}.worth.calm b{color:var(--ok);font-size:1.3rem}' +
  'em{display:block;font-style:normal;font-size:12px;font-weight:600;margin-top:2px}em.up{color:#067647}em.down{color:#B42318}' +
  '.tiles{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.tiles div{padding:12px 16px;border-right:1px solid var(--line);display:grid;align-content:start;gap:1px}.tiles div:last-child{border-right:0}.tiles b{font:850 1.7rem/1 "Archivo","Arial Narrow",system-ui,sans-serif}.tiles span{font-weight:600;font-size:13.5px}.tiles small{font-size:12.5px;color:var(--slate)}' +
  'section{padding:14px 24px;border-bottom:1px solid var(--line)}h2{font:800 1.02rem/1.2 system-ui,sans-serif;margin:0 0 4px}.sub{margin:0 0 8px;color:var(--slate);font-size:13.5px}' +
  '.when{display:grid;grid-template-columns:1.2fr 1fr;gap:18px}.bars{display:flex;align-items:flex-end;gap:6px;height:118px}.bar{flex:1;display:grid;grid-template-rows:1fr auto auto;align-items:end;text-align:center;height:100%}.bar i{display:block;background:#D6D1C6;border-radius:6px 6px 2px 2px;align-self:end}.bar.pk i{background:var(--sign)}.bar b{font-size:12px}.bar span{font-size:11px;color:var(--slate);white-space:nowrap}' +
  '.two{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}.two section{border-bottom:0}.two section+section{border-left:1px solid var(--line)}' +
  '.hbar{display:grid;grid-template-columns:minmax(0,1.3fr) 1fr auto;gap:8px;align-items:center;font-size:13.5px;margin:6px 0}.hbar i{height:10px;border-radius:5px;background:var(--sign)}' +
  '.facts,.list{margin:0;padding-left:18px}.facts li,.list li{margin:3px 0;font-size:14px}' +
  '.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.trio div{display:grid}.trio b{font:850 1.5rem/1 "Archivo","Arial Narrow",system-ui,sans-serif}.trio span{font-size:13px;color:var(--slate)}' +
  '.means ol{margin:4px 0 0;padding-left:20px}.means li{margin:5px 0}' +
  '.check{background:var(--ok-soft)}.check h2{color:var(--ok)}.ck{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:4px 0 6px}.ck div{display:flex;gap:10px;align-items:baseline}.ck b{font:850 2rem/1 "Archivo","Arial Narrow",system-ui,sans-serif;color:var(--ok)}.ck span{font-size:14px}.check .sub{margin:0}' +
  '.next{background:var(--ok-soft)}.next p{margin:0;font-weight:600}' +
  '.ft{border-radius:0 0 18px 18px;padding:14px 24px 18px;font-size:12.5px;color:var(--slate)}.ft p{margin:4px 0}.ft a{color:inherit}' +
  '@media (max-width:640px){.lead,.when,.two,.ck{grid-template-columns:1fr}.two section+section{border-left:0;border-top:1px solid var(--line)}.tiles{grid-template-columns:1fr 1fr}.tiles div:nth-child(2){border-right:0}.tiles div:nth-child(-n+2){border-bottom:1px solid var(--line)}.hd,.lead,section,.ft{padding-left:16px;padding-right:16px}.big b{font-size:3.2rem}}' +
  // On screen the page is lit like the OPEN sign on the website: a dark sheet with a slow red glow, the big number in
  // neon, check-ins in green. Printing and Save as PDF keep the plain paper version above (nothing here applies).
  '@media screen{:root{--ink:#ECEEF3;--slate:#A3ACBF;--line:rgba(255,255,255,.08);--paper:transparent;--sign:#FF5A4D;--sign-soft:rgba(255,90,77,.1);--ok:#5CC9A4;--ok-soft:rgba(92,201,164,.07);color-scheme:dark}' +
  'html{background:radial-gradient(900px 520px at 85% -8%,rgba(217,45,32,.24),transparent 62%),linear-gradient(170deg,#141A27 0%,#0D1017 60%) fixed #0D1017}' +
  '.sheet{border:1.5px solid rgba(255,106,94,.55);border-radius:20px;overflow:hidden;background:radial-gradient(600px 260px at 12% 0%,rgba(255,90,77,.1),transparent 70%),linear-gradient(170deg,#1A2131 0%,#121722 100%);box-shadow:0 0 0 1px rgba(255,106,94,.14),0 0 34px rgba(255,90,77,.3),inset 0 0 30px rgba(255,90,77,.05),0 40px 80px -40px rgba(0,0,0,.9)}' +
  '.hd,.ft{border-radius:0}.brand{color:#FF8C82;text-shadow:0 0 10px rgba(255,106,94,.5)}.brand svg{filter:drop-shadow(0 0 8px rgba(255,106,94,.55))}h1{color:#fff}' +
  '.big b{color:#FF6A5E;text-shadow:0 0 12px rgba(255,106,94,.75),0 0 34px rgba(255,90,77,.5)}.big span{color:#fff}' +
  '.worth{background:rgba(255,90,77,.08);border:1px solid rgba(255,106,94,.5);box-shadow:0 0 18px rgba(255,90,77,.18),inset 0 0 14px rgba(255,90,77,.08)}.worth b{color:#FF6A5E;text-shadow:0 0 12px rgba(255,106,94,.7)}' +
  '.worth.calm{background:rgba(92,201,164,.07);border-color:rgba(92,201,164,.45);box-shadow:0 0 16px rgba(92,201,164,.14)}.worth.calm b{color:#7EE0BE;text-shadow:0 0 10px rgba(92,201,164,.55)}' +
  '.tiles b,.trio b{color:#fff;text-shadow:0 0 14px rgba(255,255,255,.2)}em.up{color:#7EE0BE}em.down{color:#FF8C82}' +
  '.check{background:rgba(92,201,164,.07);border-top:1px solid rgba(92,201,164,.35);border-bottom:1px solid rgba(92,201,164,.35);box-shadow:inset 0 0 26px rgba(92,201,164,.08)}.check h2,.ck b{color:#7EE0BE;text-shadow:0 0 10px rgba(92,201,164,.55)}' +
  '.bar i{background:#2B3346}.bar.pk i{background:#FF5A4D;box-shadow:0 0 14px rgba(255,90,77,.6)}.hbar i{background:#FF5A4D;box-shadow:0 0 10px rgba(255,90,77,.5)}' +
  '.next{background:rgba(92,201,164,.07)}.next h2{color:#7EE0BE}.next p{color:#fff}' +
  '.btn{box-shadow:0 0 18px rgba(255,90,77,.35)}.btn.ghost{color:#FF8C82;border-color:rgba(255,106,94,.7);box-shadow:none}' +
  '.ft a{color:#FF8C82}' +
  '@keyframes shGlow{0%,100%{box-shadow:0 0 0 1px rgba(255,106,94,.12),0 0 28px rgba(255,90,77,.24),inset 0 0 26px rgba(255,90,77,.04),0 40px 80px -40px rgba(0,0,0,.9)}50%{box-shadow:0 0 0 1px rgba(255,106,94,.22),0 0 44px rgba(255,90,77,.4),inset 0 0 34px rgba(255,90,77,.08),0 40px 80px -40px rgba(0,0,0,.9)}}' +
  '@media (prefers-reduced-motion:no-preference){.sheet{animation:shGlow 3.2s ease-in-out infinite}}}' +
  '@media print{@page{size:letter;margin:.35in}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}html{background:#fff}.page{max-width:none;padding:0;zoom:.66}.tools{display:none}.hd,.lead,.tiles,section,.two,.ft{background:#fff}section{padding:9px 0}.hd,.lead,.ft{padding-left:0;padding-right:0}.two section{padding:9px 16px 9px 0}.two section+section{padding-left:16px}.bars{height:90px}body{font-size:13px}}';

// The website's sample: a made-up plumber, in the same shape as a real month, run through the same findings.
export function samplePage() {
  const a = {
    v: 1,
    calls: { n: 14, after: 6, weekend: 3, spanish: 1, urgent: 2, transferred: 2, leads: 11, booked: 3, avgSec: 150, textback: 1, callbacks: { set: 3, kept: 3, missed: 0 },
      byBand: [2, 3, 1, 3, 4, 1], byDay: [2, 3, 2, 2, 2, 2, 1], peak: { band: '6 to 9 PM', bandN: 4, day: 'Tuesday', dayN: 3 } },
    lost: { n: 3, top: [{ r: 'price', label: 'said price', n: 2 }, { r: 'timing', label: 'wanted a different time', n: 1 }] },
    work: { requests: 2, bookedCalls: 3, fill: { offers: 6, booked: 2 }, jobsLogged: 9, asks: 8, checkins: { yes: 8, no: 1 }, handoffs: { out: 1, in: 2 }, won: { n: 7, amount: 7350 }, followups: { done: 4, quoteAmount: 6420 } },
    reviews: { n: 3, avg: 4.7, replied: 3, replyRate: 100, replyHrs: 3 },
    google: { calls: 22, clicks: 41, directions: 17 },
    rivals: { rank: 2, of: 6, rating: 4.6, reviews: 58, mostReviews: 71, leaderIsYou: false },
    worth: { mid: 4900, low: 3500, high: 6300, after: 6, leads: 5 },
    vs: { label: 'September 2026', calls: 4, reviews: 1, googleCalls: 3 },
    stormPosts: 1
  };
  a.insights = insights(a, {}); a.next = nextStep(a, {});
  return renderMonthPage({ business: 'Mike’s Plumbing', label: 'October 2026', sentText: 'sent Nov 2', sample: true, a, stats: { posts: 2, rating: 4.6, count: 58, replies: 3 } });
}
