// The owner's weekly checklist: what only Christopher can do this week. Page at /ops (key or the link in the Monday email)
// and a Monday email. Reads our own tables only; nothing here changes a client's data.
import { EmailMessage } from 'cloudflare:email';
import { metaReady } from './extras.js';
import { TEXTING_ON, textingReady } from './sms.js';
import { LABELS as LOST_LABELS } from './lost.js';
import { DEMO_ID } from './demo.js';
import { buildPack } from './cpack.js';
import { markCredited } from './referral.js';
import { mapAdmin, setShow, previewKey } from './map.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// A link token made from the key but not the key itself, so the email link never exposes it.
export async function boardToken(env) {
  if (!env.LEADS_KEY) return '';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LEADS_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('ops-board-v1'));
  return [...new Uint8Array(sig)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function allowed(req, env, url, tok) {
  if (!env.LEADS_KEY) return false;
  const key = req.headers.get('x-key') || '';
  if (key && eq(key, env.LEADS_KEY)) return true;
  const t = tok || url.searchParams.get('t') || '';
  const want = await boardToken(env);
  return !!(t && want && eq(t, want));
}

async function ensure(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ops_done (k TEXT PRIMARY KEY, at TEXT)').run();
}
const all = async (env, sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };

// Returns [{ key, group, title, detail }] for what is still open.
export async function boardItems(env) {
  await ensure(env);
  const items = [];
  const waiting = await all(env, "SELECT i.client_id, COALESCE(c.business, i.client_id) AS biz, SUM(CASE WHEN i.kind = 'post' THEN 1 ELSE 0 END) AS posts, SUM(CASE WHEN i.kind != 'post' THEN 1 ELSE 0 END) AS replies FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id WHERE i.status = 'approved' AND i.hq_synced = 0 AND i.kind NOT IN ('invoice', 'reviewreq') AND i.client_id != ?1 AND LOWER(i.context || i.title) NOT LIKE '%yelp%' GROUP BY i.client_id", DEMO_ID);
  for (const w of waiting) {
    const bits = [];
    if (+w.replies) bits.push(w.replies + (+w.replies === 1 ? ' reply' : ' replies'));
    if (+w.posts) bits.push(w.posts + (+w.posts === 1 ? ' post' : ' posts'));
    items.push({ key: 'google:' + w.client_id + ':' + w.replies + ':' + w.posts, group: 'Google: approved, waiting to be posted', title: w.biz, detail: bits.join(' and ') + ' approved by the owner, not posted yet' });
  }
  const yelp = await all(env, "SELECT i.client_id, COALESCE(c.business, i.client_id) AS biz, COUNT(*) AS n FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id WHERE i.status = 'approved' AND i.hq_synced = 0 AND i.client_id != ?1 AND LOWER(i.context || i.title) LIKE '%yelp%' GROUP BY i.client_id", DEMO_ID);
  for (const y of yelp) items.push({ key: 'yelp:' + y.client_id + ':' + y.n, group: 'Yelp: replies to hand to the owner', title: y.biz, detail: y.n + (+y.n === 1 ? ' reply is' : ' replies are') + ' approved. The owner posts them, we never ask for Yelp reviews' });
  const signups = await all(env, "SELECT client_id, business, plan, created FROM billing WHERE hq_synced = 0 AND status IN ('active', 'past_due') AND client_id != ?1 ORDER BY created DESC LIMIT 50", DEMO_ID);
  for (const s of signups) items.push({ key: 'signup:' + s.client_id, group: 'New signups to adopt in HQ', title: s.business || s.client_id, detail: (s.plan || '') + ' plan, signed up ' + String(s.created || '').slice(0, 10) });
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
  try {
    const regs = await all(env, "SELECT r.client_id, COALESCE(c.business, r.client_id) AS biz, r.status, r.step, r.error, r.updated FROM a2p_reg r LEFT JOIN app_clients c ON c.client_id = r.client_id WHERE r.status != 'approved' ORDER BY r.updated DESC LIMIT 40");
    const say = { submitted: 'sent, starting', in_review: 'with Twilio and the carriers', needs_fix: 'needs a fix from the owner', needs_help: 'no EIN: register as a sole proprietor by hand in Twilio', failed: 'stuck, look in Twilio' };
    for (const r of regs) items.push({ key: 'a2p:' + r.client_id + ':' + r.status + ':' + r.step, group: 'Texting registrations', title: r.biz, detail: (say[r.status] || r.status) + (r.step && r.status === 'in_review' ? ' (step: ' + r.step.replace('_', ' ') + ')' : '') + (r.error ? '. ' + r.error : '') });
  } catch (e) {}
  const sys = [
    ['Map preview (private link)', 'https://alwaysopenoffice.com/map?preview=' + (await previewKey(env))],
    ['Twilio texting', !TEXTING_ON ? 'off' : (textingReady(env) ? 'on' : 'on, but the Twilio account SID is not set. Run "Set Twilio texting key.command".')],
    ['Meta (Facebook and Instagram)', metaReady(env) ? 'keys are set' : 'keys not set yet'],
    ['Google Business Profile API', env.GBP_ON ? 'on' : 'off, waiting for Google approval'],
    ['Competitor lookups (Google Places)', env.PLACES_KEY ? 'key is set' : 'key not set']
  ];
  for (const [n, st] of sys) items.push({ key: 'sys:' + n + ':' + st, group: 'Status of what you are waiting on', title: n, detail: st });
  const done = new Set((await all(env, 'SELECT k FROM ops_done LIMIT 2000')).map(r => r.k));
  return items.filter(x => !done.has(x.key));
}

function groups(items) {
  const g = new Map();
  for (const it of items) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it); }
  return g;
}

function mapSection(rows) {
  if (!rows.length) return '';
  return '<section><h2>The Always Open map</h2>' + rows.map(r => '<div class="it"><div><b>' + esc(r.business) + '</b><span>' +
    esc(r.listed ? (r.placed ? 'On the map' : 'On the map once we find their town or address') : (r.regulated ? 'Off (regulated: only if they ask)' : (r.paying ? 'Off' : 'Off (not billed through Stripe)'))) +
    '</span></div><button type="button" data-map="' + esc(r.id) + '" data-show="' + (r.listed ? '0' : '1') + '">' + (r.listed ? 'Take off' : 'Put on') + '</button></div>').join('') + '</section>';
}

export function boardText(items, link) {
  if (!items.length) return 'Nothing waiting on you this week.\n\n' + link;
  let t = 'What only you can do this week:\n';
  for (const [name, list] of groups(items)) t += '\n' + name + '\n' + list.map(x => '  - ' + x.title + ': ' + x.detail).join('\n') + '\n';
  return t + '\nTick things off here: ' + link + '\n';
}

function boardHtml(items, tok, map) {
  const g = groups(items);
  const sec = [...g].map(([name, list]) => '<section><h2>' + esc(name) + '</h2>' + list.map(x => '<div class="it" data-k="' + esc(x.key) + '"><div><b>' + esc(x.title) + '</b><span>' + esc(x.detail) + '</span></div><button type="button">Done</button></div>').join('') + '</section>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>This week</title>' +
    '<style>:root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#fff;--soft:#F5F4F0;--ok:#1E7A4F}@media(prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--soft:#1A1F2B}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:640px;margin:0 auto;padding:24px 16px 60px}h1{font-size:26px;margin:0 0 4px}h2{font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--slate);margin:26px 0 8px}p{color:var(--slate);margin:0}' +
    '.it{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);margin-bottom:8px}.it span{display:block;color:var(--slate);font-size:14px}button{font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);min-height:44px;cursor:pointer}</style></head><body><main><h1>This week</h1><p>What only you can do. Tap Done when it is handled.</p>' +
    (sec || '<section><h2>All clear</h2><p>Nothing is waiting on you.</p></section>') +
    mapSection(map || []) +
    '<script>var T=' + JSON.stringify(tok || '') + ';document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.map){b.disabled=true;fetch("/ops/map",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({t:T,id:b.dataset.map,show:b.dataset.show==="1"})}).then(function(r){if(r.ok)location.reload();else b.disabled=false});return;}var r=b.closest(".it");b.disabled=true;fetch("/ops/done",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({t:T,k:r.dataset.k})}).then(function(x){return x.json()}).then(function(j){if(j.ok)r.remove();else b.disabled=false}).catch(function(){b.disabled=false})});</script></main></body></html>';
}

export async function handleOpsBoard(req, env, url) {
  const path = url.pathname;
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
  if (!(await allowed(req, env, url))) return new Response('Not found', { status: 404 });
  if (path === '/ops/compliance-pack') {
    try { return new Response(buildPack(new Date().toISOString().slice(0, 10)), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="compliance-guard-rules.pdf"', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } }); }
    catch (e) { return new Response('Could not build the pack: ' + String((e && e.message) || e).slice(0, 120), { status: 500 }); }
  }
  const items = await boardItems(env);
  const tok = url.searchParams.get('t') || await boardToken(env);
  let map = []; try { map = await mapAdmin(env); } catch (e) { map = []; }
  return new Response(boardHtml(items, tok, map), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
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
  const body = boardText(items, link);
  const domain = env.MAIL_FROM.split('@')[1] || 'localhost';
  const n = items.filter(x => !x.key.startsWith('sys:')).length;
  const raw = ['From: "Always Open week" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: ' + (n ? 'Your week: ' + n + (n === 1 ? ' thing' : ' things') + ' only you can do' : 'Your week: all clear'),
    'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit'].join('\r\n') + '\r\n\r\n' + body;
  try { await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)); return 'sent'; } catch (e) { return 'failed'; }
}
