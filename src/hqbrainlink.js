// The link between this worker and Gates HQ's own brain (a separate, private worker: gates-hq-brain).
// 1. The brain checks the Mac's key against a hash kept here (hq_kv 'mac-key-sha'), so the key itself is never copied.
// 2. Each watches the other: if the brain's /health fails twice in a row (20 minutes) during waking hours, Christopher
//    gets one push, and one more when it's back. Nothing is said before the brain has answered once.
export const BRAIN_URL = 'https://gates-hq-brain.christophergates-cg.workers.dev';
const hourET = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(ms))) % 24;

export async function brainLink(env, now, ping, fetcher = fetch) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hq_kv (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  const nowIso = new Date(now).toISOString();
  if (env.LEADS_KEY) {
    const old = await env.DB.prepare("SELECT at FROM hq_kv WHERE k = 'mac-key-sha'").first();
    if (!old || now - Date.parse(old.at || 0) > 864e5) {
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.LEADS_KEY)))].map(b => b.toString(16).padStart(2, '0')).join('');
      await env.DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('mac-key-sha', ?1, ?2)").bind(nowIso, h).run();
    }
  }
  const row = await env.DB.prepare("SELECT v FROM hq_kv WHERE k = 'brain-watch'").first();
  let st = {}; try { st = JSON.parse(row?.v || '{}'); } catch (e) { st = {}; }
  let ok = false;
  try { const r = await fetcher(BRAIN_URL + '/health', { signal: AbortSignal.timeout(10000) }); ok = r.status === 200 && (await r.json()).ok === true; } catch (e) { ok = false; }
  const awake = hourET(now) >= 7 && hourET(now) < 22;
  let said = '';
  if (ok) {
    if (st.alerted) { await ping('Gates HQ brain is back', 'It is running again; your Gates HQ screens are current.'); said = 'back'; }
    st = { seenOk: true, fails: 0, alerted: false, okAt: nowIso };
  } else if (st.seenOk) {
    st.fails = (st.fails || 0) + 1;
    if (st.fails >= 2 && !st.alerted && awake) {
      await ping('Gates HQ brain stopped', `It last answered ${st.okAt ? new Date(st.okAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : 'a while ago'}. Your Gates HQ screens may be out of date until it's back.`);
      st.alerted = true; said = 'stopped';
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('brain-watch', ?1, ?2)").bind(nowIso, JSON.stringify(st)).run();
  return said || (ok ? 'ok' : st.seenOk ? 'failing' : 'not deployed yet');
}
