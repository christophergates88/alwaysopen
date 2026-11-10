// The phone version of the public site. Run from the repo root: node tools/phone.mjs
// The site's generators, in order (each one safe to rerun; tools/industry.py is retired): node tools/phone.mjs,
// python3 tools/marinas.py, node tools/sitefeatures.mjs, node tools/siteclock.mjs, node tools/sitetap.mjs, then node tools/phonecheck.mjs.
// Writes into public/index.html and the industry pages:
//   - the "Tap to try it" band under the hero: playable "Only here" cards (the feature wall and clock band inside it are kept)
//   - the phone kit before </body>: folded sections, swipeable plans, the grade form, and the small fixes for phones
// Everything is between <!--ao:...--> markers, so running it twice changes nothing. Desktop layouts are not touched:
// all of it shows only at 760 px wide and under.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, FOLDS } from './phone-data.mjs';
import { ES_HOME, ES_DOES, esDoesFor, esTrade, esFront, ES_LINE, NAV_ES } from './phone-es.mjs';
import { TAP_FOLD } from './sitetap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- the cards ----------
function line(l) {
  const [k, a, b, c, d] = l;
  if (k === 'note') return '<div class="aos-note' + (d ? ' ' + d : '') + '"><small>' + esc(a) + '</small><b>' + esc(b) + '</b>' + (c ? '<span>' + esc(c) + '</span>' : '') + '</div>';
  if (k === 'draft') return '<div class="aos-b draft"><small>Your reply</small>' + esc(a) + '</div>';
  if (k === 'ai') return '<div class="aos-b ai"><small>Assistant</small>' + esc(a) + '</div>';
  return '<div class="aos-b ' + k + '">' + esc(a) + '</div>';
}
function card(c, i, n) {
  const tagCls = /Pro/.test(c.tag) ? 'p' : /Growth/.test(c.tag) ? 'g' : 'e';
  return '<article class="aos-card" id="aos-' + c.key + '" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + n + ': ' + esc(c.title) + '">' +
    '<div class="aos-top"><h3>' + esc(c.title) + '</h3><span class="aos-tag ' + tagCls + '">' + esc(c.tag) + '</span></div>' +
    '<div class="aos-scn" aria-live="polite">' + c.intro.map(line).join('') +
      c.choices.map((ch, j) => '<div class="aos-path" data-p="' + j + '"' + (j ? ' hidden' : '') + '>' + ch.then.map(line).join('') + '</div>').join('') +
      (c.carrier ? c.carrier.choices.map((ch, j) => '<div class="aos-path aos-alt" data-p="' + j + '" hidden>' + ch.then.map(line).join('') + '</div>').join('') : '') +
    '</div>' +
    '<div class="aos-ch" role="group" aria-label="What happens next">' + c.choices.map((ch, j) => '<button type="button" data-p="' + j + '" aria-pressed="false">' + esc(ch.label) + '</button>').join('') + '</div>' +
    '<p class="aos-why">' + esc(c.why) + (c.call ? ' <a href="tel:+17064602226">Call the real Max</a>' : '') + '</p>' +
    (c.carrier ? '<p class="aos-why aos-alt" hidden>' + esc(c.carrier.why) + '</p>' : '') +
    '</article>';
}
const CHIPS = [
  ['Compliance Guard', 'Every word is checked before it goes out in your name, so insurance agencies and practices can use us too.'],
  ['The Always Open map', 'Every Always Open business on one map, closest first. Nobody pays to be on it.'],
  ['Spanish on every plan', 'Max and every reply answer in Spanish, with no add-on.']
];
const TRADES = [['plumbing', 'Plumber'], ['hvac', 'Heating and air'], ['builders', 'Builder'], ['auto-repair', 'Auto repair'], ['marine', 'Docks and marine'], ['salons', 'Salon or gym'], ['restaurants', 'Restaurant or shop'], ['dental', 'Dental'], ['insurance', 'Insurance']];
// The cards lead with what no answering service does (an open day filled, a check-in, a hand-off); Max answering
// comes after, so a phone visitor's first card is never "we pick up the phone".
const LEAD = ['fill', 'radar', 'guard', 'check', 'handoff', 'max', 'cb', 'storm', 'ai'];
const rank = k => { const i = LEAD.indexOf(k); return i < 0 ? LEAD.length : i; };
function set(key, p0, on) {
  const p = Object.assign({}, p0, { cards: p0.cards.slice().sort((a, b) => rank(a.key) - rank(b.key)) });
  const n = p.cards.length;
  return '<div class="aos-set" data-set="' + key + '"' + (on ? '' : ' hidden') + '>' +
    (p.modes ? '<div class="aos-modes" role="group" aria-label="Kind of agency">' + p.modes.map((m, i) => '<button type="button" data-mode="' + i + '" aria-pressed="' + (i ? 'false' : 'true') + '">' + esc(m) + '</button>').join('') + '</div>' : '') +
    '<div class="aos-rail" data-swipe tabindex="0" role="region" aria-label="Things to try, ' + n + ' cards">' + p.cards.map((c, i) => card(c, i, n)).join('') + '</div></div>';
}
// The "Tap to try it" band. The feature wall (sitefeatures.mjs) and Max's clock band (siteclock.mjs) live inside this
// block, so a rerun carries them over unchanged (keep.wall, keep.clock) instead of wiping them. The grade check that
// used to open the band is gone since Nov 4, 2026: the free-audit section's #check is the one place left.
function front(key, p, keep) {
  keep = keep || {};
  const heading = p.heading || ('What nobody else does for ' + p.plural + '. Tap to try it.');
  const sub = p.sub || 'Each card plays out a call, a text or a post, start to finish. Tap a choice and watch what happens.';
  const home = key === 'index';
  return '<!--ao:front-->\n<section class="aos band" id="go" data-label="Try it" aria-labelledby="aos-h">\n' + (keep.wall ? keep.wall.replace(/\n*$/, '\n\n') : '') +
    '<div class="aos-head"><h2 id="aos-h">' + esc(heading) + '</h2><p>' + esc(sub) + '</p>' +
      (home ? '<div class="aos-pick" role="group" aria-label="Your kind of business"><span>Show it for a</span>' + TRADES.map(([k, l]) => '<button type="button" data-pick="' + k + '" aria-pressed="' + (k === 'plumbing' ? 'true' : 'false') + '">' + esc(l) + '</button>').join('') + '</div>' : '') + '</div>\n' +
    (home ? TRADES.map(([k]) => set(k, PAGES[k], k === 'plumbing')).join('\n') : set(key, p, true)) + '\n' +
    '<p class="aos-sample">Examples. On your line, Max answers with your business name.</p>\n' +
    '</section>\n' + (keep.clock ? '\n' + keep.clock.replace(/\n*$/, '\n\n') : '') + '<!--/ao:front-->';
}

// ---------- the styles, shown only on phones ----------
const CSS = `
.ao-foldbar,.ao-dots,.lede-ph,.ph-only,.ao-plantabs,.ao-moreb,.reglink{display:none}
/* the playable cards and the instant grade, on every screen size */
/* the playable cards */
.aos-head{padding-top:40px}
.aos-head h2{font-size:1.65rem;line-height:1.08;color:#ECEEF3}
.aos-head p{margin-top:8px;color:#A3ACBF;font-size:15px}
.aos-rail{display:grid;grid-auto-flow:column;grid-auto-columns:88%;gap:12px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;margin:16px calc(-1*max(16px,env(safe-area-inset-left,0px))) 0;padding:2px max(16px,env(safe-area-inset-left,0px)) 4px;scroll-padding-inline:max(16px,env(safe-area-inset-left,0px))}
.aos-rail::-webkit-scrollbar{display:none}
.aos-rail:focus-visible{outline:3px solid #FF6A5E;outline-offset:2px}
.aos-card{scroll-snap-align:start;display:flex;flex-direction:column;gap:10px;background:#171C27;border:1px solid #262E40;border-radius:18px;padding:14px;min-width:0}
.aos-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.aos-top h3{font-size:1.08rem;color:#ECEEF3}
.aos-tag{flex:none;font:600 14px var(--body);padding:3px 9px;border-radius:999px;border:1px solid #3A4357;color:#C9D0DC}
.aos-tag.p{border-color:rgba(255,106,94,.6);color:#FF8C82}
.aos-tag.g{border-color:rgba(92,201,164,.55);color:#7FD8B9}
.aos-scn{display:flex;flex-direction:column;justify-content:flex-end;gap:7px;background:#0B0F16;border:1px solid #1F2636;border-radius:14px;padding:12px 10px;min-height:250px}
.js .aos-scn{height:236px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;justify-content:flex-start;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 22px);mask-image:linear-gradient(to bottom,transparent 0,#000 22px)}
.aos-scn::-webkit-scrollbar{display:none}
.aos-scn>:first-child{margin-top:auto}
.aos-path{display:flex;flex-direction:column;gap:7px}
.aos-live .aos-path{display:none}
.aos-live .aos-path.on{display:flex}
.aos-wait{display:none!important}
.aos-b{max-width:86%;font-size:15px;line-height:1.38;padding:8px 12px;border-radius:16px}
.aos-b.in{align-self:flex-start;background:#252C3D;color:#ECEEF3;border-bottom-left-radius:5px}
.aos-b.out{align-self:flex-end;background:#3A1F22;color:#FFE5E1;border:1px solid rgba(255,106,94,.4);border-bottom-right-radius:5px}
.aos-b.ai{align-self:flex-end;background:#1D2B40;color:#DCE8FA;border:1px solid #2F4566;border-bottom-right-radius:5px}
.aos-b.draft{align-self:stretch;max-width:none;background:#1A2130;color:#ECEEF3;border:1px dashed #3A4357}
.aos-b small{display:block;font:500 12px var(--mono);letter-spacing:.06em;color:#9AA6BC;margin-bottom:2px}
.aos-b.sys{align-self:center;max-width:none;padding:2px 6px;font:500 13px var(--mono);letter-spacing:.02em;color:#9AA6BC;text-align:center}
.aos-note{align-self:stretch;background:#F7F6F2;color:#171B26;border-radius:13px;padding:9px 12px;display:grid;gap:1px;box-shadow:0 6px 18px -10px rgba(0,0,0,.8)}
.aos-note small{font:600 12.5px var(--body);color:#5B6475}
.aos-note b{font-size:15px;line-height:1.3}
.aos-note span{font-size:15px;line-height:1.35;color:#3B4252}
.aos-note.hot{box-shadow:inset 4px 0 0 #D92D20,0 6px 18px -10px rgba(0,0,0,.8)}
.aos-note.hot small{color:#B42318}
.aos-note.ok{box-shadow:inset 4px 0 0 #1C6B54,0 6px 18px -10px rgba(0,0,0,.8)}
.aos-ch{display:none;gap:8px}
.js .aos-ch{display:flex}
.aos-ch button{flex:1;min-height:46px;padding:8px 10px;border-radius:999px;border:1.5px solid rgba(255,106,94,.75);background:transparent;color:#ECEEF3;font:600 15px var(--body);cursor:pointer;line-height:1.15}
.aos-ch button[aria-pressed="true"]{background:#FF6A5E;border-color:#FF6A5E;color:#1A0605}
.aos-ch button:focus-visible{outline:3px solid #ECEEF3;outline-offset:2px}
.aos-why{font-size:15px;line-height:1.45;color:#A3ACBF}
.aos-why a{color:#FF8C82;font-weight:700;white-space:nowrap;text-underline-offset:3px}
@media (prefers-reduced-motion:no-preference){.aos-live .aos-path.on>*{animation:aosIn .3s ease-out both}@keyframes aosIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
.ao-dots{display:flex;justify-content:center;gap:0;margin-top:6px}
.ao-dots button{width:44px;height:44px;border:0;background:none;padding:0;cursor:pointer;display:grid;place-items:center}
.ao-dots button::after{content:"";width:8px;height:8px;border-radius:99px;background:var(--dot,#4A5368);transition:width .2s}
.ao-dots button[aria-current="true"]::after{width:20px;background:var(--dot-on,#FF6A5E)}
.aos .ao-dots{--dot:#4A5368;--dot-on:#FF6A5E}
.aos .aos-also{margin-top:24px;border-top:1px solid #262E40}
.aos-also>p{font:500 13px var(--mono);letter-spacing:.08em;color:#9AA6BC;padding:14px 0 4px}
.aos .aos-also details{background:none;border:0;border-bottom:1px solid #262E40;border-radius:0;box-shadow:none;padding:0;margin:0}
.aos .aos-also summary{min-height:48px;display:flex;align-items:center;padding:0;font:600 16px var(--body);cursor:pointer;list-style:none;color:#ECEEF3;background:none}
.aos .aos-also summary::-webkit-details-marker{display:none}
.aos .aos-also summary::after{content:"+";margin-left:auto;font:400 22px var(--body);color:#FF8C82}
.aos .aos-also details[open] summary::after{content:"–"}
.aos .aos-also details p{padding:0 0 14px;margin:0;color:#A3ACBF;font-size:15px}
.aos-sample{margin-top:10px;font-size:15px;color:#8892A6}
/* pick a trade (home page) */
.aos-pick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
.aos-pick span{font-size:15px;color:#A3ACBF;margin-right:2px}
.aos-pick button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #3A4357;background:transparent;color:#ECEEF3;font:600 15px var(--body);cursor:pointer}
.aos-pick button[aria-pressed="true"]{background:#FF6A5E;border-color:#FF6A5E;color:#1A0605}
.aos-pick button:focus-visible{outline:3px solid #ECEEF3;outline-offset:2px}
.aos-set[hidden]{display:none!important}
.aos-set .aos-modes{margin:16px 0 0}
/* independent or with a carrier */
.aos-modes{display:inline-flex;margin-top:14px;padding:3px;border-radius:999px;background:#0B0F16;border:1px solid #262E40}
.aos-modes button{min-height:44px;padding:0 18px;border:0;border-radius:999px;background:transparent;color:#C9D0DC;font:600 15px var(--body);cursor:pointer}
.aos-modes button[aria-pressed="true"]{background:#FF6A5E;color:#1A0605}
.aos-modes button:focus-visible{outline:3px solid #ECEEF3;outline-offset:2px}
.aos-carrier .aos-why:not(.aos-alt),.aos:not(.aos-carrier) .aos-alt{display:none!important}
.aos-carrier .aos-why.aos-alt{display:block!important}
/* the instant grade */
.aos-deck{display:grid;gap:0}
.aog{margin-top:14px;padding:20px 16px;border-radius:18px;background:#171C27;border:1px solid rgba(255,106,94,.45);box-shadow:0 0 0 1px rgba(255,106,94,.12),0 0 28px -8px rgba(255,90,77,.45)}
.aog h3{font-size:1.4rem;line-height:1.1;color:#ECEEF3}
.aog>p{margin-top:6px;color:#A3ACBF;font-size:15px}
.aog form{display:grid;gap:6px;margin-top:14px}
.aog label{font-weight:600;font-size:15px;color:#C9D0DC;margin-top:4px}
.aog input{font:16px var(--body);min-height:50px;padding:10px 14px;border-radius:12px;border:1.5px solid #3A4357;background:#0B0F16;color:#ECEEF3;width:100%}
.aog input::placeholder{color:#6F7A90}
.aog input:focus-visible{outline:3px solid #FF6A5E;outline-offset:1px}
.aog-go{margin-top:10px;min-height:52px;border:0;border-radius:12px;background:#FF5A4D;color:#1A0605;font:700 17px var(--body);cursor:pointer}
.aog-go:disabled{opacity:.7}
.aog-out:empty{display:none}
.aog-out{margin-top:12px;display:grid;gap:10px;color:#ECEEF3;font-size:15px}
.aog-msg{color:#A3ACBF}
.aog-src{color:#8F98AB;font-size:13px}
.aog-res{display:flex;gap:14px;align-items:center}
.aog-gl{flex:none;width:68px;height:68px;border-radius:14px;display:grid;place-items:center;font:850 2.4rem/1 var(--display);background:#252C3D}
.aog-gl.A,.aog-gl.B{background:#173229;color:#7FD8B9}.aog-gl.C{background:#3A2E12;color:#F2C46B}.aog-gl.D,.aog-gl.F{background:#3A1F22;color:#FF8C82}
.aog-res div b{display:block;font-size:16px}.aog-res div span{display:block;color:#A3ACBF;font-size:15px}
.aog-areas{display:flex;flex-wrap:wrap;gap:6px}
.aog-areas span{padding:5px 10px;border-radius:999px;background:#252C3D;font-size:15px}
.aog-areas i{font-style:normal;font-weight:800;margin-right:5px}
.aog-find{padding-left:12px;border-left:3px solid #FF6A5E;color:#C9D0DC}
.aog-find strong{color:#ECEEF3}
.aog-full{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;background:#FF5A4D;color:#1A0605;font-weight:700;text-decoration:none}
@media (min-width:761px){
.aos{padding-block:70px 60px;color:#ECEEF3;background:linear-gradient(180deg,#0F131B 0%,#131A28 100%);border-top:1px solid rgba(255,106,94,.28);display:flex;flex-direction:column}
/* on a computer the cards come first and the grade check after them, all in the page's 1,120 px column */
.aos>*{width:100%;max-width:1120px;margin-inline:auto}.aos>.aos-deck{order:1}
.aos>.aos-head{max-width:1120px}.aos-head h2,.aos-head>p{max-width:720px}.aos-head h2{font-size:clamp(2rem,4.4vw,3rem);line-height:1.03;color:#ECEEF3}.aos-head p{margin-top:10px;color:#A3ACBF;font-size:1.1rem}
.aos-rail{display:grid;grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;margin:28px 0 0;padding:0;overflow:visible;scroll-snap-type:none}
.aos-set .aos-modes{margin-top:28px}.aos-set .aos-modes+.aos-rail{margin-top:16px}
.aos .ao-dots{display:none}
.aos-deck{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:40px;align-items:start;margin-top:40px}
.aog{margin-top:0}
.aos .aos-also{margin-top:0;border-top:0}.aos .aos-also>p{padding-top:0}
.aos .ao-foldbar{display:none}
.js .only .head,.js .only .onlygrid,.js .only .sample{display:none}
.js .only{padding-block:40px}
}

/* ===== the lower half, lit like the top, at every width (Nov 4, 2026): pricing, the three rules and the form are night
   bands with the neon sign's glow; compare, regulated and questions stay light ===== */
#pricing,#plans{background:radial-gradient(130% 55% at 50% 0%,#1C2538 0%,rgba(15,19,27,0) 70%),#0F131B;color:#ECEEF3;border-top:1px solid rgba(255,106,94,.3)}
#pricing p,#plans p,#pricing li,#plans li{color:#B9C1D0}
#pricing .eyebrow,#plans .eyebrow{color:#FF8C82}
#pricing .head p,#plans .head p,#pricing .addons-sub{color:#A3ACBF}
#pricing .plan,#plans .plan{background:#171C27;border:1px solid #2A3245;color:#ECEEF3;border-radius:20px}
#pricing .plan.feat,#plans .plan.feat{border:2px solid #FF6A5E;box-shadow:0 0 0 1px rgba(255,106,94,.22),0 0 34px -8px rgba(255,90,77,.6)}
#pricing .plan.feat::before,#plans .plan.feat::before{background:#FF5A4D;color:#1A0605;box-shadow:0 0 14px rgba(255,90,77,.6)}
#pricing .plan h3,#plans .plan h3{color:#ECEEF3;font:700 1.15rem var(--display);letter-spacing:.01em}
#pricing .plan .price b,#plans .plan .price b{color:#FFFFFF;font-size:3.3rem;letter-spacing:-.02em}
#pricing .plan .price span,#plans .plan .price span{color:#A3ACBF}
#pricing .perday,#plans .perday{color:#7FD8B9}
#pricing .plan .for,#plans .plan .for{color:#C9D0DC;font-size:1.02rem}
#pricing .plan ul,#plans .plan ul{color:#DCE1EA}
#pricing .plan li svg,#plans .plan li svg{color:#7FD8B9}
#pricing .plan li.plus,#plans .plan li.plus{color:#FF8C82}
#pricing .plan .soon,#plans .plan .soon{background:transparent;border-color:#3A4357;color:#C9D0DC}
#pricing .plan .plan-note,#plans .plan .plan-note{color:#A3ACBF;border-top-color:#3A4357}
#pricing .btn.line,#plans .btn.line{border-color:rgba(236,238,243,.55);color:#ECEEF3;background:transparent}
#pricing .btn.primary,#plans .btn.primary{background:#FF5A4D;color:#1A0605;box-shadow:0 10px 26px -10px rgba(255,90,77,.8)}
#pricing .guarantee,#plans .guarantee{background:rgba(92,201,164,.06);border:1.5px solid rgba(127,216,185,.55);border-radius:18px;padding:18px;box-shadow:inset 0 0 26px -14px rgba(92,201,164,.7)}
#pricing .guarantee b,#plans .guarantee b{display:block;color:#7FD8B9;font:850 1.7rem/1.1 var(--display)}
#pricing .guarantee p,#plans .guarantee p{color:#C9D0DC}
/* add-ons, inside the night band */
#pricing .addon{background:#171C27;border-color:#2A3245;color:#ECEEF3}
#pricing .addon h3{color:#ECEEF3}
#pricing .addon .price b{color:#FF8C82}
#pricing .addon .price span,#pricing .addon .what,#pricing .addon dd{color:#C9D0DC}
#pricing .addon dt{color:#8F98AB}
#pricing .addon p a,#pricing .addon dd a{color:#FF8C82}
#pricing .ao-addons .fine{color:#8F98AB!important}
/* compared: our answer is the one that stands out */
.tablewrap td.us{background:var(--sign-soft)!important;border-radius:10px;padding:8px 10px;margin:2px -10px}
.tablewrap td.us::before{color:var(--sign)!important;font-weight:700}
/* questions: a plus that turns to a minus, and the open one marked */
.faq details{border-radius:14px}
.faq summary{list-style:none;display:flex;align-items:center;gap:14px;font-size:1.02rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";flex:none;margin-left:auto;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--sign-soft);color:var(--sign);font:500 22px/1 var(--body)}
.faq details[open]{border-color:var(--sign);box-shadow:inset 4px 0 0 var(--sign)}
.faq details[open] summary::after{content:"–"}
/* get started: a night band, the form a lit card */
#contact{background:radial-gradient(130% 45% at 50% 0%,#1C2538 0%,rgba(15,19,27,0) 70%),#0F131B;color:#ECEEF3;border-top:1px solid rgba(255,106,94,.3)}
#contact .who .eyebrow{color:#FF8C82}
#contact .who p{color:#A3ACBF}
#contact .who .callus a{color:#FF8C82}
#contact .who .addr,#contact .who .addr *{color:#C9D0DC!important}
#contact form.lead label,#contact form.lead .optin span{color:var(--ink)}
#contact form.lead .fineprint,#contact form.lead .txtnote{color:var(--slate)}
#contact form.lead{color:var(--ink);border:1.5px solid rgba(255,106,94,.6);box-shadow:0 0 0 1px rgba(255,106,94,.2),0 0 38px -10px rgba(255,90,77,.6)}
#contact+footer{border-top:1px solid #262E40}
/* ===== open, not drawers (Nov 4, 2026): below pricing every section shows, kept short ===== */
#compare .eyebrow,#faq .eyebrow,#questions .eyebrow{color:var(--sign)}
/* add-ons: a swipe row of short lit cards in the night band */
#pricing .addon{border-radius:18px;box-shadow:0 0 0 1px rgba(255,106,94,.08),0 18px 30px -22px #000}
#pricing .addon .price b{font-size:2.1rem;text-shadow:0 0 14px rgba(255,90,77,.45)}
/* three rules: a night band of three big statements, each with a lit check */
#rules .eyebrow{color:#FF8C82}
#rules .rule,#rules .rules3>div{position:relative;background:none;border:0;border-top:1px solid #262E40;border-radius:0;padding:18px 0 16px 46px}
#rules .rule::before,#rules .rules3>div::before{content:"";position:absolute;left:0;top:18px;width:30px;height:30px;border-radius:50%;border:2px solid #FF6A5E;box-shadow:0 0 14px rgba(255,90,77,.55),inset 0 0 8px rgba(255,90,77,.3);background:center/16px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='%23FF8C82' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
#rules h3{color:#ECEEF3;font:800 1.3rem/1.15 var(--display)}
#rules .rule p,#rules .rules3 p{color:#A3ACBF;margin-top:4px}
/* regulated: one short card with the sign's red edge, the details on their own pages */

#rules{background:radial-gradient(130% 60% at 50% 0%,#1C2538 0%,rgba(15,19,27,0) 70%),#0F131B!important;color:#ECEEF3;border-top:1px solid rgba(255,106,94,.3)}
#rules h2{color:#ECEEF3}
@media (min-width:761px){
#pricing .head h2,#plans .head h2,#contact .who h2,#rules h2{color:#ECEEF3}
#pricing .plan .price b,#plans .plan .price b{font-size:3.4rem}
#pricing .guarantee,#plans .guarantee{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center;padding:20px 24px}
#pricing .guarantee b,#plans .guarantee b{font-size:1.6rem}
#pricing .ao-addons{margin-top:44px;padding-top:34px;border-top:1px solid #262E40}
#pricing .addons-h{color:#ECEEF3}
#pricing .addon{border-radius:18px;box-shadow:0 0 0 1px rgba(255,106,94,.08),0 18px 30px -22px #000}
#pricing .addon .price b{text-shadow:0 0 14px rgba(255,90,77,.45)}
#rules .rules,#rules .rules3{gap:0 36px;margin-top:28px}
#rules .rule,#rules .rules3>div{position:relative;background:none;border:0;border-top:1px solid #262E40;border-radius:0;padding:22px 0 18px 48px}
#rules .rule::before,#rules .rules3>div::before{content:"";position:absolute;left:0;top:22px;width:30px;height:30px;border-radius:50%;border:2px solid #FF6A5E;box-shadow:0 0 14px rgba(255,90,77,.55),inset 0 0 8px rgba(255,90,77,.3);background:center/16px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='%23FF8C82' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
#rules h3{color:#ECEEF3}
#rules .rule p,#rules .rules3 p{color:#A3ACBF}
.tablewrap td.us{margin:0;padding:15px 18px;border-radius:0}
.tablewrap th.us{color:var(--sign)}
#regulated .regbox{border-left:4px solid var(--sign)}
#contact .who .founding{background:#171C27;border-color:rgba(255,106,94,.6);color:#ECEEF3}
#pricing .setup,#plans .setup{border-color:#3A4357;background:#171C27;color:#C9D0DC}#pricing .setup b,#plans .setup b{color:#ECEEF3}
#contact .who .founding p{color:#A3ACBF}
}
@media (max-width:760px){
.aos-pick{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-left:calc(-1*max(16px,env(safe-area-inset-left,0px)));margin-right:calc(-1*max(16px,env(safe-area-inset-left,0px)));padding:2px max(16px,env(safe-area-inset-left,0px))}
.aos-pick::-webkit-scrollbar{display:none}
.aos-pick span,.aos-pick button{flex:none;white-space:nowrap}
/* hero: the headline, one line, two buttons */
.hero .stack,.hero .desk,.hero .hero-scene,.hero .lede,.hero .fine,.hero .onlylink,.hero .promise,.hero .day,.hero .everyone,.hero-grid>.day{display:none!important}
.hero .lede-ph{display:block;font-size:1.08rem;line-height:1.5;color:var(--night-mute);margin-top:16px;max-width:32em}
/* a trade page's headline is a whole moment, three things at once: a size that keeps it to five or six lines */
.hero p.for+h1{font-size:clamp(2.05rem,8.6vw,2.4rem);line-height:1}
/* the monthly report leads the phone hero too: compact, no floating note */
.hero .rp-wrap{padding-top:0;margin-top:22px}.hero .rp-ping{display:none}.hero .report{padding:14px 15px 12px}
.hero .rp-hero{padding:10px 0 8px}.hero .rp-hero b{font-size:2.8rem}.hero .rp-grid b{font-size:1.15rem}.hero .rp-grid div{padding:8px 10px}
.hero .rp-check{font-size:13px;padding:8px 10px}.hero .rp-hero{padding:12px 0 10px}
.hero-grid{padding-block:6px 30px!important;gap:0!important}
.hero .neon{margin-bottom:16px}
.hero .ctas{margin-top:22px!important}
.hero .ctas>a:not(.ph-only):not([href^="tel:"]):not([href*="#contact"]){display:none!important}
.hero .ctas>.ph-only,.hero .ctas>a[href*="#contact"]{display:inline-flex;width:100%}
.indlinks,#industries .sub,#contact .founding{display:none}
#industries h2{margin-bottom:16px}
.aos{display:block;color:#ECEEF3;background:linear-gradient(180deg,#0F131B 0%,#131A28 100%);padding-top:6px;padding-bottom:40px;border-top:1px solid rgba(255,106,94,.28)}
/* folded sections: a heading and one line, opened with a tap */
.js [data-fold]:not(.ao-open){padding-top:0!important;padding-bottom:0!important;border:0!important;background:var(--paper)!important;color:var(--ink)!important;box-shadow:none!important}
.js [data-fold]:not(.ao-open)>:not(.ao-foldbar){display:none!important}
.js [data-fold]+[data-fold]:not(.ao-open)>.ao-foldbar{border-top-color:var(--line)}
.ao-foldbar{display:flex;align-items:center;gap:14px;width:100%;min-height:72px;padding:16px 0;margin:0;border:0;border-top:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.ao-open>.ao-foldbar{position:sticky;top:0;z-index:41;margin-bottom:18px;border-bottom:1px solid var(--line);box-shadow:0 8px 16px -14px rgba(0,0,0,.5);color:var(--ink);background:var(--paper)}
.ao-foldbar .ao-ft{display:block;font:750 1.1rem/1.2 var(--display);font-stretch:92%}
.ao-foldbar .ao-fs{display:block;margin-top:3px;font-size:15px;line-height:1.4;color:var(--slate)}
.ao-foldbar svg{flex:none;margin-left:auto;width:22px;height:22px;color:var(--sign);transition:transform .2s}
.ao-open>.ao-foldbar svg{transform:rotate(180deg)}
.ao-foldbar:focus-visible{outline:3px solid var(--sign);outline-offset:-3px}
/* "Six things nobody else does": lit like the OPEN sign, with a neon flicker, so it gets tapped */
#only:not(.ao-open)>.ao-foldbar{margin:18px 0;padding:18px 16px;border:2px solid #FF6A5E;border-radius:16px;background:#0F131B;color:#ECEEF3;box-shadow:0 0 0 1px rgba(255,106,94,.25),0 0 22px rgba(255,90,77,.45),inset 0 0 16px rgba(255,90,77,.16)}
#only:not(.ao-open)>.ao-foldbar .ao-ft{color:#FF8C82;text-shadow:0 0 10px rgba(255,106,94,.85)}
#only:not(.ao-open)>.ao-foldbar .ao-fs{color:#C9CFDB}
#only:not(.ao-open)>.ao-foldbar svg{color:#FF8C82}
@keyframes aoSignFlick{0%,17%,21%,23%,52%,56%,100%{border-color:#FF6A5E;box-shadow:0 0 0 1px rgba(255,106,94,.25),0 0 22px rgba(255,90,77,.45),inset 0 0 16px rgba(255,90,77,.16)}19%,22%,54%{border-color:rgba(255,106,94,.3);box-shadow:none}}
@keyframes aoTextFlick{0%,17%,21%,23%,52%,56%,100%{color:#FF8C82;text-shadow:0 0 10px rgba(255,106,94,.85)}19%,22%,54%{color:rgba(255,140,130,.45);text-shadow:none}}
@media (prefers-reduced-motion:no-preference){#only:not(.ao-open)>.ao-foldbar{animation:aoSignFlick 3.8s linear infinite}#only:not(.ao-open)>.ao-foldbar .ao-ft{animation:aoTextFlick 3.8s linear infinite}}
/* plans and add-ons swipe sideways */
[data-swipe]:not(.aos-rail){display:grid!important;grid-template-columns:none!important;grid-auto-flow:column;grid-auto-columns:88%;gap:12px!important;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;margin-inline:calc(-1*max(16px,env(safe-area-inset-left,0px)));padding:6px max(16px,env(safe-area-inset-left,0px)) 6px;scroll-padding-inline:max(16px,env(safe-area-inset-left,0px));align-items:start;padding-top:16px!important}
[data-swipe]:not(.aos-rail)::-webkit-scrollbar{display:none}
[data-swipe]:not(.aos-rail)>*{scroll-snap-align:start;transform:none!important;margin:0!important;min-width:0}
/* forms that behave on a phone */
input,select,textarea{font-size:16px!important}
.lead button[type=submit]{position:sticky;bottom:12px;width:100%;min-height:52px;z-index:5}
.ao-typing .call-float{opacity:0!important;pointer-events:none!important}
/* tap targets and type */
.wordmark,.btn{min-height:44px}
footer a,.legal a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}
footer span,footer a,footer .entity{font-size:15px}
.lead label,.optin span,.optin a,.perday,.plan-note,.indtile span,.fineprint{font-size:15px}
.optin input{width:24px;height:24px}
.soon,.indtile em{font-size:12px}
.plan-note{font-size:15px!important}
.guarantee{display:block!important}.guarantee>*+*{margin-top:6px}
.lead button[type=submit]{box-shadow:0 10px 24px -10px rgba(0,0,0,.55)}
/* an open section: its bar at the very top, edge to edge, and its heading not said twice (Nov 4, 2026) */
.js [data-fold].ao-open{padding-top:0!important}
.js [data-fold].ao-open>.ao-foldbar{width:auto;margin-inline:calc(-1*max(16px,env(safe-area-inset-left,0px)));padding-inline:max(16px,env(safe-area-inset-left,0px))}
.ao-open .ao-dup{display:none!important}
/* plans: pick one, see one, so a short plan never leaves a gap under it */
.ao-plantabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:4px 0 22px;padding:4px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.ao-plantabs button{min-height:60px;border:0;border-radius:12px;background:transparent;color:var(--ink);font:700 16px/1.15 var(--body);cursor:pointer;display:grid;gap:3px;place-content:center;padding:6px 4px}
.ao-plantabs button small{font:500 14px var(--body);color:var(--slate)}
.ao-plantabs button[aria-selected="true"]{background:var(--ink);color:var(--paper)}
.ao-plantabs button[aria-selected="true"] small{color:inherit;opacity:.85}
.ao-plantabs button:focus-visible{outline:3px solid var(--sign);outline-offset:2px}
.plans.ao-tabbed{display:block;margin:0;padding:0}
.plans.ao-tabbed>.plan:not(.on){display:none}
.plans.ao-tabbed>.plan{padding:24px 18px 20px}
.plans.ao-tabbed>.plan .btn{width:100%}
.setup{display:none}
.plan li .soon{grid-column:2;justify-self:start;margin:2px 0 0}
#pricing.sec{padding-bottom:28px}
#pricing>.inner{display:flex;flex-direction:column}
#pricing>.inner>.ao-addons{order:2}
#pricing .guarantee{margin-top:18px}
/* add-ons: a short list, the details one tap away */
.addons{gap:12px;margin-top:18px}
.addon{padding:18px 16px;gap:6px;border-radius:16px}
.addon .avail{display:none}
.addon h3{font-size:1.12rem}
.addon .price b{font-size:1.7rem}
.addon .price span{font-size:15px}
.addon .what{font-size:15px;line-height:1.5}
.js .addon dl{display:none}
.js .addon.ao-more dl{display:grid}
.addon dl{grid-template-columns:1fr;gap:2px;margin-top:6px;font-size:15px}
.addon dt{padding-top:10px;font-size:12px}
.addon-act{display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap;margin-top:8px}
.addon-act .btn{margin:0}
.ao-moreb{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 2px;border:0;background:none;color:var(--ink);font:600 15px var(--body);cursor:pointer;text-decoration:underline;text-underline-offset:4px}
.ao-moreb:focus-visible{outline:3px solid var(--sign);outline-offset:2px}
.ao-addons .addons-head{margin-top:0}
.ao-addons .fine{font:400 15px/1.5 var(--body)!important;letter-spacing:0!important;text-transform:none!important}
/* compared: one card per question, no sideways table */
.tablewrap{overflow:visible;border:0;background:none;border-radius:0}
.tablewrap table{min-width:0}
.tablewrap table,.tablewrap tbody,.tablewrap tr{display:block;width:100%}
.tablewrap thead{display:none}
.tablewrap tr{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px 10px;margin-bottom:10px}
.tablewrap td{display:grid;grid-template-columns:40% 1fr;gap:12px;padding:6px 0;border:0;background:none!important;font-size:15px;line-height:1.4}
.tablewrap td:first-child{display:block;font:700 1.05rem/1.25 var(--display);padding:0 0 6px}
.tablewrap td[data-th]::before{content:attr(data-th);color:var(--slate);font-size:14px}
.tablewrap td.us{font-weight:700}
/* regulated: the short version here, the whole thing on its own page */
#regulated .cg-grid,#regulated .incl-wrap>h3,#regulated .incl{display:none}
#regulated .regbox{gap:22px;padding:22px 18px}
#regulated .cg{margin:0;padding:20px 16px}
#regulated .reglink{display:block;margin:0;font-size:15px;color:var(--slate)}
#regulated .reglink a{color:var(--sign);font-weight:700;text-underline-offset:3px}
#plans.ao-open>.ao-foldbar,#pricing .ao-open>.ao-foldbar{background:#0F131B;color:#ECEEF3;border-color:#262E40;box-shadow:0 10px 18px -14px #000}
#plans .ao-foldbar .ao-fs,#pricing .ao-foldbar .ao-fs{color:#A3ACBF}
#pricing .head h2,#plans .head h2{color:#ECEEF3;font-size:clamp(1.9rem,8.4vw,2.3rem);line-height:1.04}
.ao-plantabs{background:#0B0F16;border-color:#262E40}
.ao-plantabs button{color:#C9D0DC}
.ao-plantabs button small{color:#8F98AB}
.ao-plantabs button[aria-selected="true"]{background:#FF5A4D;color:#1A0605;box-shadow:0 0 20px -4px rgba(255,90,77,.75)}
.ao-plantabs button[aria-selected="true"] small{color:#1A0605;opacity:.75}
.ao-plantabs button:focus-visible{outline-color:#ECEEF3}
.js #pricing [data-fold]:not(.ao-open){background:transparent!important;color:inherit!important}
#pricing .ao-moreb{color:#ECEEF3}
#contact .who h2{color:#ECEEF3;font-size:clamp(1.9rem,8.4vw,2.3rem);line-height:1.04}
#compare .head h2,#faq .head h2,#questions h2,#regulated h2{font-size:clamp(1.9rem,8.4vw,2.3rem);line-height:1.04}
#compare,#faq,#questions{padding-block:46px 40px!important}
#pricing .ao-addons{margin-top:34px;padding-top:28px;border-top:1px solid #262E40}
#pricing .addons-h{color:#ECEEF3;font-size:1.75rem;line-height:1.08}
#pricing .addons-sub{display:none}
#pricing .addons[data-swipe]{align-items:start;grid-auto-columns:82%}
#pricing .addon .what{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
#pricing .addon.ao-more .what{display:block}
#pricing .ao-dots{--dot:#4A5368;--dot-on:#FF6A5E}
#rules{background:radial-gradient(130% 60% at 50% 0%,#1C2538 0%,rgba(15,19,27,0) 70%),#0F131B!important;color:#ECEEF3;padding-block:48px 40px!important;border-top:1px solid rgba(255,106,94,.3)}
#rules h2{color:#ECEEF3;font-size:clamp(2rem,9vw,2.5rem);line-height:1.02}
#rules .rules,#rules .rules3{display:grid;grid-template-columns:1fr;gap:0;margin-top:20px}
#regulated{padding-block:40px!important}
#regulated .regbox{gap:14px;padding:22px 18px;border-left:4px solid var(--sign)}
#regulated .regbox>.rules,#regulated .cg{display:none}
#regulated .head p{display:none}
#regulated .reglink{font-size:16px;line-height:1.5}
}`;

// ---------- the script ----------
const JS = `(function () {
  var d = document, root = d.documentElement;
  root.classList.add('js');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Folded sections: the heading and one line, opened with a tap. Links into a folded section open it first.
  function bar(s) { return s.querySelector(':scope > .ao-foldbar'); }
  function setFold(s, open) {
    s.classList.toggle('ao-open', open);
    var b = bar(s); if (b) { b.setAttribute('aria-expanded', String(open)); b.querySelector('.ao-fh').textContent = open ? 'Close' : 'Open'; }
    if (!open && b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ block: 'start' });
  }
  d.querySelectorAll('[data-fold]').forEach(function (s, i) {
    if (bar(s)) return;
    if (!s.id) s.id = 'ao-f' + i;
    var h = s.querySelector('h2') || s.querySelector('h3');
    var b = d.createElement('button');
    b.type = 'button'; b.className = 'ao-foldbar'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', s.id);
    var w = d.createElement('span'), t = d.createElement('span'), m = d.createElement('span'), hid = d.createElement('span');
    t.className = 'ao-ft'; t.textContent = s.getAttribute('data-fold-title') || (h ? h.textContent : 'More');
    m.className = 'ao-fs'; m.textContent = s.getAttribute('data-fold');
    hid.className = 'ao-fh'; hid.hidden = true; hid.textContent = 'Open';
    w.appendChild(t); w.appendChild(m); b.appendChild(w); b.appendChild(hid);
    b.insertAdjacentHTML('beforeend', CHEV);
    b.addEventListener('click', function () { setFold(s, !s.classList.contains('ao-open')); });
    s.insertBefore(b, s.firstChild);
    // the bar already carries the heading, so an open section doesn't say it twice; it follows the heading's language
    if (h && !s.getAttribute('data-fold-title')) {
      h.classList.add('ao-dup');
      var eb = h.previousElementSibling; if (eb && eb.classList.contains('eyebrow')) eb.classList.add('ao-dup');
      var hd = h.parentElement; if (hd && hd !== s && [].every.call(hd.children, function (c) { return c.classList.contains('ao-dup'); })) hd.classList.add('ao-dup');
      window.addEventListener('ao:lang', function () { t.textContent = h.textContent; });
    }
  });
  function openFor(id) {
    var el = id && d.getElementById(id); if (!el) return null;
    var f = el.closest('[data-fold]'); if (f && !f.classList.contains('ao-open')) setFold(f, true);
    return el;
  }
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="#"]'); if (!a) return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.pathname.replace(/index\\.html$/, '') !== location.pathname.replace(/index\\.html$/, '')) return;
    openFor(decodeURIComponent(u.hash.slice(1)));
  }, true);
  window.addEventListener('hashchange', function () { var el = openFor(decodeURIComponent(location.hash.slice(1))); if (el) el.scrollIntoView(); });
  if (location.hash) { var first = openFor(decodeURIComponent(location.hash.slice(1))); if (first) setTimeout(function () { first.scrollIntoView(); }, 0); }

  // Plans on a phone: Starter, Growth, Pro as three tabs, one plan shown at a time (the picked-most plan first).
  d.querySelectorAll('.plans').forEach(function (rail, ri) {
    var plans = [].slice.call(rail.querySelectorAll(':scope > .plan')); if (plans.length < 2) return;
    var tabs = d.createElement('div'); tabs.className = 'ao-plantabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Plans');
    var start = Math.max(0, plans.findIndex(function (p) { return p.classList.contains('feat'); }));
    var btns = plans.map(function (p, i) {
      if (!p.id) p.id = 'ao-plan' + ri + '-' + i;
      p.setAttribute('role', 'tabpanel');
      var b = d.createElement('button'); b.type = 'button'; b.id = p.id + '-tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', p.id);
      p.setAttribute('aria-labelledby', b.id);
      b.addEventListener('click', function () { pick(i); });
      b.addEventListener('keydown', function (e) { var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!k) return; e.preventDefault(); var j = (i + k + plans.length) % plans.length; pick(j); btns[j].focus(); });
      tabs.appendChild(b); return b;
    });
    function names() { btns.forEach(function (b, i) { var h = plans[i].querySelector('h3'), pr = plans[i].querySelector('.price b'); b.innerHTML = ''; b.appendChild(d.createTextNode(h ? h.textContent : 'Plan ' + (i + 1))); if (pr) { var sm = d.createElement('small'); sm.textContent = pr.textContent; b.appendChild(sm); } }); }
    function pick(i) { plans.forEach(function (p, j) { p.classList.toggle('on', j === i); }); btns.forEach(function (b, j) { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; }); }
    names(); pick(start);
    rail.removeAttribute('data-swipe'); rail.classList.add('ao-tabbed');
    rail.parentNode.insertBefore(tabs, rail);
    window.addEventListener('ao:lang', names);
  });

  // Add-ons on a phone: name, price and what it does; the details one tap away.
  d.querySelectorAll('.addon').forEach(function (a, i) {
    var dl = a.querySelector('dl'), go = a.querySelector('.btn'); if (!dl || !go) return;
    if (!dl.id) dl.id = 'ao-addon-' + i;
    var row = d.createElement('div'); row.className = 'addon-act';
    var b = d.createElement('button'); b.type = 'button'; b.className = 'ao-moreb'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', dl.id);
    function label() { var es = root.lang === 'es', open = a.classList.contains('ao-more'); b.textContent = open ? (es ? 'Menos detalles' : 'Fewer details') : (es ? 'Detalles' : 'Details'); }
    b.addEventListener('click', function () { var open = !a.classList.contains('ao-more'); a.classList.toggle('ao-more', open); b.setAttribute('aria-expanded', String(open)); label(); });
    go.parentNode.insertBefore(row, go); row.appendChild(go); row.appendChild(b); label();
    window.addEventListener('ao:lang', label);
  });

  // The comparison table on a phone: each row a card, each answer labelled with whose it is.
  d.querySelectorAll('.tablewrap table').forEach(function (tb) {
    function heads() {
      var th = [].slice.call(tb.querySelectorAll('thead th')).map(function (x) { return x.textContent.trim(); });
      tb.querySelectorAll('tbody tr').forEach(function (tr) { [].slice.call(tr.children).forEach(function (td, j) { if (j && th[j]) td.setAttribute('data-th', th[j]); }); });
    }
    heads(); window.addEventListener('ao:lang', heads);
  });

  // Rows that swipe sideways get dots under them.
  d.querySelectorAll('[data-swipe]').forEach(function (rail) {
    var kids = [].slice.call(rail.children); if (kids.length < 2) return;
    var nav = d.createElement('div'); nav.className = 'ao-dots';
    var dots = kids.map(function (k, i) {
      var b = d.createElement('button'); b.type = 'button';
      var name = k.getAttribute('aria-label') || ((k.querySelector('h3') || {}).textContent || '');
      b.setAttribute('aria-label', 'Show ' + (i + 1) + ' of ' + kids.length + (name ? ': ' + name.replace(/^\\d+ of \\d+: /, '') : ''));
      b.addEventListener('click', function () { rail.scrollTo({ left: k.offsetLeft - kids[0].offsetLeft, behavior: reduce ? 'auto' : 'smooth' }); });
      nav.appendChild(b); return b;
    });
    rail.parentNode.insertBefore(nav, rail.nextSibling);
    var cur = -1;
    function mark() {
      var x = rail.scrollLeft, best = 0, bd = 1e9;
      kids.forEach(function (k, i) { var dd = Math.abs(k.offsetLeft - kids[0].offsetLeft - x); if (dd < bd) { bd = dd; best = i; } });
      if (best === cur) return; cur = best;
      dots.forEach(function (b, i) { b.setAttribute('aria-current', String(i === best)); });
    }
    var raf = 0; rail.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; mark(); }); }, { passive: true });
    mark();
  });

  // The playable cards: tap a choice and the scene plays out.
  d.querySelectorAll('.aos-card').forEach(function (c) {
    var scn = c.querySelector('.aos-scn'), allPaths = [].slice.call(c.querySelectorAll('.aos-path')), btns = [].slice.call(c.querySelectorAll('.aos-ch button')), timers = [];
    var sec = c.closest('.aos-set') || c.closest('.aos');
    var paths = function () { var alt = sec.classList.contains('aos-carrier') && allPaths.some(function (p) { return p.classList.contains('aos-alt'); }); return allPaths.filter(function (p) { return p.classList.contains('aos-alt') === alt; }); };
    var down = function () { scn.scrollTo({ top: scn.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); };
    c.classList.add('aos-live');
    requestAnimationFrame(function () { scn.scrollTop = scn.scrollHeight; });
    allPaths.forEach(function (p) { p.hidden = false; });
    btns.forEach(function (b) { b.setAttribute('data-label', b.textContent); });
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () {
        timers.forEach(clearTimeout); timers = [];
        var ps = paths();
        allPaths.forEach(function (p) { p.classList.remove('on'); });
        ps.forEach(function (p, j) { p.classList.toggle('on', j === i); [].forEach.call(p.children, function (x) { x.classList.add('aos-wait'); }); });
        btns.forEach(function (x, j) { x.setAttribute('aria-pressed', String(j === i)); x.textContent = x.getAttribute('data-label'); });
        [].forEach.call(ps[i].children, function (x, n) {
          if (reduce || n === 0) { x.classList.remove('aos-wait'); down(); }
          else timers.push(setTimeout(function () { x.classList.remove('aos-wait'); down(); }, n * 700));
        });
        if (btns.length === 1) timers.push(setTimeout(function () { b.textContent = 'Play it again'; }, reduce ? 0 : ps[i].children.length * 700));
      });
    });
  });

  // The home page: the cards follow the visitor's trade, picked above the cards or from the business tiles further down.
  var pick = d.querySelector('.aos-pick');
  if (pick) {
    var TILE = { trades: 'plumbing', marine: 'marine', salon: 'salons', food: 'restaurants', insurance: 'insurance', health: 'dental' };
    var choose = function (k, scroll) {
      if (!d.querySelector('.aos-set[data-set="' + k + '"]')) return;
      d.querySelectorAll('.aos-set').forEach(function (s) { s.hidden = s.getAttribute('data-set') !== k; });
      pick.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-pick') === k)); });
      var f = d.querySelector('form[data-grade]'); if (f) f.setAttribute('data-grade', k);
      var rail = d.querySelector('.aos-set:not([hidden]) .aos-rail'); if (rail) { rail.scrollLeft = 0; rail.dispatchEvent(new Event('scroll')); }
      try { sessionStorage.setItem('ao_from', k); } catch (x) {}
      if (scroll) d.getElementById('go').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    };
    pick.addEventListener('click', function (e) { var b = e.target.closest('button[data-pick]'); if (b) choose(b.getAttribute('data-pick'), false); });
    d.querySelectorAll('.indtile[data-ind]').forEach(function (t) { t.addEventListener('click', function () { choose(TILE[t.getAttribute('data-ind')] || 'plumbing', false); }); });
    var fromQ = /[?&]from=([a-z-]+)/.exec(location.search); var fromS = ''; try { fromS = sessionStorage.getItem('ao_from') || ''; } catch (x) {}
    if (fromQ) choose(fromQ[1], false); else if (fromS) choose(fromS, false);
  }

  // Independent or with a carrier: the endings change, nothing else does.
  d.querySelectorAll('.aos-modes').forEach(function (g) {
    var sec = g.closest('.aos-set') || g.closest('.aos');
    g.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]'); if (!b) return;
      var carrier = b.getAttribute('data-mode') === '1';
      sec.classList.toggle('aos-carrier', carrier);
      g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      sec.querySelectorAll('.aos-card').forEach(function (c) { c.querySelectorAll('.aos-path').forEach(function (p) { p.classList.remove('on'); }); c.querySelectorAll('.aos-ch button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); x.textContent = x.getAttribute('data-label'); }); });
    });
  });

  // The floating "Call Max" button steps aside while someone types.
  d.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input,textarea,select')) root.classList.add('ao-typing'); });
  d.addEventListener('focusout', function () { root.classList.remove('ao-typing'); });

  // The instant grade, right where it was asked.
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  d.querySelectorAll('form[data-grade]').forEach(function (f) {
    var out = f.querySelector('.aog-out'), go = f.querySelector('button[type=submit]');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var from = f.getAttribute('data-grade') || '';
      var q = f.q.value.trim(), town = f.town.value.trim();
      if (q.length < 2) { out.innerHTML = '<p class="aog-msg">Type your business name first.</p>'; f.q.focus(); return; }
      var label = go.textContent; go.disabled = true; go.textContent = 'Checking…';
      out.innerHTML = '<p class="aog-msg">Checking Google and your website. This takes a few seconds.</p>';
      var done = function () { go.disabled = false; go.textContent = label; };
      fetch('/audit/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: q, town: town, from: from }) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          done();
          if (!r.ok) { out.innerHTML = '<p class="aog-msg">' + esc(r.error || 'The checker is not available right now.') + '</p>'; return; }
          if (!r.found) { out.innerHTML = '<p class="aog-msg">We could not find that listing. Try the name as it shows on Google, with the town.</p>'; return; }
          var onHome = !!d.getElementById('lead');
          var full = onHome ? '#contact' : '/?' + (from ? 'from=' + encodeURIComponent(from) + '&' : '') + 'biz=' + encodeURIComponent(r.name || q) + '&town=' + encodeURIComponent(town) + '#contact';
          out.innerHTML = '<div class="aog-res"><b class="aog-gl ' + esc(r.grade) + '">' + esc(r.grade) + '</b><div><b>' + esc(r.name) + '</b><span>' + esc(r.address) + '</span><span>Score ' + esc(r.score) + ' out of 100</span></div></div>' +
            (r.areas && r.areas.length ? '<div class="aog-areas">' + r.areas.map(function (a) { return '<span><i>' + esc(a.grade) + '</i>' + esc(a.label) + '</span>'; }).join('') + '</div>' : '') +
            (r.top && r.top.length ? r.top.map(function (t) { return '<p class="aog-find"><strong>' + esc(t.title) + '.</strong> ' + esc(t.saw) + '</p>'; }).join('') : '<p>Nothing major. You’re in good shape.</p>') +
            (r.more ? '<p class="aog-msg">Plus ' + esc(r.more) + ' more in the full audit, with how you compare to your top competitors.</p>' : '') +
            '<a class="aog-full" href="' + full + '">Get the full audit, free</a>' +
            '<p class="aog-src">' + (d.documentElement.lang === 'es' ? 'Calificaciones y número de reseñas de Google Maps' : 'Ratings and review counts from Google Maps') + '</p>';
          var a = out.querySelector('.aog-full');
          if (onHome) a.addEventListener('click', function () { var bz = d.getElementById('f-biz'), tw = d.getElementById('f-town'); if (bz && !bz.value) bz.value = r.name || q; if (tw && !tw.value) tw.value = town; });
        }, function () { done(); out.innerHTML = '<p class="aog-msg">No connection. Try again, or ask for the full audit.</p>'; });
    });
  });

  // Arriving from an industry page: the request form knows the kind of business and what was already typed.
  var lead = d.getElementById('lead');
  if (lead) {
    var qs = {}; location.search.replace(/^\\?/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { qs[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\\+/g, ' ')); } catch (x) {} } });
    var TYPES = ${JSON.stringify(Object.assign(Object.fromEntries(Object.entries(PAGES).filter(([, p]) => p.type).map(([k, p]) => [k, p.type])), { marinas: 'Dock, marine or outdoor' }))};
    var from = /^[a-z-]{3,20}$/.test(qs.from || '') && TYPES[qs.from] ? qs.from : '';
    try { if (from) sessionStorage.setItem('ao_from', from); else from = sessionStorage.getItem('ao_from') || ''; } catch (x) {}
    var put = function (id, v) { var el = d.getElementById(id); if (el && v && !el.value) el.value = String(v).slice(0, 120); };
    put('f-biz', qs.biz); put('f-town', qs.town);
    var sel = d.getElementById('f-type');
    if (sel && from && TYPES[from]) for (var i = 0; i < sel.options.length; i++) if (sel.options[i].text === TYPES[from]) { sel.selectedIndex = i; break; }
    if (from) d.addEventListener('submit', function (e) {
      if (e.target !== lead) return;
      var nt = d.getElementById('f-note'); if (!nt) return;
      var tag = 'Came from the ' + from + ' page.';
      if (nt.value.indexOf(tag) < 0) nt.value = (nt.value ? nt.value + '\\n' : '') + tag;
    }, true);
  }
})();`;

const KIT = '<!--ao:kit-->\n<style id="ao-phone">' + CSS + '\n</style>\n<script>' + JS + '\n</script>\n<!--/ao:kit-->';

// ---------- Spanish: the ES/EN switch, the line under the dare, and the swap (phone-es.mjs) ----------
const SLOT = '<div data-hearmax id="hear" hidden></div>';
const LANG_BTN = '<!--ao:lang--><button type="button" class="lang-t" data-lang-t lang="es" aria-label="Ver en español">ES</button><!--/ao:lang-->';
const ES_CSS = '.top{flex-wrap:nowrap}.top .wordmark{white-space:nowrap;flex:none}.lang-t{flex:none;min-width:44px;min-height:44px;margin-left:10px;padding:0 10px;border:1.5px solid rgba(236,238,243,.4);border-radius:10px;background:transparent;color:#ECEEF3;font:700 15px/1 system-ui,-apple-system,sans-serif;letter-spacing:.08em;cursor:pointer}' +
  '@media (max-width:420px){html[data-lang="es"] .top{gap:8px}html[data-lang="es"] .top nav a.btn{white-space:normal;max-width:92px;text-align:center;line-height:1.15;padding-left:10px;padding-right:10px}.lang-t{margin-left:0}}' +
  '@media (max-width:360px){.top,html[data-lang="es"] .top{gap:6px}.top .wordmark{font-size:1rem;gap:6px}.top .wordmark .mark{width:24px;height:24px}.top nav a.btn{padding-left:10px;padding-right:10px}.lang-t{padding:0 6px}}' +
  '.lang-t:hover{border-color:#FF6A5E}.lang-t:focus-visible{outline:3px solid #FF6A5E;outline-offset:2px}.es-line{margin:12px 0 0;font-weight:600;font-size:15px;line-height:1.4}';
// The switch, as it runs in the page. Kept as a real function so it is checked like any other code.
function esSwitch() {
  var d = document, data;
  try { data = JSON.parse(d.getElementById('ao-es').textContent); } catch (e) { return; }
  var btn = d.querySelector('[data-lang-t]'); if (!btn) return;
  var keys = {}; Array.prototype.forEach.call(d.querySelectorAll('[data-launch]'), function (el) { keys[el.getAttribute('data-launch')] = 1; });
  var saved = [], cur = 'en';
  function lead(el) { var out = ''; for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 1 && n.tagName.toLowerCase() === 'svg') out += n.outerHTML; else if (n.nodeType === 3 && !n.nodeValue.trim()) continue; else break; } return out; }
  function apply(lang) {
    if (lang === cur) return;
    if (lang === 'es') {
      saved = [];
      data.forEach(function (e) {
        var el = d.querySelector(e.s); if (!el) return; var o = { el: el };
        if (e.h != null) { o.h = el.innerHTML; var t = d.createElement('div'); t.innerHTML = e.h; Array.prototype.forEach.call(t.querySelectorAll('[data-launch]'), function (x) { if (!keys[x.getAttribute('data-launch')]) x.remove(); }); el.innerHTML = lead(el) + t.innerHTML; }
        if (e.t != null) { for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) { o.tn = n; o.t = n.nodeValue; n.nodeValue = e.t; break; } } }
        if (e.p != null) { o.p = el.getAttribute('placeholder'); el.setAttribute('placeholder', e.p); }
        if (e.o != null) { o.o = el.textContent; if (!el.hasAttribute('value')) el.setAttribute('value', el.textContent); el.textContent = e.o; }
        if (e.a) { o.a = {}; for (var k in e.a) { o.a[k] = el.getAttribute(k); el.setAttribute(k, e.a[k]); } }
        saved.push(o);
      });
    } else {
      saved.reverse().forEach(function (o) {
        var el = o.el;
        if (o.h != null) el.innerHTML = o.h;
        if (o.tn) o.tn.nodeValue = o.t;
        if (o.p !== undefined) { if (o.p == null) el.removeAttribute('placeholder'); else el.setAttribute('placeholder', o.p); }
        if (o.o != null) el.textContent = o.o;
        if (o.a) for (var k in o.a) { if (o.a[k] == null) el.removeAttribute(k); else el.setAttribute(k, o.a[k]); }
      });
      saved = [];
    }
    cur = lang; d.documentElement.lang = lang; d.documentElement.setAttribute('data-lang', lang);
    btn.textContent = lang === 'es' ? 'EN' : 'ES'; btn.setAttribute('aria-label', lang === 'es' ? 'View in English' : 'Ver en español'); btn.setAttribute('lang', lang === 'es' ? 'en' : 'es');
    var f = d.getElementById('lead');
    if (f) { var i = f.querySelector('input[name="lang"]'); if (!i) { i = d.createElement('input'); i.type = 'hidden'; i.name = 'lang'; f.appendChild(i); } i.value = lang; }
    try { localStorage.setItem('ao_lang', lang); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('ao:lang', { detail: lang })); } catch (e) {}
  }
  btn.addEventListener('click', function () { apply(cur === 'es' ? 'en' : 'es'); });
  var want = ''; try { want = new URLSearchParams(location.search).get('lang') || localStorage.getItem('ao_lang') || ''; } catch (e) {}
  if (want === 'es') apply('es');
}
function esEntries(key, s) {
  const out = (key === 'index' ? ES_HOME.slice() : esTrade(key)).concat(ES_DOES).concat(esDoesFor(key)).concat(esFront(key).filter(e => !/aos-also/.test(e.s) && (PAGES[key].modes || !/aos-modes/.test(e.s))));
  const h = s.indexOf('<header'), n0 = s.indexOf('<nav aria-label="Main">', h), n1 = s.indexOf('</nav>', n0);
  const links = n0 > 0 ? (s.slice(n0, n1).match(/<a\b[^>]*>[^<]*<\/a>/g) || []) : [];
  links.forEach((a, i) => { const t = a.replace(/<[^>]+>/g, '').trim(); if (NAV_ES[t]) out.push({ s: 'header.hero nav a:nth-child(' + (i + 1) + ')', h: NAV_ES[t] }); });
  return out;
}
function esBlock(key, s) {
  return '<!--ao:es-->\n<style id="ao-es-css">' + ES_CSS + '</style>\n<script type="application/json" id="ao-es">' + JSON.stringify(esEntries(key, s)).replace(/</g, '\\u003c') + '</script>\n<script>(' + esSwitch.toString() + ')();</script>\n<!--/ao:es-->';
}

// ---------- writing it into the pages ----------
function between(s, tag, block, where) {
  const re = new RegExp('<!--ao:' + tag + '-->[\\s\\S]*?<!--/ao:' + tag + '-->');
  if (re.test(s)) return s.replace(re, () => block);
  const at = where(s);
  if (at < 0) throw new Error('no place for ' + tag);
  return s.slice(0, at) + block + '\n' + s.slice(at);
}
function foldAttrs(s, folds) {
  s = s.replace(/ data-fold="[^"]*"/g, '');
  // Max's clock band (siteclock.mjs) is on the pages that have it; it keeps its own one-line summary.
  if (s.includes('id="clock"') && folds !== FOLDS.index) folds = Object.assign({}, folds, { clock: 'Every call on one dial, and the hours that came back to you.' });
  // The Shoulder Tap band (sitetap.mjs) sits right after this block's front; open on the home page, folded on the rest.
  if (s.includes('id="tap"') && folds !== FOLDS.index) folds = Object.assign({}, folds, { tap: TAP_FOLD });
  for (const [id, sum] of Object.entries(folds)) {
    const re = new RegExp('(<(?:section|div)\\b[^>]*\\bid="' + id + '"[^>]*)>');
    if (!re.test(s)) throw new Error('no section ' + id);
    s = s.replace(re, (m, a) => a + ' data-fold="' + esc(sum) + '">');
  }
  return s;
}
function build(file, key) {
  const p = PAGES[key];
  let s = fs.readFileSync(file, 'utf8');
  // fonts load without holding up the first paint
  if (!/fonts\.googleapis\.com\/css2[^"]*" media="print"/.test(s)) s = s.replace(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)">/, (m, href) =>
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="' + href + '" media="print" onload="this.media=\'all\'"><noscript><link rel="stylesheet" href="' + href + '"></noscript>');
  // hero: one short line and a "Check my grade" button on phones
  s = s.replace(/<p class="lede-ph">[\s\S]*?<\/p>/, '');
  s = s.replace(/(<p class="lede">[\s\S]*?<\/p>)/, (m) => m + '<p class="lede-ph">' + esc(p.short) + '</p>');
  s = s.replace(/<a class="btn primary ph-only"[^>]*>[^<]*<\/a>/g, '');
  // (no "Check my grade" button since Nov 4, 2026: on phones the free-audit button shows instead)
  // the phone front right after the hero, the kit before </body>
  const keep = { wall: (s.match(/<!-- wall:start -->[\s\S]*?<!-- wall:end -->/) || [''])[0], clock: (s.match(/<!-- clock:start -->[\s\S]*?<!-- clock:end -->/) || [''])[0] };
  s = between(s, 'front', front(key, p, keep), x => { const i = x.indexOf('</header>'); return i < 0 ? -1 : i + '</header>'.length + 1; });
  s = between(s, 'kit', KIT, x => x.lastIndexOf('</body>'));
  // folded sections and swipeable plans
  s = s.replace(/<div class="plans"( data-swipe)?>/g, '<div class="plans" data-swipe>');
  if (key === 'index') s = s.replace(/<div class="addons"( data-swipe)?>/g, '<div class="addons" data-swipe>');   // a swipe row of short cards on phones
  // industry pages: the request form learns which page they came from
  if (key !== 'index') s = s.replace(/href="(?:index\.html|\/)(?:\?from=[a-z-]+)?#contact"/g, 'href="/?from=' + key + '#contact"');
  // one wrapper only: earlier runs wrapped it again once the fold attribute was on it
  if (key === 'index') { const dup = /(<div class="ao-addons" id="addons-all"[^>]*>)\s*<div class="ao-addons" id="addons-all">([\s\S]*?Add-ons are set up per business[\s\S]*?<\/p>\s*<\/div>)\s*<\/div>/; while (dup.test(s)) s = s.replace(dup, '$1$2'); }
  if (key === 'index') { s = s.replace(/<p class="reglink">[\s\S]*?<\/p>\s*/, ''); s = s.replace('<div class="ctas"><a class="btn primary" href="#contact" data-plan="Starter">', '<p class="reglink">We never see a client’s name or number, and Compliance Guard checks every word before you see it. Full details for <a href="/insurance">insurance agencies</a> and <a href="/dental">dental offices</a>.</p>\n        <div class="ctas"><a class="btn primary" href="#contact" data-plan="Starter">'); }
  if (key === 'index' && !/<div class="ao-addons" id="addons-all"/.test(s)) {
    const a = s.indexOf('<div class="addons-head" id="addons">'), f = s.indexOf('Add-ons are set up per business', a), b = s.indexOf('</p>', f) + 4;
    if (a < 0 || f < 0) throw new Error('no add-ons block');
    s = s.slice(0, a) + '<div class="ao-addons" id="addons-all">\n    ' + s.slice(a, b) + '\n    </div>' + s.slice(b);
  }
  if (key === 'index') {
    s = s.replace('<input id="f-phone" name="phone" type="tel" autocomplete="tel">', '<input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel">');
    s = s.replace('<input id="f-town" name="town" placeholder="Eatonton, GA">', '<input id="f-town" name="town" autocomplete="address-level2" placeholder="Eatonton, GA">');
    s = s.replace('<input id="c-town" placeholder="Town, state">', '<input id="c-town" autocomplete="address-level2" placeholder="Town, state">');
    // the floating call button also steps aside over the cards and the grade check
    s = s.replace("['header.hero', '#try', '#contact', 'footer']", "['header.hero', '#go', '#try', '#contact', 'footer']");
  }
  // Spanish: the switch after the main menu, the line under the dare, the swap block before </body>
  s = between(s, 'lang', LANG_BTN, x => { const h = x.indexOf('<header'), n = x.indexOf('</nav>', h); return n < 0 ? -1 : n + 6; });
  s = s.replace(/<!--ao:esline-->[\s\S]*?<!--\/ao:esline-->/, '');   // the languages now live in the small line under the buttons
  s = between(s, 'es', esBlock(key, s), x => x.lastIndexOf('</body>'));
  s = foldAttrs(s, key === 'index' ? FOLDS.index : FOLDS[key] || FOLDS.trade);
  fs.writeFileSync(file, s);
  return s.length;
}

for (const key of Object.keys(PAGES)) {
  const file = path.join(PUB, key + '.html');
  const n = build(file, key);
  console.log(key.padEnd(12), PAGES[key].cards.length, 'cards', Math.round(n / 1024) + ' KB');
}
