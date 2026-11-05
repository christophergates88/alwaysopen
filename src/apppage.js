import { BIZ_JS } from './bizpage.js';
import { PAST_JS } from './pastpage.js';
import { RIVALS_JS } from './rivalspage.js';
import { CLOCK_CSS, CLOCK_JS, CLOCK_ANIM_CSS, CLOCK_ANIM_JS } from './clock.js';
// The client app page (web version). Everything it shows comes from <base>/api/state; nothing private is in the HTML.
export function appHtml({ base, business }) {
  const B = JSON.stringify(String(base)).replace(/</g, '\\u003c');
  const biz = String(business || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Always Open' + (biz ? ' · ' + biz : '') + '</title>' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<meta name="theme-color" content="#0F131B"><meta name="color-scheme" content="dark">' +
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-title" content="Always Open"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<link rel="manifest" href="' + base + '/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" type="image/svg+xml" href="/favicon.svg">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,600..900&family=Instrument+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap">' +
    '<style>' + CSS + '</style></head><body>' +
    '<header class="top"><div class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>' +
    '<div><span class="kick">Always Open</span><b id="biz">' + biz + '</b></div></div>' +
    '<div class="topr"><button class="btn line katie" type="button" data-a="katie">Text Katie</button><button class="icon" id="refresh" type="button" aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>' +
    '<div class="offline" id="offline" hidden>No connection. Showing what we had.</div>' +
    '<main id="view" tabindex="-1"><div class="loading"><span></span><span></span><span></span></div></main>' +
    '<nav class="tabs" aria-label="Sections">' +
    tab('today', 'Today', '<path d="M4 11.2L12 4.5l8 6.7V20h-5.2v-5.4H9.2V20H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    tab('customers', 'Customers', '<circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 19.5c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.8c1.6.6 2.7 2.1 3 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>') +
    tab('money', 'Money', '<path d="M12 3.5v17M16.5 7.5c-.7-1.5-2.4-2.3-4.5-2.3-2.6 0-4.3 1.3-4.3 3.2 0 4.4 9.1 2.4 9.1 7.1 0 2-1.9 3.4-4.6 3.4-2.3 0-4.1-.9-4.9-2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>') +
    tab('max', 'Max', '<path d="M6.6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.9 5.9l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.6 5.5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    '</nav>' +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>' +
    '<div class="scrim" id="scrim" hidden></div>' +
    '<script>var BASE=' + B + ';' + JS + '</script></body></html>';
}

function tab(id, label, path) {
  return '<button type="button" class="tab" data-tab="' + id + '" aria-label="' + label + '"' + '' + '><svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg><span>' + label + '</span>' +
    (id === 'today' ? '<i class="badge" id="badge" hidden></i>' : (id === 'max' ? '<i class="badge" id="cbadge" hidden></i>' : '')) + '</button>';
}

const CSS = `
:root{--paper:#0F131B;--card:#171C27;--ink:#ECEEF3;--slate:#A3ACBF;--line:#262E40;--panel:#1F2533;--sign:#FF6A5E;--on-sign:#1A0605;--sign-soft:#3A1F22;--ok:#5CC9A4;--on-ok:#06231A;--ok-soft:#173229;--warn:#F2C46B;--warn-soft:#33290F;
--glow:0 0 0 1px rgba(255,106,94,.22),0 0 24px rgba(255,90,77,.3),inset 0 0 16px rgba(255,90,77,.12);
--display:"Archivo","Arial Narrow",Arial,sans-serif;--body:"Instrument Sans",system-ui,-apple-system,sans-serif;--mono:"DM Mono",ui-monospace,Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background-color:var(--paper);background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;color:var(--ink);font:17px/1.45 var(--body);min-height:100vh;padding-bottom:calc(76px + env(safe-area-inset-bottom,0px))}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:3px solid var(--sign);outline-offset:2px}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:color-mix(in srgb,var(--paper) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand svg{width:34px;height:34px;flex:none}
.brand div{display:grid;min-width:0}
.kick{font:500 12px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--slate)}
.brand b{font:800 1.05rem/1.15 var(--display);font-stretch:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;flex:none}
.icon svg{width:22px;height:22px}
.icon.spin svg{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.offline{background:var(--warn-soft);color:var(--warn);font-size:15px;text-align:center;padding:8px 16px}
main{max-width:680px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));outline:none}
h1{font:850 1.75rem/1.05 var(--display);font-stretch:92%;margin:4px 0 6px;letter-spacing:-.01em}
h2{font:800 1.15rem/1.2 var(--display);font-stretch:92%;margin:26px 0 10px}
.lede{color:var(--slate);margin:0 0 16px}
.lede .tier{font-weight:700;color:inherit;border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px;display:grid;gap:12px}
.ch{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.chip{font:600 12.5px var(--body);background:var(--panel);border-radius:99px;padding:3px 10px}
/* swipe to approve */
.card.swp{touch-action:pan-y;position:relative;will-change:transform;transition:transform .18s ease,opacity .18s}
.card.swp.drag{transition:none}
.card.swp .swhint{position:absolute;top:12px;font:800 15px var(--body);letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:9px;opacity:0;transition:opacity .12s;pointer-events:none}
.card.swp .swhint.ok{left:12px;background:var(--ok);color:#fff}.card.swp .swhint.no{right:12px;background:var(--panel);color:var(--slate)}
.card.swp.r .swhint.ok,.card.swp.l .swhint.no{opacity:1}
.card.swp.gone{transform:translateX(120%) rotate(4deg);opacity:0}.card.swp.gone.l{transform:translateX(-120%) rotate(-4deg)}
.swtip{font:500 12.5px var(--body);color:var(--slate);margin:-6px 0 12px;display:flex;gap:6px;align-items:center}
/* filter chips */
.fchips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -2px 14px;padding:2px}.fchips button{flex:none;border:1.5px solid var(--line);background:var(--card);border-radius:99px;padding:6px 12px;font:600 15px var(--body);color:var(--ink)}.fchips button[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}.fchips button i{font-style:normal;opacity:.7;margin-left:4px}
/* tappable tiles and bars */
button.tile{text-align:left;font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button.tile:active{transform:scale(.97)}button.tile::after{content:'';justify-self:end;width:7px;height:7px;border-right:1.8px solid var(--slate);border-bottom:1.8px solid var(--slate);transform:rotate(-45deg);margin-top:-14px;opacity:.6}
.bars{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px;align-items:end;height:96px;margin:6px 0 2px;padding:0 2px}.bars button{border:0;background:none;padding:0;display:grid;align-content:end;justify-items:center;gap:4px;height:100%;font:600 11px var(--mono);color:var(--slate);cursor:pointer}.bars i{display:block;width:100%;max-width:36px;background:var(--line);border-radius:6px 6px 2px 2px;transition:height .35s ease,background .2s;min-height:3px}.bars button[aria-pressed=true] i{background:var(--sign)}.bars button b{font-weight:700;color:var(--ink)}
.barsh{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px}.barsh b{font-size:15px}.barsh span{font-size:12.5px;color:var(--slate)}
/* badges pop when they change */
.badge{transition:transform .25s cubic-bezier(.3,1.6,.6,1)}.badge.pop{transform:scale(1.35)}
/* pull to refresh */
.ptr{height:0;overflow:hidden;display:grid;place-items:center;color:var(--slate);font:500 12.5px var(--mono);transition:height .2s}.ptr.on{height:34px}
/* settings index */
.sidx{display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 14px}.sidx a{font:600 12.5px var(--body);color:var(--ink);background:var(--panel);border-radius:99px;padding:5px 11px;text-decoration:none}
/* live call */
.live{background:var(--card);border:2px solid var(--sign);border-radius:18px;padding:14px 16px;margin:0 0 14px;display:grid;gap:8px;box-shadow:var(--glow);animation:livePulse 2.2s ease-in-out infinite}
@keyframes livePulse{0%,100%{box-shadow:0 0 0 1px rgba(255,106,94,.22),0 0 18px rgba(255,90,77,.25)}50%{box-shadow:0 0 0 1px rgba(255,106,94,.4),0 0 30px rgba(255,90,77,.5)}}
@media (prefers-reduced-motion:reduce){.live{animation:none}}
.live .lh{display:flex;align-items:center;gap:8px;font-weight:700}.live .dot{width:9px;height:9px;border-radius:99px;background:var(--sign);animation:dotp 1.1s ease-in-out infinite}@keyframes dotp{50%{opacity:.25}}
.live .ln{font:500 12px var(--mono);color:var(--slate)}.live .lq{display:grid;gap:5px}.live .lq span{font-size:15px;padding:8px 11px;border-radius:14px;max-width:92%}.live .lq .u{background:var(--panel);justify-self:start;border-bottom-left-radius:4px}.live .lq .a{background:var(--ink);color:var(--paper);justify-self:end;border-bottom-right-radius:4px}
.chip.storm{background:var(--warn-soft);color:var(--warn)}
.stars{color:#E8A317;letter-spacing:1px;font-size:15px}
.who{color:var(--slate);font-size:15px}
blockquote{margin:0;padding:10px 12px;border-left:3px solid var(--line);color:var(--slate);font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
.draft{font-size:16.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.pic{width:100%;max-height:320px;object-fit:cover;border-radius:12px;background:var(--panel)}
.lbl{font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--slate);margin-bottom:-6px}
textarea{width:100%;min-height:140px;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px;line-height:1.45;resize:vertical}
input[type=text],input[type=tel],input[type=date]{width:100%;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px}
.gcard{margin:18px 0 0;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}.gcard .gh{display:flex;gap:12px;align-items:flex-start}.gcard .gh svg{width:22px;height:22px;color:var(--ok);flex:none;margin-top:2px}.gcard .gh b{display:block}.gcard .gh span{display:block;color:var(--slate);font-size:15px}.gcard details{margin-top:10px}.gcard summary{cursor:pointer;font-weight:600;font-size:15px;min-height:44px;display:flex;align-items:center}.gcard ul{margin:8px 0 6px;padding-left:18px;font-size:15px}.cg{display:inline-flex;align-items:center;gap:6px;font:600 15px var(--body);color:var(--ok);background:var(--ok-soft);border-radius:99px;padding:4px 10px;justify-self:start}
.cg svg{width:15px;height:15px}
.hits{background:var(--sign-soft);border-radius:12px;padding:10px 12px;font-size:15px}
.hits b{display:block;margin-bottom:4px}
.hits ul{margin:0;padding-left:18px}
mark{background:transparent;color:var(--sign);font-weight:700}
.acts{display:flex;flex-wrap:wrap;gap:8px}
.btn{min-height:46px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px solid transparent;padding:10px 18px;font-weight:700;font-size:16px;text-decoration:none;background:none}
a.btn{color:inherit}
.btn.small{min-height:38px;padding:6px 14px;font-size:15px}
.btn.ok{background:var(--ok);color:var(--on-ok);flex:1 1 auto}
.btn.red{background:var(--sign);color:var(--on-sign)}
.btn.line{border-color:var(--ink)}
.btn.ghost{color:var(--slate);border-color:var(--line)}
.btn.sure{border-color:var(--sign);color:var(--sign)}
.btn[disabled]{opacity:.55;cursor:default}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:18px;padding:22px 18px;text-align:center;display:grid;gap:6px;justify-items:center}
.empty b{font:800 1.15rem var(--display);font-stretch:92%}
.empty span{color:var(--slate);font-size:15px;max-width:34ch}
.empty svg{width:44px;height:44px;color:var(--ok)}
.done{display:grid;gap:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.done div{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:12px 14px;border-top:1px solid var(--line);font-size:15px}
.done div:first-child{border-top:0}
.done i{grid-row:span 2;width:10px;height:10px;border-radius:50%;margin-top:6px;background:var(--ok)}
.done i.skip{background:var(--line)}
.done span{color:var(--slate);font-size:15px}
.done p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.banner{display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center;background:var(--card);border:1.5px solid var(--sign);border-radius:16px;padding:12px 14px;margin:0 0 16px;font-size:15px}
.banner b{display:block;font-size:15px}
.banner .x{border:0;background:none;color:var(--slate);font-size:22px;width:36px;height:36px;line-height:1}
.months{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;margin:0 -2px 10px;scrollbar-width:none}
.months::-webkit-scrollbar{display:none}
.seg{display:flex;gap:6px;margin:4px 0 18px;padding:4px;border:1.5px solid var(--line);border-radius:14px;background:var(--card);position:sticky;top:0;z-index:5}.segb{flex:1;min-width:0;border:0;background:transparent;border-radius:10px;padding:9px 4px;min-height:44px;font-weight:600;font-size:15px;color:inherit;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}.segb[aria-selected=true]{background:var(--ink);color:var(--paper)}.msg{overflow-x:auto;scrollbar-width:none}.msg::-webkit-scrollbar{display:none}.msg .segb{flex:none;padding:9px 13px;white-space:nowrap}.segn{font-style:normal;font-size:12px;min-width:18px;padding:1px 5px;border-radius:99px;background:#D92D20;color:#fff}@media(max-width:360px){.segb{font-size:15px}}
.mchip{flex:none;border:1.5px solid var(--line);background:var(--card);border-radius:99px;padding:7px 14px;font-weight:600;font-size:15px}
.mchip[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:2px;align-content:start}
.tile b{font:850 1.9rem/1.05 var(--display);font-stretch:92%}
.tile span{color:var(--slate);font-size:15px}
.tile em{font-style:normal;font:500 12.5px var(--mono);margin-top:4px}
.up{color:var(--ok)}.down{color:var(--slate)}
.note{color:var(--slate);font-size:15px;margin:10px 2px 0}
.gm{margin:6px 0 0;font:400 12px Roboto,system-ui,-apple-system,sans-serif;letter-spacing:normal;color:#FFFFFF;white-space:nowrap}
.uplist{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:14px}.up{padding-top:12px;border-top:1px solid var(--line)}.uph{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}.fitrow{display:flex;align-items:center;gap:10px}.fitbar{flex:1;height:8px;border-radius:99px;background:var(--line);overflow:hidden}.fitbar i{display:block;height:100%;background:var(--sign);border-radius:99px}.why{margin:8px 0 8px 18px;padding:0;font-size:15px;display:grid;gap:4px}
.cblist{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:10px}.cbrow{display:grid;gap:8px;padding:10px 0;border-top:1px solid var(--line)}.cbrow .fine{display:block}.cbrow .acts{display:flex;flex-wrap:wrap;gap:8px}
.feature{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;display:grid;gap:10px;margin-top:14px}.reflist{list-style:none;padding:0;margin:0;display:grid;gap:6px}.reflist li{display:flex;justify-content:space-between;gap:10px;font-size:15px}.reflist span{opacity:.75;text-align:right}
.feature h3{margin:0;font:800 1.1rem var(--display);font-stretch:92%}
.refhome{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 16px;margin:0 0 14px;display:grid;gap:8px}.refhome.news{border-color:rgba(255,106,94,.45)}.refhome p{margin:0;font-size:15px}.refhome .acts{display:flex;align-items:center;justify-content:space-between;gap:10px}.refhome .x{min-width:44px;min-height:44px;border:0;background:transparent;color:var(--slate);font-size:22px;cursor:pointer;border-radius:10px}
.money{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px;display:grid;gap:8px}.money.on{border-color:rgba(255,106,94,.55);box-shadow:var(--glow)}
.money .mh{font:600 15px var(--mono);color:var(--slate);margin:0}.money .mv{font:850 2.4rem/1 var(--display);font-stretch:92%;color:var(--sign);margin:2px 0 0}.money .mv small{display:block;font:600 15px/1.3 var(--body);color:var(--slate);margin-top:4px}
.money .mr{color:var(--slate);font-size:15px;margin:0}.money details summary{cursor:pointer;color:var(--slate);font-size:15px;min-height:44px;display:flex;align-items:center}.money details summary::before{content:'\\25B8';margin-right:6px;font-size:12px}.money details[open] summary::before{content:'\\25BE'}.money details p{margin:0 0 6px;font-size:15px}
.feature p{margin:0;color:var(--slate);font-size:15px}
.recs{display:grid;gap:10px}
.rec{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;text-decoration:none;color:inherit}
.rec b{font-size:16px}
.rec span{color:var(--slate);font-size:15px;display:block}
.rec svg{width:20px;height:20px;color:var(--slate);flex:none}
.quick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:6px}
.qt{display:grid;gap:4px;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;min-height:92px;align-content:start}
.qt svg{width:24px;height:24px;color:var(--sign)}
.qt b{font-size:15.5px}
.qt span{color:var(--slate);font-size:15px;line-height:1.3}
.thread{display:grid;gap:8px;margin:6px 0 14px}
.msg{max-width:84%;padding:10px 13px;border-radius:16px;font-size:15.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.in{justify-self:end;background:var(--ink);color:var(--paper);border-bottom-right-radius:5px}
.msg.out{justify-self:start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:5px}
.msg small{display:block;font:500 11px var(--mono);opacity:.7;margin-top:4px}
.compose{display:grid;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px}
.compose textarea{min-height:90px;background:var(--paper)}
.fine{color:var(--slate);font-size:15px;margin:0}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;display:grid;grid-template-columns:repeat(4,1fr);background:color-mix(in srgb,var(--card) 94%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--line);padding:6px max(6px,env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(6px,env(safe-area-inset-left,0px))}
.tab{position:relative;display:grid;justify-items:center;gap:2px;border:0;background:none;color:var(--slate);padding:6px 2px;min-height:54px;border-radius:12px;font:600 12px var(--body)}
.tab svg{width:25px;height:25px}
.tab[aria-current=page]{color:var(--sign);text-shadow:0 0 12px rgba(255,106,94,.55)}
.tab[aria-current=page] svg{filter:drop-shadow(0 0 6px rgba(255,106,94,.65))}
.tab[hidden]{display:none}
.tabs.five{grid-template-columns:repeat(5,1fr)}
.call{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px;display:grid;gap:10px}
.call.urgent{border:2px solid var(--sign)}
.call.handled{opacity:.78}
.call .top2{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 10px}
.call .nm{font:800 1.2rem/1.15 var(--display);font-stretch:92%}
.call .num{font:500 15px var(--mono);color:var(--slate)}
.call .sum{font-size:16.5px;margin:0}
.call .meta{display:grid;gap:2px;font-size:15px;color:var(--slate)}
.call .meta b{color:var(--ink);font-weight:600}
.chip.urgent{background:var(--sign);color:var(--on-sign)}
.chip.missed{background:var(--warn-soft);color:var(--warn)}
.chip.ok{background:var(--ok-soft);color:var(--ok)}
.call details{border-top:1px solid var(--line);padding-top:8px}
.call summary{cursor:pointer;font-weight:600;font-size:15px;color:var(--slate);min-height:44px;display:flex;align-items:center}
.said{display:grid;gap:6px;margin-top:8px}
.said p{margin:0;font-size:15px;padding:8px 11px;border-radius:12px;max-width:90%}
.said p.ai{background:var(--panel);justify-self:start}
.said p.caller{background:var(--ink);color:var(--paper);justify-self:end}
.said p.held{background:none;color:var(--slate);font-size:15px;font-style:italic;padding:0 11px;justify-self:start}
.said small{display:block;font:500 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin-bottom:2px}
.badge{position:absolute;top:2px;left:calc(50% + 6px);min-width:20px;height:20px;border-radius:99px;background:var(--sign);color:var(--on-sign);font:700 12px/20px var(--body);font-style:normal;padding:0 6px}
.toast{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translate(-50%,20px);opacity:0;pointer-events:none;background:var(--ink);color:var(--paper);padding:11px 18px;border-radius:12px;font-weight:600;font-size:15px;transition:.2s;z-index:9;max-width:calc(100% - 32px);text-align:center}
.toast.on{opacity:1;transform:translate(-50%,0)}
.scrim{position:fixed;inset:0;z-index:8;background:rgba(10,12,18,.55);display:flex;align-items:flex-end;justify-content:center}
.scrim[hidden]{display:none}
.topr{display:flex;gap:8px;align-items:center}.katie{min-height:48px;padding:8px 12px;font-size:16px;white-space:nowrap}#refresh{width:48px;height:48px}
.call.example{opacity:.6;border-style:dashed}.big3 b{font-size:2rem}
#view p:not(.fine):not(.note):not(.sample){font-size:17px}#view .said p{font-size:17px}#view small{font-size:13px}#view span{font-size:max(15px,1em)}
#view .btn,#view input,#view select,#view button.chip{min-height:48px}#view button.chip{font-size:15px;padding-left:14px;padding-right:14px}#view .chip{font-size:15px}.big3 span{font-size:16px}
.sheet.full{width:100%;height:100%;max-height:100%;border-radius:0;grid-template-rows:auto 1fr auto;padding-top:calc(14px + env(safe-area-inset-top,0px))}
.maptop{display:flex;align-items:center;justify-content:space-between;gap:12px}.close48{min-height:48px;min-width:96px}
.mapfull{border-radius:14px;overflow:hidden;min-height:300px;position:relative;background:#1A2030}
.mapbox{height:260px;border-radius:14px;overflow:hidden;position:relative;background:#1A2030;cursor:pointer;border:1px solid var(--line)}
.mapgl{position:absolute!important;inset:0;width:100%;height:100%}.mapbox .maplibregl-ctrl-attrib{font-size:11px}
.mapc .btn{min-height:48px}.mapc .switch{padding:6px 0}.mapc .switch i{top:10px}
.feature .mapline{margin:0;font-size:17px;line-height:1.4;color:var(--ink)}
.mapfb{position:absolute;inset:0;background:#232A3A;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:32px 32px}
.mapfb .mdot,.mapfb .mpin{position:absolute;transform:translate(-50%,-50%)}.mapfb .mpin{transform:translate(-50%,-100%)}
.mtap{width:48px;height:48px;padding:0;border:0;background:none;display:grid;place-items:center}.mhold{display:grid;place-items:center}
.mdot{display:block;font:800 10px/1 var(--display);letter-spacing:.12em;color:var(--sign);background:rgba(0,0,0,.6);border:1.5px solid var(--sign);border-radius:5px;padding:3px 5px;box-shadow:0 0 8px rgba(255,106,94,.7),inset 0 0 6px rgba(255,106,94,.25);text-shadow:0 0 6px rgba(255,106,94,.9);animation:mhum 2.2s ease-in-out infinite alternate}
.mtap .mdot{font-size:12px;padding:4px 7px}.mhold:nth-child(2n) .mdot{animation-delay:-.7s}.mhold:nth-child(3n) .mdot{animation-delay:-1.3s}
@keyframes mhum{from{opacity:.65;box-shadow:0 0 3px rgba(255,106,94,.4)}to{opacity:1;box-shadow:0 0 12px rgba(255,106,94,.95),inset 0 0 6px rgba(255,106,94,.3)}}
@media (prefers-reduced-motion:reduce){.mdot{animation:none}}
.mpin{display:grid;justify-items:center;pointer-events:none}.mpin b{background:var(--sign);color:var(--on-sign);font:800 15px var(--display);padding:4px 10px;border-radius:99px;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.mpin i{width:3px;height:12px;background:var(--sign)}.mpin.off b{background:var(--slate)}.mpin.off i{background:var(--slate)}
.maplibregl-popup-content{background:var(--card);color:var(--ink);font:600 16px var(--body);border-radius:10px;padding:10px 12px}.maplibregl-popup-tip{border-top-color:var(--card)!important;border-bottom-color:var(--card)!important}
.sheet{width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--card);border-radius:22px 22px 0 0;padding:20px max(18px,env(safe-area-inset-right,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px));display:grid;gap:12px}
.sheet h2{margin:0;font-size:1.35rem}
.sheet label{display:grid;gap:6px;font-weight:600;font-size:15px}
input[type=file]{min-height:44px;padding:9px 0;font-size:15px}
.check{display:grid!important;grid-template-columns:24px 1fr;gap:10px!important;align-items:start;font-weight:500!important}
.check input{width:22px;height:22px;margin:1px 0 0;accent-color:var(--ok)}
.qrbox{background:#fff;border-radius:16px;padding:14px;justify-self:center;width:min(300px,80vw)}
.qrbox svg{display:block;width:100%;height:auto}
.prev{max-width:100%;max-height:260px;border-radius:12px;justify-self:center;object-fit:contain}
.loading{display:flex;gap:6px;justify-content:center;padding:60px 0}
.loading span{width:9px;height:9px;border-radius:50%;background:var(--slate);animation:b 1s infinite ease-in-out}
.loading span:nth-child(2){animation-delay:.15s}.loading span:nth-child(3){animation-delay:.3s}
@keyframes b{0%,80%,100%{opacity:.25}40%{opacity:1}}
/* home, reviews, Max */
${CLOCK_CSS}${CLOCK_ANIM_CSS}
.clock{--clk-ink:#fff;--clk-mute:var(--slate);--clk-line:rgba(255,255,255,.07);--clk-night:rgba(255,90,77,.18);--clk-ok:var(--ok);--clk-sign:var(--sign);background:var(--card);border:1px solid rgba(255,106,94,.4);border-radius:20px;padding:14px 16px 12px;margin:0 0 14px;display:grid;gap:6px;box-shadow:var(--glow)}
.clock .ch{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.clock .ch b{font:800 1.15rem/1.15 var(--display);font-stretch:92%}.clock .ch span{font:500 12px var(--mono);color:var(--slate)}
.clock .clk{margin:0 auto;width:min(280px,100%)}.clock .clk .clk-big{font-family:var(--display);font-stretch:92%}
.clock .one{margin:4px 0 0;padding:10px 12px;border-radius:12px;background:rgba(255,90,77,.08);border:1px solid rgba(255,106,94,.4);font-size:15px;line-height:1.35}.clock .one b{color:var(--sign)}
.clock .cl{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0;padding:0;list-style:none;font-size:15px;color:var(--slate)}.clock .cl b{color:var(--ink);font-weight:600}
.clock .acts{margin-top:4px}
.clock.onair{border-color:var(--sign)}.clock .ch .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sign);margin-right:6px;box-shadow:0 0 8px var(--sign);animation:clkDot 1.4s ease-in-out infinite}@keyframes clkDot{0%,100%{opacity:1}50%{opacity:.35}}
.evl .row .meta b{color:var(--sign)}
.hero{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;background:var(--card);border:2px solid var(--sign);border-radius:20px;padding:16px;margin:0 0 18px;box-shadow:var(--glow)}
.hero.off{border-color:var(--line);box-shadow:none}
.sign{display:grid;justify-items:center;gap:3px;padding:9px 12px 7px;border:2.5px solid var(--sign);border-radius:12px;color:var(--sign);box-shadow:0 0 16px rgba(255,90,77,.45),inset 0 0 10px rgba(255,90,77,.2)}
.sign b{font:800 1.4rem/1 var(--display);letter-spacing:.14em;margin-right:-.14em;text-shadow:0 0 12px rgba(255,106,94,.9)}
.sign span{font:500 12px var(--mono);letter-spacing:.16em;margin-right:-.22em;white-space:nowrap}
.hero.off .sign{color:var(--slate);border-color:var(--line);box-shadow:none}.hero.off .sign b{text-shadow:none}
button.sign{font:inherit;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s}button.sign:active{transform:scale(.95)}button.sign:focus-visible{outline:2px solid var(--sign);outline-offset:3px}
@keyframes aoOn{0%{opacity:.35}8%{opacity:1}14%{opacity:.2}30%{opacity:.95}38%{opacity:.3}52%,100%{opacity:1}}@keyframes aoBreath{0%,100%{box-shadow:0 0 14px rgba(255,90,77,.4),inset 0 0 9px rgba(255,90,77,.18)}50%{box-shadow:0 0 22px rgba(255,90,77,.55),inset 0 0 12px rgba(255,90,77,.26)}}@media (prefers-reduced-motion:no-preference){.hero:not(.off) .sign{animation:aoOn 1.1s linear 1,aoBreath 4.4s ease-in-out 1.4s infinite}}
.hero-t{display:grid;gap:4px;min-width:0}
.mnow{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;margin:0 0 14px}.mnow-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.mnow-h b{font:800 1.15rem/1.15 var(--display);font-stretch:92%}.mnow-h span{font-size:15px;color:var(--slate)}.mnow-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin-top:10px}.mnow-g div{display:grid}.mnow-g b{font:850 1.6rem/1 var(--display);font-stretch:90%}.mnow-g span{font-size:15px;font-weight:600}.mnow-g small{font-size:12px;color:var(--slate)}.mnow-w{margin:10px 0 0;font-size:15px}.ins{margin:6px 0 0;padding-left:20px}.ins li{margin:4px 0;font-size:15px}.mnow-w b{color:var(--sign)}
@media (min-width:700px){.mnow-g{grid-template-columns:repeat(4,minmax(0,1fr))}}
.hero-t b{font:800 1.15rem/1.15 var(--display);font-stretch:92%}
.hero-t span{color:var(--slate);font-size:15px}
.hero-t span.sm{font-size:15px;margin-top:2px}
.hero-t .acts{margin-top:6px}
.btn.sm{min-height:44px;padding:8px 14px;font-size:15px}
.list{display:grid;gap:8px}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;text-align:left;width:100%;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;color:inherit;font:inherit}
.row>svg:first-child{width:24px;height:24px;color:var(--sign)}
.row b{display:block;font-size:16px}.row span{color:var(--slate);font-size:15px}
.row>svg:last-child{width:20px;height:20px;color:var(--slate)}
.empty.slim{padding:16px}
.card.glow{border:2px solid var(--sign);box-shadow:var(--glow)}
.sw{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sw b{display:block;font:800 1.1rem var(--display);font-stretch:92%}.sw span{color:var(--slate);font-size:15px}
.switch{width:60px;height:36px;margin:4px 0;border-radius:99px;border:0;background:var(--line);position:relative;flex:none;padding:0;box-sizing:content-box;background-clip:content-box;padding:4px 0}
.switch i{position:absolute;top:8px;left:4px;width:28px;height:28px;border-radius:50%;background:var(--slate);transition:left .2s}
.switch[aria-checked=true]{background:var(--ok)}
.switch[aria-checked=true] i{left:28px;background:#fff}
.switch[disabled]{opacity:.45;cursor:default}
.form label{display:grid;gap:6px;font-weight:600;font-size:15px}
.form textarea{min-height:110px}
.sample{margin:0 0 12px;padding:9px 12px;border-radius:12px;border:1px dashed var(--line);background:var(--soft,transparent);font-size:15px;color:var(--slate)}.sample b{color:var(--ink)}.vers{margin-top:10px;display:grid;gap:10px}.ver{border:1px dashed var(--line);border-radius:12px;padding:10px}.ver .btn{margin-top:8px}
select{width:100%;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px;color:var(--ink)}
.form details summary{cursor:pointer;font-weight:600;color:var(--slate);min-height:44px;display:flex;align-items:center}
.score .big{display:grid;justify-items:start;gap:2px}
.score .big b{font:850 3rem/1 var(--display);font-stretch:92%}
.trend{width:100%;height:auto;display:block;margin-top:8px}
.trend-l{display:flex;justify-content:space-between;color:var(--slate);font:500 11px var(--mono);letter-spacing:.06em;text-transform:uppercase}
.feature.locked{border-style:dashed}
.chip.warn{background:var(--warn-soft);color:var(--warn)}
.card.fu.due{border:2px solid var(--sign);box-shadow:var(--glow)}
.fu-t{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.fu-t b{font:800 1.15rem var(--display);font-stretch:92%}
.fu-t span{font:500 15px var(--mono);color:var(--slate)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (min-width:700px){.tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.quick{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (min-width:760px){.tabs{grid-template-columns:repeat(4,minmax(0,170px));justify-content:center}.tabs.five{grid-template-columns:repeat(5,minmax(0,140px))}.top{padding-left:calc((100% - 680px) / 2 + 16px);padding-right:calc((100% - 680px) / 2 + 16px)}}
`;

const JS = `
${CLOCK_JS}${CLOCK_ANIM_JS}
(function(){
'use strict';
var S=null,TAB='today',EDIT={},VERS={},MONTH='',LOADING=false,DEFER=null,DIRTY=false;
var $=function(s){return document.querySelector(s);};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){return null;}}
function toast(t){var el=$('#toast');el.textContent=t;el.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(function(){el.classList.remove('on');},2600);}
function api(path,opt){return fetch(BASE+'/api/'+path,opt||{}).then(function(r){return r.json().catch(function(){return {ok:false,error:'Something went wrong.'};}).then(function(j){return {status:r.status,j:j};});});}
function post(path,obj){return api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});}
function when(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return '';var now=new Date(),same=d.toDateString()===now.toDateString();return same?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+', '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
function stars(n){n=Math.max(0,Math.min(5,Math.round(+n||0)));return n?'\\u2605\\u2605\\u2605\\u2605\\u2605'.slice(0,n)+'\\u2606\\u2606\\u2606\\u2606\\u2606'.slice(0,5-n):'';}
var ICON={check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 shield:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-3 7.9-7 9.5-4-1.6-7-5.2-7-9.5V6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 12l2.4 2.4 4.6-4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 chev:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
 cal:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
 job:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
 cam:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3.5l1.8-2.5h5.4L16.5 8H20v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13.3" r="3.3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
 phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.9 5.9l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.6 5.5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'};

function name(){return store('ao_by')||'';}
function needName(cb){
  if(name()){cb(name());return;}
  sheet('<h2>What is your first name?</h2><p class="fine">So your record shows who approved what. Asked once on this phone.</p><label>First name<input type="text" id="nm" autocomplete="given-name" maxlength="40"></label><div class="acts"><button class="btn ok" type="button" id="nm-ok">Save</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  var i=$('#nm');setTimeout(function(){i.focus();},60);
  function done(){var v=i.value.trim();if(!v){i.focus();return;}store('ao_by',v.slice(0,40));close();cb(v);}
  $('#nm-ok').onclick=done;i.onkeydown=function(e){if(e.key==='Enter')done();};
}
function sheet(html,kind){var s=$('#scrim');s.innerHTML='<div class="sheet'+(kind?' '+kind:'')+'" role="dialog" aria-modal="true">'+html+'</div>';s.hidden=false;}
function close(){var s=$('#scrim');if(MAPF){try{MAPF.remove();}catch(e){}MAPF=null;}s.hidden=true;s.innerHTML='';}

/* Automatic refreshes (every minute, every few seconds during a live call, coming back to the app) rebuild the page,
   so they wait while the owner is typing: any field on the page that has focus, or that they changed and haven't
   saved. Works for every field, whatever it is called; a refresh they ask for (the button, pull down) still runs. */
var TOUCHED=[];
function unsaved(el){
  if(el.tagName==='SELECT'){var d=null;for(var i=0;i<el.options.length;i++)if(el.options[i].defaultSelected){d=el.options[i];break;}d=d||el.options[0];return !!d&&!d.selected;}
  if(el.type==='checkbox'||el.type==='radio')return el.checked!==el.defaultChecked;
  if(el.type==='file')return !!(el.files&&el.files.length);
  return el.value!==el.defaultValue;
}
function editing(){
  var a=document.activeElement;
  if(a&&a!==document.body&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!/^(button|submit|reset|hidden)$/i.test(a.type||''))return true;
  for(var i=0;i<TOUCHED.length;i++){var el=TOUCHED[i];if(document.contains(el)&&unsaved(el))return true;}
  return false;
}
function autoLoad(){if(document.visibilityState!=='visible'||editing()){livePoll();return;}load(true,true);}
function load(quiet,auto){
  if(LOADING)return;LOADING=true;
  var r=$('#refresh');r.classList.add('spin');
  api('state').then(function(res){
    LOADING=false;r.classList.remove('spin');$('#offline').hidden=true;
    if(!res.j.ok){if(res.status===404||res.status===429){$('#view').innerHTML='<div class="empty"><b>This link is not working</b><span>'+esc(res.j.error||'')+'</span></div>';}else if(!quiet)toast(res.j.error||'Could not load. Try again.');return;}
    if(auto&&editing()){livePoll();return;}   /* they started typing while it loaded: keep what they typed */
    S=res.j;if(S.client&&S.client.business)$('#biz').textContent=S.client.business;
    if(!MONTH&&S.months&&S.months.length)MONTH=S.months[0].month;
    render();
  }).catch(function(){LOADING=false;r.classList.remove('spin');$('#offline').hidden=false;if(!S)$('#view').innerHTML='<div class="empty"><b>No connection</b><span>Check your signal, then tap refresh.</span></div>';});
}

function hasMax(){return !!(S&&S.features&&(S.features.line||S.features.calls));}
var KEEP=['msg','lh','lo','lt','lw','lg'];
function render(){clearTimeout(render.clk);render.clk=setTimeout(function(){try{aoClockTick();aoClockAnim();}catch(e){}},0);
  var hm=hasMax();if(S&&isTech()&&(TAB==='customers'||TAB==='money'))TAB='today';
  var bs=document.querySelectorAll('.tab');for(var i=0;i<bs.length;i++){if(bs[i].dataset.tab===TAB)bs[i].setAttribute('aria-current','page');else bs[i].removeAttribute('aria-current');}
  var n=S&&S.items?S.items.length:0,bd=$('#badge');bd.hidden=!n;bd.textContent=n>99?'99+':n;
  var ct=document.querySelector('.tab[data-tab="max"]');['customers','money'].forEach(function(k){var b=document.querySelector('.tab[data-tab="'+k+'"]');if(b)b.hidden=!!(S&&isTech());});document.querySelector('.tabs').classList.toggle('five',false);
  if(S&&S.line){var lb=ct.querySelector('span');if(lb)lb.textContent=S.line.name;}
  var nc=hm&&S?(S.calls||[]).filter(function(c){return c.status!=='handled';}).length:0,cb=$('#cbadge');cb.hidden=!nc;cb.textContent=nc>99?'99+':nc;
  if(!S)return;
  var v={today:vToday,customers:vCustomers,money:vMoney,max:vMax}[TAB]||vToday;
  // what they were typing survives a refresh
  var keep={},act=document.activeElement;KEEP.forEach(function(k){var el=document.getElementById(k);if(el)keep[k]={v:el.value,f:act===el};});
  $('#view').innerHTML=sampleBar()+v();
  TOUCHED=TOUCHED.filter(function(el){return document.contains(el);});
  KEEP.forEach(function(k){var el=document.getElementById(k);if(!el||!keep[k])return;if(k==='msg'||DIRTY)el.value=keep[k].v;if(keep[k].f)el.focus({preventScroll:true});});
  if(!$('#scrim').hidden){var th=$('#scrim .thread');if(th&&th.lastElementChild)th.lastElementChild.scrollIntoView({block:'nearest'});}
  var si=$('#sidx');if(si){var hs=document.querySelectorAll('#view h2, #view .feature>h3');var out='';for(var j=0;j<hs.length;j++){var hd=hs[j],tt=hd.textContent.trim();if(!tt||tt.length>28)continue;hd.id=hd.id||('s-'+j);out+='<a href="#'+hd.id+'" data-a="jump" data-to="'+hd.id+'">'+esc(tt)+'</a>';}si.innerHTML=out;}
  var nb=$('#badge');if(nb&&nb.textContent!==LASTB){if(LASTB!=null){nb.classList.add('pop');setTimeout(function(){nb.classList.remove('pop');},300);}LASTB=nb.textContent;}
  mapSlot();
  livePoll();
}
var LASTB=null,LIVET=null;
function livePoll(){clearTimeout(LIVET);if(!hasMax())return;var ms=(S.live&&S.live.length)?6000:(TAB==='today'?30000:0);if(ms)LIVET=setTimeout(autoLoad,ms);}

/* ---------- Home ---------- */
function greet(){var h=new Date().getHours();return h<12?'Good morning':(h<17?'Good afternoon':'Good evening');}
function row(go,icon,title,sub){return '<button class="row" type="button" data-go="'+go+'">'+icon+'<div><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div>'+ICON.chev+'</button>';}
function qt(a,icon,title,sub){return '<button class="qt" type="button" data-a="'+a+'">'+icon+'<b>'+esc(title)+'</b><span>'+esc(sub)+'</span></button>';}
function sampleBar(){if(!S||!S.sample)return '';return '<div class="sample" role="note"><b>Sample data.</b> Everything on this screen is made up so you can see the app working. Names and numbers are fictional.'+(TAB==='home'&&S.sampleWeekly?'<br>Sample weekly note: '+esc(S.sampleWeekly):'')+'</div>';}
var FL=null,FLASKED=false;
function flCard(){
  if(!S.firstLookDue)return '';
  if(!FLASKED){FLASKED=true;post('firstlook',{}).then(function(res){FL=(res.j&&res.j.firstLook)||{none:true};render();}).catch(function(){FL={none:true};render();});}
  if(!FL)return '<div class="feature"><h3>Your first look</h3><p class="fine">Looking you up on Google\u2026</p></div>';
  if(FL.none)return '';
  var h='<div class="feature fl">';
  if(FL.found){h+='<p class="fine">Your first look</p><h3>Your score: '+FL.score+' ('+esc(FL.grade)+')</h3>'+(FL.finding?'<p><b>What holds you back most:</b> '+esc(FL.finding.title)+'. '+esc(FL.finding.saw)+'</p><p class="fine">'+esc(FL.finding.fix)+'</p>':'<p>Nothing big is holding you back. We keep it that way.</p>')+'<p class="gm">Google Maps</p>';}
  var t=FL.today||{};
  h+='<div'+(FL.found?' style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"':'')+'><p class="fine">The one thing we\u2019ll do today</p><h3>'+esc(t.title||'')+'</h3><p>'+esc(t.detail||'')+'</p>'+(t.link?'<p class="fine" style="word-break:break-all">'+esc(t.link)+'</p>':'')+'</div>';
  h+='<div class="acts">'+(t.help?'<a class="btn line" href="'+BASE+t.help+'">Show me how</a>':'')+'<button class="btn ghost" type="button" data-a="fl-done">Got it</button></div></div>';
  return h;
}
function shareCard(){
  var s=S.share;if(!s)return '';
  var sms='sms:?&body='+encodeURIComponent(s.message),mail='mailto:?subject='+encodeURIComponent('Something that helped my business')+'&body='+encodeURIComponent(s.message);
  return '<div class="feature"><h3>A good '+esc(s.month)+'</h3><p>Know an owner who\u2019d want the same? Here\u2019s a note you can send. Nothing goes out unless you send it.</p><p class="fine" style="white-space:pre-wrap">'+esc(s.message)+'</p>'+
    '<div class="acts" style="flex-wrap:wrap;gap:8px"><button class="btn line small" type="button" data-a="sh-copy">Copy</button><a class="btn line small" href="'+esc(sms)+'">Text it</a><a class="btn line small" href="'+esc(mail)+'">Email it</a><button class="btn ghost small" type="button" data-a="sh-done">Not now</button></div></div>';
}
var SEG='today';try{var sv=localStorage.getItem('ao-seg');if(sv&&/^(today|customers|results|settings)$/.test(sv))SEG=sv;}catch(x){}
function segBar(n){
  var L=[['today','Today'],['customers','Customers'],['results','Results'],['settings','Settings']];
  if(isTech())L=L.filter(function(x){return x[0]!=='settings'&&x[0]!=='results';});
  return '<div class="seg" role="tablist" aria-label="Home">'+L.map(function(x){var on=x[0]===SEG;return '<button type="button" role="tab" class="segb" data-seg="'+x[0]+'" aria-selected="'+on+'">'+x[1]+(x[0]==='today'&&n?'<i class="segn">'+(n>99?'99+':n)+'</i>':'')+'</button>';}).join('')+'</div>';
}
function inboxRow(){return '<h2>Inbox</h2><div class="list"><button class="row" type="button" data-a="bz-inbox">'+ICON.check+'<div><b>All your messages in one place</b><span>Requests, bookings, calls, texts and Google reviews</span></div>'+ICON.chev+'</button></div>';}
function fwCard(){
  var W=S.fillWeek;if(!W||!W.on||!W.ready)return '';
  return '<div class="feature"><h3>Fill my week</h3><p>'+(W.last?'Last time: '+W.last.offers+(W.last.offers===1?' offer':' offers')+', '+W.last.booked+' booked. ':'')+'An open day coming up? Offer it to past customers who are due, and the first YES is booked.</p><div class="acts"><button class="btn sm" type="button" data-a="fw-run">Fill my next open day</button></div></div>';
}
// ---------- Today: what needs you first, then Max, then what to do ----------
function closedBanner(){
  var L=S.line;if(!L||!L.closedUntil||Date.parse(L.closedUntil)<Date.now())return '';
  return '<div class="feature closedb"><h3>Closed today</h3><p>'+esc(L.name||'Max')+' is telling callers you’re closed today and taking a message for each one.</p><div class="acts"><button class="btn line sm" type="button" data-a="reopen">We’re open after all</button></div></div>';
}
function isAfter(d){var h=d.getHours(),w=d.getDay();return w===0||w===6||h<8||h>=18;}
function todayStrip(){
  if(!S.line)return '';
  var t=new Date().toDateString(),cs=(S.calls||[]).filter(function(c){return c.at&&new Date(c.at).toDateString()===t;});
  var after=cs.filter(function(c){return isAfter(new Date(c.at));}).length,urg=cs.filter(function(c){return c.urgent;}).length;
  var cell=function(n,l){return '<div><b>'+n+'</b><span>'+l+'</span></div>';};
  return '<div class="tstrip" aria-label="Today so far">'+cell(cs.length,cs.length===1?'call today':'calls today')+cell(after,'after hours')+cell(urg,'urgent')+'</div>';
}
function needsRows(){
  var items=(S.items||[]).length,calls=(S.calls||[]).filter(function(c){return c.status!=='handled';}).length;
  var due=(S.followups||[]).filter(isDue).length,leads=(S.leads||[]).filter(function(l){return l.status==='new';}).length;
  var att=[];
  if(calls)att.push(row('max',ICON.phone,calls+(calls===1?' call to look at':' calls to look at'),'Who called and what they need'));
  if(leads)att.push('<button class="row" type="button" data-a="go-leads">'+ICON.job+'<div><b>'+leads+(leads===1?' new request':' new requests')+'</b><span>From your request and booking page</span></div>'+ICON.chev+'</button>');
  if(items)att.push(row('approve',ICON.check,items+(items===1?' thing':' things')+' to approve','Review replies and posts waiting for your OK'));
  if(due)att.push(row('fu',ICON.cal,due+(due===1?' follow-up':' follow-ups')+' due','Tap to text them'));
  return att;
}
// ---------- Results: the last 30 days ----------
var PULSE=null,PULSE_AT=0;
(function(){var st=document.createElement('style');st.textContent=
'.tstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px}.tstrip div{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:grid;gap:2px}.tstrip b{font:800 1.5rem/1 var(--display)}.tstrip span{color:var(--slate);font-size:15px}'+
'.closedb{border-color:var(--warn)}.closedb h3{color:var(--warn)}'+
'.pulse{gap:14px}.kgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kt{background:var(--panel);border-radius:14px;padding:12px;display:grid;gap:3px;align-content:start}.kt span{color:var(--slate);font-size:12.5px}.kt b{font:800 1.9rem/1 var(--display);letter-spacing:-.01em}.kt small{color:var(--slate);font-size:12px}.kt em{font-style:normal;font-size:12px;font-weight:600;color:var(--slate)}.kt em.up{color:var(--ok)}'+
'.bars{display:flex;align-items:flex-end;gap:2px;height:120px;padding-top:6px;border-bottom:1px solid var(--line)}.bars .bc{flex:1;display:flex;flex-direction:column-reverse;min-width:0;height:100%}.bars .bc span{display:block;background:#3A4458;border-radius:2px 2px 0 0}.bars .bc span.a{background:var(--sign);border-radius:2px 2px 0 0}.bars .bc span.n{border-radius:0}'+
'.bax{display:flex;justify-content:space-between;color:var(--slate);font:500 11px var(--mono);margin-top:4px}.legend{display:flex;gap:14px;color:var(--slate);font-size:12px;flex-wrap:wrap}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}'+
'.heat{display:grid;grid-template-columns:34px repeat(6,1fr);gap:3px;font:500 11px var(--mono);color:var(--slate)}.heat b{font:inherit;display:flex;align-items:center}.heat u{text-decoration:none;text-align:center}.heat .hc{display:block;aspect-ratio:1.6;border-radius:4px;background:var(--sign)}.heat .hc.o{background:var(--panel)}'+
'.fun{display:grid;gap:8px}.fun div{display:grid;grid-template-columns:110px 1fr 40px;align-items:center;gap:8px;font-size:15px}.fun div>span:first-child{color:var(--slate)}.fun .fb{display:block;height:14px;border-radius:4px;background:var(--sign);min-width:3px}.fun b{text-align:right;font-variant-numeric:tabular-nums}.fun small{grid-column:2/4;color:var(--slate);font-size:11.5px;margin-top:-6px}'+
'.sp{display:grid;grid-template-columns:1fr auto;gap:8px 12px;font-size:15px}.sp span{color:var(--slate)}.sp b{text-align:right}'+
'.chipr{display:flex;flex-wrap:wrap;gap:6px}.chipr span{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--slate)}.chipr b{color:var(--ink)}'+
'.ilist{margin:0;padding-left:18px;display:grid;gap:6px}.nexts{border-left:3px solid var(--sign);padding:4px 0 4px 10px;margin:0}'+
'.ob .obh{display:flex;justify-content:space-between;align-items:baseline}.ob .obh span{color:var(--slate);font-size:15px}.obbar{height:6px;border-radius:3px;background:var(--panel);overflow:hidden}.obbar i{display:block;height:100%;background:var(--sign);border-radius:3px}';
document.head.appendChild(st);})();
function pulseLoad(){
  if(isTech())return;
  if(PULSE&&Date.now()-PULSE_AT<300000)return;
  if(PULSE_AT&&Date.now()-PULSE_AT<15000)return;
  PULSE_AT=Date.now();
  api('pulse').then(function(res){if(res.j&&res.j.ok){PULSE=res.j.pulse;PULSE_AT=Date.now();if(TAB==='money')render();}}).catch(function(){});
}
function md(day){var p=String(day).split('-');return (+p[1])+'/'+(+p[2]);}
function dchg(ch){if(ch==null)return '';if(ch===0)return '<em>Same as the 30 days before</em>';return '<em class="'+(ch>0?'up':'')+'">'+(ch>0?'▲ ':'▼ ')+Math.abs(ch)+' vs the 30 days before</em>';}
function pulseBlock(){
  if(isTech())return '';
  pulseLoad();
  var nm=esc(S.line?S.line.name:'Max');
  if(!PULSE)return '<h2>Your last 30 days</h2><div class="card pulse"><p class="fine">Adding up your last 30 days…</p></div>';
  var P=PULSE,k=P.kpi;
  if(!k.calls.n&&!k.leads.n)return '<h2>Your last 30 days</h2><div class="card pulse"><b>Nothing to count yet</b><p class="note" style="margin:0">After '+nm+'’s first calls, this shows how many came in, when your phone rings most, what they wanted, and how many became work.'+(S.line?' Call '+esc(S.line.numberText)+' to try it.':'')+'</p></div>';
  var tile=function(l,n,sub,ch){return '<div class="kt"><span>'+l+'</span><b>'+n+'</b>'+(sub?'<small>'+sub+'</small>':'')+dchg(ch)+'</div>';};
  var h='<h2>Your last 30 days</h2><div class="card pulse"><div class="kgrid">'+
    tile('Calls answered',k.calls.n,'',k.calls.ch)+
    tile('After hours',k.after.n,k.after.pct+'% of calls',k.after.ch)+
    tile('Real leads',k.leads.n,'calls and requests with a real need',k.leads.ch)+
    (k.won.amount?tile('Work won','$'+Math.round(k.won.amount).toLocaleString('en-US'),k.won.n+(k.won.n===1?' job':' jobs')+' booked, done or paid',null):tile('Booked',k.booked.n,'visits booked by '+nm+' or Fill my week',k.booked.ch))+
    '</div></div>';
  // calls each day
  var mx=1;P.days.forEach(function(d){if(d.calls>mx)mx=d.calls;});
  var busiest=P.days.slice().sort(function(a,b){return b.calls-a.calls;})[0];
  h+='<div class="card"><b>Calls each day</b><div class="bars" role="img" aria-label="Calls each day for the last 30 days">'+P.days.map(function(d){
    var tot=Math.round(d.calls/mx*100),af=d.calls?Math.round(d.after/mx*100):0;
    return '<span class="bc" title="'+md(d.d)+': '+d.calls+(d.calls===1?' call':' calls')+(d.after?', '+d.after+' after hours':'')+'">'+(tot-af>0?'<span class="'+(af?'n':'')+'" style="height:'+(tot-af)+'%"></span>':'')+(af?'<span class="a" style="height:'+af+'%"></span>':'')+'</span>';}).join('')+'</div>'+
    '<div class="bax"><span>'+md(P.days[0].d)+'</span><span>'+md(P.days[14].d)+'</span><span>Today</span></div>'+
    '<div class="legend"><span><i style="background:#3A4458"></i>Business hours</span><span><i style="background:var(--sign)"></i>After hours and weekends</span></div>'+
    (busiest&&busiest.calls?'<p class="note" style="margin:0">Busiest day: '+esc(busiest.wd)+' '+md(busiest.d)+', '+busiest.calls+(busiest.calls===1?' call':' calls')+'.</p>':'')+'</div>';
  // when the phone rings
  var hm=0;P.heat.forEach(function(r){r.forEach(function(v){if(v>hm)hm=v;});});
  var WDL=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],BL=['6–9a','9–12','12–3','3–6','6–9p','Night'];
  h+='<div class="card"><b>When your phone rings</b><div class="heat" role="img" aria-label="Calls by day of week and time of day"><span></span>'+BL.map(function(b){return '<u>'+b+'</u>';}).join('')+
    P.heat.map(function(r,i){return '<b>'+WDL[i]+'</b>'+r.map(function(v,j){return v?'<span class="hc" style="opacity:'+(0.18+0.82*v/hm).toFixed(2)+'" title="'+WDL[i]+' '+BL[j]+': '+v+(v===1?' call':' calls')+'"></span>':'<span class="hc o" title="'+WDL[i]+' '+BL[j]+': none"></span>';}).join('');}).join('')+'</div>'+
    (P.peak?'<p class="note" style="margin:0">Most calls come on '+esc(P.peak.day)+'s, '+esc(P.peak.band)+'. That’s when '+nm+' matters most.</p>':'')+'</div>';
  // from call to job
  var f0=Math.max(1,P.funnel[0][1]);
  h+='<div class="card"><b>From call to job</b><div class="fun">'+P.funnel.map(function(s,i){
    var prev=i?P.funnel[i-1][1]:0,pc=i&&prev?Math.round(s[1]/prev*100):null;
    return '<div><span>'+esc(s[0])+'</span><span class="fb" style="width:'+Math.min(100,Math.round(s[1]/f0*100))+'%"></span><b>'+s[1]+'</b>'+(pc!=null?'<small>'+pc+'% of the step above</small>':'')+'</div>';}).join('')+'</div>'+
    (P.funnel[3][1]===0&&P.funnel[2][1]>0?'<p class="note" style="margin:0">Log finished jobs from Customers and this line fills in.</p>':'')+'</div>';
  // speed and care
  var sp=P.speed,rows=[];
  if(sp.callbacks)rows.push(['Call-backs kept on time',sp.callbacks.kept+' of '+sp.callbacks.set+' ('+sp.callbacks.pct+'%)']);
  if(sp.avgSec)rows.push(['Average call with '+nm,Math.floor(sp.avgSec/60)+':'+('0'+(sp.avgSec%60)).slice(-2)]);
  if(sp.reviews)rows.push(['New reviews',sp.reviews+(sp.rating?' · '+sp.rating+' stars on average':'')]);
  if(sp.replyRate!=null)rows.push(['Reviews replied to',sp.replyRate+'%'+(sp.replyHrs!=null?' · in about '+(sp.replyHrs<1?'under an hour':Math.round(sp.replyHrs)+(Math.round(sp.replyHrs)===1?' hour':' hours')):'')]);
  if(rows.length)h+='<div class="card"><b>How fast you answer</b><div class="sp">'+rows.map(function(r){return '<span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b>';}).join('')+'</div></div>';
  // why callers didn't book
  if(P.lost&&P.lost.n){var lm=Math.max(1,P.lost.top[0]?P.lost.top[0].n:1);
    h+='<div class="card"><b>Why callers didn’t book</b><div class="fun">'+P.lost.top.map(function(x){return '<div><span>'+esc((function(s){s=s.replace(/^said /,'');return s.charAt(0).toUpperCase()+s.slice(1);})(x.label))+'</span><span class="fb" style="width:'+Math.round(x.n/lm*100)+'%"></span><b>'+x.n+'</b></div>';}).join('')+'</div><p class="note" style="margin:0">'+nm+' asks once, when a caller decides not to book. '+P.lost.n+(P.lost.n===1?' caller':' callers')+' answered.</p></div>';}
  // the rest, as chips
  var e=P.extra,ch=[];
  if(e.spanish)ch.push(['Spanish calls',e.spanish]);if(e.urgent)ch.push(['Urgent',e.urgent]);if(e.weekend)ch.push(['Weekend calls',e.weekend]);if(e.transferred)ch.push(['Put through to you',e.transferred]);if(e.textback)ch.push(['Missed-call texts',e.textback]);if(e.handIn)ch.push(['Callers passed to you',e.handIn]);if(e.handOut)ch.push(['Callers you passed on',e.handOut]);if(e.checkinsNo)ch.push(['Problems caught on check-ins',e.checkinsNo]);
  if(ch.length)h+='<div class="chipr">'+ch.map(function(c){return '<span>'+esc(c[0])+' <b>'+c[1]+'</b></span>';}).join('')+'</div>';
  if((P.insights&&P.insights.length)||P.next)h+='<h2>What it means</h2><div class="card">'+(P.insights&&P.insights.length?'<ul class="ilist">'+P.insights.map(function(s){return '<li>'+esc(s)+'</li>';}).join('')+'</ul>':'')+(P.next?'<p class="nexts"><b>One thing to try:</b> '+esc(P.next)+'</p>':'')+'</div>';
  return h;
}

/* ---------- the four screens (Brief 4, Part 3): Today, Customers, Money, Max. No segments, no doors. ---------- */
var NEEDALL=false;
function needCards(){
  var out=[],f=S.features||{};
  var calls=(S.calls||[]).filter(function(c){return c.status!=='handled';}).sort(function(a,b){return (b.urgent?1:0)-(a.urgent?1:0);});
  calls.forEach(function(c){out.push(callCard(c));});
  (S.items||[]).forEach(function(it){out.push(card(it));});
  var due=(S.followups||[]).filter(isDue).sort(function(a,b){return String(a.due||'').localeCompare(String(b.due||''));}).slice(0,3);
  due.forEach(function(x){out.push(fuCard(x));});
  var leads=(S.leads||[]).filter(function(l){return l.status==='new';}).length;
  if(leads)out.push('<div class="card"><b>'+leads+(leads===1?' new request':' new requests')+' from your booking page</b><div class="acts"><button class="btn line" type="button" data-a="go-leads">See who</button></div></div>');
  return out;
}
function todayNums(){
  var t=new Date().toDateString(),cs=(S.calls||[]).filter(function(c){return c.at&&new Date(c.at).toDateString()===t;});
  var after=cs.filter(function(c){return isAfter(new Date(c.at));}).length,bk=cs.filter(function(c){return c.outcome==='booked';}).length;
  var cell=function(n,l){return '<div><b>'+n+'</b><span>'+l+'</span></div>';};
  return '<div class="tstrip big3" aria-label="Today so far">'+cell(cs.length,cs.length===1?'call today':'calls today')+cell(after,'after hours')+cell(bk,'booked')+'</div>';
}
function vToday(){
  var first=(S.me&&S.me.name)||S.client.first||'';
  var h='<h1>'+esc(greet())+(first?', '+esc(first):'')+'</h1>'+reconnectCards()+install()+closedBanner()+liveCard();
  var need=needCards();
  h+='<h2>Needs you</h2>';
  if(!need.length)h+='<div class="empty slim">'+ICON.check+'<b>Nothing needs you right now.</b><span>Your phone buzzes when something does.</span></div>';
  else{h+=(NEEDALL?need:need.slice(0,5)).join('');if(need.length>5)h+='<div class="acts"><button class="btn line" type="button" data-a="need-more">'+(NEEDALL?'Show fewer':(need.length-5)+' more')+'</button></div>';}
  if(S.line)h+='<h2>Today so far</h2>'+todayNums();
  h+=clockCard();
  if(!isTech())h+=monthNowCard();
  var f=S.features||{};
  h+='<h2>Quick</h2><div class="quick">'+(f.jobs?qt('job',ICON.job,'Finished a job','They get one review request'):'')+(f.photos?qt('photo',ICON.cam,'Photo for a post','We write it, you approve it'):'')+
    (f.followups?qt('fu-add',ICON.cal,'Add a follow-up','Quote, invoice or appointment'):'')+qt('closed',ICON.clock,'Closed today',S.line?(S.line.name||'Max')+' tells callers':'We update Google for you')+'</div>';
  h+=flCard();
  return h;
}
function exampleCall(){
  return '<article class="call example" aria-label="Example"><div class="top2"><span class="nm">A caller</span><span class="chip">Example</span></div><p class="sum">Needs a quote for a repair. Wants a call back after 3.</p><div class="acts"><span class="btn ok" aria-disabled="true">Call back</span><span class="btn line" aria-disabled="true">Text</span></div><p class="fine">This is an example. Your real callers show up here.</p></article>';
}
function vCustomers(){
  var h='<h1>Customers</h1>'+mapCard();
  var wk=Date.now()-7*86400000,cs=(S.calls||[]).filter(function(c){return c.at&&Date.parse(c.at)>wk;});
  if(hasMax()||cs.length)h+='<h2>Who called this week</h2>'+(cs.length?cs.map(callCard).join(''):((S.calls||[]).length?'<div class="empty slim"><b>No calls this week</b><span>Callers show up here, newest first.</span></div>':exampleCall()));
  h+=fuBlock()+jobsBlock()+(isTech()?'':(S.client.regulated?'':quotesBlock()+payBlock())+invBlock())+linkBlock()+pastBlock()+inboxRow();
  return h;
}
function vMoney(){
  var f=S.features||{};
  var h='<h1>Money</h1>'+pulseBlock()+moneyCard()+monthBlock()+insightsBlock()+(PULSE&&PULSE.lost&&PULSE.lost.n?'':lostCard())+upCard()+vReviews();
  if(isOwner())h+='<h2>Your account</h2>'+setBlock()+teamBlock();
  h+=metaBlock()+guardCard();
  return h;
}
function katieSheet(){
  sheet('<div class="maptop"><h2>Text Katie</h2><button class="btn line close48" type="button" data-close="1">Close</button></div>'+vAsk().replace('<h1>Ask us</h1>',''));
  var th=$('#scrim .thread');if(th&&th.lastElementChild)th.lastElementChild.scrollIntoView({block:'nearest'});
}
function vHome(){
  var f=S.features||{},first=(S.me&&S.me.name)||S.client.first||'';
  var items=(S.items||[]).length,calls=(S.calls||[]).filter(function(c){return c.status!=='handled';}).length;
  var due=(S.followups||[]).filter(isDue).length;
  if(isTech()&&(SEG==='settings'||SEG==='results'))SEG='today';
  var h='<h1>'+esc(greet())+(first?', '+esc(first):'')+'</h1><p class="lede">Here’s '+esc(S.client.business||'your business')+' today.'+(S.client.tier?' You’re on the <b class="tier">'+esc(S.client.tier)+'</b> plan.':'')+'</p>'+reconnectCards()+segBar(items+calls+due);
  if(SEG==='customers'){
    h+=inboxRow()+jobsBlock()+(isTech()?'':(S.client.regulated?'':quotesBlock()+payBlock())+invBlock())+pastBlock()+linkBlock()+mapCard();
    return h;
  }
  if(SEG==='results'){
    h+=pulseBlock()+moneyCard()+monthBlock()+(f.competitors?rivalCard():'')+insightsBlock()+(PULSE&&PULSE.lost&&PULSE.lost.n?'':lostCard())+shareCard()+(isTech()?'':upCard())+referCard();
    return h;
  }
  if(SEG==='settings'){
    h+='<div class="sidx" id="sidx"></div>'+(isOwner()?setBlock()+teamBlock():'')+metaBlock()+guardCard();
    return h;
  }
  // Today, in order: anything live, what needs you, Max, today so far, quick actions, setup, then the month.
  var mn=S.monthNow,busy=mn&&((+mn.calls||0)+(+mn.reviews||0)+(+mn.booked||0)+(+mn.followups||0))>0;
  var att=needsRows();
  h+=install()+closedBanner()+liveCard();
  if(att.length)h+='<h2>Needs you</h2><div class="list">'+att.join('')+'</div>';
  var quick='<h2>Quick</h2><div class="quick">'+(f.jobs?qt('job',ICON.job,'Finished a job','They get one review request'):'')+(f.photos?qt('photo',ICON.cam,'Photo for a post','We write it, you approve it'):'')+
    (f.followups?qt('fu-add',ICON.cal,'Add a follow-up','Quote, invoice or appointment'):'')+qt('closed',ICON.clock,'Closed today',S.line?(S.line.name||'Max')+' tells callers':'We update Google for you')+qt('hours',ICON.cal,'Holiday or new hours','Tell us the days and times')+'</div>';
  // A brand-new account: Max, then setup. Once calls come in: call-backs, Max, today so far, then quick actions.
  var fresh=!busy&&!(S.calls||[]).length;
  if(fresh)h+=heroCard()+clockCard()+flCard()+bizTop()+quick;
  else h+=cbCard()+heroCard()+clockCard()+todayStrip()+quick+flCard()+bizTop();
  if(busy&&!isTech())h+=monthNowCard()+moneyCard();
  if(!att.length&&busy)h+='<div class="empty slim">'+ICON.check+'<b>All caught up</b><span>We’ll buzz your phone when something needs you.</span></div>';
  h+=(f.followups||busy?fuBlock():'')+fwCard()+moreCard()+(busy?homeRefer():'');
  return h;
}
var UPALL=false;
function upItem(u){
  return '<li class="up"><div class="uph"><b>'+esc(u.name)+'</b><span class="fine">'+esc(u.price)+'</span></div><p class="fine" style="margin:2px 0 6px">'+esc(u.what)+'</p>'+
    '<div class="fitrow"><div class="fitbar" role="img" aria-label="Fit for your business: '+u.fit+' percent"><i style="width:'+u.fit+'%"></i></div><b>'+u.fit+'%</b></div><p class="fine" style="margin:2px 0 0">Fit for your business</p>'+
    '<ul class="why">'+u.why.map(function(w){return '<li>'+esc(w)+'</li>';}).join('')+'</ul>'+
    '<div class="acts"><button class="btn line small" type="button" data-a="up-ask" data-id="'+esc(u.id)+'">Add it</button></div></li>';
}
function upCard(){
  var U=S.upgrades;if(!U||!U.list||!U.list.length)return '';
  var list=U.list.slice(0,1);
  return '<div class="feature" id="upgrades"><h3>One thing to add</h3><p>What fits your business best right now.</p><ul class="uplist">'+list.map(upItem).join('')+'</ul>'+
    '</div>';
}
/* ---------- the live map (Brief 4, Part 1): the map itself on Customers, never a link to it ---------- */
var MLS='',MLQ=[],MAPEL=null,MAPM=null,MAPF=null,MAPD=null,MAPAT=0;
var ML_URL='https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min',MAP_STYLE='https://tiles.openfreemap.org/styles/dark';
function mlLoad(cb){
  if(MLS==='ok'&&window.maplibregl)return cb(true);if(MLS==='fail')return cb(false);
  MLQ.push(cb);if(MLS==='loading')return;MLS='loading';
  var l=document.createElement('link');l.rel='stylesheet';l.href=ML_URL+'.css';document.head.appendChild(l);
  var sc=document.createElement('script'),tm=setTimeout(function(){fin(false);},10000);
  function fin(ok){clearTimeout(tm);if(MLS!=='loading')return;MLS=ok?'ok':'fail';var q=MLQ;MLQ=[];q.forEach(function(f){f(ok);});}
  sc.src=ML_URL+'.js';sc.onload=function(){fin(!!window.maplibregl);};sc.onerror=function(){fin(false);};document.head.appendChild(sc);
}
// six faded spots around the owner, 1.5 to 6 miles out: no names, no trades, no phones
function exDots(lat,lng){var o=[];for(var i=0;i<6;i++){var id='example-'+i,h=0;for(var k=0;k<id.length;k++)h=(h*31+id.charCodeAt(k))>>>0;
  var ang=(i*60+h%37)*Math.PI/180,mi=2+((h*7)%50)/10;o.push([lat+(mi/69)*Math.sin(ang),lng+(mi/(69*Math.cos(lat*Math.PI/180)))*Math.cos(ang)]);}return o;}
function mapData(cb){
  var m=S.map;if(MAPD&&Date.now()-MAPAT<600000&&MAPD.show===m.show)return cb(MAPD);
  var q=m.placed?'?lat='+m.lat+'&lng='+m.lng:'';
  fetch('/api/map'+q).then(function(r){return r.json();}).catch(function(){return {};}).then(function(j){
    var c=m.placed?[m.lat,m.lng]:(j&&j.center?j.center:[33.33,-83.39]);
    var others=(j&&j.enough&&j.businesses?j.businesses:[]).filter(function(b){return b.id!==m.id;}).map(function(b){return {name:b.name,kind:b.kind||'',lat:b.lat,lng:b.lng};});
    MAPD={center:c,others:others,examples:others.length<3,show:m.show,placed:m.placed};
    if(MAPD.examples)MAPD.dots=exDots(c[0],c[1]);
    MAPAT=Date.now();cb(MAPD);
  });
}
function pinEl(you){var e=document.createElement('div');
  if(you){e.className='mpin'+(S.map.show?'':' off');e.innerHTML='<b>You</b><i></i>';}
  else{e.className='mdot';}
  return e;}
function dotEl(ex,full){var d='<span class="mdot'+(ex?' ex':'')+'">OPEN</span>';var e=document.createElement(full?'button':'div');if(full){e.type='button';e.className='mtap';e.setAttribute('aria-label',ex?'Example':'Business');}else{e.className='mhold';}e.innerHTML=d;return e;}
function drawPins(map,D,full){
  (D.examples?D.dots.map(function(d){return {lat:d[0],lng:d[1],ex:true};}):D.others).forEach(function(b){
    var el=dotEl(b.ex,full),mk=new maplibregl.Marker({element:el}).setLngLat([b.lng,b.lat]);
    if(full)mk.setPopup(new maplibregl.Popup({offset:12,closeButton:false}).setText(b.ex?'Example':b.name+(b.kind?' · '+b.kind:'')));
    mk.addTo(map);});
  if(D.placed)new maplibregl.Marker({element:pinEl(true),anchor:'bottom'}).setLngLat([D.center[1],D.center[0]]).addTo(map);
}
// If the map can't load: a grey panel with the owner's pin and the same dots, placed by hand.
function mapFallback(box,D){
  var h='<div class="mapfb" role="img" aria-label="Where you are on the map">';
  var pts=D.examples?D.dots.map(function(d){return {lat:d[0],lng:d[1],ex:1};}):D.others;
  pts.forEach(function(b){var x=50+(b.lng-D.center[1])*Math.cos(D.center[0]*Math.PI/180)*69/12.5*50,y=50-(b.lat-D.center[0])*69/10*50;
    if(x>3&&x<97&&y>3&&y<97)h+='<span class="mdot'+(b.ex?' ex':'')+'" style="left:'+x.toFixed(1)+'%;top:'+y.toFixed(1)+'%">OPEN</span>';});
  if(D.placed)h+='<span class="mpin'+(S.map.show?'':' off')+'" style="left:50%;top:50%"><b>You</b><i></i></span>';
  box.innerHTML=h+'</div>';
}
function mapMake(box,D,full){
  mlLoad(function(ok){
    if(!ok){mapFallback(box,D);return;}
    try{
      var map=new maplibregl.Map({container:box,style:MAP_STYLE,center:[D.center[1],D.center[0]],zoom:full?10.5:10,interactive:!!full,attributionControl:{compact:true}});
      if(full)map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      setTimeout(function(){if(!map.isStyleLoaded()){try{map.remove();}catch(e){}if(full)MAPF=null;else MAPM=null;mapFallback(box,D);}},12000);
      drawPins(map,D,full);
      map.once('load',function(){var a=box.querySelector('.maplibregl-compact-show');if(a)a.classList.remove('maplibregl-compact-show');});
      if(full)MAPF=map;else MAPM=map;
    }catch(e){mapFallback(box,D);}
  });
}
function mapSlot(){
  var slot=document.getElementById('mapslot');if(!slot)return;
  if(!MAPEL){MAPEL=document.createElement('div');MAPEL.className='mapbox';MAPEL.setAttribute('data-a','map-open');MAPEL.setAttribute('role','button');MAPEL.setAttribute('tabindex','0');MAPEL.setAttribute('aria-label','Open the map full screen');}
  slot.appendChild(MAPEL);
  mapData(function(D){
    var ex=document.getElementById('mapex');if(ex)ex.hidden=!D.examples;
    if(MAPEL.dataset.key===JSON.stringify([D.center,D.others.length,D.show])){if(MAPM)MAPM.resize();return;}
    MAPEL.dataset.key=JSON.stringify([D.center,D.others.length,D.show]);
    if(MAPM){try{MAPM.remove();}catch(e){}MAPM=null;}
    var inner=document.createElement('div');inner.className='mapgl';MAPEL.innerHTML='';MAPEL.appendChild(inner);
    mapMake(inner,D,false);
  });
}
window.aoMapReset=function(){MAPD=null;if(MAPEL)MAPEL.dataset.key='';render();};
function mapOpen(){
  if(!MAPD)return;
  sheet('<div class="maptop"><h2>You on the map</h2><button class="btn line close48" type="button" data-close="1">Close</button></div><div class="mapfull" id="mapfull"></div>'+
    (MAPD.examples?'<p class="fine">Other businesses will show up here as they join. These are examples.</p>':'<p class="fine">Tap a dot to see who it is.</p>'),'full');
  mapMake(document.getElementById('mapfull'),MAPD,true);
}
function mapLine(m){
  if(!m.show)return m.regulated?'You are off the map. Customers can’t find you there.':'You are off the map. Customers can’t find you there.';
  if(!m.placed)return 'Your pin shows up within a day.';
  var who=m.trade?(/^[aeiou]/i.test(m.trade)?'an ':'a ')+m.trade:'a business like yours';return 'Customers searching for '+who+(m.town?' near '+m.town.split(',')[0]:' nearby')+' find you here.';
}
function mapCard(){
  var m=S.map;if(!m)return '';
  return '<div class="feature mapc" id="map"><h3>You on the map</h3><div id="mapslot"></div>'+
    '<p class="mapline">'+esc(mapLine(m))+'</p><p class="fine" id="mapex" hidden>Other businesses will show up here as they join. These are examples.</p>'+
    '<div class="sw"><div><b>Show me on the map</b></div><button class="switch" type="button" role="switch" aria-checked="'+(m.show?'true':'false')+'" data-a="map-show" aria-label="Show me on the map"><i></i></button></div>'+
    '<div class="acts"><button class="btn line" type="button" data-a="bz-map">'+(m.phone||m.address?'Change your phone or address':'Add your phone or address')+'</button></div></div>';
}
function moreCard(){
  var r=[];
  if(!isTech()&&S.upgrades&&S.upgrades.list&&S.upgrades.list.length)r.push(row('up',ICON.check,'Upgrades for you','What fits your business, and why'));
  return r.length?'<h2>More for your business</h2><div class="list">'+r.join('')+'</div>':'';
}
function cbCard(){
  var C=S.callbacks;if(!C||!C.list||!C.list.length)return '';
  var rows=C.list.map(function(r){
    var st=r.status==='asap'?'Wants a call as soon as you are free':(r.status==='missed'?'Missed. Max is setting a new time.':(r.status==='noanswer'?'Missed. Max could not reach them.':'Promised for '+esc(r.dueText)));
    return '<li class="cbrow"><div><b>'+esc(r.name||r.phoneText)+'</b>'+(r.name?'<span class="fine"> '+esc(r.phoneText)+'</span>':'')+'<span class="fine">'+(r.reason?esc(r.reason)+'. ':'')+st+'</span></div>'+
      '<div class="acts"><a class="btn line small" href="tel:+1'+esc(r.phone.replace(/\D/g,'').slice(-10))+'">Call</a><button class="btn small" type="button" data-a="cb-done" data-id="'+r.id+'">Done</button>'+(r.status==='pending'?'<button class="btn line small" type="button" data-a="cb-later" data-id="'+r.id+'">30 more minutes</button>':'')+'</div></li>';
  }).join('');
  return '<div class="feature"><h3>Call-backs you promised</h3><p>Max told these callers when you would call. Tap Done when you have, or give yourself thirty more minutes and Max tells them.</p><ul class="cblist">'+rows+'</ul><p class="fine">If a time passes with nothing, Max calls them once to set a new one.</p></div>';
}
function lostCard(){
  var L=S.lost;if(!L||!L.month||!L.month.total)return '';
  var m=L.month,top=L.top||[];
  return '<div class="feature"><h3>Why callers walked</h3><p>When a caller decides not to book, Max asks one question: was it the price, the timing, or the drive. Here is what they said.</p>'+
    '<p><b>This month: '+top.map(esc).join(', ')+'.</b></p>'+(L.last&&L.last.total?'<p class="fine">Last month: '+L.last.total+' caller'+(L.last.total===1?'':'s')+' did not book.</p>':'')+
    '<p class="fine">Counts only. What you do with them is up to you.</p></div>';
}
function referCard(){
  var r=S.referrals||{},rows=r.list||[],h='<div class="feature"><h3>Know an owner who\\u2019d want this?</h3><p>Send them your link. They get the same free audit you did.</p><p><b>Refer a business. When they\\u2019ve stayed 3 months, you get a month free.</b></p>';
  if(rows.length)h+='<ul class="reflist">'+rows.map(function(x){return '<li><b>'+esc(x.business)+'</b><span>'+esc(x.label)+'</span></li>';}).join('')+'</ul><p class="fine">'+(r.bank?'Credit on your account: $'+Math.round(r.bank/100).toLocaleString('en-US')+'. ':'')+(r.used||0)+' of '+(r.cap||6)+' free months used in the last 12 months.</p>';
  return h+'<div class="acts"><button class="btn line" type="button" data-a="refer">Share your link</button></div><p class="fine">Send us six businesses, we work for free half the year. Never for customers or reviews. <a href="/terms#referral-credit">The rules</a></p></div>';
}
function guardCard(){
  var g=S.complianceGuard;if(!g)return '';
  var li=function(a){return a.map(function(x){return '<li>'+esc(x)+'</li>';}).join('');};
  return '<div class="gcard"><div class="gh">'+ICON.shield+'<div><b>Compliance Guard is on</b><span>Every reply and post is checked before it reaches you, and nothing goes out until you approve it.</span></div></div>'+
    '<details><summary>What it checks</summary><ul>'+li(g.base)+(g.strict&&g.strict.length?li(g.strict):'')+'</ul>'+(g.regulated?'<p class="fine">Extra rules apply because you work in a regulated field.</p>':'')+'<p class="fine">'+esc(g.note||'')+'</p></details></div>';
}
function offText(L){return L.transferTo?'calls ring through to '+L.transferText:'callers hear a short message';}
var SIGN_FLIP=false;
// Tap the OPEN sign: it flickers back on and the card turns over to today's numbers. An OFF sign turns Max back on.
function todayCalls(){var d=new Date();d.setHours(0,0,0,0);var t=d.getTime();return (S.calls||[]).filter(function(c){var x=Date.parse(c.at);return x&&x>=t;});}
function clock(iso){try{return new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}catch(e){return '';}}
function signBack(L){
  var R=S.results||{};
  if(L){
    var cs=todayCalls(),n=cs.length,u=cs.filter(function(c){return c.urgency==='urgent';}).length;
    return '<b>'+(n?esc(L.name)+' took '+n+(n===1?' call':' calls')+' today':'No calls yet today')+'</b><span>'+(n?'Last one at '+esc(clock(cs[0].at))+(u?' \\u00b7 '+u+' urgent':''):esc(L.name)+' is listening, day and night.')+'</span>'+
      (R.calls!=null?'<span>This month: '+(+R.calls||0)+((+R.calls||0)===1?' call':' calls')+'</span>':'')+
      '<div class="acts"><button class="btn ghost sm" type="button" data-a="sign">Back</button></div>';
  }
  return '<b>This month so far</b><span>'+(+R.reviews||0)+((+R.reviews||0)===1?' new review':' new reviews')+' \\u00b7 '+(+R.requests||0)+((+R.requests||0)===1?' request':' requests')+'</span><div class="acts"><button class="btn ghost sm" type="button" data-a="sign">Back</button></div>';
}
function signBtn(on,label){
  return '<button class="sign" type="button" data-a="sign" aria-pressed="'+(SIGN_FLIP?'true':'false')+'" aria-label="'+label+'" title="'+label+'"><b>'+(on?'OPEN':'OFF')+'</b><span>'+(on?'24 HOURS':'LINE OFF')+'</span></button>';
}
function signTap(){
  var L=S.line;
  if(L&&!L.onAir&&!L.paused){lineSave({onAir:true});return;}
  SIGN_FLIP=!SIGN_FLIP;render();
}
function liveCard(){
  var L=S.live||[];if(!L.length)return '';
  return L.map(function(c){var secs=Math.max(0,Math.round((Date.now()-Date.parse(c.at))/1000)),mm=Math.floor(secs/60),ss=secs%60;
    return '<div class="live" aria-live="polite"><div class="lh"><span class="dot"></span>'+esc(S.line?S.line.name:'Max')+' is on a call'+(c.name?' with '+esc(c.name):'')+'</div><div class="ln">'+esc(c.numberText||'Unknown number')+' \\u00b7 '+mm+':'+(ss<10?'0':'')+ss+(c.turns?' \\u00b7 '+c.turns+(c.turns===1?' turn':' turns'):'')+'</div>'+
      (c.heard||c.said?'<div class="lq">'+(c.heard?'<span class="u">'+esc(c.heard)+'</span>':'')+(c.said?'<span class="a">'+esc(c.said)+'</span>':'')+'</div>':'<div class="ln">Connecting\\u2026</div>')+'</div>';}).join('');
}
// What Max caught this month: after-hours calls that became leads, at the owner's own numbers, with the arithmetic shown.
function moneyCard(){
  var M=S.money;if(!M||!M.thisMonth)return '';
  var m=M.thisMonth,p=M.lastMonth||{},own=isOwner();
  var d=function(n){return '$'+Math.round(+n||0).toLocaleString('en-US');};
  var big=m.avgJob&&m.mid?'<p class="mv">about '+d(m.mid)+'<small>caught after hours</small></p><p class="mr">Between '+d(m.low)+' and '+d(m.high)+' at your numbers.</p>':'<p class="mv">'+(+m.leads||0)+'<small>'+((+m.leads||0)===1?'lead':'leads')+' from after-hours calls</small></p>';
  var last=p.afterHoursCalls?'<p class="fine">'+esc(p.label||'Last month')+': '+(p.avgJob&&p.mid?'about '+d(p.mid)+' from '+p.leads+(p.leads===1?' lead':' leads'):p.leads+(p.leads===1?' lead':' leads')+' from '+p.afterHoursCalls+' after-hours '+(p.afterHoursCalls===1?'call':'calls'))+'.</p>':'';
  return '<div class="money'+(m.avgJob&&m.mid?' on':'')+'"><p class="mh">What '+esc(S.line?S.line.name:'Max')+' caught in '+esc(String(m.label||'').split(' ')[0]||'this month')+'</p>'+big+
    '<details><summary>How this is figured</summary><p>'+esc(m.explained||'')+'</p><p class="fine">After hours means evenings, nights and weekends in your own time. It is an estimate from your numbers, not a promise.</p></details>'+last+
    (own?'<div class="acts"><button class="btn '+(m.avgJob?'ghost':'line')+' sm" type="button" data-a="money-set">'+(m.avgJob?'Change my numbers':'Set my average job')+'</button></div>':'')+'</div>';
}
// Referrals on Home: one line every day, with Share. Owners only; never for regulated businesses or the sample account.
// Put away for 30 days with the x; it comes back sooner when the referral state changes.
function homeRefer(){
  var r=S.referrals;if(!r||!r.nudge||!isOwner()||S.client.regulated||S.sample)return '';
  var k=r.nudge.key,x=null;try{x=JSON.parse(store('ao_ref_x')||'null');}catch(e){x=null;}
  if(x&&x.k===k&&Date.now()-x.at<30*864e5)return '';
  return '<div class="refhome'+(r.nudge.kind==='invite'?'':' news')+'"><p>'+esc(r.nudge.text)+'</p><div class="acts"><button class="btn line sm" type="button" data-a="refer">Share your link</button><button class="x" type="button" data-a="ref-x" aria-label="Put this away for 30 days">×</button></div></div>';
}
function moneySheet(){
  var m=(S.money||{}).thisMonth||{};
  sheet('<h2>Your numbers</h2><p class="fine">Only you see these. We use them to show what your calls are worth.</p><label>Average job, in dollars<input type="text" inputmode="numeric" id="mj" value="'+(m.avgJob?esc(m.avgJob):'')+'" placeholder="380"></label>'+
    '<label>Out of every 10 leads, how many become a job?<select id="mw">'+[1,2,3,4,5,6,7,8,9,10].map(function(n){return '<option value="'+(n*10)+'"'+(Math.round((m.winRate||30)/10)===n?' selected':'')+'>'+n+' of 10</option>';}).join('')+'</select></label>'+
    '<div class="acts"><button class="btn ok" type="button" id="go">Save</button><button class="btn line" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var avg=parseInt(String($('#mj').value).replace(/[^0-9]/g,''),10)||0;if(!avg){toast('Type your average job in dollars.');return;}this.disabled=true;post('results',{avgJob:avg,winRate:+$('#mw').value}).then(function(res){if(res.j.ok){close();toast('Saved.');load(true);}else{toast(res.j.error||'Could not save.');}}).catch(function(){toast('No connection.');});};
}
// What is running for them, in one line: only the parts on their plan. The phone line is one part of the office.
function officeLine(){
  var f=S.features||{},p=[];
  if(S.line)p.push('calls');
  p.push('reviews');
  if(f.followups)p.push('follow-ups');
  if(S.fillWeek&&S.fillWeek.on)p.push('open days');
  p.push('your Google page');
  var t=p.length>1?p.slice(0,-1).join(', ')+' and '+p[p.length-1]:p[0];
  return t.charAt(0).toUpperCase()+t.slice(1)+', covered day and night.';
}
// This month so far: the numbers that become the page on the 2nd, and the top finding. Opens the month as one page.
function monthNowCard(){
  var m=S.monthNow;if(!m)return '';
  var mo=String(m.label||'').split(' ')[0]||'This month';
  var t=[[m.calls,'calls answered',m.after?m.after+' after hours':''],[m.reviews,'new reviews',m.reviews?(m.replied===m.reviews?'all replied to':m.replied+' replied to'):''],
    [m.booked,'jobs booked',''],[m.followups,'follow-ups sent','']];
  if(m.checkYes||m.checkNo)t[3]=[m.checkYes,'check-ins: it held up',m.checkNo?m.checkNo+' told you first':''];
  return '<div class="mnow"><div class="mnow-h"><b>'+esc(mo)+' so far</b><span>Live now. Sent on the 2nd.</span></div>'+
    '<div class="mnow-g">'+t.map(function(x){return '<div><b>'+(+x[0]||0)+'</b><span>'+esc(x[1])+'</span>'+(x[2]?'<small>'+esc(x[2])+'</small>':'')+'</div>';}).join('')+'</div>'+
    (m.worth?'<p class="mnow-w">After-hours calls worth about <b>$'+Number(m.worth).toLocaleString('en-US')+'</b> so far</p>':'')+
    (m.insight?'<p class="note" style="margin:8px 0 0">'+esc(m.insight)+'</p>':'')+'</div>';
}
// Max's clock: this month on one dial (server-drawn, clock.js), the two numbers, the one call, and the list behind it.
function clockCard(){
  var K=S.clock;if(!K)return '';
  var nm=esc(K.name||'Max'),hb=function(min){min=Math.round(+min||0);var h=Math.floor(min/60),m=min%60;return h?h+'h'+(m?' '+m+'m':''):m+' min';};
  var facts='<ul class="cl">'+(K.worth?'<li><b>$'+Math.round(K.worth).toLocaleString('en-US')+'</b> caught while you were closed</li>':'')+'<li><b>'+hb(K.onMin)+'</b> on the clock</li>'+(K.calls?'<li><b>'+K.calls+'</b> '+(K.calls===1?'call':'calls')+', '+K.alone+' handled alone'+(K.toYou?', <b>'+K.toYou+'</b> brought to you':'')+'</li>':'')+(K.backMin?'<li><b>'+hb(K.backMin)+'</b> back to you</li>':'')+'</ul>';
  return '<div class="clock'+(K.liveMin>=0?' onair':'')+'" id="clockcard"><div class="ch"><b>'+nm+'\u2019s clock</b><span>'+(K.liveMin>=0?'<i class="dot"></i>on a call now':esc(K.month||'this month')+' so far')+'</span></div>'+K.svg+facts+
    (K.one?'<p class="one"><b>The one call.</b> '+esc(K.one)+'</p>':(K.n?'':'<p class="one">Nothing yet this month. '+nm+' is on the clock anyway; the first call lands here.</p>'))+
    '<div class="acts"><button class="btn line sm" type="button" data-a="clock-list">'+(K.n?'Everything on the dial':'How this works')+'</button>'+(S.monthNow&&S.monthNow.page?'<a class="btn ghost sm" href="'+esc(BASE+S.monthNow.page)+'">This month\u2019s page</a>':'')+'</div></div>';
}
function clockSheet(){
  var K=S.clock||{},ev=K.events||[],nm=esc(K.name||'Max');
  var list=ev.length?'<div class="list evl">'+ev.map(function(e){var d=new Date(e.at),day=isNaN(d)?'':d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      return '<div class="row"><div><b>'+esc(e.time)+'</b><div class="meta">'+esc(day)+' \u00b7 '+esc(e.label)+(e.you?' \u00b7 <b>brought to you</b>':'')+(e.booked?' \u00b7 booked':'')+(e.reason?'<br>'+esc(e.reason):'')+'</div></div></div>';}).join('')+'</div>':'<p class="fine">Nothing on the dial yet.</p>';
  sheet('<h2>'+nm+'\u2019s clock</h2><p class="fine">Every call, check-in call, follow-up, reply, post and missed-call text this month, at the minute it happened in your own time. Teal: handled without you. Red: brought to you.</p>'+
    '<p class="fine"><b>How \u201cback to you\u201d is figured.</b> '+esc(K.explained||'')+'</p>'+list+'<div class="acts"><button class="btn line" type="button" data-close="1">Close</button></div>');
}
function heroCard(){
  var L=S.line,f=S.features||{};
  if(L){
    var on=L.onAir;
    if(on&&SIGN_FLIP)return '<div class="hero">'+signBtn(true,'Back to '+esc(L.name))+'<div class="hero-t">'+signBack(L)+'</div></div>';
    return '<div class="hero'+(on?'':' off')+'">'+signBtn(on,on?'Today\\u2019s calls':(L.paused?'Line paused':'Turn '+esc(L.name)+' on'))+'<div class="hero-t"><b>'+(on?'Your office is open':(L.paused?'Calls are paused':'Calls are off'))+'</b><span>'+officeLine()+'</span><span class="sm">'+esc(L.name)+' \\u00b7 '+esc(L.numberText)+(on?' \\u00b7 day and night':' \\u00b7 '+esc(offText(L)))+'</span><div class="acts">'+
      (on?'<a class="btn line sm" href="tel:'+esc(L.number)+'">Call '+esc(L.name)+'</a>':(L.paused?'<button class="btn line sm" type="button" data-a="katie">Ask us</button>':'<button class="btn red sm" type="button" data-a="line-on">Turn on</button>'))+''+(isTech()?'':'<button class="btn ghost sm" type="button" data-tab="max">Settings</button>')+'</div></div></div>';
  }
  if(SIGN_FLIP)return '<div class="hero">'+signBtn(true,'Back')+'<div class="hero-t">'+signBack(null)+'</div></div>';
  return '<div class="hero">'+signBtn(true,'This month so far')+'<div class="hero-t"><b>Your office is open</b><span>'+officeLine()+(f.calls||S.client.regulated?'':' Max, your phone line, comes with your plan.')+'</span>'+
    (f.calls||S.client.regulated?'':'<div class="acts"><button class="btn ghost sm" type="button" data-a="ask-max">Set up Max for your calls</button></div>')+'</div></div>';
}
function revBars(ms,cur){
  var list=ms.slice(0,8).reverse();if(list.length<2)return '';
  var vals=list.map(function(x){return +((x.stats||{}).reviews)||0;}),mx=Math.max.apply(null,vals.concat([1]));
  return '<div class="barsh"><b>New reviews by month</b><span>Tap a month</span></div><div class="bars" role="group" aria-label="New reviews by month">'+list.map(function(x,i){return '<button type="button" data-a="m" data-m="'+esc(x.month)+'" aria-pressed="'+(x.month===cur)+'" aria-label="'+esc(x.label)+': '+vals[i]+'"><b>'+vals[i]+'</b><i style="height:'+Math.max(4,Math.round(vals[i]/mx*62))+'px"></i>'+esc(String(x.label).slice(0,3))+'</button>';}).join('')+'</div>';
}
function tileSheet(k,month){
  var m=(S.months||[]).filter(function(x){return x.month===month;})[0]||{},st=m.stats||{},lab=esc(m.label||'');
  var inMonth=function(iso){return String(iso||'').slice(0,7)===month;};
  var body='';
  if(k==='reviews'){var rv=(S.reviews||[]).filter(function(r){return inMonth(r.at);});body=rv.length?rv.map(revCard).join(''):'<p class="fine">No reviews on file for '+lab+'. Google reported '+fmt('reviews',st.reviews)+'.</p>';}
  else if(k==='replies'||k==='posts'){var dn=(S.done||[]).filter(function(d){return d.status==='approved'&&inMonth(d.at)&&(k==='posts'?d.kind==='post':d.kind!=='post');});body=dn.length?'<div class="done">'+dn.map(function(d){return '<div><i></i><p>'+esc(d.text||d.title)+'</p><span>Approved'+(d.by?' by '+esc(d.by):'')+(d.at?' \\u00b7 '+esc(when(d.at)):'')+'</span></div>';}).join('')+'</div>':'<p class="fine">Nothing approved from the app in '+lab+'. The count comes from your monthly record.</p>';}
  else if(k==='calls'){var cs=(S.calls||[]).filter(function(c){return inMonth(c.at);});body=cs.length?cs.map(callCard).join(''):'<p class="fine">This number comes from your Google profile: calls placed from the Call button on Google. Max\\u2019s own calls are under '+esc(S.line?S.line.name:'Max')+'.</p>';}
  else if(k==='rating')body='<p class="fine">Your Google rating at the end of '+lab+'. It moves with every new review, and the line on the reviews card shows it month to month.</p>';
  else body='<p class="fine">'+(k==='clicks'?'People who tapped your website from your Google profile in '+lab+'.':'People who asked Google for directions to you in '+lab+'.')+' Google reports it; we can\\u2019t see who they were.</p>';
  sheet('<h2>'+esc((TILES.filter(function(t){return t[0]===k;})[0]||['',''])[1])+' \\u00b7 '+lab+'</h2>'+body+'<div class="acts"><button class="btn ghost" type="button" data-close="1">Close</button></div>');
}
function monthBlock(){
  var ms=S.months||[];
  if(!ms.length)return '<h2>Your month</h2><div class="empty slim"><b>Your first month is on its way</b><span>Your numbers show up here in the first days of next month.</span></div>';
  var m=ms.filter(function(x){return x.month===MONTH;})[0]||ms[0];
  var h='<h2>Your month</h2>';
  if(S.answer&&S.answer.line)h+='<p class="note" style="margin:-4px 2px 6px">'+esc(S.answer.line)+(S.answer.lastLine?' Last month: '+esc(S.answer.lastLine.replace(/^After hours \w+: /,''))+'':'')+'</p>';
  if(S.checkins&&S.checkins.line)h+='<p class="note" style="margin:-4px 2px 10px">'+esc(S.checkins.line)+'</p>';
  if(ms.length>1)h+='<div class="months" role="group" aria-label="Month">'+ms.map(function(x){return '<button type="button" class="mchip" data-a="m" data-m="'+esc(x.month)+'" aria-pressed="'+(x.month===m.month)+'">'+esc(x.label)+'</button>';}).join('')+'</div>';
  else h+='<p class="note" style="margin:-4px 2px 10px">'+esc(m.label)+'</p>';
  var st=m.stats||{},pv=m.prev||null,pl=pv&&pv.label?pv.label.split(' ')[0]:'last month';
  h+='<div class="tiles">'+TILES.map(function(t){var v=st[t[0]],p=pv?pv[t[0]]:null,d='';
    if(v!=null&&v!==''&&p!=null&&p!==''&&!isNaN(+v)&&!isNaN(+p)){var df=+v-(+p);if(t[0]==='rating')df=Math.round(df*10)/10;d=df>0?'<em class="up">\\u25b2 '+(t[0]==='rating'?df.toFixed(1):df)+' from '+esc(pl)+'</em>':(df<0?'<em class="down">\\u25bc '+(t[0]==='rating'?Math.abs(df).toFixed(1):Math.abs(df))+' from '+esc(pl)+'</em>':'<em class="down">Same as '+esc(pl)+'</em>');}
    return '<button class="tile" type="button" data-a="tile" data-k="'+t[0]+'" data-m="'+esc(m.month)+'"><b>'+fmt(t[0],v)+'</b><span>'+t[1]+'</span>'+d+'</button>';}).join('')+'</div>'+revBars(ms,m.month);
  if(m.note)h+='<p class="note">'+esc(m.note)+'</p>';
  if(m.insights&&m.insights.length)h+='<div class="card"><b>What it means</b><ol class="ins">'+m.insights.map(function(t){return '<li>'+esc(t)+'</li>';}).join('')+'</ol>'+(m.next?'<p class="note" style="margin:6px 0 0"><b>Next month:</b> '+esc(m.next)+'</p>':'')+'</div>';
  if(m.page)h+='<div class="acts" style="margin:10px 0 4px"><a class="btn line" href="'+esc(BASE+m.page)+'">Open '+esc(String(m.label||'').split(' ')[0])+'\u2019s page</a></div>';
  var ac=S.aiCheck;
  if(ac&&ac.line)h+='<div class="card"><b>What assistants say about you</b><p class="note" style="margin:4px 0 0">'+esc(ac.line)+(ac.fixing?' Some details they show are out of date ('+esc(ac.wrong.map(function(w){return w.field;}).join(', '))+'). We\u2019re fixing them where they come from.':' The details they show match yours.')+'</p></div>';
  return h+'<p class="note">Calls, clicks and direction requests come from your Google profile. A dash means Google had not reported it yet.</p>';
}

/* ---------- follow-ups ---------- */
var FUK={quote:'Quote',invoice:'Invoice',appointment:'Appointment'};
function localDay(off){var d=new Date();d.setDate(d.getDate()+(off||0));return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function dayLabel(s){var p=String(s).split('-');var d=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(d)?s:d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});}
function isDue(x){return x.status==='open'&&!!x.due&&x.due<=localDay(0);}
function dueText(x){if(!x.due)return 'No date';var t=localDay(0);if(x.due<t)return 'Overdue \\u00b7 '+dayLabel(x.due);if(x.due===t)return 'Due today';if(x.due===localDay(1))return 'Due tomorrow';return 'Due '+dayLabel(x.due);}
function fuText(x){
  var me=name()||S.client.first||'',biz=S.client.business||'',who=me?me+' with '+biz:biz,amt=x.amount?' for '+x.amount:'';
  if(x.kind==='invoice')return 'Hi '+x.name+', this is '+who+'. Friendly reminder about your invoice'+amt+'. Let me know if you have any questions.';
  if(x.kind==='appointment')return 'Hi '+x.name+', this is '+who+', confirming your appointment'+(x.due?' on '+dayLabel(x.due):'')+'. Reply here if you need to change it.';
  return 'Hi '+x.name+', this is '+who+'. Just checking in on the quote'+amt+'. Any questions I can answer?';
}
function smsHref(num,body){return 'sms:'+num+(/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent)?'&':'?')+'body='+encodeURIComponent(body);}
function fuCard(x){
  var due=isDue(x);
  return '<article class="card fu'+(due?' due':'')+'" id="fu-'+esc(x.id)+'"><div class="ch"><span class="chip'+(due?' urgent':'')+'">'+esc(FUK[x.kind]||'Follow-up')+'</span><span class="who">'+esc(dueText(x))+'</span></div>'+
    '<div class="fu-t"><b>'+esc(x.name)+'</b>'+(x.amount?'<span>'+esc(x.amount)+'</span>':'')+'</div>'+(x.note?'<p class="fine">'+esc(x.note)+'</p>':'')+
    (x.texted?'<p class="fine"><b>'+esc(x.texted)+'</b> from your business number.</p>':'')+
    (x.notTexted?'<p class="fine"><b>Not texted.</b> '+esc(x.notTexted)+'</p>':'')+
    (!x.texted&&!x.notTexted&&x.consent&&S.autoText?'<p class="fine">They said yes to texts, so we text them for you.</p>':'')+
    '<div class="acts">'+(x.phone?'<a class="btn ok" href="'+esc(smsHref(x.phone,fuText(x)))+'">Text them</a><a class="btn line" href="tel:'+esc(x.phone)+'">Call</a>':'<button class="btn line" type="button" data-a="fu-copy" data-id="'+esc(x.id)+'">Copy a text</button>')+
    '<button class="btn ghost" type="button" data-a="fu-done" data-id="'+esc(x.id)+'">Done</button></div></article>';
}
function fuBlock(){
  var f=S.features||{};
  if(!f.followups){
    if(S.client.regulated)return '';
    return '<div class="feature locked"><h3>Quote and invoice follow-ups</h3><p>Add a quote, invoice or appointment. On the day it\\u2019s due we remind you and write the text, so nothing slips. Comes with Pro.</p><div class="acts"><button class="btn line" type="button" data-a="ask-pro">Ask about Pro</button></div></div>';
  }
  var fus=S.followups||[],open=fus.filter(function(x){return x.status==='open';}),done=fus.filter(function(x){return x.status==='done';});
  var h='<h2 id="fu">Follow-ups</h2>'+(open.length?open.map(fuCard).join(''):'<div class="empty slim"><b>No follow-ups</b><span>Add a quote, invoice or appointment and we\\u2019ll remind you on the day.</span></div>');
  h+='<div class="acts" style="margin:4px 0 0"><button class="btn line" type="button" data-a="fu-add">Add a follow-up</button></div>';
  if(done.length)h+='<h2>Done lately</h2><div class="done">'+done.slice(0,8).map(function(x){return '<div><i></i><p>'+esc((FUK[x.kind]||'Follow-up')+' \\u00b7 '+x.name+(x.amount?' \\u00b7 '+x.amount:''))+'</p><span>Done'+(x.doneAt?' \\u00b7 '+esc(when(x.doneAt)):'')+'</span></div>';}).join('')+'</div>';
  return h;
}
function fuSheet(){
  sheet('<h2>Add a follow-up</h2><label>What is it?<select id="fk"><option value="quote">Quote</option><option value="invoice">Invoice</option><option value="appointment">Appointment</option></select></label><label>Customer\\u2019s name<input type="text" id="fn" maxlength="60" autocomplete="off"></label><label>Their cell (optional)<input type="tel" id="fp" maxlength="20" inputmode="tel" autocomplete="off" placeholder="478 555 0142"></label><label>Amount (optional)<input type="text" id="fa" maxlength="20" placeholder="$1,250"></label><label>Follow up on<input type="date" id="fd" value="'+localDay(3)+'"></label><label id="ftl" hidden>Time (optional)<input type="time" id="ft"></label><label>Note (optional)<input type="text" id="fo" maxlength="200"></label>'+(S.autoText?'<label class="opt"><input type="checkbox" id="fc"><span>They said yes to texts about this</span></label><p class="fine">If they said yes, we text them for you from your business number: an appointment gets a confirmation now and a reminder the afternoon before; a quote or invoice gets one friendly follow-up that day. Otherwise we remind you and write the text, and you send it.</p>':'<p class="fine">On that day we remind you and write the text. You send it from your phone.</p>')+'<div class="acts"><button class="btn ok" type="button" id="go">Add</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  setTimeout(function(){var i=$('#fn');if(i)i.focus();},60);
  $('#fk').onchange=function(){var l=$('#ftl');if(l)l.hidden=this.value!=='appointment';};
  $('#go').onclick=function(){
    var b=this,fc=$('#fc'),body={kind:$('#fk').value,name:$('#fn').value,phone:$('#fp').value,amount:$('#fa').value,due:$('#fd').value,note:$('#fo').value,time:$('#fk').value==='appointment'?$('#ft').value:'',consent:!!(fc&&fc.checked)};
    if(body.consent&&!body.phone.trim()){toast('Add their cell so we can text them.');return;}
    if(!body.name.trim()){toast('Add the customer\\u2019s name.');return;}
    needName(function(by){body.by=by;b.disabled=true;post('followup',body).then(function(res){b.disabled=false;if(res.j.ok){close();S.followups=[res.j.followup].concat(S.followups||[]);toast(body.consent?'Added. We\\u2019ll text them for you.':'Added. We\\u2019ll remind you on the day.');render();}else toast(res.j.error||'Could not add. Try again.');}).catch(function(){b.disabled=false;toast('No connection. Try again.');});});
  };
}
function money(n){return '$'+(+n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function invBlock(){
  var inv=S.invoices||[],open=inv.filter(function(x){return x.status==='open';});
  if(!S.features.invoices)return '<h2>Money waiting</h2><div class="feature locked"><h3>Invoice reminders</h3><p>Add an invoice and we draft a friendly reminder 3 and 7 days after it\u2019s due, with your pay link. Comes with Pro.</p><div class="acts"><button class="btn line" type="button" data-a="ask-pro">Ask about Pro</button></div></div>';
  var h='<h2>Money waiting</h2>';
  if(open.length)h+='<p class="note" style="margin:-4px 2px 10px">'+money(S.unpaid)+' unpaid across '+open.length+(open.length===1?' invoice':' invoices')+'</p>';
  h+='<div class="list">'+inv.map(function(x){return '<article class="card"><b>'+esc(x.name)+(x.number?' \\u00b7 #'+esc(x.number):'')+'</b><p class="note" style="margin:4px 0">'+esc(x.amountText)+(x.status==='paid'?' \\u00b7 Paid':' \\u00b7 due '+esc(x.due))+'</p><div class="acts">'+
    (x.status==='paid'?'<button class="btn ghost sm" type="button" data-a="inv-open" data-id="'+x.id+'">Not paid</button>':'<button class="btn ok sm" type="button" data-a="inv-paid" data-id="'+x.id+'">Mark paid</button><button class="btn line sm" type="button" data-a="inv-copy" data-id="'+x.id+'">Copy invoice link</button>')+'</div></article>';}).join('')+'</div>';
  if(!inv.length)h+='<div class="empty slim"><b>No open invoices</b><span>Add one and we\\u2019ll draft a reminder 3 and 7 days after it\\u2019s due. Nothing goes out until you approve it.</span></div>';
  return h+'<div class="acts" style="margin:4px 0 0"><button class="btn line" type="button" data-a="inv-add">Add an invoice</button></div>';
}
function linkBlock(){
  if(!S.bookLink&&!S.quoteLink)return '';
  return '<h2>Your customer links</h2><div class="card"><p class="note" style="margin:0 0 8px">'+(S.calendar&&S.calendar.connected?'Customers pick an open time and it lands on your calendar.':'Customers send a request. Connect Google Calendar and they can pick a time themselves.')+'</p><div class="acts">'+
    (S.bookLink?'<button class="btn line sm" type="button" data-a="copy-link" data-u="'+esc(S.bookLink)+'">Copy booking link</button>':'')+(S.quoteLink?'<button class="btn ghost sm" type="button" data-a="copy-link" data-u="'+esc(S.quoteLink)+'">Copy request link</button>':'')+'</div></div>';
}
function metaBlock(){
  var m=S.meta;if(!m||S.client.regulated)return '';
  if(!m.available)return '<div class="feature locked"><h3>Facebook and Instagram</h3><p>Your approved posts go to your Facebook Page and Instagram. Coming soon.</p></div>';
  return '<div class="feature"><h3>Facebook and Instagram</h3><p>'+(m.connected?'Connected to '+esc(m.page)+(m.instagram?' and Instagram':'')+'. Posts go out only after you approve them.':'Connect your Page and every post you approve goes to Facebook'+' and Instagram too.')+'</p><div class="acts">'+
    (m.connected?'<button class="btn ghost sm" type="button" data-a="meta-off">Disconnect</button>':'<a class="btn red sm" href="/meta/connect?code='+encodeURIComponent(BASE.split('/').pop())+'">Connect Facebook</a>')+'</div></div>';
}
function invSheet(){
  sheet('<h2>Add an invoice</h2><label>Customer\\u2019s name<input type="text" id="in" maxlength="80" autocomplete="off"></label><label>Amount<input type="text" id="ia" maxlength="20" inputmode="decimal" placeholder="$1,250"></label><label>Invoice number (optional)<input type="text" id="inr" maxlength="30"></label><label>Due date<input type="date" id="idue" value="'+localDay(0)+'"></label><label>Their email<input type="email" id="ie" maxlength="120" autocomplete="off"></label><label>Their cell (optional)<input type="tel" id="ip" maxlength="20" inputmode="tel" autocomplete="off"></label><label class="opt"><input type="checkbox" id="ic"><span>They agreed to get texts from us about this invoice</span></label><label>Your pay link<input type="url" id="il" maxlength="500" placeholder="https://"></label><p class="fine">Your own Stripe, Square or PayPal link. Money goes straight to you.</p><div class="acts"><button class="btn red" type="button" id="go">Add invoice</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  setTimeout(function(){var i=$('#in');if(i)i.focus();},60);
  $('#go').onclick=function(){
    var b=this,body={action:'add',name:$('#in').value,amount:$('#ia').value,number:$('#inr').value,due:$('#idue').value,email:$('#ie').value,phone:$('#ip').value,consent:$('#ic').checked,payLink:$('#il').value};
    b.disabled=true;post('invoice',body).then(function(res){b.disabled=false;if(res.j.ok){close();S.invoices=[res.j.invoice].concat(S.invoices||[]);S.unpaid=(+S.unpaid||0)+res.j.invoice.amount;toast('Added. We\\u2019ll draft reminders if it runs late.');render();}else toast(res.j.error||'Could not add. Try again.');}).catch(function(){b.disabled=false;toast('No connection. Try again.');});
  };
}
function invMark(id,paid){post('invoice',{action:paid?'paid':'open',id:+id}).then(function(res){if(res.j.ok){(S.invoices||[]).forEach(function(x){if(String(x.id)===String(id)){x.status=paid?'paid':'open';S.unpaid=(+S.unpaid||0)+(paid?-x.amount:x.amount);}});render();toast(paid?'Marked paid. Reminders stop.':'Moved back to unpaid.');}else toast('Could not save. Try again.');}).catch(function(){toast('No connection. Try again.');});}
function copyText(u,msg){try{navigator.clipboard.writeText(u).then(function(){toast(msg);},function(){prompt('Copy this link',u);});}catch(e){prompt('Copy this link',u);}}
function fuMark(id,action){
  needName(function(by){post('followup',{id:id,action:action,by:by}).then(function(res){if(res.j.ok){(S.followups||[]).forEach(function(x){if(String(x.id)===String(id)){x.status=res.j.status==='open'?'open':'done';x.doneAt=res.j.at;}});render();toast(action==='done'?'Marked done.':'Moved back.');}else toast(res.j.error||'Could not save. Try again.');}).catch(function(){toast('No connection. Try again.');});});
}

/* ---------- Reviews ---------- */
function chart(list){
  if(list.length<2)return '';
  var W=300,H=90,p=8,vals=list.map(function(m){return +m.stats.rating;}),mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);
  if(mx-mn<0.4){var mid=(mx+mn)/2;mn=mid-0.2;mx=mid+0.2;}
  var x=function(i){return p+i*(W-2*p)/(list.length-1);},y=function(v){return H-p-(v-mn)*(H-2*p)/(mx-mn);};
  var d=vals.map(function(v,i){return (i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1);}).join(' ');
  return '<svg class="trend" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Star rating by month"><path d="'+d+'" fill="none" stroke="#FF6A5E" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'+vals.map(function(v,i){return '<circle cx="'+x(i).toFixed(1)+'" cy="'+y(v).toFixed(1)+'" r="3.4" fill="#FF6A5E"/>';}).join('')+'</svg><div class="trend-l"><span>'+esc(String(list[0].label).split(' ')[0])+'</span><span>'+esc(String(list[list.length-1].label).split(' ')[0])+'</span></div>';
}
function revCard(r){
  var st=r.status==='pending'?'<span class="chip warn">Waiting for your OK</span>':(r.status==='approved'?'<span class="chip ok">Reply approved</span>':(r.status==='skipped'?'<span class="chip">No reply</span>':'<span class="chip ok">Handled by us</span>'));
  return '<article class="card"><div class="ch">'+(r.stars?'<span class="stars" aria-label="'+r.stars+' stars">'+stars(r.stars)+'</span>':'')+(r.name?'<span class="who">'+esc(r.name)+'</span>':'')+(r.at?'<span class="who">'+esc(when(r.at))+'</span>':'')+'</div>'+
    (r.review?'<blockquote>'+esc(r.review)+'</blockquote>':'<blockquote>Rating only, no written review.</blockquote>')+(r.reply?'<div class="lbl">Our reply</div><div class="draft">'+esc(r.reply)+'</div>':'')+
    '<div class="ch">'+st+(r.status==='pending'?'<button class="btn line sm" type="button" data-tab="today">Approve it on Today</button>':'')+'</div></article>';
}
function vReviews(){
  var f=S.features||{},rv=S.reviews||[];
  var rated=(S.months||[]).filter(function(m){return m.stats&&m.stats.rating!=null&&m.stats.rating!==''&&!isNaN(+m.stats.rating);}).slice().reverse();
  var h='<h2 style="margin-top:28px">Your reviews</h2><p class="note" style="margin:-4px 2px 12px">What customers say about '+esc(S.client.business||'you')+' on Google, and what we said back.</p>';
  if(rated.length){var last=rated[rated.length-1],r=+last.stats.rating,cnt=last.stats.count;
    h+='<div class="card score glow"><div class="big"><b>'+r.toFixed(1)+'</b><span class="stars" aria-label="'+r.toFixed(1)+' stars">'+stars(r)+'</span><span class="who">'+(cnt!=null&&cnt!==''&&!isNaN(+cnt)?esc((+cnt).toLocaleString('en-US'))+' reviews on Google':'Your Google rating')+'</span></div>'+chart(rated)+'</div>';}
  else h+='<div class="card score"><div class="big"><b>\\u2014</b><span class="who">Your star rating, and how it moves month to month, shows here once your Google profile is connected.</span></div></div>';
  h+='<h2>Latest reviews</h2>'+(rv.length?rv.slice(0,3).map(revCard).join(''):'<div class="empty slim"><b>No reviews yet</b><span>New Google reviews land here with our reply, and every reply waits for your OK.</span></div>');
  if(f.qr&&S.client.qr)h+='<div class="feature"><h3>Your review QR code</h3><p>Show it at the counter or on a job. Ask every customer, not just the happy ones.</p><div class="acts"><button class="btn line" type="button" data-a="qr">Show the code</button></div></div>';
  if((S.features||{}).competitors)h+=rivalCard();
  var rs=(S.months||[]).filter(function(m){return m.record;});
  h+='<h2>Monthly records</h2><p class="note" style="margin:-4px 2px 10px">Every public review, reply and post for a month, with who approved it. Open one and tap Save as PDF to keep it.</p>';
  h+=rs.length?'<div class="recs">'+rs.map(function(m){return '<a class="rec" href="'+esc(BASE+'/record/'+m.month)+'"><div><b>'+esc(m.label)+'</b><span>Record of public communications</span></div>'+ICON.chev+'</a>';}).join('')+'</div>':'<div class="empty slim"><b>No records yet</b><span>Your first record is made in the first days of next month.</span></div>';
  return h;
}

/* ---------- Max (the phone line) ---------- */
function sel(a,b){return a===b?' selected':'';}
var MSEG='answer';
function mSegBar(L,f){
  var tabs=[['answer','Answering'],['job','Job description'],['teach','Teach '+L.name]];
  if(!L.duties)tabs.splice(1,1);
  if(L.booking)tabs.push(['book','Booking']);
  if(S.after)tabs.push(['after','After the call']);
  if(f.calls)tabs.push(['calls','Calls']);
  if(!tabs.some(function(x){return x[0]===MSEG;}))MSEG='answer';
  return '<div class="seg msg" role="tablist" aria-label="'+esc(L.name)+'">'+tabs.map(function(x){return '<button type="button" role="tab" class="segb" data-mseg="'+x[0]+'" aria-selected="'+(x[0]===MSEG)+'">'+esc(x[1])+'</button>';}).join('')+'</div>';
}
function vMax(){
  var L=S.line,f=S.features||{};
  var h='<h1>'+esc(L?L.name:'Calls')+'</h1>';
  if(L&&isTech()){return h+'<p class="lede">Calls '+esc(L.name)+' answered.</p>'+(f.calls?callsList():'');}
  if(!L){
    h+='<p class="lede">Calls your phone line answered.</p>'+textbackCard();
    if(f.calls)h+='<h2>Calls</h2>'+callsList();
    return h;
  }
  h+='<p class="lede">Your phone line answers '+esc(L.numberText)+'. Changes here apply to the next call.</p>'+'';
  {
    h+='<div class="card'+(L.onAir?' glow':'')+'"><div class="sw"><div><b>'+esc(L.name)+(L.onAir?' is answering':' is off')+'</b><span>'+(L.onAir?'Every call, day and night.':(L.transferTo?'Calls ring through to '+esc(L.transferText)+'.':'Callers hear a short message to call back later.'))+'</span></div>'+
      '<button class="switch" type="button" role="switch" aria-checked="'+(L.onAir?'true':'false')+'" data-a="line-toggle" aria-label="'+esc(L.name)+' on or off"'+(L.paused?' disabled':'')+'><i></i></button></div>'+(L.paused?'<p class="fine">Paused on our side. Message us in Ask us to turn it back on.</p>':'')+
      '<div class="acts"><a class="btn line" href="tel:'+esc(L.number)+'">'+ICON.phone.replace('<svg','<svg width="20" height="20"')+'Call '+esc(L.name)+' to try it</a></div></div>';
    if(S.maxStats&&S.maxStats.calls)h+='<p class="fine" style="margin:8px 2px 0">Last 30 days: '+S.maxStats.calls+(S.maxStats.calls===1?' call':' calls')+', '+S.maxStats.booked+' booked, '+S.maxStats.hungUp+' hung up early.</p>';
    h+=timecardCard();
    if(S.minutes){var mm=S.minutes,pc=Math.min(100,mm.pct||0);h+='<div class="card" style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b>Minutes this month</b><span class="fine">'+mm.used+' of '+mm.included+'</span></div><div style="height:8px;border-radius:99px;background:var(--panel);margin:8px 0 6px;overflow:hidden"><div style="height:100%;width:'+pc+'%;background:'+(mm.over?'var(--sign)':pc>=80?'var(--warn,#F2C46B)':'var(--ok)')+'"></div></div><p class="fine">'+(mm.over?mm.over+' minutes past your plan so far, $'+(mm.overCents/100).toFixed(2)+' at 25¢ a minute on your next invoice. Max keeps answering.':pc>=80?'Getting close. Past '+mm.included+', minutes are 25¢ each. Max keeps answering.':'Every plan comes with 300 minutes of Max a month.')+'</p></div>';}
    h+='<h2>What '+esc(L.name)+' knows</h2><div class="card form">'+
      '<label>Your hours<input type="text" id="lh" maxlength="300" value="'+esc(L.hours)+'" placeholder="For example: Mon to Fri 8 to 5, Sat 9 to 1"></label>'+
      '<label>What should '+esc(L.name)+' tell callers?<textarea id="lo" maxlength="800" placeholder="Specials, how you book, areas you serve, anything to steer clear of.">'+esc(L.owner)+'</textarea></label>'+
      '<label>Urgent calls go to<input type="tel" id="lt" maxlength="20" inputmode="tel" value="'+esc(L.transferText)+'" placeholder="Your cell, or leave blank"></label>'+
      '<label>Put callers through to that number<select id="lw"><option value="never"'+sel(L.transferWhen,'never')+'>Never, just take a message</option><option value="urgent"'+sel(L.transferWhen,'urgent')+'>Only if it\\u2019s urgent</option><option value="asked"'+sel(L.transferWhen,'asked')+'>When they ask, or it\\u2019s urgent</option></select></label>'+
      '<details><summary>Greeting</summary><label style="margin-top:8px">What '+esc(L.name)+' says first<textarea id="lg" maxlength="320" placeholder="'+esc(L.defaultGreeting)+'">'+esc(L.greeting)+'</textarea></label><p class="fine">We always add that callers are talking to an automated assistant and that the call may be recorded. Leave it empty for the standard one.</p></details>'+
      '<div class="acts"><button class="btn red" type="button" data-a="line-save">Save</button></div></div>';
    if(L.voices)h+=voiceCard(L);
    if(f.calls)h+='<h2>Calls</h2>'+callsList();
  }{
    h+=jobCard(L);
  }{
    h+=teachCard(L)||'';
  }{
    h+=bookCard(L);
  }{
    h+=afterCard(L)+textbackCard();
  }{
  }
  return h;
}
// Max's timecard: last week, Monday to Sunday (timecard.js). Also texted to the owner every Monday morning.
function timecardCard(){
  var T=S.timecard;if(!T)return '';
  var d=function(n){return '$'+Math.round(+n||0).toLocaleString('en-US');};
  var row=function(k,v){return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line)"><span class="fine" style="margin:0">'+k+'</span><b>'+v+'</b></div>';};
  return '<div class="card" style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:4px"><b>'+esc(T.name)+'\\u2019s timecard</b><span class="fine">'+esc(T.label)+'</span></div>'+
    row('On the clock',T.hours+' hours')+row('Answered',T.calls+(T.calls===1?' call':' calls'))+(T.booked?row('Booked',T.booked):'')+(T.due?row('Call-backs kept',T.kept+' of '+T.due):'')+
    (T.caught?row('Caught after hours','about '+d(T.caught)):(T.leads?row('After-hours leads',T.leads):''))+(T.back?row('Back to you',(function(min){var h=Math.floor(min/60),m=min%60;return h?h+(h===1?' hour':' hours')+(m?' '+m+' min':''):m+' min';})(T.back)):'')+(T.cost?row('Cost you',d(T.cost)):'')+
    '<p class="fine" style="margin:8px 0 0">'+(T.calls?'':'Quiet week. He was there anyway. ')+'Texted to you every Monday morning.</p></div>';
}
// Max's job description (duties.js) and "Tell Max": owner only (the server sends duties only to the owner).
function jobCard(L){
  var J=L.duties;if(!J)return '';
  var v=J.values||{};
  var h='<h2>Tell '+esc(L.name)+' something</h2><div class="card form"><label>Say it like you would to your crew<input type="text" id="tm-text" maxlength="280" placeholder="Closed Friday. No jobs in Macon this week."></label><div class="acts"><button class="btn red" type="button" data-a="tell-go">Tell '+esc(L.name)+'</button></div>'+
    '<p class="fine">Or text it from your phone to '+esc(L.numberText)+'. Text UNDO to take the last one back. It goes into What '+esc(L.name)+' knows, with the date.</p></div>';
  h+='<h2>Job description</h2><div class="card form"><p class="fine" style="margin-top:0">What '+esc(L.name)+' may do on a call. Changes apply to the next call.</p>'+J.list.map(function(d){
    return '<label class="opt" style="display:flex;gap:10px;align-items:flex-start;margin-top:10px"><input type="checkbox" data-duty="'+esc(d.key)+'"'+(v[d.key]?' checked':'')+' style="margin-top:3px"> <span><b>'+esc(d.label)+'</b><br><span class="fine">'+esc(d.sub)+'</span></span></label>'+
      (d.text?'<label style="margin:6px 0 0 30px">'+esc(d.textLabel)+'<input type="text" data-dtext="'+esc(d.text)+'" maxlength="400" value="'+esc(v[d.text]||'')+'" placeholder="'+esc(d.textHint)+'"></label>':'');
  }).join('')+'<div class="acts"><button class="btn red" type="button" data-a="duty-save">Save</button></div>'+
    '<p class="fine">Booking, call-backs and the calls '+esc(L.name)+' makes have their own switches under Booking and After the call.</p></div>';
  return h;
}
function dutySave(){
  var dd={};Array.prototype.forEach.call(document.querySelectorAll('[data-duty]'),function(x){dd[x.getAttribute('data-duty')]=!!x.checked;});
  Array.prototype.forEach.call(document.querySelectorAll('[data-dtext]'),function(x){dd[x.getAttribute('data-dtext')]=x.value;});
  lineSave({duties:dd});
}
function tellMax(){
  var el=$('#tm-text'),tv=el?String(el.value||''):'';
  if(tv.trim().length<3){toast('Type what '+(S.line?S.line.name:'Max')+' should know.');return;}
  needName(function(by){post('line',{action:'tell',text:tv,by:by}).then(function(res){if(res.j.ok){S.line=res.j.line;render();toast(res.j.said||'Saved.');}else toast(res.j.error||'Could not save. Try again.');}).catch(function(){toast('No connection. Try again.');});});
}
function textbackCard(){
  var f=S.features||{};
  if(S.client.regulated)return '';
  return f.textback?'<div class="feature"><h3>Missed-call text-back</h3><p>When someone hangs up before anyone can help, we text them back so the job doesn\\u2019t go to someone else.</p>'+textbackNote()+'</div>':
    '<div class="feature locked"><h3>Missed-call text-back</h3><p>When someone hangs up before anyone can help, we text them back so the job doesn\\u2019t go to someone else. Comes with Pro.</p><div class="acts"><button class="btn line" type="button" data-a="ask-pro">Ask about Pro</button></div></div>';
}
// Whether texts can go out now comes from the server (S.after.canText: texting on, and this business's registration
// approved); without the After the call card, the texting registration status is the next best answer.
function textbackNote(){
  var A=S.after,can=A?!!A.canText:!!((S.texting&&S.texting.status==='approved')||S.autoText);
  if(!can)return '<p class="fine"><span class="chip">Waiting on carrier approval</span> Texting turns on once carriers approve your number, usually about two weeks.</p>';
  if(A&&!A.textback)return '<p class="fine"><span class="chip">Off</span> Turn on \\u201cText after a missed call\\u201d under After the call.</p>';
  return '<p class="fine"><span class="chip ok">On</span> Texts go out from your business number.</p>';
}
function hhmm(m){m=+m||0;var h=Math.floor(m/60),mm=m%60;return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm;}
// A Google connection Google refused: one card with the button, until it is connected again.
function reconnectCards(){
  var list=S.reconnect||[];if(!list.length)return '';
  var code=encodeURIComponent(BASE.split('/').pop());
  return list.map(function(b){var cal=b.kind==='calendar';return '<div class="card" style="border-color:var(--sign);box-shadow:0 0 0 1px rgba(255,106,94,.2)"><b>'+(cal?'Reconnect Google Calendar':'Reconnect your Google Business Profile')+'</b><p class="note" style="margin:6px 0 10px">'+esc(b.text)+'</p><div class="acts"><a class="btn red sm" href="'+(cal?'/google/connect?code='+code:'/google/gbp?code='+code)+'">Connect</a></div></div>';}).join('');
}
function mins(v){var p=String(v||'').split(':');return (+p[0]||0)*60+(+p[1]||0);}
function bookCard(L){
  var B=L.booking,d=B.days||{},wk=d.Mon||d.Tue||d.Wed||d.Thu||d.Fri||[480,1020];
  var row=function(id,label,v){return '<div class="sw" style="gap:8px"><label style="flex:1">'+label+'<span style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bk-'+id+'-on"'+(v?' checked':'')+' aria-label="Open '+label+'"><input type="time" id="bk-'+id+'-o" value="'+hhmm(v?v[0]:480)+'"> to <input type="time" id="bk-'+id+'-c" value="'+hhmm(v?v[1]:1020)+'"></span></label></div>';};
  var cal=S.calendar||{};
  return '<h2>Booking</h2><div class="card form">'+
    '<label>When a caller wants a visit<select id="bk-mode"><option value="book"'+sel(B.mode,'book')+'>'+esc(L.name)+' books an open time</option><option value="hold"'+sel(B.mode,'hold')+'>'+esc(L.name)+' pencils in a time, we confirm by text</option><option value="off"'+sel(B.mode,'off')+'>'+esc(L.name)+' takes a message</option></select></label>'+
    '<label>A visit takes<select id="bk-len">'+[30,60,90,120,180,240].map(function(m){return '<option value="'+m+'"'+(B.slotMin===m?' selected':'')+'>'+(m<60?m+' minutes':(m/60)+(m===60?' hour':' hours'))+'</option>';}).join('')+'</select></label>'+
    '<label>Time between visits<select id="bk-buf">'+[0,15,30,60].map(function(m){return '<option value="'+m+'"'+(B.bufferMin===m?' selected':'')+'>'+(m?m+' minutes':'None')+'</option>';}).join('')+'</select></label>'+
    row('wk','Weekdays',wk)+row('sat','Saturday',d.Sat)+row('sun','Sunday',d.Sun)+
    '<p class="fine">'+esc(L.name)+' offers two times at a time, at least two hours out, and never the same time twice.'+(cal.needsReconnect?' Google stopped answering for your calendar. Connect it again below.':cal.connected?' Your Google Calendar is connected, so busy times there are skipped too.':' Connect Google Calendar (optional) so '+esc(L.name)+' never double-books with your own plans.')+'</p>'+
    '<div class="acts"><button class="btn red" type="button" data-a="bk-save">Save</button>'+(cal.needsReconnect?'<a class="btn red sm" href="/google/connect?code='+encodeURIComponent(BASE.split('/').pop())+'">Reconnect Google Calendar</a>':cal.connected?'<button class="btn ghost sm" type="button" data-a="gcal-off">Disconnect calendar</button>':'<a class="btn line sm" href="/google/connect?code='+encodeURIComponent(BASE.split('/').pop())+'">Connect Google Calendar</a>')+'</div></div>';
}
function afterCard(L){
  var A=S.after;
  var sw=function(k,title,sub){return '<div class="sw"><div><b>'+title+'</b><span>'+sub+'</span></div><button class="switch" type="button" role="switch" aria-checked="'+(A[k]?'true':'false')+'" data-a="after-'+k+'" aria-label="'+title+'"><i></i></button></div>';};
  return '<h2>After the call</h2><div class="card">'+
    sw('promise','Promise a call-back time',esc(L.name)+' tells callers when you will call back, inside your hours. If the time passes, '+esc(L.name)+' calls them to set a new one.')+
    (S.features.textback?sw('textback','Text after a missed call','One text to anyone who hangs up before leaving a message.'):'')+
    (S.features.jobs?sw('checkins','Check in after a job',esc(L.name)+' calls a customer a few days after a finished job to ask if the work held up, only if they said OK when you logged the job.'):'')+
    (A.canText||!S.features.textback?'':'<p class="fine"><span class="chip">Waiting on texting approval</span> Texts start once your texting registration is approved. <a href="'+BASE+'/texting">Check it</a></p>')+'</div>'+outCard(L)+outreachCard();
}
function outreachCard(){
  var R=S.outreach;if(!R)return '';
  var c=R.counts||{};
  var h='<h2>'+esc(R.label)+'</h2><div class="card form">';
  if(!R.live)h+='<p class="note" style="margin-top:0"><b>Not calling yet.</b> This is being reviewed before it goes live. You can set it up now, and nothing is dialed until then.</p>';
  h+='<p class="fine">'+esc(R.sub)+'</p>';
  if(!R.attested)return h+'<p>'+esc(R.attest)+'</p><div class="acts"><button class="btn red" type="button" data-a="or-attest">I confirm</button></div></div>';
  h+='<label>What Max says for you (one sentence)<textarea id="or-pitch" maxlength="240" rows="3" placeholder="We clean commercial kitchen hoods and can work around your hours.">'+esc(R.pitch||'')+'</textarea></label>'+
    '<label class="opt" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="or-on"'+(R.on?' checked':'')+'> <span>Call my list when this goes live</span></label>'+
    '<div class="acts"><button class="btn red" type="button" data-a="or-save">Save</button></div>'+
    '<label>Businesses to call (one per line: name, phone, contact)<textarea id="or-list" rows="4" placeholder="Ace Diner, 478-555-0101, Sam"></textarea></label>'+
    '<div class="acts"><button class="btn line" type="button" data-a="or-list">Check and add</button></div>'+
    '<p class="fine">'+c.ready+' ready, '+c.skipped+' skipped (mobile numbers are never called), '+c.called+' called, '+c.interested+' interested, '+c.optout+' asked not to be called.</p>';
  return h+'</div>';
}
function outCard(L){
  var O=S.outcalls;if(!O||!O.list)return '';
  var one=function(x){return '<label class="opt" style="display:flex;gap:10px;align-items:flex-start;margin-top:10px"><input type="checkbox" data-oc="'+esc(x.key)+'"'+(O.on[x.key]?' checked':'')+' style="margin-top:3px"> <span><b>'+esc(x.label)+'</b><br><span class="fine">'+esc(x.sub)+'</span></span></label>';};
  return '<h2>Calls '+esc(L.name)+' makes</h2><div class="card"><p class="fine" style="margin-top:0">To you, or to customers who already agreed to hear from you when you logged the appointment, estimate or job. Nobody is asked twice. Never between 9 PM and 8 AM, and anyone who says stop is never called again.</p>'+O.list.map(one).join('')+'</div>';
}
function voiceCard(L){
  return '<h2>Voice and greeting</h2><div class="card form">'+
    '<label>Name<input type="text" id="vc-name" maxlength="30" value="'+esc(L.name)+'" placeholder="Max"></label>'+
    '<label>Voice<select id="vc-voice">'+L.voices.map(function(v){return '<option value="'+esc(v.key)+'"'+sel(L.voice,v.key)+'>'+esc(v.label)+'</option>';}).join('')+'</select></label>'+
    '<div class="acts"><button class="btn red" type="button" data-a="vc-save">Save</button><a class="btn line sm" href="tel:'+esc(L.number)+'">Call to hear it</a></div>'+
    '<p class="fine" style="margin-top:12px"><b>Your own greeting.</b> Record up to 15 seconds in your own voice (WAV or MP3). Callers hear it first, then '+esc(L.name)+' says he is an automated assistant and the call may be recorded.</p>'+
    (L.greetingAudio?'<audio controls src="'+esc(L.greetingAudio)+'" style="width:100%"></audio><div class="acts"><button class="btn ghost sm" type="button" data-a="vc-rm">Remove my recording</button></div>':'<label>Recording<input type="file" id="vc-file" accept="audio/wav,audio/x-wav,audio/mpeg,.wav,.mp3"></label><div class="acts"><button class="btn line sm" type="button" data-a="vc-up">Upload</button></div>')+
    '</div>';
}
function voiceUpload(){
  var f=$('#vc-file');f=f&&f.files&&f.files[0];if(!f){toast('Pick a WAV or MP3 file first.');return;}
  var type=/\.mp3$/i.test(f.name)?'audio/mpeg':(/\.wav$/i.test(f.name)?'audio/wav':f.type);
  api('greeting-audio',{method:'POST',headers:{'content-type':type},body:f}).then(function(res){if(res.j.ok){S.line=res.j.line;render();toast('Saved. Callers hear it on the next call.');}else toast(res.j.error||'Could not upload.');}).catch(function(){toast('No connection. Try again.');});
}
function bookSave(){
  var days={},on=function(id){var c=$('#bk-'+id+'-on');return c&&c.checked;},span=function(id){return [mins($('#bk-'+id+'-o').value),mins($('#bk-'+id+'-c').value)];};
  if(on('wk'))['Mon','Tue','Wed','Thu','Fri'].forEach(function(k){days[k]=span('wk');});
  if(on('sat'))days.Sat=span('sat');
  if(on('sun'))days.Sun=span('sun');
  lineSave({booking:{mode:$('#bk-mode').value,slotMin:+$('#bk-len').value,bufferMin:+$('#bk-buf').value,days:days}});
}
function teachCard(L){
  if(!L.know||S.client.regulated)return '';
  var h='<h2>Teach '+esc(L.name)+' about your business</h2>';
  if(L.pending&&L.pending.items&&L.pending.items.length){
    h+='<div class="card glow"><b>What '+esc(L.name)+' heard on your call</b><p class="fine">Check it. Nothing changes until you tap Looks right.</p><ul class="why">'+L.pending.items.map(function(x){return '<li><b>'+esc(x.label)+':</b> '+esc(x.value)+'</li>';}).join('')+'</ul>'+
      '<div class="acts"><button class="btn red" type="button" data-a="facts-keep">Looks right</button><button class="btn ghost" type="button" data-a="facts-drop">Throw it away</button></div></div>';
  }
  h+='<div class="card form"><p class="fine" style="margin-top:0">'+esc(L.name)+' answers price, area and urgent questions with this, instead of only taking a message. Have '+esc(L.name)+' call you and ask (about three minutes), or type it in.</p>'+
    '<div class="acts" style="margin-bottom:10px"><button class="btn line" type="button" data-a="facts-call">Have '+esc(L.name)+' call me</button></div>'+
    L.know.map(function(x){return '<label>'+esc(x.label)+'<textarea id="kf-'+esc(x.key)+'" rows="2" maxlength="600" placeholder="'+esc(x.hint||'')+'">'+esc(x.value||'')+'</textarea></label>';}).join('')+
    '<div class="acts"><button class="btn red" type="button" data-a="facts-save">Save</button></div></div>';
  return h;
}
function factsSave(){var L=S.line,f={};(L.know||[]).forEach(function(x){var el=$('#kf-'+x.key);if(el)f[x.key]=el.value;});lineSave({facts:f});}
function factsCall(){
  var L=S.line;
  sheet('<h2>'+esc(L.name)+' calls you</h2><p class="fine">'+esc(L.name)+' asks seven short questions and sends what he heard here for you to check. About three minutes.</p><label>Your number<input type="tel" id="iv-ph" inputmode="tel" maxlength="20" value="'+esc(S.client.phone||'')+'" placeholder="478 555 0142"></label><div class="acts"><button class="btn red" type="button" id="go">Call me now</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var t=this;t.disabled=true;post('line',{action:'interview',phone:$('#iv-ph').value}).then(function(res){t.disabled=false;if(res.j.ok){close();toast(res.j.message||'Calling you now.');}else toast(res.j.error||'Could not call. Try again.');}).catch(function(){t.disabled=false;toast('No connection. Try again.');});};
}
function maxSetup(b){if(b)b.disabled=true;toast('Getting Max a number for you\u2026');post('max-setup',{}).then(function(res){if(b)b.disabled=false;if(res.j.ok){toast(res.j.status==='live'?'Max is ready at '+res.j.numberText+'. The steps to forward your calls are on Home.':'Max\u2019s number is on its way. You get a notice here the moment it\u2019s ready.');load(true);}else toast(res.j.error||'Could not set Max up. Try again.');}).catch(function(){if(b)b.disabled=false;toast('No connection. Try again.');});}
function lineSave(body,done){
  needName(function(by){body.by=by;post('line',body).then(function(res){if(res.j.ok){S.line=res.j.line;if(body.hours!=null)DIRTY=false;render();toast(res.j.unchanged?'Nothing changed.':'Saved. '+S.line.name+' uses it on the next call.');if(done)done();}else toast(res.j.error||'Could not save. Try again.');}).catch(function(){toast('No connection. Try again.');});});
}
function lineToggle(){
  var L=S.line;if(!L)return;
  if(L.onAir){sheet('<h2>Turn '+esc(L.name)+' off?</h2><p class="fine">Callers will '+(L.transferTo?'ring through to '+esc(L.transferText):'hear a short message asking them to call back')+'. You can turn it back on any time.</p><div class="acts"><button class="btn red" type="button" id="go">Turn off</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');$('#go').onclick=function(){close();lineSave({onAir:false});};}
  else lineSave({onAir:true});
}
function askAbout(what,text){
  sheet('<h2>Ask about '+esc(what)+'?</h2><p class="fine">We\\u2019ll get the request and answer you here.</p><div class="acts"><button class="btn red" type="button" id="go">Send</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){send('note',text,close);};
}

/* ---------- Approve ---------- */
function install(){
  var sa=window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone;
  if(sa||store('ao_inst_x'))return '';
  var ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ios)return '<div class="banner"><div><b>Put Always Open on your Home Screen</b>Tap the Share button, then \\u201cAdd to Home Screen.\\u201d It opens like an app.</div><button class="x" type="button" data-a="inst-x" aria-label="Hide">\\u00d7</button></div>';
  if(DEFER)return '<div class="banner"><div><b>Install Always Open</b>Keep it on your phone like an app.</div><button class="btn red" type="button" data-a="inst">Install</button></div>';
  return '';
}
function card(it){
  var reg=S.client.regulated,ed=EDIT[it.id];
  var kind=it.kind==='post'?'Google post':(it.kind==='reviewreq'?'Review request':'Review reply');
  var head='<div class="ch"><span class="chip'+(/storm/i.test(it.context)&&it.kind==='post'?' storm':'')+'">'+kind+'</span>'+(it.kind!=='post'&&it.stars?'<span class="stars" aria-label="'+it.stars+' stars">'+stars(it.stars)+'</span>':'')+(it.title?'<span class="who">'+esc(it.title)+'</span>':'')+'</div>';
  var ctx=it.kind==='reviewreq'?(it.context?'<div class="lbl">'+esc(it.context)+'</div>':''):it.kind!=='post'?(it.context?'<div class="lbl">Their review</div><blockquote>'+esc(it.context)+'</blockquote>':'<blockquote>Rating only, no written review.</blockquote>'):(it.context?'<div class="lbl">'+esc(it.context)+'</div>':'');
  var pic=it.photo?'<img class="pic" src="'+esc(it.photo)+'" alt="Your photo for this post" loading="lazy">':'';
  var lblA=it.kind==='post'?'Your post':(it.kind==='reviewreq'?'The email':'Your reply'),lblB=it.kind==='post'?'The post':(it.kind==='reviewreq'?'The email they get':'Our reply for you');
  var body=pic+(ed!=null?'<div class="lbl">'+lblA+'</div><textarea data-ed="'+esc(it.id)+'" aria-label="Edit the text">'+esc(ed)+'</textarea>':'<div class="lbl">'+lblB+'</div><div class="draft">'+esc(it.text)+'</div>');
  var vs=VERS[it.id];
  if(vs&&vs.length)body+='<div class="vers">'+vs.map(function(v,i){return '<div class="ver"><div class="lbl">'+esc(v.label)+'</div><div class="draft">'+esc(v.text)+'</div><button class="btn line" type="button" data-a="usever" data-id="'+esc(it.id)+'" data-i="'+i+'">Use this one</button></div>';}).join('')+'</div>';
  else if(vs==='loading')body+='<p class="fine">Writing two more versions\u2026</p>';
  var cg=it.checked?'<span class="cg">'+ICON.shield+'Checked by Compliance Guard</span>':'';
  var acts=ed!=null?'<button class="btn ok" type="button" data-a="save" data-id="'+esc(it.id)+'">Save and approve</button><button class="btn ghost" type="button" data-a="cancel" data-id="'+esc(it.id)+'">Cancel</button>':
    '<button class="btn ok" type="button" data-a="approve" data-id="'+esc(it.id)+'">'+ICON.check.replace('<svg','<svg width="20" height="20"')+'Approve</button><button class="btn line" type="button" data-a="edit" data-id="'+esc(it.id)+'">Edit</button>'+(S.features&&S.features.versions&&it.kind!=='post'&&it.kind!=='reviewreq'&&!vs?'<button class="btn ghost" type="button" data-a="versions" data-id="'+esc(it.id)+'">Other versions</button>':'')+'<button class="btn ghost" type="button" data-a="skip" data-id="'+esc(it.id)+'">Skip</button>';
  return '<article class="card'+(ed!=null?'':' swp')+'" id="c-'+esc(it.id)+'" data-sw="'+esc(it.id)+'">'+(ed!=null?'':'<span class="swhint ok">Approve</span><span class="swhint no">Skip</span>')+head+ctx+body+cg+'<div class="hits" hidden></div><div class="acts">'+acts+'</div></article>';
}
var FILT='all';
var FK={all:function(){return true;},reply:function(x){return x.kind!=='post'&&x.kind!=='reviewreq';},post:function(x){return x.kind==='post';},reviewreq:function(x){return x.kind==='reviewreq';}};
function vApprove(){
  var all=S.items||[],done=S.done||[];
  var cnt=function(k){return all.filter(FK[k]).length;};
  if(!cnt(FILT))FILT='all';
  var items=all.filter(FK[FILT]);
  var h='<h1>To approve</h1><p class="lede">Replies to your reviews and posts for your Google page. Nothing goes out until you approve it.</p>'+install();
  if(all.length>1)h+='<div class="fchips" role="group" aria-label="Show">'+[['all','All'],['reply','Replies'],['post','Posts'],['reviewreq','Review requests']].filter(function(f){return f[0]==='all'||cnt(f[0]);}).map(function(f){return '<button type="button" data-a="filt" data-k="'+f[0]+'" aria-pressed="'+(FILT===f[0])+'">'+f[1]+'<i>'+cnt(f[0])+'</i></button>';}).join('')+'</div>';
  if(all.length&&!store('ao_swiped'))h+='<p class="swtip">'+ICON.check.replace('<svg','<svg width="16" height="16"')+'Swipe a card right to approve, left to skip.</p>';
  h+=items.length?items.map(card).join(''):'<div class="empty">'+ICON.check+'<b>You\\u2019re all caught up</b><span>New review replies and posts land here for your OK.</span></div>';
  if(done.length)h+='<h2>Recently handled</h2><div class="done">'+done.slice(0,12).map(function(d){var st=d.status==='approved'?'Approved':(d.status==='skipped'?'Skipped':'Handled by Always Open');return '<div><i class="'+(d.status==='approved'?'':'skip')+'"></i><p>'+esc(d.text||d.title)+'</p><span>'+st+(d.by&&d.status!=='closed'?' by '+esc(d.by):'')+(d.at?' \\u00b7 '+esc(when(d.at)):'')+'</span></div>';}).join('')+'</div>';
  h+='<p class="note">'+(name()?'You\\u2019re approving as '+esc(name())+'. <a href="#" data-a="rename" style="color:inherit">Change</a>':'')+'</p>';
  return h+vReviews();
}
function decide(id,action,text){
  var it=(S.items||[]).filter(function(x){return x.id===id;})[0];if(!it)return;
  needName(function(by){
    var c=document.getElementById('c-'+id),btns=c?c.querySelectorAll('button'):[];for(var i=0;i<btns.length;i++)btns[i].disabled=true;
    post('decide',{id:id,action:action,text:text,by:by}).then(function(res){
      if(res.status===200&&res.j.ok){
        delete EDIT[id];S.items=S.items.filter(function(x){return x.id!==id;});
        S.done=[{id:id,kind:it.kind,title:it.title,status:res.j.status,text:text||it.text,at:res.j.at,by:by}].concat(S.done||[]);
        (S.reviews||[]).forEach(function(r){if(r.id===id){r.status=res.j.status;r.reply=text||it.text;r.decidedAt=res.j.at;}});
        toast(action==='approve'?'Approved. We\\u2019ll post it.':'Skipped.');render();return;
      }
      for(var k=0;k<btns.length;k++)btns[k].disabled=false;
      if(res.status===422&&res.j.hits){var hb=c.querySelector('.hits');hb.innerHTML='<b>Please change these first</b><ul>'+res.j.hits.map(function(x){return '<li><mark>'+esc(x.w)+'</mark> '+esc(x.why)+'</li>';}).join('')+'</ul>';hb.hidden=false;if(EDIT[id]==null){EDIT[id]=text||it.text;render();var c2=document.getElementById('c-'+id);if(c2){var hb2=c2.querySelector('.hits');hb2.innerHTML=hb.innerHTML;hb2.hidden=false;}}return;}
      toast(res.j.error||'Could not save. Try again.');if(res.status===409||res.status===404)load(true);
    }).catch(function(){for(var k=0;k<btns.length;k++)btns[k].disabled=false;toast('No connection. Try again.');});
  });
}

/* ---------- Calls (the phone line) ---------- */
function callsList(){
  var cs=S.calls||[],open=cs.filter(function(c){return c.status!=='handled';}),done=cs.filter(function(c){return c.status==='handled';});
  var h='<p class="note" style="margin:-4px 2px 10px">Call them back, then tap Done.</p>';
  if(!cs.length)return h+'<div class="empty">'+ICON.phone+'<b>No calls yet</b><span>When Max takes a call, who called, their number and what they need show up here, and your phone buzzes.</span></div>';
  h+=open.length?open.map(callCard).join(''):'<div class="empty">'+ICON.check+'<b>You\u2019re all caught up</b><span>Every call has been handled.</span></div>';
  if(done.length)h+='<h2>Handled</h2>'+done.slice(0,20).map(callCard).join('');
  return h;
}
function callCard(c){
  var who=c.name||c.callbackText||c.numberText||'A caller';
  var missed=c.outcome==='hangup'||c.outcome==='failed'||c.outcome==='limited';
  var chips=(c.urgent?'<span class="chip urgent">Urgent</span>':'')+(missed?'<span class="chip missed">'+(c.outcome==='hangup'?'Hung up':'Missed')+'</span>':'')+(c.outcome==='transferred'?'<span class="chip ok">Put through to you</span>':'')+(c.status==='handled'?'<span class="chip ok">Done'+(c.by?' \u00b7 '+esc(c.by):'')+'</span>':'');
  var meta=(c.reason?'<span><b>Wants:</b> '+esc(c.reason)+'</span>':'')+(c.details?'<span><b>Details:</b> '+esc(c.details)+'</span>':'')+(c.when?'<span><b>When:</b> '+esc(c.when)+'</span>':'')+(c.callbackText&&c.callbackText!==c.numberText?'<span><b>Call back on:</b> '+esc(c.callbackText)+'</span>':'');
  var acts=(c.callback?'<a class="btn ok" href="tel:'+esc(c.callback)+'">'+ICON.phone.replace('<svg','<svg width="20" height="20"')+'Call back</a><a class="btn line" href="sms:'+esc(c.callback)+'">Text</a>':'')+
    (c.status==='handled'?'<button class="btn ghost" type="button" data-a="call-reopen" data-id="'+esc(c.id)+'">Not done</button>':'<button class="btn ghost" type="button" data-a="call-done" data-id="'+esc(c.id)+'">Done</button>');
  var said=c.transcript&&c.transcript.length?'<details><summary>What was said</summary><div class="said">'+c.transcript.map(function(x){if(x.w==='held')return '<p class="held">'+esc((S.line&&S.line.name)||'Max')+' held back: '+esc(x.t)+'</p>';return '<p class="'+(x.w==='caller'?'caller':'ai')+'"><small>'+(x.w==='caller'?'Caller':esc(S.line?S.line.name:'Phone line'))+'</small>'+esc(x.t)+'</p>';}).join('')+'</div></details>':'';
  return '<article class="call'+(c.urgent&&c.status!=='handled'?' urgent':'')+(c.status==='handled'?' handled':'')+'" id="call-'+esc(c.id)+'"><div class="top2"><span class="nm">'+esc(who)+'</span><span class="num">'+esc(c.numberText||'')+' \u00b7 '+esc(when(c.at))+'</span></div>'+(chips?'<div class="ch">'+chips+'</div>':'')+
    '<p class="sum">'+esc(c.summary||'')+'</p>'+(meta?'<div class="meta">'+meta+'</div>':'')+'<div class="acts">'+acts+'</div>'+said+'</article>';
}
function markCall(id,action){
  needName(function(by){
    post('call',{id:id,action:action,by:by}).then(function(res){
      if(res.j.ok){(S.calls||[]).forEach(function(c){if(c.id===id){c.status=res.j.status;c.by=action==='reopen'?'':by;}});render();toast(action==='reopen'?'Moved back to open.':'Marked done.');}
      else toast(res.j.error||'Could not save. Try again.');
    }).catch(function(){toast('No connection. Try again.');});
  });
}

/* ---------- Your month ---------- */
var TILES=[['reviews','New reviews'],['rating','Google rating'],['replies','Replies posted'],['posts','Posts published'],['calls','Calls from Google'],['clicks','Website clicks'],['directions','Direction requests']];
function fmt(k,v){if(v==null||v==='')return '\\u2014';v=+v;if(isNaN(v))return '\\u2014';return k==='rating'?v.toFixed(1):v.toLocaleString('en-US');}
function showQr(){
  var q=S.client.qr;if(!q)return;
  var svg='<svg viewBox="0 0 '+(q.n+8)+' '+(q.n+8)+'" role="img" aria-label="QR code for your Google review page" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="'+esc(q.d)+'" fill="#000"/></svg>';
  sheet('<h2>Scan to review '+esc(S.client.business)+'</h2><div class="qrbox">'+svg+'</div><p class="fine">Opens your Google review page. Ask everyone, never offer anything for a review.</p><div class="acts"><a class="btn line" href="'+esc(BASE+'/help/qr')+'">Print a card</a><button class="btn ok" type="button" data-close="1">Done</button></div>');
}
function refer(){
  var url=S.client.refLink,text=(S.line?'I use Always Open to run the back side of my business: calls, reviews and follow-ups, handled.':'I use Always Open for our reviews and Google profile.')+' They\\u2019ll do a free audit of your business too (I get a free month if you sign up and stay):';
  if(navigator.share){navigator.share({title:'Always Open',text:text,url:url}).catch(function(){});return;}
  var t=text+' '+url;
  try{navigator.clipboard.writeText(t).then(function(){toast('Link copied. Paste it in a text.');},function(){toast(url);});}catch(e){toast(url);}
}

/* ---------- Ask us ---------- */
function vAsk(){
  var f=S.features||{},reg=S.client.regulated;
  var h='<h1>Ask us</h1><p class="lede">Goes straight to Katie. She answers the same business day, usually.</p>';
  var ms=S.messages||[];
  h+=ms.length?'<div class="thread">'+ms.map(function(m){return '<div class="msg '+m.dir+'">'+esc(m.text)+'<small>'+(m.dir==='out'?'Always Open':esc(m.by||'You'))+' \\u00b7 '+esc(when(m.at))+'</small></div>';}).join('')+'</div>':'<p class="note" style="margin:14px 2px">Questions, changes, anything. We answer here.</p>';
  h+='<div class="compose"><label class="lbl" for="msg" style="margin:0">Message</label><textarea id="msg" maxlength="1000" placeholder="Type your message"></textarea>'+(reg?'<p class="fine">Please don\\u2019t include client names, policy or account numbers, or claim details.</p>':'')+'<div class="acts"><button class="btn red" type="button" data-a="send">Send</button></div></div>';
  return h;
}
function send(kind,text,after,extra){
  needName(function(by){
    post('message',Object.assign({kind:kind,text:text,by:by},extra||{})).then(function(res){
      if(res.j.ok){S.messages=(S.messages||[]).concat([{id:res.j.id,at:res.j.at,by:by,text:res.j.text||text,dir:'in'}]);toast('Sent to the Always Open team.');render();if(after)after();}
      else toast(res.j.error||'Could not send. Try again.');
    }).catch(function(){toast('No connection. Try again.');});
  });
}
function today(){return new Date().toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});}
function closedSheet(){
  sheet('<h2>Closed today?</h2><p class="fine">'+(S.line?esc(S.line.name||'Max')+' tells callers you\\u2019re closed today and takes a message. ':'')+'We mark '+esc(S.client.business)+' closed for '+esc(today())+' on Google.</p><label>Reason, if you want customers to know (optional)<input type="text" id="why" maxlength="120" placeholder="For example: weather, family emergency"></label><div class="acts"><button class="btn red" type="button" id="go">Send</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var w=$('#why').value.trim(),e=new Date();e.setHours(23,59,0,0);send('hours','Closed today ('+today()+')'+(w?'. Reason: '+w:'')+'.',function(){close();if(S.line){S.line.closedUntil=e.toISOString();render();}toast(S.line?(S.line.name||'Max')+' is telling callers you\u2019re closed today. We\u2019ll update Google.':'Sent. We\u2019ll mark you closed on Google.');},{closedUntil:e.toISOString(),why:w});};
}
function hoursSheet(title){
  sheet('<h2>'+esc(title||'Holiday or new hours')+'</h2><label>Which days?<input type="text" id="hd" maxlength="120" placeholder="For example: Nov 27 and 28, or every Saturday"></label><label>What hours?<input type="text" id="hh" maxlength="160" placeholder="For example: closed, or 9 to 1"></label><div class="acts"><button class="btn red" type="button" id="go">Send</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var d=$('#hd').value.trim(),t=$('#hh').value.trim();if(!d||!t){toast('Add the days and the hours.');return;}send('hours',d+': '+t+'.',close);};
}
function jobSheet(){
  sheet('<h2>Finished a job</h2><p class="fine">They get one note asking for a Google review: a text, or an email you approve first. Add every customer, not just the happy ones.</p><label>Customer\\u2019s first name<input type="text" id="jf" maxlength="40" autocomplete="off"></label><label>Their cell number<input type="tel" id="jp" maxlength="20" inputmode="tel" autocomplete="off" placeholder="478 555 0142"></label><label>Or their email<input type="email" id="je" maxlength="120" inputmode="email" autocomplete="off" placeholder="name@example.com"></label><label>What was the job? (optional)<input type="text" id="jj" maxlength="80"></label><label class="check"><input type="checkbox" id="jc"><span>They agreed to hear from us once, by text or email.</span></label>'+(S.checkins&&S.checkins.on?'<label class="check"><input type="checkbox" id="jcc"><span>They are OK with a quick call from Max in a few days to check the work held up.</span></label>':'')+'<div class="acts"><button class="btn ok" type="button" id="go">Add</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  setTimeout(function(){$('#jf').focus();},60);
  $('#go').onclick=function(){
    var b=this;if(!$('#jc').checked){toast('Only add people who agreed to hear from you.');return;}
    needName(function(by){b.disabled=true;post('job',{first:$('#jf').value,phone:$('#jp').value,email:$('#je').value,job:$('#jj').value,consent:true,callOk:!!($('#jcc')&&$('#jcc').checked),by:by}).then(function(res){b.disabled=false;if(res.j.ok){close();toast(res.j.duplicate?res.j.message:((res.j.draft||res.j.checkin)?res.j.message:'Added. Their review request goes out soon.'));}else toast(res.j.error||'Could not add. Try again.');}).catch(function(){b.disabled=false;toast('No connection. Try again.');});});
  };
}
function photoSheet(){
  sheet('<h2>Photo for a post</h2><p class="fine">A finished job, your team, something new. We write the post and send it back here for your OK.</p><label>Photo<input type="file" id="pf" accept="image/*"></label><img class="prev" id="pv" alt="" hidden><label>What should people know? (optional)<input type="text" id="pn" maxlength="300" placeholder="For example: new deck on Lake Oconee"></label><div class="acts"><button class="btn ok" type="button" id="go" disabled>Send photo</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  var blob=null;
  $('#pf').onchange=function(){var f=this.files&&this.files[0];if(!f)return;$('#go').disabled=true;shrink(f,function(b){blob=b;if(!b){toast('That photo would not open. Try another.');return;}var pv=$('#pv');pv.src=URL.createObjectURL(b);pv.hidden=false;$('#go').disabled=false;});};
  $('#go').onclick=function(){
    var b=this;if(!blob)return;
    needName(function(by){b.disabled=true;b.textContent='Sending\\u2026';
      fetch(BASE+'/api/photo?note='+encodeURIComponent($('#pn').value.trim())+'&by='+encodeURIComponent(by),{method:'POST',headers:{'content-type':'image/jpeg'},body:blob}).then(function(r){return r.json();}).then(function(j){if(j.ok){close();toast('Photo sent. Your post comes back here to approve.');}else{b.disabled=false;b.textContent='Send photo';toast(j.error||'Could not send. Try again.');}}).catch(function(){b.disabled=false;b.textContent='Send photo';toast('No connection. Try again.');});
    });
  };
}
function shrink(file,cb){
  var url=URL.createObjectURL(file),img=new Image();
  img.onload=function(){var max=1600,w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,max/Math.max(w,h));var cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*k));cv.height=Math.max(1,Math.round(h*k));cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(url);if(cv.toBlob)cv.toBlob(function(b){cb(b);},'image/jpeg',0.82);else cb(null);};
  img.onerror=function(){URL.revokeObjectURL(url);cb(null);};
  img.src=url;
}

${BIZ_JS}
${PAST_JS}
${RIVALS_JS}
/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-tab],[data-a],[data-close],[data-go],[data-seg],[data-mseg]');if(!t)return;
  if(t.dataset.mseg){MSEG=t.dataset.mseg;render();window.scrollTo(0,0);return;}
  if(t.dataset.seg){SEG=t.dataset.seg;try{localStorage.setItem('ao-seg',SEG);}catch(x){}render();var vw=$('#view');if(vw&&vw.getBoundingClientRect().top<0)window.scrollTo(0,0);return;}
  if(t.dataset.go){TAB={approve:'today',up:'money',fu:'today',home:'today',ask:'today'}[t.dataset.go]||t.dataset.go;if(TABS.indexOf(TAB)<0)TAB='today';render();window.scrollTo(0,0);return;}
  if(t.dataset.close){close();return;}
  if(t.dataset.tab){TAB=t.dataset.tab;try{history.replaceState(null,'','#'+TAB);}catch(x){}render();window.scrollTo(0,0);return;}
  var a=t.dataset.a,id=t.dataset.id;
  if(a==='map-open'){mapOpen();return;}
  if(a==='katie'){katieSheet();return;}
  if(a==='need-more'){NEEDALL=!NEEDALL;render();return;}
  if(a==='map-show'){var on=t.getAttribute('aria-checked')!=='true';t.disabled=true;post('map',{show:on}).then(function(res){t.disabled=false;if(res.j.ok){S.map=res.j.map;toast(on?'You are on the map.':'You are off the map.');render();}else toast(res.j.error||'Could not save.');}).catch(function(){t.disabled=false;toast('No connection. Try again.');});return;}
  if(a==='approve')decide(id,'approve','');
  else if(a==='edit'){var it=(S.items||[]).filter(function(x){return x.id===id;})[0];if(it){EDIT[id]=it.text;render();var ta=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}}}
  else if(a==='cancel'){delete EDIT[id];render();}
  else if(a==='versions'){VERS[id]='loading';render();post('versions',{id:id}).then(function(res){if(res.j.ok){VERS[id]=res.j.versions;}else{delete VERS[id];toast(res.j.error||'Not available right now.');}render();}).catch(function(){delete VERS[id];render();toast('No connection. Try again.');});}
  else if(a==='usever'){var vv=(VERS[id]||[])[+t.dataset.i];if(vv){EDIT[id]=vv.text;delete VERS[id];render();var ta2=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');if(ta2)ta2.focus();}}
  else if(a==='save'){var tx=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');var v=tx?tx.value.trim():'';if(!v){toast('The text is empty.');return;}EDIT[id]=v;decide(id,'approve',v);}
  else if(a==='skip'){if(t.classList.contains('sure'))decide(id,'skip','');else{t.classList.add('sure');t.textContent='Tap again to skip';setTimeout(function(){if(t.isConnected){t.classList.remove('sure');t.textContent='Skip';}},4000);}}
  else if(a==='fl-done'){S.firstLookDue=false;render();post('firstlook',{action:'done'});}
  else if(a==='sh-copy'){var m=(S.share||{}).message||'';if(navigator.clipboard)navigator.clipboard.writeText(m).then(function(){toast('Copied. Paste it wherever you like.');post('firstlook',{action:'share-done'});S.share=null;render();},function(){toast(m);});}
  else if(a==='sh-done'){S.share=null;render();post('firstlook',{action:'share-done'});}
  else if(a==='up-all'){UPALL=!UPALL;render();}
  else if(a==='up-ask'){var uu=((S.upgrades||{}).list||[]).filter(function(x){return x.id===id;})[0];if(uu)askAbout(uu.name,uu.ask);}
  else if(a==='cb-done'||a==='cb-later'){t.disabled=true;post('callbacks',{action:a==='cb-done'?'done':'later',id:+id}).then(function(res){toast(res.j.message||res.j.error||'Done.');load();}).catch(function(){t.disabled=false;toast('No connection.');});}
  else if(a==='inst-x'){store('ao_inst_x','1');render();}
  else if(a==='inst'){if(DEFER){DEFER.prompt();DEFER=null;render();}}
  else if(a==='rename'){e.preventDefault();store('ao_by',null);needName(function(){render();});}
  else if(a==='m'){MONTH=t.dataset.m;render();}
  else if(a==='qr')showQr();
  else if(a==='refer')refer();
  else if(a==='closed')closedSheet();
  else if(a==='hours')hoursSheet();
  else if(a==='job')jobSheet();
  else if(a==='photo')photoSheet();
  else if(a==='send'){var m=$('#msg'),txt=m?m.value.trim():'';if(!txt){toast('Type a message first.');return;}send('note',txt,function(){m.value='';});}
  else if(a==='fu-add')fuSheet();
  else if(a==='inv-add')invSheet();
  else if(a==='inv-paid')invMark(id,true);
  else if(a==='inv-open')invMark(id,false);
  else if(a==='inv-copy'){var iv=(S.invoices||[]).filter(function(x){return String(x.id)===String(id);})[0];if(iv)copyText(iv.link,'Invoice link copied.');}
  else if(a==='copy-link')copyText(t.dataset.u,'Link copied.');
  else if(a==='meta-off'){fetch('/meta/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:BASE.split('/').pop()})}).then(function(){S.meta.connected=false;render();toast('Facebook disconnected.');});}
  else if(a==='fu-done')fuMark(id,'done');
  else if(a==='fu-copy'){var fx=(S.followups||[]).filter(function(x){return String(x.id)===String(id);})[0];if(fx){var tx2=fuText(fx);try{navigator.clipboard.writeText(tx2).then(function(){toast('Text copied. Paste it in a message.');},function(){toast(tx2);});}catch(x2){toast(tx2);}}}
  else if(a==='line-toggle')lineToggle();
  else if(a==='line-on')lineSave({onAir:true});
  else if(a==='sign')signTap();
  else if(a==='money-set')moneySheet();
  else if(a==='clock-list')clockSheet();
  else if(a==='ref-x'){store('ao_ref_x',JSON.stringify({k:(S.referrals&&S.referrals.nudge||{}).key,at:Date.now()}));render();}
  else if(a==='filt'){FILT=t.dataset.k;render();}
  else if(a==='tile')tileSheet(t.dataset.k,t.dataset.m);
  else if(a==='jump'){e.preventDefault();var el2=document.getElementById(t.dataset.to);if(el2)el2.scrollIntoView({behavior:'smooth',block:'start'});}
  else if(a==='gcal-off'){fetch('/google/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:BASE.split('/').pop()})}).then(function(){S.calendar={connected:false};render();toast('Calendar disconnected.');});}
  else if(a==='facts-save')factsSave();
  else if(a==='bk-save')bookSave();
  else if(a==='vc-save')lineSave({voice:$('#vc-voice').value,name:$('#vc-name').value});
  else if(a==='vc-up')voiceUpload();
  else if(a==='vc-rm')lineSave({action:'remove-greeting-audio'});
  else if(a==='or-attest'||a==='or-save'||a==='or-list'){var ob=a==='or-attest'?{action:'attest'}:a==='or-save'?{action:'pitch',text:($('#or-pitch')||{}).value||'',on:!!(($('#or-on')||{}).checked)}:{action:'list',csv:($('#or-list')||{}).value||''};
    api('outreach',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob)}).then(function(res){toast(res.j.ok?(res.j.message||'Saved.'):(res.j.error||'Could not save.'));if(res.j.ok)load(true);});}
  else if(a&&a.indexOf('after-')===0){var k=a.slice(6),o={};o[k]=!(S.after&&S.after[k]);lineSave({after:o},function(){load(true);});}
  else if(a==='facts-call')factsCall();
  else if(a==='facts-keep'||a==='facts-drop')lineSave({action:a==='facts-keep'?'keep-facts':'drop-facts'});
  else if(a==='duty-save')dutySave();
  else if(a==='tell-go')tellMax();
  else if(a==='line-save')lineSave({hours:$('#lh').value,owner:$('#lo').value,transferTo:$('#lt').value,transferWhen:$('#lw').value,greeting:$('#lg').value});
  else if(a==='ask-pro')askAbout('Pro','I\u2019d like to hear about the Pro plan: follow-ups and missed-call text-back.');
  else if(a==='ask-growth')askAbout('Growth','I\u2019d like to hear about the Growth plan and competitor watch.');
  else if(a==='ask-max')maxSetup(t);
  else if(a==='go-leads'){TAB='customers';render();window.scrollTo(0,0);}
  else if(a==='reopen')send('hours','Open after all today ('+today()+').',function(){if(S.line)S.line.closedUntil='';render();toast('Got it. '+(S.line?(S.line.name||'Max')+' is back to your regular hours.':'We’ll update Google.'));},{reopen:true});
  else if(a==='call-done')markCall(id,'handled');
  else if(a==='call-reopen')markCall(id,'reopen');
  else if(a&&a.indexOf('rv-')===0)rvAct(a,id,t);
  else if(a&&/^(bz|fm|fw)-/.test(a))bizAct(a,id,t);
  else if(a&&a.indexOf('pc-')===0)pastAct(a,id,t);
});
function touch(t){if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)&&TOUCHED.indexOf(t)<0)TOUCHED.push(t);}
document.addEventListener('input',function(e){var t=e.target;touch(t);if(t&&t.dataset&&t.dataset.ed)EDIT[t.dataset.ed]=t.value;if(t&&/^(lh|lo|lt|lw|lg)$/.test(t.id))DIRTY=true;});
document.addEventListener('change',function(e){var t=e.target;touch(t);if(t&&t.id==='lw')DIRTY=true;});
$('#scrim').addEventListener('click',function(e){if(e.target.id==='scrim')close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#scrim').hidden)close();else if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('mapbox')){e.preventDefault();mapOpen();}});
$('#refresh').addEventListener('click',function(){load();});
/* swipe a card right to approve, left to skip */
(function(){
  var sx=0,sy=0,el=null,dx=0,axis='';
  document.addEventListener('touchstart',function(e){var c=e.target.closest('.card.swp');if(!c||e.target.closest('button,textarea,a,input'))return;el=c;sx=e.touches[0].clientX;sy=e.touches[0].clientY;dx=0;axis='';},{passive:true});
  document.addEventListener('touchmove',function(e){if(!el)return;var x=e.touches[0].clientX-sx,y=e.touches[0].clientY-sy;if(!axis){if(Math.abs(x)<8&&Math.abs(y)<8)return;axis=Math.abs(x)>Math.abs(y)*1.3?'x':'y';if(axis==='x')el.classList.add('drag');}
    if(axis!=='x')return;dx=x;el.style.transform='translateX('+dx+'px) rotate('+(dx/40)+'deg)';el.classList.toggle('r',dx>40);el.classList.toggle('l',dx<-40);},{passive:true});
  function end(){if(!el)return;var c=el,d=dx;el=null;c.classList.remove('drag');c.style.transform='';
    if(Math.abs(d)>=96){c.classList.add('gone');if(d<0)c.classList.add('l');store('ao_swiped','1');setTimeout(function(){decide(c.dataset.sw,d>0?'approve':'skip','');},160);}
    else c.classList.remove('r','l');}
  document.addEventListener('touchend',end);document.addEventListener('touchcancel',end);
})();
/* pull down at the top to refresh */
(function(){
  var ptr=document.createElement('div');ptr.className='ptr';ptr.textContent='Pull to refresh';var vw=$('#view');vw.parentNode.insertBefore(ptr,vw);
  var y0=null,on=false;
  document.addEventListener('touchstart',function(e){y0=window.scrollY<=0&&$('#scrim').hidden?e.touches[0].clientY:null;on=false;},{passive:true});
  document.addEventListener('touchmove',function(e){if(y0==null)return;var d=e.touches[0].clientY-y0;if(d>70&&!on){on=true;ptr.classList.add('on');ptr.textContent='Release to refresh';}else if(d<=70&&on){on=false;ptr.classList.remove('on');}},{passive:true});
  document.addEventListener('touchend',function(){if(on){ptr.textContent='Refreshing\\u2026';load();setTimeout(function(){ptr.classList.remove('on');ptr.textContent='Pull to refresh';},900);}y0=null;on=false;});
})();
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();DEFER=e;if(S)render();});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!editing())load(true,true);});
setInterval(function(){if(document.visibilityState==='visible'&&$('#scrim').hidden&&!Object.keys(EDIT).length&&!DIRTY&&!editing())load(true,true);},60000);
var OLD={home:'today',approve:'today',ask:'today',month:'money',record:'money',reviews:'money',calls:'max'},TABS=['today','customers','money','max'];
function fromHash(){var h=(location.hash||'').slice(1);if(OLD[h])h=OLD[h];return TABS.indexOf(h)>-1?h:'';}
window.addEventListener('hashchange',function(){var h=fromHash();if(h&&h!==TAB){TAB=h;render();window.scrollTo(0,0);}});
TAB=fromHash()||TAB;
render();load();
})();
`;
