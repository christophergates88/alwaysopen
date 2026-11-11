// The Google posting queue, until Google turns on posting through its API (launch.js, gbp.js). Owners approve replies
// and posts in their app; every approved one, oldest first, across all clients, is listed on Always Open HQ under
// "Post on Google" (opshq.js), so Christopher posts them in a few taps: "Copy and open Google" puts the approved words
// on his clipboard and opens that business's reviews on Google, he pastes and posts, then taps "Posted". Posted ones
// are recorded in gbp_posted (result "by hand"), the same table the API uses, so nothing is ever posted twice and the
// monthly report counts them. A push at 10 AM and 4 PM Eastern says how many are waiting, only when there are any, and
// opens HQ at that list. Once the Google switch is on, anything approved after that moment is posted by the Worker
// itself and never shows up here. This used to be its own page at /ops/post; that address now sends you to HQ
// (Nov 11, 2026: "there's too many small places something could be"). Posted is still saved here (POST /ops/post).

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = 'https://alwaysopenoffice.com';

export function googleLink(it) {
  const pid = String(it.place_id || '').trim();
  const q = encodeURIComponent([it.business, it.town].filter(Boolean).join(' '));
  if (it.kind === 'post') return 'https://www.google.com/search?q=' + q;   // the manager panel there has "Add update"
  if (/^[A-Za-z0-9_-]{10,200}$/.test(pid)) return 'https://search.google.com/local/reviews?placeid=' + pid;
  return 'https://www.google.com/search?q=' + q + '+reviews';
}

// What is waiting: approved, not on Yelp, not posted yet (by hand or by the API), the last 30 days.
export async function queueItems(env, now) {
  now = now || Date.now();
  try { await (await import('./gbp.js')).ensureGbp(env); } catch (e) { /* the table may already be there */ }
  let since = now - 30 * 864e5, apiFrom = 0;
  try {
    if (await (await import('./launch.js')).isOn(env, 'google')) apiFrom = await (await import('./gbp.js')).onSince(env, now);
  } catch (e) { apiFrom = 0; }
  const { DEMO_ID } = await import('./demo.js');
  let rows = [];
  try {
    rows = ((await env.DB.prepare("SELECT i.id, i.client_id, i.kind, i.title, i.context, i.stars, i.text, i.decided_text, i.decided_at, i.decided_by, COALESCE(c.business, i.client_id) AS business, c.regulated AS regulated, " +
      "(SELECT place_id FROM rival_profile r WHERE r.client_id = i.client_id) AS place_id, (SELECT town FROM voice_lines v WHERE v.client_id = i.client_id LIMIT 1) AS town " +
      "FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id LEFT JOIN gbp_posted p ON p.item_id = i.id AND p.ok = 1 " +
      "WHERE i.status = 'approved' AND i.kind IN ('reply', 'review', 'post') AND p.item_id IS NULL AND i.decided_at > ?1 AND i.client_id != ?2 ORDER BY i.decided_at LIMIT 200")
      .bind(new Date(since).toISOString(), DEMO_ID).all()).results) || [];
  } catch (e) {
    // rival_profile may not exist yet on a fresh database: the same list without the place id
    rows = ((await env.DB.prepare("SELECT i.id, i.client_id, i.kind, i.title, i.context, i.stars, i.text, i.decided_text, i.decided_at, i.decided_by, COALESCE(c.business, i.client_id) AS business, c.regulated AS regulated, '' AS place_id, " +
      "(SELECT town FROM voice_lines v WHERE v.client_id = i.client_id LIMIT 1) AS town FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id LEFT JOIN gbp_posted p ON p.item_id = i.id AND p.ok = 1 " +
      "WHERE i.status = 'approved' AND i.kind IN ('reply', 'review', 'post') AND p.item_id IS NULL AND i.decided_at > ?1 AND i.client_id != ?2 ORDER BY i.decided_at LIMIT 200")
      .bind(new Date(since).toISOString(), DEMO_ID).all()).results) || [];
  }
  // A regulated client's edited reply waits for a compliance look first, the same hold gbp.js applies before posting.
  let held = 0;
  const { isYelp } = await import('./gbp.js');
  const out = rows.filter(r => !isYelp(r))
    .filter(r => !(apiFrom && Date.parse(r.decided_at || 0) > apiFrom))
    .filter(r => { if (heldForCompliance(r)) { held++; return false; } return true; })
    .map(r => ({ id: r.id, client: r.client_id, business: r.business, kind: r.kind === 'post' ? 'post' : 'reply', title: r.title || '', review: r.context || '', stars: +r.stars || 0,
      words: String(r.decided_text || r.text || ''), approvedAt: r.decided_at || '', by: r.decided_by || '', link: googleLink({ kind: r.kind === 'post' ? 'post' : 'reply', place_id: r.place_id, business: r.business, town: r.town }) }));
  out.held = held;
  return out;
}
export const heldForCompliance = r => !!(+r.regulated && String(r.decided_text || '').trim() && String(r.decided_text).trim() !== String(r.text || '').trim());

export async function markPosted(env, id, now) {
  const it = await env.DB.prepare("SELECT i.id, i.client_id, i.kind, i.text, i.decided_text, c.regulated FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id WHERE i.id = ?1 AND i.status = 'approved'").bind(String(id || '').slice(0, 120)).first();
  if (!it || heldForCompliance(it)) return false;
  await (await import('./gbp.js')).ensureGbp(env);
  await env.DB.prepare("INSERT INTO gbp_posted (item_id, client_id, kind, target, ok, tries, result, at) VALUES (?1, ?2, ?3, '', 1, 1, 'by hand', ?4) ON CONFLICT(item_id) DO UPDATE SET ok = 1, result = 'by hand', at = excluded.at")
    .bind(it.id, it.client_id, it.kind === 'post' ? 'post' : 'reply', new Date(now || Date.now()).toISOString()).run();
  return true;
}

export async function handlePostQueue(req, env, url) {
  const { boardOk } = await import('./opsboard.js');
  const tok = url.searchParams.get('t') || '';
  if (!(await boardOk(env, tok))) return new Response('Not found', { status: 404 });
  if (req.method === 'POST') {
    let b = {}; try { b = await req.json(); } catch (e) {}
    const ok = await markPosted(env, b.id);
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  // the list lives on Always Open HQ now; an old link or push lands on it there, with a fresh link
  const fresh = await (await import('./opsboard.js')).boardToken(env);
  return new Response(null, { status: 302, headers: { location: SITE + '/ops/hq?t=' + fresh + '#google', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

// 10 AM and 4 PM Eastern, from the 10-minute cron: one push when something is waiting.
function eastern(now) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const o = {}; for (const p of f.formatToParts(new Date(now))) o[p.type] = p.value;
  return { day: o.year + '-' + o.month + '-' + o.day, hour: +o.hour % 24 };
}
export async function queuePush(env, now, h) {
  now = now || Date.now(); h = h || {};
  const { day, hour } = eastern(now);
  const slot = hour >= 16 ? 'pm' : hour >= 10 ? 'am' : '';
  if (!slot) return { skipped: 'not yet' };
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS mailin_seen (k TEXT PRIMARY KEY, at TEXT)').run();
  const seen = await env.DB.prepare('SELECT 1 AS x FROM mailin_seen WHERE k = ?1').bind('postq:' + day + ':' + slot).first();
  if (seen) return { skipped: 'sent' };
  const items = await queueItems(env, now);
  await env.DB.prepare('INSERT OR IGNORE INTO mailin_seen (k, at) VALUES (?1, ?2)').bind('postq:' + day + ':' + slot, new Date(now).toISOString()).run();
  if (!items.length) return { waiting: 0 };
  const tok = await (await import('./opsboard.js')).boardToken(env);
  const replies = items.filter(i => i.kind === 'reply').length, posts = items.length - replies;
  const what = [replies ? replies + (replies === 1 ? ' reply' : ' replies') : '', posts ? posts + (posts === 1 ? ' post' : ' posts') : ''].filter(Boolean).join(' and ');
  const biz = [...new Set(items.map(i => i.business))];
  const ping = h.ping || (await import('./app.js')).opsPing;
  await ping(env, what + ' ready to post on Google', 'Approved by ' + (biz.length > 3 ? biz.length + ' businesses' : biz.join(', ')) + '. About ' + Math.max(1, Math.round(items.length * 0.5)) + ' min: copy, paste, tap Posted.', 'default', ['memo'], SITE + '/ops/hq?t=' + tok + '#google');
  return { waiting: items.length };
}
