// Our own copy of the National Do Not Call Registry (Nov 10, 2026).
//
// Always Open is registered with the FTC as an Exempt Organization: Outreach calls only businesses, and Max's other calls
// go only to people who asked for them or agreed to them. An exempt organization gets the whole national list free, so
// the paid check (DNCScrub) is not needed (Christopher, Nov 10: "eww no dnc scrub costs money"). Once a month he downloads
// the full list (every area code, one file) at telemarketing.donotcall.gov and double-clicks "Load Do Not Call list" on
// the Mac (tools/dncload.mjs), which sends it here one area code at a time (POST /ops/dnc-list, with the ops key).
//
// How it is kept: a US area code has 8,000,000 possible numbers (exchanges 200-999, lines 0000-9999). For each area code
// and exchange hundred (the 2xx exchanges, the 3xx exchanges, ...) one row holds a bitmap of its 1,000,000 numbers, one
// bit each, set when the number is on the registry, deflated (125,000 bytes raw, mostly 10-60 KB stored). Checking a
// number reads one row. Every row carries the date of the FTC file it came from. No row, a row that can't be read, or a
// row more than 30 days old means "not checked", and Outreach never calls a number that isn't checked. (The FTC's safe
// harbor asks for a version of the registry no more than 31 days old; a day is kept in hand.)
//
// The registry may be used only to prevent calls. This copy is never shown or sent anywhere: the one question it answers
// is whether a number Outreach is about to call is on it.
import { ph10 } from './callbacks.js';

export const DNC_MAX_DAYS = 30;
export const DNC_DUE_DAYS = 24;           // from here Christopher is reminded (once a day, only while Outreach is in use)
export const SLICE_NUMBERS = 1000000;     // 100 exchanges x 10,000 lines
export const SLICE_BYTES = SLICE_NUMBERS / 8;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const readyDBs = new WeakSet();
export async function ensureDncList(env) {
  if (readyDBs.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS dnc_slices (ac INTEGER NOT NULL, h INTEGER NOT NULL, z BLOB NOT NULL, n INTEGER NOT NULL DEFAULT 0, as_of TEXT NOT NULL, load_id TEXT, at TEXT, PRIMARY KEY (ac, h))'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS dnc_loads (id TEXT PRIMARY KEY, as_of TEXT NOT NULL, started TEXT, finished TEXT DEFAULT '', area_codes INTEGER DEFAULT 0, numbers INTEGER DEFAULT 0)")
  ]);
  readyDBs.add(env.DB);
}

// The date in New York (the FTC's day), as YYYY-MM-DD.
export function nyYmd(at) {
  const o = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))) o[x.type] = x.value;
  return o.year + '-' + o.month + '-' + o.day;
}
// Whole days from the list's date to the day of the call.
export function ageDays(asOf, now) {
  if (!YMD.test(String(asOf || ''))) return Infinity;
  return Math.round((Date.parse(nyYmd(now) + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86400000);
}

async function inflate(z) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(ds)).arrayBuffer());
}
function bytes(v) {
  if (!v) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer || Array.isArray(v)) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}
// Where a 10-digit number sits: its row (area code, exchange hundred) and its bit inside that row's bitmap.
export function place(d) {
  const ac = +d.slice(0, 3), nxx = +d.slice(3, 6), line = +d.slice(6);
  const h = Math.floor(nxx / 100);
  return { ac, h, bit: (nxx % 100) * 10000 + line };
}

// phones: any form; Map(phone10 -> { ok: true } | { ok: false, listed: true, why } | { ok: false, unknown: true, why }).
// "unknown" is never a yes: the number is simply not called until a current list says it may be.
export async function registryCheck(env, phones, now) {
  await ensureDncList(env);
  now = now || Date.now();
  const out = new Map(), groups = new Map();
  for (const p of phones) {
    const d = ph10(p); if (!d || out.has(d)) continue;
    const at = place(d);
    if (at.ac < 200 || at.h < 2) { out.set(d, { ok: false, unknown: true, why: 'not a valid US number' }); continue; }
    const k = at.ac * 10 + at.h;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([d, at]);
  }
  for (const [k, list] of groups) {
    const ac = Math.floor(k / 10), h = k % 10;
    let unknown = '', bits = null;
    try {
      const r = await env.DB.prepare('SELECT z, as_of FROM dnc_slices WHERE ac = ?1 AND h = ?2').bind(ac, h).first();
      if (!r) unknown = 'no Do Not Call list loaded for area code ' + ac;
      else if (ageDays(r.as_of, now) > DNC_MAX_DAYS) unknown = 'the Do Not Call list for area code ' + ac + ' is more than ' + DNC_MAX_DAYS + ' days old';
      else {
        bits = await inflate(bytes(r.z));
        if (bits.length !== SLICE_BYTES) { bits = null; unknown = 'the Do Not Call list for area code ' + ac + ' could not be read'; }
      }
    } catch (e) { bits = null; unknown = 'the Do Not Call list for area code ' + ac + ' could not be read'; }
    for (const [d, at] of list) {
      if (!bits) out.set(d, { ok: false, unknown: true, why: unknown });
      else if (bits[at.bit >> 3] & (1 << (at.bit & 7))) out.set(d, { ok: false, listed: true, why: 'on the national Do Not Call list' });
      else out.set(d, { ok: true });
    }
  }
  return out;
}

// What the latest finished load says: ready when it is no more than 30 days old.
export async function dncListStatus(env, now) {
  await ensureDncList(env);
  now = now || Date.now();
  const r = await env.DB.prepare("SELECT as_of, finished, area_codes, numbers FROM dnc_loads WHERE finished != '' ORDER BY as_of DESC, finished DESC LIMIT 1").first().catch(() => null);
  if (!r) return { ready: false, loaded: false, asOf: '', days: Infinity, areaCodes: 0, numbers: 0, dueBy: '' };
  const days = ageDays(r.as_of, now);
  return { ready: days <= DNC_MAX_DAYS, loaded: true, asOf: r.as_of, days, areaCodes: +r.area_codes || 0, numbers: +r.numbers || 0,
    dueBy: new Date(Date.parse(r.as_of + 'T12:00:00Z') + DNC_MAX_DAYS * 86400000).toISOString().slice(0, 10) };
}

function b64(s) {
  const bin = atob(String(s || ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// The loader's three steps (POST /ops/dnc-list, ops key). body.op:
//   begin   { asOf }                         -> { ok, id }
//   area    { id, ac, slices: [{ h, n, z }] }  one area code; z is the deflated bitmap, base64. Every exchange hundred
//                                             2-9 is sent, empty ones too, so the whole area code carries the new date.
//   finish  { id, areaCodes, numbers }       -> { ok, status }
export async function loadStep(env, body, now) {
  await ensureDncList(env);
  now = now || Date.now();
  const op = String((body && body.op) || '');
  const iso = new Date(now).toISOString();
  if (op === 'begin') {
    const asOf = String(body.asOf || '');
    if (!YMD.test(asOf)) return { ok: false, error: 'asOf must be YYYY-MM-DD' };
    const age = ageDays(asOf, now);
    if (age < -1) return { ok: false, error: 'that date is in the future' };
    if (age > DNC_MAX_DAYS) return { ok: false, error: 'that list is more than ' + DNC_MAX_DAYS + ' days old; download a new one' };
    const id = 'L' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    await env.DB.prepare('INSERT INTO dnc_loads (id, as_of, started) VALUES (?1, ?2, ?3)').bind(id, asOf, iso).run();
    return { ok: true, id };
  }
  const load = await env.DB.prepare('SELECT id, as_of, finished FROM dnc_loads WHERE id = ?1').bind(String((body && body.id) || '')).first();
  if (!load) return { ok: false, error: 'unknown load; start again' };
  if (load.finished) return { ok: false, error: 'that load is already finished' };
  if (op === 'area') {
    const ac = +body.ac;
    if (!(ac >= 200 && ac <= 999)) return { ok: false, error: 'bad area code' };
    const slices = Array.isArray(body.slices) ? body.slices : [];
    const hs = new Set(slices.map(s => +s.h));
    for (let h = 2; h <= 9; h++) if (!hs.has(h)) return { ok: false, error: 'area code ' + ac + ' is missing exchanges ' + h + 'xx' };
    const writes = [];
    for (const s of slices) {
      const h = +s.h, n = Math.max(0, Math.floor(+s.n || 0));
      if (!(h >= 0 && h <= 9) || n > SLICE_NUMBERS) return { ok: false, error: 'bad slice' };
      let z;
      try { z = b64(s.z); } catch (e) { return { ok: false, error: 'bad slice data' }; }
      // a deflated stream starts with 0x78; anything else, or something too big to be one, is refused
      if (z.length < 8 || z.length > SLICE_BYTES + 1024 || z[0] !== 0x78) return { ok: false, error: 'bad slice data' };
      writes.push(env.DB.prepare('INSERT OR REPLACE INTO dnc_slices (ac, h, z, n, as_of, load_id, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(ac, h, z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength), n, load.as_of, load.id, iso));
    }
    await env.DB.batch(writes);
    return { ok: true, ac, slices: writes.length };
  }
  if (op === 'finish') {
    const got = (await env.DB.prepare('SELECT COUNT(DISTINCT ac) AS acs, COALESCE(SUM(n), 0) AS n FROM dnc_slices WHERE load_id = ?1').bind(load.id).first()) || { acs: 0, n: 0 };
    // a load that sent far fewer area codes than it says it has (stopped halfway) is not marked finished
    const want = Math.max(0, +body.areaCodes || 0);
    if (!got.acs || got.acs < want) return { ok: false, error: 'only ' + got.acs + ' of ' + want + ' area codes arrived; run it again' };
    await env.DB.prepare('UPDATE dnc_loads SET finished = ?2, area_codes = ?3, numbers = ?4 WHERE id = ?1').bind(load.id, iso, got.acs, got.n).run();
    try { const O = await import('./ops.js'); await O.clearAlert(env, 'health:outreach-dnc', now); await O.clearAlert(env, 'health:outreach-dnc-due', now); } catch (e) { /* only notes */ }
    return { ok: true, status: await dncListStatus(env, now) };
  }
  return { ok: false, error: 'unknown step' };
}
