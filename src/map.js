// The Always Open map (/map): a public map of the businesses we work for.
// Rules: only active clients; listed by default except regulated businesses (insurance, medical, legal), who are listed only if they
// turn it on; anyone can turn it off in the app. Only what the owner gave us is shown: name, type, town, hours, and a phone number
// or street address only if the owner added one for the map. Nothing from Google is shown here (Google's terms don't allow its
// content on a non-Google map). The list is sorted by distance only, never by plan or payment. A viewer's location is used for
// one request and never stored. An area with fewer than 5 listed businesses within about 50 miles shows "Coming to your area".
import { publicLines } from './answerrate.js';
const MIN_NEARBY = 5;
const RADIUS_MI = 50;
const UA = 'AlwaysOpen map (hello@alwaysopenoffice.com)';
const DEMO = 'demo-plumbing';
let ready = false;

export async function ensureMap(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS map_listing (client_id TEXT PRIMARY KEY, show INTEGER, phone TEXT DEFAULT '', address TEXT DEFAULT '', lat REAL, lng REAL, exact INTEGER DEFAULT 0, geo_q TEXT DEFAULT '', geo_at TEXT DEFAULT '', updated TEXT DEFAULT '')").run();
  ready = true;
}

// Listed unless they turned it off; regulated businesses only when they turned it on.
export function isListed(row) {
  if (row.show === 0 || row.show === '0') return false;
  if (row.show === 1 || row.show === '1') return true;
  return !+row.regulated;
}

async function eligible(env) {
  await ensureMap(env);
  let rows = [];
  try {
    rows = (await env.DB.prepare(
      "SELECT c.client_id, c.business, c.ref, c.regulated, b.status AS bstatus, b.town AS btown, b.type AS btype, m.show, m.phone AS mphone, m.address, m.lat, m.lng, m.exact, m.geo_q, m.geo_at, " +
      "(SELECT v.town FROM voice_lines v WHERE v.client_id = c.client_id ORDER BY v.number LIMIT 1) AS vtown, " +
      "(SELECT v.industry FROM voice_lines v WHERE v.client_id = c.client_id ORDER BY v.number LIMIT 1) AS vind, " +
      "(SELECT v.facts FROM voice_lines v WHERE v.client_id = c.client_id ORDER BY v.number LIMIT 1) AS vfacts, " +
      "(SELECT v.owner_set FROM voice_lines v WHERE v.client_id = c.client_id ORDER BY v.number LIMIT 1) AS vown " +
      "FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id LEFT JOIN map_listing m ON m.client_id = c.client_id " +
      "WHERE c.active = 1 AND c.client_id != ?1 LIMIT 5000").bind(DEMO).all()).results || [];
  } catch (e) {
    // no billing table yet (a fresh database): nobody is paying, so nobody is listed
    return [];
  }
  // A client counts when billing says they're paying, or when they turned the map on themselves (clients we bill by hand).
  return rows.filter(r => (/^(active|trialing)$/.test(r.bstatus || '') || r.show === 1 || r.show === '1') && isListed(r));
}

function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function one(s, n) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, n); }
function hoursOf(r) {
  const f = parse(r.vfacts) || {}, o = parse(r.vown) || {};
  const h = o.hours && typeof o.hours === 'object' && typeof o.hours.v === 'string' && String(o.hours.base || '') === String(f.hours || '') ? o.hours.v : f.hours;
  return one(h, 160);
}
function townOf(r) { return one(r.btown || r.vtown || '', 60); }
function kindOf(r) {
  const k = one(r.vind || r.btype || '', 40);
  return k && !/^other$/i.test(k) ? k.charAt(0).toUpperCase() + k.slice(1) : '';
}
function phoneText(d) { d = String(d || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return /^\d{10}$/.test(d) ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; }
function geoQuery(r) { const a = one(r.address, 160), t = townOf(r); return a ? a + (t && a.toLowerCase().indexOf(t.toLowerCase().split(',')[0]) < 0 ? ', ' + t : '') : t; }

// Town-level pins are moved a short, fixed distance so businesses in the same town don't sit on one spot.
function nudge(id, lat, lng) {
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * Math.PI / 180, mi = 0.6 + ((h >> 9) % 90) / 100;
  return [lat + (mi / 69) * Math.sin(ang), lng + (mi / (69 * Math.cos(lat * Math.PI / 180))) * Math.cos(ang)];
}
export function milesBetween(a, b, c, d) {
  const R = 3958.8, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// What the public sees for one business.
function card(r, from) {
  const exact = !!+r.exact;
  const [lat, lng] = exact ? [+r.lat, +r.lng] : nudge(r.client_id, +r.lat, +r.lng);
  const out = { id: r.ref || r.client_id, name: one(r.business, 80), kind: kindOf(r), town: townOf(r), hours: hoursOf(r), lat: +lat.toFixed(5), lng: +lng.toFixed(5), exact };
  const ph = phoneText(r.mphone);
  if (ph) { out.phone = ph; out.tel = '+1' + String(r.mphone).replace(/\D/g, '').slice(-10); }
  if (exact && r.address) out.address = one(r.address, 160);
  if (r.ref) out.request = '/q/' + encodeURIComponent(r.ref);
  if (from) out.miles = Math.round(milesBetween(from[0], from[1], +r.lat, +r.lng) * 10) / 10;
  return out;
}

export async function nearby(env, lat, lng, preview) {
  const all = (await eligible(env)).filter(r => r.lat != null && r.lng != null && isFinite(+r.lat) && isFinite(+r.lng));
  // Preview (the owner's private link): every listed business, no radius, no 5-nearby rule. The public never sees this.
  const near = all.map(r => ({ r, d: milesBetween(lat, lng, +r.lat, +r.lng) })).filter(x => preview || x.d <= RADIUS_MI).sort((a, b) => a.d - b.d || String(a.r.business).localeCompare(String(b.r.business)));
  if (!preview && near.length < MIN_NEARBY) return { ok: true, enough: false };
  if (preview && !near.length) return { ok: true, enough: false, preview: true };
  const top = near.slice(0, 200);
  let lines = {}; try { lines = await publicLines(env, top.map(x => x.r.client_id)); } catch (e) {}
  return { ok: true, enough: true, radius: RADIUS_MI, businesses: top.map(x => { const o = card(x.r, [lat, lng]); if (lines[x.r.client_id]) o.answered = lines[x.r.client_id]; return o; }) };
}

// GET /api/map?lat=&lng= (from "Near me"), or without them the rough area Cloudflare already knows for this request.
export async function handleMapApi(req, env, url, ctx) {
  if (req.method !== 'GET') return j({ ok: false, error: 'GET only' }, 405);
  let lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng')), approx = false;
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    const cf = req.cf || {};
    lat = parseFloat(cf.latitude); lng = parseFloat(cf.longitude); approx = true;
  }
  if (!isFinite(lat) || !isFinite(lng)) return j({ ok: true, enough: false, approx: true });
  // Round to about a quarter degree: the answer is cached per area, and nothing finer than that is ever used or kept.
  const rl = Math.round(lat * 4) / 4, rg = Math.round(lng * 4) / 4;
  const pv = url.searchParams.get('preview') || '';
  if (pv) { const want = (await previewKey(env)); if (want && pv.length === want.length && [...pv].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0) { const out = await nearby(env, rl, rg, true); out.preview = true; out.approx = approx; return j(out, 200, 0); } }
  const key = new Request('https://alwaysopenoffice.com/__map/' + rl + ',' + rg);
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return withApprox(hit, approx); }
  const out = await nearby(env, rl, rg);
  const res = j(out, 200, 600);
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
  return withApprox(res, approx);
}
async function withApprox(res, approx) {
  const o = await res.clone().json();
  o.approx = approx;
  return j(o, 200, 0);
}
// The owner's private preview key: a short digest of the ops key, never the key itself.
export async function previewKey(env) {
  if (!env.LEADS_KEY) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('map-preview:' + env.LEADS_KEY));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
function j(o, status, maxAge) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? 'public, max-age=' + maxAge : 'no-store', 'x-content-type-options': 'nosniff' } });
}

// ---------- the owner's switch (web app and iPhone app) ----------
export async function mapState(env, c) {
  await ensureMap(env);
  const m = await env.DB.prepare('SELECT * FROM map_listing WHERE client_id = ?1').bind(c.client_id).first();
  const row = Object.assign({ regulated: c.regulated }, m || {});
  return { show: isListed(row), regulated: !!+c.regulated, phone: phoneText(m && m.phone), address: one(m && m.address, 160), placed: !!(m && m.lat != null) };
}
export async function apiMap(req, env, c) {
  if (c.staff) return j({ ok: false, error: 'Only the owner can change this.' }, 403);
  await ensureMap(env);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const cur = await env.DB.prepare('SELECT * FROM map_listing WHERE client_id = ?1').bind(c.client_id).first() || {};
  let show = cur.show == null ? null : +cur.show, phone = cur.phone || '', address = cur.address || '';
  if (typeof b.show === 'boolean') show = b.show ? 1 : 0;
  if (b.phone != null) {
    const d = String(b.phone).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d && !/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return j({ ok: false, error: 'Add a 10-digit business number, or leave it blank.' }, 422);
    phone = d;
  }
  if (b.address != null) address = one(b.address, 160);
  const moved = address !== (cur.address || '');
  await env.DB.prepare('INSERT INTO map_listing (client_id, show, phone, address, lat, lng, exact, geo_q, geo_at, updated) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 0, \'\', \'\', ?5) ' +
    'ON CONFLICT(client_id) DO UPDATE SET show = excluded.show, phone = excluded.phone, address = excluded.address, updated = excluded.updated' + (moved ? ", lat = NULL, lng = NULL, exact = 0, geo_q = ''" : ''))
    .bind(c.client_id, show, phone, address, new Date().toISOString()).run();
  return j({ ok: true, map: await mapState(env, c) }, 200);
}

// ---------- placing businesses on the map (every 10 minutes, a few at a time) ----------
// Street addresses: the U.S. Census geocoder (public domain). Towns: OpenStreetMap's Nominatim (one request a second at most).
export async function mapCron(env, opts) {
  const fetcher = (opts && opts.fetch) || fetch;
  const day = new Date(Date.now() - 86400000).toISOString();
  // New or moved businesses; a town we couldn't find is tried again once a day, not every run.
  const rows = (await eligible(env)).filter(r => { const q = geoQuery(r); return q && (r.geo_q !== q || (r.lat == null && (r.geo_at || '') < day)); });
  let placed = 0;
  for (const r of rows.slice(0, 3)) {
    const q = geoQuery(r);
    let hit = null, exact = 0;
    try {
      if (r.address) {
        const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
        const x = await (await fetcher(u, { headers: { 'User-Agent': UA } })).json();
        const m = x && x.result && x.result.addressMatches && x.result.addressMatches[0];
        if (m && m.coordinates) { hit = [+m.coordinates.y, +m.coordinates.x]; exact = 1; }
      }
      if (!hit) {
        const t = townOf(r);
        if (t) {
          const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(t);
          const x = await (await fetcher(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })).json();
          if (x && x[0] && isFinite(+x[0].lat)) hit = [+x[0].lat, +x[0].lon];
          if (!(opts && opts.fast)) await new Promise(ok => setTimeout(ok, 1100));
        }
      }
    } catch (e) { hit = null; }
    await env.DB.prepare('INSERT INTO map_listing (client_id, show, lat, lng, exact, geo_q, geo_at, updated) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(client_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, exact = excluded.exact, geo_q = excluded.geo_q, geo_at = excluded.geo_at')
      .bind(r.client_id, hit ? hit[0] : null, hit ? hit[1] : null, exact, q, new Date().toISOString()).run();
    if (hit) placed++;
  }
  return { tried: Math.min(rows.length, 3), placed };
}

// For the ops board (HQ): every active client, whether they're on the map, and a switch.
export async function mapAdmin(env) {
  await ensureMap(env);
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT c.client_id, c.business, c.regulated, b.status AS bstatus, m.show, m.lat FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id LEFT JOIN map_listing m ON m.client_id = c.client_id WHERE c.active = 1 AND c.client_id != ?1 ORDER BY c.business LIMIT 500").bind(DEMO).all()).results || [];
  } catch (e) {
    rows = (await env.DB.prepare("SELECT c.client_id, c.business, c.regulated, '' AS bstatus, m.show, m.lat FROM app_clients c LEFT JOIN map_listing m ON m.client_id = c.client_id WHERE c.active = 1 AND c.client_id != ?1 ORDER BY c.business LIMIT 500").bind(DEMO).all()).results || [];
  }
  return rows.map(r => {
    const paying = /^(active|trialing)$/.test(r.bstatus || '');
    const listed = isListed(r) && (paying || r.show === 1 || r.show === '1');
    return { id: r.client_id, business: r.business || r.client_id, regulated: !!+r.regulated, listed, placed: r.lat != null, paying };
  });
}
export async function setShow(env, cid, show) {
  await ensureMap(env);
  const v = show === true ? 1 : (show === false ? 0 : null);
  await env.DB.prepare('INSERT INTO map_listing (client_id, show, updated) VALUES (?1, ?2, ?3) ON CONFLICT(client_id) DO UPDATE SET show = excluded.show, updated = excluded.updated').bind(cid, v, new Date().toISOString()).run();
  return true;
}
