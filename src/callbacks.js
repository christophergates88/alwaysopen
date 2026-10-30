// The call-back promise, enforced. When a caller wants the owner to call them, Max names a time. The owner gets a nudge
// before it, marks it done or asks for thirty more minutes, and if the window passes with nothing, Max calls the customer
// once to set a new time. The customer is never left hanging, even by the owner.
// Outbound calls follow rules the server enforces: only to someone who asked for a call back on this matter, never between
// 9 PM and 8 AM for them, one attempt plus one retry, the first sentence says it is an automated assistant and may be
// recorded, "stop" or 9 ends calls for good, and regulated lines get no outbound calls at all (the owner is pushed instead).
// Loaded late so the rules here can be tested without the worker's own imports.
const pushClient = async (...a) => { try { return await (await import('./app.js')).pushClient(...a); } catch (e) { return 0; } };
const logAct = async (...a) => { try { return await (await import('./biz.js')).logAct(...a); } catch (e) {} };

const SITE = 'https://alwaysopenoffice.com';
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/';
const GRACE_MIN = 20;      // how long after the promised time before it counts as missed
const NUDGE_MIN = 10;      // owner nudge this long before the promised time
const CRON_MIN = 10;       // the worker cron runs every 10 minutes

let ready = false;
export async function ensureCallbacks(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS callbacks (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, call_sid TEXT DEFAULT '', phone TEXT NOT NULL, name TEXT DEFAULT '', reason TEXT DEFAULT '', due_at TEXT NOT NULL, status TEXT DEFAULT 'pending', created TEXT, nudged_at TEXT DEFAULT '', attempts INTEGER DEFAULT 0, last_result TEXT DEFAULT '', urgent INTEGER DEFAULT 0, note TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS callbacks_due ON callbacks (status, due_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS call_optout (client_id TEXT NOT NULL, phone10 TEXT NOT NULL, at TEXT, PRIMARY KEY (client_id, phone10))'),
  ]);
  ready = true;
}

export function ph10(s) { let d = String(s == null ? '' : s).replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : ''; }
const E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

// ---------- time zones ----------
// Each line keeps its business's time zone (voice_lines.tz, set when the line is bought from the client's state or
// phone; Chris can correct it in D1). A connected Google Calendar's own zone wins; a line with none stored works it out
// from its town and number; Eastern only when nothing says otherwise.
const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles';
const ZONE_CODES = {
  [ET]: '203 475 860 959 302 202 771 239 305 321 324 352 386 407 561 645 656 689 727 728 754 772 786 813 863 904 941 954 229 404 470 478 678 706 762 770 912 943 ' +
    '260 317 463 574 765 502 606 859 207 227 240 301 410 443 667 339 351 413 508 617 774 781 857 978 231 248 269 313 517 586 616 679 734 810 947 989 603 ' +
    '201 551 609 640 732 848 856 862 908 973 212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934 252 336 472 704 743 828 910 919 980 984 ' +
    '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937 215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 401 803 821 839 843 854 864 423 865 802 ' +
    '276 434 540 571 686 703 757 804 826 948 304 681',
  [CT]: '205 251 256 334 483 659 938 327 479 501 870 217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872 219 319 515 563 641 712 316 620 785 913 ' +
    '225 318 337 504 985 218 320 507 612 651 763 924 952 228 601 662 769 235 314 417 557 573 636 660 816 975 402 531 701 405 539 572 580 918 615 629 731 901 931 ' +
    '210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 262 274 353 414 534 608 715 920',
  [MT]: '303 719 720 970 983 406 505 575 385 435 801 307 915',
  'America/Phoenix': '480 520 602 623',
  [PT]: '209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 ' +
    '702 725 775 458 503 541 971 206 253 360 425 509 564',
  'America/Anchorage': '907', 'Pacific/Honolulu': '808', 'America/Puerto_Rico': '787 939'
};
// Area codes that cross a time-zone line: the first zone is the usual one.
const SPLIT_CODES = { 850: [CT, ET], 448: [CT, ET], 812: [ET, CT], 930: [ET, CT], 270: [CT, ET], 364: [CT, ET], 906: [ET, CT], 308: [CT, MT], 605: [CT, MT], 208: ['America/Boise', PT], 986: ['America/Boise', PT], 928: ['America/Phoenix', MT] };
const AREA = {};
for (const z in ZONE_CODES) for (const c of ZONE_CODES[z].split(' ')) AREA[c] = [z];
for (const c in SPLIT_CODES) AREA[c] = SPLIT_CODES[c];
const STATE_TZ = {};
for (const [z, list] of [[ET, 'CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV'], [CT, 'AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI'], [MT, 'CO MT NM UT WY'], [PT, 'CA NV OR WA'],
  ['America/Boise', 'ID'], ['America/Phoenix', 'AZ'], ['America/Anchorage', 'AK'], ['Pacific/Honolulu', 'HI'], ['America/Puerto_Rico', 'PR']]) for (const s of list.split(' ')) STATE_TZ[s] = z;
// States split by a time-zone line: there, the area code of the business's phone says which side it is on.
const SPLIT_STATES = { FL: [ET, CT], IN: [ET, CT], KY: [ET, CT], MI: [ET, CT], TN: [CT, ET], TX: [CT, MT], KS: [CT, MT], NE: [CT, MT], ND: [CT, MT], SD: [CT, MT], ID: ['America/Boise', PT], OR: [PT, 'America/Boise'] };
// The zones a phone number's area code may be in (none when it is not a US number we know).
export function zonesOfNumber(p) { const d = ph10(p); return d ? (AREA[d.slice(0, 3)] || []) : []; }
export function zoneOfState(town) { const m = /,\s*([A-Za-z]{2})\s*$/.exec(String(town || '').trim()); return m ? (STATE_TZ[m[1].toUpperCase()] || '') : ''; }
// The business's zone from what we know at sign-up: its state (from "Town, ST"), its own phone, the number we bought.
export function lineZone(o) {
  o = o || {};
  const m = /,\s*([A-Za-z]{2})\s*$/.exec(String(o.town || '').trim()), st = m ? m[1].toUpperCase() : '', sz = STATE_TZ[st] || '';
  const byPhone = [o.phone, o.number].map(p => zonesOfNumber(p)[0]).filter(Boolean);
  if (sz) { const alt = SPLIT_STATES[st]; const hit = alt && byPhone.find(z => alt.indexOf(z) > -1); return hit || sz; }
  return byPhone[0] || ET;
}
const zoneSeen = {};
export function zoneOk(tz) {
  if (!tz || typeof tz !== 'string') return false;
  if (zoneSeen[tz] == null) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zoneSeen[tz] = true; } catch (e) { zoneSeen[tz] = false; } }
  return zoneSeen[tz];
}
// voice_lines.tz is added on first use (the live table predates it).
const tzReady = new WeakSet();
export async function ensureLineTz(env) {
  if (!env || !env.DB || tzReady.has(env.DB)) return;
  try { await env.DB.prepare("ALTER TABLE voice_lines ADD COLUMN tz TEXT DEFAULT ''").run(); } catch (e) { /* already there */ }
  tzReady.add(env.DB);
}

export async function tzFor(env, cid) {
  try { const g = await env.DB.prepare('SELECT tz FROM gcal_tokens WHERE client_id = ?1').bind(cid).first(); if (g && zoneOk(g.tz)) return g.tz; } catch (e) {}
  try {
    const l = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(cid).first();
    if (l) return zoneOk(l.tz) ? l.tz : lineZone({ town: l.town, number: l.number });
  } catch (e) {}
  return ET;
}

// The owner switched Max off from the app (the same rule as withOwner in app.js: HQ's on_air, unless the owner paused it).
export function ownerOff(ownerSet) { try { return !!(JSON.parse(ownerSet || '{}') || {}).off; } catch (e) { return false; } }
export function lineLive(row) { return !!(row && +row.on_air && !ownerOff(row.owner_set)); }

// What a customer said to a yes-or-no question on an outbound call (check-ins, call-back times): 'yes', 'no', 'stop',
// 'unclear' (both, or neither), or '' (nothing at all). "No problems", "not a single issue" and "nothing wrong" are yeses.
const ANS_STOP = /\b(stop calling|stop (these|the) calls|don'?t call|do not call|no more calls|remove me|take me off|unsubscribe|opt out)\b|^\s*(please )?stop( please| it)?\s*$/;
const ANS_FINE = /\b(no|not any|not a single|not one|zero|never had any|haven'?t had any|hasn'?t had any|didn'?t have any|without any)\s+(real\s+|more\s+)?(problems?|issues?|complaints?|trouble|troubles|leaks?|drips?|worries)\b|\bnothing('?s| is| was| went)?\s+(wrong|broken|leaking)\b|\bnot (a |one )?(problem|issue)\b|\bnot bad\b|\bcan'?t complain\b|\b(couldn'?t|could not|never) (be |been )?better\b|\bno worries\b/g;
const ANS_BAD = /\b(not|isn'?t|wasn'?t|aren'?t|ain'?t|never|hasn'?t|haven'?t|hadn'?t)\s+(\w+\s+)?(working|worked|holding( up)?|held( up)?|right|good|great|fixed|fine|ok|okay)\b|\b(doesn'?t|didn'?t|won'?t|does not|did not|will not|can'?t|cannot)\s+(\w+\s+)?(work|hold|seem|stop)\b|\b(stopped|quit) working\b/g;
const ANS_UNSURE = /\b(not sure|unsure|don'?t know|do not know|dunno|maybe|say (that|it) again|repeat that|what was that|who is this)\b/;
const ANS_YES = /\b(yes|yeah|yep|yup|ya|yea|sure|ok|okay|fine|good|great|perfect|excellent|awesome|works|working|worked|held|holding|it did|it has|absolutely|definitely|correct|right|that works|sounds good)\b/;
const ANS_NO = /\b(no|nope|nah|not|problems?|issues?|wrong|leaks?|leaking|leaked|drips?|dripping|broke|broken|bad|worse|terrible|awful|sooner|asap|soon as)\b/;
export function readAnswer(digits, speech) {
  const d = String(digits == null ? '' : digits).trim();
  if (d === '9') return 'stop';
  if (d === '1') return 'yes';
  if (d === '2') return 'no';
  let t = String(speech == null ? '' : speech).toLowerCase().replace(/[’‘]/g, '\'').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return d ? 'unclear' : '';
  if (ANS_STOP.test(t)) return 'stop';
  t = t.replace(ANS_FINE, ' fine ').replace(ANS_BAD, ' broken ');
  const yes = ANS_YES.test(t), no = ANS_NO.test(t);
  if (ANS_UNSURE.test(t) || yes === no) return 'unclear';
  return yes ? 'yes' : 'no';
}

// Local clock pieces for a moment in a timezone.
export function local(tz, at) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const o = {}; for (const x of f.formatToParts(new Date(at))) o[x.type] = x.value;
  return { hour: +o.hour % 24, minute: +o.minute, day: o.year + '-' + o.month + '-' + o.day, wd: o.weekday };
}
// The UTC instant for a local wall-clock time on a given local day (searches around the offset, DST-safe enough for a callback).
export function fromLocal(tz, day, hh, mm) {
  const guess = Date.parse(day + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00Z');
  for (const off of [0, -4, -5, -6, -7, -8, -9, -10, 1, 2, 3]) {
    const t = guess - off * 3600e3, l = local(tz, t);
    if (l.day === day && l.hour === hh && l.minute === mm) return t;
  }
  return guess + 4 * 3600e3;
}
export function sayTime(hh, mm) {
  const h12 = ((hh + 11) % 12) + 1, ap = hh < 12 ? 'AM' : 'PM';
  return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ' ' + ap;
}
export function spokenTime(hh, mm) {
  const h12 = ((hh + 11) % 12) + 1, ap = hh < 12 ? 'in the morning' : (hh < 17 ? 'this afternoon' : 'this evening');
  return (mm === 0 ? h12 + ' o\'clock' : (mm === 30 ? h12 + ' thirty' : (mm === 15 ? h12 + ' fifteen' : h12 + ' forty-five'))) + ' ' + ap;
}

// Propose the next time the owner can call: after "busy until" if the owner set one today, else the next quarter hour at least
// 45 minutes out, inside 8 AM to 6 PM local; past that, 9:15 the next morning.
export function proposeSlot(tz, now, busyUntil, hours) {
  // `hours` (optional): the business's open hours by weekday, { Mon: [openMinute, closeMinute], ... }. Without it, 8 AM to 6 PM.
  const l = local(tz, now);
  const win = wd => hours ? (hours[wd] || null) : [8 * 60, 18 * 60];
  const first = w => hours ? w[0] + 15 : 9 * 60 + 15;
  let day = l.day, wd = l.wd, ahead = 0, mins = l.hour * 60 + l.minute + 45;
  if (busyUntil && busyUntil.day === day) { const bu = busyUntil.hh * 60 + busyUntil.mm + 15; if (bu > mins) mins = bu; }
  mins = Math.ceil(mins / 15) * 15;
  let w = win(wd);
  if (w && mins < w[0]) mins = first(w);
  while (!w || mins > w[1] - (hours ? 30 : 0)) {
    if (++ahead > 7) { ahead = 1; w = [8 * 60, 18 * 60]; mins = 9 * 60 + 15; day = new Date(Date.parse(l.day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); break; }
    day = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    wd = WDAY[new Date(Date.parse(day + 'T12:00:00Z')).getUTCDay()];
    w = win(wd);
    if (w) mins = first(w);
  }
  const hh = Math.floor(mins / 60), mm = mins % 60;
  const when = ahead === 0 ? '' : (ahead === 1 ? ' tomorrow' : ' on ' + WDAY_LONG[WDAY.indexOf(wd)]);
  let spoken = spokenTime(hh, mm);
  if (ahead) spoken = spoken.replace('this afternoon', 'in the afternoon').replace('this evening', 'in the evening');
  return { day, hh, mm, at: fromLocal(tz, day, hh, mm), text: sayTime(hh, mm), spoken: spoken + when, tomorrow: ahead === 1, ahead };
}
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function busyFromLine(line, tz) {
  try { const o = JSON.parse(line.owner_set || '{}'); const b = o.busyUntil; if (b && b.day === local(tz, Date.now()).day && /^\d{1,2}:\d{2}$/.test(b.v)) { const [hh, mm] = b.v.split(':').map(Number); return { day: b.day, hh, mm }; } } catch (e) {}
  return null;
}
export function callbacksOff(line) { try { return JSON.parse(line.owner_set || '{}').callbacksOff === true; } catch (e) { return false; } }

// What Max is told for this call: the time to offer and how to say the owner is busy.
export async function slotForLine(env, line) {
  if (!line || callbacksOff(line)) return null;
  const tz = await tzFor(env, line.client_id);
  const busy = busyFromLine(line, tz);
  // Inside the business's own hours (what the owner set for booking, or read from their hours).
  let hours = null;
  try { hours = (await import('./availability.js')).bookingOf(line).days; } catch (e) { hours = null; }
  const s = proposeSlot(tz, Date.now(), busy, hours);
  return Object.assign(s, { busyText: busy ? 'on a job until ' + sayTime(busy.hh, busy.mm) : 'out on a job right now' });
}

// Turn Max's note ("today 15:15" / "tomorrow 09:15" / "") into a due time; fall back to the proposed slot.
export function dueFromNote(tz, text, fallback) {
  const m = /^(today|tomorrow)\s+(\d{1,2}):(\d{2})$/i.exec(String(text || '').trim());
  if (!m) return fallback ? fallback.at : 0;
  const nowL = local(tz, Date.now());
  let day = nowL.day;
  if (/tomorrow/i.test(m[1])) day = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  const hh = Math.min(23, +m[2]), mm = Math.min(59, +m[3]);
  if (hh < 7 || hh > 20) return fallback ? fallback.at : 0;
  return fromLocal(tz, day, hh, mm);
}

// From the end of a call: the caller asked to be called back.
export async function createCallback(env, line, call, note, slot) {
  if (!line || callbacksOff(line) || !note || note.callbackWanted !== true) return null;
  const phone = E164.test(note.callback || '') ? note.callback : (E164.test(call.caller || '') ? call.caller : '');
  if (!phone) return null;
  await ensureCallbacks(env);
  const tz = await tzFor(env, line.client_id);
  const due = dueFromNote(tz, note.callbackAt, slot) || (slot && slot.at) || (Date.now() + 3600e3);
  const r = await env.DB.prepare('INSERT INTO callbacks (client_id, call_sid, phone, name, reason, due_at, status, created, urgent) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
    .bind(line.client_id, call.id || '', phone, String(note.name || '').slice(0, 60), String(note.reason || '').slice(0, 80), new Date(due).toISOString(), 'pending', new Date().toISOString(), note.urgent ? 1 : 0).run();
  return r && r.meta ? r.meta.last_row_id : null;
}

function fmtPhone(p) { const d = ph10(p); return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; }

// For the app: today's promises and anything overdue.
export async function callbackState(env, cid) {
  await ensureCallbacks(env);
  const tz = await tzFor(env, cid);
  const rows = ((await env.DB.prepare("SELECT * FROM callbacks WHERE client_id = ?1 AND status IN ('pending','missed','asap','noanswer') AND created > ?2 ORDER BY due_at LIMIT 12").bind(cid, new Date(Date.now() - 3 * 864e5).toISOString()).all()).results) || [];
  const out = rows.map(r => {
    const l = local(tz, Date.parse(r.due_at)), today = local(tz, Date.now()).day;
    return { id: r.id, name: r.name || '', phone: r.phone, phoneText: fmtPhone(r.phone), reason: r.reason || '', dueAt: r.due_at, dueText: (l.day === today ? '' : (l.wd + ' ')) + sayTime(l.hour, l.minute), status: r.status, urgent: !!+r.urgent, note: r.note || '' };
  });
  const doneToday = await env.DB.prepare("SELECT COUNT(*) AS n FROM callbacks WHERE client_id = ?1 AND status = 'done' AND created > ?2").bind(cid, new Date(Date.now() - 864e5).toISOString()).first().catch(() => null);
  return { list: out, doneToday: +(doneToday && doneToday.n) || 0 };
}

// App: POST /api/callbacks { action: 'done' | 'later' | 'busy', id?, until? }
export async function apiCallbacks(req, env, c, line) {
  await ensureCallbacks(env);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const cid = c.client_id;
  if (b.action === 'busy') {
    // "On a job until 3:00": Max offers times after that for the rest of today.
    const v = String(b.until || '').trim();
    if (v && !/^\d{1,2}:\d{2}$/.test(v)) return { ok: false, error: 'Give a time like 15:00.' };
    const raw = await env.DB.prepare('SELECT number, owner_set FROM voice_lines WHERE client_id = ?1 LIMIT 1').bind(cid).first();
    if (!raw) return { ok: false, error: 'No phone line yet.' };
    let o = {}; try { o = JSON.parse(raw.owner_set || '{}'); } catch (e) {}
    if (v) o.busyUntil = { v, day: local(await tzFor(env, cid), Date.now()).day }; else delete o.busyUntil;
    await env.DB.prepare('UPDATE voice_lines SET owner_set = ?1 WHERE number = ?2').bind(JSON.stringify(o), raw.number).run();
    return { ok: true, message: v ? 'Max will offer call-backs after ' + v + '.' : 'Cleared.' };
  }
  const id = +b.id || 0;
  const row = id ? await env.DB.prepare('SELECT * FROM callbacks WHERE id = ?1 AND client_id = ?2').bind(id, cid).first() : null;
  if (!row) return { ok: false, error: 'Not found.' };
  if (b.action === 'done') {
    await env.DB.prepare("UPDATE callbacks SET status = 'done' WHERE id = ?1").bind(id).run();
    await logAct(env, c, 'Called ' + (row.name || fmtPhone(row.phone)) + ' back').catch(() => {});
    return { ok: true, message: 'Marked done.' };
  }
  if (b.action === 'later') {
    const due = Math.max(Date.now(), Date.parse(row.due_at)) + 30 * 60e3;
    await env.DB.prepare("UPDATE callbacks SET due_at = ?1, status = 'pending', nudged_at = '' WHERE id = ?2").bind(new Date(due).toISOString(), id).run();
    const tz = await tzFor(env, cid), l = local(tz, due);
    const told = line && !+line.regulated ? await placeCall(env, line, Object.assign({}, row, { due_at: new Date(due).toISOString() }), 'later', { newText: spokenTime(l.hour, roundQ(l.minute)) }) : { ok: false, why: 'regulated' };
    return { ok: true, message: told.ok ? 'Moved to ' + sayTime(l.hour, l.minute) + '. Max is letting them know.' : 'Moved to ' + sayTime(l.hour, l.minute) + '. Let them know if you can.' };
  }
  return { ok: false, error: 'Bad request' };
}
function roundQ(m) { return Math.round(m / 15) * 15 % 60; }

// ---------- outbound calls ----------
async function callOptedOut(env, cid, phone) {
  const p10 = ph10(phone);
  const a = await env.DB.prepare('SELECT 1 AS x FROM call_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, p10).first().catch(() => null);
  if (a) return true;
  const b = await env.DB.prepare('SELECT 1 AS x FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 AND optout = 1').bind(cid, p10).first().catch(() => null);
  return !!b;
}
// No outbound call between 9 PM and 8 AM: in the business's zone, and in the customer's own (by their area code) when that
// is a different one. Area codes that cross a zone line are checked on both sides.
export function callHoursOk(tz, at, phone) {
  const t = at || Date.now(), ok = z => { const h = local(z, t).hour; return h >= 8 && h < 21; };
  if (!ok(tz)) return false;
  for (const z of zonesOfNumber(phone)) if (z !== tz && !ok(z)) return false;
  return true;
}

// placeCall(env, line, row, kind, extra): the rules live here, not in the callers.
export async function placeCall(env, line, row, kind, extra) {
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return { ok: false, why: 'not set up' };
  if (!line || +line.regulated) return { ok: false, why: 'regulated' };
  if (!E164.test(row.phone || '') || !E164.test(line.number || '')) return { ok: false, why: 'bad number' };
  if (await callOptedOut(env, line.client_id, row.phone)) return { ok: false, why: 'opted out' };
  const tz = await tzFor(env, line.client_id);
  if (!callHoursOk(tz, Date.now(), row.phone)) return { ok: false, why: 'after hours' };
  if ((+row.attempts || 0) >= 2) return { ok: false, why: 'tried twice' };
  const q = new URLSearchParams({ id: String(row.id), k: kind, n: extra && extra.newText ? extra.newText : '' });
  const d = await dialOut(env, line, row.phone, '/voice/out/' + env.VOICE_KEY + '?' + q.toString(), '/voice/outstatus/' + env.VOICE_KEY + '?id=' + row.id);
  await env.DB.prepare("UPDATE callbacks SET attempts = attempts + 1, last_result = ?1 WHERE id = ?2").bind(d.ok ? 'calling' : 'failed: ' + String(d.why || '').slice(0, 80), row.id).run().catch(() => {});
  if (!d.ok) return d;
  const j = { sid: d.sid };
  try { await logAct(env, { client_id: line.client_id, staff: 'Max' }, 'Max called ' + (row.name || fmtPhone(row.phone)) + (kind === 'later' ? ' about the new time' : ' to set a new time')); } catch (e) {}
  return { ok: true, sid: j.sid };
}

// The one door for an outbound call. Callers check the rules first (asked for it, hours, attempts, opt-out, regulated).
export async function dialOut(env, line, to, path, statusPath) {
  const form = new URLSearchParams({ To: to, From: line.number, Url: SITE + path, Method: 'POST', StatusCallback: SITE + statusPath, StatusCallbackMethod: 'POST', Timeout: '25', MachineDetection: 'Enable' });
  let r, j = {};
  try {
    r = await fetch(TWILIO + env.TWILIO_ACCOUNT_SID + '/Calls.json', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    j = await r.json().catch(() => ({}));
  } catch (e) { return { ok: false, why: 'Twilio unreachable' }; }
  if (!r.ok || !j.sid) return { ok: false, why: String(j.message || ('Twilio answered ' + r.status)).slice(0, 120) };
  return { ok: true, sid: j.sid };
}
export { callOptedOut, fmtPhone, xml, xa };

const xa = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xml = s => new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + s + '</Response>', { headers: { 'content-type': 'text/xml' } });

// Twilio asks what to say: /voice/out/<key>?id=&k=reset|later&n=<spoken new time>
export async function outboundTwiml(env, url, form) {
  const id = +url.searchParams.get('id') || 0, kind = url.searchParams.get('k') || 'reset', newText = String(url.searchParams.get('n') || '').slice(0, 60);
  const row = id ? await env.DB.prepare('SELECT c.*, l.business, l.regulated FROM callbacks c LEFT JOIN voice_lines l ON l.client_id = c.client_id WHERE c.id = ?1').bind(id).first() : null;
  if (!row || +row.regulated) return xml('<Hangup/>');
  if (String(form.get('AnsweredBy') || '').startsWith('machine')) {
    await env.DB.prepare("UPDATE callbacks SET last_result = 'voicemail' WHERE id = ?1").bind(id).run().catch(() => {});
    return xml('<Say>Hello, this is Max, the automated assistant for ' + xa(row.business) + '. He got held up and could not call when he said. He will try you again as soon as he is free. Sorry about that. Goodbye.</Say><Hangup/>');
  }
  const first = (row.name ? 'Hi ' + xa(row.name.split(' ')[0]) + '. ' : 'Hi. ') + 'This is Max, the automated assistant for ' + xa(row.business) + '. This call may be recorded. ';
  const act = SITE + '/voice/outg/' + env.VOICE_KEY + '?id=' + id + '&k=' + kind;
  if (kind === 'later') {
    return xml('<Gather input="dtmf speech" numDigits="1" timeout="5" action="' + xa(act) + '" method="POST"><Say>' + first + 'He needs about thirty more minutes, so he will call you at ' + xa(newText || 'the new time') + '. If that does not work, press 2. If you would rather not get calls like this, press 9. Otherwise, that is all. Thank you.</Say></Gather><Say>Thank you. Goodbye.</Say><Hangup/>');
  }
  return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" action="' + xa(act) + '" method="POST"><Say>' + first + 'He got held up and could not call when he said. Can he call you at ' + xa(newText || 'the next time he is free') + '? Press 1 or say yes if that works. Press 2 if you would rather he call as soon as he is free. Press 9 if you do not want any more calls like this.</Say></Gather><Say>Sorry, I did not catch that. He will call you as soon as he can. Goodbye.</Say><Hangup/>');
}

// The customer answered: /voice/outg/<key>?id=&k=
export async function outboundGather(env, url, form) {
  const id = +url.searchParams.get('id') || 0, kind = url.searchParams.get('k') || 'reset';
  const row = id ? await env.DB.prepare('SELECT * FROM callbacks WHERE id = ?1').bind(id).first() : null;
  if (!row) return xml('<Hangup/>');
  // "Sure, no problem" is a yes; an answer with both a yes and a no in it is asked once more, never taken as a no.
  const ans = readAnswer(form.get('Digits'), form.get('SpeechResult'));
  const yes = ans === 'yes', no = ans === 'no', stop = ans === 'stop';
  const who = row.name || fmtPhone(row.phone);
  if (stop) {
    await env.DB.prepare('INSERT OR REPLACE INTO call_optout (client_id, phone10, at) VALUES (?1,?2,?3)').bind(row.client_id, ph10(row.phone), new Date().toISOString()).run();
    await env.DB.prepare("UPDATE callbacks SET status = 'optout', last_result = 'asked not to be called' WHERE id = ?1").bind(id).run();
    await pushClient(env, row.client_id, { aps: { alert: { title: who + ' asked not to be called', body: 'Max will not call them again. Call them yourself if you still need to.' }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
    return xml('<Say>Understood. No more calls like this. Goodbye.</Say><Hangup/>');
  }
  if (no) {
    await env.DB.prepare("UPDATE callbacks SET status = 'asap', last_result = 'wants a call as soon as possible' WHERE id = ?1").bind(id).run();
    await pushClient(env, row.client_id, { aps: { alert: { title: who + ' wants a call as soon as you are free', body: (row.reason || 'They are waiting on you') + '. Tap to see the number.' }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
    return xml('<Say>Got it. He will call you as soon as he is free. Thank you. Goodbye.</Say><Hangup/>');
  }
  if (kind === 'later') return xml('<Say>Thank you. Goodbye.</Say><Hangup/>');
  if (yes) {
    await env.DB.prepare("UPDATE callbacks SET status = 'pending', nudged_at = '', last_result = 'agreed to the new time' WHERE id = ?1").bind(id).run();
    const tz = await tzFor(env, row.client_id), l = local(tz, Date.parse(row.due_at));
    await pushClient(env, row.client_id, { aps: { alert: { title: who + ' said ' + sayTime(l.hour, l.minute) + ' works', body: 'Max set it up. You will get a nudge before.' }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
    return xml('<Say>Good. He will call you then. Thank you. Goodbye.</Say><Hangup/>');
  }
  if (ans === 'unclear' && url.searchParams.get('a') !== '1') {
    const act = SITE + '/voice/outg/' + env.VOICE_KEY + '?id=' + id + '&k=' + kind + '&a=1';
    return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" action="' + xa(act) + '" method="POST"><Say>Sorry, just so I have it right: press 1 if that time works, or press 2 if you would rather he call as soon as he is free.</Say></Gather><Say>Sorry, I did not catch that. He will call you as soon as he can. Goodbye.</Say><Hangup/>');
  }
  return xml('<Say>Sorry, I did not catch that. He will call you as soon as he can. Goodbye.</Say><Hangup/>');
}

export async function outboundStatus(env, url, form) {
  const id = +url.searchParams.get('id') || 0, st = String(form.get('CallStatus') || '');
  if (id && /^(no-answer|busy|failed|canceled)$/.test(st)) {
    await env.DB.prepare("UPDATE callbacks SET last_result = ?1, status = CASE WHEN status = 'missed' THEN 'noanswer' ELSE status END WHERE id = ?2").bind(st, id).run().catch(() => {});
    const row = await env.DB.prepare('SELECT * FROM callbacks WHERE id = ?1').bind(id).first();
    if (row && row.status === 'noanswer') await pushClient(env, row.client_id, { aps: { alert: { title: 'Call ' + (row.name || fmtPhone(row.phone)) + ' back', body: 'Max tried to reach them and could not. ' + (row.reason || '') }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
  }
  return new Response('ok');
}

// Every 10 minutes: nudge the owner before a promise, and when one is missed, have Max set a new time.
export async function callbackCron(env) {
  await ensureCallbacks(env);
  const now = Date.now();
  const soon = ((await env.DB.prepare("SELECT * FROM callbacks WHERE status = 'pending' AND nudged_at = '' AND due_at <= ?1 ORDER BY due_at LIMIT 50").bind(new Date(now + NUDGE_MIN * 60e3).toISOString()).all()).results) || [];
  for (const r of soon) {
    const tz = await tzFor(env, r.client_id), l = local(tz, Date.parse(r.due_at));
    await pushClient(env, r.client_id, { aps: { alert: { title: (r.name || fmtPhone(r.phone)) + ' at ' + sayTime(l.hour, l.minute), body: (r.reason ? r.reason + '. ' : '') + 'You said you would call. Tap when it is done.' }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
    await env.DB.prepare("UPDATE callbacks SET nudged_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), r.id).run();
  }
  const late = ((await env.DB.prepare("SELECT c.*, l.number, l.business, l.regulated, l.owner_set FROM callbacks c LEFT JOIN voice_lines l ON l.client_id = c.client_id WHERE c.status = 'pending' AND c.due_at < ?1 ORDER BY c.due_at LIMIT 30").bind(new Date(now - GRACE_MIN * 60e3).toISOString()).all()).results) || [];
  let called = 0;
  for (const r of late) {
    await env.DB.prepare("UPDATE callbacks SET status = 'missed' WHERE id = ?1").bind(r.id).run();
    const tz = await tzFor(env, r.client_id);
    const slot = proposeSlot(tz, now, busyFromLine(r, tz));
    const line = r.number ? { client_id: r.client_id, number: r.number, business: r.business, regulated: r.regulated, owner_set: r.owner_set } : null;
    // Reset only once from the cron; a second attempt comes from Twilio's own retry rules (no-answer leaves it for the owner).
    const res = line && +r.attempts === 0 ? await placeCall(env, line, Object.assign({}, r, { due_at: new Date(slot.at).toISOString() }), 'reset', { newText: slot.spoken }) : { ok: false, why: line ? 'tried' : 'no line' };
    if (res.ok) { called++; await env.DB.prepare('UPDATE callbacks SET due_at = ?1 WHERE id = ?2').bind(new Date(slot.at).toISOString(), r.id).run(); }
    await pushClient(env, r.client_id, { aps: { alert: { title: 'You missed ' + (r.name || fmtPhone(r.phone)), body: res.ok ? 'Max is calling them now to offer ' + slot.text + '.' : 'Call them back when you can. ' + (r.reason || '') }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' }).catch(() => {});
  }
  return { nudged: soon.length, missed: late.length, called };
}
