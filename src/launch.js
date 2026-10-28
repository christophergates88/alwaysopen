// Launch watch: Google Business Profile API access and Meta's app review.
// Once an hour the worker checks whether each one has gone live. The first time one has, it switches it on in D1;
// the website and the app drop the matching "Coming soon" labels (pages are rewritten as they are served, so nothing
// has to be deployed), the features turn on, and Christopher gets a push and an email. A switch stays on once on.
//   google: needs Always Open's own Google account (the manager on client profiles) connected once from the HQ board.
//           The check reads that account's business accounts: Google refuses with a quota error until access is approved.
//   meta:   reads the app's approved permissions with the app's own token; on once pages_manage_posts is live.
// GBP_ON or META_ON in the worker's settings force a switch on, for testing or if a check ever misreads.
const late = p => import(p);
const pushOps = async (...a) => { try { return await (await late('./app.js')).opsPing(...a); } catch (e) { return 0; } };
const mailOps = async (...a) => { try { return await (await late('./app.js')).mailOwner(...a); } catch (e) { return 'off'; } };

export const FEATURES = ['google', 'meta'];
const HOUR = 3600e3;
const truthy = v => /^(1|true|on|yes)$/i.test(String(v || '').trim());

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS launch (k TEXT PRIMARY KEY, on_ INTEGER DEFAULT 0, at TEXT DEFAULT '', state TEXT DEFAULT '', detail TEXT DEFAULT '', checked TEXT DEFAULT '')").run();
  ready = true;
}

// Read the switches. Cached for a minute per worker instance so serving pages stays cheap.
let cache = null, cacheAt = 0;
export function forget() { cache = null; cacheAt = 0; }
export async function launchState(env) {
  if (cache && Date.now() - cacheAt < 60e3) return cache;
  const out = {};
  for (const k of FEATURES) out[k] = { on: false, at: '', state: '', detail: '', checked: '' };
  try {
    await ensure(env);
    const rows = ((await env.DB.prepare('SELECT k, on_, at, state, detail, checked FROM launch').all()).results) || [];
    for (const r of rows) if (out[r.k]) out[r.k] = { on: !!+r.on_, at: r.at || '', state: r.state || '', detail: r.detail || '', checked: r.checked || '' };
  } catch (e) { /* the forced switches below still apply */ }
  if (truthy(env.GBP_ON)) out.google.on = true;
  if (truthy(env.META_ON)) out.meta.on = true;
  cache = out; cacheAt = Date.now();
  return out;
}
export async function isOn(env, k) { return !!((await launchState(env))[k] || {}).on; }

async function save(env, k, patch) {
  await ensure(env);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO launch (k, on_, at, state, detail, checked) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(k) DO UPDATE SET on_ = CASE WHEN launch.on_ = 1 THEN 1 ELSE excluded.on_ END, at = CASE WHEN launch.at != '' THEN launch.at ELSE excluded.at END, state = excluded.state, detail = excluded.detail, checked = excluded.checked")
    .bind(k, patch.on ? 1 : 0, patch.on ? now : '', patch.state || '', String(patch.detail || '').slice(0, 600), now).run();
  forget();
}

// ---------------- the checks ----------------
// Google answers a read of the accounts list. Before approval the project's quota is 0, so the answer is a quota error.
export function readGoogle(status, body) {
  const t = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 200) return { state: 'live' };
  if (status === 401) return { state: 'needs_connect', detail: 'The Always Open Google connection expired. Connect it again from the HQ board.' };
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(t)) {
    const m = /project[s]?[ /=]+(\d{6,})/i.exec(t), api = (/([a-z]+\.googleapis\.com)/i.exec(t) || [])[1] || 'mybusinessaccountmanagement.googleapis.com';
    return { state: 'api_off', detail: 'Google approved access may be there, but the ' + api + ' API is turned off in the Cloud project. Turn it on: https://console.cloud.google.com/apis/library/' + api + (m ? '?project=' + m[1] : '') };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rateLimitExceeded/i.test(t)) return { state: 'waiting', detail: 'Google has not approved the access yet (the quota is still 0).' };
  if (status === 403) return { state: 'waiting', detail: 'Google refused the check (' + String(t).slice(0, 160) + ').' };
  return { state: 'error', detail: 'Google answered ' + status + '.' };
}
async function checkGoogle(env) {
  const gbp = await late('./gbp.js');
  const tok = await gbp.accessToken(env, gbp.AGENCY).catch(() => null);
  if (!tok) return { state: 'needs_connect', detail: 'Connect Always Open’s Google account once from the HQ board so the worker can tell when Google approves.' };
  const r = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', { headers: { authorization: 'Bearer ' + tok } });
  return readGoogle(r.status, await r.text().catch(() => ''));
}

const PAGE_PERMS = ['pages_manage_posts'];
export function readMeta(list) {
  const live = new Set((list || []).filter(x => String(x.status || '').toLowerCase() === 'live').map(x => x.permission));
  if (PAGE_PERMS.every(p => live.has(p))) return { state: 'live', detail: 'Approved: ' + [...live].filter(p => /^pages_|^instagram_/.test(p)).sort().join(', ') + '.', instagram: live.has('instagram_content_publish') };
  return { state: 'waiting', detail: 'Meta has not approved posting to Pages yet.' };
}
async function checkMeta(env) {
  if (!(env.META_APP_ID && env.META_APP_SECRET)) return { state: 'no_keys', detail: 'The Meta app keys are not set.' };
  const r = await fetch('https://graph.facebook.com/v21.0/' + encodeURIComponent(env.META_APP_ID) + '/permissions?limit=100&access_token=' + encodeURIComponent(env.META_APP_ID + '|' + env.META_APP_SECRET));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { state: 'error', detail: 'Meta answered ' + r.status + ': ' + String((j.error && j.error.message) || '').slice(0, 160) };
  return readMeta(j.data);
}

const NOTE = {
  google: ['Always Open: Google approved the Business Profile access',
    'Google approved it, so it is on now. Review replies and posts that owners approve go to Google on their own, new reviews get drafted even when the email check is down, and the monthly report fills in calls, direction requests and website clicks. Nothing for you to do.'],
  meta: ['Always Open: Meta approved the app',
    'Meta approved posting, so it is on now. The website no longer says Coming soon for Facebook and Instagram, owners can connect their Page in the app, and approved photo posts go there too. One check: at developers.facebook.com, open the Always Open app and make sure the App Mode switch at the top says Live.']
};
async function turnedOn(env, k, detail) {
  const [title, body] = NOTE[k];
  await pushOps(env, title, body + (detail ? '\n' + detail : ''), 'high', 'tada');
  await mailOps(env, title, body + (detail ? '\n\n' + detail : ''));
  if (k === 'meta') await tellOwners(env).catch(() => {});
  if (k === 'google') { try { await (await late('./gbp.js')).mapLocations(env); } catch (e) { /* the hourly pass maps them */ } }
}
// Owners on a plan with photo posts hear about Facebook and Instagram once.
async function tellOwners(env) {
  const { pushClient } = await late('./app.js');
  const rows = ((await env.DB.prepare("SELECT client_id FROM app_clients WHERE active = 1 AND regulated = 0 AND tier IN ('Growth', 'Pro')").all()).results) || [];
  for (const r of rows) await pushClient(env, r.client_id, { aps: { alert: { title: 'Facebook and Instagram are ready', body: 'Connect your Page in the app and every photo post you approve goes there too.' }, sound: 'default' }, screen: 'settings' }).catch(() => {});
}

// Hourly, from the 10-minute cron. Checks only what isn't on yet.
export async function launchCron(env, opts) {
  await ensure(env);
  const st = await launchState(env);
  const out = {};
  for (const k of FEATURES) {
    if (st[k].on && st[k].state === 'live') { out[k] = 'on'; continue; }
    if (!(opts && opts.force) && st[k].checked && Date.now() - Date.parse(st[k].checked) < HOUR - 5 * 60e3) { out[k] = 'checked lately'; continue; }
    let r;
    try { r = k === 'google' ? await checkGoogle(env) : await checkMeta(env); } catch (e) { r = { state: 'error', detail: String((e && e.message) || e).slice(0, 160) }; }
    const was = st[k].on;
    await save(env, k, { on: r.state === 'live' || was, state: r.state, detail: r.detail });
    if (r.state === 'live' && !was) await turnedOn(env, k, r.detail);
    else if (r.state === 'live' && was && !st[k].state) await turnedOn(env, k, r.detail);   // forced on before the first check
    out[k] = r.state;
  }
  return out;
}

// For the HQ board: one plain line each.
export async function launchLines(env) {
  const st = await launchState(env);
  const say = s => ({ live: 'approved and on', waiting: 'applied, waiting for approval', needs_connect: 'waiting; connect Always Open’s Google account so the worker can watch', api_off: 'approved, but an API needs turning on', no_keys: 'keys not set', error: 'the last check failed' })[s.state] || (s.on ? 'on' : 'not checked yet');
  return {
    google: (st.google.on ? 'on' : say(st.google)) + (st.google.detail && !st.google.on ? '. ' + st.google.detail : '') + (st.google.checked ? ' (checked ' + st.google.checked.slice(0, 16).replace('T', ' ') + ' UTC)' : ''),
    meta: (st.meta.on ? 'on' : say(st.meta)) + (st.meta.detail && !st.meta.on ? '. ' + st.meta.detail : '') + (st.meta.checked ? ' (checked ' + st.meta.checked.slice(0, 16).replace('T', ' ') + ' UTC)' : '')
  };
}

// ---------------- the website ----------------
// Pages mark launch-dependent bits with data-launch="meta" (removed once on) or data-launch-on="meta" (hidden until on).
export function rewritePage(res, st) {
  const type = res.headers.get('content-type') || '';
  if (!/text\/html/i.test(type) || typeof HTMLRewriter === 'undefined') return res;
  const on = k => !!(st[k] && st[k].on);
  return new HTMLRewriter()
    .on('[data-launch]', { element(el) { if (on(el.getAttribute('data-launch'))) el.remove(); } })
    .on('[data-launch-on]', { element(el) { if (on(el.getAttribute('data-launch-on'))) el.removeAttribute('hidden'); else el.remove(); } })
    .transform(res);
}
