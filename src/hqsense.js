// Gates HQ home sensing. The Gates HQ agent on Christopher's Mac listens to the Wi-Fi sensing boards in the house
// (ESP32-S3 running RuView's CSI firmware: each board reports presence, motion and breathing once a second) and to
// which phones are on the home Wi-Fi. Every few seconds it posts a snapshot here; once a minute, per-room minutes;
// and events (movement started, someone got home, alerts). His Gates HQ page reads them from D1 and draws the house.
// Mac key only. GET returns the settings the page saves (room names and places, alerts, which phone is whose).

async function ensure(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_kv (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_sense_min (m TEXT, room TEXT, motion REAL, present REAL, breath REAL, PRIMARY KEY (m, room))').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_sense_ev (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, room TEXT, who TEXT, text TEXT, level TEXT)').run();
}

export async function handleHqSense(req, env, json) {
  await ensure(env);
  if (req.method === 'GET') {
    const row = await env.DB.prepare("SELECT v FROM hq_kv WHERE k = 'sensecfg'").first();
    let cfg = {}; try { cfg = JSON.parse((row && row.v) || '{}'); } catch (e) {}
    return json({ ok: true, cfg });
  }
  if (req.method !== 'POST') return json({ ok: false }, 404);
  const body = await req.text();
  if (body.length > 200000) return json({ ok: false, error: 'too big' }, 413);
  let b; try { b = JSON.parse(body); } catch (e) { return json({ ok: false, error: 'not json' }, 400); }
  const now = new Date().toISOString(), stmts = [];
  if (b.snap) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('sense', ?1, ?2)").bind(now, JSON.stringify(b.snap).slice(0, 60000)));
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  for (const r of (b.minutes || []).slice(0, 400)) {
    if (!r || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.m || '')) continue;
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO hq_sense_min (m, room, motion, present, breath) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(r.m, String(r.room || '').slice(0, 30), num(r.motion), num(r.present), num(r.breath)));
  }
  for (const e of (b.events || []).slice(0, 100)) {
    if (!e || typeof e.at !== 'string') continue;
    stmts.push(env.DB.prepare('INSERT INTO hq_sense_ev (at, kind, room, who, text, level) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(e.at.slice(0, 25), String(e.kind || '').slice(0, 20), String(e.room || '').slice(0, 30), String(e.who || '').slice(0, 30), String(e.text || '').slice(0, 200), String(e.level || 'info').slice(0, 10)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (Math.random() < 0.02) {
    const cut = new Date(Date.now() - 45 * 864e5).toISOString();
    await env.DB.prepare('DELETE FROM hq_sense_min WHERE m < ?1').bind(cut.slice(0, 16)).run();
    await env.DB.prepare('DELETE FROM hq_sense_ev WHERE at < ?1').bind(cut).run();
  }
  const row = await env.DB.prepare("SELECT v FROM hq_kv WHERE k = 'sensecfg'").first();
  let cfg = {}; try { cfg = JSON.parse((row && row.v) || '{}'); } catch (e) {}
  return json({ ok: true, cfg });
}
