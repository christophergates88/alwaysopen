// Competitor watch (Growth and Pro): the owner taps Check now and we look up, from Google, the current public rating and
// review count of their own business and the nearby competitors they watch, then show a short factual note and the
// estimated potential share. Google's terms let us keep place IDs only, so that is all we keep: the names, ratings and
// counts are fetched for that check, shown, and thrown away. No week-over-week history of anyone else's numbers.
// Google Maps credit is shown with the numbers (no Google map on the screen). Tables create themselves on first use.
import { places } from './audit.js';
import { estimate, assumptionsText } from './share.js';

const DAY_CAP = 20;      // Google lookups per client per day (one check is about six)
const MAX_RIVALS = 5;
const MIN_RIVALS = 3;
const DEMO = 'demo-plumbing';
const GROWTH = c => c && (c.tier === 'Growth' || c.tier === 'Pro');
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const isoNow = () => new Date().toISOString();
const today = () => isoNow().slice(0, 10);
const d10 = s => String(s || '').replace(/\D/g, '').slice(-10);
export const ATTRIBUTION = 'Google Maps';

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
    // name, ptype, lat, lng stay in the schema for the sample client only; real clients keep place IDs and flags.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rival_profile (client_id TEXT PRIMARY KEY, place_id TEXT DEFAULT '', name TEXT DEFAULT '', ptype TEXT DEFAULT '', lat REAL, lng REAL, found INTEGER DEFAULT 0, tried TEXT DEFAULT '', spent_week TEXT DEFAULT '', spent INTEGER DEFAULT 0, lock TEXT DEFAULT '', updated TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rival_list (client_id TEXT NOT NULL, place_id TEXT NOT NULL, name TEXT DEFAULT '', active INTEGER DEFAULT 1, custom INTEGER DEFAULT 0, added TEXT, PRIMARY KEY (client_id, place_id))"),
    // Sample data for the demo client only. Nothing from Google is written here.
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rival_snap (client_id TEXT NOT NULL, week TEXT NOT NULL, place_id TEXT NOT NULL, name TEXT DEFAULT \'\', own INTEGER DEFAULT 0, rating REAL, reviews INTEGER, at TEXT, PRIMARY KEY (client_id, week, place_id))')
  ]);
  if (env.DB) READY.add(env.DB);
}

// Removes any Google content kept before this change (and keeps it gone). Place IDs stay.
export async function purgeGoogle(env) {
  await ensureRivals(env);
  const st = [
    env.DB.prepare('DELETE FROM rival_snap WHERE client_id != ?1').bind(DEMO),
    env.DB.prepare("UPDATE rival_list SET name = '' WHERE client_id != ?1 AND name != ''").bind(DEMO),
    env.DB.prepare("UPDATE rival_profile SET name = '', ptype = '', lat = NULL, lng = NULL WHERE client_id != ?1 AND (name != '' OR ptype != '' OR lat IS NOT NULL OR lng IS NOT NULL)").bind(DEMO)
  ];
  await env.DB.batch(st);
  try { await env.DB.prepare('DELETE FROM share_hist').run(); } catch (e) { /* never created */ }
  try { await env.DB.prepare("UPDATE audits SET data = '{}' WHERE data != '{}'").run(); } catch (e) { /* no audits yet */ }
  try { await env.DB.prepare('DELETE FROM radar').run(); } catch (e) { /* the radar keeps nothing now */ }
  return { ok: true };
}
// Kept for the Monday cron's import: there are no snapshots to take any more, only the purge.
export async function rivalsWeekly(env) { return purgeGoogle(env); }

// ---------------- Google lookups, with a daily cap per client ----------------
const BUDGET = new Error('daily lookup limit');
async function room(env, cid) {
  await env.DB.prepare('INSERT OR IGNORE INTO rival_profile (client_id, updated) VALUES (?1, ?2)').bind(cid, isoNow()).run();
  const p = await env.DB.prepare('SELECT spent_week, spent FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  return DAY_CAP - (p && p.spent_week === today() ? +p.spent || 0 : 0);
}
async function spend(env, cid, n) {
  const left = await room(env, cid);
  if (n > left) return false;
  await env.DB.prepare('UPDATE rival_profile SET spent_week = ?1, spent = ?2 WHERE client_id = ?3').bind(today(), DAY_CAP - left + n, cid).run();
  return true;
}
async function gSearch(env, cid, path, body, fields) {
  if (!(await spend(env, cid, 1))) throw BUDGET;
  return places(env, path, body, fields);
}
async function gDetails(env, cid, id, fields) {
  if (!(await spend(env, cid, 1))) throw BUDGET;
  const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(id), { headers: { 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': fields.join(',') } });
  if (!r.ok) { const t = await r.text().catch(() => ''); try { await (await import('./funding.js')).googleProblem(env, r.status, t); } catch (e) {} throw new Error('Google lookup failed (' + r.status + ')'); }
  return r.json();
}
const FIND_FIELDS = ['id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount', 'nationalPhoneNumber', 'primaryType', 'location', 'businessStatus'];
const ME_FIELDS = ['id', 'displayName', 'rating', 'userRatingCount', 'primaryType', 'location'];
const RIVAL_FIELDS = ['id', 'displayName', 'rating', 'userRatingCount', 'businessStatus'];
const shape = p => ({ id: p.id, name: cl((p.displayName && p.displayName.text) || '', 80), rating: +p.rating || 0, reviews: +p.userRatingCount || 0 });

// A short lock so two people tapping Check now at once don't both spend lookups.
async function claim(env, cid) {
  await env.DB.prepare('INSERT OR IGNORE INTO rival_profile (client_id, updated) VALUES (?1, ?2)').bind(cid, isoNow()).run();
  const r = await env.DB.prepare("UPDATE rival_profile SET lock = ?1 WHERE client_id = ?2 AND (lock = '' OR lock IS NULL OR lock < ?3)").bind(isoNow(), cid, new Date(Date.now() - 120000).toISOString()).run();
  return !!(r && r.meta && r.meta.changes);
}
const unlock = (env, cid) => env.DB.prepare("UPDATE rival_profile SET lock = '' WHERE client_id = ?1").bind(cid).run().catch(() => {});

// Keep the place ID only.
async function saveProfile(env, cid, placeId) {
  await env.DB.prepare("UPDATE rival_profile SET place_id = ?1, name = '', ptype = '', lat = NULL, lng = NULL, found = 1, tried = ?2, updated = ?3 WHERE client_id = ?4").bind(placeId, today(), isoNow(), cid).run();
}

// Find the client's own Google profile: a place id in their review link is exact; otherwise business name + town, confirmed by phone.
async function findProfile(env, c) {
  const cid = c.client_id;
  let town = '', phone = d10(c.phone);
  try { const b = await env.DB.prepare('SELECT town, phone FROM billing WHERE client_id = ?1').bind(cid).first(); if (b) { town = cl(b.town, 60); if (!phone) phone = d10(b.phone); } } catch (e) { /* no billing row */ }
  const link = String(c.review_link || '');
  const pid = (link.match(/[?&]placeid=([A-Za-z0-9_-]{10,})/i) || link.match(/place_id[:=]([A-Za-z0-9_-]{10,})/i) || [])[1];
  let hit = null;
  if (pid) { try { hit = await gDetails(env, cid, pid, ME_FIELDS); } catch (e) { if (e === BUDGET) throw e; } }
  if (!hit && c.business) {
    const list = await gSearch(env, cid, 'places:searchText', { textQuery: cl(c.business, 80) + (town ? ' ' + town : ''), pageSize: 5 }, FIND_FIELDS);
    hit = list.find(p => phone && d10(p.nationalPhoneNumber) === phone) || (town ? list.find(p => String(p.formattedAddress || '').toLowerCase().includes(town.split(',')[0].trim().toLowerCase())) : null) || null;
  }
  await env.DB.prepare('UPDATE rival_profile SET tried = ?1 WHERE client_id = ?2').bind(today(), cid).run();
  if (!hit || !hit.id) return null;
  await saveProfile(env, cid, hit.id);
  return hit;
}

// Top nearby competitors of the same kind, by review count, from a fresh lookup of the client's own place. Keeps place IDs only.
async function pickRivals(env, cid, me) {
  if (!me || !me.id || !me.primaryType || !me.location) return [];
  const have = ((await env.DB.prepare('SELECT place_id, active FROM rival_list WHERE client_id = ?1').bind(cid).all()).results) || [];
  const known = new Set(have.map(r => r.place_id)), spots = MAX_RIVALS - have.filter(r => +r.active).length;
  if (spots <= 0) return [];
  const near = await gSearch(env, cid, 'places:searchNearby', {
    includedPrimaryTypes: [me.primaryType], maxResultCount: 20, rankPreference: 'POPULARITY',
    locationRestriction: { circle: { center: { latitude: +me.location.latitude, longitude: +me.location.longitude }, radius: 15000 } }
  }, RIVAL_FIELDS);
  const out = near.filter(p => p.id && p.id !== me.id && !known.has(p.id) && (!p.businessStatus || p.businessStatus === 'OPERATIONAL')).map(shape)
    .filter(x => x.name && x.reviews > 0).sort((a, b) => b.reviews - a.reviews).slice(0, spots);
  for (const x of out) await env.DB.prepare("INSERT OR IGNORE INTO rival_list (client_id, place_id, name, active, custom, added) VALUES (?1, ?2, '', 1, 0, ?3)").bind(cid, x.id, isoNow()).run();
  return out;
}

// One plain note about how things stand right now. Facts only, no advice.
const rv = x => x + ' ' + (x === 1 ? 'review' : 'reviews');
export function noteNow(rows) {
  const me = rows.find(r => r.own), others = rows.filter(r => !r.own);
  if (!me || !others.length) return '';
  const parts = [];
  const most = others.slice().sort((a, b) => b.reviews - a.reviews)[0];
  if (most.reviews > me.reviews) parts.push(most.name + ' has the most reviews on your list (' + most.reviews.toLocaleString('en-US') + '). You have ' + me.reviews.toLocaleString('en-US') + '.');
  else parts.push('You have the most reviews on your list (' + me.reviews.toLocaleString('en-US') + ').');
  const top = others.slice().sort((a, b) => b.rating - a.rating)[0];
  if (top.rating > me.rating + 0.05) parts.push('The highest rating on your list is ' + top.rating.toFixed(1) + ' (' + top.name + '). Yours is ' + me.rating.toFixed(1) + '.');
  else if (me.rating) parts.push('Your rating, ' + me.rating.toFixed(1) + ', is the highest on your list' + (Math.abs(top.rating - me.rating) <= 0.05 ? ', tied with ' + top.name : '') + '.');
  return parts.join(' ');
}

function result(rows, c, extra) {
  const sorted = rows.slice().sort((a, b) => (+b.own - +a.own) || (b.reviews - a.reviews));
  let share = null;
  try { const e = estimate(sorted); if (e) share = Object.assign(e, { moved: '', assumptions: assumptionsText(!!(c && +c.regulated)) }); } catch (e) { share = null; }
  return Object.assign({ status: 'ok', rows: sorted.map(r => ({ id: r.own ? '' : r.id, name: r.name, own: !!r.own, rating: r.rating, reviews: r.reviews })), note: noteNow(sorted), share, attribution: ATTRIBUTION, checkedAt: isoNow() }, extra || {});
}

// The live check. Returns what the card shows; nothing from Google is written anywhere.
export async function liveCheck(env, c) {
  await ensureRivals(env);
  const cid = c.client_id, owner = !c.staff;
  const base = { owner, attribution: ATTRIBUTION };
  if (cid === DEMO) {
    const wk = ((await env.DB.prepare('SELECT week FROM rival_snap WHERE client_id = ?1 ORDER BY week DESC LIMIT 1').bind(cid).first()) || {}).week;
    const rows = wk ? (((await env.DB.prepare('SELECT * FROM rival_snap WHERE client_id = ?1 AND week = ?2').bind(cid, wk).all()).results) || []).map(r => ({ id: r.place_id, name: r.name, own: !!+r.own, rating: +r.rating || 0, reviews: +r.reviews || 0 })) : [];
    return Object.assign(base, result(rows, c, { canAdd: false, sample: true }));
  }
  if (!env.PLACES_KEY) return Object.assign(base, { status: 'first' });
  const active = ((await env.DB.prepare('SELECT place_id FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).all()).results) || [];
  if ((await room(env, cid)) < 1 + Math.max(active.length, MIN_RIVALS)) return Object.assign(base, { status: 'limit', message: 'That is all the checks for today. Check again tomorrow.' });
  if (!(await claim(env, cid))) return Object.assign(base, { status: 'busy', message: 'A check is already running. Try again in a minute.' });
  try {
    let prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
    let me = null;
    if (!prof || !+prof.found || !prof.place_id) {
      me = await findProfile(env, c);
      if (!me) return Object.assign(base, { status: 'profile' });
      prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
    } else {
      me = await gDetails(env, cid, prof.place_id, ME_FIELDS);
    }
    let list = active;
    if (list.length < MIN_RIVALS) { await pickRivals(env, cid, me); list = ((await env.DB.prepare('SELECT place_id FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).all()).results) || []; }
    const rows = [Object.assign(shape(me), { own: true })];
    for (const r of list) { try { const d = await gDetails(env, cid, r.place_id, RIVAL_FIELDS); const s = shape(d); if (s.name) rows.push(s); } catch (e) { if (e === BUDGET) break; } }
    return Object.assign(base, result(rows, c, { canAdd: owner && list.length < MAX_RIVALS, left: Math.max(0, Math.floor((await room(env, cid)) / (1 + list.length))) }));
  } catch (e) {
    if (e === BUDGET) return Object.assign(base, { status: 'limit', message: 'That is all the checks for today. Check again tomorrow.' });
    return Object.assign(base, { status: 'error', message: 'Google did not answer. Try again in a minute.' });
  } finally { await unlock(env, cid); }
}

// What the app's state carries: no Google numbers, only whether a check can run.
export async function rivalsState(env, c) {
  if (!GROWTH(c)) return {};
  await ensureRivals(env);
  const cid = c.client_id, owner = !c.staff;
  if (cid === DEMO) return { rivals: await liveCheck(env, c) };
  const prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  const n = ((await env.DB.prepare('SELECT COUNT(*) AS k FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).first()) || {}).k || 0;
  const status = !env.PLACES_KEY ? 'first' : (prof && !+prof.found && prof.tried === today() ? 'profile' : 'ready');
  return { rivals: { on: true, owner, status, watching: +n, canAdd: owner && +n < MAX_RIVALS, rows: [], note: '', attribution: ATTRIBUTION } };
}

// One line for the Monday summary, from a check made at send time.
export async function rivalLine(env, c) {
  if (!GROWTH(c)) return '';
  try {
    const r = await liveCheck(env, c);
    if (r.status !== 'ok' || !r.note) return '';
    return 'Competitor watch (from Google Maps): ' + r.note + (r.share ? ' Estimated potential share: about ' + r.share.range + ' of the businesses on your list.' : '');
  } catch (e) { return ''; }
}

// Owner actions: check now, remove a competitor, add one by name, or set the right Google profile.
export async function apiRivals(req, env, c) {
  if (!GROWTH(c)) return aj({ ok: false, error: 'Competitor watch comes with Growth.' }, 403);
  if (!env.PLACES_KEY && c.client_id !== DEMO) return aj({ ok: false, error: 'This is not switched on yet.' }, 503);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  await ensureRivals(env);
  if (b.action === 'live') {
    const r = await liveCheck(env, c);
    return aj({ ok: r.status === 'ok' || r.status === 'profile', rivals: r, error: r.message || undefined });
  }
  if (c.staff) return aj({ ok: false, error: 'Only the owner can change this.' }, 403);
  const cid = c.client_id;
  const busy = () => aj({ ok: false, error: 'That is all the Google lookups for today. Try again tomorrow.' }, 429);
  if (b.action === 'remove') {
    const id = cl(b.id, 120);
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return aj({ ok: false, error: 'Not found' }, 404);
    await env.DB.prepare('UPDATE rival_list SET active = 0 WHERE client_id = ?1 AND place_id = ?2').bind(cid, id).run();
    return aj({ ok: true });
  }
  const q = cl(b.q, 100);
  if (q.length < 3) return aj({ ok: false, error: 'Type the business name and town.' }, 400);
  const prof = await env.DB.prepare('SELECT * FROM rival_profile WHERE client_id = ?1').bind(cid).first();
  if (b.action === 'add') {
    if (!prof || !+prof.found || !prof.place_id) return aj({ ok: false, error: 'We need your Google profile first. Tap Check now.' }, 409);
    const act = ((await env.DB.prepare('SELECT COUNT(*) AS k FROM rival_list WHERE client_id = ?1 AND active = 1').bind(cid).first()) || {}).k || 0;
    if (+act >= MAX_RIVALS) return aj({ ok: false, error: 'You are watching ' + MAX_RIVALS + ' already. Remove one first.' }, 409);
    let hits;
    try {
      const me = await gDetails(env, cid, prof.place_id, ['id', 'location']);
      hits = await gSearch(env, cid, 'places:searchText', Object.assign({ textQuery: q, pageSize: 3 }, me.location ? { locationBias: { circle: { center: { latitude: +me.location.latitude, longitude: +me.location.longitude }, radius: 30000 } } } : {}), RIVAL_FIELDS);
    } catch (e) { return e === BUDGET ? busy() : aj({ ok: false, error: 'Google did not answer. Try again.' }, 502); }
    const x = hits.map(shape).find(h => h.id && h.id !== prof.place_id && h.name);
    if (!x) return aj({ ok: false, error: 'We could not find that business. Try the name and town.' }, 404);
    await env.DB.prepare("INSERT INTO rival_list (client_id, place_id, name, active, custom, added) VALUES (?1, ?2, '', 1, 1, ?3) ON CONFLICT(client_id, place_id) DO UPDATE SET active = 1, custom = 1").bind(cid, x.id, isoNow()).run();
    return aj({ ok: true, name: x.name });
  }
  if (b.action === 'profile') {
    let hits;
    try { hits = await gSearch(env, cid, 'places:searchText', { textQuery: q, pageSize: 1 }, ['id', 'displayName']); }
    catch (e) { return e === BUDGET ? busy() : aj({ ok: false, error: 'Google did not answer. Try again.' }, 502); }
    if (!hits[0] || !hits[0].id) return aj({ ok: false, error: 'We could not find that. Try your business name and town.' }, 404);
    await saveProfile(env, cid, hits[0].id);
    await env.DB.prepare('DELETE FROM rival_list WHERE client_id = ?1 AND custom = 0').bind(cid).run();
    return aj({ ok: true, name: shape(hits[0]).name });
  }
  return aj({ ok: false, error: 'Bad request' }, 400);
}
