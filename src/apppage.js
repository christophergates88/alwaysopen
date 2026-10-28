import { BIZ_JS } from './bizpage.js';
import { PAST_JS } from './pastpage.js';
import { RIVALS_JS } from './rivalspage.js';
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
    '<button class="icon" id="refresh" type="button" aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></header>' +
    '<div class="offline" id="offline" hidden>No connection. Showing what we had.</div>' +
    '<main id="view" tabindex="-1"><div class="loading"><span></span><span></span><span></span></div></main>' +
    '<nav class="tabs" aria-label="Sections">' +
    tab('home', 'Home', '<path d="M4 11.2L12 4.5l8 6.7V20h-5.2v-5.4H9.2V20H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    tab('approve', 'Approve', '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>') +
    tab('reviews', 'Reviews', '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    tab('max', 'Max', '<path d="M6.6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.9 5.9l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.6 5.5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    tab('ask', 'Ask us', '<path d="M4.5 6.5h15v10h-8l-4.5 3.5v-3.5H4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>') +
    '</nav>' +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>' +
    '<div class="scrim" id="scrim" hidden></div>' +
    '<script>var BASE=' + B + ';' + JS + '</script></body></html>';
}

function tab(id, label, path) {
  return '<button type="button" class="tab" data-tab="' + id + '" aria-label="' + label + '"' + (id === 'max' ? ' hidden' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg><span>' + label + '</span>' +
    (id === 'approve' ? '<i class="badge" id="badge" hidden></i>' : (id === 'max' ? '<i class="badge" id="cbadge" hidden></i>' : '')) + '</button>';
}

const CSS = `
:root{--paper:#0F131B;--card:#171C27;--ink:#ECEEF3;--slate:#A3ACBF;--line:#262E40;--panel:#1F2533;--sign:#FF6A5E;--on-sign:#1A0605;--sign-soft:#3A1F22;--ok:#5CC9A4;--on-ok:#06231A;--ok-soft:#173229;--warn:#F2C46B;--warn-soft:#33290F;
--glow:0 0 0 1px rgba(255,106,94,.22),0 0 24px rgba(255,90,77,.3),inset 0 0 16px rgba(255,90,77,.12);
--display:"Archivo","Arial Narrow",Arial,sans-serif;--body:"Instrument Sans",system-ui,-apple-system,sans-serif;--mono:"DM Mono",ui-monospace,Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background-color:var(--paper);background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;color:var(--ink);font:16px/1.45 var(--body);min-height:100vh;padding-bottom:calc(76px + env(safe-area-inset-bottom,0px))}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:3px solid var(--sign);outline-offset:2px}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:color-mix(in srgb,var(--paper) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand svg{width:34px;height:34px;flex:none}
.brand div{display:grid;min-width:0}
.kick{font:500 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--slate)}
.brand b{font:800 1.05rem/1.15 var(--display);font-stretch:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;flex:none}
.icon svg{width:22px;height:22px}
.icon.spin svg{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.offline{background:var(--warn-soft);color:var(--warn);font-size:14px;text-align:center;padding:8px 16px}
main{max-width:680px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));outline:none}
h1{font:850 1.75rem/1.05 var(--display);font-stretch:92%;margin:4px 0 6px;letter-spacing:-.01em}
h2{font:800 1.15rem/1.2 var(--display);font-stretch:92%;margin:26px 0 10px}
.lede{color:var(--slate);margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px;display:grid;gap:12px}
.ch{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.chip{font:600 12.5px var(--body);background:var(--panel);border-radius:99px;padding:3px 10px}
.chip.storm{background:var(--warn-soft);color:var(--warn)}
.stars{color:#E8A317;letter-spacing:1px;font-size:15px}
.who{color:var(--slate);font-size:14px}
blockquote{margin:0;padding:10px 12px;border-left:3px solid var(--line);color:var(--slate);font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
.draft{font-size:16.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.pic{width:100%;max-height:320px;object-fit:cover;border-radius:12px;background:var(--panel)}
.lbl{font:500 11.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--slate);margin-bottom:-6px}
textarea{width:100%;min-height:140px;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px;line-height:1.45;resize:vertical}
input[type=text],input[type=tel],input[type=date]{width:100%;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px}
.gcard{margin:18px 0 0;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}.gcard .gh{display:flex;gap:12px;align-items:flex-start}.gcard .gh svg{width:22px;height:22px;color:var(--ok);flex:none;margin-top:2px}.gcard .gh b{display:block}.gcard .gh span{display:block;color:var(--slate);font-size:14px}.gcard details{margin-top:10px}.gcard summary{cursor:pointer;font-weight:600;font-size:14px}.gcard ul{margin:8px 0 6px;padding-left:18px;font-size:14px}.cg{display:inline-flex;align-items:center;gap:6px;font:600 13px var(--body);color:var(--ok);background:var(--ok-soft);border-radius:99px;padding:4px 10px;justify-self:start}
.cg svg{width:15px;height:15px}
.hits{background:var(--sign-soft);border-radius:12px;padding:10px 12px;font-size:14.5px}
.hits b{display:block;margin-bottom:4px}
.hits ul{margin:0;padding-left:18px}
mark{background:transparent;color:var(--sign);font-weight:700}
.acts{display:flex;flex-wrap:wrap;gap:8px}
.btn{min-height:46px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px solid transparent;padding:10px 18px;font-weight:700;font-size:16px;text-decoration:none;background:none}
a.btn{color:inherit}
.btn.small{min-height:38px;padding:6px 14px;font-size:14px}
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
.done div{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:12px 14px;border-top:1px solid var(--line);font-size:14.5px}
.done div:first-child{border-top:0}
.done i{grid-row:span 2;width:10px;height:10px;border-radius:50%;margin-top:6px;background:var(--ok)}
.done i.skip{background:var(--line)}
.done span{color:var(--slate);font-size:13.5px}
.done p{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.banner{display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center;background:var(--card);border:1.5px solid var(--sign);border-radius:16px;padding:12px 14px;margin:0 0 16px;font-size:14.5px}
.banner b{display:block;font-size:15px}
.banner .x{border:0;background:none;color:var(--slate);font-size:22px;width:36px;height:36px;line-height:1}
.months{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;margin:0 -2px 10px;scrollbar-width:none}
.months::-webkit-scrollbar{display:none}
.mchip{flex:none;border:1.5px solid var(--line);background:var(--card);border-radius:99px;padding:7px 14px;font-weight:600;font-size:14.5px}
.mchip[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:2px;align-content:start}
.tile b{font:850 1.9rem/1.05 var(--display);font-stretch:92%}
.tile span{color:var(--slate);font-size:13.5px}
.tile em{font-style:normal;font:500 12.5px var(--mono);margin-top:4px}
.up{color:var(--ok)}.down{color:var(--slate)}
.note{color:var(--slate);font-size:13.5px;margin:10px 2px 0}
.cblist{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:10px}.cbrow{display:grid;gap:8px;padding:10px 0;border-top:1px solid var(--line)}.cbrow .fine{display:block}.cbrow .acts{display:flex;flex-wrap:wrap;gap:8px}
.feature{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;display:grid;gap:10px;margin-top:14px}.reflist{list-style:none;padding:0;margin:0;display:grid;gap:6px}.reflist li{display:flex;justify-content:space-between;gap:10px;font-size:14px}.reflist span{opacity:.75;text-align:right}
.feature h3{margin:0;font:800 1.1rem var(--display);font-stretch:92%}
.feature p{margin:0;color:var(--slate);font-size:15px}
.recs{display:grid;gap:10px}
.rec{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;text-decoration:none;color:inherit}
.rec b{font-size:16px}
.rec span{color:var(--slate);font-size:13.5px;display:block}
.rec svg{width:20px;height:20px;color:var(--slate);flex:none}
.quick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:6px}
.qt{display:grid;gap:4px;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;min-height:92px;align-content:start}
.qt svg{width:24px;height:24px;color:var(--sign)}
.qt b{font-size:15.5px}
.qt span{color:var(--slate);font-size:13px;line-height:1.3}
.thread{display:grid;gap:8px;margin:6px 0 14px}
.msg{max-width:84%;padding:10px 13px;border-radius:16px;font-size:15.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.in{justify-self:end;background:var(--ink);color:var(--paper);border-bottom-right-radius:5px}
.msg.out{justify-self:start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:5px}
.msg small{display:block;font:500 11px var(--mono);opacity:.7;margin-top:4px}
.compose{display:grid;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px}
.compose textarea{min-height:90px;background:var(--paper)}
.fine{color:var(--slate);font-size:13px;margin:0}
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
.call .num{font:500 14px var(--mono);color:var(--slate)}
.call .sum{font-size:16.5px;margin:0}
.call .meta{display:grid;gap:2px;font-size:14.5px;color:var(--slate)}
.call .meta b{color:var(--ink);font-weight:600}
.chip.urgent{background:var(--sign);color:var(--on-sign)}
.chip.missed{background:var(--warn-soft);color:var(--warn)}
.chip.ok{background:var(--ok-soft);color:var(--ok)}
.call details{border-top:1px solid var(--line);padding-top:8px}
.call summary{cursor:pointer;font-weight:600;font-size:14.5px;color:var(--slate);min-height:32px;display:flex;align-items:center}
.said{display:grid;gap:6px;margin-top:8px}
.said p{margin:0;font-size:14.5px;padding:8px 11px;border-radius:12px;max-width:90%}
.said p.ai{background:var(--panel);justify-self:start}
.said p.caller{background:var(--ink);color:var(--paper);justify-self:end}
.said small{display:block;font:500 10.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin-bottom:2px}
.badge{position:absolute;top:2px;left:calc(50% + 6px);min-width:20px;height:20px;border-radius:99px;background:var(--sign);color:var(--on-sign);font:700 12px/20px var(--body);font-style:normal;padding:0 6px}
.toast{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translate(-50%,20px);opacity:0;pointer-events:none;background:var(--ink);color:var(--paper);padding:11px 18px;border-radius:12px;font-weight:600;font-size:15px;transition:.2s;z-index:9;max-width:calc(100% - 32px);text-align:center}
.toast.on{opacity:1;transform:translate(-50%,0)}
.scrim{position:fixed;inset:0;z-index:8;background:rgba(10,12,18,.55);display:flex;align-items:flex-end;justify-content:center}
.scrim[hidden]{display:none}
.sheet{width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--card);border-radius:22px 22px 0 0;padding:20px max(18px,env(safe-area-inset-right,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px));display:grid;gap:12px}
.sheet h2{margin:0;font-size:1.35rem}
.sheet label{display:grid;gap:6px;font-weight:600;font-size:14.5px}
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
.hero{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;background:var(--card);border:2px solid var(--sign);border-radius:20px;padding:16px;margin:0 0 18px;box-shadow:var(--glow)}
.hero.off{border-color:var(--line);box-shadow:none}
.sign{display:grid;justify-items:center;gap:3px;padding:9px 12px 7px;border:2.5px solid var(--sign);border-radius:12px;color:var(--sign);box-shadow:0 0 16px rgba(255,90,77,.45),inset 0 0 10px rgba(255,90,77,.2)}
.sign b{font:800 1.4rem/1 var(--display);letter-spacing:.14em;margin-right:-.14em;text-shadow:0 0 12px rgba(255,106,94,.9)}
.sign span{font:500 9.5px var(--mono);letter-spacing:.22em;margin-right:-.22em;white-space:nowrap}
.hero.off .sign{color:var(--slate);border-color:var(--line);box-shadow:none}.hero.off .sign b{text-shadow:none}
@keyframes aoOn{0%{opacity:.35}8%{opacity:1}14%{opacity:.2}30%{opacity:.95}38%{opacity:.3}52%,100%{opacity:1}}@keyframes aoBreath{0%,100%{box-shadow:0 0 14px rgba(255,90,77,.4),inset 0 0 9px rgba(255,90,77,.18)}50%{box-shadow:0 0 22px rgba(255,90,77,.55),inset 0 0 12px rgba(255,90,77,.26)}}@media (prefers-reduced-motion:no-preference){.hero:not(.off) .sign{animation:aoOn 1.1s linear 1,aoBreath 4.4s ease-in-out 1.4s infinite}}
.hero-t{display:grid;gap:4px;min-width:0}
.hero-t b{font:800 1.15rem/1.15 var(--display);font-stretch:92%}
.hero-t span{color:var(--slate);font-size:14px}
.hero-t .acts{margin-top:6px}
.btn.sm{min-height:38px;padding:6px 12px;font-size:14.5px}
.list{display:grid;gap:8px}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;text-align:left;width:100%;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;color:inherit;font:inherit}
.row>svg:first-child{width:24px;height:24px;color:var(--sign)}
.row b{display:block;font-size:16px}.row span{color:var(--slate);font-size:13.5px}
.row>svg:last-child{width:20px;height:20px;color:var(--slate)}
.empty.slim{padding:16px}
.card.glow{border:2px solid var(--sign);box-shadow:var(--glow)}
.sw{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sw b{display:block;font:800 1.1rem var(--display);font-stretch:92%}.sw span{color:var(--slate);font-size:14px}
.switch{width:58px;height:34px;border-radius:99px;border:0;background:var(--line);position:relative;flex:none;padding:0}
.switch i{position:absolute;top:3px;left:3px;width:28px;height:28px;border-radius:50%;background:var(--slate);transition:left .2s}
.switch[aria-checked=true]{background:var(--ok)}
.switch[aria-checked=true] i{left:27px;background:#fff}
.switch[disabled]{opacity:.45;cursor:default}
.form label{display:grid;gap:6px;font-weight:600;font-size:14.5px}
.form textarea{min-height:110px}
.sample{margin:0 0 12px;padding:9px 12px;border-radius:12px;border:1px dashed var(--line);background:var(--soft,transparent);font-size:13px;color:var(--slate)}.sample b{color:var(--ink)}.vers{margin-top:10px;display:grid;gap:10px}.ver{border:1px dashed var(--line);border-radius:12px;padding:10px}.ver .btn{margin-top:8px}
select{width:100%;border:1.5px solid var(--line);border-radius:12px;background:var(--paper);padding:12px;font-size:16px;color:var(--ink)}
.form details summary{cursor:pointer;font-weight:600;color:var(--slate);min-height:32px;display:flex;align-items:center}
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
(function(){
'use strict';
var S=null,TAB='home',EDIT={},VERS={},MONTH='',LOADING=false,DEFER=null,DIRTY=false;
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
function sheet(html){var s=$('#scrim');s.innerHTML='<div class="sheet" role="dialog" aria-modal="true">'+html+'</div>';s.hidden=false;}
function close(){var s=$('#scrim');s.hidden=true;s.innerHTML='';}

function load(quiet){
  if(LOADING)return;LOADING=true;
  var r=$('#refresh');r.classList.add('spin');
  api('state').then(function(res){
    LOADING=false;r.classList.remove('spin');$('#offline').hidden=true;
    if(!res.j.ok){if(res.status===404||res.status===429){$('#view').innerHTML='<div class="empty"><b>This link is not working</b><span>'+esc(res.j.error||'')+'</span></div>';}else if(!quiet)toast(res.j.error||'Could not load. Try again.');return;}
    S=res.j;if(S.client&&S.client.business)$('#biz').textContent=S.client.business;
    if(!MONTH&&S.months&&S.months.length)MONTH=S.months[0].month;
    render();
  }).catch(function(){LOADING=false;r.classList.remove('spin');$('#offline').hidden=false;if(!S)$('#view').innerHTML='<div class="empty"><b>No connection</b><span>Check your signal, then tap refresh.</span></div>';});
}

function hasMax(){return !!(S&&S.features&&(S.features.line||S.features.calls));}
var KEEP=['msg','lh','lo','lt','lw','lg'];
function render(){
  var hm=hasMax();if(S&&TAB==='max'&&!hm)TAB='home';
  var bs=document.querySelectorAll('.tab');for(var i=0;i<bs.length;i++){if(bs[i].dataset.tab===TAB)bs[i].setAttribute('aria-current','page');else bs[i].removeAttribute('aria-current');}
  var n=S&&S.items?S.items.length:0,bd=$('#badge');bd.hidden=!n;bd.textContent=n>99?'99+':n;
  var ct=document.querySelector('.tab[data-tab="max"]');ct.hidden=!hm;document.querySelector('.tabs').classList.toggle('five',hm);
  if(S&&S.line){var lb=ct.querySelector('span');if(lb)lb.textContent=S.line.name;}
  var nc=hm&&S?(S.calls||[]).filter(function(c){return c.status!=='handled';}).length:0,cb=$('#cbadge');cb.hidden=!nc;cb.textContent=nc>99?'99+':nc;
  if(!S)return;
  var v={home:vHome,approve:vApprove,reviews:vReviews,max:vMax,ask:vAsk}[TAB]||vHome;
  // what they were typing survives a refresh
  var keep={},act=document.activeElement;KEEP.forEach(function(k){var el=document.getElementById(k);if(el)keep[k]={v:el.value,f:act===el};});
  $('#view').innerHTML=sampleBar()+v();
  KEEP.forEach(function(k){var el=document.getElementById(k);if(!el||!keep[k])return;if(k==='msg'||DIRTY)el.value=keep[k].v;if(keep[k].f)el.focus({preventScroll:true});});
  if(TAB==='ask'){var th=$('.thread');if(th&&th.lastElementChild)th.lastElementChild.scrollIntoView({block:'nearest'});}
}

/* ---------- Home ---------- */
function greet(){var h=new Date().getHours();return h<12?'Good morning':(h<17?'Good afternoon':'Good evening');}
function row(go,icon,title,sub){return '<button class="row" type="button" data-go="'+go+'">'+icon+'<div><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div>'+ICON.chev+'</button>';}
function qt(a,icon,title,sub){return '<button class="qt" type="button" data-a="'+a+'">'+icon+'<b>'+esc(title)+'</b><span>'+esc(sub)+'</span></button>';}
function sampleBar(){if(!S||!S.sample)return '';return '<div class="sample" role="note"><b>Sample data.</b> Everything on this screen is made up so you can see the app working. Names and numbers are fictional'+(TAB==='home'&&S.sampleWeekly?'<br>Sample weekly note: '+esc(S.sampleWeekly):'')+'.</div>';}
function vHome(){
  var f=S.features||{},first=S.client.first||'';
  var items=(S.items||[]).length,calls=(S.calls||[]).filter(function(c){return c.status!=='handled';}).length;
  var due=(S.followups||[]).filter(isDue).length;
  var h='<h1>'+esc(greet())+(first?', '+esc(first):'')+'</h1><p class="lede">Here\\u2019s '+esc(S.client.business||'your business')+' today.</p>'+install()+bizTop()+heroCard();
  var att=[];
  if(items)att.push(row('approve',ICON.check,items+(items===1?' thing':' things')+' to approve','Review replies and posts waiting for your OK'));
  if(calls)att.push(row('max',ICON.phone,calls+(calls===1?' new call':' new calls'),'Who called and what they need'));
  if(due)att.push(row('fu',ICON.cal,due+(due===1?' follow-up':' follow-ups')+' due','Tap to text them'));
  h+=att.length?'<h2>Needs you</h2><div class="list">'+att.join('')+'</div>':'<div class="empty slim">'+ICON.check+'<b>Nothing needs you right now</b><span>We\\u2019ll buzz your phone when something does.</span></div>';
  h+='<h2>Quick</h2><div class="quick">'+(f.jobs?qt('job',ICON.job,'Finished a job','They get one review request'):'')+(f.photos?qt('photo',ICON.cam,'Photo for a post','We write it, you approve it'):'')+
    (f.followups?qt('fu-add',ICON.cal,'Add a follow-up','Quote, invoice or appointment'):'')+qt('closed',ICON.clock,'Closed today','We update Google for you')+qt('hours',ICON.cal,'Holiday or new hours','Tell us the days and times')+'</div>';
  h+=monthBlock()+(S.features&&S.features.competitors?rivalCard():'')+(isTech()?'':invBlock())+pastBlock()+bizBlocks()+fuBlock()+linkBlock()+metaBlock();
  h+=cbCard();
  h+=lostCard();
  h+=guardCard();
  h+=referCard();
  return h;
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
  return h+'<div class="acts"><button class="btn line" type="button" data-a="refer">Share your link</button></div><p class="fine">Send us six businesses, we work for free half the year. Never for customers or reviews. <a href="/terms#referral-credit" target="_blank" rel="noopener">The rules</a></p></div>';
}
function guardCard(){
  var g=S.complianceGuard;if(!g)return '';
  var li=function(a){return a.map(function(x){return '<li>'+esc(x)+'</li>';}).join('');};
  return '<div class="gcard"><div class="gh">'+ICON.shield+'<div><b>Compliance Guard is on</b><span>Every reply and post is checked before it reaches you, and nothing goes out until you approve it.</span></div></div>'+
    '<details><summary>What it checks</summary><ul>'+li(g.base)+(g.strict&&g.strict.length?li(g.strict):'')+'</ul>'+(g.regulated?'<p class="fine">Extra rules apply because you work in a regulated field.</p>':'')+'<p class="fine">'+esc(g.note||'')+'</p></details></div>';
}
function offText(L){return L.transferTo?'calls ring through to '+L.transferText:'callers hear a short message';}
function heroCard(){
  var L=S.line,f=S.features||{};
  if(L){
    var on=L.onAir;
    return '<div class="hero'+(on?'':' off')+'"><div class="sign"><b>'+(on?'OPEN':'OFF')+'</b><span>'+(on?'24 HOURS':'LINE OFF')+'</span></div><div class="hero-t"><b>'+esc(L.name)+(on?' is answering':(L.paused?' is paused':' is off'))+'</b><span>'+esc(L.numberText)+(on?' \\u00b7 day and night':' \\u00b7 '+esc(offText(L)))+'</span><div class="acts">'+
      (on?'<a class="btn line sm" href="tel:'+esc(L.number)+'">Call '+esc(L.name)+'</a>':(L.paused?'<button class="btn line sm" type="button" data-tab="ask">Ask us</button>':'<button class="btn red sm" type="button" data-a="line-on">Turn on</button>'))+'<button class="btn ghost sm" type="button" data-tab="max">Settings</button></div></div></div>';
  }
  return '<div class="hero"><div class="sign"><b>OPEN</b><span>24 HOURS</span></div><div class="hero-t"><b>Always Open is on it</b><span>Reviews answered and your Google page kept current, day and night.'+(f.calls||S.client.regulated?'':' Max, your phone assistant, comes with your plan.')+'</span>'+
    (f.calls||S.client.regulated?'':'<div class="acts"><button class="btn ghost sm" type="button" data-a="ask-max">Set up Max for your calls</button></div>')+'</div></div>';
}
function monthBlock(){
  var ms=S.months||[];
  if(!ms.length)return '<h2>Your month</h2><div class="empty slim"><b>Your first month is on its way</b><span>Your numbers show up here in the first days of next month.</span></div>';
  var m=ms.filter(function(x){return x.month===MONTH;})[0]||ms[0];
  var h='<h2>Your month</h2>';
  if(S.checkins&&S.checkins.line)h+='<p class="note" style="margin:-4px 2px 10px">'+esc(S.checkins.line)+'</p>';
  if(ms.length>1)h+='<div class="months" role="group" aria-label="Month">'+ms.map(function(x){return '<button type="button" class="mchip" data-a="m" data-m="'+esc(x.month)+'" aria-pressed="'+(x.month===m.month)+'">'+esc(x.label)+'</button>';}).join('')+'</div>';
  else h+='<p class="note" style="margin:-4px 2px 10px">'+esc(m.label)+'</p>';
  var st=m.stats||{},pv=m.prev||null,pl=pv&&pv.label?pv.label.split(' ')[0]:'last month';
  h+='<div class="tiles">'+TILES.map(function(t){var v=st[t[0]],p=pv?pv[t[0]]:null,d='';
    if(v!=null&&v!==''&&p!=null&&p!==''&&!isNaN(+v)&&!isNaN(+p)){var df=+v-(+p);if(t[0]==='rating')df=Math.round(df*10)/10;d=df>0?'<em class="up">\\u25b2 '+(t[0]==='rating'?df.toFixed(1):df)+' from '+esc(pl)+'</em>':(df<0?'<em class="down">\\u25bc '+(t[0]==='rating'?Math.abs(df).toFixed(1):Math.abs(df))+' from '+esc(pl)+'</em>':'<em class="down">Same as '+esc(pl)+'</em>');}
    return '<div class="tile"><b>'+fmt(t[0],v)+'</b><span>'+t[1]+'</span>'+d+'</div>';}).join('')+'</div>';
  if(m.note)h+='<p class="note">'+esc(m.note)+'</p>';
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
  sheet('<h2>Add a follow-up</h2><label>What is it?<select id="fk"><option value="quote">Quote</option><option value="invoice">Invoice</option><option value="appointment">Appointment</option></select></label><label>Customer\\u2019s name<input type="text" id="fn" maxlength="60" autocomplete="off"></label><label>Their cell (optional)<input type="tel" id="fp" maxlength="20" inputmode="tel" autocomplete="off" placeholder="478 555 0142"></label><label>Amount (optional)<input type="text" id="fa" maxlength="20" placeholder="$1,250"></label><label>Follow up on<input type="date" id="fd" value="'+localDay(3)+'"></label><label>Note (optional)<input type="text" id="fo" maxlength="200"></label><p class="fine">On that day we remind you and write the text. You send it from your phone.</p><div class="acts"><button class="btn ok" type="button" id="go">Add</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  setTimeout(function(){var i=$('#fn');if(i)i.focus();},60);
  $('#go').onclick=function(){
    var b=this,body={kind:$('#fk').value,name:$('#fn').value,phone:$('#fp').value,amount:$('#fa').value,due:$('#fd').value,note:$('#fo').value};
    if(!body.name.trim()){toast('Add the customer\\u2019s name.');return;}
    needName(function(by){body.by=by;b.disabled=true;post('followup',body).then(function(res){b.disabled=false;if(res.j.ok){close();S.followups=[res.j.followup].concat(S.followups||[]);toast('Added. We\\u2019ll remind you on the day.');render();}else toast(res.j.error||'Could not add. Try again.');}).catch(function(){b.disabled=false;toast('No connection. Try again.');});});
  };
}
function money(n){return '$'+(+n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function invBlock(){
  var inv=S.invoices||[],open=inv.filter(function(x){return x.status==='open';});
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
    '<div class="ch">'+st+(r.status==='pending'?'<button class="btn line sm" type="button" data-tab="approve">Review it</button>':'')+'</div></article>';
}
function vReviews(){
  var f=S.features||{},rv=S.reviews||[];
  var rated=(S.months||[]).filter(function(m){return m.stats&&m.stats.rating!=null&&m.stats.rating!==''&&!isNaN(+m.stats.rating);}).slice().reverse();
  var h='<h1>Reviews</h1><p class="lede">What customers say about '+esc(S.client.business||'you')+' on Google, and what we said back.</p>';
  if(rated.length){var last=rated[rated.length-1],r=+last.stats.rating,cnt=last.stats.count;
    h+='<div class="card score glow"><div class="big"><b>'+r.toFixed(1)+'</b><span class="stars" aria-label="'+r.toFixed(1)+' stars">'+stars(r)+'</span><span class="who">'+(cnt!=null&&cnt!==''&&!isNaN(+cnt)?esc((+cnt).toLocaleString('en-US'))+' reviews on Google':'Your Google rating')+'</span></div>'+chart(rated)+'</div>';}
  else h+='<div class="card score"><div class="big"><b>\\u2014</b><span class="who">Your star rating, and how it moves month to month, shows here once your Google profile is connected.</span></div></div>';
  h+='<h2>Latest reviews</h2>'+(rv.length?rv.map(revCard).join(''):'<div class="empty slim"><b>No reviews yet</b><span>New Google reviews land here with our reply, and every reply waits for your OK.</span></div>');
  if(f.qr&&S.client.qr)h+='<div class="feature"><h3>Your review QR code</h3><p>Show it at the counter or on a job. Ask every customer, not just the happy ones.</p><div class="acts"><button class="btn line" type="button" data-a="qr">Show the code</button></div></div>';
  h+=rivalCard();
  var rs=(S.months||[]).filter(function(m){return m.record;});
  h+='<h2>Monthly records</h2><p class="note" style="margin:-4px 2px 10px">Every public review, reply and post for a month, with who approved it. Open one and tap Save as PDF to keep it.</p>';
  h+=rs.length?'<div class="recs">'+rs.map(function(m){return '<a class="rec" href="'+esc(BASE+'/record/'+m.month)+'"><div><b>'+esc(m.label)+'</b><span>Record of public communications</span></div>'+ICON.chev+'</a>';}).join('')+'</div>':'<div class="empty slim"><b>No records yet</b><span>Your first record is made in the first days of next month.</span></div>';
  return h;
}

/* ---------- Max (the phone line) ---------- */
function sel(a,b){return a===b?' selected':'';}
function vMax(){
  var L=S.line,f=S.features||{};
  var h='<h1>'+esc(L?L.name:'Calls')+'</h1>';
  if(L){
    h+='<p class="lede">Your phone line answers '+esc(L.numberText)+'. Changes here apply to the next call.</p>';
    h+='<div class="card'+(L.onAir?' glow':'')+'"><div class="sw"><div><b>'+esc(L.name)+(L.onAir?' is answering':' is off')+'</b><span>'+(L.onAir?'Every call, day and night.':(L.transferTo?'Calls ring through to '+esc(L.transferText)+'.':'Callers hear a short message to call back later.'))+'</span></div>'+
      '<button class="switch" type="button" role="switch" aria-checked="'+(L.onAir?'true':'false')+'" data-a="line-toggle" aria-label="'+esc(L.name)+' on or off"'+(L.paused?' disabled':'')+'><i></i></button></div>'+(L.paused?'<p class="fine">Paused on our side. Message us in Ask us to turn it back on.</p>':'')+
      '<div class="acts"><a class="btn line" href="tel:'+esc(L.number)+'">'+ICON.phone.replace('<svg','<svg width="20" height="20"')+'Call '+esc(L.name)+' to try it</a></div></div>';
    h+='<h2>What '+esc(L.name)+' knows</h2><div class="card form">'+
      '<label>Your hours<input type="text" id="lh" maxlength="300" value="'+esc(L.hours)+'" placeholder="For example: Mon to Fri 8 to 5, Sat 9 to 1"></label>'+
      '<label>What should '+esc(L.name)+' tell callers?<textarea id="lo" maxlength="800" placeholder="Specials, how you book, areas you serve, anything to steer clear of.">'+esc(L.owner)+'</textarea></label>'+
      '<label>Urgent calls go to<input type="tel" id="lt" maxlength="20" inputmode="tel" value="'+esc(L.transferText)+'" placeholder="Your cell, or leave blank"></label>'+
      '<label>Put callers through to that number<select id="lw"><option value="never"'+sel(L.transferWhen,'never')+'>Never, just take a message</option><option value="urgent"'+sel(L.transferWhen,'urgent')+'>Only if it\\u2019s urgent</option><option value="asked"'+sel(L.transferWhen,'asked')+'>When they ask, or it\\u2019s urgent</option></select></label>'+
      '<details><summary>Greeting</summary><label style="margin-top:8px">What '+esc(L.name)+' says first<textarea id="lg" maxlength="320" placeholder="'+esc(L.defaultGreeting)+'">'+esc(L.greeting)+'</textarea></label><p class="fine">We always add that callers are talking to an automated assistant and that the call may be recorded. Leave it empty for the standard one.</p></details>'+
      '<div class="acts"><button class="btn red" type="button" data-a="line-save">Save</button></div></div>';
    if(S.calendar&&!S.client.regulated)h+='<h2>Booking</h2><div class="card"><div class="sw"><div><b>Google Calendar '+(S.calendar.connected?'connected':'not connected')+'</b><span>'+(S.calendar.connected?esc(L.name)+' offers open times on weekdays 9 to 5 and books them for callers.':'Connect it and '+esc(L.name)+' can book callers into open times.')+'</span></div></div><div class="acts">'+(S.calendar.connected?'<button class="btn ghost sm" type="button" data-a="gcal-off">Disconnect</button>':'<a class="btn red sm" href="/google/connect?code='+encodeURIComponent(BASE.split('/').pop())+'">Connect Google Calendar</a>')+'</div></div>';
  } else h+='<p class="lede">Calls your phone line answered.</p>';
  if(!S.client.regulated)h+=f.textback?'<div class="feature"><h3>Missed-call text-back</h3><p>When someone hangs up before anyone can help, we text them back so the job doesn\\u2019t go to someone else.</p><p class="fine"><span class="chip">Waiting on carrier approval</span> Texting turns on once carriers approve your number, usually about two weeks.</p></div>':
    '<div class="feature locked"><h3>Missed-call text-back</h3><p>When someone hangs up before anyone can help, we text them back so the job doesn\\u2019t go to someone else. Comes with Pro.</p><div class="acts"><button class="btn line" type="button" data-a="ask-pro">Ask about Pro</button></div></div>';
  if(f.calls)h+='<h2>Calls</h2>'+callsList();
  return h;
}
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
  return '<article class="card" id="c-'+esc(it.id)+'">'+head+ctx+body+cg+'<div class="hits" hidden></div><div class="acts">'+acts+'</div></article>';
}
function vApprove(){
  var items=S.items||[],done=S.done||[];
  var h='<h1>To approve</h1><p class="lede">Replies to your reviews and posts for your Google page. Nothing goes out until you approve it.</p>'+install();
  h+=items.length?items.map(card).join(''):'<div class="empty">'+ICON.check+'<b>You\\u2019re all caught up</b><span>New review replies and posts land here for your OK.</span></div>';
  if(done.length)h+='<h2>Recently handled</h2><div class="done">'+done.slice(0,12).map(function(d){var st=d.status==='approved'?'Approved':(d.status==='skipped'?'Skipped':'Handled by Always Open');return '<div><i class="'+(d.status==='approved'?'':'skip')+'"></i><p>'+esc(d.text||d.title)+'</p><span>'+st+(d.by&&d.status!=='closed'?' by '+esc(d.by):'')+(d.at?' \\u00b7 '+esc(when(d.at)):'')+'</span></div>';}).join('')+'</div>';
  h+='<p class="note">'+(name()?'You\\u2019re approving as '+esc(name())+'. <a href="#" data-a="rename" style="color:inherit">Change</a>':'')+'</p>';
  return h;
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
  var said=c.transcript&&c.transcript.length?'<details><summary>What was said</summary><div class="said">'+c.transcript.map(function(x){return '<p class="'+(x.w==='caller'?'caller':'ai')+'"><small>'+(x.w==='caller'?'Caller':esc(S.line?S.line.name:'Phone line'))+'</small>'+esc(x.t)+'</p>';}).join('')+'</div></details>':'';
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
  var url=S.client.refLink,text='I use Always Open for our reviews and Google profile. They\\u2019ll do a free audit of your business too (I get a free month if you sign up and stay):';
  if(navigator.share){navigator.share({title:'Always Open',text:text,url:url}).catch(function(){});return;}
  var t=text+' '+url;
  try{navigator.clipboard.writeText(t).then(function(){toast('Link copied. Paste it in a text.');},function(){toast(url);});}catch(e){toast(url);}
}

/* ---------- Ask us ---------- */
function vAsk(){
  var f=S.features||{},reg=S.client.regulated;
  var h='<h1>Ask us</h1><p class="lede">Goes straight to the Always Open team. Hours, changes, questions, anything.</p>';
  var ms=S.messages||[];
  h+=ms.length?'<div class="thread">'+ms.map(function(m){return '<div class="msg '+m.dir+'">'+esc(m.text)+'<small>'+(m.dir==='out'?'Always Open':esc(m.by||'You'))+' \\u00b7 '+esc(when(m.at))+'</small></div>';}).join('')+'</div>':'<p class="note" style="margin:14px 2px">Questions, changes, anything. We answer here.</p>';
  h+='<div class="compose"><label class="lbl" for="msg" style="margin:0">Message</label><textarea id="msg" maxlength="1000" placeholder="Type your message"></textarea>'+(reg?'<p class="fine">Please don\\u2019t include client names, policy or account numbers, or claim details.</p>':'')+'<div class="acts"><button class="btn red" type="button" data-a="send">Send</button></div></div>';
  return h;
}
function send(kind,text,after){
  needName(function(by){
    post('message',{kind:kind,text:text,by:by}).then(function(res){
      if(res.j.ok){S.messages=(S.messages||[]).concat([{id:res.j.id,at:res.j.at,by:by,text:res.j.text||text,dir:'in'}]);if(after)after();toast('Sent to the Always Open team.');render();}
      else toast(res.j.error||'Could not send. Try again.');
    }).catch(function(){toast('No connection. Try again.');});
  });
}
function today(){return new Date().toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});}
function closedSheet(){
  sheet('<h2>Closed today?</h2><p class="fine">We\\u2019ll mark '+esc(S.client.business)+' closed for '+esc(today())+' on Google.</p><label>Reason, if you want customers to know (optional)<input type="text" id="why" maxlength="120" placeholder="For example: weather, family emergency"></label><div class="acts"><button class="btn red" type="button" id="go">Send</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
  $('#go').onclick=function(){var w=$('#why').value.trim();send('hours','Closed today ('+today()+')'+(w?'. Reason: '+w:'')+'.',close);};
}
function hoursSheet(){
  sheet('<h2>Holiday or new hours</h2><label>Which days?<input type="text" id="hd" maxlength="120" placeholder="For example: Nov 27 and 28, or every Saturday"></label><label>What hours?<input type="text" id="hh" maxlength="160" placeholder="For example: closed, or 9 to 1"></label><div class="acts"><button class="btn red" type="button" id="go">Send</button><button class="btn ghost" type="button" data-close="1">Cancel</button></div>');
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
  var t=e.target.closest('[data-tab],[data-a],[data-close],[data-go]');if(!t)return;
  if(t.dataset.go){var g=t.dataset.go;if(g==='fu'){TAB='home';render();var el=document.getElementById('fu');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}else{TAB=g;try{history.replaceState(null,'','#'+TAB);}catch(x){}render();window.scrollTo(0,0);}return;}
  if(t.dataset.close){close();return;}
  if(t.dataset.tab){TAB=t.dataset.tab;try{history.replaceState(null,'','#'+TAB);}catch(x){}render();window.scrollTo(0,0);return;}
  var a=t.dataset.a,id=t.dataset.id;
  if(a==='approve')decide(id,'approve','');
  else if(a==='edit'){var it=(S.items||[]).filter(function(x){return x.id===id;})[0];if(it){EDIT[id]=it.text;render();var ta=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}}}
  else if(a==='cancel'){delete EDIT[id];render();}
  else if(a==='versions'){VERS[id]='loading';render();post('versions',{id:id}).then(function(res){if(res.j.ok){VERS[id]=res.j.versions;}else{delete VERS[id];toast(res.j.error||'Not available right now.');}render();}).catch(function(){delete VERS[id];render();toast('No connection. Try again.');});}
  else if(a==='usever'){var vv=(VERS[id]||[])[+t.dataset.i];if(vv){EDIT[id]=vv.text;delete VERS[id];render();var ta2=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');if(ta2)ta2.focus();}}
  else if(a==='save'){var tx=document.querySelector('[data-ed="'+CSS.escape(id)+'"]');var v=tx?tx.value.trim():'';if(!v){toast('The text is empty.');return;}EDIT[id]=v;decide(id,'approve',v);}
  else if(a==='skip'){if(t.classList.contains('sure'))decide(id,'skip','');else{t.classList.add('sure');t.textContent='Tap again to skip';setTimeout(function(){if(t.isConnected){t.classList.remove('sure');t.textContent='Skip';}},4000);}}
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
  else if(a==='gcal-off'){fetch('/google/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:BASE.split('/').pop()})}).then(function(){S.calendar={connected:false};render();toast('Calendar disconnected.');});}
  else if(a==='line-save')lineSave({hours:$('#lh').value,owner:$('#lo').value,transferTo:$('#lt').value,transferWhen:$('#lw').value,greeting:$('#lg').value});
  else if(a==='ask-pro')askAbout('Pro','I\u2019d like to hear about the Pro plan: follow-ups and missed-call text-back.');
  else if(a==='ask-growth')askAbout('Growth','I\u2019d like to hear about the Growth plan and competitor watch.');
  else if(a==='ask-max')askAbout('Max','Please set up Max, my phone assistant, on my account. He comes with my plan.');
  else if(a==='call-done')markCall(id,'handled');
  else if(a==='call-reopen')markCall(id,'reopen');
  else if(a&&a.indexOf('rv-')===0)rvAct(a,id,t);
  else if(a&&a.indexOf('bz-')===0)bizAct(a,id,t);
  else if(a&&a.indexOf('pc-')===0)pastAct(a,id,t);
});
document.addEventListener('input',function(e){var t=e.target;if(t&&t.dataset&&t.dataset.ed)EDIT[t.dataset.ed]=t.value;if(t&&/^(lh|lo|lt|lw|lg)$/.test(t.id))DIRTY=true;});
document.addEventListener('change',function(e){var t=e.target;if(t&&t.id==='lw')DIRTY=true;});
$('#scrim').addEventListener('click',function(e){if(e.target.id==='scrim')close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!$('#scrim').hidden)close();});
$('#refresh').addEventListener('click',function(){load();});
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();DEFER=e;if(S)render();});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')load(true);});
setInterval(function(){if(document.visibilityState==='visible'&&$('#scrim').hidden&&!Object.keys(EDIT).length&&!DIRTY)load(true);},60000);
var OLD={month:'home',record:'reviews',calls:'max'},TABS=['home','approve','reviews','max','ask'];
function fromHash(){var h=(location.hash||'').slice(1);if(OLD[h])h=OLD[h];return TABS.indexOf(h)>-1?h:'';}
window.addEventListener('hashchange',function(){var h=fromHash();if(h&&h!==TAB){TAB=h;render();window.scrollTo(0,0);}});
TAB=fromHash()||TAB;
render();load();
})();
`;
