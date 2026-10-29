// The morning all-clear: one push to Christopher at 7 AM Eastern every day. "All checks green" plus yesterday's counts.
// Its absence is itself a signal, and the outside monitor backs that up. A red check changes the first line.
const DAY = 864e5;
const ready = new WeakSet();
async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS morning_sent (day TEXT PRIMARY KEY, at TEXT)').run();
  ready.add(env.DB);
}
// Eastern-time pieces of a moment.
export function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(now).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24 };
}
// Yesterday's counts and what is waiting, across every real client.
export async function morningCounts(env, now) {
  const from = new Date(now - DAY).toISOString(), to = new Date(now).toISOString();
  const q = async (sql, ...a) => { try { const r = await env.DB.prepare(sql).bind(...a).first(); return +(r && r.n) || 0; } catch (e) { return 0; } };
  return {
    calls: await q("SELECT COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND at < ?2 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND client_id NOT IN ('demo-plumbing', 'always-open')", from, to),
    leads: await q("SELECT COUNT(*) AS n FROM leads WHERE at >= ?1 AND at < ?2 AND status != 'spam'", from, to),
    drafts: await q("SELECT COUNT(*) AS n FROM app_items WHERE status = 'pending' AND client_id != 'demo-plumbing'"),
    booked: await q("SELECT COUNT(*) AS n FROM biz_jobs WHERE stage = 'booked' AND updated >= ?1 AND updated < ?2 AND client_id != 'demo-plumbing'", from, to),
    errors: await q("SELECT COUNT(*) AS n FROM errors WHERE at >= ?1 AND at < ?2", from, to)
  };
}
// night: [{type, n}] problems that arrived silently overnight (ops.js), so a quiet night never hides one.
export function morningText(health, c, night, drill) {
  const bad = (health.checks || []).filter(x => !x.ok).map(x => x.name);
  const first = bad.length ? 'Needs a look: ' + bad.join(', ') + '.' : 'All checks green.';
  const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  return { title: 'Always Open: ' + (bad.length ? bad.length + (bad.length === 1 ? ' check is red' : ' checks are red') : 'all good'),
    body: first + ' Yesterday: ' + n(c.calls, 'call', 'calls') + ', ' + n(c.leads, 'lead', 'leads') + ', ' + n(c.booked, 'job booked', 'jobs booked') + (c.errors ? ', ' + n(c.errors, 'error', 'errors') : '') + '. ' + n(c.drafts, 'draft', 'drafts') + ' waiting.' + overnight(night) + (drill ? ' ' + drill : '') };
}
function overnight(night) {
  const list = (night || []).filter(x => x && x.type);
  if (!list.length) return '';
  const total = list.reduce((a, x) => a + (+x.n || 1), 0);
  return ' Overnight, quietly: ' + list.slice(0, 5).map(x => x.type + (+x.n > 1 ? ' (' + x.n + ')' : '')).join(', ') + (list.length > 5 ? ' and ' + (list.length - 5) + ' more' : '') + '. ' + (total === 1 ? 'It is' : 'They are') + ' in your email.';
}
// What arrived silently since yesterday morning, then cleared for tonight.
export async function nightList(env) {
  try {
    const rows = ((await env.DB.prepare('SELECT type, COUNT(*) AS n FROM ops_night GROUP BY type ORDER BY MIN(id)').all()).results) || [];
    await env.DB.prepare('DELETE FROM ops_night').run();
    return rows;
  } catch (e) { return []; }
}
// Runs every 10 minutes; sends once per Eastern day, in the 7 AM hour.
export async function morningCron(env, now, h) {
  now = now || Date.now();
  const e = eastern(now);
  if (e.hour !== 7) return { skipped: 'not the hour' };
  await ensure(env);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO morning_sent (day, at) VALUES (?1, ?2)').bind(e.day, new Date(now).toISOString()).run();
  if (!(r.meta && r.meta.changes)) return { skipped: 'sent today' };
  const health = await h.health();
  let drill = '';
  try { drill = await (await import('./drill.js')).drillLine(env, now); } catch (e) { drill = ''; }
  const text = morningText(health, await morningCounts(env, now), await nightList(env), drill);
  await h.ping(text.title, text.body, health.ok ? 'default' : 'high', health.ok ? 'sunrise' : 'warning');
  return { sent: true, ok: health.ok };
}
