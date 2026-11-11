// Always Open HQ, on the site (Nov 11, 2026). One page behind the ops board's link: who is waiting on a reply (with the
// box to answer them), new requests, every client, and the calls Max took. It reads the site's own tables as they are,
// so nothing is copied anywhere and nothing can fall behind. Before this, a scheduled Claude task copied the same rows
// into a claude.ai page four times a day, and that page was the only place a client's message could be answered.
//   GET  /ops/hq          the page (ops key in x-key, the board's dated link, or the board's cookie)
//   POST /ops/hq/reply    { t, client, text }: Katie's answer, into the client's app (app_messages, dir 'out')
//   POST /ops/hq/lead     { t, id, status, note }: where a request stands (new, talking, won, lost)
// A reply shows in the client's app as "Always Open" and buzzes their iPhone on the next ten-minute run (app.js
// appCron). Money stays on /ops/numbers and the weekly to-dos on /ops.
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
  const [clients, lines, bills, calls7, pending, lastIn, lastSeen, waitingRows, leads, calls, tests] = await Promise.all([
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
    rows(env, 'SELECT COUNT(*) AS n FROM app_calls WHERE test = 1 AND at > ?1', iso(now - 7 * DAY))
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
  return {
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
  };
}

const CSS = ':root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#fff;--soft:#F5F4F0;--ok:#1E7A4F;--warn:#9A5B00;--hot:#B3261E}' +
  '@media(prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--soft:#1A1F2B;--ok:#5CC9A4;--warn:#F2C46B;--hot:#FF8A80}}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:680px;margin:0 auto;padding:24px 16px 72px}' +
  'h1{font-size:26px;margin:0 0 4px}h2{font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin:30px 0 8px}p{margin:0;color:var(--slate)}a{color:inherit}' +
  'nav{display:flex;flex-wrap:wrap;gap:6px 18px;margin:10px 0 0;font-weight:600}nav a{min-height:44px;display:inline-flex;align-items:center}' +
  '.it{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);margin-bottom:10px}.it>b{display:block;font-size:17px}.it .sub{display:block;color:var(--slate);font-size:14px;margin-top:2px}' +
  '.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.tag{font-size:13px;font-weight:600;padding:2px 9px;border-radius:99px;border:1px solid var(--line);background:var(--paper)}.tag.ok{color:var(--ok)}.tag.warn{color:var(--warn)}.tag.hot{color:var(--hot)}' +
  '.th{display:grid;gap:6px;margin:10px 0}.m{max-width:88%;padding:8px 11px;border-radius:14px;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--paper);border:1px solid var(--line)}.m.out{justify-self:end;background:transparent}.m small{display:block;color:var(--slate);font-size:12px;margin-top:2px}' +
  'input.note{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);margin-top:8px;min-height:44px}textarea{width:100%;min-height:84px;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);margin-top:8px}' +
  '.acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}button{font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);min-height:44px;cursor:pointer}button.go{background:var(--ink);color:var(--paper);border-color:var(--ink)}button[disabled]{opacity:.5}' +
  '.said{font-size:14px;color:var(--slate)}details{margin-top:8px}summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}.none{padding:14px;border:1px dashed var(--line);border-radius:12px;color:var(--slate)}' +
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
    (c.id === 'always-open' ? '' : '<details><summary>Write to them</summary>' + msgBox(c.id, 'Shows in their app as Always Open, and buzzes their iPhone.') + '</details>') + '</div>';
}
function callHtml(k, now) {
  const who = String(k.caller_name || '').trim() || phone(k.caller) || 'Unknown caller';
  const tags = [(k.urgency === 'urgent' ? '<span class="tag hot">Urgent</span>' : ''), (k.outcome === 'hangup' ? '<span class="tag warn">Hung up</span>' : k.outcome === 'transferred' ? '<span class="tag ok">Put through</span>' : ''),
    (k.status === 'handled' ? '<span class="tag ok">Handled</span>' : '<span class="tag">Not marked handled</span>')].filter(Boolean).join('');
  return '<div class="it"><b>' + esc(k.business) + '</b><span class="sub">' + esc(when(k.at, now)) + ', ' + esc(who) + (+k.seconds ? ', ' + Math.max(1, Math.round(k.seconds / 60)) + ' min' : '') + '</span>' +
    (k.summary || k.reason ? '<span class="sub">' + esc(String(k.summary || k.reason).slice(0, 320)) + '</span>' : '') + '<div class="tags">' + tags + '</div></div>';
}

export function hqHtml(s, tok) {
  const now = s.now;
  const open = s.leads.filter(l => !l.test && (l.status === 'new' || l.status === 'letter' || l.status === 'talking'));
  const closed = s.leads.filter(l => l.test || !(l.status === 'new' || l.status === 'letter' || l.status === 'talking'));
  const real = s.clients.filter(c => !c.internal), own = s.clients.filter(c => c.internal);
  const waiting = s.waiting.map(w => '<div class="it"><b>' + esc(w.business) + '</b><span class="sub">Waiting ' + esc(ago(w.since, now)) + (w.internal ? ' (your own test account)' : '') + '</span>' + threadHtml(w.thread, now) + msgBox(w.client, 'Your answer') + '</div>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Always Open HQ</title><style>' + CSS + '</style></head><body><main>' +
    '<h1>Always Open HQ</h1><p>Straight from the site, as of ' + esc(new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET })) + ' Eastern. Nothing here is a copy.</p>' +
    '<nav><a href="/ops?t=' + esc(tok) + '">This week’s to-dos</a><a href="/ops/numbers?t=' + esc(tok) + '">The numbers</a><a href="/ops/hq?t=' + esc(tok) + '">Refresh</a></nav>' +
    '<h2>Waiting on a reply (' + s.waiting.length + ')</h2>' + (waiting || '<p class="none">Nobody is waiting on you.</p>') +
    '<h2>Requests (' + open.length + ' open)</h2>' + (open.map(l => leadHtml(l, now)).join('') || '<p class="none">No open requests.</p>') +
    (closed.length ? '<details><summary>' + closed.length + ' closed or test</summary>' + closed.map(l => leadHtml(l, now)).join('') + '</details>' : '') +
    '<h2>Clients (' + real.length + ')</h2>' + (real.map(c => clientHtml(c, now)).join('') || '<p class="none">No clients yet. A signup shows here the moment Stripe confirms it.</p>') +
    (own.length ? '<details><summary>Your own line and the demo</summary>' + own.map(c => clientHtml(c, now)).join('') + '</details>' : '') +
    '<h2>Calls Max took, last 7 days (' + s.calls.length + ')</h2>' + (s.calls.map(k => callHtml(k, now)).join('') || '<p class="none">No calls from real callers this week.</p>') +
    (s.tests ? '<p style="margin-top:6px;font-size:14px">' + s.tests + ' test ' + (s.tests === 1 ? 'call is' : 'calls are') + ' not shown (the 4 AM check and calls from your own numbers).</p>' : '') +
    '<script>var T=' + JSON.stringify(tok || '') + ';function post(u,b){b.t=T;return fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return{ok:false}}).then(function(j){j.status=r.status;return j})})}' +
    'document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;' +
    'if(b.dataset.send){var id=b.dataset.send,box=b.closest(".it").querySelector("textarea[data-for=\\""+id+"\\"]"),said=b.closest(".it").querySelector("[data-said]"),tx=(box.value||"").trim();if(!tx){said.textContent="Type your message first.";box.focus();return}b.disabled=true;said.textContent="Sending…";' +
    'post("/ops/hq/reply",{client:id,text:tx}).then(function(j){if(j.ok){box.value="";said.textContent="Sent. It is in their app now.";setTimeout(function(){location.reload()},900)}else{b.disabled=false;said.textContent=j.error||"Did not send. Try again."}}).catch(function(){b.disabled=false;said.textContent="No connection. Try again."});return}' +
    'if(b.dataset.lead){var note="",row=b.closest(".it");if((b.dataset.s==="lost"||b.dataset.s==="won")&&!b.dataset.sure){b.dataset.sure="1";var i=document.createElement("input");i.type="text";i.maxLength=200;i.className="note";i.placeholder=b.dataset.s==="lost"?"Why was it lost? (optional)":"A note for your records (optional)";i.setAttribute("aria-label",i.placeholder);row.appendChild(i);b.textContent="Save as "+b.dataset.s;b.className="go";i.focus();return}var n=row.querySelector("input.note");if(n)note=n.value;b.disabled=true;post("/ops/hq/lead",{id:+b.dataset.lead,status:b.dataset.s,note:note}).then(function(j){if(j.ok)location.reload();else{b.disabled=false;b.textContent="Did not save. Try again"}}).catch(function(){b.disabled=false})}});</script></main></body></html>';
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
  if (path === '/ops/hq/reply' || path === '/ops/hq/lead') {
    let b = {}; try { b = await req.json(); } catch (e) { /* bad body */ }
    if (req.method !== 'POST' || !(await h.allowed(req, env, url, String(b.t || '')))) return J({ ok: false }, 403);
    const r = path === '/ops/hq/reply' ? await hqReply(env, b.client, b.text) : await hqLead(env, b.id, String(b.status || ''), b.note);
    const code = r.code || 200; delete r.code;
    return J(r, code);
  }
  if (!(await h.allowed(req, env, url))) return new Response('Not found', { status: 404 });
  const tok = await h.boardToken(env);
  return new Response(hqHtml(await hqState(env), tok), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'set-cookie': await h.boardCookie(env) } });
}
