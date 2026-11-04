// The Google posting queue, until Google turns on posting through its API (launch.js, gbp.js). Owners approve replies
// and posts in their app; this page lists every approved one, oldest first, across all clients, so Christopher posts
// them in a few taps: "Copy and open Google" puts the approved words on his clipboard and opens that business's reviews
// on Google, he pastes and posts, then taps "Posted". Posted ones are recorded in gbp_posted (result "by hand"), the same
// table the API uses, so nothing is ever posted twice and the monthly report counts them. A push at 10 AM and 4 PM
// Eastern says how many are waiting, only when there are any. Once the Google switch is on, anything approved after
// that moment is posted by the Worker itself and never shows up here.

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
  const out = rows.filter(r => !/yelp/i.test(String(r.context || '') + ' ' + String(r.title || '')))
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

function ago(iso, now) {
  const m = Math.max(0, Math.round((now - Date.parse(iso || 0)) / 60000));
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 36 ? h + (h === 1 ? ' hour ago' : ' hours ago') : Math.round(h / 24) + ' days ago';
}

export function queuePage(items, tok, now) {
  now = now || Date.now();
  const n = items.length, mins = Math.max(1, Math.round(n * 0.5));
  const cards = items.map(it => {
    const head = it.kind === 'post' ? 'Google post' : (it.stars ? '★'.repeat(it.stars) + '☆'.repeat(5 - it.stars) + ' from ' + esc(it.title || 'a customer') : 'Review from ' + esc(it.title || 'a customer'));
    return '<article class="q" data-id="' + esc(it.id) + '"><div class="top"><b>' + esc(it.business) + '</b><span>' + esc(ago(it.approvedAt, now)) + '</span></div>' +
      '<p class="hd">' + head + '</p>' + (it.kind !== 'post' && it.review ? '<p class="rv">“' + esc(it.review.slice(0, 400)) + (it.review.length > 400 ? '…' : '') + '”</p>' : '') +
      '<p class="lab">' + (it.kind === 'post' ? 'The approved post' : 'The approved reply') + '</p><div class="words">' + esc(it.words) + '</div>' +
      '<div class="acts"><a class="go" href="' + esc(it.link) + '" target="_blank" rel="noopener" data-words="' + esc(it.words) + '">Copy and open Google</a><button class="done" type="button">Posted</button></div>' +
      '<p class="how">' + (it.kind === 'post' ? 'On Google, tap Add update, paste, and post.' : 'On Google, find this review, tap Reply, paste, and post.') + '</p></article>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>Post on Google · Always Open</title><style>' +
    ':root{--bg:#0F131B;--card:#171C27;--line:#262E40;--ink:#ECEEF3;--mute:#A3ACBF;--sign:#FF6A5E;--ok:#5CC9A4}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    'main{max-width:640px;margin:0 auto;padding:22px 16px 60px}h1{font-size:1.7rem;margin:0 0 4px}.sub{color:var(--mute);margin:0 0 20px}' +
    '.count{display:inline-block;font-weight:800;color:#fff;text-shadow:0 0 10px rgba(255,106,94,.8)}' +
    '.q{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:0 0 14px;transition:opacity .35s,transform .35s}.q.gone{opacity:0;transform:translateX(24px)}' +
    '.top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.top span{color:var(--mute);font-size:.85rem}.hd{margin:6px 0 2px;color:#FFB4AC;font-weight:600}.rv{margin:4px 0 0;color:var(--mute);font-size:.95rem}' +
    '.lab{margin:12px 0 4px;font-size:.8rem;color:var(--mute);text-transform:none}.words{background:#0B0E14;border:1px solid var(--line);border-radius:12px;padding:12px;white-space:pre-wrap;user-select:all}' +
    '.acts{display:flex;gap:10px;margin-top:12px}.acts a,.acts button{flex:1;min-height:52px;padding:0 12px;border-radius:12px;font-family:inherit;font-weight:700;font-size:16px;line-height:1.2;text-align:center;display:flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer}.acts a{flex:1.4}' +
    '.go{background:var(--sign);color:#1A0605;border:0}.done{background:transparent;color:var(--ok);border:2px solid var(--ok)}.how{margin:8px 0 0;color:var(--mute);font-size:.85rem}' +
    '.empty{text-align:center;padding:60px 10px;color:var(--mute)}.empty b{display:block;font-size:1.6rem;color:var(--ok);margin-bottom:6px}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#fff;color:#111;padding:10px 16px;border-radius:99px;font-weight:600;opacity:0;transition:opacity .2s}.toast.on{opacity:1}' +
    '</style></head><body><main><h1>Post on Google</h1><p class="sub" id="sub">' + (n ? '<span class="count" id="n">' + n + '</span> approved by the owners, waiting for Google. About ' + mins + (mins === 1 ? ' minute' : ' minutes') + '.' : '') + '</p>' +
    (+items.held ? '<p class="sub">' + items.held + (items.held === 1 ? ' edited reply from a regulated client is' : ' edited replies from regulated clients are') + ' held for a compliance look first, so ' + (items.held === 1 ? 'it is' : 'they are') + ' not here.</p>' : '') +
    (n ? cards : '') + '<div class="empty" id="empty"' + (n ? ' hidden' : '') + '><b>All caught up</b>Nothing is waiting for Google.</div></main><div class="toast" id="toast"></div>' +
    '<script>(function(){var tok=' + JSON.stringify(String(tok || '')) + ',left=' + n + ';function toast(t){var e=document.getElementById("toast");e.textContent=t;e.classList.add("on");setTimeout(function(){e.classList.remove("on")},1800)}' +
    'document.querySelectorAll(".go").forEach(function(a){a.addEventListener("click",function(){var w=a.getAttribute("data-words");try{navigator.clipboard.writeText(w).then(function(){toast("Copied. Paste it on Google.")},function(){toast("Hold on the words to copy them.")})}catch(e){toast("Hold on the words to copy them.")}})});' +
    'document.querySelectorAll(".done").forEach(function(b){b.addEventListener("click",function(){var q=b.closest(".q");b.disabled=true;b.textContent="Saving…";fetch("/ops/post?t="+encodeURIComponent(tok),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:q.getAttribute("data-id")})}).then(function(r){return r.json()}).then(function(j){if(!j.ok)throw 0;q.classList.add("gone");setTimeout(function(){q.remove()},350);left--;var c=document.getElementById("n");if(c)c.textContent=left;if(!left){document.getElementById("sub").textContent="";document.getElementById("empty").hidden=false}}).catch(function(){b.disabled=false;b.textContent="Posted";toast("Could not save. Try again.")})})})})();</script></body></html>';
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
  const items = await queueItems(env);
  return new Response(queuePage(items, tok), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
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
  await ping(env, what + ' ready to post on Google', 'Approved by ' + (biz.length > 3 ? biz.length + ' businesses' : biz.join(', ')) + '. About ' + Math.max(1, Math.round(items.length * 0.5)) + ' min: copy, paste, tap Posted.', 'default', ['memo'], SITE + '/ops/post?t=' + tok);
  return { waiting: items.length };
}
