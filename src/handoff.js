// Hand the caller to a neighbor. When a caller needs work this business does not do, and another Always Open business
// nearby does, Max can put them through. Only if both owners turned it on; never to or from a regulated business; nearest
// first and only by distance, never by plan; never a business that is not a client. Both sides see it in their record.
import { milesBetween } from './map.js';

let ready = false;
export async function ensureHandoff(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS handoff_prefs (client_id TEXT PRIMARY KEY, give INTEGER DEFAULT 0, take INTEGER DEFAULT 0, radius_mi INTEGER DEFAULT 25, updated TEXT DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, caller TEXT DEFAULT '', call_sid TEXT DEFAULT '', at TEXT, need TEXT DEFAULT '', result TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS handoffs_at ON handoffs (at)'),
  ]);
  ready = true;
}

export async function prefs(env, cid) {
  await ensureHandoff(env);
  const r = await env.DB.prepare('SELECT give, take, radius_mi FROM handoff_prefs WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return { give: !!(r && +r.give), take: !!(r && +r.take), radius: (r && +r.radius_mi) || 25 };
}

// App: POST /api/handoff { give?: bool, take?: bool }
export async function apiHandoff(req, env, c) {
  await ensureHandoff(env);
  if (c.regulated) return { ok: false, error: 'Hand-offs are not available for regulated businesses.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  const p = await prefs(env, c.client_id);
  if (typeof b.give === 'boolean') p.give = b.give;
  if (typeof b.take === 'boolean') p.take = b.take;
  await env.DB.prepare('INSERT INTO handoff_prefs (client_id, give, take, radius_mi, updated) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(client_id) DO UPDATE SET give = excluded.give, take = excluded.take, updated = excluded.updated')
    .bind(c.client_id, p.give ? 1 : 0, p.take ? 1 : 0, p.radius, new Date().toISOString()).run();
  return { ok: true, give: p.give, take: p.take, message: 'Saved.' };
}

// Neighbors this line may hand callers to: opted-in takers within the radius, other trades only, nearest first.
export async function neighborsFor(env, cid) {
  await ensureHandoff(env);
  const me = await prefs(env, cid);
  if (!me.give) return [];
  const here = await env.DB.prepare('SELECT m.lat, m.lng, v.industry, c.regulated FROM map_listing m JOIN app_clients c ON c.client_id = m.client_id LEFT JOIN voice_lines v ON v.client_id = m.client_id WHERE m.client_id = ?1 LIMIT 1').bind(cid).first().catch(() => null);
  if (!here || here.lat == null || here.lng == null || +here.regulated) return [];
  const rows = ((await env.DB.prepare(
    'SELECT c.client_id, c.business, c.regulated, m.lat, m.lng, v.industry, v.number, v.on_air, b.status AS bstatus FROM handoff_prefs h JOIN app_clients c ON c.client_id = h.client_id JOIN map_listing m ON m.client_id = h.client_id ' +
    'LEFT JOIN voice_lines v ON v.client_id = h.client_id LEFT JOIN billing b ON b.client_id = h.client_id WHERE h.take = 1 AND h.client_id != ?1 AND c.active = 1 LIMIT 500').bind(cid).all()).results) || [];
  const out = [];
  for (const r of rows) {
    if (+r.regulated || !r.number || !+r.on_air || r.lat == null || r.lng == null) continue;
    if ((r.industry || '').toLowerCase() === (here.industry || '').toLowerCase()) continue;
    if (r.bstatus && !/^(active|trialing|past_due)$/.test(r.bstatus)) continue;
    const mi = milesBetween(+here.lat, +here.lng, +r.lat, +r.lng);
    if (mi > me.radius) continue;
    out.push({ id: r.client_id, business: r.business, industry: r.industry || 'other work', number: r.number, miles: Math.max(1, Math.round(mi)) });
  }
  out.sort((a, b) => a.miles - b.miles);
  return out.slice(0, 6);
}

export function neighborsText(list) {
  return list.map(n => n.business + ' (' + n.industry + ', ' + n.miles + (n.miles === 1 ? ' mile' : ' miles') + ')').join('; ');
}

// Max said [HANDOFF:Name]. Find that neighbor on the list and record it; returns the neighbor or null.
export async function startHandoff(env, fromCid, callSid, caller, name, list, need) {
  const want = String(name || '').toLowerCase().trim();
  const n = (list || []).find(x => x.business.toLowerCase() === want) || (list || []).find(x => want && x.business.toLowerCase().includes(want));
  if (!n) return null;
  await ensureHandoff(env);
  await env.DB.prepare('INSERT INTO handoffs (from_id, to_id, caller, call_sid, at, need, result) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(fromCid, n.id, caller || '', callSid || '', new Date().toISOString(), String(need || '').slice(0, 80), 'dialing').run();
  return n;
}

// The receiving line: was this caller just handed over to us? (so Max can say who sent them)
export async function handedFrom(env, toCid, caller) {
  if (!caller) return null;
  await ensureHandoff(env);
  const r = await env.DB.prepare('SELECT h.id, h.from_id, h.need, c.business FROM handoffs h LEFT JOIN app_clients c ON c.client_id = h.from_id WHERE h.to_id = ?1 AND h.caller = ?2 AND h.at > ?3 ORDER BY h.at DESC LIMIT 1')
    .bind(toCid, caller, new Date(Date.now() - 3 * 60e3).toISOString()).first().catch(() => null);
  if (r) await env.DB.prepare("UPDATE handoffs SET result = 'answered' WHERE id = ?1").bind(r.id).run().catch(() => {});
  return r ? { business: r.business || 'another business', need: r.need || '' } : null;
}

export async function markHandoff(env, callSid, result) {
  await ensureHandoff(env);
  await env.DB.prepare("UPDATE handoffs SET result = ?1 WHERE call_sid = ?2 AND result = 'dialing'").bind(result, callSid).run().catch(() => {});
}

export async function handoffState(env, cid) {
  await ensureHandoff(env);
  const p = await prefs(env, cid);
  const m0 = new Date(); m0.setUTCDate(1); m0.setUTCHours(0, 0, 0, 0);
  const g = await env.DB.prepare('SELECT COUNT(*) AS n FROM handoffs WHERE from_id = ?1 AND at >= ?2').bind(cid, m0.toISOString()).first().catch(() => null);
  const t = await env.DB.prepare('SELECT COUNT(*) AS n FROM handoffs WHERE to_id = ?1 AND at >= ?2').bind(cid, m0.toISOString()).first().catch(() => null);
  const near = p.give ? (await neighborsFor(env, cid)).length : 0;
  return { give: p.give, take: p.take, given: +(g && g.n) || 0, taken: +(t && t.n) || 0, nearby: near };
}
