// Google Business Profile, once Google approves our API access (launch.js switches it on).
// Owners invite hello@alwaysopenoffice.com as a manager, so one connection to Always Open's own Google account reaches
// every client's profile. An owner can also connect their own profile from the app; that connection is used first.
// While the switch is on:
//   - every review reply and post an owner approves goes to that client's Google profile (no more posting by hand);
//   - a new review with no reply and no draft after a few hours gets a draft written here, so a review is never missed
//     when the email check is down. It waits for the owner's approval like every other draft;
//   - calls, direction requests and website clicks from the profile fill in the monthly report.
// Kept: which Google location belongs to which client (ids, so we know where to post), what we posted, and monthly
// totals of the profile's own numbers for the business that owns them. Review text is not copied anywhere new except
// into the owner's own draft, as the email check already does.
const late = p => import(p);
const app = async () => late('./app.js');
const isOn = async env => (await late('./launch.js')).isOn(env, 'google');

export const AGENCY = '__agency__';
const AM = 'https://mybusinessaccountmanagement.googleapis.com/v1/';
const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1/';
const V4 = 'https://mybusiness.googleapis.com/v4/';
const PERF = 'https://businessprofileperformance.googleapis.com/v1/';
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const MAX_TRIES = 3;

let ready = false;
export async function ensureGbp(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS gbp_tokens (client_id TEXT PRIMARY KEY, refresh TEXT NOT NULL, connected_at TEXT)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gbp_locations (client_id TEXT PRIMARY KEY, account TEXT NOT NULL, location TEXT NOT NULL, title TEXT DEFAULT '', matched TEXT DEFAULT '', via TEXT DEFAULT '', updated TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gbp_posted (item_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT DEFAULT '', target TEXT DEFAULT '', ok INTEGER DEFAULT 0, tries INTEGER DEFAULT 0, result TEXT DEFAULT '', at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gbp_seen (review TEXT PRIMARY KEY, client_id TEXT NOT NULL, item_id TEXT DEFAULT '', at TEXT)"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS gbp_metrics (client_id TEXT NOT NULL, month TEXT NOT NULL, calls INTEGER, clicks INTEGER, directions INTEGER, updated TEXT, PRIMARY KEY (client_id, month))'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gbp_runs (k TEXT PRIMARY KEY, at TEXT, note TEXT DEFAULT '')")
  ]);
  ready = true;
}

// ---------------- tokens ----------------
const tokens = new Map();
export async function saveRefresh(env, who, refresh) {
  await ensureGbp(env);
  await env.DB.prepare('INSERT OR REPLACE INTO gbp_tokens (client_id, refresh, connected_at) VALUES (?1, ?2, ?3)').bind(who, refresh, new Date().toISOString()).run();
  tokens.delete(who);
}
export async function accessToken(env, who) {
  const c = tokens.get(who);
  if (c && c.exp > Date.now() + 60e3) return c.tok;
  await ensureGbp(env);
  const row = await env.DB.prepare('SELECT refresh FROM gbp_tokens WHERE client_id = ?1').bind(who).first();
  if (!row || !env.GOOGLE_CLIENT_ID) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: row.refresh, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  tokens.set(who, { tok: j.access_token, exp: Date.now() + (+j.expires_in || 3000) * 1000 });
  return j.access_token;
}
export async function connected(env) {
  try { await ensureGbp(env); return !!(await env.DB.prepare('SELECT 1 AS x FROM gbp_tokens WHERE client_id = ?1').bind(AGENCY).first()); } catch (e) { return false; }
}
async function tokenFor(env, cid) {
  const own = await env.DB.prepare('SELECT 1 AS x FROM gbp_tokens WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return (own && await accessToken(env, cid)) || await accessToken(env, AGENCY);
}
async function g(tok, method, url, body) {
  const r = await fetch(url, { method, headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j, err: r.ok ? '' : String((j.error && (j.error.message || j.error.status)) || ('Google answered ' + r.status)).slice(0, 200) };
}

// ---------------- matching ----------------
const ph10 = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : ''; };
export function normName(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(llc|inc|co|corp|company|the|and|ltd)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
// Which of the account's locations is this client's? Google's place id first (we keep the client's own place id from
// competitor watch), then the phone number, then the exact name. Two equally good answers means no answer.
export function pickLocation(client, locs) {
  const by = (fn, how) => { const hit = locs.filter(fn); return hit.length === 1 ? { loc: hit[0], how } : null; };
  if (client.placeId) { const r = by(l => l.placeId && l.placeId === client.placeId, 'place'); if (r) return r; }
  const phones = (client.phones || []).map(ph10).filter(Boolean);
  if (phones.length) { const r = by(l => l.phones.some(p => phones.includes(p)), 'phone'); if (r) return r; }
  const n = normName(client.business);
  if (n) { const r = by(l => normName(l.title) === n, 'name'); if (r) return r; }
  return null;
}
async function listLocations(tok) {
  const out = [];
  let page = '';
  const accts = [];
  for (let i = 0; i < 5; i++) {
    const a = await g(tok, 'GET', AM + 'accounts?pageSize=20' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (!a.ok) throw Object.assign(new Error(a.err), { status: a.status });
    accts.push(...(a.j.accounts || []));
    page = a.j.nextPageToken || ''; if (!page) break;
  }
  for (const acct of accts) {
    page = '';
    for (let i = 0; i < 10; i++) {
      const l = await g(tok, 'GET', BI + acct.name + '/locations?pageSize=100&readMask=name,title,phoneNumbers,metadata' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
      if (!l.ok) break;
      for (const x of (l.j.locations || [])) {
        const pn = x.phoneNumbers || {};
        out.push({ account: acct.name, location: x.name, title: x.title || '', phones: [pn.primaryPhone].concat(pn.additionalPhones || []).map(ph10).filter(Boolean), placeId: (x.metadata || {}).placeId || '' });
      }
      page = l.j.nextPageToken || ''; if (!page) break;
    }
  }
  return out;
}

// Daily: find each client's location. Mappings set by hand (matched = 'hand') are kept.
export async function mapLocations(env) {
  await ensureGbp(env);
  const { DEMO_ID } = await late('./demo.js');
  const clients = ((await env.DB.prepare("SELECT c.client_id, c.business, c.phone, b.phone AS bphone, (SELECT place_id FROM rival_profile r WHERE r.client_id = c.client_id AND r.found = 1 LIMIT 1) AS place FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id WHERE c.active = 1 AND c.client_id != ?1").bind(DEMO_ID).all().catch(() => ({ results: [] }))).results) || [];
  const have = new Map((((await env.DB.prepare('SELECT client_id, matched, via FROM gbp_locations').all()).results) || []).map(r => [r.client_id, r]));
  const owners = new Set((((await env.DB.prepare('SELECT client_id FROM gbp_tokens').all()).results) || []).map(r => r.client_id));
  const pools = {};
  const pool = async who => {
    if (pools[who] !== undefined) return pools[who];
    const tok = await accessToken(env, who);
    pools[who] = tok ? await listLocations(tok).catch(() => null) : null;
    return pools[who];
  };
  const out = { mapped: 0, unmatched: [] };
  for (const c of clients) {
    const h = have.get(c.client_id);
    if (h && h.matched === 'hand') continue;
    const who = owners.has(c.client_id) ? c.client_id : AGENCY;
    const locs = await pool(who);
    if (!locs) continue;
    const want = { business: c.business, phones: [c.phone, c.bphone], placeId: /^ChIJ/.test(c.place || '') ? c.place : '' };
    // An owner's own connection usually has just their one profile.
    const hit = pickLocation(want, locs) || (who !== AGENCY && locs.length === 1 ? { loc: locs[0], how: 'only one' } : null);
    if (!hit) { out.unmatched.push(c.business || c.client_id); continue; }
    await env.DB.prepare('INSERT OR REPLACE INTO gbp_locations (client_id, account, location, title, matched, via, updated) VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(c.client_id, hit.loc.account, hit.loc.location, hit.loc.title, hit.how, who === AGENCY ? 'agency' : 'owner', new Date().toISOString()).run();
    out.mapped++;
  }
  await run(env, 'map', JSON.stringify(out).slice(0, 500));
  return out;
}
async function locationOf(env, cid) {
  const r = await env.DB.prepare('SELECT account, location FROM gbp_locations WHERE client_id = ?1').bind(cid).first().catch(() => null);
  if (!r) return null;
  const id = String(r.location).replace(/^.*locations\//, '');
  return { v4: r.account + '/locations/' + id, perf: 'locations/' + id };
}

// How well a Google review matches a draft the email check made ("Dana R.", 5 stars, the review text).
const flat = s => String(s || '').toLowerCase().replace(/\(translated by google\)|\(original\)/g, ' ').replace(/[^a-z0-9áéíóúñü ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function reviewScore(rv, it) {
  let s = 0;
  const stars = STARS[rv.starRating] || 0;
  if (+it.stars > 0 && stars && +it.stars !== stars) return -10;
  if (+it.stars > 0 && +it.stars === stars) s += 1;
  const name = String(it.title || '').trim(), dn = String((rv.reviewer || {}).displayName || '').trim();
  if (name && !/^a customer$/i.test(name) && dn) {
    const [f1, l1] = name.toLowerCase().split(/\s+/), parts = dn.toLowerCase().split(/\s+/);
    if (f1 && parts[0] === f1) s += 3; else if (f1) s -= 2;
    if (l1 && parts.length > 1 && parts[parts.length - 1][0] === l1[0]) s += 1;
  }
  const a = flat(it.context), b = flat(rv.comment);
  if (!a && !b) s += 1;
  else if (a && b && (a === b || b.includes(a.slice(0, 60)) || a.includes(b.slice(0, 60)))) s += 4;
  else if (a && b) s -= 2;
  return s;
}
export function bestReview(reviews, it) {
  const scored = reviews.map(rv => ({ rv, s: reviewScore(rv, it) })).sort((x, y) => y.s - x.s);
  if (!scored.length || scored[0].s < 4) return null;
  if (scored[1] && scored[0].s - scored[1].s < 2) return null;
  return scored[0].rv;
}
async function recentReviews(tok, v4, pages) {
  const out = [];
  let page = '';
  for (let i = 0; i < (pages || 2); i++) {
    const r = await g(tok, 'GET', V4 + v4 + '/reviews?pageSize=50&orderBy=' + encodeURIComponent('updateTime desc') + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (!r.ok) throw Object.assign(new Error(r.err), { status: r.status });
    out.push(...(r.j.reviews || []));
    page = r.j.nextPageToken || ''; if (!page) break;
  }
  return out;
}

// ---------------- posting what owners approved ----------------
const isYelp = it => /yelp/i.test(String(it.context || '') + ' ' + String(it.title || ''));
async function record(env, it, cid, kind, target, ok, result) {
  await env.DB.prepare("INSERT INTO gbp_posted (item_id, client_id, kind, target, ok, tries, result, at) VALUES (?1,?2,?3,?4,?5,1,?6,?7) ON CONFLICT(item_id) DO UPDATE SET target = excluded.target, ok = excluded.ok, tries = gbp_posted.tries + 1, result = excluded.result, at = excluded.at")
    .bind(it.id, cid, kind, target || '', ok ? 1 : 0, String(result || '').slice(0, 200), new Date().toISOString()).run();
}
// Returns 'posted' | 'already' | 'off' | 'skipped:<why>' | 'failed:<why>'.
export async function publishItem(env, c, it, text) {
  if (!(await isOn(env))) return 'off';
  const kind = it.kind === 'post' ? 'post' : (it.kind === 'reply' || it.kind === 'review' || !it.kind ? 'reply' : '');
  if (!kind) return 'skipped:kind';
  if (isYelp(it)) return 'skipped:yelp';
  await ensureGbp(env);
  const done = await env.DB.prepare('SELECT ok FROM gbp_posted WHERE item_id = ?1').bind(it.id).first();
  if (done && +done.ok) return 'already';
  // A regulated client's edited reply waits for HQ's compliance look, exactly as before.
  if (+c.regulated && String(text).trim() !== String(it.text || '').trim()) { await record(env, it, c.client_id, kind, '', 0, 'held: regulated reply was edited'); return 'skipped:regulated edit'; }
  const loc = await locationOf(env, c.client_id);
  if (!loc) { await record(env, it, c.client_id, kind, '', 0, 'no Google location matched yet'); return 'skipped:no location'; }
  const tok = await tokenFor(env, c.client_id);
  if (!tok) { await record(env, it, c.client_id, kind, '', 0, 'no Google connection'); return 'failed:no connection'; }
  if (kind === 'post') {
    const body = { languageCode: 'en-US', summary: String(text).slice(0, 1500), topicType: 'STANDARD' };
    if (/^https:\/\/alwaysopenoffice\.com\/p\/[A-Za-z0-9]{32}$/.test(it.photo || '')) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: it.photo }];
    const r = await g(tok, 'POST', V4 + loc.v4 + '/localPosts', body);
    await record(env, it, c.client_id, kind, r.ok ? (r.j.name || '') : '', r.ok, r.ok ? 'posted' : r.err);
    return r.ok ? 'posted' : 'failed:' + r.err;
  }
  let review = null;
  const seen = await env.DB.prepare('SELECT review FROM gbp_seen WHERE item_id = ?1').bind(it.id).first().catch(() => null);
  try {
    const list = await recentReviews(tok, loc.v4, 3);
    review = seen ? list.find(r => r.name === seen.review) : bestReview(list, it);
  } catch (e) { await record(env, it, c.client_id, kind, '', 0, String(e.message || e)); return 'failed:' + (e.message || e); }
  if (!review) { await record(env, it, c.client_id, kind, '', 0, 'could not find this review on Google'); return 'failed:not found'; }
  const twin = await env.DB.prepare('SELECT item_id FROM gbp_posted WHERE target = ?1 AND ok = 1 AND item_id != ?2').bind(review.name, it.id).first();
  if (twin) { await record(env, it, c.client_id, kind, review.name, 1, 'another approved reply was already posted'); return 'already'; }
  if (review.reviewReply && review.reviewReply.comment) { await record(env, it, c.client_id, kind, review.name, 1, 'already had a reply on Google'); return 'already'; }
  const r = await g(tok, 'PUT', V4 + review.name + '/reply', { comment: String(text).slice(0, 4000) });
  await record(env, it, c.client_id, kind, review.name, r.ok, r.ok ? 'posted' : r.err);
  return r.ok ? 'posted' : 'failed:' + r.err;
}

// ---------------- reviews nobody drafted ----------------
// Today the Always Open check drafts each review from Google's email within hours, so the worker only watches: a review
// with no reply and no draft after 12 hours gets Christopher a push. Once the check is told to leave API clients to the
// worker (GBP_DRAFTS=primary in wrangler.toml), the worker drafts them itself an hour after they come in.
const primary = env => String(env.GBP_DRAFTS || '').toLowerCase() === 'primary';
const draftAfterH = env => primary(env) ? 1 : 12;
const SYS = 'You write the reply a small business posts under its own name to a Google review. Return only the reply text. ' +
  'One to three sentences, warm, plain and specific, written as the business. Thank the reviewer by first name. For 4 or 5 stars, mention one specific thing from their review. ' +
  'Under 4 stars: apologize sincerely without arguing, blaming, making excuses or admitting fault; give no details about the job or the customer; invite them to contact the business directly. ' +
  'Never ask them to change or remove the review. Never offer a refund, discount or gift. No emoji, hashtags, links or exclamation marks, and never mention AI or Always Open. ' +
  'A Spanish review gets a reply in Spanish. A rating with no words gets one short thank-you.';
async function writeDraft(env, c, rv, voice) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const stars = STARS[rv.starRating] || 0, first = String((rv.reviewer || {}).displayName || '').split(/\s+/)[0] || '';
  const user = 'Business: ' + (c.business || 'the business') + (c.phone && ph10(c.phone) ? '\nBusiness phone for unhappy reviewers: ' + ph10(c.phone).replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : '\nFor unhappy reviewers say "please call our office".') +
    (c.owner_first ? '\nSign off with: — ' + c.owner_first : '\nNo signature.') + '\nReviewer first name: ' + (first || '(none)') + '\nStars: ' + (stars || 'not shown') + '\nReview: ' + (String(rv.comment || '').slice(0, 2000) || '(rating only)') +
    (voice.length >= 3 ? '\n\nThe owner approved these earlier replies. Write like them (length, greeting, sign-off, word choice):\n' + voice.map(v => '- ' + v).join('\n') : '');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace': env.ANTHROPIC_WORKSPACE } : {}),
    body: JSON.stringify({ model: env.INSIGHT_MODEL || 'claude-haiku-5-5', max_tokens: 300, system: SYS, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { try { await (await late('./funding.js')).claudeProblem(env, (j.error && j.error.message) || ''); } catch (e) {} return ''; }
  return (j.content || []).map(x => x.text || '').join('').trim().replace(/^"|"$/g, '');
}
const shortId = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
const reviewerLabel = rv => { const p = String((rv.reviewer || {}).displayName || '').trim().split(/\s+/).filter(Boolean); return (rv.reviewer || {}).isAnonymous || !p.length ? 'A customer' : p[0] + (p.length > 1 ? ' ' + p[p.length - 1][0].toUpperCase() + '.' : ''); };

export async function safetyDrafts(env, now) {
  await ensureGbp(env);
  const t = now || Date.now();
  const rows = ((await env.DB.prepare('SELECT l.client_id, c.business, c.owner_first, c.phone, c.regulated, c.active FROM gbp_locations l JOIN app_clients c ON c.client_id = l.client_id WHERE c.active = 1').all()).results) || [];
  const { guard } = await app();
  let made = 0;
  const missed = [];
  for (const c of rows) {
    if (+c.regulated) continue;   // regulated replies come only from the approved library wording, drafted in HQ
    const loc = await locationOf(env, c.client_id), tok = await tokenFor(env, c.client_id);
    if (!loc || !tok) continue;
    let list = [];
    try { list = await recentReviews(tok, loc.v4, 1); } catch (e) { continue; }
    const waiting = list.filter(rv => !(rv.reviewReply && rv.reviewReply.comment) && Date.parse(rv.createTime || rv.updateTime || 0) < t - draftAfterH(env) * 3600e3 && Date.parse(rv.createTime || rv.updateTime || 0) > t - 10 * 864e5);
    if (!waiting.length) continue;
    const items = ((await env.DB.prepare("SELECT id, title, context, stars FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'review') AND created > ?2").bind(c.client_id, new Date(t - 30 * 864e5).toISOString()).all()).results) || [];
    const voice = (((await env.DB.prepare("SELECT decided_text FROM app_items WHERE client_id = ?1 AND kind = 'reply' AND status = 'approved' AND decided_text != '' ORDER BY decided_at DESC LIMIT 8").bind(c.client_id).all()).results) || []).map(r => String(r.decided_text).slice(0, 400));
    for (const rv of waiting.slice(0, 5)) {
      if (await env.DB.prepare('SELECT 1 AS x FROM gbp_seen WHERE review = ?1').bind(rv.name).first()) continue;
      if (items.some(it => reviewScore(rv, it) >= 4)) { await env.DB.prepare('INSERT OR IGNORE INTO gbp_seen (review, client_id, item_id, at) VALUES (?1,?2,?3,?4)').bind(rv.name, c.client_id, '', new Date(t).toISOString()).run(); continue; }
      if (!primary(env)) {   // watch only: tell Christopher once, the email check drafts it
        await env.DB.prepare('INSERT OR IGNORE INTO gbp_seen (review, client_id, item_id, at) VALUES (?1,?2,?3,?4)').bind(rv.name, c.client_id, 'alerted', new Date(t).toISOString()).run();
        missed.push(c.business);
        continue;
      }
      const draft = await writeDraft(env, c, rv, voice).catch(() => '');
      if (!draft || guard(draft, c, 'reply').length) { missed.push(c.business); continue; }
      const id = 'g:' + await shortId(rv.name), at = new Date(t).toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, photo, created, updated, notified) VALUES (?1, ?2, 'reply', ?3, ?4, ?5, ?6, 'pending', 1, 0, '', ?7, ?7, 0)")
          .bind(id, c.client_id, reviewerLabel(rv), String(rv.comment || '').slice(0, 2000), STARS[rv.starRating] || 0, draft, at),
        env.DB.prepare('INSERT OR IGNORE INTO gbp_seen (review, client_id, item_id, at) VALUES (?1,?2,?3,?4)').bind(rv.name, c.client_id, id, at)
      ]);
      made++;
    }
  }
  if (made || missed.length) {
    const { opsPing } = await app();
    await opsPing(env, 'Always Open: ' + (made ? made + (made === 1 ? ' review reply drafted' : ' review replies drafted') : 'reviews need a draft'),
      (made ? 'These reviews had no draft after ' + draftAfterH(env) + ' hours, so the worker wrote them from Google. They are in the owners’ apps for approval. ' : '') +
      (missed.length ? (primary(env) ? 'Could not draft for: ' : 'Google reviews with no reply and no draft after ' + draftAfterH(env) + ' hours, for: ') + [...new Set(missed)].join(', ') + '. Draft those in HQ (the Always Open check may not have run).' : ''), 'default', 'memo');
  }
  return { made, missed: missed.length };
}

// ---------------- the monthly report's Google numbers ----------------
export async function fetchMonth(env, cid, month) {
  const loc = await locationOf(env, cid), tok = await tokenFor(env, cid);
  if (!loc || !tok) return null;
  const [y, m] = month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const q = ['CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS'].map(x => 'dailyMetrics=' + x).join('&') +
    '&dailyRange.start_date.year=' + y + '&dailyRange.start_date.month=' + m + '&dailyRange.start_date.day=1&dailyRange.end_date.year=' + y + '&dailyRange.end_date.month=' + m + '&dailyRange.end_date.day=' + last;
  const r = await g(tok, 'GET', PERF + loc.perf + ':fetchMultiDailyMetricsTimeSeries?' + q);
  if (!r.ok) return null;
  return sumMetrics(r.j);
}
export function sumMetrics(j) {
  const tot = { CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0 };
  for (const multi of (j.multiDailyMetricTimeSeries || [])) for (const s of (multi.dailyMetricTimeSeries || [])) {
    if (!(s.dailyMetric in tot)) continue;
    for (const dv of ((s.timeSeries || {}).datedValues || [])) tot[s.dailyMetric] += +(dv.value || 0) || 0;
  }
  return { calls: tot.CALL_CLICKS, clicks: tot.WEBSITE_CLICKS, directions: tot.BUSINESS_DIRECTION_REQUESTS };
}
async function metricsPass(env, now) {
  const d = new Date(now), prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), month = prev.toISOString().slice(0, 7);
  if (d.getUTCDate() < 3) return 0;   // Google's numbers settle a couple of days after the month ends
  const rows = ((await env.DB.prepare('SELECT l.client_id FROM gbp_locations l LEFT JOIN gbp_metrics m ON m.client_id = l.client_id AND m.month = ?1 WHERE m.client_id IS NULL').bind(month).all()).results) || [];
  let n = 0;
  for (const r of rows.slice(0, 20)) {
    const s = await fetchMonth(env, r.client_id, month).catch(() => null);
    if (!s) continue;
    await env.DB.prepare('INSERT OR REPLACE INTO gbp_metrics (client_id, month, calls, clicks, directions, updated) VALUES (?1,?2,?3,?4,?5,?6)').bind(r.client_id, month, s.calls, s.clicks, s.directions, new Date(now).toISOString()).run();
    n++;
  }
  return n;
}
// For the app: Google's numbers fill the report tiles the HQ month record leaves empty.
export async function mergeMonths(env, cid, months) {
  let rows = [];
  try { await ensureGbp(env); rows = ((await env.DB.prepare('SELECT month, calls, clicks, directions FROM gbp_metrics WHERE client_id = ?1 ORDER BY month DESC LIMIT 13').bind(cid).all()).results) || []; } catch (e) { return months; }
  const out = months.slice();
  for (const r of rows) {
    let m = out.find(x => x.month === r.month);
    if (!m) { const [y, mo] = r.month.split('-').map(Number); m = { month: r.month, label: new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), stats: {}, prev: null, note: '', record: false }; out.push(m); }
    m.stats = Object.assign({}, m.stats);
    for (const k of ['calls', 'clicks', 'directions']) if (m.stats[k] == null || m.stats[k] === '') m.stats[k] = +r[k] || 0;
  }
  out.sort((a, b) => (a.month < b.month ? 1 : -1));
  return out.slice(0, 13);
}

// ---------------- the timer ----------------
async function run(env, k, note) { await env.DB.prepare('INSERT OR REPLACE INTO gbp_runs (k, at, note) VALUES (?1, ?2, ?3)').bind(k, new Date().toISOString(), String(note || '').slice(0, 500)).run(); }
async function due(env, k, everyMs) { const r = await env.DB.prepare('SELECT at FROM gbp_runs WHERE k = ?1').bind(k).first(); return !r || Date.now() - Date.parse(r.at) >= everyMs; }

export async function gbpCron(env, at) {
  if (!(await isOn(env))) return { off: true };
  await ensureGbp(env);
  const now = at || Date.now(), out = {};
  if (await due(env, 'map', 24 * 3600e3)) out.map = await mapLocations(env).catch(e => String(e.message || e));
  // Approved replies and posts not posted yet (a retry for anything the approval-time attempt missed). Only what was
  // approved after the switch went on: anything older was posted by hand.
  const since = Math.max(now - 14 * 864e5, Date.parse(((await (await late('./launch.js')).launchState(env)).google || {}).at || '') || 0);
  const rows = ((await env.DB.prepare("SELECT i.* FROM app_items i LEFT JOIN gbp_posted p ON p.item_id = i.id WHERE i.status = 'approved' AND i.kind IN ('reply', 'review', 'post') AND i.decided_at > ?1 AND (p.item_id IS NULL OR (p.ok = 0 AND p.tries < ?2 AND p.at < ?3)) ORDER BY i.decided_at LIMIT 15")
    .bind(new Date(since).toISOString(), MAX_TRIES, new Date(now - 30 * 60e3).toISOString()).all()).results) || [];
  let posted = 0;
  for (const it of rows) {
    const c = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(it.client_id).first();
    if (!c) continue;
    const r = await publishItem(env, c, it, it.decided_text || it.text).catch(e => 'failed:' + (e.message || e));
    if (r === 'posted') posted++;
  }
  out.posted = posted;
  if (await due(env, 'drafts', 3600e3)) { out.drafts = await safetyDrafts(env, now).catch(e => String(e.message || e)); await run(env, 'drafts', JSON.stringify(out.drafts)); }
  if (await due(env, 'metrics', 12 * 3600e3)) { out.metrics = await metricsPass(env, now).catch(() => 0); await run(env, 'metrics', String(out.metrics)); }
  return out;
}

// For the HQ board.
export async function gbpBoard(env) {
  const items = [];
  try {
    await ensureGbp(env);
    const stuck = ((await env.DB.prepare("SELECT p.item_id, p.result, COALESCE(c.business, p.client_id) AS biz FROM gbp_posted p LEFT JOIN app_clients c ON c.client_id = p.client_id WHERE p.ok = 0 AND p.tries >= ?1 ORDER BY p.at DESC LIMIT 20").bind(MAX_TRIES).all()).results) || [];
    for (const s of stuck) items.push({ key: 'gbp:' + s.item_id, group: 'Google: could not post on its own', title: s.biz, detail: s.result + '. Post it by hand, then tick Done' });
    const r = await env.DB.prepare("SELECT note FROM gbp_runs WHERE k = 'map'").first();
    const un = r ? (JSON.parse(r.note || '{}').unmatched || []) : [];
    for (const b of un) items.push({ key: 'gbpmap:' + b, group: 'Google: profiles we could not match', title: b, detail: 'No Google profile with the same phone or name is shared with Always Open. Ask them to invite hello@alwaysopenoffice.com as a Manager' });
  } catch (e) { /* the board still shows the rest */ }
  return items;
}
