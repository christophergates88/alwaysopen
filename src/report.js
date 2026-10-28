// The monthly report, on its own. On the 2nd of each month (or the first pass after), every active client gets last
// month's report built from our own records: reviews that came in, replies approved (and posted), posts, and Max's calls.
// Google's own numbers (calls, direction requests, website clicks) are filled in when the app reads it (gbp.mergeMonths).
// A complete record HQ already wrote for that month is kept as it is; a partial one written mid-month is replaced.
// The owner gets one push when it's ready.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PER_PASS = 10;

export function monthOf(now) {
  const d = new Date(now), start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { key: start.toISOString().slice(0, 7), start: start.toISOString(), end: end.toISOString(), label: MONTHS[start.getUTCMonth()] + ' ' + start.getUTCFullYear(), prevKey: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)).toISOString().slice(0, 7) };
}
const day = iso => { const t = Date.parse(iso || ''); return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : ''; };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Was the client with us during the month? Their first sign of life (signup, first item, call or job) must come before
// the month ended. Pure, for tests.
export function wasClient(firstIso, m) {
  const t = Date.parse(firstIso || '');
  return !!t && t < Date.parse(m.end);
}
// Anything worth a push? An empty month is still written (the app shows it), but quietly.
export function hasNews(data) {
  const st = (data && data.stats) || {};
  return !!(+st.reviews || +st.posts || +(data && data.note ? 1 : 0));
}

let ready = false;
async function ensureRuns(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS report_runs (client_id TEXT NOT NULL, month TEXT NOT NULL, at TEXT, result TEXT, PRIMARY KEY (client_id, month))").run();
  ready = true;
}
async function firstSeen(env, cid) {
  const one = async sql => { try { const r = await env.DB.prepare(sql).bind(cid).first(); return (r && r.t) || ''; } catch (e) { return ''; } };
  const all = [await one('SELECT created AS t FROM billing WHERE client_id = ?1'), await one('SELECT MIN(created) AS t FROM app_items WHERE client_id = ?1'),
    await one('SELECT MIN(at) AS t FROM app_calls WHERE client_id = ?1 AND test = 0'), await one('SELECT MIN(at) AS t FROM app_jobs WHERE client_id = ?1')].filter(x => Date.parse(x));
  return all.sort((a, b) => Date.parse(a) - Date.parse(b))[0] || '';
}

// Is the row HQ (or we) already wrote for this month complete? Made after the month ended = complete.
export function isComplete(data, m) {
  const r = data && data.record;
  if (!r || !r.made) return false;
  const t = Date.parse(r.made);
  return !!t && t >= Date.parse(m.end) - 864e5;
}

// Build one client's month from rows. Pure, for tests.
export function buildMonth(c, m, rows, prevStats, now) {
  const reviews = rows.reviews || [], posts = rows.posts || [], posted = new Set(rows.posted || []);
  const replied = reviews.filter(r => r.status === 'approved' || r.status === 'closed');
  const rated = reviews.filter(r => +r.stars > 0);
  const stats = { reviews: reviews.length, rating: null, count: null, replies: replied.length, posts: posts.length, calls: null, clicks: null, directions: null,
    newAvg: rated.length ? Math.round(rated.reduce((a, r) => a + +r.stars, 0) / rated.length * 10) / 10 : null };
  const made = day(new Date(now).toISOString());
  const revs = reviews.map(r => ({
    d: day(r.created), head: (+r.stars ? r.stars + (+r.stars === 1 ? ' star' : ' stars') + ' · ' : '') + (r.title || 'A customer'),
    q: r.context ? 'Review: ' + clip(r.context, 400) : '',
    t: (r.status === 'approved' || r.status === 'closed') ? 'Reply ' + (posted.has(r.id) ? 'posted' : 'approved') + ' ' + day(r.decided_at) + ': ' + clip(r.decided_text || r.text, 600) : (r.status === 'skipped' ? 'No reply, by the owner’s choice.' : 'Reply waiting for approval.'),
    by: r.decided_by ? 'Approved by ' + r.decided_by + (r.decided_by === 'Always Open' ? '' : ' in the app') : ''
  }));
  const ps = posts.map(p => ({ d: day(p.decided_at || p.created), head: 'Google post' + (p.title ? ' · ' + clip(p.title, 60) : ''), t: clip(p.decided_text || p.text, 600), by: p.decided_by ? 'Approved by ' + p.decided_by : '' }));
  const calls = +rows.calls || 0;
  const bits = [];
  if (calls) bits.push('Max answered ' + calls + (calls === 1 ? ' call.' : ' calls.'));
  if (reviews.length) bits.push(reviews.length + (reviews.length === 1 ? ' new review' : ' new reviews') + (replied.length === reviews.length ? ', every one with a reply.' : ', ' + replied.length + ' with a reply so far.'));
  if (posts.length) bits.push(posts.length + (posts.length === 1 ? ' post went up.' : ' posts went up.'));
  return {
    label: m.label, stats, prev: prevStats ? Object.assign({ label: '' }, prevStats) : null, note: bits.join(' '),
    record: { intro: 'This file is a record of public communications for ' + (c.business || 'the business') + ' in ' + m.label + ': the public reviews of the business, the public replies posted, and the public posts published. It contains only what anyone can see online. Prepared by Always Open on ' + made + '.', cg: '', revs, posts: ps, made }
  };
}

async function oneClient(env, c, m, now) {
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const reviews = await all("SELECT id, title, context, stars, text, decided_text, decided_at, decided_by, status, created FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'review') AND created >= ?2 AND created < ?3 ORDER BY created", c.client_id, m.start, m.end);
  const posts = await all("SELECT id, title, text, decided_text, decided_at, decided_by, created FROM app_items WHERE client_id = ?1 AND kind = 'post' AND status IN ('approved', 'closed') AND COALESCE(decided_at, created) >= ?2 AND COALESCE(decided_at, created) < ?3 ORDER BY decided_at", c.client_id, m.start, m.end);
  const posted = (await all('SELECT item_id FROM gbp_posted WHERE client_id = ?1 AND ok = 1', c.client_id)).map(r => r.item_id);
  const calls = (await all("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam')", c.client_id, m.start, m.end))[0];
  const prevRow = await env.DB.prepare('SELECT data FROM app_months WHERE client_id = ?1 AND month = ?2').bind(c.client_id, m.prevKey).first().catch(() => null);
  let prev = null; try { const p = JSON.parse((prevRow && prevRow.data) || 'null'); prev = p && p.stats ? Object.assign({}, p.stats, { label: p.label || '' }) : null; } catch (e) {}
  const data = buildMonth(c, m, { reviews, posts, posted, calls: calls && calls.n }, prev, now);
  const json = JSON.stringify(data);
  await env.DB.prepare('INSERT OR REPLACE INTO app_months (client_id, month, data, hash, updated) VALUES (?1, ?2, ?3, ?4, ?5)').bind(c.client_id, m.key, json, 'auto:' + json.length, new Date(now).toISOString()).run();
  return data;
}

export async function monthReportCron(env, at) {
  const now = at || Date.now();
  if (new Date(now).getUTCDate() < 2) return { skipped: 'too early' };
  const m = monthOf(now);
  const { DEMO_ID } = await import('./demo.js');
  await ensureRuns(env);
  const clients = ((await env.DB.prepare('SELECT c.client_id, c.business, m.data, m.hash FROM app_clients c LEFT JOIN app_months m ON m.client_id = c.client_id AND m.month = ?1 LEFT JOIN report_runs r ON r.client_id = c.client_id AND r.month = ?1 WHERE c.active = 1 AND c.client_id != ?2 AND r.client_id IS NULL LIMIT ?3').bind(m.key, DEMO_ID, PER_PASS).all()).results) || [];
  const done = (cid, result) => env.DB.prepare('INSERT OR REPLACE INTO report_runs (client_id, month, at, result) VALUES (?1, ?2, ?3, ?4)').bind(cid, m.key, new Date(now).toISOString(), result).run();
  let made = 0;
  for (const c of clients) {
    let d = null; try { d = JSON.parse(c.data || 'null'); } catch (e) {}
    if (String(c.hash || '').startsWith('auto:') || isComplete(d, m)) { await done(c.client_id, 'kept'); continue; }
    if (!wasClient(await firstSeen(env, c.client_id), m)) { await done(c.client_id, 'not a client yet'); continue; }   // never a report for a month before they joined
    const data = await oneClient(env, c, m, now);
    made++;
    await done(c.client_id, hasNews(data) ? 'made' : 'made, quiet month');
    if (!hasNews(data)) continue;
    try { await (await import('./app.js')).pushClient(env, c.client_id, { aps: { alert: { title: 'Your ' + m.label.split(' ')[0] + ' report is ready', body: 'Calls, reviews, replies and posts for the month, with a record you can save as a PDF.' }, sound: 'default' }, screen: 'home' }); } catch (e) { /* the report is there either way */ }
  }
  return { made, month: m.key };
}
