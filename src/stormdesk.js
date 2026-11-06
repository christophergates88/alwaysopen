// Storm Desk, nationwide: each client is watched where their business is. Once per client (and again if they move),
// their location becomes a National Weather Service county and forecast zone (api.weather.gov/points); every 10 minutes
// the active warnings for each state that has clients are read and matched to those zones. A match drafts nothing by
// itself: Christopher gets the push and the email, and the Always Open check drafts storm posts for those clients, which
// the client approves.
const UA = 'AlwaysOpen Storm Desk (hello@alwaysopenoffice.com)';
const NWS = 'https://api.weather.gov';
const SKIP = new Set(['demo-plumbing', 'always-open']);
import { neonEmail } from './neonmail.js';
export const STORM_EVENTS = /^(Tornado Warning|Severe Thunderstorm Warning|Flash Flood Warning|Flood Warning|Hurricane Warning|Tropical Storm Warning|High Wind Warning|Extreme Wind Warning|Ice Storm Warning|Winter Storm Warning|Blizzard Warning|Hard Freeze Warning|Freeze Warning|Extreme Cold Warning|Excessive Heat Warning|Extreme Heat Warning|Red Flag Warning|Storm Surge Warning)$/;
export function stormGroup(ev) {
  if (/Flood|Surge/.test(ev)) return 'flood';
  if (/Freeze|Cold|Ice|Winter|Blizzard/.test(ev)) return 'freeze';
  return 'severe';
}

const ready = new WeakSet();
export async function ensureStormDesk(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS storm_watch (client_id TEXT PRIMARY KEY, q TEXT DEFAULT '', lat REAL, lng REAL, state TEXT DEFAULT '', county TEXT DEFAULT '', zone TEXT DEFAULT '', label TEXT DEFAULT '', at TEXT DEFAULT '', why TEXT DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS storms (id TEXT PRIMARY KEY, at TEXT, event TEXT, grp TEXT, counties TEXT, headline TEXT, ends TEXT, link TEXT, sent TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS storm_meta (k TEXT PRIMARY KEY, v TEXT)')
  ]);
  try { await env.DB.prepare("ALTER TABLE storms ADD COLUMN clients TEXT DEFAULT ''").run(); } catch (e) { /* already there */ }
  ready.add(env.DB);
}
const ugcOf = url => String(url || '').split('/').pop();
// The storm-day posts (the same wording as HQ's settings/storm-templates), by kind of business and kind of storm.
export const TEMPLATES = {
  general: { flood: 'Flooding in our area today. Please stay off flooded roads and stay safe. We will post any changes to our hours here, and you can reach us at {phone}.',
    freeze: 'Freezing temperatures tonight. Stay warm and check on your neighbors. We will post any changes to our hours here, and you can reach us at {phone}.',
    severe: 'Severe weather in our area today. Please stay safe. We will post any changes to our hours here, and you can reach us at {phone}.' },
  insurance: { flood: 'Turn around, don\'t drown: never drive through water on the road. If water gets into your home or car, take photos before you clean up and call our office at {phone} with any questions.',
    freeze: 'Hard freeze tonight. Let faucets on outside walls drip, open the cabinet doors under sinks, and know where your main water shut-off is. If a pipe bursts, shut off the water, take photos and call our office at {phone}.',
    severe: 'Stay safe today. If your home or car is damaged in this storm, take photos and video before you clean up, keep receipts for emergency repairs, and call our office at {phone}. We are here to help.' },
  trades: { flood: 'If water got in, we are taking calls at {phone}. Stay out of standing water near outlets, take photos, and we will help you sort out next steps.',
    freeze: 'Freezing temperatures tonight. Let faucets on outside walls drip and open the cabinet doors under sinks. If a pipe bursts, shut off your main water valve and call us at {phone}.',
    severe: 'Storm damage? We are taking calls at {phone}. Stay clear of downed power lines, take photos of any damage, and we will get to you as fast as we safely can.' }
};
export const LABELS = { flood: 'Flooding', freeze: 'Freeze', severe: 'Severe weather' };
// The neon email for a new warning (to Christopher). Pure, so it can be tested. s: the storms row from stormRun.
export const SIGN = { flood: 'FLOOD WARNING', freeze: 'FREEZE TONIGHT', severe: 'STORM WARNING' };
export function stormEmail(s) {
  const when = (() => { const t = Date.parse(s.ends || ''); return t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''; })();
  const biz = String(s.businesses || '').split(',').map(x => x.trim()).filter(Boolean);
  const n = neonEmail({
    tone: 'bad', sign: SIGN[s.grp] || 'STORM WARNING', who: 'Storm Desk',
    title: s.event + ' for ' + (String(s.counties || '').split(';')[0].trim() || 'a client\u2019s county') + '.',
    doThis: [],
    linesTitle: 'Nothing to do: ' + (s.drafted ? (s.drafted === 1 ? 'a storm post is' : s.drafted + ' storm posts are') + ' waiting for the client\u2019s OK' : 'posts get drafted at the next check'),
    stats: [{ n: String(biz.length || 0), label: biz.length === 1 ? 'client there' : 'clients there', tone: 'bad' }, { n: String(s.drafted || 0), label: s.drafted === 1 ? 'post drafted' : 'posts drafted' }],
    lines: [{ k: 'Warning', v: s.event, bad: true }, { k: 'Where', v: s.counties }, biz.length ? { k: 'Clients', v: biz.join(', ') } : null, when ? { k: 'Ends', v: when } : null, s.headline ? { v: s.headline } : null].filter(Boolean),
    button: { text: 'See the warning', url: s.link || 'https://alerts.weather.gov' },
    note: 'From the National Weather Service. Storm ID ' + s.id + '.',
    // The "Always Open check" scheduled task reads these exact lines from the plain-text part. Keep them.
    extraText: ['Storm ID: ' + s.id, 'Event: ' + s.event, 'Group: ' + s.grp, 'Counties: ' + s.counties, 'Clients: ' + (s.clients || ''), 'Ends: ' + s.ends, 'Headline: ' + s.headline, 'Source: ' + s.link].join('\n')
  });
  return { subject: (SIGN[s.grp] ? SIGN[s.grp].charAt(0) + SIGN[s.grp].slice(1).toLowerCase() : 'Storm warning') + ': ' + (biz.slice(0, 2).join(', ') || s.counties), html: n.html, text: n.text };
}

const TRADES = /plumb|hvac|heat|air|roof|electric|contractor|tree|restor|water|pest|garage|fenc|paint|concrete|pool|tow|auto/i;
export function fill(t, phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const ph = d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : '';
  return ph ? t.replace(/\{phone\}/g, ph) : t.replace(/ at \{phone\}/g, '').replace(/,? and you can reach us\.?/g, '.').replace(/\{phone\}/g, '').replace(/\s+\./g, '.');
}
const rid = () => [...crypto.getRandomValues(new Uint8Array(10))].map(x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
// The post goes straight into the owner's app for their OK (like a photo post); approved, it goes up on Google. One per
// client per kind of storm in 12 hours. A client in the old hand-set Georgia counties is left to HQ, which drafts theirs.
async function draftFor(env, w, row, now, extra) {
  if (/^GAC\d{3}$/.test(w.county) && extra['013' + w.county.slice(3)]) return false;
  const recent = await env.DB.prepare("SELECT 1 AS x FROM app_items WHERE client_id = ?1 AND kind = 'post' AND context LIKE 'Storm Desk%' AND title = ?2 AND created > ?3").bind(w.client_id, 'Storm Desk: ' + LABELS[row.grp], new Date(now - 12 * 3600e3).toISOString()).first().catch(() => null);
  if (recent) return false;
  const line = await env.DB.prepare('SELECT industry FROM voice_lines WHERE client_id = ?1 LIMIT 1').bind(w.client_id).first().catch(() => null);
  const ind = String((line && line.industry) || '');
  const kind = /insurance/i.test(ind) ? 'insurance' : (TRADES.test(ind + ' ' + (w.business || '')) ? 'trades' : 'general');
  const ts = new Date(now).toISOString();
  await env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES (?1, ?2, 'post', ?3, ?4, 0, ?5, 'pending', 0, ?6, ?7, ?7, 0, '')")
    .bind('phst' + rid(), w.client_id, 'Storm Desk: ' + LABELS[row.grp], 'Storm Desk: ' + row.event + ' for ' + (w.label || 'your county'), fill(TEMPLATES[kind][row.grp], w.phone), kind === 'insurance' ? 1 : 0, ts).run();
  return true;
}

// Who Storm Desk covers: active clients on Growth or Pro (it comes with those plans), with where they are.
async function covered(env) {
  return ((await env.DB.prepare("SELECT c.client_id, c.business, c.tier, b.town AS btown, (SELECT town FROM voice_lines v WHERE v.client_id = c.client_id LIMIT 1) AS vtown, m.address, m.lat, m.lng, w.q AS wq, w.at AS wat, w.county FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id LEFT JOIN map_listing m ON m.client_id = c.client_id LEFT JOIN storm_watch w ON w.client_id = c.client_id WHERE c.active = 1 AND c.tier IN ('Growth', 'Pro')").all()).results || []).filter(r => !SKIP.has(r.client_id));
}

// A few clients a run: find their NWS county and zone. A place that can't be found is tried again a day later.
export async function refreshWatch(env, now, h) {
  now = now || Date.now(); h = h || {};
  const f = h.fetch || fetch;
  await ensureStormDesk(env);
  const day = new Date(now - 864e5).toISOString();
  const todo = (await covered(env)).filter(r => {
    const q = String(r.lat != null ? r.lat + ',' + r.lng : (r.address || r.btown || r.vtown || '')).trim();
    r.q = q;
    return q && (r.wq !== q || (!r.county && (r.wat || '') < day));
  });
  let found = 0;
  for (const r of todo.slice(0, 3)) {
    let lat = r.lat, lng = r.lng, why = '';
    try {
      if (lat == null) {
        const t = String(r.address || r.btown || r.vtown || '');
        const x = await (await f('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(t), { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })).json();
        if (x && x[0] && isFinite(+x[0].lat)) { lat = +x[0].lat; lng = +x[0].lon; } else why = 'could not find ' + t;
      }
      let state = '', county = '', zone = '', label = '';
      if (lat != null) {
        const p = await (await f(NWS + '/points/' + (+lat).toFixed(4) + ',' + (+lng).toFixed(4), { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } })).json();
        const pr = (p && p.properties) || {};
        county = ugcOf(pr.county); zone = ugcOf(pr.forecastZone);
        state = (pr.relativeLocation && pr.relativeLocation.properties && pr.relativeLocation.properties.state) || county.slice(0, 2);
        if (county) {
          try { const z = await (await f(NWS + '/zones/county/' + county, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } })).json(); label = ((z && z.properties && z.properties.name) || '') + ' County, ' + state; } catch (e) { label = county; }
          found++;
        } else why = why || 'the weather service has no county for that spot';
      }
      await env.DB.prepare('INSERT OR REPLACE INTO storm_watch (client_id, q, lat, lng, state, county, zone, label, at, why) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
        .bind(r.client_id, r.q, lat, lng, state, county, zone, label, new Date(now).toISOString(), why).run();
    } catch (e) {
      await env.DB.prepare("INSERT OR REPLACE INTO storm_watch (client_id, q, at, why) VALUES (?1, ?2, ?3, ?4)").bind(r.client_id, r.q, new Date(now).toISOString(), String((e && e.message) || e).slice(0, 120)).run().catch(() => {});
    }
  }
  return { tried: Math.min(todo.length, 3), found };
}

// Every 10 minutes. extra: the old hand-set Georgia counties (STORM_COUNTIES, FIPS) for HQ-only clients, still matched.
export async function stormRun(env, now, h) {
  now = now || Date.now(); h = h || {};
  const f = h.fetch || fetch;
  await ensureStormDesk(env);
  try { await refreshWatch(env, now, h); } catch (e) { /* matching still runs on what is known */ }
  const watch = (((await env.DB.prepare("SELECT w.client_id, w.state, w.county, w.zone, w.label, c.business, c.phone FROM storm_watch w JOIN app_clients c ON c.client_id = w.client_id WHERE w.county != '' AND c.active = 1 AND c.tier IN ('Growth', 'Pro')").all()).results) || []).filter(w => !SKIP.has(w.client_id));
  const extra = h.extra || {};
  const states = new Set(watch.map(w => w.state).filter(s => /^[A-Z]{2}$/.test(s)));
  if (Object.keys(extra).length) states.add('GA');
  let sentNow = 0;
  const out = [];
  for (const st of states) {
    let data;
    try {
      const r = await f(NWS + '/alerts/active?area=' + st, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } });
      if (!r.ok) continue;
      data = await r.json();
    } catch (e) { continue; }
    for (const ft of ((data && data.features) || [])) {
      const p = ft.properties || {};
      if (!STORM_EVENTS.test(p.event || '') || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
      const ugc = new Set((p.geocode && p.geocode.UGC) || []);
      const hit = watch.filter(w => ugc.has(w.county) || ugc.has(w.zone));
      const same = ((p.geocode && p.geocode.SAME) || []).filter(c => extra[c]);
      if (!hit.length && !same.length) continue;
      const id = String(p.id || ft.id || '').slice(-120);
      if (!id || await env.DB.prepare('SELECT id FROM storms WHERE id = ?1').bind(id).first()) continue;
      // An update of a warning we already sent: remembered, not sent again.
      const refs = (p.references || []).map(x => String(x.identifier || x['@id'] || '').slice(-120)).filter(Boolean);
      let isUpdate = false;
      for (const ref of refs) { if (await env.DB.prepare('SELECT id FROM storms WHERE id = ?1').bind(ref).first()) { isUpdate = true; break; } }
      const counties = [...new Set(hit.map(w => w.label || w.county).concat(same.map(c => extra[c] + ' County, GA')))];
      const row = { id, at: new Date(now).toISOString(), event: p.event, grp: stormGroup(p.event), counties: counties.join('; '), clients: [...new Set(hit.map(w => w.client_id))].join(', '),
        businesses: [...new Set(hit.map(w => w.business || w.client_id))].join(', '), headline: String(p.headline || '').replace(/\s+/g, ' ').slice(0, 300), ends: p.ends || p.expires || '', link: 'https://alerts.weather.gov' };
      let sent = isUpdate ? 'update' : 'new';
      let drafted = 0;
      if (!isUpdate) for (const w of hit) { try { if (await draftFor(env, w, row, now, extra)) drafted++; } catch (e) { /* the push still says it */ } }
      row.drafted = drafted;
      if (!isUpdate && sentNow < 6) {
        sentNow++;
        if (h.push) await h.push(row).catch(() => {});
        if (h.mail) sent = await h.mail(row).catch(e => 'failed: ' + String((e && e.message) || e).slice(0, 120));
      }
      await env.DB.prepare('INSERT OR IGNORE INTO storms (id, at, event, grp, counties, headline, ends, link, sent, clients) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
        .bind(row.id, row.at, row.event, row.grp, row.counties, row.headline, row.ends, row.link, sent, row.clients).run().catch(() => {});
      out.push(row);
    }
  }
  // When the warnings were last read, for the app's resting card ("Last checked 4 minutes ago").
  await env.DB.prepare("INSERT OR REPLACE INTO storm_meta (k, v) VALUES ('checked', ?1)").bind(new Date(now).toISOString()).run().catch(() => {});
  return { states: [...states], storms: out.length };
}

// ---------- the app's Storm Desk card (Brief 7) ----------
// Live: a storm post drafted in the last 48 hours (waiting for the owner's OK, or already approved), with the warning it
// was written for. Resting: the county being watched and when the warnings were last read. Growth and Pro only.
const WINDOW_MS = 48 * 3600e3;
function untilText(ends, now, tz) {
  const t = Date.parse(ends || '');
  if (!t) return '';
  const o = { timeZone: tz || 'America/New_York' };
  const time = new Date(t).toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, o));
  const day = d => new Date(d).toLocaleDateString('en-US', Object.assign({ year: 'numeric', month: 'numeric', day: 'numeric' }, o));
  const wd = new Date(t).toLocaleDateString('en-US', Object.assign({ weekday: 'long' }, o));
  const same = day(t) === day(now);
  return t > now ? 'until ' + time + (same ? '' : ' ' + wd) : 'ended ' + time + (same ? '' : ' ' + wd);
}
export function stormLine(event, county, ends, now, tz) {
  const u = untilText(ends, now, tz);
  return (event || 'Weather warning') + (county ? ' for ' + county : '') + (u ? ', ' + u : '') + '.';
}
export async function stormState(env, c, now, tz) {
  if (!c || !(c.tier === 'Growth' || c.tier === 'Pro') || c.client_id === 'always-open') return null;
  now = now || Date.now();
  await ensureStormDesk(env);
  const cid = c.client_id;
  const w = await env.DB.prepare('SELECT label, county, zone, at, why FROM storm_watch WHERE client_id = ?1').bind(cid).first().catch(() => null);
  const m = await env.DB.prepare("SELECT v FROM storm_meta WHERE k = 'checked'").first().catch(() => null);
  const since = new Date(now - WINDOW_MS).toISOString();
  const items = ((await env.DB.prepare("SELECT id, title, context, text, status, created, decided_at, decided_text FROM app_items WHERE client_id = ?1 AND kind = 'post' AND context LIKE 'Storm Desk%' AND status IN ('pending', 'approved') AND created > ?2 ORDER BY created DESC LIMIT 3").bind(cid, since).all().catch(() => ({ results: [] }))).results) || [];
  const active = [];
  for (const it of items) {
    const at = Date.parse(it.created) || now;
    const lo = new Date(at - 12 * 3600e3).toISOString(), hi = new Date(at + 3600e3).toISOString();
    const st = await env.DB.prepare("SELECT event, grp, counties, headline, ends FROM storms WHERE at >= ?1 AND at <= ?2 AND (clients LIKE ?3 OR counties LIKE ?4) ORDER BY at DESC LIMIT 1")
      .bind(lo, hi, '%' + cid + '%', '%' + ((w && w.label) || '\u0000') + '%').first().catch(() => null);
    const fromCtx = /^Storm Desk:\s*(.+?)(?: for (.+))?$/.exec(it.context || '') || [];
    const event = (st && st.event) || fromCtx[1] || 'Weather warning';
    const county = (w && w.label) || fromCtx[2] || (st && String(st.counties || '').split(';')[0].trim()) || '';
    const grp = (st && st.grp) || stormGroup(event);
    active.push({ id: it.id, sign: SIGN[grp] || 'STORM WARNING', event, county, ends: (st && st.ends) || '', line: stormLine(event, county, st && st.ends, now, tz),
      status: it.status === 'approved' ? 'approved' : 'pending', text: it.status === 'approved' ? (it.decided_text || it.text || '') : (it.text || ''), at: it.created || '', decidedAt: it.decided_at || '' });
  }
  return { county: (w && w.label) || '', zone: (w && w.zone) || '', lastCheck: (m && m.v) || '', finding: !(w && w.county), why: (w && w.why) || '', active };
}
