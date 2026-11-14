// The owner's weekly checklist: what only Christopher can do this week. Page at /ops (key or the link in the Monday email)
// and a Monday email. Reads our own tables only; nothing here changes a client's data.
import { EmailMessage } from 'cloudflare:email';
import { neonEmail, rawEmail } from './neonmail.js';
import { metaReady } from './extras.js';
import { TEXTING_ON, textingReady } from './sms.js';
import { LABELS as LOST_LABELS } from './lost.js';
import { fundingState } from './funding.js';
const fundingStateLine = async env => { try { return (await fundingState(env)).twilio; } catch (e) { return 'not read yet'; } };
import { DEMO_ID } from './demo.js';
import { buildPack } from './cpack.js';
import { markCredited } from './referral.js';
import { setShow, previewKey } from './map.js';
import { driftRows, driftText } from './drift.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Addresses in a line become links you can tap (the text is escaped first, so nothing else turns into markup).
export const linkify = h => h.replace(/https:\/\/[^\s<,]+[^\s<,.)]/g, u => '<a href="' + u + '" style="color:inherit;word-break:break-all">' + u + '</a>');
const eq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// The board's link. Since Nov 10, 2026 a link is dated and works for 30 days (the Monday email and every push carry a
// fresh one), and the device that opens the board keeps a signed cookie for a year, so a bookmark keeps working there.
// The old link, which never changed, opens the board until Dec 10, 2026, so a bookmark has a month to be opened once.
// None of these is the key itself.
const DAY = 864e5, LINK_DAYS = 30, COOKIE_DAYS = 365, LEGACY_UNTIL = Date.parse('2026-12-10T00:00:00Z');
async function mac(env, msg, bytes) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LEADS_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].slice(0, bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function boardToken(env, now) {
  if (!env.LEADS_KEY) return '';
  const d = new Date(now || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
  return d + await mac(env, 'ops-board-v2:' + d, 16);
}
const legacyToken = env => mac(env, 'ops-board-v1', 20);
// A fresh link to Always Open HQ (opshq.js), for the pushes and emails that say "answer them" or "it is on HQ".
export async function hqLink(env) { const t = await boardToken(env); return t ? 'https://alwaysopenoffice.com/ops/hq?t=' + t : ''; }
function cookieOf(req) { const m = /(?:^|;\s*)aob=([0-9]+\.[0-9a-f]{32})/.exec((req && req.headers && req.headers.get('cookie')) || ''); return m ? m[1] : ''; }
async function cookieOk(env, req) {
  const v = cookieOf(req); if (!v) return false;
  const [exp, sig] = v.split('.');
  return +exp > Date.now() && eq(sig, await mac(env, 'ops-cookie:' + exp, 16));
}
// The Set-Cookie header for a device that just opened the board.
export async function boardCookie(env) {
  const exp = String(Date.now() + COOKIE_DAYS * DAY);
  return 'aob=' + exp + '.' + await mac(env, 'ops-cookie:' + exp, 16) + '; Path=/; Max-Age=' + COOKIE_DAYS * 86400 + '; HttpOnly; Secure; SameSite=Lax';
}
export async function boardOk(env, t, req) {
  if (!env.LEADS_KEY) return false;
  t = String(t || '');
  if (/^\d{8}[0-9a-f]{32}$/.test(t)) {
    const d = t.slice(0, 8), at = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)), age = Date.now() - at;
    if (age >= -DAY && age <= LINK_DAYS * DAY && eq(t.slice(8), await mac(env, 'ops-board-v2:' + d, 16))) return true;
  }
  if (t && Date.now() < LEGACY_UNTIL && eq(t, await legacyToken(env))) return true;
  return !!req && await cookieOk(env, req);
}
async function allowed(req, env, url, tok) {
  if (!env.LEADS_KEY) return false;
  const key = req.headers.get('x-key') || '';
  if (key && eq(key, env.LEADS_KEY)) return true;
  return boardOk(env, tok || url.searchParams.get('t') || '', req);
}

async function ensure(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_done (k TEXT PRIMARY KEY, at TEXT)').run();
}
const all = async (env, sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };

// Returns [{ key, group, title, detail }] for what is still open.
export async function boardItems(env) {
  await ensure(env);
  try { await (await import('./gbp.js')).ensureGbp(env); await (await import('./provision.js')).ensureProvision(env); } catch (e) { /* queries below fall back to empty */ }
  const items = [];
  const waiting = await all(env, "SELECT i.client_id, COALESCE(c.business, i.client_id) AS biz, SUM(CASE WHEN i.kind = 'post' THEN 1 ELSE 0 END) AS posts, SUM(CASE WHEN i.kind != 'post' THEN 1 ELSE 0 END) AS replies FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id LEFT JOIN gbp_posted gp ON gp.item_id = i.id AND gp.ok = 1 WHERE i.status = 'approved' AND gp.item_id IS NULL AND i.kind IN ('reply', 'review', 'post') AND i.decided_at > datetime('now', '-30 days') AND i.client_id != ?1 AND (i.id LIKE 'm:%' OR i.id LIKE 'g:%' OR LOWER(i.context || i.title) NOT LIKE '%yelp%') AND i.id NOT IN (SELECT item_id FROM gbp_posted WHERE ok = 1) GROUP BY i.client_id", DEMO_ID);
  for (const w of waiting) {
    const bits = [];
    if (+w.replies) bits.push(w.replies + (+w.replies === 1 ? ' reply' : ' replies'));
    if (+w.posts) bits.push(w.posts + (+w.posts === 1 ? ' post' : ' posts'));
    items.push({ key: 'google:' + w.client_id + ':' + w.replies + ':' + w.posts, group: 'Google: approved, waiting to be posted', title: w.biz, detail: bits.join(' and ') + ' approved by the owner, not posted yet. Post them in a few taps: https://alwaysopenoffice.com/ops/hq?t=' + await boardToken(env) + '#google' });
  }
  const yelp = await all(env, "SELECT i.client_id, COALESCE(c.business, i.client_id) AS biz, COUNT(*) AS n FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id WHERE i.status = 'approved' AND i.hq_synced = 0 AND i.client_id != ?1 AND i.id NOT LIKE 'm:%' AND i.id NOT LIKE 'g:%' AND LOWER(i.context || i.title) LIKE '%yelp%' GROUP BY i.client_id", DEMO_ID);
  for (const y of yelp) items.push({ key: 'yelp:' + y.client_id + ':' + y.n, group: 'Yelp: replies to hand to the owner', title: y.biz, detail: y.n + (+y.n === 1 ? ' reply is' : ' replies are') + ' approved. The owner posts them, we never ask for Yelp reviews' });
  const signups = await all(env, "SELECT b.client_id, b.business, b.plan, b.created, p.status AS line, p.number FROM billing b LEFT JOIN provision p ON p.client_id = b.client_id WHERE b.hq_synced = 0 AND b.status IN ('active', 'past_due') AND b.client_id != ?1 ORDER BY b.created DESC LIMIT 50", DEMO_ID);
  for (const s of signups) items.push({ key: 'signup:' + s.client_id, group: 'New signups', title: s.business || s.client_id, detail: (s.plan || '') + ' plan, signed up ' + String(s.created || '').slice(0, 10) + '. Max’s line: ' + (s.line === 'live' ? 'live at ' + String(s.number || '').replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : (s.line || 'not started')) });
  try { items.push(...await (await import('./provision.js')).provisionBoard(env)); } catch (e) {}
  try { items.push(...await (await import('./gbp.js')).gbpBoard(env)); } catch (e) {}
  try { items.push(...await (await import('./aicheck.js')).aiCheckBoard(env)); } catch (e) {}
  try { items.push(...await (await import('./grades.js')).maxBoard(env)); } catch (e) {}
  try { items.push(...await (await import('./outreach.js')).outreachBoard(env)); } catch (e) {}
  const failed = await all(env, "SELECT client_id, business, plan, updated FROM billing WHERE status = 'past_due' AND client_id != ?1 ORDER BY updated DESC LIMIT 50", DEMO_ID);
  for (const f of failed) items.push({ key: 'pay:' + f.client_id + ':' + String(f.updated || '').slice(0, 10), group: 'Failed payments', title: f.business || f.client_id, detail: (f.plan || '') + ' plan. Stripe is retrying and emailing them; a call from you may help' });
  const refs = await all(env, "SELECT r.id, COALESCE(a.business, r.referrer_id) AS referrer, COALESCE(d.business, r.referred_id) AS referred, r.created FROM referrals r LEFT JOIN app_clients a ON a.client_id = r.referrer_id LEFT JOIN app_clients d ON d.client_id = r.referred_id WHERE r.status = 'earned' AND r.note LIKE 'manual%' ORDER BY r.id LIMIT 50");
  for (const r of refs) items.push({ key: 'referral:' + r.id, group: 'Referral credits to give', title: r.referrer, detail: 'Sent us ' + r.referred + ' (signed up ' + String(r.created || '').slice(0, 10) + '). Check they have paid three months, then give ' + r.referrer + ' one free month. Tick Done once it is applied' });
  try {
    const lost = await all(env, "SELECT l.client_id, COALESCE(c.business, l.client_id) AS biz, l.reason, COUNT(*) AS n FROM call_lost l LEFT JOIN app_clients c ON c.client_id = l.client_id WHERE l.at > ?1 GROUP BY l.client_id, l.reason ORDER BY biz", new Date(Date.now() - 30 * 864e5).toISOString());
    const by = {};
    for (const r of lost) { (by[r.client_id] = by[r.client_id] || { biz: r.biz, parts: [], total: 0 }).parts.push(+r.n + ' ' + (LOST_LABELS[r.reason] || r.reason)); by[r.client_id].total += +r.n; }
    for (const k in by) items.push({ key: 'lost:' + k + ':' + by[k].total, group: 'Why callers walked (last 30 days)', title: by[k].biz, detail: by[k].parts.join(', ') });
  } catch (e) {}
  // What Max caught after hours this month, per client: who is winning before the renewal call (money.js, same figures as the app).
  try {
    const M = await import('./money.js');
    const lines = await all(env, "SELECT DISTINCT l.client_id, COALESCE(c.business, l.client_id) AS biz FROM voice_lines l JOIN app_clients c ON c.client_id = l.client_id WHERE c.active = 1 AND l.client_id NOT IN ('demo-plumbing', 'always-open') LIMIT 60");
    for (const l of lines) {
      const m = await M.caughtFor(env, l.client_id, Date.now());
      if (!m.afterHoursCalls) continue;
      items.push({ key: 'caught:' + l.client_id + ':' + m.month, group: 'What Max caught after hours this month', title: l.biz, detail: m.explained });
    }
  } catch (e) { /* the board stands without it */ }
  try {
    const regs = await all(env, "SELECT r.client_id, COALESCE(c.business, r.client_id) AS biz, r.status, r.step, r.error, r.updated FROM a2p_reg r LEFT JOIN app_clients c ON c.client_id = r.client_id WHERE r.status != 'approved' ORDER BY r.updated DESC LIMIT 40");
    const say = { submitted: 'sent, starting', in_review: 'with Twilio and the carriers', needs_fix: 'needs a fix from the owner', needs_help: 'no EIN: register as a sole proprietor by hand in Twilio', failed: 'stuck, look in Twilio' };
    for (const r of regs) items.push({ key: 'a2p:' + r.client_id + ':' + r.status + ':' + r.step, group: 'Texting registrations', title: r.biz, detail: (r.step === 'sp_wait_brand' ? 'waiting for the owner to reply YES to the registry’s text' : (say[r.status] || r.status) + (r.step && r.status === 'in_review' ? ' (step: ' + r.step.replace(/^sp_/, 'sole proprietor ').replace('_', ' ') + ')' : '')) + (r.error ? '. ' + r.error : '') });
  } catch (e) {}
  let launch = { google: 'not checked yet', meta: 'not checked yet' }, gst = {};
  try { const L = await import('./launch.js'); launch = await L.launchLines(env); gst = (await L.launchState(env)).google || {}; } catch (e) {}
  if (!gst.on && (gst.state === 'needs_connect' || !gst.state) && !(await (await import('./gbp.js')).connected(env).catch(() => false))) {
    items.push({ key: 'gbp-connect', group: 'One tap so the worker can watch Google', title: 'Connect Always Open’s Google account', detail: 'Open https://alwaysopenoffice.com/google/gbp-hq?t=' + (await boardToken(env)) + ' and sign in as hello@alwaysopenoffice.com (the account clients invite as Manager). The worker then checks every hour and turns everything on by itself the day Google approves' });
  }
  let socialLine = 'not read';
  try {
    const S = await import('./social.js');
    if (metaReady(env) && !(await S.connected(env))) items.push({ key: 'fb-connect', group: 'One tap so Always Open posts on its own', title: 'Connect Always Open’s Facebook Page', detail: 'Open https://alwaysopenoffice.com/meta/connect?hq=' + (await boardToken(env)) + ', sign in to Facebook as yourself, and pick the Always Open Page (and its Instagram). Three posts a week go up on their own after that.' });
    socialLine = await S.socialLine(env);
  } catch (e) { /* the board stands without it */ }
  let hearLine = 'not read';
  try {
    const H = await import('./hearmax.js');
    const cur = await H.current(env, 'en');
    const link = 'https://alwaysopenoffice.com/ops/hear-max?t=' + (await boardToken(env));
    hearLine = cur ? 'live: ' + cur.seconds + ' seconds, recorded ' + String(cur.at).slice(0, 10) + '. Record a new one or take it down: ' + link : 'no sample yet. Open ' + link + ' on your phone, type your number, tap Ready, then call (706) 460-2226';
    if (!cur) items.push({ key: 'hear-max', group: 'One call so the website can play Max', title: 'Record the Hear Max sample', detail: 'Open ' + link + ' on your phone, type the number you will call from, tap Ready, and call (706) 460-2226. Ask for a plumber tonight, give a made-up name, hang up after Max confirms.' });
  } catch (e) { /* the board stands without it */ }
  const sys = [
    ['Hear Max on the website', hearLine],
    ['Review asks for Always Open itself', await (async () => { try { return await (await import('./ourreviews.js')).asksLine(env); } catch (e) { return 'not read'; } })()],
    ['Always Open’s own Facebook and Instagram', socialLine],
    ['Always Open check (reviews and leads)', await (await import('./funding.js')).checkRunLine(env)],
    ['Twilio balance', await fundingStateLine(env)],
    ['Map preview (private link)', 'https://alwaysopenoffice.com/map?preview=' + (await previewKey(env))],
    ['Twilio texting', !TEXTING_ON ? 'off' : (textingReady(env) ? 'on' : 'on, but the Twilio account SID is not set. Run "Set Twilio texting key.command".')],
    ['Meta (Facebook and Instagram)', metaReady(env) ? launch.meta : 'keys not set yet'],
    ['Google Business Profile API', launch.google],
    ['Competitor lookups (Google Places)', env.PLACES_KEY ? 'key is set' : 'key not set']
  ];
  for (const [n, st] of sys) items.push({ key: 'sys:' + n + ':' + st, group: 'Status of what you are waiting on', title: n, detail: st });
  // The Worker's own jobs: when each last ran and how long it took. Late or failed ones show first.
  try {
    const { cronRuns, CRON_LATE_MS } = await import('./ops.js');
    const runs = await cronRuns(env), now = Date.now();
    const ageText = at => { const m = Math.round((now - Date.parse(at)) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    const worst = runs.filter(r => !r.ok || (r.name === 'tick' && now - Date.parse(r.at) > CRON_LATE_MS));
    const line = runs.length ? runs.length + ' jobs. ' + (worst.length ? 'Needs a look: ' + worst.map(r => r.name + (r.ok ? ' (late)' : ' (failed: ' + (r.note || 'error') + ')')).join(', ') : 'All ran. ') + 'Last tick ' + (runs.find(r => r.name === 'tick') ? ageText(runs.find(r => r.name === 'tick').at) : 'never') + '. ' + runs.map(r => r.name + ' ' + ageText(r.at) + ' ' + r.ms + 'ms').join(' · ') : 'no runs recorded yet';
    items.push({ key: 'sys:cron:' + (worst.length ? 'bad' : 'ok'), group: 'Status of what you are waiting on', title: 'Worker jobs', detail: line });
  } catch (e) { /* the board stands without it */ }
  // Crashes in the last week (the "crash:<route>" alerts), grouped by page, so the alert has somewhere to point.
  try {
    const { recentErrors } = await import('./ops.js');
    const errs = (await recentErrors(env, 200)).filter(e => Date.now() - Date.parse(e.at) < 7 * 864e5);
    const byRoute = new Map();
    for (const e of errs) { const k = e.method + ' ' + e.route; const x = byRoute.get(k) || { n: 0, last: e }; x.n++; byRoute.set(k, x); }
    for (const [route, x] of byRoute) items.push({ key: 'err:' + route + ':' + x.last.at.slice(0, 10), group: 'Errors this week', title: route + (x.n > 1 ? ' (' + x.n + ' times)' : ''), detail: 'Last ' + x.last.at.slice(0, 16).replace('T', ' ') + ' UTC: ' + x.last.message });
  } catch (e) { /* the board stands without it */ }
  const done = new Set((await all(env, 'SELECT k FROM ops_done LIMIT 2000')).map(r => r.k));
  return items.filter(x => !done.has(x.key));
}

function groups(items) {
  const g = new Map();
  for (const it of items) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it); }
  return g;
}

export function mapSection(rows) {
  if (!rows.length) return '';
  return '<section><h2>The Always Open map</h2>' + rows.map(r => '<div class="it"><div><b>' + esc(r.business) + '</b><span>' +
    esc(r.listed ? (r.placed ? 'On the map' : 'On the map once we find their town or address') : (r.regulated ? 'Off (regulated: only if they ask)' : (r.paying ? 'Off' : 'Off (not billed through Stripe)'))) +
    '</span></div><button type="button" data-map="' + esc(r.id) + '" data-show="' + (r.listed ? '0' : '1') + '">' + (r.listed ? 'Take off' : 'Put on') + '</button></div>').join('') + '</section>';
}

// The Monday email as one neon page: the sign says how many things are his this week, each one is a Do-this line,
// the status and money lines are short rows, one button opens the checklist.
const INFO = /^(sys:|lost:|caught:|err:)/;
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
export function boardEmail(items, link, numbersLink, drift) {
  const todo = items.filter(x => !INFO.test(x.key)), info = items.filter(x => INFO.test(x.key));
  const errs = items.filter(x => x.key.startsWith('err:')).length;
  const lines = [];
  if (drift) lines.push({ k: 'Clients', v: cut(drift, 220), bad: true });
  info.filter(x => x.key.startsWith('caught:')).slice(0, 3).forEach(x => lines.push({ k: x.title, v: cut(x.detail, 140), ok: true }));
  info.filter(x => x.key.startsWith('sys:')).slice(0, 5).forEach(x => lines.push({ k: x.title, v: cut(x.detail, 140), bad: /bad|URGENT|low|late|STOPPED|fail/i.test(x.detail) }));
  if (todo.length > 5) lines.push({ k: 'And', v: (todo.length - 5) + ' more on the checklist' });
  return {
    tone: todo.length ? 'bad' : 'ok', sign: todo.length ? (todo.length === 1 ? '1 THING' : todo.length + ' THINGS') : 'ALL CLEAR',
    title: todo.length ? 'Only you can do ' + (todo.length === 1 ? 'this' : 'these') + ' this week' : 'Nothing is waiting on you this week',
    who: 'your week', preheader: todo[0] ? todo[0].title + ': ' + cut(todo[0].detail, 80) : 'All clear this week.',
    doThis: todo.slice(0, 5).map(x => x.title + ': ' + cut(x.detail, 160)),
    stats: [{ n: String(todo.length), label: 'for you to do', tone: todo.length ? 'bad' : '' }, { n: String(errs), label: 'page errors', tone: errs ? 'bad' : '' }],
    linesTitle: lines.length ? 'How things stand' : '', lines,
    button: { text: 'Open Always Open HQ', url: link }, note: numbersLink ? 'Revenue, costs and margin: ' + numbersLink : ''
  };
}

export function boardText(items, link) {
  if (!items.length) return 'Nothing waiting on you this week.\n\n' + link;
  let t = 'What only you can do this week:\n';
  for (const [name, list] of groups(items)) t += '\n' + name + '\n' + list.map(x => '  - ' + x.title + ': ' + x.detail).join('\n') + '\n';
  return t + '\nTick things off here: ' + link + '\n';
}

// The Outreach master switch (Christopher, Nov 11, 2026: "Where is my button to turn the business to business auto dialer
// off?"). It is billing_config outreach_enabled, the kill switch every Outreach call checks first; off stops every
// client's calls at once. Off is one tap; on takes a second tap.
export async function outreachSwitch(env) {
  const O = await import('./outreach.js');
  const on = await O.killSwitchOn(env);
  const one = async sql => { try { const r = await env.DB.prepare(sql).first(); return (r && +r.n) || 0; } catch (e) { return 0; } };
  const signed = await one('SELECT COUNT(DISTINCT client_id) AS n FROM outreach_terms');
  const waiting = await one("SELECT COUNT(*) AS n FROM outreach_lists WHERE status = 'ready'");
  let list = null; try { list = await (await import('./dnclist.js')).dncListStatus(env); } catch (e) { list = null; }
  return { on, signed, waiting, list };
}
const niceDay = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export function switchSection(s) {
  if (!s) return '';
  const bits = [s.signed + (s.signed === 1 ? ' client has' : ' clients have') + ' signed up', s.waiting + (s.waiting === 1 ? ' number' : ' numbers') + ' waiting'];
  bits.push(!s.list || !s.list.loaded ? 'Do Not Call list not loaded yet' : s.list.ready ? 'Do Not Call list good until ' + niceDay(s.list.dueBy) : 'Do Not Call list out of date');
  return '<section><h2>Outreach calls</h2><div class="it sw"><div><b>Max calling businesses: ' + (s.on ? 'ON' : 'OFF') + '</b><span>' + esc(bits.join(' · ')) + '. ' +
    (s.on ? 'Turning this off stops every Outreach call right away, for every client.' : 'No Outreach call goes out for any client until you turn this back on.') + '</span></div>' +
    '<button type="button" style="white-space:nowrap" data-osw="' + (s.on ? '0' : '1') + '">' + (s.on ? 'Turn off' : 'Turn on') + '</button></div></section>';
}

export async function handleOpsBoard(req, env, url) {
  const path = url.pathname;
  // The page: /ops and /ops/hq are both Always Open HQ (opshq.js), the one page with everything that needs him on it.
  if (path === '/ops' || path === '/ops/hq' || path === '/ops/hq/reply' || path === '/ops/hq/lead' || path === '/ops/hq/post' || path === '/ops/hq/client' || path === '/ops/hq/proposal') return (await import('./opshq.js')).handleHq(req, env, url, { allowed, boardToken, boardCookie });
  if (path === '/ops/done') {
    let b = {}; try { b = await req.json(); } catch (e) { /* bad body */ }
    if (req.method !== 'POST' || !(await allowed(req, env, url, String(b.t || '')))) return new Response('{"ok":false}', { status: 403, headers: { 'content-type': 'application/json' } });
    const k = String(b.k || '').slice(0, 300);
    if (!k) return new Response('{"ok":false}', { status: 400, headers: { 'content-type': 'application/json' } });
    await ensure(env);
    await env.DB.prepare('INSERT OR REPLACE INTO ops_done (k, at) VALUES (?1, ?2)').bind(k, new Date().toISOString()).run();
    if (/^referral:\d+$/.test(k)) { try { await markCredited(env, +k.slice(9)); } catch (e) { /* the tick stands */ } }
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (path === '/ops/map') {
    // HQ's switch for the public map: { t, id, show: true | false | null } (null = back to the default).
    let b = {}; try { b = await req.json(); } catch (e) { /* bad body */ }
    if (req.method !== 'POST' || !(await allowed(req, env, url, String(b.t || '')))) return new Response('{"ok":false}', { status: 403, headers: { 'content-type': 'application/json' } });
    const id = String(b.id || '').slice(0, 60);
    const ex = id && await env.DB.prepare('SELECT client_id FROM app_clients WHERE client_id = ?1').bind(id).first();
    if (!ex) return new Response('{"ok":false}', { status: 404, headers: { 'content-type': 'application/json' } });
    await setShow(env, id, b.show === true ? true : (b.show === false ? false : null));
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (path === '/ops/outreach-switch') {
    // The Outreach master switch: { t, on: true | false }.
    let b = {}; try { b = await req.json(); } catch (e) { /* bad body */ }
    if (req.method !== 'POST' || !(await allowed(req, env, url, String(b.t || '')))) return new Response('{"ok":false}', { status: 403, headers: { 'content-type': 'application/json' } });
    if (typeof b.on !== 'boolean') return new Response('{"ok":false}', { status: 400, headers: { 'content-type': 'application/json' } });
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)'),
      env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('outreach_enabled', ?1)").bind(b.on ? '1' : '0'),
      env.DB.prepare("INSERT OR REPLACE INTO billing_config (k, v) VALUES ('outreach_switched', ?1)").bind((b.on ? 'on ' : 'off ') + new Date().toISOString())
    ]);
    return new Response(JSON.stringify({ ok: true, on: b.on }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (!(await allowed(req, env, url))) return new Response('Not found', { status: 404 });
  if (path === '/ops/compliance-pack') {
    try { return new Response(buildPack(new Date().toISOString().slice(0, 10)), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="compliance-guard-rules.pdf"', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } }); }
    catch (e) { return new Response('Could not build the pack: ' + String((e && e.message) || e).slice(0, 120), { status: 500 }); }
  }
  const tok = await boardToken(env);   // a fresh link for the page's own buttons and links, whatever opened it
  const cookie = await boardCookie(env);
  if (path === '/ops/numbers') {
    const N = await import('./numbers.js');
    return new Response(N.renderNumbers(await N.numbersState(env), '/ops?t=' + tok), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'set-cookie': cookie } });
  }
  return new Response('Not found', { status: 404 });
}

// Monday email to MAIL_TO. Once per week.
export async function boardWeekly(env, at) {
  if (!env.EMAIL || !env.MAIL_FROM || !env.MAIL_TO || !env.LEADS_KEY) return 'off';
  await ensure(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_alerts (type TEXT PRIMARY KEY, at INTEGER, n INTEGER)').run();
  const d = new Date(at || Date.now()), mark = 'board:' + d.toISOString().slice(0, 10);
  const have = await env.DB.prepare('SELECT 1 AS x FROM ops_alerts WHERE type = ?1').bind(mark).first();
  if (have) return 'have';
  await env.DB.prepare('INSERT OR IGNORE INTO ops_alerts (type, at, n) VALUES (?1, ?2, 0)').bind(mark, d.getTime()).run();
  const items = await boardItems(env);
  const link = 'https://alwaysopenoffice.com/ops?t=' + await boardToken(env);
  let dl = ''; try { dl = driftText(await driftRows(env)); } catch (e) { dl = ''; }
  const numbers = 'https://alwaysopenoffice.com/ops/numbers?t=' + await boardToken(env);
  const body = (dl ? dl + '\n\n' : '') + boardText(items, link) + '\nThe numbers (revenue, funnel, costs, margin): ' + numbers + '\n';
  const n = items.filter(x => !INFO.test(x.key)).length;
  const e = neonEmail(boardEmail(items, link, numbers, dl));
  const raw = rawEmail({ fromName: 'Always Open week', from: env.MAIL_FROM, to: env.MAIL_TO, subject: n ? 'Your week: ' + n + (n === 1 ? ' thing' : ' things') + ' only you can do' : 'Your week: all clear' }, body, e.html);
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); return 'sent'; } catch (e) { return 'failed'; }
}
