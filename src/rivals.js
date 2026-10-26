// Competitor watch (Growth and Pro): find a client's top nearby competitors on Google, save their public rating and review count
// once a week, and write one short, factual note about what changed. Rating and review counts only: no advice, no predictions.
// Works the same for every kind of business. Public Google data only (no reviewer names). Tables create themselves on first use.
import { places } from './audit.js';

const WEEK_CAP = 8;      // Google lookups per client per week, everything included
const MAX_RIVALS = 5;
const MIN_RIVALS = 3;
const GROWTH = c => c && (c.tier === 'Growth' || c.tier === 'Pro');
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const isoNow = () => new Date().toISOString();
const d10 = s => String(s || '').replace(/\D/g, '').slice(-10);

export function isoWeek(ms) {
  const t = new Date(ms), d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  return y + '-W' + String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0');
}

const READY = new WeakSet();
export async function ensureRivals(env) {
  if (env.DB && READY.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rival_profile (client_id TEXT PRIMARY KEY, place_id TEXT DEFAULT '', name TEXT DEFAULT '', ptype TEXT DEFAULT '', lat REAL, lng REAL, found INTEGER DEFAULT 0, tried TEXT DEFAULT '', spent_week TEXT DEFAULT '', spent INTEGER DEFAULT 0, lock TEXT DEFAULT '', updated TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rival_list (client_id TEXT NOT NULL, place_id TEXT NOT NULL, name TEXT DEFAULT '', active INTEGER DEFAULT 1, custom INTEGER DEFAULT 0, added TEXT, PRIMARY KEY (client_id, place_id))"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rival_snap (client_id TEXT NOT NULL, week TEXT NOT NULL, place_id TEXT NOT NULL, name TEXT DEFAULT \'\', own INTEGER DEFAULT 0, rating REAL, reviews INTEGER, at TEXT, PRIMARY KEY (client_id, week, place_id))')
  ]);
  if (env.DB) READY.add(env.DB);
}

// ---------------- Google lookups, with a weekly cap per client ----------------
async function spend(env, cid, week, n) {
  await env.DB.prepare('INSERT OR IGNORE INTO rival_profile (client_id, updated) VALUES (?1, ?2)').bind(cid, isoNow()).run();
  const p = await env.DB.prepare('SELECT spent_week, spent FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  const used = p && p.spent_week === week ? +p.spent || 0 : 0;
  if (used + n > WEEK_CAP) return false;
  await env.DB.prepare('UPDATE rival_profile SET spent_week = ?1, spent = ?2 WHERE client_id = ?3').bind(week, used + n, cid).run();
  return true;
}
const BUDGET = new Error('weekly lookup limit');
async function gSearch(env, cid, week, path, body, fields) {
  if (!(await spend(env, cid, week, 1))) throw BUDGET;
  return places(env, path, body, fields);
}
async function gDetails(env, cid, week, id) {
  if (!(await spend(env, cid, week, 1))) throw BUDGET;
  const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(id), {
    headers: { 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,businessStatus' }
  });
  if (!r.ok) throw new Error('Google lookup failed (' + r.status + ')');
  return r.json();
}
const FIND_FIELDS = ['id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount', 'nationalPhoneNumber', 'primaryType', 'location', 'businessStatus'];
const NEAR_FIELDS = ['id', 'displayName', 'rating', 'userRatingCount', 'businessStatus'];
const shape = p => ({ id: p.id, name: cl((p.displayName && p.displayName.text) || '', 80), rating: +p.rating || 0, reviews: +p.userRatingCount || 0 });

// A short lock so two people opening the app at once don't both start a lookup.
async function claim(env, cid) {
  await env.DB.prepare('INSERT OR IGNORE INTO rival_profile (client_id, updated) VALUES (?1, ?2)').bind(cid, isoNow()).run();
  const r = await env.DB.prepare("UPDATE rival_profile SET lock = ?1 WHERE client_id = ?2 AND (lock = '' OR lock IS NULL OR lock < ?3)").bind(isoNow(), cid, new Date(Date.now() - 120000).toISOString()).run();
  return !!(r && r.meta && r.meta.changes);
}
const unlock = (env, cid) => env.DB.prepare("UPDATE rival_profile SET lock = '' WHERE client_id = ?1").bind(cid).run().catch(() => {});

async function saveProfile(env, cid, p) {
  const loc = p.location || {};
  await env.DB.prepare("UPDATE rival_profile SET place_id = ?1, name = ?2, ptype = ?3, lat = ?4, lng = ?5, found = 1, updated = ?6 WHERE client_id = ?7")
    .bind(p.id, shape(p).name, p.primaryType || '', loc.latitude == null ? null : +loc.latitude, loc.longitude == null ? null : +loc.longitude, isoNow(), cid).run();
}

// Find the client's own Google profile. A place id in their review link is exact; otherwise business name + town, confirmed by the phone number.
async function findProfile(env, c, week) {
  const cid = c.client_id;
  let town = '', phone = d10(c.phone);
  try { const b = await env.DB.prepare('SELECT town, phone FROM billing WHERE client_id = ?1').bind(cid).first(); if (b) { town = cl(b.town, 60); if (!phone) phone = d10(b.phone); } } catch (e) { /* no billing row */ }
  const link = String(c.review_link || '');
  const pid = (link.match(/[?&]placeid=([A-Za-z0-9_-]{10,})/i) || link.match(/place_id[:=]([A-Za-z0-9_-]{10,})/i) || [])[1];
  let hit = null;
  if (pid) {
    if (!(await spend(env, cid, week, 1))) throw BUDGET;
    const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(pid), { headers: { 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': FIND_FIELDS.join(',') } });
    if (r.ok) hit = await r.json();
  }
  if (!hit && c.business) {
    const list = await gSearch(env, cid, week, 'places:searchText', { textQuery: cl(c.business, 80) + (town ? ' ' + town : ''), pageSize: 5 }, FIND_FIELDS);
    hit = list.find(p => phone && d10(p.nationalPhoneNumber) === phone) || (town ? list.find(p => String(p.formattedAddress || '').toLowerCase().includes(town.split(',')[0].trim().toLowerCase())) : null) || null;
  }
  if (!hit || !hit.id) return null;
  await saveProfile(env, cid, hit);
  return hit;
}

// Top nearby competitors of the same kind, by review count. Keeps what the owner removed removed.
async function pickRivals(env, cid, week, prof) {
  if (!prof.place_id || !prof.ptype || prof.lat == null) return [];
  const have = ((await env.DB.prepare('SELECT place_id, active FROM rival_list WHERE client_id = ?1').bind(cid).all()).results) || [];
  const known = new Set(have.map(r => r.place_id)), room = MAX_RIVALS - have.filter(r => +r.active).length;
  if (room <= 0) return [];
  const near = await gSearch(env, cid, week, 'places:searchNearby', {
    includedPrimaryTypes: [prof.ptype], maxResultCount: 20, rankPreference: 'POPULARITY',
    locationRestriction: { circle: { center: { latitude: +prof.lat, longitude: +prof.lng }, radius: 15000 } }
  }, NEAR_FIELDS);
  const out = near.filter(p => p.id && p.id !== prof.place_id && !known.has(p.id) && (!p.businessStatus || p.businessStatus === 'OPERATIONAL')).map(shape)
    .filter(x => x.name && x.reviews > 0).sort((a, b) => b.reviews - a.reviews).slice(0, room);
  for (const x of out) await env.DB.prepare('INSERT OR IGNORE INTO rival_list (client_id, place_id, name, active, custom, added) VALUES (?1, ?2, ?3, 1, 0, ?4)').bind(cid, x.id, x.name, isoNow()).run();
  return out;
}

// ---------------- the weekly snapshot ----------------
async function putSnap(env, cid, week, x, own) {
  if (!x || !x.id) return;
  await env.DB.prepare('INSERT OR REPLACE INTO rival_snap (client_id, week, place_id, name, own, rating, reviews, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(cid, week, x.id, cl(x.name, 80), own ? 1 : 0, x.rating || 0, x.reviews || 0, isoNow()).run();
}
// Takes this week's numbers once. Safe to call again: it does nothing if the week is already saved. Returns 'saved', 'have', 'profile', 'off' or 'busy'.
export async function takeSnapshot(env, c, at) {
  if (!env.PLACES_KEY || !GROWTH(c)) return 'off';
  at = at || Date.now();
  await ensureRivals(env);
  const cid = c.client_id, week = isoWeek(at);
  const have = await env.DB.prepare('SELECT 1 AS x FROM rival_snap WHERE client_id = ?1 AND week = ?2 LIMIT 1').bind(cid, week).first();
  if (have) return 'have';
  let prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  if (prof && !+prof.found && prof.tried === week) return 'profile';
  if (!(await claim(env, cid))) return 'busy';
  try {
    prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
    let me = null;
    const fresh = {};
    if (!prof || !+prof.found) {
      let hit = null;
      try { hit = await findProfile(env, c, week); } catch (e) { if (e === BUDGET) return 'busy'; throw e; }
      await env.DB.prepare('UPDATE rival_profile SET tried = ?1 WHERE client_id = ?2').bind(week, cid).run();
      if (!hit) return 'profile';
      me = shape(hit); fresh[me.id] = me;
      prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
    }
    let rivals = ((await env.DB.prepare('SELECT place_id, name FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).all()).results) || [];
    if (rivals.length < MIN_RIVALS) {
      try { for (const x of await pickRivals(env, cid, week, prof)) fresh[x.id] = x; } catch (e) { if (e !== BUDGET) throw e; }
      rivals = ((await env.DB.prepare('SELECT place_id, name FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).all()).results) || [];
    }
    const get = async (id, name) => {
      if (fresh[id]) return fresh[id];
      try { const d = await gDetails(env, cid, week, id), s = shape(d); return Object.assign(s, { name: s.name || name }); } catch (e) { return null; }
    };
    const mine = me || await get(prof.place_id, prof.name);
    if (mine) await putSnap(env, cid, week, Object.assign({}, mine, { id: prof.place_id }), true);
    for (const r of rivals) { const x = await get(r.place_id, r.name); if (x) await putSnap(env, cid, week, Object.assign({}, x, { id: r.place_id }), false); }
    return 'saved';
  } finally { await unlock(env, cid); }
}

// Monday: take every Growth and Pro client's snapshot that isn't saved yet (bounded per run; the weekly summary and the app catch up the rest).
export async function rivalsWeekly(env, at) {
  if (!env.PLACES_KEY) return { done: 0 };
  at = at || Date.now();
  await ensureRivals(env);
  const week = isoWeek(at);
  const rows = (await env.DB.prepare("SELECT c.* FROM app_clients c WHERE c.active = 1 AND c.tier IN ('Growth', 'Pro') AND NOT EXISTS (SELECT 1 FROM rival_snap s WHERE s.client_id = c.client_id AND s.week = ?1) AND NOT EXISTS (SELECT 1 FROM rival_profile p WHERE p.client_id = c.client_id AND p.found = 0 AND p.tried = ?1) LIMIT 40").bind(week).all()).results || [];
  let done = 0;
  for (const c of rows) { try { if ((await takeSnapshot(env, c, at)) === 'saved') done++; } catch (e) { /* the next client still runs */ } }
  return { done };
}

// ---------------- reading it back ----------------
const n = x => x + ' ' + (x === 1 ? 'review' : 'reviews');
export function noteFrom(cur, prev) {
  if (!cur.length) return '';
  if (!prev.length) return 'First look taken. Changes show here next week.';
  const pm = new Map(prev.map(r => [r.place_id, r]));
  const me = cur.find(r => +r.own), mePrev = prev.find(r => +r.own);
  const dMe = me && mePrev ? (+me.reviews || 0) - (+mePrev.reviews || 0) : null;
  const rv = cur.filter(r => !+r.own && pm.has(r.place_id)).map(r => { const p = pm.get(r.place_id); return { name: cl(r.name, 40), dR: (+r.reviews || 0) - (+p.reviews || 0), dRt: Math.round(((+r.rating || 0) - (+p.rating || 0)) * 10) / 10, rating: +r.rating || 0 }; });
  const parts = [];
  const gain = rv.filter(x => x.dR > 0).sort((a, b) => b.dR - a.dR).slice(0, 2);
  const you = dMe == null ? '' : dMe > 0 ? 'you gained ' + n(dMe) : dMe < 0 ? 'you lost ' + n(-dMe) : 'you gained no new reviews';
  if (gain.length) { const s = gain.map(x => x.name + ' gained ' + n(x.dR)).join(', ') + (you ? ', ' + you : ''); parts.push(s.charAt(0).toUpperCase() + s.slice(1) + '.'); }
  else if (rv.length && dMe) parts.push('No watched business gained reviews' + (dMe > 0 ? ', and you gained ' + n(dMe) : dMe < 0 ? ', and you lost ' + n(-dMe) : '') + '.');
  for (const x of rv.filter(x => Math.abs(x.dRt) >= 0.1).sort((a, b) => Math.abs(b.dRt) - Math.abs(a.dRt)).slice(0, 2)) parts.push(x.name + '’s rating ' + (x.dRt < 0 ? 'dropped' : 'rose') + ' to ' + x.rating.toFixed(1) + '.');
  if (me && mePrev) { const d = Math.round(((+me.rating || 0) - (+mePrev.rating || 0)) * 10) / 10; if (Math.abs(d) >= 0.1) parts.push('Your rating ' + (d < 0 ? 'dropped' : 'rose') + ' to ' + (+me.rating).toFixed(1) + '.'); }
  return parts.length ? parts.join(' ') : 'No changes among the businesses we watch.';
}
async function weeks(env, cid) {
  const w = ((await env.DB.prepare('SELECT DISTINCT week FROM rival_snap WHERE client_id = ?1 ORDER BY week DESC LIMIT 2').bind(cid).all()).results || []).map(r => r.week);
  const rows = async wk => wk ? ((await env.DB.prepare('SELECT * FROM rival_snap WHERE client_id = ?1 AND week = ?2').bind(cid, wk).all()).results || []) : [];
  return { week: w[0] || '', cur: await rows(w[0]), prev: await rows(w[1]) };
}

// One line for the Monday summary (takes this week's snapshot first if it isn't saved yet).
export async function rivalLine(env, c, at) {
  if (!GROWTH(c)) return '';
  try { await takeSnapshot(env, c, at); } catch (e) { /* use what we have */ }
  try {
    const { cur, prev } = await weeks(env, c.client_id);
    const note = noteFrom(cur, prev);
    return note && !note.startsWith('First look') ? 'Competitor watch: ' + note : '';
  } catch (e) { return ''; }
}

// What the app shows on Home and Reviews.
export async function rivalsState(env, c, ctx) {
  if (!GROWTH(c)) return {};
  await ensureRivals(env);
  const cid = c.client_id, week = isoWeek(Date.now());
  const prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  const { cur, prev, week: wk } = await weeks(env, cid);
  const owner = !c.staff;
  const base = { on: true, owner, canAdd: false, week: wk, note: '', rows: [], profile: prof && +prof.found ? prof.name : '' };
  if (!env.PLACES_KEY) return { rivals: Object.assign(base, { status: 'first' }) };
  if (wk !== week && ctx && ctx.waitUntil && !(prof && !+prof.found && prof.tried === week)) ctx.waitUntil(takeSnapshot(env, c).catch(() => {}));
  if (!cur.length) return { rivals: Object.assign(base, { status: prof && !+prof.found && prof.tried ? 'profile' : 'first' }) };
  const pm = new Map(prev.map(r => [r.place_id, r]));
  const rows = cur.slice().sort((a, b) => (+b.own - +a.own) || ((+b.reviews || 0) - (+a.reviews || 0))).map(r => {
    const p = pm.get(r.place_id);
    return { id: +r.own ? '' : r.place_id, name: r.name, own: !!+r.own, rating: +r.rating || 0, reviews: +r.reviews || 0, dReviews: p ? (+r.reviews || 0) - (+p.reviews || 0) : null, dRating: p ? Math.round(((+r.rating || 0) - (+p.rating || 0)) * 10) / 10 : null };
  });
  const active = ((await env.DB.prepare('SELECT COUNT(*) AS k FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).first()) || {}).k || 0;
  return { rivals: Object.assign(base, { status: 'ok', note: noteFrom(cur, prev), rows, canAdd: owner && +active < MAX_RIVALS }) };
}

// Owner actions: remove a competitor, add one by name, or set the right Google profile.
export async function apiRivals(req, env, c, ctx) {
  if (c.staff) return aj({ ok: false, error: 'Only the owner can change this.' }, 403);
  if (!GROWTH(c)) return aj({ ok: false, error: 'Competitor watch comes with Growth.' }, 403);
  if (!env.PLACES_KEY) return aj({ ok: false, error: 'This is not switched on yet.' }, 503);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  await ensureRivals(env);
  const cid = c.client_id, week = isoWeek(Date.now());
  const prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  const busy = () => aj({ ok: false, error: 'That is all the Google lookups for this week. Try again next week.' }, 429);
  if (b.action === 'remove') {
    const id = cl(b.id, 120);
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return aj({ ok: false, error: 'Not found' }, 404);
    await env.DB.prepare('UPDATE rival_list SET active = 0 WHERE client_id = ?1 AND place_id = ?2').bind(cid, id).run();
    await env.DB.prepare('DELETE FROM rival_snap WHERE client_id = ?1 AND week = ?2 AND place_id = ?3 AND own = 0').bind(cid, week, id).run();
    return aj({ ok: true });
  }
  const q = cl(b.q, 100);
  if (q.length < 3) return aj({ ok: false, error: 'Type the business name and town.' }, 400);
  if (b.action === 'add') {
    if (!prof || !+prof.found) return aj({ ok: false, error: 'We need your Google profile first.' }, 409);
    const act = ((await env.DB.prepare('SELECT COUNT(*) AS k FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).first()) || {}).k || 0;
    if (+act >= MAX_RIVALS) return aj({ ok: false, error: 'You are watching ' + MAX_RIVALS + ' already. Remove one first.' }, 409);
    let hits;
    try { hits = await gSearch(env, cid, week, 'places:searchText', Object.assign({ textQuery: q, pageSize: 3 }, prof.lat == null ? {} : { locationBias: { circle: { center: { latitude: +prof.lat, longitude: +prof.lng }, radius: 30000 } } }), NEAR_FIELDS); }
    catch (e) { return e === BUDGET ? busy() : aj({ ok: false, error: 'Google did not answer. Try again.' }, 502); }
    const x = hits.map(shape).find(h => h.id && h.id !== prof.place_id && h.name);
    if (!x) return aj({ ok: false, error: 'We could not find that business. Try the name and town.' }, 404);
    await env.DB.prepare('INSERT INTO rival_list (client_id, place_id, name, active, custom, added) VALUES (?1, ?2, ?3, 1, 1, ?4) ON CONFLICT(client_id, place_id) DO UPDATE SET active = 1, custom = 1').bind(cid, x.id, x.name, isoNow()).run();
    await putSnap(env, cid, week, x, false);
    return aj({ ok: true, name: x.name });
  }
  if (b.action === 'profile') {
    let hits;
    try { hits = await gSearch(env, cid, week, 'places:searchText', { textQuery: q, pageSize: 1 }, FIND_FIELDS); }
    catch (e) { return e === BUDGET ? busy() : aj({ ok: false, error: 'Google did not answer. Try again.' }, 502); }
    if (!hits[0] || !hits[0].id) return aj({ ok: false, error: 'We could not find that. Try your business name and town.' }, 404);
    await saveProfile(env, cid, hits[0]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rival_list WHERE client_id = ?1 AND custom = 0').bind(cid),
      env.DB.prepare('DELETE FROM rival_snap WHERE client_id = ?1').bind(cid),
      env.DB.prepare("UPDATE rival_profile SET tried = '' WHERE client_id = ?1").bind(cid)
    ]);
    const work = takeSnapshot(env, c).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    return aj({ ok: true, name: shape(hits[0]).name });
  }
  return aj({ ok: false, error: 'Bad request' }, 400);
}
