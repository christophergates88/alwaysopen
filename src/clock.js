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
  return {
    tz, start, end, mtd: !!o.mtd, name: o.name || 'Max',
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
    ticks += '<line class="clk-tick' + (t.you ? ' you' : '') + (call ? ' call' : ' work') + (t.night ? ' night' : '') + '" x1="' + f(ax) + '" y1="' + f(ay) + '" x2="' + f(bx) + '" y2="' + f(by) + '"><title>' + esc(sayMinute(t.m) + ' · ' + (KIND_LABEL[t.kind] || t.kind) + (t.you ? ', brought to you' : '')) + '</title></line>';
  }
  let one = '';
  if (m.one) { const [ox, oy] = pt(m.one.m, R + 4); one = '<circle class="clk-one" cx="' + f(ox) + '" cy="' + f(oy) + '" r="6"/>'; }
  let hand = '';
  if (opt.live !== false) { const [hx, hy] = pt(m.nowMin, R - 28); hand = '<g class="clk-hand" id="' + id + '-hand" data-min="' + m.nowMin + '"><line x1="' + C + '" y1="' + C + '" x2="' + f(hx) + '" y2="' + f(hy) + '"/><circle cx="' + f(hx) + '" cy="' + f(hy) + '" r="3"/></g>'; }
  const big = m.backMin ? hoursText(m.backMin) : (m.calls ? pl(m.calls, 'call', 'calls') : 'On duty');
  const sub = m.backMin ? 'back to you' : (m.calls ? 'answered' : 'nothing yet');
  const line2 = hoursText(m.onMin, true) + ' on the clock' + (m.calls ? ' · ' + pl(m.calls, 'call', 'calls') : '');
  const center = '<text class="clk-big" x="' + C + '" y="' + (C - 2) + '" text-anchor="middle">' + esc(big) + '</text>' +
    '<text class="clk-sub" x="' + C + '" y="' + (C + 20) + '" text-anchor="middle">' + esc(sub) + '</text>' +
    '<text class="clk-sub small" x="' + C + '" y="' + (C + 40) + '" text-anchor="middle">' + esc(line2) + '</text>';
  const defs = opt.plain ? '' : '<defs><filter id="' + id + '-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  return '<svg class="clk' + (opt.plain ? ' plain' : '') + '" viewBox="-14 0 ' + (S + 28) + ' ' + S + '" width="' + (opt.size || S) + '" height="' + Math.round((opt.size || S) * S / (S + 28)) + '" role="img" aria-label="' + esc(ariaText(m)) + '"' + (opt.plain ? '' : ' style="--g:url(#' + id + '-glow)"') + '>' + defs +
    '<circle class="clk-ring" cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke-width="18"/>' + closed + marks + labels +
    '<g class="clk-ticks"' + (opt.plain ? '' : ' filter="url(#' + id + '-glow)"') + '>' + ticks + one + '</g>' + hand + center + '</svg>';
}
function ariaText(m) {
  return m.name + '’s clock: ' + hoursText(m.onMin, true) + ' on the clock, ' + pl(m.calls, 'call', 'calls') + (m.toYou ? ', ' + m.toYou + ' brought to you' : '') + (m.backMin ? ', ' + hoursText(m.backMin) + ' back to you' : '') + '.';
}
// The styles every host shares. Each host sets --clk-ink, --clk-mute, --clk-line, --clk-ok, --clk-sign and the fonts.
export const CLOCK_CSS = '.clk{display:block;max-width:100%;height:auto;overflow:visible}.clk text{font-family:inherit}' +
  '.clk-ring{stroke:var(--clk-line,rgba(255,255,255,.08))}.clk-night{stroke:var(--clk-night,rgba(255,90,77,.16))}' +
  '.clk-mark{stroke:var(--clk-mute,#A3ACBF);stroke-width:1;opacity:.5}.clk-mark.big{stroke-width:2;opacity:.9}.clk-lab{font-size:11px;fill:var(--clk-mute,#A3ACBF);font-weight:600;letter-spacing:.04em}' +
  '.clk-tick{stroke:var(--clk-ok,#5CC9A4);stroke-width:2;stroke-linecap:round;opacity:.85}.clk-tick.work{stroke-width:1.5;opacity:.55}.clk-tick.you{stroke:var(--clk-sign,#FF6A5E);stroke-width:2.6;opacity:1}' +
  '.clk-one{fill:none;stroke:var(--clk-sign,#FF6A5E);stroke-width:2;opacity:.95}' +
  '.clk-hand line{stroke:var(--clk-ink,#fff);stroke-width:1.2;opacity:.55}.clk-hand circle{fill:var(--clk-ink,#fff)}' +
  '.clk-big{font-size:34px;font-weight:850;fill:var(--clk-ink,#fff)}.clk-sub{font-size:13px;font-weight:600;fill:var(--clk-mute,#A3ACBF)}.clk-sub.small{font-size:11px;font-weight:500}' +
  '.clk:not(.plain) .clk-big{filter:drop-shadow(0 0 8px rgba(255,255,255,.35))}.clk:not(.plain) .clk-tick.night{filter:drop-shadow(0 0 3px rgba(92,201,164,.8))}.clk:not(.plain) .clk-tick.you{filter:drop-shadow(0 0 4px rgba(255,90,77,.9))}.clk:not(.plain) .clk-one{filter:drop-shadow(0 0 6px rgba(255,90,77,.9))}' +
  '@media (prefers-reduced-motion:no-preference){.clk:not(.plain) .clk-one{animation:clkOne 2.4s ease-in-out infinite}}@keyframes clkOne{0%,100%{opacity:.55;r:6}50%{opacity:1;r:8}}' +
  '.clk.plain .clk-ring{stroke:#E2DED6}.clk.plain .clk-night{stroke:#FDECEA}.clk.plain .clk-tick{stroke:#0E4A2E}.clk.plain .clk-tick.you,.clk.plain .clk-one{stroke:#D92D20}.clk.plain .clk-big,.clk.plain .clk-hand circle{fill:#14171F}.clk.plain .clk-hand line{stroke:#14171F}.clk.plain .clk-sub,.clk.plain .clk-lab{fill:#5A6170}.clk.plain .clk-mark{stroke:#5A6170}';
// Keeps the hand on the minute while the page is open (the server drew it once). Returns a script body; hosts wrap it.
export const CLOCK_JS = 'function aoClockTick(){var hs=document.querySelectorAll(".clk-hand");if(!hs.length)return;var d=new Date(),m=d.getHours()*60+d.getMinutes();for(var i=0;i<hs.length;i++){var h=hs[i],b=+h.getAttribute("data-min");if(!isFinite(b))continue;var a=((m-b)/1440)*360;h.style.transformOrigin="160px 160px";h.style.transform="rotate("+a+"deg)";}}aoClockTick();setInterval(aoClockTick,30000);';

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
  return clockModel(ev, { tz: o.tz, start: Date.parse(startIso), end: Date.parse(endIso), now: o.now, name: o.name, mtd: o.mtd });
}

// The website's sample: Mike's Plumbing, October, the same month as the sample report (monthpage.js samplePage).
export function sampleClock(now) {
  const tz = 'America/New_York', d = (day, hh, mm) => Date.parse('2026-10-' + String(day).padStart(2, '0') + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00-04:00');
  const call = (day, hh, mm, x) => Object.assign({ at: d(day, hh, mm), kind: 'call', seconds: 150, lead: true }, x || {});
  const ev = [
    call(14, 2, 47, { toYou: true, booked: true, reason: 'Water coming up through the basement floor drain', seconds: 231 }),
    call(3, 6, 52, { booked: true, reason: 'Water heater pilot keeps going out' }), call(21, 8, 40, { reason: 'Dripping kitchen faucet' }),
    call(7, 9, 15, { reason: 'Quote for a new water heater' }), call(15, 10, 48, { lead: false, reason: 'Wrong number' }), call(28, 11, 20, { reason: 'Toilet running' }),
    call(9, 13, 5, { reason: 'Slow bathroom drain' }),
    call(2, 15, 30, { booked: true, reason: 'Garbage disposal jammed' }), call(16, 16, 10, { reason: 'Low water pressure upstairs' }), call(23, 17, 45, { reason: 'Outside spigot leaking' }),
    call(6, 18, 20, { reason: 'No hot water' }), call(13, 19, 5, { reason: 'Sump pump not running', toYou: false }), call(20, 19, 50, { toYou: true, reason: 'Pipe burst under the sink', seconds: 198 }), call(27, 20, 30, { lead: false, reason: 'Asked about Sunday hours' })
  ];
  [[4, 10, 10], [5, 11, 40], [8, 10, 20], [10, 14, 5], [12, 11, 0], [17, 15, 30], [19, 10, 45], [24, 13, 15], [26, 16, 20]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'checkin' }));
  [[6, 9, 2], [13, 9, 4], [20, 9, 1], [27, 9, 3]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'followup' }));
  [[5, 7, 15], [18, 7, 40], [29, 7, 5]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'reply' }));
  [[8, 12, 30], [22, 12, 45]].forEach(x => ev.push({ at: d(x[0], x[1], x[2]), kind: 'post' }));
  ev.push({ at: d(11, 21, 12), kind: 'textback' });
  return clockModel(ev, { tz, start: d(1, 0, 0), end: Date.parse('2026-11-01T00:00:00-04:00'), now: now || Date.parse('2026-11-02T08:00:00-05:00'), name: 'Max' });
}
