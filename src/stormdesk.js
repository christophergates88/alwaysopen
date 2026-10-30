// Storm Desk, nationwide: each client is watched where their business is. Once per client (and again if they move),
// their location becomes a National Weather Service county and forecast zone (api.weather.gov/points); every 10 minutes
// the active warnings for each state that has clients are read and matched to those zones. A match drafts nothing by
// itself: Christopher gets the push and the email, and the Always Open check drafts storm posts for those clients, which
// the client approves.
const UA = 'AlwaysOpen Storm Desk (hello@alwaysopenoffice.com)';
const NWS = 'https://api.weather.gov';
const SKIP = new Set(['demo-plumbing', 'always-open']);
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
    env.DB.prepare('CREATE TABLE IF NOT EXISTS storms (id TEXT PRIMARY KEY, at TEXT, event TEXT, grp TEXT, counties TEXT, headline TEXT, ends TEXT, link TEXT, sent TEXT)')
  ]);
  try { await env.DB.prepare("ALTER TABLE storms ADD COLUMN clients TEXT DEFAULT ''").run(); } catch (e) { /* already there */ }
  ready.add(env.DB);
}
const ugcOf = url => String(url || '').split('/').pop();

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
  const watch = ((await env.DB.prepare("SELECT w.client_id, w.state, w.county, w.zone, w.label, c.business FROM storm_watch w JOIN app_clients c ON c.client_id = w.client_id WHERE w.county != '' AND c.active = 1 AND c.tier IN ('Growth', 'Pro')").all()).results) || [];
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
  return { states: [...states], storms: out.length };
}
