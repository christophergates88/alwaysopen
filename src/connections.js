// Google connections that ask to be fixed. A refresh token that Google refuses (revoked, expired, the consent screen
// still in Testing) used to fail quietly: review drafts stopped, visits stopped landing on the calendar, nobody was told.
// Now each refusal is written down on the connection, the owner gets one push and a card with a Connect button, and
// Christopher gets one alert. Once a day the cron refreshes every connection so an expired one is found within a day.
const TABLES = { calendar: 'gcal_tokens', profile: 'gbp_tokens' };
const DAY = 864e5;
const ready = new WeakSet();
export async function ensureConnections(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS connection_health (client_id TEXT, kind TEXT, broken_at TEXT, why TEXT, checked_at TEXT, told_at TEXT, PRIMARY KEY (client_id, kind))').run();
  ready.add(env.DB);
}
// Google's answer to a refresh that will never work again (as opposed to a blip).
export function refusedForGood(status, body) {
  const err = String((body && body.error) || '');
  return status === 400 || status === 401 ? /invalid_grant|invalid_client|unauthorized_client|deleted_client/.test(err) : false;
}
export async function markBroken(env, cid, kind, why) {
  await ensureConnections(env);
  const now = new Date().toISOString();
  const r = await env.DB.prepare('INSERT INTO connection_health (client_id, kind, broken_at, why, checked_at) VALUES (?1, ?2, ?3, ?4, ?3) ON CONFLICT(client_id, kind) DO UPDATE SET broken_at = COALESCE(connection_health.broken_at, excluded.broken_at), why = excluded.why, checked_at = excluded.checked_at RETURNING told_at, broken_at').bind(cid, kind, now, String(why || '').slice(0, 120)).first();
  return { fresh: !(r && r.told_at) };
}
export async function markOk(env, cid, kind, now) {
  await ensureConnections(env);
  await env.DB.prepare('INSERT INTO connection_health (client_id, kind, broken_at, why, checked_at, told_at) VALUES (?1, ?2, NULL, \'\', ?3, NULL) ON CONFLICT(client_id, kind) DO UPDATE SET broken_at = NULL, why = \'\', checked_at = excluded.checked_at, told_at = NULL').bind(cid, kind, new Date(now || Date.now()).toISOString()).run();
}
// For the app: which connections need the owner, with a plain line each.
export async function brokenFor(env, cid) {
  await ensureConnections(env);
  const rows = ((await env.DB.prepare('SELECT kind, broken_at, why FROM connection_health WHERE client_id = ?1 AND broken_at IS NOT NULL').bind(cid).all()).results) || [];
  return rows.map(r => ({ kind: r.kind, since: r.broken_at, text: r.kind === 'calendar' ? 'Google Calendar stopped answering, so Max can’t see your busy times or put visits on it. Connect it again and it picks right back up.' : 'Google stopped answering for your Business Profile, so new reviews aren’t being drafted. Connect it again and we catch up.' }));
}
// Once a day, refresh every connection the way the real calls do, so a dead one is found before an owner notices.
// `refresh(kind, cid)` returns { ok, status, body }; `push(cid, note)` and `alert(type, who, detail)` tell people.
export async function connectionsCron(env, now, h) {
  now = now || Date.now();
  await ensureConnections(env);
  const out = { checked: 0, broken: 0, told: 0 };
  for (const kind of Object.keys(TABLES)) {
    let rows = [];
    try { rows = ((await env.DB.prepare('SELECT t.client_id, c.business FROM ' + TABLES[kind] + ' t LEFT JOIN app_clients c ON c.client_id = t.client_id LEFT JOIN connection_health h ON h.client_id = t.client_id AND h.kind = ?1 WHERE h.checked_at IS NULL OR h.checked_at < ?2').bind(kind, new Date(now - DAY).toISOString()).all()).results) || []; } catch (e) { rows = []; }
    for (const r of rows) {
      out.checked++;
      let res; try { res = await h.refresh(kind, r.client_id); } catch (e) { res = { ok: false, status: 0, body: {} }; }
      if (res.ok) { await markOk(env, r.client_id, kind); continue; }
      if (!refusedForGood(res.status, res.body)) { await env.DB.prepare('INSERT INTO connection_health (client_id, kind, checked_at) VALUES (?1, ?2, ?3) ON CONFLICT(client_id, kind) DO UPDATE SET checked_at = excluded.checked_at').bind(r.client_id, kind, new Date(now).toISOString()).run(); continue; }   // a blip: try again tomorrow
      out.broken++;
      const m = await markBroken(env, r.client_id, kind, (res.body && res.body.error) || ('Google answered ' + res.status));
      if (m.fresh) {
        out.told++;
        await env.DB.prepare('UPDATE connection_health SET told_at = ?1 WHERE client_id = ?2 AND kind = ?3').bind(new Date(now).toISOString(), r.client_id, kind).run();
        if (r.client_id !== 'always-open' && h.push) await h.push(r.client_id, { title: kind === 'calendar' ? 'Reconnect Google Calendar' : 'Reconnect your Google Business Profile', body: kind === 'calendar' ? 'Google stopped answering, so Max can’t see your calendar. Open the app and tap Connect.' : 'Google stopped answering, so new reviews aren’t being drafted. Open the app and tap Connect.' });
        if (h.alert) await h.alert('google-connection:' + kind, r.client_id, (r.business || r.client_id) + ': the Google ' + kind + ' connection was refused (' + ((res.body && res.body.error) || res.status) + '). The owner has a reconnect card and one push. If several break at once, check that the Google Cloud consent screen is published, not in Testing.');
      }
    }
  }
  return out;
}
