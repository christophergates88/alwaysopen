// Max's clock: the month as one 24-hour dial, lit like the OPEN sign.
// Every call Max answered, every check-in call he made, every reply, post and text that went out, sits on the dial at the
// minute it happened in the business's own time. The hours nobody is at the desk are the shaded arc (6 PM to 8 AM; the
// weekend is said in words). Teal ticks he handled on his own; red ticks he brought to the owner. In the middle, the two
// numbers an employee's month comes down to: how long he was on the clock (all of it) and how much of the owner's time
// came back. Under the dial, the one call of the month that shows why he is there.
// Pure: clockModel() and clockSVG() take rows and return a model or markup; clockFor() reads the tables for one business.
import { local } from './callbacks.js';
import { isAfterHours } from './answerrate.js';

export const HOURS_OPEN = 8, HOURS_CLOSE = 18;   // the desk's day, same rule as the public answer rate (answerrate.js)
// Minutes of the owner's time each thing would have taken, beyond the minutes Max actually spent on the phone. Shown with
// the number, never hidden: "How this is figured". Deliberately low.
export const MINUTES = { call: 2, checkin: 8, followup: 5, reply: 4, post: 6, textback: 2 };
export const KIND_LABEL = { call: 'call answered', checkin: 'check-in call', followup: 'follow-up sent', reply: 'review answered', post: 'post made', textback: 'missed-call text' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
export function hoursText(min, long) {
  min = Math.max(0, Math.round(+min || 0));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' min';
  if (long) return h + (h === 1 ? ' hour' : ' hours') + (m ? ' ' + m + ' min' : '');
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}
export function sayMinute(m) {
  const hh = Math.floor(m / 60) % 24, mm = m % 60, h12 = ((hh + 11) % 12) + 1;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
}
const DAY_SHORT = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

// ev: [{ at (ms or ISO), kind, seconds, toYou, booked, lead, reason }], o: { tz, start, end (ms), now (ms), name, joined (ms) }.
export function clockModel(ev, o) {
  o = o || {};
  const tz = o.tz || 'America/New_York', now = o.now || Date.now();
  const end = Math.min(o.end || now, now), start = o.start || end - 30 * 864e5;
  const ticks = [];
  let alone = 0, toYou = 0, after = 0, callSec = 0, backMin = 0;
  const byKind = {};
  for (const e of ev || []) {
    const at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
    if (!isFinite(at)) continue;
    const l = local(tz, at), m = l.hour * 60 + l.minute, kind = MINUTES[e.kind] != null ? e.kind : 'call';
    const you = !!e.toYou, night = isAfterHours(l);
    byKind[kind] = (byKind[kind] || 0) + 1;
    if (kind === 'call') { if (you) toYou++; else alone++; if (night) after++; callSec += Math.max(0, +e.seconds || 0); }
    backMin += MINUTES[kind] + (kind === 'call' ? Math.max(0, +e.seconds || 0) / 60 : 0);
    ticks.push({ m, kind, you, night, day: l.day, wd: l.wd, at, booked: !!e.booked, lead: !!e.lead, reason: clean(e.reason) });
  }
  ticks.sort((a, b) => a.at - b.at);
  const calls = byKind.call || 0;
  const onMin = Math.max(0, Math.round((end - start) / 60000));
  // The one call: after hours first, then booked, then a lead, then brought to the owner, then the latest.
  const score = t => (t.night ? 8 : 0) + (t.booked ? 4 : 0) + (t.lead ? 2 : 0) + (t.you ? 1 : 0);
  const one = ticks.filter(t => t.kind === 'call' && (t.night || t.booked || t.lead || t.you)).sort((a, b) => score(b) - score(a) || b.at - a.at)[0] || null;
  const nowL = local(tz, now);
  // a call in progress right now (its minute on the dial), and what the month's after-hours calls were worth (money.js)
  let live = null;
  if (o.live != null) { const la = typeof o.live === 'number' ? o.live : Date.parse(o.live); if (isFinite(la)) { const ll = local(tz, la); live = ll.hour * 60 + ll.minute; } }
  return {
    tz, start, end, mtd: !!o.mtd, name: o.name || 'Max', worth: Math.round(+o.worth || 0), live,
    ticks, n: ticks.length, calls, alone, toYou, after, callSec: Math.round(callSec), byKind,
    onMin, backMin: Math.round(backMin),
    one: one ? { m: one.m, time: sayMinute(one.m), day: DAY_SHORT[one.wd] || one.wd, date: one.day, night: one.night, booked: one.booked, lead: one.lead, you: one.you, reason: one.reason,
      text: oneText(one, o.name || 'Max') } : null,
    nowMin: nowL.hour * 60 + nowL.minute, nowDay: nowL.day
  };
}
function clean(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.charAt(0).toLowerCase() + s.slice(1);
  return s.length > 64 ? s.slice(0, 61).replace(/\s+\S*$/, '') + '…' : s.replace(/[.。]+$/, '');
}
function oneText(t, name) {
  const day = DAY_SHORT[t.wd] || t.wd, hh = Math.floor(t.m / 60);
  const when = sayMinute(t.m) + ', ' + (hh < 6 ? 'early ' + day : hh >= 18 ? day + ' evening' : day);
  const what = t.reason ? ': ' + t.reason : '';
  const then = t.you ? name + ' had you on the line within a minute.' : t.booked ? name + ' booked it on the spot.' : t.lead ? name + ' took the details; you had them by morning.' : name + ' answered.';
  return when + what + '. ' + then;
}
// Plain lines for texts, cards and the timecard.
export function clockLines(m) {
  const out = [];
  out.push('On the clock: ' + hoursText(m.onMin, true) + ', all of it.');
  if (m.calls) out.push(pl(m.calls, 'call', 'calls') + ': ' + m.alone + ' handled alone' + (m.toYou ? ', ' + m.toYou + ' brought to you' : '') + '.');
  if (m.worth) out.push('Caught after hours: about $' + m.worth.toLocaleString('en-US') + '.');
  if (m.backMin) out.push('Back to you: ' + hoursText(m.backMin) + '.');
  return out;
}
const KIND_MANY = { checkin: 'check-in calls', followup: 'follow-ups sent', reply: 'reviews answered', post: 'posts made', textback: 'missed-call texts' };
export function backExplained(m) {
  const parts = [];
  if (m.calls) parts.push(pl(m.calls, 'call', 'calls') + ' (' + hoursText(Math.round(m.callSec / 60)) + ' on the phone, plus ' + MINUTES.call + ' minutes each to write up)');
  for (const k of ['checkin', 'followup', 'reply', 'post', 'textback']) if (m.byKind[k]) parts.push(pl(m.byKind[k], KIND_LABEL[k], KIND_MANY[k]) + ' at ' + MINUTES[k] + ' minutes each');
  return parts.length ? 'Time you did not have to spend: ' + parts.join('; ') + '. Minutes are on the low side on purpose.' : 'Nothing yet this month.';
}

// The dial. opt: { id (prefix for ids), size, live (draw the hand at nowMin), plain (no glow filters), hours {open, close} }.
export function clockSVG(m, opt) {
  opt = opt || {};
  const id = String(opt.id || 'clk').replace(/[^a-z0-9_-]/gi, ''), S = 320, C = 160, R = 126;
  const open = (opt.hours && opt.hours.open) || HOURS_OPEN, close = (opt.hours && opt.hours.close) || HOURS_CLOSE;
  const ang = min => (min / 1440) * Math.PI * 2 - Math.PI / 2;   // midnight at the top, clockwise
  const pt = (min, r) => [C + Math.cos(ang(min)) * r, C + Math.sin(ang(min)) * r];
  const f = n => n.toFixed(1);
  // the closed arc: close -> midnight -> open
  const a0 = close * 60, a1 = open * 60 + 1440;
  const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1 % 1440, R);
  const sweep = a1 - a0, large = sweep > 720 ? 1 : 0;
  const closed = '<path class="clk-night" d="M' + f(x0) + ' ' + f(y0) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + f(x1) + ' ' + f(y1) + '" fill="none" stroke-width="18" stroke-linecap="butt"/>';
  let marks = '';
  for (let h = 0; h < 24; h++) { const [ax, ay] = pt(h * 60, R - 13), [bx, by] = pt(h * 60, R - (h % 6 ? 9 : 4)); marks += '<line class="clk-mark' + (h % 6 ? '' : ' big') + '" x1="' + f(ax) + '" y1="' + f(ay) + '" x2="' + f(bx) + '" y2="' + f(by) + '"/>'; }
  const lab = (min, t, dx, dy) => { const [x, y] = pt(min, R + 22); return '<text class="clk-lab" x="' + f(x + (dx || 0)) + '" y="' + f(y + (dy || 0)) + '" text-anchor="middle">' + t + '</text>'; };
  const labels = lab(0, '12 AM', 0, 4) + lab(360, '6 AM', 8, 4) + lab(720, '12 PM', 0, 6) + lab(1080, '6 PM', -8, 4);
  let ticks = '';
  for (const t of m.ticks) {
    const call = t.kind === 'call';
    const [ax, ay] = pt(t.m, call ? R - 1 : R - 20), [bx, by] = pt(t.m, call ? R + 9 : R - 14);
    ticks += '<line class="clk-tick' + (t.you ? ' you' : '') + (call ? ' call' : ' work') + (t.night ? ' night' : '') + '" data-m="' + t.m + '" x1="' + f(ax) + '" y1="' + f(ay) + '" x2="' + f(bx) + '" y2="' + f(by) + '"><title>' + esc(sayMinute(t.m) + ' · ' + (KIND_LABEL[t.kind] || t.kind) + (t.you ? ', brought to you' : '')) + '</title></line>';
  }
  let one = '';
  if (m.one) { const [ox, oy] = pt(m.one.m, R + 4); one = '<circle class="clk-one" cx="' + f(ox) + '" cy="' + f(oy) + '" r="6"/>'; }
  // a call in progress: a red tick that pulses at its minute, and the hand parked on it
  let liveMark = '';
  if (m.live != null) { const [lx, ly] = pt(m.live, R - 2), [kx, ky] = pt(m.live, R + 12); liveMark = '<line class="clk-live" x1="' + f(lx) + '" y1="' + f(ly) + '" x2="' + f(kx) + '" y2="' + f(ky) + '"/><circle class="clk-live-dot" cx="' + f(kx) + '" cy="' + f(ky) + '" r="5"/>'; }
  let hand = '';
  const handMin = m.live != null ? m.live : m.nowMin;
  if (opt.live !== false) { const [hx, hy] = pt(handMin, R - 28), [sx, sy] = pt(handMin, 72); hand = '<g class="clk-hand" id="' + id + '-hand" data-at="' + handMin + '"' + (m.live != null ? '' : ' data-min="' + m.nowMin + '"') + '><line x1="' + f(sx) + '" y1="' + f(sy) + '" x2="' + f(hx) + '" y2="' + f(hy) + '"/><circle cx="' + f(hx) + '" cy="' + f(hy) + '" r="3"/></g>'; }
  // the middle: what the after-hours calls were worth when the owner's numbers are set; otherwise the time that came back
  const big = m.worth ? '$' + m.worth.toLocaleString('en-US') : m.backMin ? hoursText(m.backMin) : (m.calls ? pl(m.calls, 'call', 'calls') : 'On duty');
  const sub = m.worth ? 'caught while you were closed' : m.backMin ? 'back to you' : (m.calls ? 'answered' : 'nothing yet');
  const line2 = m.live != null ? 'On a call now · ' + sayMinute(m.live) : (m.worth && m.backMin ? hoursText(m.backMin) + ' back to you · ' : '') + hoursText(m.onMin, true) + ' on the clock' + (m.calls && !(m.worth && m.backMin) ? ' · ' + pl(m.calls, 'call', 'calls') : '');
  const center = '<text class="clk-big' + (m.worth ? ' money' : '') + '"' + (m.worth ? ' data-worth="' + m.worth + '"' : '') + ' x="' + C + '" y="' + (C - 2) + '" text-anchor="middle">' + esc(big) + '</text>' +
    '<text class="clk-sub" x="' + C + '" y="' + (C + 20) + '" text-anchor="middle">' + esc(sub) + '</text>' +
    '<text class="clk-sub small' + (m.live != null ? ' live' : '') + '" x="' + C + '" y="' + (C + 40) + '" text-anchor="middle">' + esc(line2) + '</text>';
  const defs = opt.plain ? '' : '<defs><filter id="' + id + '-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  return '<svg class="clk' + (opt.plain ? ' plain' : '') + '"' + (opt.anim ? ' data-anim="1"' : '') + ' viewBox="-14 0 ' + (S + 28) + ' ' + S + '" width="' + (opt.size || S) + '" height="' + Math.round((opt.size || S) * S / (S + 28)) + '" role="img" aria-label="' + esc(ariaText(m)) + '"' + (opt.plain ? '' : ' style="--g:url(#' + id + '-glow)"') + '>' + defs +
    '<circle class="clk-ring" cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke-width="18"/>' + closed + marks + labels +
    '<g class="clk-ticks"' + (opt.plain ? '' : ' filter="url(#' + id + '-glow)"') + '>' + ticks + one + liveMark + '</g>' + hand + center + '</svg>';
}
function ariaText(m) {
  return m.name + '’s clock: ' + hoursText(m.onMin, true) + ' on the clock, ' + pl(m.calls, 'call', 'calls') + (m.toYou ? ', ' + m.toYou + ' brought to you' : '') + (m.worth ? ', about $' + m.worth.toLocaleString('en-US') + ' caught after hours' : '') + (m.backMin ? ', ' + hoursText(m.backMin) + ' back to you' : '') + (m.live != null ? '. On a call now, ' + sayMinute(m.live) : '') + '.';
}
// The styles every host shares. Each host sets --clk-ink, --clk-mute, --clk-line, --clk-ok, --clk-sign and the fonts.
export const CLOCK_CSS = '.clk{display:block;max-width:100%;height:auto;overflow:visible}.clk text{font-family:inherit}' +
  '.clk-ring{stroke:var(--clk-line,rgba(255,255,255,.08))}.clk-night{stroke:var(--clk-night,rgba(255,90,77,.16))}' +
  '.clk-mark{stroke:var(--clk-mute,#A3ACBF);stroke-width:1;opacity:.5}.clk-mark.big{stroke-width:2;opacity:.9}.clk-lab{font-size:11px;fill:var(--clk-mute,#A3ACBF);font-weight:600;letter-spacing:.04em}' +
  '.clk-tick{stroke:var(--clk-ok,#5CC9A4);stroke-width:2;stroke-linecap:round;opacity:.85}.clk-tick.work{stroke-width:1.5;opacity:.55}.clk-tick.you{stroke:var(--clk-sign,#FF6A5E);stroke-width:2.6;opacity:1}' +
  '.clk-one{fill:none;stroke:var(--clk-sign,#FF6A5E);stroke-width:2;opacity:.95}' +
  '.clk-live{stroke:var(--clk-sign,#FF6A5E);stroke-width:3;stroke-linecap:round}.clk-live-dot{fill:var(--clk-sign,#FF6A5E)}.clk-big.money{fill:var(--clk-sign,#FF6A5E)}.clk-sub.live{fill:var(--clk-sign,#FF6A5E);font-weight:700}' +
  '.clk:not(.plain) .clk-live,.clk:not(.plain) .clk-live-dot{filter:drop-shadow(0 0 6px rgba(255,90,77,1))}@media (prefers-reduced-motion:no-preference){.clk:not(.plain) .clk-live-dot{animation:clkLive 1.4s ease-in-out infinite}.clk:not(.plain) .clk-big.money{animation:clkMoney 3.2s ease-in-out infinite}}@keyframes clkLive{0%,100%{opacity:1;r:5}50%{opacity:.45;r:8}}@keyframes clkMoney{0%,100%{filter:drop-shadow(0 0 8px rgba(255,90,77,.6))}50%{filter:drop-shadow(0 0 16px rgba(255,90,77,1))}}' +
  '.clk-hand line{stroke:var(--clk-ink,#fff);stroke-width:1.2;opacity:.55}.clk-hand circle{fill:var(--clk-ink,#fff)}' +
  '.clk-big{font-size:34px;font-weight:850;fill:var(--clk-ink,#fff)}.clk-sub{font-size:13px;font-weight:600;fill:var(--clk-mute,#A3ACBF)}.clk-sub.small{font-size:11px;font-weight:500}' +
  '.clk:not(.plain) .clk-big{filter:drop-shadow(0 0 8px rgba(255,255,255,.35))}.clk:not(.plain) .clk-tick.night{filter:drop-shadow(0 0 3px rgba(92,201,164,.8))}.clk:not(.plain) .clk-tick.you{filter:drop-shadow(0 0 4px rgba(255,90,77,.9))}.clk:not(.plain) .clk-one{filter:drop-shadow(0 0 6px rgba(255,90,77,.9))}' +
  '@media (prefers-reduced-motion:no-preference){.clk:not(.plain) .clk-one{animation:clkOne 2.4s ease-in-out infinite}}@keyframes clkOne{0%,100%{opacity:.55;r:6}50%{opacity:1;r:8}}' +
  '.clk.plain .clk-ring{stroke:#E2DED6}.clk.plain .clk-night{stroke:#FDECEA}.clk.plain .clk-tick{stroke:#0E4A2E}.clk.plain .clk-tick.you,.clk.plain .clk-one{stroke:#D92D20}.clk.plain .clk-live,.clk.plain .clk-live-dot{stroke:#D92D20;fill:#D92D20}.clk.plain .clk-big.money{fill:#B42318}.clk.plain .clk-big,.clk.plain .clk-hand circle{fill:#14171F}.clk.plain .clk-hand line{stroke:#14171F}.clk.plain .clk-sub,.clk.plain .clk-lab{fill:#5A6170}.clk.plain .clk-mark{stroke:#5A6170}';
// The site's "working" dial: when it scrolls into view, the hand sweeps one day, each call lights up with a ping as the
// hand reaches it, the money counts up with the after-hours calls, then the hand parks on the live call and it repeats.
// Only while visible; reduced motion keeps the still dial. Returns a script body; hosts wrap it.
export const CLOCK_ANIM_CSS = '.clk-tick.off{opacity:.08!important;filter:none!important}.clk-ping{fill:none;stroke:var(--clk-ok,#5CC9A4);stroke-width:2;opacity:0}.clk-ping.you{stroke:var(--clk-sign,#FF6A5E)}.clk-ping.go{animation:clkPing .9s ease-out}@keyframes clkPing{0%{opacity:.95;r:2}100%{opacity:0;r:16}}.clk-hand.sweep line{opacity:.9;stroke-width:1.6}.clk-trail{fill:none;stroke:url(#clkTrail);stroke-width:18;opacity:.0;transition:opacity .4s}.clk-hand.sweep~.clk-trail,.clk.sweeping .clk-trail{opacity:1}';
export const CLOCK_ANIM_JS = 'function aoClockAnim(){if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;var O=window.__clkO||(window.__clkO={});' +
'document.querySelectorAll("svg.clk[data-anim]:not([data-bound])").forEach(function(svg){svg.setAttribute("data-bound","1");var C=160,R=126,ns="http://www.w3.org/2000/svg",hand=svg.querySelector(".clk-hand"),big=svg.querySelector(".clk-big"),sub=svg.querySelector(".clk-sub.small"),ticks=[].slice.call(svg.querySelectorAll(".clk-tick")).sort(function(a,b){return a.getAttribute("data-m")-b.getAttribute("data-m")});if(!hand||!ticks.length)return;' +
'hand.setAttribute("data-anim-own","1");var key=hand.id||"clk",at=+hand.getAttribute("data-at")||0,nowMin=hand.hasAttribute("data-min"),worth=big&&big.hasAttribute("data-worth")?+big.getAttribute("data-worth"):0,bigTxt=big?big.textContent:"",subTxt=sub?sub.textContent:"",nightN=ticks.filter(function(t){var c=t.getAttribute("class");return /night/.test(c)&&/call/.test(c)}).length||1;' +
'var g=svg.querySelector(".clk-ticks"),pings=[],pi=0;for(var k=0;k<6;k++){var c=document.createElementNS(ns,"circle");c.setAttribute("class","clk-ping");c.setAttribute("r","2");g.appendChild(c);pings.push(c)}' +
'function ang(m){return m/1440*Math.PI*2-Math.PI/2}function ping(t){var m=+t.getAttribute("data-m"),c=pings[pi++%pings.length];c.setAttribute("cx",(C+Math.cos(ang(m))*(R+4)).toFixed(1));c.setAttribute("cy",(C+Math.sin(ang(m))*(R+4)).toFixed(1));c.setAttribute("class","clk-ping"+(/you/.test(t.getAttribute("class"))?" you":""));void c.getBBox();c.setAttribute("class",c.getAttribute("class")+" go")}' +
'function say(m){m=Math.round(m)%1440;var h=Math.floor(m/60),mm=m%60,ap=h<12?"AM":"PM";h=h%12||12;return h+":"+(mm<10?"0":"")+mm+" "+ap}function rot(m){hand.style.transformOrigin=C+"px "+C+"px";hand.style.transform="rotate("+((m-at)/1440*360)+"deg)"}' +
'function park(){if(!nowMin)return at;var d=new Date();return d.getHours()*60+d.getMinutes()}' +
'var DAY=7000,BACK=900,PARK=3800,CYC=DAY+BACK+PARK,visible=false,raf=0,last=-1;if(O[key]==null)O[key]=-1;' +
'function frame(){if(!visible||!svg.isConnected){raf=0;return}var n=performance.now();if(O[key]<0)O[key]=n;var e=(n-O[key])%CYC;' +
'if(e<DAY){var m=e/DAY*1440,lit=0,seen=0;if(m<last)last=-1;ticks.forEach(function(t){var tm=+t.getAttribute("data-m"),on=tm<=m,c=t.getAttribute("class");t.classList.toggle("off",!on);if(on){lit++;if(/call/.test(c)&&/night/.test(c))seen++;if(last>=0&&tm>last&&/call/.test(c))ping(t)}});last=m;rot(m);hand.classList.add("sweep");' +
'if(big&&worth)big.textContent="$"+Math.round(worth*Math.min(1,seen/nightN)).toLocaleString("en-US");if(sub)sub.textContent=(lit?lit+" handled \\u00b7 ":"Answering \\u00b7 ")+say(m)}' +
'else{last=-1;ticks.forEach(function(t){t.classList.remove("off")});if(big)big.textContent=bigTxt;var q=Math.min(1,(e-DAY)/BACK),ease=1-Math.pow(1-q,3),to=park();rot(1440+(to)*ease);if(q>=1){hand.classList.remove("sweep");if(sub)sub.textContent=subTxt}}' +
'raf=requestAnimationFrame(frame)}' +
'new IntersectionObserver(function(es){es.forEach(function(x){visible=x.isIntersecting;if(visible&&!raf)raf=requestAnimationFrame(frame)})},{threshold:.4}).observe(svg)})}aoClockAnim();';
// Keeps the hand on the minute while the page is open (the server drew it once). Returns a script body; hosts wrap it.
export const CLOCK_JS = 'function aoClockTick(){var hs=document.querySelectorAll(".clk-hand");if(!hs.length)return;var d=new Date(),m=d.getHours()*60+d.getMinutes();for(var i=0;i<hs.length;i++){var h=hs[i];if(h.hasAttribute("data-anim-own")||!h.hasAttribute("data-min"))continue;var b=+h.getAttribute("data-min");if(!isFinite(b))continue;var a=((m-b)/1440)*360;h.style.transformOrigin="160px 160px";h.style.transform="rotate("+a+"deg)";}}aoClockTick();setInterval(aoClockTick,30000);';

// ---------- the database ----------
// One business, one window (ISO start and end), in its own time. Every query tolerates a missing table.
export async function clockFor(env, cid, startIso, endIso, o) {
  o = o || {};
  const q = async (sql, ...b) => { try { return ((await env.DB.prepare(sql).bind(...b).all()).results) || []; } catch (e) { return []; } };
  const [calls, books, checks, fus, items, texts] = await Promise.all([
    q("SELECT id, at, seconds, outcome, transferred, urgency, reason, caller_name, callback FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview', 'failed') ORDER BY at", cid, startIso, endIso),
    q("SELECT call_id FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND created >= ?2 AND created < ?3", cid, startIso, endIso),
    q("SELECT done_at FROM checkins WHERE client_id = ?1 AND done_at != '' AND done_at >= ?2 AND done_at < ?3", cid, startIso, endIso),
    q("SELECT done_at FROM app_followups WHERE client_id = ?1 AND status = 'done' AND done_at >= ?2 AND done_at < ?3", cid, startIso, endIso),
    q("SELECT kind, COALESCE(NULLIF(decided_at, ''), created) AS at FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'post') AND status IN ('approved', 'closed') AND COALESCE(NULLIF(decided_at, ''), created) >= ?2 AND COALESCE(NULLIF(decided_at, ''), created) < ?3", cid, startIso, endIso),
    q("SELECT at FROM sms_log WHERE client_id = ?1 AND kind = 'textback' AND at >= ?2 AND at < ?3", cid, startIso, endIso)
  ]);
  const booked = new Set(books.map(r => String(r.call_id || '')).filter(Boolean));
  const ev = [];
  for (const c of calls) {
    const isB = booked.has(String(c.id));
    const lead = isB || ((c.outcome === 'done' || c.outcome === 'transferred') && !!(String(c.caller_name || '').trim() || String(c.callback || '').trim() || String(c.reason || '').trim()));
    ev.push({ at: c.at, kind: 'call', seconds: +c.seconds || 0, toYou: +c.transferred === 1 || c.outcome === 'transferred' || /urgent|emergency|high/i.test(c.urgency || ''), booked: isB, lead, reason: o.reasons === false ? '' : c.reason });
  }
  for (const r of checks) ev.push({ at: r.done_at, kind: 'checkin' });
  for (const r of fus) ev.push({ at: r.done_at, kind: 'followup' });
  for (const r of items) ev.push({ at: r.at, kind: r.kind === 'post' ? 'post' : 'reply' });
  for (const r of texts) ev.push({ at: r.at, kind: 'textback' });
  return clockModel(ev, { tz: o.tz, start: Date.parse(startIso), end: Date.parse(endIso), now: o.now, name: o.name, mtd: o.mtd, worth: o.worth, live: o.live });
}

// The website's sample: Mike's Plumbing, October, the same month as the sample report (monthpage.js samplePage).
export function sampleClock(now) {
  const tz = 'America/New_York', d = (day, hh, mm) => Date.parse('2026-10-' + String(day).padStart(2, '0') + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00-04:00');
  const call = (day, hh, mm, x) => Object.assign({ at: d(day, hh, mm), kind: 'call', seconds: 150, lead: true }, x || {});
  // 60 calls, 15 of them nights and weekends; 3 brought to the owner; 9 booked on the call
  const ev = [
    call(14, 2, 47, { toYou: true, booked: true, reason: 'Water coming up through the basement floor drain', seconds: 231 }),
    call(3, 6, 52, { booked: true, reason: 'Water heater pilot keeps going out' }), call(22, 7, 31, { reason: 'No hot water this morning' }),
    call(21, 8, 40, { reason: 'Dripping kitchen faucet' }), call(1, 8, 15, { reason: 'Quote for a repipe' }), call(8, 8, 55, { booked: true, reason: 'Toilet overflowing' }),
    call(7, 9, 15, { reason: 'Quote for a new water heater' }), call(15, 9, 40, { lead: false, reason: 'Wrong number' }), call(28, 9, 5, { reason: 'Toilet running' }), call(5, 9, 50, { reason: 'Kitchen sink backing up' }),
    call(12, 10, 20, { booked: true, reason: 'Leak under the bathroom sink' }), call(19, 10, 48, { reason: 'Water softener question' }), call(26, 10, 5, { reason: 'Sewer smell in the yard' }), call(2, 10, 35, { reason: 'Hose bib replacement' }),
    call(9, 11, 10, { reason: 'Shower pressure dropped' }), call(16, 11, 25, { reason: 'Garbage disposal humming' }), call(23, 11, 45, { booked: true, reason: 'Main line clog' }), call(30, 11, 5, { reason: 'Estimate for a bathroom remodel' }), call(6, 11, 55, { lead: false, reason: 'Asked for directions' }),
    call(13, 12, 10, { reason: 'Slow bathroom drain' }), call(20, 12, 40, { reason: 'Tankless heater error code' }), call(27, 12, 15, { reason: 'Dishwasher not draining' }), call(1, 13, 5, { reason: 'Outdoor faucet froze last year' }),
    call(8, 13, 30, { booked: true, reason: 'Water heater leaking from the bottom' }), call(15, 13, 50, { reason: 'Gurgling toilet' }), call(22, 14, 5, { reason: 'Price for a sump pump' }), call(29, 14, 25, { reason: 'Low pressure whole house' }),
    call(2, 14, 45, { reason: 'Faucet cartridge' }), call(9, 14, 55, { lead: false, reason: 'Vendor call' }),
    call(2, 15, 30, { booked: true, reason: 'Garbage disposal jammed' }), call(16, 16, 10, { reason: 'Low water pressure upstairs' }), call(23, 17, 45, { reason: 'Outside spigot leaking' }), call(6, 15, 5, { reason: 'Reschedule Thursday' }),
    call(13, 15, 40, { reason: 'Water bill doubled, maybe a leak' }), call(20, 16, 35, { reason: 'Shut-off valve stuck' }), call(27, 16, 50, { booked: true, reason: 'Clogged tub' }), call(30, 17, 15, { reason: 'Quote for a water filter' }),
    call(7, 17, 30, { reason: 'Running toilet, second floor' }), call(14, 15, 55, { reason: 'Follow-up on an estimate' }), call(21, 16, 20, { lead: false, reason: 'Spam' }),
    call(6, 18, 20, { reason: 'No hot water' }), call(13, 19, 5, { reason: 'Sump pump not running' }), call(20, 19, 50, { toYou: true, reason: 'Pipe burst under the sink', seconds: 198 }), call(27, 20, 30, { lead: false, reason: 'Asked about Sunday hours' }),
    call(1, 18, 45, { reason: 'Leak from the ceiling' }), call(8, 19, 25, { booked: true, reason: 'Toilet will not flush, only one in the house' }), call(15, 20, 10, { reason: 'Hot water smells like sulfur' }),
    call(22, 18, 5, { reason: 'Drain cleaning price' }), call(29, 19, 40, { reason: 'Water heater making a popping noise' }),
    call(3, 22, 15, { reason: 'Leaking water heater, towels down', toYou: true, seconds: 204 }), call(10, 23, 5, { reason: 'Shut-off valve will not turn' }), call(17, 21, 40, { reason: 'Clog, guests tomorrow' }),
    call(24, 5, 50, { reason: 'No water at all' }), call(4, 10, 15, { reason: 'Saturday: sewer backup' }), call(11, 14, 30, { reason: 'Saturday: leak behind the washer' }), call(18, 9, 45, { booked: true, reason: 'Saturday: toilet off the floor' }),
    call(25, 16, 5, { reason: 'Sunday: dripping faucet' }), call(4, 19, 20, { reason: 'Saturday evening: no hot water' }), call(11, 8, 30, { reason: 'Sunday: water heater question' }), call(31, 7, 10, { reason: 'Saturday: kitchen drain' })
  ];
  [[4, 10, 10], [5, 11, 40], [8, 10, 20], [10, 14, 5], [12, 11, 0], [17, 15, 30], [19, 10, 45], [24, 13, 15], [26, 16, 20]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'checkin' }));
  [[6, 9, 2], [13, 9, 4], [20, 9, 1], [27, 9, 3]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'followup' }));
  [[5, 7, 15], [18, 7, 40], [29, 7, 5]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'reply' }));
  [[8, 12, 30], [22, 12, 45]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'post' }));
  ev.push({ at: d(11, 21, 12), kind: 'textback' });
  // staged for the website: the 2:47 AM call is in progress, so the hand is parked on it
  return clockModel(ev, { tz, start: d(1, 0, 0), end: Date.parse('2026-11-01T00:00:00-04:00'), now: now || Date.parse('2026-11-02T08:00:00-05:00'), name: 'Max', worth: 6400, live: d(14, 2, 47) });
}
