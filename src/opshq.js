// Always Open HQ: the one page (Nov 11, 2026). Everything that can need Christopher is in one list at the top, each
// with its button right there, and a tally that always shows every kind with its count, so a zero is a checked zero:
//   clients waiting on a reply (answer box) · replies and posts approved for Google (Copy and open Google, Posted) ·
//   requests to call back · this week's to-dos (Done) · things that are off (in plain words, with what to do).
// Below it, folded: clients, calls, closed requests, how things stand, who is drifting, the switches, and the numbers.
// It reads the site's own tables each time it opens, so nothing is copied and nothing can fall behind.
// Why one page: there used to be a to-do board (/ops), this page, a Google posting page (/ops/post) and an older page
// on claude.ai, and he said "there's too many small places something could be". /ops and /ops/hq are now this page,
// and /ops/post sends you to its Google part.
//   GET  /ops, /ops/hq    the page (ops key in x-key, the dated link, or the cookie of a device that opened it before)
//   POST /ops/hq/reply    { t, client, text }: Katie's answer, into the client's app (app_messages, dir 'out')
//   POST /ops/hq/lead     { t, id, status, note }: where a request stands (new, talking, won, lost)
//   (Posted, Done and the switches use the addresses they always had: /ops/post, /ops/done, /ops/outreach-switch, /ops/map.)
// A reply shows in the client's app as "Always Open" and buzzes their iPhone on the next ten-minute run (app.js appCron).
import { AUTO_BY, INTERNAL } from './checks.js';
import { PROMISES } from './facts.js';
const SUPPORT_NAME = PROMISES.support;   // Katie: the name on every answer

const DAY = 864e5;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const J = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
// A table that is not there yet (a brand-new database) reads as empty, so the page always opens.
const rows = async (env, sql, ...binds) => { try { return ((await env.DB.prepare(sql).bind(...binds).all()).results) || []; } catch (e) { return []; } };
// Requests: everything but spam, and a mailed letter only once they asked for a call. The lead-mail columns (grade,
// callme_at) are added the first time a lead email runs, so a database that has never sent one is read without them.
async function leadRows(env, since) {
  const sql = extra => 'SELECT l.id, l.at, l.name, l.email, l.phone, l.business, l.town, l.type, l.plan, l.notes, l.origin, l.status, l.reason' + (extra ? ', l.grade, l.callme_at' : '') +
    ", k.summary AS call_summary, k.test AS call_test FROM leads l LEFT JOIN app_calls k ON l.origin LIKE 'phone %' AND k.id = substr(l.origin, 7) WHERE l.status != 'spam' AND " +
    (extra ? "(l.status != 'letter' OR COALESCE(l.callme_at, '') != '')" : "l.status != 'letter'") + ' AND l.at > ?1 ORDER BY l.id DESC LIMIT 80';
  try { return ((await env.DB.prepare(sql(true)).bind(since).all()).results) || []; } catch (e) { return rows(env, sql(false), since); }
}
const ET = 'America/New_York';
export function when(iso, now) {
  const t = Date.parse(iso); if (!t) return '';
  const d = new Date(t), day = x => new Date(x).toLocaleDateString('en-US', { timeZone: ET });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
  if (day(t) === day(now)) return 'Today ' + time;
  if (day(t) === day(now - DAY)) return 'Yesterday ' + time;
  if (now - t < 6 * DAY) return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: ET }) + ' ' + time;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ET });
}
export function ago(iso, now) {
  const t = Date.parse(iso); if (!t) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return m + ' min';
  if (m < 48 * 60) return Math.round(m / 60) + ' hr';
  return Math.round(m / 1440) + ' days';
}
const phone = p => { let d = String(p || '').replace(/[^0-9]/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(p || ''); };
const tel = p => { const d = String(p || '').replace(/[^0-9+]/g, ''); return d ? '<a href="tel:' + esc(d) + '">' + esc(phone(p)) + '</a>' : ''; };
export const LEAD_STATUS = ['new', 'talking', 'won', 'lost'];

// Everything the page shows, read fresh.
export async function hqState(env, now) {
  now = now || Date.now();
  const iso = ms => new Date(ms).toISOString();
  const [clients, lines, bills, calls7, pending, lastIn, lastSeen, waitingRows, leads, calls, tests, more] = await Promise.all([
    rows(env, 'SELECT client_id, business, owner_first, tier, active, regulated, phone, updated FROM app_clients ORDER BY business'),
    rows(env, 'SELECT client_id, number, on_air FROM voice_lines'),
    rows(env, 'SELECT client_id, plan, status, created, email, owner, phone, town, paused_until FROM billing'),
    rows(env, 'SELECT client_id, COUNT(*) AS n, MAX(at) AS last FROM app_calls WHERE test = 0 AND at > ?1 GROUP BY client_id', iso(now - 7 * DAY)),
    rows(env, "SELECT client_id, COUNT(*) AS n, MIN(created) AS oldest FROM app_items WHERE status = 'pending' GROUP BY client_id"),
    rows(env, "SELECT client_id, MAX(at) AS last FROM app_messages WHERE dir = 'in' GROUP BY client_id"),
    rows(env, 'SELECT client_id, MAX(last_seen) AS last FROM app_devices GROUP BY client_id'),
    // a client's message with no answer from a person after it (the automatic "got it" does not count)
    rows(env, "SELECT m.id, m.client_id, m.at FROM app_messages m WHERE m.dir = 'in' AND m.at > ?1 AND NOT EXISTS (SELECT 1 FROM app_messages r WHERE r.client_id = m.client_id AND r.dir = 'out' AND r.by != ?2 AND r.at >= m.at) ORDER BY m.at", iso(now - 30 * DAY), AUTO_BY),
    leadRows(env, iso(now - 120 * DAY)),
    rows(env, 'SELECT id, client_id, at, caller, caller_name, reason, summary, urgency, outcome, status, seconds FROM app_calls WHERE test = 0 AND at > ?1 ORDER BY at DESC LIMIT 40', iso(now - 7 * DAY)),
    rows(env, 'SELECT COUNT(*) AS n FROM app_calls WHERE test = 1 AND at > ?1', iso(now - 7 * DAY)),
    gather(env, now)
  ]);
  const by = (list, k) => { const m = new Map(); for (const r of list) m.set(r[k], r); return m; };
  const L = by(lines, 'client_id'), B = by(bills, 'client_id'), C7 = by(calls7, 'client_id'), P = by(pending, 'client_id'), LI = by(lastIn, 'client_id'), LS = by(lastSeen, 'client_id');
  const name = new Map(clients.map(c => [c.client_id, c.business || c.client_id]));
  // who is waiting, oldest first, with the last of the conversation
  const waitIds = [...new Set(waitingRows.map(r => r.client_id))];
  const since = new Map(); for (const r of waitingRows) if (!since.has(r.client_id)) since.set(r.client_id, r.at);
  const threads = new Map();
  for (const id of waitIds.slice(0, 20)) {
    const t = await rows(env, 'SELECT id, at, by, text, dir FROM app_messages WHERE client_id = ?1 ORDER BY id DESC LIMIT 8', id);
    threads.set(id, t.reverse());
  }
  return Object.assign({
    now,
    waiting: waitIds.map(id => ({ client: id, business: name.get(id) || id, since: since.get(id), internal: INTERNAL.has(id), thread: threads.get(id) || [] })),
    leads: leads.map(l => Object.assign({}, l, { test: +l.call_test === 1 })),
    clients: clients.map(c => ({
      id: c.client_id, business: c.business || c.client_id, first: c.owner_first || '', tier: c.tier || '', active: +c.active !== 0, internal: INTERNAL.has(c.client_id),
      line: L.get(c.client_id) || null, bill: B.get(c.client_id) || null, calls7: (C7.get(c.client_id) || {}).n || 0, lastCall: (C7.get(c.client_id) || {}).last || '',
      pending: (P.get(c.client_id) || {}).n || 0, pendingSince: (P.get(c.client_id) || {}).oldest || '', lastMessage: (LI.get(c.client_id) || {}).last || '', lastSeen: (LS.get(c.client_id) || {}).last || ''
    })),
    calls: calls.map(k => Object.assign({}, k, { business: name.get(k.client_id) || k.client_id })),
    tests: (tests[0] && +tests[0].n) || 0
  }, more);
}

// The Monday of the week holding `t` (UTC), so a "Done" on a quiet client lasts the week and no longer.
const weekOf = t => { const d = new Date(t); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const tellClaude = what => 'Tell Claude: “' + what + '”';

// The rest of what can need him, from the parts of the site that already know it. Each part is on its own: one that
// fails leaves its part empty and the page still opens.
//   post: approved replies and posts not on Google yet (postqueue.js)      todo: the week's to-dos (opsboard.js boardItems)
//   off:  failing checks, a low Twilio balance, crashed pages, failed jobs  info: status lines, what Max caught, why callers walked
export async function gather(env, now) {
  now = now || Date.now();
  const out = { post: [], held: 0, todo: [], info: [], off: [], map: [], drift: '', driftCss: '', sw: null, switchHtml: '', mapHtml: '' };
  const safe = async f => { try { return await f(); } catch (e) { return undefined; } };
  const B = await safe(() => import('./opsboard.js'));
  const q = await safe(async () => (await import('./postqueue.js')).queueItems(env, now));
  if (q) { out.post = Array.from(q); out.held = +q.held || 0; }
  for (const it of ((B && await safe(() => B.boardItems(env))) || [])) {
    const k = String(it.key || '');
    if (k.startsWith('google:')) continue;                                   // each one is shown in full under "Post on Google"
    if (k.startsWith('err:')) out.off.push({ key: k, title: 'A page crashed: ' + it.title, what: it.detail, doThis: tellClaude('the ' + String(it.title).replace(/ \(\d+ times\)$/, '') + ' page on Always Open is crashing, fix it.') });
    else if (k === 'sys:cron:bad') out.off.push({ title: 'A background job needs a look', what: it.detail, doThis: tellClaude('an Always Open background job is failing, check it.') });
    else if (/^(sys:|lost:|caught:)/.test(k)) out.info.push(it);
    else out.todo.push(it);
  }
  // checks that are failing right now, in the plain words the alerts use
  await safe(async () => {
    const h = await (await import('./ops.js')).healthStatus(env, now), { explainAlert } = await import('./plainalerts.js');
    for (const c of h.checks) if (!c.ok) { const ex = explainAlert('health:' + c.name, c.why); out.off.push({ title: ex.title, what: ex.what, detail: c.why || '', doThis: ex.doThis, urgent: !!ex.urgent }); }
  });
  await safe(async () => {
    const f = await (await import('./funding.js')).fundingState(env), m = /\s*\((URGENT|low)\)\s*$/.exec(f.twilio || '');
    if (m) out.off.push({ title: m[1] === 'URGENT' ? 'Twilio is almost out of money' : 'Twilio’s balance is getting low', what: 'Twilio carries Max’s calls and the texts. It has ' + f.twilio.replace(m[0], '') + '.', doThis: 'At twilio.com open Billing and add money, or turn on Auto recharge there so it never runs dry.', urgent: m[1] === 'URGENT' });
  });
  // a client going quiet enough to call: a to-do for the week
  await safe(async () => {
    const D = await import('./drift.js'), dr = await D.driftRows(env, now);
    out.drift = D.driftTable(dr); out.driftCss = D.DRIFT_CSS;
    const done = new Set((await rows(env, "SELECT k FROM ops_done WHERE k LIKE 'drift:%'")).map(r => r.k)), wk = weekOf(now);
    for (const r of dr) if (r.level === 'call' && !done.has('drift:' + r.client_id + ':' + wk)) out.todo.unshift({ key: 'drift:' + r.client_id + ':' + wk, group: 'Clients going quiet: call them', title: r.business, detail: (r.reasons || []).join('; ') + '.' });
  });
  await safe(async () => { out.map = await (await import('./map.js')).mapAdmin(env); out.mapHtml = B.mapSection(out.map); });
  await safe(async () => { out.sw = await B.outreachSwitch(env); out.switchHtml = B.switchSection(out.sw); });
  out.linkify = B ? B.linkify : (x => x);
  // Google posting: on means the site can post an approved reply itself (gbp.js); off means by hand, and why
  await safe(async () => { const L = await import('./launch.js'); out.googleOn = await L.isOn(env, 'google'); out.googleWhy = ((await L.launchState(env)).google || {}).detail || ''; });
  await safe(async () => { out.months = await monthRows(env, now); });
  await safe(async () => { out.rules = await wordingRules(); });
  return out;
}

// This month so far, for each client: the numbers their monthly page is built from (app.js monthFor).
export async function monthRows(env, now) {
  const { monthFor } = await import('./app.js'), { DEMO_ID } = await import('./demo.js'), list = [];
  for (const c of await rows(env, 'SELECT * FROM app_clients WHERE active = 1 AND client_id != ?1 ORDER BY business', DEMO_ID)) {
    try {
      const m = await monthFor(env, c, 'now', now), a = m.a || {}, n = x => +(x || 0);
      list.push({ business: c.business || c.client_id, label: m.label, calls: n(a.calls && a.calls.n), after: n(a.calls && a.calls.after), reviews: n(a.reviews && a.reviews.n), replies: n(m.stats && m.stats.replies), posts: n(m.stats && m.stats.posts) });
    } catch (e) { list.push({ business: c.business || c.client_id, failed: true }); }
  }
  return list;
}
// What a reply or post may not say: every client's rules, the extra ones for insurance, medical and legal offices, and
// wording that passes them. Read from the live rules (app.js, cpack.js), so this list is never out of date.
export async function wordingRules() {
  const A = await import('./app.js'), P = await import('./cpack.js');
  return { all: A.CG_ALL.map(r => r.why), strict: A.CG_RULES.map(r => r.why).filter(w => !A.CG_ALL.some(r => r.why === w)), pass: (P.PASS || []).map(x => x[1]) };
}


const CSS = ':root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#fff;--soft:#F5F4F0;--ok:#1E7A4F;--warn:#9A5B00;--hot:#B3261E}' +
  '@media(prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--soft:#1A1F2B;--ok:#5CC9A4;--warn:#F2C46B;--hot:#FF8A80}}' +
  '*{box-sizing:border-box}html{scroll-padding-top:12px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:680px;margin:0 auto;padding:24px 16px 72px}' +
  'h1{font-size:26px;margin:0 0 2px}h2{font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin:30px 0 8px}p{margin:0;color:var(--slate)}a{color:inherit}' +
  '.big{font-size:22px;font-weight:700;color:var(--ink);margin:10px 0 2px}.big.clear{color:var(--ok)}' +
  // the tally: every kind of thing that can need him, always all five, each with its count
  '.tally{list-style:none;margin:14px 0 0;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}.tally li+li{border-top:1px solid var(--line)}' +
  '.tally .t{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 14px;text-decoration:none;color:var(--slate)}.tally a.t{color:var(--ink);font-weight:600;background:var(--soft)}' +
  '.tally .n{flex:none;min-width:34px;height:34px;padding:0 8px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ok);border:1px solid var(--line)}' +
  '.tally a.t .n{background:var(--ink);color:var(--paper);border-color:var(--ink)}.tally .go{margin-left:auto;color:var(--slate);font-weight:400;font-size:14px;white-space:nowrap}' +
  '.it{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);margin-bottom:10px}.it b{font-size:17px}.it>b,.it>div>b{display:block}.it .sub{display:block;color:var(--slate);font-size:14px;margin-top:2px;overflow-wrap:anywhere}.it .sub b{font-size:14px;color:var(--ink)}' +
  '.it.row{display:flex;gap:12px;align-items:center;justify-content:space-between}.it.row>div{min-width:0}.grp{font-weight:600;color:var(--ink);margin:14px 0 6px;font-size:15px}' +
  '.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.tag{font-size:13px;font-weight:600;padding:2px 9px;border-radius:99px;border:1px solid var(--line);background:var(--paper)}.tag.ok{color:var(--ok)}.tag.warn{color:var(--warn)}.tag.hot{color:var(--hot)}' +
  '.th{display:grid;gap:6px;margin:10px 0}.m{max-width:88%;padding:8px 11px;border-radius:14px;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--paper);border:1px solid var(--line)}.m.out{justify-self:end;background:transparent}.m small{display:block;color:var(--slate);font-size:12px;margin-top:2px}' +
  '.words{margin-top:8px;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:all;user-select:all}' +
  'input.note{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);margin-top:8px;min-height:44px}select.note{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);min-height:44px}textarea{width:100%;min-height:84px;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);margin-top:8px}' +
  '.acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}button,a.btn{font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);min-height:44px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;text-align:center}button.go,a.btn.go{background:var(--ink);color:var(--paper);border-color:var(--ink)}button[disabled]{opacity:.5}' +
  '.said{font-size:14px;color:var(--slate)}.none{padding:14px;border:1px dashed var(--line);border-radius:12px;color:var(--slate)}' +
  // the look-up rows at the bottom: closed until tapped
  'details.look{border:1px solid var(--line);border-radius:12px;margin-bottom:8px}details.look>summary{cursor:pointer;font-weight:600;min-height:52px;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;list-style:none}details.look>summary::-webkit-details-marker{display:none}details.look>summary::after{content:"+";color:var(--slate);font-weight:400;font-size:20px}details.look[open]>summary::after{content:"–"}details.look>.in{padding:4px 12px 12px}' +
  'details.more{margin-top:8px}details.more>summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}' +
  'a.look{display:flex;align-items:center;justify-content:space-between;min-height:52px;padding:8px 14px;border:1px solid var(--line);border-radius:12px;font-weight:600;text-decoration:none;margin-bottom:8px}a.look::after{content:"›";color:var(--slate);font-size:20px}' +
  '.kv{display:block;padding:8px 0;border-top:1px solid var(--line);font-size:14px;color:var(--slate);overflow-wrap:anywhere}.kv:first-child{border-top:0}.kv b{display:block;color:var(--ink);font-size:15px}' +
  // the switches come ready-made from the board (opsboard.js switchSection, mapSection)
  '.bd h2{margin:10px 0 8px}.bd .it{display:flex;gap:12px;align-items:center;justify-content:space-between}.bd .it span{display:block;color:var(--slate);font-size:14px}' +
  ':focus-visible{outline:2px solid var(--ink);outline-offset:2px}';

function msgBox(id, label) {
  return '<label style="display:block"><span class="sub" style="color:var(--slate);font-size:14px">' + esc(label) + '</span><textarea maxlength="1000" data-for="' + esc(id) + '"></textarea></label>' +
    '<div class="acts"><button type="button" class="go" data-send="' + esc(id) + '">Send as ' + esc(SUPPORT_NAME) + '</button><span class="said" data-said="' + esc(id) + '" role="status"></span></div>';
}
function threadHtml(thread, now) {
  if (!thread.length) return '';
  return '<div class="th">' + thread.map(m => '<div class="m ' + (m.dir === 'out' ? 'out' : 'in') + '">' + esc(m.text) + '<small>' + esc(m.dir === 'out' ? (m.by === AUTO_BY ? 'Automatic' : (m.by || SUPPORT_NAME)) : (m.by || 'Client')) + ', ' + esc(when(m.at, now)) + '</small></div>').join('') + '</div>';
}
function leadHtml(l, now) {
  const who = String(l.business || l.name || '').trim() || (/^phone /.test(l.origin || '') ? 'Caller' : 'Someone');
  const src = /^phone /.test(l.origin || '') ? 'Called the sales line' : (/^letter/.test(l.origin || '') ? 'Asked for a call from their letter' : 'Filled in the form');
  const bits = [l.name && l.business ? l.name : '', l.type, l.town, l.plan ? l.plan + ' plan' : '', l.grade ? 'grade ' + l.grade : ''].filter(Boolean).map(esc);
  const contact = [tel(l.phone), l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' : ''].filter(Boolean).join(' &nbsp; ');
  const tags = '<span class="tag' + (l.status === 'won' ? ' ok' : l.status === 'talking' ? ' warn' : '') + '">' + esc(l.test ? 'Test call' : ({ new: 'New', letter: 'New', talking: 'Talking', won: 'Won', lost: 'Lost' }[l.status] || l.status)) + '</span>';
  const btn = (s, t) => (l.status === s ? '' : '<button type="button" data-lead="' + l.id + '" data-s="' + s + '">' + t + '</button>');
  return '<div class="it"><b>' + esc(who) + '</b><span class="sub">' + esc(src) + ', ' + esc(when(l.at, now)) + (bits.length ? '. ' + bits.join(', ') : '') + '</span>' +
    (contact ? '<span class="sub">' + contact + '</span>' : '') +
    (l.call_summary ? '<span class="sub">' + esc(String(l.call_summary).slice(0, 300)) + '</span>' : '') + (l.notes ? '<span class="sub">' + esc(String(l.notes).slice(0, 300)) + '</span>' : '') +
    (l.reason ? '<span class="sub">Note: ' + esc(l.reason) + '</span>' : '') +
    '<div class="tags">' + tags + '</div><div class="acts">' + btn('talking', 'Talking') + btn('won', 'Won') + btn('lost', 'Lost') + (l.status === 'new' || l.status === 'letter' ? '' : btn('new', 'Back to new')) + '</div></div>';
}
function clientHtml(c, now) {
  const b = c.bill, ln = c.line;
  const tags = [];
  if (c.internal) tags.push('<span class="tag">' + (c.id === 'always-open' ? 'Your own line' : 'Demo') + '</span>');
  if (c.tier) tags.push('<span class="tag">' + esc(c.tier) + '</span>');
  if (b && b.status && b.status !== 'active') tags.push('<span class="tag warn">Billing: ' + esc(b.status) + '</span>');
  if (!c.active) tags.push('<span class="tag hot">Turned off</span>');
  if (ln) tags.push('<span class="tag ' + (+ln.on_air ? 'ok' : 'warn') + '">Max ' + (+ln.on_air ? 'answering' : 'off') + '</span>');
  if (c.pending) tags.push('<span class="tag warn">' + c.pending + ' waiting on their OK' + (c.pendingSince ? ', oldest ' + esc(ago(c.pendingSince, now)) : '') + '</span>');
  const mid = iso => when(iso, now).replace(/^(Today|Yesterday)/, m => m.toLowerCase());   // inside a sentence
  const facts = [ln ? 'Line ' + phone(ln.number) : 'No line yet', c.calls7 + (c.calls7 === 1 ? ' call' : ' calls') + ' this week' + (c.lastCall ? ', the last ' + mid(c.lastCall) : ''),
    c.lastSeen ? 'Opened the iPhone app ' + mid(c.lastSeen) : '', c.lastMessage ? 'Last wrote ' + mid(c.lastMessage) : '', b && b.created ? 'Client since ' + new Date(b.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: ET }) : ''].filter(Boolean);
  const reach = [b && b.owner ? esc(b.owner) : (c.first ? esc(c.first) : ''), tel((b && b.phone) || ''), b && b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : '', b && b.town ? esc(b.town) : ''].filter(Boolean).join(' &nbsp; ');
  return '<div class="it"><b>' + esc(c.business) + '</b><span class="sub">' + esc(facts.join('. ')) + '.</span>' + (reach ? '<span class="sub">' + reach + '</span>' : '') +
    (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') +
    (c.id === 'always-open' ? '' : '<details class="more"><summary>Write to them</summary>' + msgBox(c.id, 'Shows in their app as Always Open, and buzzes their iPhone.') + '</details>') + '</div>';
}
function callHtml(k, now) {
  const who = String(k.caller_name || '').trim() || phone(k.caller) || 'Unknown caller';
  const tags = [(k.urgency === 'urgent' ? '<span class="tag hot">Urgent</span>' : ''), (k.outcome === 'hangup' ? '<span class="tag warn">Hung up</span>' : k.outcome === 'transferred' ? '<span class="tag ok">Put through</span>' : ''),
    (k.status === 'handled' ? '<span class="tag ok">Handled</span>' : '<span class="tag">Not marked handled</span>')].filter(Boolean).join('');
  return '<div class="it"><b>' + esc(k.business) + '</b><span class="sub">' + esc(when(k.at, now)) + ', ' + esc(who) + (+k.seconds ? ', ' + Math.max(1, Math.round(k.seconds / 60)) + ' min' : '') + '</span>' +
    (k.summary || k.reason ? '<span class="sub">' + esc(String(k.summary || k.reason).slice(0, 320)) + '</span>' : '') + '<div class="tags">' + tags + '</div></div>';
}

// One approved reply or post waiting to go on Google: what was said, the approved words, and the two taps.
function postHtml(it, now, apiOn) {
  const st = Math.max(0, Math.min(5, Math.round(+it.stars || 0)));
  const head = it.kind === 'post' ? 'A post for their Google profile' : (st ? '★'.repeat(st) + '☆'.repeat(5 - st) + ' from ' + esc(it.title || 'a customer') : 'Review from ' + esc(it.title || 'a customer'));
  return '<div class="it"><b>' + esc(it.business) + '</b><span class="sub">' + head + '</span>' +
    (it.kind !== 'post' && it.review ? '<span class="sub">“' + esc(String(it.review).slice(0, 400)) + (String(it.review).length > 400 ? '…' : '') + '”</span>' : '') +
    '<span class="sub">Approved' + (it.by ? ' by ' + esc(it.by) : '') + (it.approvedAt ? ', ' + esc(ago(it.approvedAt, now)) + ' ago' : '') + '. ' + (it.kind === 'post' ? 'The post:' : 'The reply:') + '</span>' +
    '<div class="words">' + esc(it.words) + '</div>' +
    (apiOn ? '<div class="acts"><button type="button" class="go" data-postapi="' + esc(it.id) + '">Post it for me</button><span class="said" role="status"></span></div>' +
      '<details class="more"><summary>Or post it by hand</summary><div class="acts"><a class="btn" href="' + esc(it.link) + '" target="_blank" rel="noopener" data-copy="' + esc(it.words) + '">Copy and open Google</a><button type="button" data-posted="' + esc(it.id) + '">Posted</button><span class="said" role="status"></span></div></details></div>'
    : '<div class="acts"><a class="btn go" href="' + esc(it.link) + '" target="_blank" rel="noopener" data-copy="' + esc(it.words) + '">Copy and open Google</a><button type="button" data-posted="' + esc(it.id) + '">Posted</button><span class="said" role="status"></span></div>' +
      '<span class="sub">' + (it.kind === 'post' ? 'On Google, tap Add update, paste, and post.' : 'On Google, find this review, tap Reply, paste, and post.') + ' Then tap Posted here.</span></div>');
}
function todoHtml(items, linkify) {
  const g = new Map(); for (const it of items) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it); }
  return [...g].map(([name, list]) => '<p class="grp">' + esc(name) + '</p>' + list.map(x => '<div class="it row"><div><b>' + esc(x.title) + '</b><span class="sub">' + linkify(esc(x.detail)) + '</span></div><button type="button" data-done="' + esc(x.key) + '" data-at="todo">Done</button></div>').join('')).join('');
}
function offHtml(list) {
  return list.map(x => '<div class="it"><b>' + esc(x.title) + '</b><span class="sub">' + esc(x.what) + '</span>' + (x.detail ? '<span class="sub">What the check said: ' + esc(x.detail) + '</span>' : '') +
    '<span class="sub"><b>Do this:</b> ' + esc(x.doThis) + '</span>' + (x.key ? '<div class="acts"><button type="button" data-done="' + esc(x.key) + '" data-at="off">Seen it</button></div>' : '') + '</div>').join('');
}
function infoHtml(list) {
  const g = new Map(); for (const it of list) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it); }
  return [...g].map(([name, rows]) => '<p class="grp">' + esc(name) + '</p>' + rows.map(x => '<span class="kv"><b>' + esc(x.title) + '</b>' + esc(x.detail) + '</span>').join('')).join('');
}

// What runs in the page. It stands alone (it is sent as text), so it uses nothing from this file.
function hqClient(T) {
  function send(u, b) { b.t = T; return fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); }); }
  function again(at) { try { history.replaceState(null, '', location.pathname + location.search + (at ? '#' + at : '')); } catch (e) { /* the reload still happens */ } location.reload(); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-copy]');
    if (a) {   // the link itself opens Google in a new tab; this puts the approved words on the clipboard first
      var said0 = a.closest('.acts').querySelector('.said'), hold = 'Press and hold the words above to copy them.';
      try { navigator.clipboard.writeText(a.getAttribute('data-copy')).then(function () { said0.textContent = 'Copied. Paste it on Google, then tap Posted.'; }, function () { said0.textContent = hold; }); } catch (x) { said0.textContent = hold; }
      return;
    }
    var b = e.target.closest('button'); if (!b) return;
    var row = b.closest('.it');
    if (b.dataset.send) {
      var id = b.dataset.send, box = row.querySelector('textarea[data-for="' + id + '"]'), said = row.querySelector('[data-said]'), tx = (box.value || '').trim();
      if (!tx) { said.textContent = 'Type your message first.'; box.focus(); return; }
      b.disabled = true; said.textContent = 'Sending…';
      send('/ops/hq/reply', { client: id, text: tx }).then(function (j) { if (j.ok) { box.value = ''; said.textContent = 'Sent. It is in their app now.'; setTimeout(function () { again(''); }, 900); } else { b.disabled = false; said.textContent = j.error || 'Did not send. Try again.'; } }).catch(function () { b.disabled = false; said.textContent = 'No connection. Try again.'; });
      return;
    }
    if (b.dataset.lead) {
      var note = '';
      if ((b.dataset.s === 'lost' || b.dataset.s === 'won') && !b.dataset.sure) {   // an optional note, in the row, then a second tap
        b.dataset.sure = '1'; var i = document.createElement('input'); i.type = 'text'; i.maxLength = 200; i.className = 'note';
        i.placeholder = b.dataset.s === 'lost' ? 'Why was it lost? (optional)' : 'A note for your records (optional)'; i.setAttribute('aria-label', i.placeholder);
        row.appendChild(i); b.textContent = 'Save as ' + b.dataset.s; b.className = 'go'; i.focus(); return;
      }
      var n = row.querySelector('input.note'); if (n) note = n.value;
      b.disabled = true;
      send('/ops/hq/lead', { id: +b.dataset.lead, status: b.dataset.s, note: note }).then(function (j) { if (j.ok) again('requests'); else { b.disabled = false; b.textContent = 'Did not save. Try again'; } }).catch(function () { b.disabled = false; });
      return;
    }
    if (b.dataset.postapi) {   // the site posts it on Google itself
      var ps = b.parentNode.querySelector('.said');
      b.disabled = true; ps.textContent = 'Posting on Google…';
      send('/ops/hq/post', { id: b.dataset.postapi }).then(function (j) { if (j.ok) { ps.textContent = j.result === 'already' ? 'Google already had a reply there. Cleared.' : 'Posted on Google.'; setTimeout(function () { again('google'); }, 900); } else { b.disabled = false; ps.textContent = j.error || 'Did not post. Try again, or post it by hand.'; } }).catch(function () { b.disabled = false; ps.textContent = 'No connection. Try again.'; });
      return;
    }
    if (b.dataset.addclient) {
      var f = b.closest('.in'), val = function (k) { var x = f.querySelector('[data-f="' + k + '"]'); return x ? (x.type === 'checkbox' ? x.checked : x.value) : ''; }, as = f.querySelector('.said');
      if (!String(val('business')).trim()) { as.textContent = 'Add the business name.'; return; }
      b.disabled = true; as.textContent = 'Adding…';
      send('/ops/hq/client', { business: val('business'), owner: val('owner'), phone: val('phone'), email: val('email'), town: val('town'), type: val('type'), plan: val('plan'), line: val('line') }).then(function (j) {
        if (!j.ok) { b.disabled = false; as.textContent = j.error || 'Did not add. Try again.'; return; }
        var box = f.querySelector('[data-made]'); box.hidden = false; box.querySelector('b').textContent = j.business + ' is added.';
        var ln = box.querySelector('a'); ln.href = j.link; ln.textContent = j.link; ln.setAttribute('data-copy', j.link);
        box.querySelector('.sub').textContent = 'This is their private app link. Send it to them. ' + (j.line ? 'Max’s number is being set up and shows in their app when it is ready.' : 'No phone number was bought. They can tap Set up Max in their app.');
        as.textContent = 'Added.'; f.querySelectorAll('input[data-f]').forEach(function (x) { if (x.type === 'checkbox') x.checked = false; else x.value = ''; }); b.disabled = false;
      }).catch(function () { b.disabled = false; as.textContent = 'No connection. Try again.'; });
      return;
    }
    if (b.dataset.posted) {
      b.disabled = true; b.textContent = 'Saving…';
      fetch('/ops/post?t=' + encodeURIComponent(T), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.posted }) }).then(function (r) { return r.json(); })
        .then(function (j) { if (j.ok) again('google'); else { b.disabled = false; b.textContent = 'Did not save. Try again'; } }).catch(function () { b.disabled = false; b.textContent = 'No connection. Try again'; });
      return;
    }
    if (b.dataset.done) {
      b.disabled = true;
      send('/ops/done', { k: b.dataset.done }).then(function (j) { if (j.ok) again(b.dataset.at || ''); else b.disabled = false; }).catch(function () { b.disabled = false; });
      return;
    }
    if (b.dataset.osw) {
      if (b.dataset.osw === '1' && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to turn on'; return; }
      b.disabled = true;
      send('/ops/outreach-switch', { on: b.dataset.osw === '1' }).then(function (j) { if (j.ok) again('look'); else { b.disabled = false; b.textContent = 'Did not work. Try again'; } }).catch(function () { b.disabled = false; });
      return;
    }
    if (b.dataset.map) {
      b.disabled = true;
      send('/ops/map', { id: b.dataset.map, show: b.dataset.show === '1' }).then(function (j) { if (j.ok) again('look'); else b.disabled = false; }).catch(function () { b.disabled = false; });
    }
  });
  // a look-up row that was open stays open through the reload after a tap inside it
  try {
    var KEY = 'aohq-open', open = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    document.querySelectorAll('details.look').forEach(function (d) {
      if (open.indexOf(d.id) > -1) d.open = true;
      d.addEventListener('toggle', function () { var now = []; document.querySelectorAll('details.look[open]').forEach(function (x) { now.push(x.id); }); try { sessionStorage.setItem(KEY, JSON.stringify(now)); } catch (e) { /* private window */ } });
    });
  } catch (e) { /* the page works without it */ }
}

// The five kinds of thing that can need him, in the order they are worth doing. Always all five: a zero is a checked zero.
export function tally(s) {
  const openLeads = s.leads.filter(l => !l.test && (l.status === 'new' || l.status === 'letter' || l.status === 'talking'));
  return [
    { id: 'reply', label: 'Clients waiting on your reply', n: s.waiting.length },
    { id: 'google', label: 'Approved for Google, waiting to be posted', n: (s.post || []).length },
    { id: 'requests', label: 'Requests to call back', n: openLeads.length },
    { id: 'todo', label: 'To do this week', n: (s.todo || []).length },
    { id: 'off', label: 'Things that are off', n: (s.off || []).length }
  ];
}

export function hqHtml(s, tok) {
  const now = s.now, linkify = s.linkify || (x => x);
  const open = s.leads.filter(l => !l.test && (l.status === 'new' || l.status === 'letter' || l.status === 'talking'));
  const closed = s.leads.filter(l => l.test || !(l.status === 'new' || l.status === 'letter' || l.status === 'talking'));
  const real = s.clients.filter(c => !c.internal), own = s.clients.filter(c => c.internal);
  const post = s.post || [], todo = s.todo || [], off = s.off || [], info = s.info || [];
  const T = tally(s), total = T.reduce((a, x) => a + x.n, 0);
  const asOf = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
  const sec = (id, title, n, body) => (n ? '<section id="' + id + '"><h2>' + esc(title) + ' (' + n + ')</h2>' + body + '</section>' : '');
  const look = (id, title, body) => (body ? '<details class="look" id="look-' + id + '"><summary>' + esc(title) + '</summary><div class="in">' + body + '</div></details>' : '');
  const waiting = s.waiting.map(w => '<div class="it"><b>' + esc(w.business) + '</b><span class="sub">Waiting ' + esc(ago(w.since, now)) + (w.internal ? ' (your own test account)' : '') + '</span>' + threadHtml(w.thread, now) + msgBox(w.client, 'Your answer') + '</div>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + (total ? '(' + total + ') ' : '') + 'Always Open HQ</title><style>' + CSS + (s.driftCss || '') + '</style></head><body><main>' +
    '<h1>Always Open HQ</h1>' +
    '<p class="big' + (total ? '' : ' clear') + '">' + (total ? total + (total === 1 ? ' thing needs you' : ' things need you') : 'Nothing needs you right now') + '</p>' +
    '<p>Everything that can need you is in this list, and nowhere else. As of ' + esc(asOf) + ' Eastern. <a href="/ops/hq?t=' + esc(tok) + '">Check again</a></p>' +
    '<ul class="tally">' + T.map(x => '<li>' + (x.n ? '<a class="t" href="#' + x.id + '"><span class="n">' + x.n + '</span><span>' + esc(x.label) + '</span><span class="go">Show</span></a>'
      : '<span class="t"><span class="n" aria-hidden="true">✓</span><span>' + esc(x.label) + ': none</span></span>') + '</li>').join('') + '</ul>' +
    sec('reply', 'Reply to clients', s.waiting.length, waiting) +
    sec('google', 'Post on Google', post.length, post.map(it => postHtml(it, now, !!s.googleOn)).join('') +
      (s.googleOn ? '' : '<p style="font-size:14px">These are posted by hand because Google has not let us post for clients yet. The day it does, this list posts itself and each row gets a Post it for me button.</p>')) +
    (s.held ? '<p style="margin:6px 0 0;font-size:14px">' + s.held + (s.held === 1 ? ' edited reply from a regulated client is' : ' edited replies from regulated clients are') + ' held for a compliance look first, so ' + (s.held === 1 ? 'it is' : 'they are') + ' not in the list yet.</p>' : '') +
    sec('requests', 'Requests to call back', open.length, open.map(l => leadHtml(l, now)).join('')) +
    sec('todo', 'To do this week', todo.length, todoHtml(todo, linkify)) +
    sec('off', 'Things that are off', off.length, offHtml(off)) +
    '<h2 id="look">Look things up</h2>' +
    look('clients', 'Clients (' + real.length + ')', (real.map(c => clientHtml(c, now)).join('') || '<p class="none">No clients yet. A signup shows here the moment Stripe confirms it.</p>') +
      (own.length ? '<details class="more"><summary>Your own line and the demo</summary>' + own.map(c => clientHtml(c, now)).join('') + '</details>' : '')) +
    look('calls', 'Calls Max took this week (' + s.calls.length + ')', (s.calls.map(k => callHtml(k, now)).join('') || '<p class="none">No calls from real callers this week.</p>') +
      (s.tests ? '<p style="margin-top:6px;font-size:14px">' + s.tests + ' test ' + (s.tests === 1 ? 'call is' : 'calls are') + ' not shown (the 4 AM check and calls from your own numbers).</p>' : '')) +
    look('closed', 'Requests already closed (' + closed.length + ')', closed.map(l => leadHtml(l, now)).join('')) +
    look('stand', 'How things stand', infoHtml(info)) +
    look('drift', 'Who is drifting', s.drift ? '<div class="bd">' + s.drift + '</div>' : '') +
    look('switches', 'Switches: Outreach calls and the map', (s.switchHtml || s.mapHtml) ? '<div class="bd">' + (s.switchHtml || '') + (s.mapHtml || '') + '</div>' : '') +
    look('months', 'This month for each client', (s.months || []).length ? s.months.map(m => '<span class="kv"><b>' + esc(m.business) + '</b>' + (m.failed ? 'Could not read this month.' : esc(m.label + ' so far: ' + m.calls + (m.calls === 1 ? ' call' : ' calls') + ' (' + m.after + ' after hours), ' + m.reviews + (m.reviews === 1 ? ' review' : ' reviews') + ', ' + m.replies + (m.replies === 1 ? ' reply' : ' replies') + ', ' + m.posts + (m.posts === 1 ? ' post' : ' posts') + '.')) + '</span>').join('') : '') +
    look('wording', 'Wording rules, and the extra ones for regulated offices', s.rules ? '<p class="grp">Every client: a reply or post is stopped if it</p>' + s.rules.all.map(w => '<span class="kv">' + esc(w) + '</span>').join('') +
      '<p class="grp">Insurance, medical and legal offices, also</p>' + s.rules.strict.map(w => '<span class="kv">' + esc(w) + '</span>').join('') +
      (s.rules.pass.length ? '<p class="grp">Wording that passes</p>' + s.rules.pass.map(w => '<div class="words">' + esc(w) + '</div>').join('') : '') +
      '<p style="font-size:14px;margin-top:8px">A regulated office’s reply that the owner edited waits for your look before it can post.</p><div class="acts"><a class="btn" href="/ops/compliance-pack?t=' + esc(tok) + '" target="_blank" rel="noopener">Open the one-page rule sheet</a></div>' : '') +
    look('add', 'Add a client by hand', addClientHtml()) +
    '<a class="look" href="/ops/numbers?t=' + esc(tok) + '">The numbers: revenue, costs and margin</a>' +
    '<script>(' + hqClient.toString() + ')(' + JSON.stringify(tok || '') + ');</script></main></body></html>';
}

// For someone who paid outside the website's checkout (a Stripe Payment Link, a check): the website makes a client on
// its own only from its own checkout. This makes their app; a phone number is bought only if the box is ticked.
function addClientHtml() {
  const inp = (k, label, type, ph) => '<label style="display:block;margin-top:8px;font-size:14px;color:var(--slate)">' + label + '<input class="note" style="margin-top:4px" type="' + (type || 'text') + '" data-f="' + k + '" maxlength="120"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off"></label>';
  const pick = (k, label, opts) => '<label style="display:block;margin-top:8px;font-size:14px;color:var(--slate)">' + label + '<select class="note" style="margin-top:4px" data-f="' + k + '">' + opts.map(o => '<option>' + esc(o) + '</option>').join('') + '</select></label>';
  return '<p style="font-size:14px">For someone who paid you outside the website (a Stripe Payment Link, a check). A signup through the website is added on its own.</p>' +
    inp('business', 'Business name') + inp('owner', 'Owner’s name') + inp('phone', 'Owner’s cell', 'tel') + inp('email', 'Email', 'email') + inp('town', 'Town and state', 'text', 'Eatonton, GA') +
    pick('type', 'Kind of business', HAND_TYPES) + pick('plan', 'Plan', HAND_PLANS) +
    '<label style="display:flex;gap:10px;align-items:center;margin-top:12px;min-height:44px"><input type="checkbox" data-f="line" style="width:22px;height:22px"> <span>Buy Max a phone number for them now (Twilio charges for the number)</span></label>' +
    '<div class="acts"><button type="button" class="go" data-addclient="1">Add this client</button><span class="said" role="status"></span></div>' +
    '<div class="it" data-made hidden style="margin-top:10px"><b></b><a class="sub" href="#" target="_blank" rel="noopener" style="display:block;min-height:44px;padding-top:10px"></a><span class="sub"></span></div>';
}
const HAND_TYPES = ['Contractor or trade', 'Dock, marine or outdoor', 'Salon, spa or fitness', 'Restaurant or shop', 'Insurance agency', 'Medical, dental or legal', 'Other'];
const HAND_PLANS = ['Starter', 'Growth', 'Pro'];
export async function hqAddClient(env, b) {
  const r = await (await import('./billing.js')).createByHand(env, b || {});
  return r.ok ? r : Object.assign(r, { code: 400 });
}
// "Post it for me": the site posts one approved reply or post on Google (gbp.js), for the ones approved before Google
// let us post. The same claim as an owner's approval, so a double tap or the by-hand button never posts it twice.
export async function hqPost(env, id) {
  const it = await env.DB.prepare("SELECT * FROM app_items WHERE id = ?1 AND status = 'approved'").bind(String(id || '').slice(0, 120)).first().catch(() => null);
  if (!it) return { ok: false, error: 'That one is not waiting any more.', code: 404 };
  const c = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(it.client_id).first().catch(() => null);
  if (!c) return { ok: false, error: 'That client is not on the site.', code: 404 };
  let r = '';
  try { r = await (await import('./gbp.js')).publishItem(env, c, it, String(it.decided_text || it.text || '')); } catch (e) { r = 'failed:' + String((e && e.message) || e).slice(0, 120); }
  if (r === 'posted' || r === 'already') return { ok: true, result: r };
  const why = r === 'off' ? 'Google has not let us post for clients yet. Post this one by hand.'
    : r === 'busy' ? 'It is being posted right now. Check again in a minute.'
    : r === 'skipped:no location' ? 'This business is not matched to its Google profile yet. Post this one by hand.'
    : r === 'skipped:regulated edit' ? 'This reply was edited, so it waits for a compliance look first.'
    : r === 'failed:no connection' ? 'There is no Google connection for this business. Post this one by hand.'
    : r === 'failed:not found' ? 'Google does not show this review any more. Post it by hand, or tap Posted if there is nothing to answer.'
    : 'Google did not take it (' + String(r).replace(/^(failed|skipped):/, '').slice(0, 120) + '). Post this one by hand.';
  return { ok: false, error: why };
}

// Katie's answer into a client's app.
export async function hqReply(env, clientId, text, now) {
  const id = String(clientId || '').slice(0, 80), tx = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!tx) return { ok: false, error: 'Type your message first.', code: 400 };
  if (tx.length > 1000) return { ok: false, error: 'Keep it under 1,000 characters.', code: 400 };
  const c = id && await env.DB.prepare('SELECT client_id FROM app_clients WHERE client_id = ?1').bind(id).first().catch(() => null);
  if (!c) return { ok: false, error: 'That client is not on the site.', code: 404 };
  const at = new Date(now || Date.now()).toISOString();
  // twice in a row is a double tap, not two messages
  const last = await env.DB.prepare("SELECT text, at FROM app_messages WHERE client_id = ?1 AND dir = 'out' ORDER BY id DESC LIMIT 1").bind(id).first().catch(() => null);
  if (last && last.text === tx && Date.parse(at) - Date.parse(last.at) < 60000) return { ok: true, again: true };
  await env.DB.prepare("INSERT INTO app_messages (client_id, at, by, text, hq_synced, dir, notified) VALUES (?1, ?2, ?3, ?4, 1, 'out', 0)").bind(id, at, SUPPORT_NAME, tx).run();
  await env.DB.prepare("UPDATE app_messages SET hq_synced = 1 WHERE client_id = ?1 AND dir = 'in' AND hq_synced = 0").bind(id).run().catch(() => {});
  return { ok: true };
}
// Where a request stands. Anything but "new" stops the follow-up emails and the call-back reminder for it.
export async function hqLead(env, leadId, status, note) {
  const id = +leadId;
  if (!Number.isInteger(id) || id < 1 || !LEAD_STATUS.includes(status)) return { ok: false, error: 'Not a status.', code: 400 };
  const l = await env.DB.prepare('SELECT id, status FROM leads WHERE id = ?1').bind(id).first().catch(() => null);
  if (!l) return { ok: false, error: 'That request is not on the site.', code: 404 };
  await env.DB.prepare('UPDATE leads SET status = ?1, reason = ?2 WHERE id = ?3').bind(status, String(note || '').replace(/\s+/g, ' ').trim().slice(0, 200), id).run();
  return { ok: true, status };
}

// allowed(req, env, url, tok): the ops board's own check (key, dated link or cookie).
export async function handleHq(req, env, url, h) {
  const path = url.pathname;
  if (path === '/ops/hq/reply' || path === '/ops/hq/lead' || path === '/ops/hq/post' || path === '/ops/hq/client') {
    let b = {}; try { b = await req.json(); } catch (e) { /* bad body */ }
    if (req.method !== 'POST' || !(await h.allowed(req, env, url, String(b.t || '')))) return J({ ok: false }, 403);
    const r = path === '/ops/hq/reply' ? await hqReply(env, b.client, b.text) : path === '/ops/hq/post' ? await hqPost(env, b.id) : path === '/ops/hq/client' ? await hqAddClient(env, b) : await hqLead(env, b.id, String(b.status || ''), b.note);
    const code = r.code || 200; delete r.code;
    return J(r, code);
  }
  if (!(await h.allowed(req, env, url))) return new Response('Not found', { status: 404 });
  const tok = await h.boardToken(env);
  return new Response(hqHtml(await hqState(env), tok), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'set-cookie': await h.boardCookie(env) } });
}
