// Past customers: Max remembers repeat callers, owners import a customer list, and every Monday we look for past customers
// who look ready to hear from the business again. Nothing is sent without the owner's tap, and only to customers the owner
// marked as OK to contact (never to anyone who opted out). Regulated businesses never hand over customer data, so none of this runs for them.
// Tables create themselves on first use.
import { mailTo } from './app.js';
import { page } from './extras.js';
import { TEXTING_ON, sendText } from './sms.js';
import { ensureBiz, logAct } from './biz.js';

const SITE = 'https://alwaysopenoffice.com';
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const now = () => new Date().toISOString();
function token(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); }
const cents = v => { const x = Math.round(parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')) * 100); return x > 0 && x < 1e10 ? x : 0; };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;

// A phone number as its last ten digits, so "(478) 555-0142", "+1 478-555-0142" and "4785550142" all match.
export function ph10(s) {
  let d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
}
export function ckeyOf(phone, email) {
  const p = ph10(phone); if (p) return p;
  const e = String(email || '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? 'e:' + e : '';
}
// Plain-SQL version of "digits only" for stored phone columns.
const NUM = col => "replace(replace(replace(replace(replace(replace(COALESCE(" + col + ",''),'(',''),')',''),'-',''),' ',''),'+',''),'.','')";

const READY = new WeakSet();
export async function ensurePast(env) {
  if (env.DB && READY.has(env.DB)) return;
  await ensureBiz(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_customers (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, ckey TEXT NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '', phone10 TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', agreed INTEGER DEFAULT 0, agreed_at TEXT DEFAULT '', optout INTEGER DEFAULT 0, opt_token TEXT DEFAULT '', source TEXT DEFAULT 'import', created TEXT, updated TEXT)"),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS biz_customers_key ON biz_customers (client_id, ckey)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS biz_customers_p10 ON biz_customers (client_id, phone10)'),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS biz_customers_tok ON biz_customers (opt_token)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_revive (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, ckey TEXT NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', reason TEXT DEFAULT '', basis TEXT DEFAULT '', est INTEGER DEFAULT 0, draft TEXT DEFAULT '', status TEXT DEFAULT 'pending', result TEXT DEFAULT '', created TEXT, updated TEXT)"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS biz_revive_c ON biz_revive (client_id, status)')
  ]);
  READY.add(env.DB);
}

// ---------------- dates and words ----------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Returns an ISO date ('' when it can't be read). Slash dates are read the US way (month first).
export function parseDate(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s))) { m = +x[1]; d = +x[2]; y = +x[3]; if (y < 100) y += y > 50 ? 1900 : 2000; }
  else if ((x = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/.exec(s))) { m = MONTHS.indexOf(x[1].slice(0, 3).toLowerCase()) + 1; d = +x[2]; y = +x[3]; }
  else if ((x = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})/.exec(s))) { m = MONTHS.indexOf(x[2].slice(0, 3).toLowerCase()) + 1; d = +x[1]; y = +x[3]; }
  else return '';
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= new Date().getUTCFullYear() + 1)) return '';
  const t = Date.UTC(y, m - 1, d, 12);
  const dt = new Date(t);
  if (dt.getUTCMonth() !== m - 1) return '';
  return dt.toISOString();
}
function monthYear(iso) { try { return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return ''; } }
function dayText(iso) { try { return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return ''; } }
function monthsAgo(iso, at) { const d = Date.parse(iso); return isNaN(d) ? 0 : Math.max(0, Math.round(((at || Date.now()) - d) / (30.44 * 864e5))); }
const firstName = n => { const f = String(n || '').trim().split(/\s+/)[0].replace(/[^A-Za-z'’-]/g, '').slice(0, 24); return f ? f[0].toUpperCase() + f.slice(1) : ''; };
// Words from records are data, never instructions: no brackets, angle marks or line breaks reach Max or a message.
const safe = (s, n) => cl(s, n || 120).replace(/[\[\]<>{}|\\`]/g, '');

// ---------------- 1. Max remembers callers ----------------
// A short summary of what we know about the number that is calling: name, last job, anything still open.
// No dollar amounts and no other customers' details. Returns '' for someone we don't know.
export async function callerMemory(env, cid, phone, at) {
  const p = ph10(phone);
  if (!p || !cid) return '';
  at = at || Date.now();
  const like = '%' + p;
  const q = async (sql, ...a) => { try { return ((await env.DB.prepare(sql).bind(...a).all()).results) || []; } catch (e) { return []; } };
  // A number that last reached us as a wrong number gets no history at all.
  const lastCall = (await q("SELECT outcome, reason FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('live', 'limited') AND " + NUM('caller') + " LIKE ?2 ORDER BY at DESC LIMIT 1", cid, like))[0];
  if (lastCall && lastCall.outcome === 'spam' && lastCall.reason === 'Wrong number') return '';
  const cust = (await q('SELECT name FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 LIMIT 1', cid, p))[0];
  const jobs = await q("SELECT name, title, stage, created, updated, source FROM biz_jobs WHERE client_id = ?1 AND " + NUM('phone') + " LIKE ?2 ORDER BY CASE WHEN created != '' THEN created ELSE updated END DESC LIMIT 8", cid, like);
  const calls = await q("SELECT caller_name, reason, at FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited') AND (" + NUM('caller') + " LIKE ?2 OR " + NUM('callback') + " LIKE ?2) ORDER BY at DESC LIMIT 3", cid, like);
  const leads = await q('SELECT name, need, at FROM app_leads WHERE client_id = ?1 AND ' + NUM('phone') + ' LIKE ?2 ORDER BY at DESC LIMIT 2', cid, like);
  const quotes = await q("SELECT created FROM biz_quotes WHERE client_id = ?1 AND status = 'open' AND " + NUM('phone') + " LIKE ?2 ORDER BY created DESC LIMIT 1", cid, like);
  const invs = await q("SELECT due FROM app_invoices WHERE client_id = ?1 AND status = 'open' AND " + NUM('phone') + " LIKE ?2 ORDER BY due LIMIT 1", cid, like);
  const names = [cust && cust.name, ...jobs.map(r => r.name), ...calls.map(r => r.caller_name), ...leads.map(r => r.name)].map(firstName).filter(Boolean);
  // A number shared by two people (a household, an office): we can't tell who is calling, so Max hears nothing about it.
  if (new Set(names.map(x => x.toLowerCase())).size > 1) return '';
  const name = names[0] || '';
  const lines = [];
  const dateOf = r => (r.created && !isNaN(Date.parse(r.created))) ? r.created : (r.source === 'import' ? '' : r.updated);
  const done = jobs.find(r => (r.stage === 'done' || r.stage === 'paid') && safe(r.title, 80));
  if (done) { const d = dateOf(done); lines.push('- Last job for them: ' + safe(done.title, 80) + (d ? ', ' + monthYear(d) + ' (about ' + monthsAgo(d, at) + ' months ago)' : '') + '.'); }
  // A visit Max booked or penciled in: the exact time comes from our book of visits.
  const visit = (await q("SELECT say, status FROM line_bookings WHERE client_id = ?1 AND status IN ('booked', 'held') AND start > ?2 AND " + NUM('phone') + " LIKE ?3 ORDER BY start LIMIT 1", cid, at, like))[0];
  const booked = jobs.find(r => r.stage === 'booked' && r.source !== 'import');
  if (visit) lines.push('- They have a visit ' + (visit.status === 'held' ? 'penciled in (not confirmed yet)' : 'booked') + ' for ' + safe(visit.say, 60) + '.');
  else if (booked) lines.push('- They have a visit booked: ' + (safe(booked.title, 80) || 'details with the team') + '.');
  if (calls.length) lines.push('- They have called before (' + calls.length + (calls.length === 3 ? ' or more times' : calls.length === 1 ? ' time' : ' times') + '); most recent ' + dayText(calls[0].at) + (safe(calls[0].reason, 80) ? ' about: ' + safe(calls[0].reason, 80) : '') + '.');
  else if (leads.length) lines.push('- They sent a request on ' + dayText(leads[0].at) + (safe(leads[0].need, 80) ? ': ' + safe(leads[0].need, 80) : '') + '.');
  if (quotes.length) lines.push('- An estimate sent on ' + dayText(quotes[0].created) + ' is still open.');
  if (invs.length) lines.push('- An invoice is still unpaid (the team can go over it).');
  const noText = (await q('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2 LIMIT 1', cid, p))[0];
  if (noText) lines.push('- They asked not to get texts: never offer to text them.');
  if (!name && !lines.length) return '';
  // Short: it is read on every turn. At most four lines after the name, about 300 characters.
  let body = lines.slice(0, 4).join('\n');
  if (body.length > 300) body = body.slice(0, 300).replace(/\n[^\n]*$/, '');
  return (name ? '- Name on file: ' + name + '.\n' : '') + body;
}

// ---------------- 2. Customer import ----------------
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let qq = false;
  for (const ch of first) { if (ch === '"') qq = !qq; else if (!qq && counts[ch] != null) counts[ch]++; }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const D = counts[delim] ? delim : ',';
  const rows = []; let row = [], cur = '', inq = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some(x => String(x).trim() !== '')) rows.push(row.slice(0, 40)); row = []; };
  for (let i = 0; i < text.length && rows.length <= 5001; i++) {
    const ch = text[i];
    if (inq) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; }
      else cur += ch;
    } else if (ch === '"') inq = true;
    else if (ch === D) { row.push(cur); cur = ''; }
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else cur += ch;
  }
  if (cur !== '' || row.length) endRow();
  return rows;
}
const hnorm = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SYN = {
  name: ['name', 'customer', 'customername', 'fullname', 'client', 'clientname', 'contact', 'contactname', 'displayname'],
  first: ['firstname', 'first', 'givenname'],
  last: ['lastname', 'last', 'surname', 'familyname'],
  company: ['company', 'companyname', 'business', 'businessname'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'cell', 'cellphone', 'cellnumber', 'telephone', 'tel', 'primaryphone', 'mainphone'],
  email: ['email', 'emailaddress', 'mail', 'primaryemail'],
  address: ['address', 'streetaddress', 'street', 'serviceaddress', 'address1', 'jobaddress', 'location'],
  city: ['city', 'town'], state: ['state', 'st', 'province'], zip: ['zip', 'zipcode', 'postalcode', 'postcode'],
  work: ['service', 'servicedone', 'work', 'workdone', 'workperformed', 'job', 'jobdescription', 'jobtype', 'description', 'servicedescription', 'details', 'notes', 'item', 'summary'],
  date: ['date', 'jobdate', 'servicedate', 'lastservice', 'lastservicedate', 'completed', 'completeddate', 'completiondate', 'invoicedate', 'visitdate', 'datecompleted'],
  amount: ['amount', 'total', 'price', 'invoicetotal', 'invoiceamount', 'cost', 'revenue', 'jobtotal', 'amountpaid', 'paid']
};
const SOFT = { phone: ['phone', 'mobile', 'cell'], email: ['email'], date: ['date'], amount: ['amount', 'total', 'price'], work: ['service', 'description'] };
export function autoMap(headers) {
  const hs = headers.map(hnorm), map = {}, used = new Set();
  for (const f of Object.keys(SYN)) {
    let i = -1;
    for (const s of SYN[f]) { const k = hs.findIndex((h, n) => h === s && !used.has(n)); if (k > -1) { i = k; break; } }
    if (i < 0 && SOFT[f]) for (const s of SOFT[f]) { const k = hs.findIndex((h, n) => h && h.includes(s) && !used.has(n)); if (k > -1) { i = k; break; } }
    if (i > -1) { map[f] = i; used.add(i); }
  }
  return map;
}
function cell(r, map, f) { const i = map[f]; return i == null || i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); }
// One CSV row as a customer plus (when there is a job) a job. Returns { problem } when the row can't be used.
export function mapRow(r, map) {
  let name = cell(r, map, 'name');
  if (!name) name = (cell(r, map, 'first') + ' ' + cell(r, map, 'last')).trim() || cell(r, map, 'company');
  const phoneRaw = cell(r, map, 'phone'), emailRaw = cell(r, map, 'email').toLowerCase();
  const p = ph10(phoneRaw), email = EMAIL_RE.test(emailRaw) ? emailRaw.slice(0, 120) : '';
  if (!p && !email) return { problem: phoneRaw || emailRaw ? 'phone or email doesn’t look right' : 'no phone or email' };
  const addr = [cell(r, map, 'address'), cell(r, map, 'city'), [cell(r, map, 'state'), cell(r, map, 'zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const dateRaw = cell(r, map, 'date'), date = parseDate(dateRaw);
  const amt = cents(cell(r, map, 'amount'));
  return {
    cust: { ckey: p || 'e:' + email, name: cl(name, 80), phone: p ? '(' + p.slice(0, 3) + ') ' + p.slice(3, 6) + '-' + p.slice(6) : '', phone10: p, email, address: cl(addr, 160) },
    job: (cell(r, map, 'work') || date || amt) ? { work: cl(cell(r, map, 'work'), 200), date, amount: amt } : null,
    warn: dateRaw && !date ? 'date not understood' : ''
  };
}
// A short fingerprint so importing the same file twice doesn't double the jobs.
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'i' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function readTable(csv, mapIn) {
  const t = parseCsv(csv);
  if (t.length < 2) return { error: 'The file needs a header row and at least one customer.' };
  const headers = t[0].map(h => cl(h, 60));
  const auto = autoMap(headers), map = Object.assign({}, auto);
  if (mapIn && typeof mapIn === 'object') for (const f of Object.keys(SYN)) { if (mapIn[f] === -1 || mapIn[f] === '') delete map[f]; else if (Number.isInteger(+mapIn[f]) && +mapIn[f] >= 0 && +mapIn[f] < headers.length) map[f] = +mapIn[f]; }
  const out = { headers, map, rows: [], skipped: [], total: t.length - 1 };
  for (let n = 1; n < t.length && n <= 5000; n++) {
    const m = mapRow(t[n], map);
    if (m.problem) out.skipped.push({ row: n + 1, why: m.problem }); else out.rows.push(Object.assign({ line: n + 1 }, m));
  }
  return out;
}
export async function apiImport(req, env, c) {
  if (+c.regulated) return aj({ ok: false, error: 'This isn’t available for regulated businesses.' }, 403);
  if (+(req.headers.get('content-length') || 0) > 1500000) return aj({ ok: false, error: 'That file is too big. Keep it under about 1 MB (a few thousand customers).' }, 413);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  await ensurePast(env);
  const cid = c.client_id, ts = now();
  if (b.action === 'preview' || b.action === 'save') {
    const tb = readTable(String(b.csv || '').slice(0, 1500000), b.map);
    if (tb.error) return aj({ ok: false, error: tb.error }, 400);
    const keys = new Set(tb.rows.map(r => r.cust.ckey));
    const base = { columns: tb.headers, map: tb.map, total: tb.total, valid: tb.rows.length, skipped: tb.skipped.length, problems: tb.skipped.slice(0, 8), customers: keys.size };
    if (b.action === 'preview') {
      return aj(Object.assign({ ok: true, sample: tb.rows.slice(0, 5).map(r => ({ name: r.cust.name, phone: r.cust.phone, email: r.cust.email, work: r.job ? r.job.work : '', date: r.job && r.job.date ? r.job.date.slice(0, 10) : '', amount: r.job && r.job.amount ? r.job.amount / 100 : 0 })), warnings: tb.rows.filter(r => r.warn).length, over: tb.total > 5000 }, base));
    }
    if (!tb.rows.length) return aj({ ok: false, error: 'No usable customers in that file. Each row needs a phone number or an email.' }, 400);
    const before = +((await env.DB.prepare('SELECT COUNT(*) AS n FROM biz_customers WHERE client_id = ?1').bind(cid).first()) || {}).n || 0;
    const agreed = b.agreed === true ? 1 : 0;
    const st = [];
    const seen = new Map();
    for (const r of tb.rows) { const o = seen.get(r.cust.ckey); if (!o) seen.set(r.cust.ckey, Object.assign({}, r.cust)); else for (const k of ['name', 'phone', 'phone10', 'email', 'address']) if (r.cust[k]) o[k] = r.cust[k]; }
    for (const u of seen.values()) {
      st.push(env.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, email, address, agreed, agreed_at, opt_token, source, created, updated) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'import',?11,?11) " +
        "ON CONFLICT(client_id, ckey) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE name END, phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE phone END, phone10 = CASE WHEN excluded.phone10 != '' THEN excluded.phone10 ELSE phone10 END, " +
        "email = CASE WHEN excluded.email != '' THEN excluded.email ELSE email END, address = CASE WHEN excluded.address != '' THEN excluded.address ELSE address END, " +
        "agreed = CASE WHEN optout = 1 THEN 0 WHEN excluded.agreed = 1 THEN 1 ELSE agreed END, agreed_at = CASE WHEN optout = 0 AND excluded.agreed = 1 AND agreed = 0 THEN excluded.agreed_at ELSE agreed_at END, updated = excluded.updated")
        .bind(cid, u.ckey, u.name, u.phone, u.phone10, u.email, u.address, agreed, agreed ? ts : '', token(16), ts));
    }
    let jobsIn = 0;
    for (const r of tb.rows) {
      if (!r.job) continue;
      const j = r.job, sid = hash53(r.cust.ckey + '|' + (j.date || '') + '|' + j.work.toLowerCase() + '|' + j.amount);
      st.push(env.DB.prepare("INSERT OR IGNORE INTO biz_jobs (client_id, name, phone, email, title, stage, amount, source, source_id, created, updated, by) VALUES (?1,?2,?3,?4,?5,?6,?7,'import',?8,?9,?10,'Import')")
        .bind(cid, r.cust.name, r.cust.phone, r.cust.email, j.work, j.amount ? 'paid' : 'done', j.amount, sid, j.date || '', ts));
      jobsIn++;
    }
    for (let i = 0; i < st.length; i += 40) await env.DB.batch(st.slice(i, i + 40));
    const after = +((await env.DB.prepare('SELECT COUNT(*) AS n FROM biz_customers WHERE client_id = ?1').bind(cid).first()) || {}).n || 0;
    const nj = +((await env.DB.prepare("SELECT COUNT(*) AS n FROM biz_jobs WHERE client_id = ?1 AND source = 'import'").bind(cid).first()) || {}).n || 0;
    await logAct(env, c, 'Imported ' + seen.size + ' customers from a file');
    return aj({ ok: true, customers: seen.size, added: Math.max(0, after - before), jobs: jobsIn, imported: nj, skipped: tb.skipped.length, agreed: !!agreed });
  }
  if (b.action === 'list') {
    const qn = cl(b.q, 40), like = '%' + qn.replace(/[%_]/g, '') + '%';
    const total = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(agreed) AS a FROM biz_customers WHERE client_id = ?1').bind(cid).first();
    const rs = qn ? await env.DB.prepare('SELECT id, name, phone, email, agreed, optout FROM biz_customers WHERE client_id = ?1 AND (name LIKE ?2 OR phone LIKE ?2 OR email LIKE ?2) ORDER BY name LIMIT 100').bind(cid, like).all()
      : await env.DB.prepare('SELECT id, name, phone, email, agreed, optout FROM biz_customers WHERE client_id = ?1 ORDER BY name LIMIT 100 OFFSET ?2').bind(cid, Math.max(0, Math.min(100000, +b.offset || 0))).all();
    return aj({ ok: true, total: +(total && total.n) || 0, agreed: +(total && total.a) || 0, customers: (rs.results || []).map(r => ({ id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', agreed: !!+r.agreed, optout: !!+r.optout })) });
  }
  if (b.action === 'agree') {
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(x => +x).filter(x => x > 0).slice(0, 5000);
    const on = b.agreed === false ? 0 : 1;
    let n = 0;
    if (b.all === true) {
      const r = await env.DB.prepare("UPDATE biz_customers SET agreed = ?1, agreed_at = CASE WHEN ?1 = 1 THEN ?2 ELSE '' END, updated = ?2 WHERE client_id = ?3 AND optout = 0").bind(on, ts, cid).run();
      n = r.meta.changes;
    } else for (const id of ids) {
      const r = await env.DB.prepare("UPDATE biz_customers SET agreed = ?1, agreed_at = CASE WHEN ?1 = 1 THEN ?2 ELSE '' END, updated = ?2 WHERE id = ?3 AND client_id = ?4 AND optout = 0").bind(on, ts, id, cid).run();
      n += r.meta.changes;
    }
    return aj({ ok: true, changed: n });
  }
  if (b.action === 'forget') {
    const id = +b.id || 0;
    const cu = await env.DB.prepare('SELECT ckey, phone10, email FROM biz_customers WHERE id = ?1 AND client_id = ?2').bind(id, cid).first();
    if (!cu) return aj({ ok: false, error: 'Not found' }, 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM biz_jobs WHERE client_id = ?1 AND source = 'import' AND ((?2 != '' AND " + NUM('phone') + " LIKE '%' || ?2) OR (?3 != '' AND lower(email) = ?3))").bind(cid, cu.phone10 || '', cu.email || ''),
      env.DB.prepare('DELETE FROM biz_revive WHERE client_id = ?1 AND ckey = ?2').bind(cid, cu.ckey),
      env.DB.prepare('DELETE FROM biz_customers WHERE id = ?1 AND client_id = ?2').bind(id, cid)
    ]);
    return aj({ ok: true });
  }
  if (b.action === 'wipe') {
    if (b.confirm !== true) return aj({ ok: false, error: 'Confirm first.' }, 400);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM biz_jobs WHERE client_id = ?1 AND source = 'import'").bind(cid),
      env.DB.prepare("DELETE FROM biz_revive WHERE client_id = ?1 AND status = 'pending'").bind(cid),
      env.DB.prepare('DELETE FROM biz_customers WHERE client_id = ?1 AND optout = 0').bind(cid)
    ]);
    return aj({ ok: true });
  }
  return aj({ ok: false, error: 'Bad request' }, 400);
}

// ---------------- 3. Money in old jobs ----------------
const EQUIP = [
  { re: /water\s*heater/i, word: 'water heater', age: 10 }, { re: /\bfurnace\b/i, word: 'furnace', age: 15 }, { re: /\bboiler\b/i, word: 'boiler', age: 15 },
  { re: /heat\s*pump/i, word: 'heat pump', age: 12 }, { re: /\b(a\/c|ac unit|air\s*conditioner|air\s*conditioning|condenser|\bac\b)/i, word: 'A/C unit', age: 12 }, { re: /\broof(ing)?\b/i, word: 'roof', age: 15 }
];
function equipHint(title, jobIso, at) {
  const t = String(title || '');
  const eq = EQUIP.find(e => e.re.test(t));
  if (!eq) return null;
  const nowY = new Date(at).getUTCFullYear();
  let y = 0;
  const m = t.match(/\b(19[89]\d|20[0-4]\d)\b/g);
  if (m) { const ys = m.map(Number).filter(v => v <= nowY); if (ys.length) y = ys[0]; }
  if (!y && jobIso && /install|replac|new\b/i.test(t)) y = new Date(jobIso).getUTCFullYear();
  if (!y) return null;
  const age = nowY - y;
  return age >= eq.age ? { word: eq.word, year: y, age } : null;
}
const REVIVE_CAP = 25;
function draftFor(biz, f, kind, d) {
  const hi = 'Hi ' + (f || 'there') + ', it’s ' + biz + '. ';
  if (kind === 'quote') return hi + 'We sent you an estimate on ' + d.date + ' and wanted to check in. If you have questions or you’d like to go ahead, just reply or give us a call.';
  if (kind === 'equipment') return hi + 'Our records show the ' + d.word + ' we worked on in ' + d.year + ' is about ' + d.age + ' years old. If you’d like us to take a look, just reply or give us a call.';
  return hi + 'It’s been a while since we last helped you' + (d.what ? ' (' + d.what + ', ' + d.date + ')' : '') + '. If anything has come up, or you’d like us to take a look, just reply or give us a call. Thanks for choosing us.';
}
// Finds past customers who look ready to hear from the business and drafts a message for each (owner approves each one).
export async function buildRevive(env, cid, at) {
  at = at || Date.now();
  await ensurePast(env);
  const zero = { count: 0, value: 0, added: 0 };
  const cr = await env.DB.prepare('SELECT business, regulated FROM app_clients WHERE client_id = ?1').bind(cid).first();
  if (!cr || +cr.regulated) return zero;
  const biz = cl(cr.business, 60) || 'our team';
  const ago = d => new Date(at - d * 864e5).toISOString();
  const jobs = ((await env.DB.prepare('SELECT name, phone, email, title, stage, amount, created, updated, source FROM biz_jobs WHERE client_id = ?1 ORDER BY id DESC LIMIT 6000').bind(cid).all()).results) || [];
  const custs = new Map((((await env.DB.prepare('SELECT ckey, name, phone, email, optout FROM biz_customers WHERE client_id = ?1 LIMIT 8000').bind(cid).all()).results) || []).map(r => [r.ckey, r]));
  const quotes = ((await env.DB.prepare("SELECT name, phone, email, total, created FROM biz_quotes WHERE client_id = ?1 AND status = 'open' AND created < ?2 AND created > ?3").bind(cid, ago(30), ago(365)).all()).results) || [];
  const skip = new Set((((await env.DB.prepare("SELECT ckey FROM biz_revive WHERE client_id = ?1 AND (status = 'pending' OR created > ?2)").bind(cid, ago(90)).all()).results) || []).map(r => r.ckey));
  const owing = new Set();
  try { for (const r of ((await env.DB.prepare("SELECT phone, email FROM app_invoices WHERE client_id = ?1 AND status = 'open'").bind(cid).all()).results) || []) { const k = ckeyOf(r.phone, r.email); if (k) owing.add(k); } } catch (e) { /* no invoices yet */ }
  let avg = 0;
  try { const s = await env.DB.prepare('SELECT avg_job FROM app_settings WHERE client_id = ?1').bind(cid).first(); avg = (+(s && s.avg_job) || 0) * 100; } catch (e) { avg = 0; }
  const paid = jobs.filter(j => +j.amount > 0).map(j => +j.amount).sort((a, b) => a - b);
  const median = paid.length ? paid[Math.floor(paid.length / 2)] : 0;
  const fallback = median || avg;
  const dateMs = r => { const c = r.created && Date.parse(r.created); if (c) return c; return r.source === 'import' ? 0 : (Date.parse(r.updated) || 0); };
  const groups = new Map();
  for (const r of jobs) {
    const k = ckeyOf(r.phone, r.email); if (!k) continue;
    let g = groups.get(k); if (!g) groups.set(k, g = { name: '', phone: '', email: '', jobs: [] });
    if (!g.name && r.name) g.name = r.name; if (!g.phone && r.phone) g.phone = r.phone; if (!g.email && r.email) g.email = r.email;
    g.jobs.push({ at: dateMs(r), title: r.title || '', stage: r.stage, amount: +r.amount || 0, source: r.source });
  }
  const quoteBy = new Map();
  for (const q of quotes) { const k = ckeyOf(q.phone, q.email); if (k) { const o = quoteBy.get(k); if (!o || q.created > o.created) quoteBy.set(k, q); } }
  const keys = new Set([...groups.keys(), ...quoteBy.keys()]);
  const cands = [];
  for (const k of keys) {
    if (skip.has(k) || owing.has(k)) continue;
    const cu = custs.get(k); if (cu && +cu.optout) continue;
    const g = groups.get(k) || { name: '', phone: '', email: '', jobs: [] };
    const q = quoteBy.get(k);
    const name = (cu && cu.name) || g.name || (q && q.name) || '', phone = (cu && cu.phone) || g.phone || (q && q.phone) || '', email = (cu && cu.email) || g.email || (q && q.email) || '';
    if (!ph10(phone) && !EMAIL_RE.test(email)) continue;
    const dated = g.jobs.filter(j => j.at).sort((a, b) => b.at - a.at);
    const last = dated[0];
    // someone with fresh or open work is already being looked after
    if (g.jobs.some(j => ['new', 'quoted', 'booked'].includes(j.stage) && j.source !== 'import' && j.at > at - 60 * 864e5)) continue;
    if (last && last.at > at - 180 * 864e5) continue;
    const f = firstName(name);
    let pick = null;
    if (q && !(last && last.at > Date.parse(q.created))) {
      pick = { kind: 'quote', reason: 'Estimate went quiet', basis: 'Estimate from ' + dayText(q.created) + ' hasn’t been answered', est: +q.total || fallback, d: { date: dayText(q.created) } };
    }
    if (!pick) {
      for (const j of g.jobs.slice().sort((a, b) => b.at - a.at)) { const h = equipHint(j.title, j.at ? new Date(j.at).toISOString() : '', at); if (h) { pick = { kind: 'equipment', reason: 'Equipment getting older', basis: h.word + ' from ' + h.year + ' (about ' + h.age + ' years old)', est: j.amount || fallback, d: h }; break; } }
    }
    if (!pick && last && last.at < at - 365 * 864e5 && last.at > at - 6 * 365 * 864e5 && !(q)) {
      pick = { kind: 'service', reason: 'Over a year since the last visit', basis: 'Last job ' + monthYear(new Date(last.at).toISOString()) + (safe(last.title, 60) ? ': ' + safe(last.title, 60) : ''), est: last.amount || fallback, d: { what: safe(last.title, 60), date: monthYear(new Date(last.at).toISOString()) } };
    }
    if (!pick) continue;
    cands.push({ k, name: cl(name, 80), phone: cl(phone, 30), email: cl(email, 120), pick, draft: draftFor(biz, f, pick.kind, pick.d) });
  }
  cands.sort((a, b) => b.pick.est - a.pick.est);
  const ts = new Date(at).toISOString();
  let added = 0;
  const room = Math.max(0, 40 - (+((await env.DB.prepare("SELECT COUNT(*) AS n FROM biz_revive WHERE client_id = ?1 AND status = 'pending'").bind(cid).first()) || {}).n || 0));
  const st = [];
  for (const x of cands.slice(0, Math.min(REVIVE_CAP, room))) {
    st.push(env.DB.prepare("INSERT INTO biz_revive (client_id, ckey, name, phone, email, reason, basis, est, draft, status, created, updated) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending',?10,?10)").bind(cid, x.k, x.name, x.phone, x.email, x.pick.reason, cl(x.pick.basis, 160), x.pick.est || 0, x.draft, ts));
    added++;
  }
  if (st.length) await env.DB.batch(st);
  return Object.assign(await reviveTotals(env, cid), { added });
}
async function reviveTotals(env, cid) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(est) AS v FROM biz_revive WHERE client_id = ?1 AND status = 'pending'").bind(cid).first();
  return { count: +(r && r.n) || 0, value: +(r && r.v) || 0 };
}
async function reviveItems(env, cid) {
  const rs = ((await env.DB.prepare("SELECT r.*, COALESCE(c.agreed, 0) AS agreed, COALESCE(c.optout, 0) AS optout FROM biz_revive r LEFT JOIN biz_customers c ON c.client_id = r.client_id AND c.ckey = r.ckey WHERE r.client_id = ?1 AND (r.status = 'pending' OR r.updated > ?2) ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.est DESC, r.id DESC LIMIT 40").bind(cid, new Date(Date.now() - 14 * 864e5).toISOString()).all()).results) || [];
  return rs.map(r => ({ id: r.id, name: r.name || 'Customer', reason: r.reason, basis: r.basis, text: r.draft, value: (+r.est || 0) / 100, status: r.status, result: r.result || '', phone: r.phone || '', hasEmail: !!r.email, hasPhone: !!ph10(r.phone), agreed: !!+r.agreed, optout: !!+r.optout, at: r.updated || r.created }));
}
// What the app needs for the Past customers screens.
export async function pastState(env, c) {
  if (+c.regulated || c.role === 'tech') return {};
  try {
    await ensurePast(env);
    const t = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(agreed) AS a FROM biz_customers WHERE client_id = ?1').bind(c.client_id).first();
    const tot = await reviveTotals(env, c.client_id);
    return { past: { customers: +(t && t.n) || 0, agreed: +(t && t.a) || 0, revive: { count: tot.count, value: tot.value / 100, items: await reviveItems(env, c.client_id), textingOn: !!TEXTING_ON } } };
  } catch (e) { return {}; }
}
async function replyTo(env, cid) {
  try { const b = await env.DB.prepare('SELECT email FROM billing WHERE client_id = ?1').bind(cid).first(); return b && EMAIL_RE.test(b.email || '') ? b.email : ''; } catch (e) { return ''; }
}
export async function apiRevive(req, env, c) {
  if (+c.regulated) return aj({ ok: false, error: 'This isn’t available for regulated businesses.' }, 403);
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  await ensurePast(env);
  const cid = c.client_id, ts = now(), id = +b.id || 0;
  if (b.action === 'refresh') { const r = await buildRevive(env, cid); return aj({ ok: true, added: r.added, count: r.count, value: r.value / 100 }); }
  const row = id ? await env.DB.prepare('SELECT * FROM biz_revive WHERE id = ?1 AND client_id = ?2').bind(id, cid).first() : null;
  if (!row) return aj({ ok: false, error: 'Not found' }, 404);
  if (b.action === 'agree') {
    const r = await env.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, email, agreed, agreed_at, opt_token, source, created, updated) VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,'manual',?7,?7) ON CONFLICT(client_id, ckey) DO UPDATE SET agreed = CASE WHEN optout = 1 THEN 0 ELSE 1 END, agreed_at = CASE WHEN optout = 1 THEN agreed_at ELSE ?7 END, updated = ?7")
      .bind(cid, row.ckey, row.name, row.phone, ph10(row.phone), row.email, ts, token(16)).run();
    const cu = await env.DB.prepare('SELECT optout FROM biz_customers WHERE client_id = ?1 AND ckey = ?2').bind(cid, row.ckey).first();
    if (cu && +cu.optout) return aj({ ok: false, error: 'They asked us to stop, so we can’t contact them.' }, 409);
    return aj({ ok: r.success !== false });
  }
  if (row.status !== 'pending') return aj({ ok: false, error: 'Already handled.' }, 409);
  if (b.action === 'skip' || b.action === 'copied') {
    await env.DB.prepare('UPDATE biz_revive SET status = ?1, updated = ?2 WHERE id = ?3 AND client_id = ?4').bind(b.action === 'skip' ? 'skipped' : 'copied', ts, id, cid).run();
    return aj({ ok: true });
  }
  if (b.action === 'approve') {
    const r = await approveRevive(env, c, row, cl(b.text, 700));
    return aj(r.body, r.status);
  }
  return aj({ ok: false, error: 'Bad request' }, 400);
}

// Sends one past-customer message (the owner's tap, or Full Max). Consent and opt-out are checked here every time.
export async function approveRevive(env, c, row, edited) {
  const cid = c.client_id, id = row.id, ts = now();
  {
    const cu = await env.DB.prepare('SELECT agreed, optout, opt_token FROM biz_customers WHERE client_id = ?1 AND ckey = ?2').bind(cid, row.ckey).first();
    if (cu && +cu.optout) { await env.DB.prepare("UPDATE biz_revive SET status = 'skipped', result = 'opted out', updated = ?1 WHERE id = ?2").bind(ts, id).run(); return { status: 409, body: { ok: false, error: 'They asked us to stop, so nothing was sent.' } }; }
    if (!cu || !+cu.agreed) return { status: 409, body: { ok: false, needsOk: true, error: 'They haven’t said it’s OK to contact them. Mark them as OK first, or copy the message and reach out yourself.' } };
    const text = edited || row.draft;
    const claim = await env.DB.prepare("UPDATE biz_revive SET status = 'sending', updated = ?1 WHERE id = ?2 AND client_id = ?3 AND status = 'pending'").bind(ts, id, cid).run();
    if (!claim.meta.changes) return { status: 409, body: { ok: false, error: 'Already handled.' } };
    const res = [];
    let sent = false;
    if (row.email && EMAIL_RE.test(row.email)) {
      const cr = await env.DB.prepare('SELECT business FROM app_clients WHERE client_id = ?1').bind(cid).first();
      const bizName = (cr && cr.business) || '';
      const footer = '\n\nIf you’d rather not hear from ' + (bizName || 'us') + ', tell us here and we’ll stop: ' + SITE + '/u/' + cu.opt_token;
      let r = 'failed';
      try { r = await mailTo(env, row.email, 'A quick note from ' + (bizName || 'your service team'), text + footer, bizName, { replyTo: await replyTo(env, cid) }); } catch (e) { r = 'failed'; }
      res.push('email:' + r); if (r === 'sent') sent = true;
    }
    let status = sent ? 'sent' : 'queued';
    if (ph10(row.phone) && TEXTING_ON) {
      const cr2 = await env.DB.prepare('SELECT business FROM app_clients WHERE client_id = ?1').bind(cid).first();
      const tr = await sendText(env, { clientId: cid, to: row.phone, body: text + ' Reply STOP to end texts from ' + ((cr2 && cr2.business) || 'us') + '.', kind: 'revive' });
      res.push('text:' + (tr.ok ? 'sent' : (tr.why || 'failed'))); if (tr.ok) sent = true; status = sent ? 'sent' : (tr.retry ? 'queued' : status);
    }
    else if (!sent) res.push(ph10(row.phone) ? 'waiting for texting' : 'no way to send');
    await env.DB.prepare('UPDATE biz_revive SET status = ?1, result = ?2, draft = ?3, updated = ?4 WHERE id = ?5').bind(status, res.join(','), text, now(), id).run();
    await logAct(env, c, 'Approved a message to ' + cl(row.name, 60));
    return { status: 200, body: { ok: true, status, result: res.join(',') } };
  }
  }

// ---------------- opt-out link in every message ----------------
export async function handleOptOut(req, env, url) {
  const tok = (url.pathname.split('/')[2] || '').slice(0, 40);
  await ensurePast(env);
  const cu = /^[A-Za-z0-9]{16}$/.test(tok) ? await env.DB.prepare('SELECT c.id, c.client_id, c.ckey, c.optout, a.business FROM biz_customers c LEFT JOIN app_clients a ON a.client_id = c.client_id WHERE c.opt_token = ?1').bind(tok).first() : null;
  if (!cu) return page(404, 'Link not found', '<h1>Link not found</h1><p class="sub">This link isn’t valid anymore.</p>');
  const who = esc(cu.business || 'this business');
  if (req.method === 'POST') {
    await env.DB.batch([
      env.DB.prepare("UPDATE biz_customers SET optout = 1, agreed = 0, updated = ?1 WHERE id = ?2").bind(now(), cu.id),
      env.DB.prepare("UPDATE biz_revive SET status = 'skipped', result = 'opted out', updated = ?1 WHERE client_id = ?2 AND ckey = ?3 AND status = 'pending'").bind(now(), cu.client_id, cu.ckey)
    ]);
    return page(200, 'Done', '<h1>You’re off the list</h1><p class="sub">' + who + ' won’t send you messages like this anymore.</p>');
  }
  if (+cu.optout) return page(200, 'Already stopped', '<h1>You’re already off the list</h1><p class="sub">' + who + ' won’t send you messages like this.</p>');
  return page(200, 'Stop messages', '<h1>Stop messages from ' + who + '?</h1><p class="sub">Tap the button and they won’t send you notes like this again.</p><form method="post"><button>Yes, stop messages</button></form>');
}
