// Your year, on one page: twelve months of what Always Open did for a business, and everything since it joined.
// The owner opens it from the app (/app/<code>/year) or from the monthly page. Same look as the monthly page
// (monthpage.js): lit like the OPEN sign on screen, plain paper when printed or saved as a PDF.
// Pure renderer: renderYearPage(view), with view = { business, back, month, t (trends.trendsFor output), regulated }.
import { CSS as MONTH_CSS, SUPPORT_NAME } from './monthpage.js';
import { dollars } from './money.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const num = n => Math.round(+n || 0).toLocaleString('en-US');
const short$ = n => { n = Math.round(+n || 0); return n >= 10000 ? '$' + Math.round(n / 1000) + 'k' : n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : '$' + n; };

// Twelve bars, drawn to one scale. parts: [{ key, cls }] stacked bottom to top; label(v) writes the total over the bar.
export function barChart(months, parts, opts) {
  opts = opts || {};
  const W = 600, H = 190, top = 22, bottom = 28, left = 6, right = 6;
  const n = months.length, slot = (W - left - right) / n, bw = Math.min(30, slot * 0.62);
  const totals = months.map(m => parts.reduce((s, p) => s + Math.max(0, +m[p.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const ph = H - top - bottom;
  let g = '';
  months.forEach((m, i) => {
    const x = left + slot * i + (slot - bw) / 2;
    let y = top + ph;
    if (m.before) {
      g += '<rect class="yr-none" x="' + x.toFixed(1) + '" y="' + (top + ph - 2) + '" width="' + bw.toFixed(1) + '" height="2" rx="1"/>';
    } else {
      for (const p of parts) {
        const v = Math.max(0, +m[p.key] || 0); if (!v) continue;
        const h = Math.max(2, v / max * ph);
        y -= h;
        g += '<rect class="' + p.cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>';
      }
      if (totals[i]) g += '<text class="yr-v" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">' + esc(opts.label ? opts.label(totals[i]) : totals[i]) + '</text>';
    }
    g += '<text class="yr-m' + (m.partial ? ' yr-now' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(m.short) + '</text>';
  });
  return '<svg class="yr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || '') + '"><line class="yr-base" x1="' + left + '" x2="' + (W - right) + '" y1="' + (top + ph + 0.5) + '" y2="' + (top + ph + 0.5) + '"/>' + g + '</svg>';
}

export function renderYearPage(v) {
  const t = v.t || { months: [], since: {}, lines: [] }, s = t.since || {}, months = t.months || [];
  const live = months.filter(m => !m.before);
  const money = !t.noMoney && !v.regulated && t.avgJob > 0;
  const title = (v.business || 'Your business') + ' · Your year';
  const joined = s.joinedLabel ? 'Since you joined in ' + s.joinedLabel : 'The last twelve months';
  const worth = money && s.worth ? '<div class="worth"><span>What after-hours calls were worth</span><b>about ' + dollars(s.worth) + '</b><small>' + pl(s.after || 0, 'after-hours call', 'after-hours calls') + ' since you joined, at your win rate and ' + dollars(t.avgJob) + ' average job.</small></div>'
    : (s.won ? '<div class="worth"><span>Jobs booked, finished or paid</span><b>' + dollars(s.won) + '</b><small>From the jobs in your app since you joined.</small></div>'
    : '<div class="worth calm"><span>Before Max</span><b>' + num(s.after) + ' to voicemail</b><small>Every after-hours call Max answered would have gone to voicemail.</small></div>');
  const tiles = [
    [num(s.after), 'after hours', 'calls that would have gone to voicemail'],
    [num((s.leads || 0) + (s.requests || 0)), 'leads', s.booked ? pl(s.booked, 'booked a time', 'booked a time') + ' with Max' : 'callers and requests with details'],
    [num(s.replied), 'review replies', s.replyHrs != null ? 'in about ' + (s.replyHrs < 1 ? 'under an hour' : Math.round(s.replyHrs) + (Math.round(s.replyHrs) === 1 ? ' hour' : ' hours')) + ' on average' : 'approved by you'],
    [num(s.textbacks), 'missed-call texts', 'to callers who hung up']
  ];
  const f = s.first, l = s.latest;
  const row = (name, a, b, fmt, better) => {
    const fa = a == null ? '–' : (fmt ? fmt(a) : num(a)), fb = b == null ? '–' : (fmt ? fmt(b) : num(b));
    let cls = '';
    if (a != null && b != null && a !== b) cls = (better === 'down' ? b < a : b > a) ? 'up' : 'down';
    return '<tr><th>' + esc(name) + '</th><td>' + esc(fa) + '</td><td class="' + cls + '">' + esc(fb) + '</td></tr>';
  };
  const hrsFmt = h => h < 1 ? 'under 1 h' : Math.round(h) + ' h';
  const rankFmt = r => r ? ord(r) : 'not named';
  const compare = f && l ? '<section><h2>Your first month and your latest</h2><p class="sub">' + esc(f.label) + ' was your first full month with us. Same counts, same rules, side by side.</p>' +
    '<table class="yr-cmp"><thead><tr><th></th><th>' + esc(f.label.split(' ')[0]) + '</th><th>' + esc(l.label.split(' ')[0]) + '</th></tr></thead><tbody>' +
    row('Calls answered', f.calls, l.calls) + row('After hours', f.after, l.after) + row('Leads', f.leads, l.leads) +
    row('Review replies', f.replied, l.replied) + (f.replyHrs != null || l.replyHrs != null ? row('Time to reply', f.replyHrs, l.replyHrs, hrsFmt, 'down') : '') +
    (money ? row('After-hours calls worth', f.worth, l.worth, dollars) : '') +
    (f.aiRank != null && l.aiRank != null ? row('AI assistants name you', f.aiRank || 99, l.aiRank || 99, r => rankFmt(r === 99 ? 0 : r), 'down') : '') +
    '</tbody></table></section>' : '';
  const calls = live.some(m => m.calls) ? '<section><h2>Calls Max answered, month by month</h2><p class="sub"><i class="key k1"></i>During business hours <i class="key k2"></i>After hours and weekends</p>' +
    barChart(months.map(m => Object.assign({}, m, { day: Math.max(0, m.calls - m.after) })), [{ key: 'day', cls: 'yr-b' }, { key: 'after', cls: 'yr-a' }], { aria: 'Calls answered each month, split by business hours and after hours' }) + '</section>' : '';
  const worthChart = money && live.some(m => m.worth) ? '<section><h2>What after-hours calls were worth</h2><p class="sub">Leads from after-hours calls, at your ' + (t.winRate || 30) + '% win rate and ' + dollars(t.avgJob) + ' average job.</p>' +
    barChart(months, [{ key: 'worth', cls: 'yr-a' }], { aria: 'Estimated value of after-hours calls each month', label: short$ }) + '</section>'
    : (live.some(m => m.leads + m.requests) ? '<section><h2>Leads, month by month</h2><p class="sub">Callers who left their details, booked a time, or sent a request.</p>' +
    barChart(months.map(m => Object.assign({}, m, { allLeads: m.leads + m.requests })), [{ key: 'allLeads', cls: 'yr-a' }], { aria: 'Leads each month' }) + '</section>' : '');
  const reviews = live.some(m => m.reviews) ? '<section><h2>Reviews and replies</h2><p class="sub">New reviews each month, and how fast the reply went out.</p>' +
    barChart(months.map(m => Object.assign({}, m, { open: Math.max(0, m.reviews - m.replied) })), [{ key: 'replied', cls: 'yr-g' }, { key: 'open', cls: 'yr-b' }], { aria: 'New reviews each month' }) +
    '<div class="yr-row">' + months.map(m => '<span>' + (m.before || m.replyHrs == null ? '' : esc(m.replyHrs < 1 ? '<1h' : Math.round(m.replyHrs) + 'h')) + '</span>').join('') + '</div>' + '</section>' : '';
  const ai = live.some(m => m.aiRank != null) ? '<section><h2>What AI assistants say</h2><p class="sub">Once a month we ask an AI assistant, with live web search, to recommend a business like yours in your town. This is where it put you.</p>' +
    '<div class="yr-ai">' + months.map(m => '<div class="' + (m.aiRank ? (m.aiRank <= 3 ? 'top' : 'in') : (m.aiRank === 0 ? 'out' : 'none')) + '"><b>' + (m.before || m.aiRank == null ? '' : (m.aiRank ? esc(ord(m.aiRank)) : '–')) + '</b><span>' + esc(m.short) + '</span></div>').join('') + '</div>' +
    '<p class="sub" style="margin-top:6px">– means it did not name you that month. Blank means no check yet.</p></section>' : '';
  const said = (t.lines || []).length ? '<section class="means"><h2>What changed</h2><ol>' + t.lines.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></section>' : '';
  const actions = '<button class="btn" type="button" id="pdf">Save as PDF</button><button class="btn ghost" type="button" id="share" hidden>Share</button>' +
    (v.month ? '<a class="btn ghost" href="' + esc(v.month) + '">This month</a>' : '') + (v.back ? '<a class="btn ghost" href="' + esc(v.back) + '">Back to the app</a>' : '');
  const empty = !live.length || !s.calls && !s.reviews && !s.requests;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + esc(title) + '</title><style>' + MONTH_CSS + YEAR_CSS + '</style></head><body><main class="page">' +
    '<div class="tools">' + actions + '</div>' +
    '<div class="sheet"><header class="hd"><div class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>Always Open</div>' +
    '<h1>' + esc(v.business || 'Your business') + '</h1><p class="when-made">' + esc(joined) + (s.months ? ' · ' + pl(s.months, 'month', 'months') : '') + '</p></header>' +
    (empty ? '<section><h2>Your year starts here</h2><p class="sub">Once Max answers calls and reviews come in, every month adds a bar here. Your first full month becomes the "before" we measure from.</p></section>' :
    '<section class="lead"><div class="big"><b>' + num(s.calls) + '</b><span>calls answered<small>' + (s.minutes ? num(s.minutes) + ' minutes on the phone for you' : '') + '</small></span></div>' + worth + '</section>' +
    '<section class="tiles">' + tiles.map(x => '<div><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span><small>' + esc(x[2]) + '</small></div>').join('') + '</section>' +
    compare + calls + worthChart + reviews + ai + said) +
    '<footer class="ft"><p>Questions about this page? ' + SUPPORT_NAME + ' answers, usually the same business day: hello@alwaysopenoffice.com, or Ask us in the app.</p>' +
    '<p>Made by Always Open for ' + esc(v.business || 'your business') + (/\.$/.test(v.business || '') ? '' : '.') + ' Counts come from Max’s calls, your app and the monthly assistant check. Dollar figures use the average job and win rate you set.</p></footer></div>' +
    '</main><script>(function(){var p=document.getElementById("pdf");if(p)p.onclick=function(){window.print();};var s=document.getElementById("share");if(s&&navigator.share){s.hidden=false;s.onclick=function(){navigator.share({title:document.title,url:location.href}).catch(function(){});};}})();</script></body></html>';
}

const YEAR_CSS = ':root{--bar:#D6D1C6}' +
  '.yr-chart{display:block;width:100%;height:auto;margin-top:4px}.yr-chart text{font:600 11px system-ui,sans-serif;fill:var(--slate)}.yr-chart .yr-v{fill:var(--ink);font-weight:700}.yr-chart .yr-now{fill:var(--sign);font-weight:800}' +
  '.yr-a{fill:var(--sign)}.yr-b{fill:var(--bar)}.yr-g{fill:var(--ok)}.yr-none{fill:var(--line)}.yr-base{stroke:var(--line);stroke-width:1}' +
  '.key{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 5px 0 0;vertical-align:-1px}.key.k1{background:var(--bar)}.key.k2{background:var(--sign);margin-left:12px}' +
  '.yr-row{display:grid;grid-template-columns:repeat(12,1fr);font-size:11px;color:var(--slate);text-align:center;margin-top:-2px}' +
  '.yr-ai{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin-top:6px}.yr-ai div{display:grid;gap:3px;text-align:center;padding:8px 0 6px;border-radius:8px;border:1px solid var(--line)}.yr-ai b{font:850 15px/1 "Archivo","Arial Narrow",system-ui,sans-serif;min-height:15px}.yr-ai span{font-size:10.5px;color:var(--slate)}' +
  '.yr-ai .top{border-color:var(--ok);background:var(--ok-soft)}.yr-ai .top b{color:var(--ok)}.yr-ai .out b{color:var(--sign)}.yr-ai .none{opacity:.55}' +
  '.yr-cmp{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}.yr-cmp th,.yr-cmp td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right}.yr-cmp th:first-child{text-align:left;font-weight:600}.yr-cmp thead th{font-size:12px;color:var(--slate);font-weight:700}.yr-cmp td.up{color:#067647;font-weight:700}.yr-cmp td.down{color:#B42318;font-weight:700}' +
  '@media (max-width:640px){.yr-ai{grid-template-columns:repeat(6,1fr)}.yr-chart text{font-size:19px}.yr-chart .yr-v{font-size:17px}}' +
  '@media screen{:root{--bar:#2B3346}.yr-a{filter:drop-shadow(0 0 5px rgba(255,90,77,.55))}.yr-cmp td.up{color:#7EE0BE}.yr-cmp td.down{color:#FF8C82}.yr-ai .top b{text-shadow:0 0 10px rgba(92,201,164,.55)}}';
