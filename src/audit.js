// One-click audit: look a business up on Google (Places API, New), compare it with the nearest
// competitors, check its website, and turn that into findings and a score.
//   POST /audit/run    (x-key: LEADS_KEY)  full audit for Chris; saved to the audits table
//   GET  /audit/tool                       Chris's audit page (asks for the key once, keeps it in the browser)
//   POST /audit/score  (public)            quick score for the website box; rate limited, capped per day
// Public Google data only. No reviewer names are stored or shown.

const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount', 'websiteUri', 'nationalPhoneNumber',
  'regularOpeningHours', 'photos', 'reviews', 'primaryType', 'primaryTypeDisplayName', 'googleMapsUri', 'location', 'businessStatus'];
const PUBLIC_PER_HOUR = 3;
const PUBLIC_PER_DAY = 150;

export async function places(env, path, body, fields) {
  const r = await fetch('https://places.googleapis.com/v1/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': fields.map(f => 'places.' + f).join(',') },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); try { await (await import('./funding.js')).googleProblem(env, r.status, t); } catch (e) {} throw new Error('Google lookup failed (' + r.status + ')'); }
  return ((await r.json()) || {}).places || [];
}

const digits = s => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

async function checkSite(url, phone) {
  const out = { url, ok: false };
  if (!url) return out;
  const t0 = Date.now();
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; AlwaysOpenAudit/1.0; +https://alwaysopenoffice.com)' } });
    clearTimeout(timer);
    out.ms = Date.now() - t0;
    out.status = r.status;
    out.ok = r.ok;
    out.https = (r.url || url).startsWith('https://');
    const html = (await r.text()).slice(0, 600000);
    out.mobile = /<meta[^>]+name=["']viewport["']/i.test(html);
    out.tapToCall = /href=["']tel:/i.test(html);
    const d = digits(phone);
    out.phoneOnSite = d.length === 10 ? digits(html.replace(/<[^>]+>/g, ' ')).includes(d) || html.replace(/\D/g, '').includes(d) : null;
    const tm = html.match(/<title[^>]*>([^<]{0,140})/i); out.title = tm ? tm[1].trim() : '';
  } catch (e) {
    out.ms = Date.now() - t0;
    out.error = /abort/i.test(String(e)) ? 'took longer than 9 seconds to load' : 'could not be reached';
  }
  return out;
}

// Letter grades. The overall grade comes from the score. Each area (reviews, Google profile, website) is graded on its own
// problems: nothing wrong is an A; the heavier the problems, the lower the letter.
export function gradeOf(score) { return score >= 90 ? 'A' : score >= 78 ? 'B' : score >= 62 ? 'C' : score >= 40 ? 'D' : 'F'; }
function areaGrade(weight) { return weight <= 0 ? 'A' : weight < 7 ? 'B' : weight < 14 ? 'C' : weight < 25 ? 'D' : 'F'; }
const AREAS = [['reviews', 'Reviews'], ['profile', 'Google profile'], ['website', 'Website']];
function areaOf(title) { return /review|rating/i.test(title) ? 'reviews' : /closed|hours|photos/i.test(title) ? 'profile' : 'website'; }
export function gradeAreas(findings) {
  return AREAS.map(([key, label]) => {
    const mine = findings.filter(x => areaOf(x.title) === key);
    return { key, label, grade: areaGrade(mine.reduce((t, x) => t + x.weight, 0)), issues: mine.length };
  });
}

export async function runAudit(env, q, town) {
  if (!env.PLACES_KEY) throw new Error('The Google key is not set up yet.');
  const hits = await places(env, 'places:searchText', { textQuery: q + (town ? ' in ' + town : ''), pageSize: 1 }, PLACE_FIELDS);
  const p = hits[0];
  if (!p) return { found: false };
  const me = {
    id: p.id || '', name: (p.displayName && p.displayName.text) || q, address: p.formattedAddress || '', type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
    rating: +p.rating || 0, reviews: +p.userRatingCount || 0, phone: p.nationalPhoneNumber || '', website: p.websiteUri || '',
    hours: !!(p.regularOpeningHours && (p.regularOpeningHours.weekdayDescriptions || []).length), photos: (p.photos || []).length,
    maps: p.googleMapsUri || '', status: p.businessStatus || 'OPERATIONAL'
  };
  const now = Date.now();
  const rv = (p.reviews || []).map(x => ({ t: Date.parse(x.publishTime || '') || 0, stars: +x.rating || 0 })).filter(x => x.t).sort((a, b) => b.t - a.t);
  me.newestDays = rv.length ? Math.floor((now - rv[0].t) / 86400000) : null;
  me.recentLow = rv.filter(x => x.stars <= 2 && now - x.t < 90 * 86400000).length;

  let rivals = [];
  if (p.location && p.primaryType) {
    try {
      const near = await places(env, 'places:searchNearby', {
        includedPrimaryTypes: [p.primaryType], maxResultCount: 10, rankPreference: 'POPULARITY',
        locationRestriction: { circle: { center: p.location, radius: 15000 } }
      }, ['id', 'displayName', 'rating', 'userRatingCount']);
      rivals = near.filter(x => x.id !== p.id).map(x => ({ name: (x.displayName && x.displayName.text) || '', rating: +x.rating || 0, reviews: +x.userRatingCount || 0 }))
        .sort((a, b) => b.reviews - a.reviews).slice(0, 3);
    } catch (e) { rivals = []; }
  }
  const site = await checkSite(me.website, me.phone);

  // Findings, worst first. Each says what we saw and what fixes it.
  const f = [];
  const add = (weight, title, saw, fix) => f.push({ weight, title, saw, fix });
  const avgRivalReviews = rivals.length ? Math.round(rivals.reduce((s, r) => s + r.reviews, 0) / rivals.length) : 0;
  const avgRivalRating = rivals.length ? Math.round(rivals.reduce((s, r) => s + r.rating, 0) / rivals.length * 10) / 10 : 0;
  if (me.status !== 'OPERATIONAL') add(30, 'Google may show this business as closed', 'Google lists its status as ' + me.status.toLowerCase().replace(/_/g, ' ') + '.', 'We fix the listing status and keep hours current.');
  if (!me.reviews) add(25, 'No Google reviews yet', 'Customers searching see no reviews at all.', 'We ask every customer for a review after each job.');
  else if (avgRivalReviews && me.reviews < avgRivalReviews * 0.6) add(18, 'Fewer reviews than nearby competitors', me.reviews + ' reviews, while the top nearby competitors average ' + avgRivalReviews + '.', 'We ask every customer for a review after each job, so the count keeps climbing.');
  if (me.reviews && me.rating && me.rating < 4.5) add(me.rating < 4 ? 20 : 12, 'Rating below 4.5', 'A ' + me.rating.toFixed(1) + ' rating' + (avgRivalRating ? ' (nearby competitors average ' + avgRivalRating.toFixed(1) + ')' : '') + '. Many customers filter out anything under 4.5.', 'Asking every customer after every job lifts the average; every unhappy review gets a calm reply the same day.');
  if (me.newestDays != null && me.newestDays > 45) add(12, 'No recent reviews', 'The newest review is ' + me.newestDays + ' days old. Recent reviews are a ranking and trust signal.', 'A review request after every job keeps new ones coming each month.');
  if (me.recentLow) add(10, 'Recent low-star reviews', me.recentLow + ' review' + (me.recentLow > 1 ? 's' : '') + ' of 1 or 2 stars in the last 90 days among the reviews Google shows first.', 'We draft a calm, professional reply for your OK the same day.');
  if (!me.hours) add(12, 'No hours on Google', 'Google does not list opening hours.', 'We add hours, holiday hours and closures, and keep them current.');
  if (me.photos < 10) add(8, 'Few photos on Google', me.photos + ' photo' + (me.photos === 1 ? '' : 's') + ' on the profile. Listings with more photos get more calls and direction requests.', 'Snap a finished job and we turn it into a post and a profile photo.');
  if (!me.website) add(10, 'No website on Google', 'The profile has no website link.', 'We add one, or build a simple site.');
  else if (!site.ok) add(14, 'Website did not load', 'The website ' + (site.error || ('returned an error (' + site.status + ')')) + '.', 'We point Google to a working page.');
  else {
    if (site.mobile === false) add(9, 'Website is hard to use on a phone', 'The site is not set up for phone screens, where most customers find you.', 'We fix the page or build a phone-friendly one.');
    if (site.tapToCall === false) add(6, 'No tap-to-call button on the website', 'Phone visitors have to copy your number by hand.', 'We add a tap-to-call button.');
    if (site.phoneOnSite === false) add(7, 'Phone number does not match', 'The number on Google (' + me.phone + ') does not appear on the website.', 'We make your name, phone and hours match everywhere.');
    if (site.https === false) add(5, 'Website is not secure', 'Browsers mark the site "Not secure".', 'We turn on https.');
    if (site.ms > 5000) add(4, 'Website is slow', 'It took ' + Math.round(site.ms / 100) / 10 + ' seconds to load.', 'We trim the page or move it to fast hosting.');
  }
  f.sort((a, b) => b.weight - a.weight);
  // Each problem takes a share of what's left, so one big gap hurts but a pile of small ones doesn't zero it out.
  const score = Math.max(5, Math.min(100, Math.round(100 * Math.exp(-f.reduce((s, x) => s + x.weight, 0) / 90))));
  const fine = [];
  if (me.hours) fine.push('Hours are listed on Google');
  if (me.photos >= 10) fine.push('Plenty of photos');
  if (me.rating >= 4.5) fine.push('Rating of ' + me.rating.toFixed(1));
  if (site.ok && site.mobile) fine.push('Website works on phones');
  if (site.ok && site.tapToCall) fine.push('Tap-to-call on the website');
  return { found: true, at: new Date(now).toISOString(), business: me, rivals, site, findings: f, fine, score, grade: gradeOf(score), areas: gradeAreas(f) };
}

// ---------- endpoints ----------
export async function handleAudit(req, env, url, h) {
  const path = url.pathname;
  if (path === '/audit/tool') return new Response(TOOL_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
  if (path === '/audit/letter') return letterRoute(req, env, url, h);
  if (req.method !== 'POST') return h.json({ ok: false, error: 'POST only' }, 405);
  let b = {};
  try { b = await req.json(); } catch (e) { return h.json({ ok: false, error: 'Bad request' }, 400); }
  const q = String(b.q || '').trim().slice(0, 120), town = String(b.town || '').trim().slice(0, 80);
  if (q.length < 2) return h.json({ ok: false, error: 'Type the business name.' }, 400);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, q TEXT, town TEXT, kind TEXT, ip_hash TEXT, score INTEGER, data TEXT)').run();

  if (path === '/audit/run') {
    if (!env.LEADS_KEY || !(await h.sameKey(req.headers.get('x-key') || '', env.LEADS_KEY))) return h.json({ ok: false, error: 'Wrong key.' }, 403);
    try {
      const a = await runAudit(env, q, town);
      // Only our own score is kept; the Google details in the audit are shown and sent, never stored (Google's terms).
      if (a.found) await env.DB.prepare('INSERT INTO audits (at, q, town, kind, score, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(a.at, q, town, 'full', a.score, JSON.stringify({ score: a.score, grade: a.grade })).run();
      return h.json({ ok: true, audit: a }, 200);
    } catch (e) { return h.json({ ok: false, error: String((e && e.message) || e) }, 502); }
  }
  if (path === '/audit/score') {
    const ip = await h.ipHash(req, env);
    const hour = new Date(Date.now() - 3600000).toISOString(), day = new Date(Date.now() - 86400000).toISOString();
    const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM audits WHERE kind = 'score' AND ip_hash = ?1 AND at > ?2").bind(ip, hour).first();
    if (mine && mine.n >= PUBLIC_PER_HOUR) return h.json({ ok: false, error: 'You have checked a few already. Try again in an hour, or ask for the free audit below.' }, 429);
    const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM audits WHERE kind = 'score' AND at > ?1").bind(day).first();
    if (all && all.n >= PUBLIC_PER_DAY) return h.json({ ok: false, error: 'The checker is busy today. Ask for the free audit below and we will send it.' }, 429);
    try {
      const a = await runAudit(env, q, town);
      await env.DB.prepare('INSERT INTO audits (at, q, town, kind, ip_hash, score, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(new Date().toISOString(), q, town, 'score', ip, a.found ? a.score : null, a.found ? JSON.stringify({ score: a.score, grade: a.grade }) : '{}').run();
      if (!a.found) return h.json({ ok: true, found: false }, 200);
      return h.json({ ok: true, found: true, name: a.business.name, address: a.business.address, rating: a.business.rating, reviews: a.business.reviews,
        score: a.score, grade: a.grade, areas: a.areas.map(x => ({ label: x.label, grade: x.grade })), top: a.findings.slice(0, 3).map(x => ({ title: x.title, saw: x.saw })), more: Math.max(0, a.findings.length - 3) }, 200);
    } catch (e) { return h.json({ ok: false, error: 'The checker is not available right now. Ask for the free audit below.' }, 503); }
  }
  return h.json({ ok: false, error: 'Not found' }, 404);
}

// The grade letter (letter.js): GET with the ops board token for one letter on a phone; POST with the key for up to ten.
async function letterRoute(req, env, url, h) {
  const L = await import('./letter.js');
  const page = html => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, q TEXT, town TEXT, kind TEXT, ip_hash TEXT, score INTEGER, data TEXT)').run();
  if (req.method === 'GET') {
    const ok = await (await import('./opsboard.js')).boardOk(env, url.searchParams.get('t') || '').catch(() => false);
    if (!ok) return h.json({ ok: false, error: 'Open this from the ops board link.' }, 403);
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120), town = String(url.searchParams.get('town') || '').trim().slice(0, 80);
    if (q.length < 2) return h.json({ ok: false, error: 'Add ?q=business name&town=town to the link.' }, 400);
    const r = await L.buildLetters(env, [{ q, town }], { offer: url.searchParams.get('offer'), phone: url.searchParams.get('phone') }, runAudit);
    if (!r.letters.length) return h.json({ ok: false, error: 'Google did not find ' + q + (town ? ' in ' + town : '') + '. Try the exact name and town.' }, 404);
    return page(L.letterPage(r.letters, r.missed));
  }
  if (req.method !== 'POST') return h.json({ ok: false, error: 'GET or POST only' }, 405);
  if (!env.LEADS_KEY || !(await h.sameKey(req.headers.get('x-key') || '', env.LEADS_KEY))) return h.json({ ok: false, error: 'Wrong key.' }, 403);
  let b = {}; try { b = await req.json(); } catch (e) { return h.json({ ok: false, error: 'Bad request' }, 400); }
  const items = Array.isArray(b.items) ? b.items.map(x => ({ q: String((x && x.q) || '').trim().slice(0, 120), town: String((x && x.town) || '').trim().slice(0, 80) })).filter(x => x.q.length >= 2) : L.parseLines(b.lines);
  if (!items.length) return h.json({ ok: false, error: 'Type at least one business name.' }, 400);
  if (!env.PLACES_KEY) return h.json({ ok: false, error: 'The Google key is not set up yet.' }, 503);
  const r = await L.buildLetters(env, items.slice(0, L.MAX_LETTERS), { offer: b.offer, phone: b.phone }, runAudit);
  if (!r.letters.length) return h.json({ ok: false, error: 'Google did not find ' + (r.missed.join(', ') || 'those businesses') + '. Try the exact names and towns.', missed: r.missed }, 404);
  return h.json({ ok: true, html: L.letterPage(r.letters, r.missed), texts: r.texts, missed: r.missed, count: r.letters.length }, 200);
}

// Chris's audit page: look a business up and print a one-page audit in the website's style.
const TOOL_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit · Always Open</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,500..900&family=Instrument+Sans:wght@400;600;700&family=DM+Mono:wght@500&display=swap">
<style>
:root{--paper:#F5F4F0;--card:#fff;--ink:#171B26;--slate:#586075;--line:#DCDAD3;--red:#D92D20;--ok:#1C6B54;--night:#0F131B;--night2:#171D2C;--glow:#FF6A5E;
--display:"Archivo","Arial Narrow",Arial,sans-serif;--body:"Instrument Sans",system-ui,sans-serif;--mono:"DM Mono",ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--body)}
.bar{background:radial-gradient(600px 300px at 90% 0,rgba(217,45,32,.3),transparent 60%),linear-gradient(165deg,var(--night2),var(--night));color:#ECEEF3;padding:18px max(16px,env(safe-area-inset-left))}
.bar .in,.wrap{max-width:860px;margin:0 auto}
.bar h1{font:850 1.6rem/1 var(--display);font-stretch:92%;margin:0 0 12px}
form{display:grid;grid-template-columns:2fr 1.3fr auto;gap:10px}
input{font:inherit;padding:12px;border-radius:11px;border:1.5px solid #262E40;background:#0F131B;color:#ECEEF3;min-width:0}
button{font:700 16px var(--body);padding:12px 18px;border-radius:11px;border:0;background:var(--red);color:#fff;cursor:pointer;box-shadow:0 0 18px rgba(217,45,32,.45)}
button.line{background:transparent;color:var(--ink);border:2px solid var(--ink);box-shadow:none}
.msg{color:#A3ACBF;margin-top:10px;min-height:1.5em}
.wrap{padding:24px 16px 60px}
.doc{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px;display:grid;gap:18px}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}
.top h2{font:850 2rem/1 var(--display);font-stretch:92%;margin:0}
.mono{font:500 12px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--slate)}
.score{border:3px solid var(--red);border-radius:16px;padding:10px 18px;text-align:center;color:var(--red);box-shadow:0 0 16px rgba(217,45,32,.25)}
.score b{display:block;font:850 2.6rem/1 var(--display)}
.g-A,.g-B{--gc:#1C6B54}.g-C{--gc:#B7791F}.g-D,.g-F{--gc:#D92D20}
.score.g{border-color:var(--gc);color:var(--gc);box-shadow:none}
.grades{display:flex;gap:10px;flex-wrap:wrap}.gr{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:12px;padding:8px 14px 8px 10px;font-weight:600}.gr i{font:850 1.5rem/1 var(--display);font-style:normal;color:var(--gc);min-width:1.1em;text-align:center}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}th{font:500 12px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--slate)}
.me td{font-weight:700}
.f{display:grid;gap:4px;padding:12px 14px;border-left:4px solid var(--red);background:#FBF4F2;border-radius:0 10px 10px 0}
.f b{font-size:1.05rem}.f .fix{color:var(--ok);font-weight:600}
.fine{color:var(--ok)}
h3{font:800 1.2rem var(--display);margin:0}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.lt{margin-top:12px}.lt summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700}.ltg{display:grid;gap:10px;max-width:640px}.ltg label{display:grid;gap:6px;color:#C9D0DC;font-size:14px}
textarea{font:inherit;padding:12px;border-radius:11px;border:1.5px solid #262E40;background:#0F131B;color:#ECEEF3;resize:vertical}
.lf{width:100%;height:80vh;border:1px solid var(--line);border-radius:12px;background:#fff;margin-top:12px}
@media (max-width:640px){form{grid-template-columns:1fr}.doc{padding:18px}}
@media print{.bar,.actions{display:none}body{background:#fff}.wrap{padding:0}.doc{border:0}}
</style></head><body>
<div class="bar"><div class="in"><h1>One-click audit</h1>
<form id="f"><input id="q" placeholder="Business name" required autocomplete="off"><input id="town" placeholder="Town, state"><button>Run audit</button></form>
<div class="msg" id="msg"></div>
<details class="lt"><summary>Grade letters to print</summary><div class="ltg">
<label>One business per line: name, town<textarea id="lines" rows="5" placeholder="Sinclair Plumbing, Eatonton&#10;Lane Electric, Eatonton"></textarea></label>
<label>The offer on the letter<input id="offer" placeholder="Founding member: Starter at $149 a month, held for a year, starting the day you say yes."></label>
<label>Your phone on the letter (optional)<input id="lphone" inputmode="tel" placeholder="Leave empty to use email"></label>
<button type="button" id="mk">Make letters</button></div></details></div></div>
<div class="wrap"><div id="out"></div></div>
<script>
var K='ao_audit_key';function key(){var k='';try{k=localStorage.getItem(K)||''}catch(e){}if(!k){k=prompt('Your Always Open key (the same one HQ uses):')||'';try{localStorage.setItem(K,k)}catch(e){}}return k}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var m=document.getElementById('msg');m.textContent='Looking it up on Google and checking the website...';
fetch('/audit/run',{method:'POST',headers:{'content-type':'application/json','x-key':key()},body:JSON.stringify({q:document.getElementById('q').value,town:document.getElementById('town').value})})
.then(function(r){return r.json()}).then(function(d){if(!d.ok){m.textContent=d.error||'That did not work.';if(/key/i.test(d.error||'')){try{localStorage.removeItem(K)}catch(e){}}return}
if(!d.audit.found){m.textContent='Google did not find that business. Try the exact name and town.';return}m.textContent='';draw(d.audit)}).catch(function(){m.textContent='No connection.'})});
function draw(a){var b=a.business,date=new Date(a.at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
var rows='<tr class="me"><td>'+esc(b.name)+'</td><td>'+(b.rating?b.rating.toFixed(1):'none')+'</td><td>'+b.reviews+'</td></tr>'+a.rivals.map(function(r){return'<tr><td>'+esc(r.name)+'</td><td>'+(r.rating?r.rating.toFixed(1):'none')+'</td><td>'+r.reviews+'</td></tr>'}).join('');
var f=a.findings.map(function(x){return'<div class="f"><b>'+esc(x.title)+'</b><span>'+esc(x.saw)+'</span><span class="fix">'+esc(x.fix)+'</span></div>'}).join('')||'<p>Nothing major. This business is in good shape.</p>';
document.getElementById('out').innerHTML='<div class="doc"><div class="top"><div><div class="mono">Free audit · '+esc(date)+'</div><h2>'+esc(b.name)+'</h2><div>'+esc(b.address)+(b.type?' · '+esc(b.type):'')+'</div></div><div class="score g g-'+(a.grade||'')+'"><span class="mono">Grade</span><b>'+esc(a.grade||'')+'</b>'+a.score+' out of 100</div></div>'+
(a.areas&&a.areas.length?'<div class="grades">'+a.areas.map(function(x){return'<span class="gr g-'+esc(x.grade)+'"><i>'+esc(x.grade)+'</i>'+esc(x.label)+'</span>'}).join('')+'</div>':'')+
'<div><h3>You and the busiest nearby competitors</h3><table><tr><th>Business</th><th>Rating</th><th>Reviews</th></tr>'+rows+'</table></div>'+
'<div style="display:grid;gap:10px"><h3>What we found</h3>'+f+'</div>'+
(a.fine.length?'<div><h3>Checked and fine</h3><p class="fine">'+a.fine.map(esc).join(' · ')+'</p></div>':'')+
'<div><h3>What Always Open does</h3><p>Every review answered, your Google profile kept current, missed calls handled by Max, follow-ups on quotes and invoices, and a one-page report each month. Try it for a month; if it is not worth it, you do not pay. alwaysopenoffice.com · (706) 460-2226</p></div>'+
'<div class="actions"><button onclick="print()">Save as PDF</button><button class="line" onclick="copyText()">Copy as text</button><button class="line" onclick="oneLetter()">Make the letter</button></div></div>';window.__a=a}
function copyText(){var a=window.__a,b=a.business,t='Free audit for '+b.name+' (grade '+(a.grade||'')+', score '+a.score+'/100'+(a.areas?'; '+a.areas.map(function(x){return x.label+' '+x.grade}).join(', '):'')+')\\n\\n'+a.findings.map(function(x,i){return(i+1)+'. '+x.title+': '+x.saw+' '+x.fix}).join('\\n')+'\\n\\nAlways Open · alwaysopenoffice.com · (706) 460-2226';navigator.clipboard.writeText(t).then(function(){document.getElementById('msg').textContent='Copied.'})}
var OF='ao_letter_offer',PH='ao_letter_phone';
function getS(k){try{return localStorage.getItem(k)||''}catch(e){return ''}}function setS(k,v){try{localStorage.setItem(k,v)}catch(e){}}
document.getElementById('offer').value=getS(OF);document.getElementById('lphone').value=getS(PH);
function letters(body){var m=document.getElementById('msg'),of=document.getElementById('offer').value.trim(),ph=document.getElementById('lphone').value.trim();setS(OF,of);setS(PH,ph);body.offer=of;body.phone=ph;
m.textContent='Looking each one up on Google and writing the letters. About ten seconds a business...';
fetch('/audit/letter',{method:'POST',headers:{'content-type':'application/json','x-key':key()},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(d){
if(!d.ok){m.textContent=d.error||'That did not work.';if(/key/i.test(d.error||'')){try{localStorage.removeItem(K)}catch(e){}}return}
m.textContent=(d.count===1?'One letter is ready.':d.count+' letters are ready, one per page.')+(d.missed&&d.missed.length?' Google did not find: '+d.missed.join(', ')+'.':'');showLetters(d)}).catch(function(){m.textContent='No connection.'})}
function showLetters(d){var out=document.getElementById('out');out.innerHTML='<div class="actions"><button type="button" id="pr">Print or save PDF</button><button type="button" class="line" id="ct">Copy the text versions</button></div><iframe class="lf" id="lf" title="Grade letters"></iframe>';
var f=document.getElementById('lf');f.srcdoc=d.html;document.getElementById('pr').onclick=function(){f.contentWindow.focus();f.contentWindow.print()};
document.getElementById('ct').onclick=function(){var t=(d.texts||[]).map(function(x){return x.name+'\\n'+x.text}).join('\\n\\n');navigator.clipboard.writeText(t).then(function(){document.getElementById('msg').textContent='Copied. Paste them into a text or email.'},function(){document.getElementById('msg').textContent=t})}}
document.getElementById('mk').addEventListener('click',function(){var t=document.getElementById('lines').value;if(t.trim().length<2){document.getElementById('msg').textContent='Type at least one business: name, town.';return}letters({lines:t})});
function oneLetter(){letters({items:[{q:document.getElementById('q').value,town:document.getElementById('town').value}]})}
</script></body></html>`;
