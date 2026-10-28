// The phone version of the public site. Run from the repo root: node tools/phone.mjs
// Writes into public/index.html and the industry pages (run it again after tools/industry.py rebuilds them):
//   - the phone front right under the hero: playable "Only here" cards and the instant grade check
//   - the phone kit before </body>: folded sections, swipeable plans, the grade form, and the small fixes for phones
// Everything is between <!--ao:...--> markers, so running it twice changes nothing. Desktop layouts are not touched:
// all of it shows only at 760 px wide and under.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, FOLDS } from './phone-data.mjs';

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
    '</div>' +
    '<div class="aos-ch" role="group" aria-label="What happens next">' + c.choices.map((ch, j) => '<button type="button" data-p="' + j + '" aria-pressed="false">' + esc(ch.label) + '</button>').join('') + '</div>' +
    '<p class="aos-why">' + esc(c.why) + (c.call ? ' <a href="tel:+17064602226">Call the real Max</a>' : '') + '</p>' +
    '</article>';
}
const CHIPS = [
  ['Compliance Guard', 'Every word is checked before it goes out in your name, so insurance agencies and practices can use us too.'],
  ['The Always Open map', 'Every Always Open business on one map, closest first. Nobody pays to be on it.'],
  ['Spanish on every plan', 'Max and every reply answer in Spanish, with no add-on.']
];
function front(key, p) {
  const n = p.cards.length;
  const heading = p.heading || ('What nobody else does for ' + p.plural + '. Tap to try it.');
  const sub = p.sub || 'Swipe through. Each card plays out a call, a text or a post for a made-up business.';
  return '<!--ao:front-->\n<section class="aos band" id="go" data-label="Try it" aria-labelledby="aos-h">\n' +
    '<div class="aos-head"><h2 id="aos-h">' + esc(heading) + '</h2><p>' + esc(sub) + '</p></div>\n' +
    '<div class="aos-rail" data-swipe tabindex="0" role="region" aria-label="Things to try, ' + n + ' cards">' + p.cards.map((c, i) => card(c, i, n)).join('') + '</div>\n' +
    '<p class="aos-sample">Sample: made-up businesses, customers and callers.</p>\n' +
    '<div class="aog" id="go-grade"><h3>How does your business look online?</h3><p>Type your business name and town. Your grade shows up right here in a few seconds.</p>' +
    '<form data-grade="' + (key === 'index' ? '' : key) + '" novalidate>' +
      '<label for="g-q">Business name</label><input id="g-q" name="q" autocomplete="organization" enterkeyhint="next" placeholder="As it shows on Google" required>' +
      '<label for="g-town">Town</label><input id="g-town" name="town" autocomplete="address-level2" enterkeyhint="go" placeholder="Eatonton, GA">' +
      '<button class="aog-go" type="submit">Check my grade</button>' +
      '<div class="aog-out" aria-live="polite"></div>' +
    '</form></div>\n' +
    (p.chips ? '<div class="aos-also"><p>Also only here</p>' + CHIPS.map(c => '<details><summary>' + esc(c[0]) + '</summary><p>' + esc(c[1]) + '</p></details>').join('') + '</div>\n' : '') +
    '</section>\n<!--/ao:front-->';
}

// ---------- the styles, shown only on phones ----------
const CSS = `
.aos,.ao-foldbar,.ao-dots,.lede-ph,.ph-only{display:none}
@media (max-width:760px){
/* hero: the headline, one line, two buttons */
.hero .stack,.hero .desk,.hero .hero-scene,.hero .lede,.hero .fine,.hero .onlylink,.hero .promise,.hero .day,.hero .everyone,.hero-grid>.day{display:none!important}
.hero .lede-ph{display:block;font-size:1.08rem;line-height:1.5;color:var(--night-mute);margin-top:16px;max-width:32em}
.hero-grid{padding-block:6px 30px!important;gap:0!important}
.hero .neon{margin-bottom:16px}
.hero .ctas{margin-top:22px!important}
.hero .ctas>a:not(.ph-only):not([href^="tel:"]){display:none!important}
.hero .ctas>.ph-only{display:inline-flex;width:100%}
.indlinks,#industries .sub,#contact .founding{display:none}
#industries h2{margin-bottom:16px}
/* the playable cards */
.aos{display:block;color:#ECEEF3;background:linear-gradient(180deg,#0F131B 0%,#131A28 100%);padding-top:6px;padding-bottom:40px;border-top:1px solid rgba(255,106,94,.28)}
.aos-head{padding-top:26px}
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
/* the instant grade */
.aog{margin-top:30px;padding:20px 16px;border-radius:18px;background:#171C27;border:1px solid rgba(255,106,94,.45);box-shadow:0 0 0 1px rgba(255,106,94,.12),0 0 28px -8px rgba(255,90,77,.45)}
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
    var scn = c.querySelector('.aos-scn'), paths = [].slice.call(c.querySelectorAll('.aos-path')), btns = [].slice.call(c.querySelectorAll('.aos-ch button')), timers = [];
    var down = function () { scn.scrollTo({ top: scn.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); };
    c.classList.add('aos-live');
    requestAnimationFrame(function () { scn.scrollTop = scn.scrollHeight; });
    paths.forEach(function (p) { p.hidden = false; });
    btns.forEach(function (b) { b.setAttribute('data-label', b.textContent); });
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () {
        timers.forEach(clearTimeout); timers = [];
        paths.forEach(function (p, j) { p.classList.toggle('on', j === i); [].forEach.call(p.children, function (x) { x.classList.add('aos-wait'); }); });
        btns.forEach(function (x, j) { x.setAttribute('aria-pressed', String(j === i)); x.textContent = x.getAttribute('data-label'); });
        [].forEach.call(paths[i].children, function (x, n) {
          if (reduce || n === 0) { x.classList.remove('aos-wait'); down(); }
          else timers.push(setTimeout(function () { x.classList.remove('aos-wait'); down(); }, n * 700));
        });
        if (btns.length === 1) timers.push(setTimeout(function () { b.textContent = 'Play it again'; }, reduce ? 0 : paths[i].children.length * 700));
      });
    });
  });

  // The floating "Call Max" button steps aside while someone types.
  d.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input,textarea,select')) root.classList.add('ao-typing'); });
  d.addEventListener('focusout', function () { root.classList.remove('ao-typing'); });

  // The instant grade, right where it was asked.
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  d.querySelectorAll('form[data-grade]').forEach(function (f) {
    var out = f.querySelector('.aog-out'), go = f.querySelector('button[type=submit]'), from = f.getAttribute('data-grade') || '';
    f.addEventListener('submit', function (e) {
      e.preventDefault();
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
            '<a class="aog-full" href="' + full + '">Get the full audit, free</a>';
          var a = out.querySelector('.aog-full');
          if (onHome) a.addEventListener('click', function () { var bz = d.getElementById('f-biz'), tw = d.getElementById('f-town'); if (bz && !bz.value) bz.value = r.name || q; if (tw && !tw.value) tw.value = town; });
        }, function () { done(); out.innerHTML = '<p class="aog-msg">No connection. Try again, or ask for the full audit.</p>'; });
    });
  });

  // Arriving from an industry page: the request form knows the kind of business and what was already typed.
  var lead = d.getElementById('lead');
  if (lead) {
    var qs = {}; location.search.replace(/^\\?/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) { try { qs[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\\+/g, ' ')); } catch (x) {} } });
    var TYPES = ${JSON.stringify(Object.fromEntries(Object.entries(PAGES).filter(([, p]) => p.type).map(([k, p]) => [k, p.type])))};
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
  s = s.replace(/(<header[\s\S]*?<div class="ctas">)/, (m) => m + '<a class="btn primary ph-only" href="#go-grade">Check my grade</a>');
  // the phone front right after the hero, the kit before </body>
  s = between(s, 'front', front(key, p), x => { const i = x.indexOf('</header>'); return i < 0 ? -1 : i + '</header>'.length + 1; });
  s = between(s, 'kit', KIT, x => x.lastIndexOf('</body>'));
  // folded sections and swipeable plans
  s = s.replace(/<div class="plans"( data-swipe)?>/g, '<div class="plans" data-swipe>');
  if (key === 'index') s = s.replace(/<div class="addons"( data-swipe)?>/g, '<div class="addons" data-swipe>');
  // industry pages: the request form learns which page they came from
  if (key !== 'index') s = s.replace(/href="(?:index\.html|\/)(?:\?from=[a-z-]+)?#contact"/g, 'href="/?from=' + key + '#contact"');
  if (key === 'index' && !s.includes('<div class="ao-addons" id="addons-all">')) {
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
  s = foldAttrs(s, key === 'index' ? FOLDS.index : FOLDS[key] || FOLDS.trade);
  fs.writeFileSync(file, s);
  return s.length;
}

for (const key of Object.keys(PAGES)) {
  const file = path.join(PUB, key + '.html');
  const n = build(file, key);
  console.log(key.padEnd(12), PAGES[key].cards.length, 'cards', Math.round(n / 1024) + ' KB');
}
