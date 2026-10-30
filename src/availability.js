// Booking with or without a calendar. Max offers real open times from the owner's own hours (and their Google Calendar,
// when it is connected), two at a time, and books one in our own book of visits so two callers can never get the same time.
//   mode 'book': Max books it and the caller hears it is booked.
//   mode 'hold': Max pencils it in and the team confirms by text (the default until the owner chooses).
//   mode 'off':  Max takes their preferred time as a message, as before.
// Settings live in the line's owner_set.book: { mode, slotMin, bufferMin, days: { Mon: [openMinute, closeMinute], ... } }.
import { busyTimes, bookSlot as calendarBook, spokenSlot } from './gcal.js';
import { tzFor, local, fromLocal, zoneOk } from './callbacks.js';

const DAY = 864e5;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEAD_MS = 2 * 3600e3;         // never a time sooner than two hours from now
const SPREAD_MS = 2 * 3600e3;       // offered times at least two hours apart
export const DEFAULT_DAYS = { Mon: [480, 1020], Tue: [480, 1020], Wed: [480, 1020], Thu: [480, 1020], Fri: [480, 1020] };
const parse = s => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };

const ready = new WeakSet();
export async function ensureBookings(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS line_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '', reason TEXT DEFAULT '', status TEXT DEFAULT 'booked', call_id TEXT DEFAULT '', say TEXT DEFAULT '', created TEXT, updated TEXT)").run();
  // One live booking per start time per business: the second caller to grab a time loses, even mid-race.
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS line_bookings_slot ON line_bookings (client_id, start) WHERE status != 'cancelled'").run();
  ready.add(env.DB);
}

// "Mon to Fri 7 to 6, Sat 8 to 12" -> { Mon: [420, 1080], ..., Sat: [480, 720] }. Null when nothing readable.
export function parseHours(text) {
  const t = String(text || '').toLowerCase().replace(/noon/g, '12pm').replace(/midnight/g, '12am');
  if (!t.trim()) return null;
  const DAYRE = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\.?';
  const out = {};
  let any = false, lastDays = null;
  for (const seg of t.split(/[,;\n]|\band\b/)) {
    if (/closed/.test(seg) && !/\d/.test(seg)) continue;
    const dm = new RegExp(DAYRE + '(?:\\s*(?:-|–|to|through|thru)\\s*' + DAYRE + ')?').exec(seg);
    const tm = /(\d{1,2})(?::(\d\d))?\s*(a\.?m\.?|p\.?m\.?|a|p)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d\d))?\s*(a\.?m\.?|p\.?m\.?|a|p)?/.exec(seg);
    let days = null;
    if (dm) {
      const a = WD.findIndex(d => d.toLowerCase() === dm[1]), b = dm[2] ? WD.findIndex(d => d.toLowerCase() === dm[2]) : a;
      days = []; for (let i = a; ; i = (i + 1) % 7) { days.push(WD[i]); if (i === b || days.length > 7) break; }
    }
    if (!tm) { if (days) lastDays = days; continue; }
    if (!days) days = lastDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    let oh = +tm[1], om = +(tm[2] || 0), ch = +tm[4], cm = +(tm[5] || 0);
    const ap = x => (x || '').replace(/\./g, '')[0] || '';
    const oa = ap(tm[3]), ca = ap(tm[6]);
    if (oa === 'p' && oh < 12) oh += 12; if (oa === 'a' && oh === 12) oh = 0;
    if (ca === 'p' && ch < 12) ch += 12; if (ca === 'a' && ch === 12) ch = 0;
    if (!oa && oh < 6) oh += 12;                         // "1 to 5" means afternoon
    if (!ca && ch <= oh && ch < 12) ch += 12;            // "7 to 6" closes at 6 PM
    const o = oh * 60 + om, c = ch * 60 + cm;
    if (!(c > o) || o < 0 || c > 24 * 60) continue;
    for (const d of days) out[d] = [o, c];
    any = true; lastDays = days;
  }
  return any ? out : null;
}

// The owner's booking settings, filled in from their hours and sensible defaults.
export function bookingOf(line) {
  const o = parse(line && line.owner_set), b = o.book && typeof o.book === 'object' ? o.book : {};
  const f = parse(line && line.facts);
  const regulated = !!+(line && line.regulated);
  const mode = regulated ? 'off' : (b.mode === 'book' || b.mode === 'hold' || b.mode === 'off' ? b.mode : 'hold');
  const days = validDays(b.days) || parseHours(f.hours) || DEFAULT_DAYS;
  return { mode, slotMin: clamp(+b.slotMin || 60, 15, 480), bufferMin: clamp(b.bufferMin == null ? 30 : +b.bufferMin, 0, 240), days, set: !!b.mode };
}
export function validDays(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of WD) { const v = d[k]; if (Array.isArray(v) && v.length === 2 && +v[0] >= 0 && +v[1] <= 1440 && +v[1] > +v[0]) out[k] = [Math.round(+v[0]), Math.round(+v[1])]; }
  return Object.keys(out).length ? out : null;
}
function clamp(x, a, b) { return Math.max(a, Math.min(b, isFinite(x) ? x : a)); }

// Open times over the next week, at most `max`, spread at least two hours apart. Null when booking is off.
export async function slotsFor(env, line, now, max) {
  const bk = bookingOf(line);
  if (bk.mode === 'off') return null;
  await ensureBookings(env);
  now = now || Date.now();
  const cid = line.client_id, end = now + 8 * DAY;
  // The business's own zone (stored on the line, or worked out from its town and number); a connected calendar's wins below.
  let tz = zoneOk(line.tz) ? line.tz : await tzFor(env, cid), busy = [];
  try { const cal = await busyTimes(env, cid, now, end); if (cal) { tz = cal.tz || tz; busy = cal.busy; } } catch (e) { /* no calendar: our own book only */ }
  const taken = ((await env.DB.prepare("SELECT start, end FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND end > ?2 AND start < ?3").bind(cid, now, end).all()).results) || [];
  busy = busy.concat(taken.map(r => [+r.start, +r.end]));
  const len = bk.slotMin * 60000, gap = bk.bufferMin * 60000, out = [];
  for (let d = 0; d < 8 && out.length < (max || 6); d++) {
    const day = local(tz, now + d * DAY);
    const hours = bk.days[day.wd];
    if (!hours) continue;
    for (let t = hours[0]; t + bk.slotMin <= hours[1] && out.length < (max || 6); t += 30) {
      const start = fromLocal(tz, day.day, Math.floor(t / 60), t % 60), stop = start + len;
      if (start < now + LEAD_MS) continue;
      if (busy.some(b => b[0] < stop + gap && b[1] > start - gap)) continue;
      if (out.length && start - out[out.length - 1].start < SPREAD_MS) continue;
      out.push({ start, end: stop, say: spokenSlot(tz, start) });
    }
  }
  return { tz, mode: bk.mode, slots: out };
}

// Book (or pencil in) one time for a caller. Returns { ok, held, taken }.
export async function bookFor(env, line, slot, who) {
  const bk = bookingOf(line);
  if (bk.mode === 'off') return { ok: false };
  await ensureBookings(env);
  const cid = line.client_id, ts = new Date().toISOString(), held = bk.mode === 'hold';
  let r;
  try {
    r = await env.DB.prepare("INSERT INTO line_bookings (client_id, start, end, name, phone, reason, status, call_id, say, created, updated) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)")
      .bind(cid, slot.start, slot.end, String(who.name || '').slice(0, 60), String(who.phone || '').slice(0, 20), String(who.reason || '').slice(0, 120), held ? 'held' : 'booked', String(who.callId || ''), slot.say, ts).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return { ok: false, taken: true };
    throw e;
  }
  const id = r.meta.last_row_id;
  // On the owner's calendar too, when connected (best effort: our own book is what stops double-booking).
  if (!held) { try { await calendarBook(env, cid, slot, { name: who.name, phone: who.phone, reason: who.reason }); } catch (e) { /* noted in our book */ } }
  // The job card: booked (or still new, for a time the team has to confirm), with the time in its title.
  try {
    const { ensureBiz } = await import('./biz.js'); await ensureBiz(env);
    const title = (String(who.reason || 'Visit').slice(0, 120) + ' (' + slot.say + (held ? ', to confirm' : '') + ')').slice(0, 200);
    if (who.callId) {
      await env.DB.prepare("INSERT INTO biz_jobs (client_id, name, phone, title, stage, source, source_id, created, updated) VALUES (?1,?2,?3,?4,?5,'call',?6,?7,?7) ON CONFLICT(client_id, source, source_id) DO UPDATE SET title = excluded.title, stage = excluded.stage, name = CASE WHEN biz_jobs.name = '' THEN excluded.name ELSE biz_jobs.name END, updated = excluded.updated")
        .bind(cid, String(who.name || '').slice(0, 80), String(who.phone || '').slice(0, 20), title, held ? 'new' : 'booked', who.callId, ts).run();
    }
  } catch (e) { /* the booking stands without the card */ }
  return { ok: true, held, id };
}

// The owner cancels a visit Max booked (from the job card): the time opens up again.
export async function cancelForCall(env, cid, callId) {
  await ensureBookings(env);
  const b = await env.DB.prepare("SELECT * FROM line_bookings WHERE client_id = ?1 AND call_id = ?2 AND status != 'cancelled' ORDER BY id DESC LIMIT 1").bind(cid, callId).first();
  if (!b) return null;
  await env.DB.prepare("UPDATE line_bookings SET status = 'cancelled', updated = ?1 WHERE id = ?2").bind(new Date().toISOString(), b.id).run();
  return b;
}

// For the app: the settings as the owner sees them.
export function bookingOut(line) {
  const b = bookingOf(line);
  return { mode: b.mode, slotMin: b.slotMin, bufferMin: b.bufferMin, days: b.days, set: b.set };
}
// Clean what the owner set in the app.
export function cleanBooking(x, cur) {
  const out = Object.assign({}, cur || {});
  if (x.mode === 'book' || x.mode === 'hold' || x.mode === 'off') out.mode = x.mode;
  if (x.slotMin != null) out.slotMin = clamp(Math.round(+x.slotMin), 15, 480);
  if (x.bufferMin != null) out.bufferMin = clamp(Math.round(+x.bufferMin), 0, 240);
  if (x.days !== undefined) { const d = validDays(x.days); if (d) out.days = d; else delete out.days; }
  return out;
}
