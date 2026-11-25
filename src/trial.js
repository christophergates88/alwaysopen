// Hear Max as your business (Nov 25, 2026). A business owner who got the free audit calls Always Open's line and Max
// answers as THEIR business, the way their customers would hear him on his first day: their name, their kind of work,
// and their hours and address, read from Google during the call and never kept (Google's terms let us keep only the
// place ID). It answers the doubt every owner has ("it won't sound like us") with their own business, not a sample.
//
// Two ways in, both on (706) 460-2226, so no new number and no new cost:
//   1. The button. The audit email and the audit page link to /hear/<token>. "Get Max ready" there readies the line for
//      the phone they type, for 30 minutes: their call is answered as their business straight away.
//   2. Caller ID. For 14 days after the audit, a call from the phone on the audit request first hears "To hear Max
//      answer as <business>, press 1." Nothing, or any other key, and Max answers as Always Open, as always.
// Each audit gets three such calls, and all of them together 25 a day. They are test calls: no lead, nothing counted,
// no text to anyone, nothing recorded. When one ends, the owner gets one email with the note Max would have sent them,
// and Christopher gets a push to call them while it is fresh.
//
// A trial call's line lives only in trial_calls, never in voice_lines (whose rows every job and check walks): its number
// is "trial:<CallSid>", which lineFor in voice.js reads from here, and its client is "trial-<token>", which no app,
// report, bill or count knows. After the call only the name they typed is kept; Google's details are dropped.
import { industryOf } from './provision.js';
import { MESSAGE_ONLY } from './trades.js';
import { zoneGuess } from './callbacks.js';

const SITE = 'https://alwaysopenoffice.com';
export const LINE_TEXT = '(706) 460-2226';
export const LINE_E164 = '+17064602226';
const DAY = 864e5;
export const READY_MS = 30 * 60e3;          // "Get Max ready" holds the line for this long
export const MENU_DAYS = 14;                // the press-1 offer, by caller ID, after the audit
export const CALLS_EACH = 3;                // trial calls per audit
export const PER_DAY = 25;                  // trial calls a day, all audits together
const PREFIX = 'trial-';
const E164 = /^\+1\d{10}$/, SID_RE = /^CA[0-9a-f]{32}$/, TOKEN_RE = /^[A-Za-z0-9]{16}$/;
const one = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const iso = t => new Date(t).toISOString();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xa = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const isTrial = cid => String(cid || '').startsWith(PREFIX);
export function e164(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? '+1' + d : '';
}
export const shownPhone = p => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; };
const token = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 56]).join(''); };

const ready = new WeakSet();
export async function ensureTrials(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS trials (id TEXT PRIMARY KEY, lead_id TEXT UNIQUE, phone TEXT DEFAULT '', business TEXT DEFAULT '', town TEXT DEFAULT '', type TEXT DEFAULT '', place_id TEXT DEFAULT '', about TEXT DEFAULT '', lang TEXT DEFAULT '', created TEXT, menu_until TEXT DEFAULT '', ready_until TEXT DEFAULT '', calls INTEGER DEFAULT 0, last_at TEXT DEFAULT '')").run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS trials_phone ON trials (phone)').run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS trial_calls (sid TEXT PRIMARY KEY, trial_id TEXT, at TEXT, line TEXT DEFAULT '', done TEXT DEFAULT '', emailed TEXT DEFAULT '')").run();
  ready.add(env.DB);
}

// ---------- what their website says about them (kept: it is their words, not Google's) ----------
const GENERIC = /^(home|homepage|welcome|index|untitled|default|just another wordpress site)\b/i;
export function aboutOf(site) {
  if (!site || !site.ok) return '';
  const tidy = s => one(String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&apos;/g, '’').replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/\s*[|•·»]\s*/g, ', ').replace(/[<>{}\[\]]/g, ''));
  const d = tidy(site.desc), t = tidy(site.title);
  const pick = d.length >= 25 ? d : (t.length >= 12 && !GENERIC.test(t) ? t : '');
  return pick.length > 220 ? pick.slice(0, 220).replace(/\s+\S*$/, '') + '…' : pick;
}

// ---------- the trial for one audit ----------
// Made (or refreshed) when the audit goes out: by email, by text, or when the audit page is opened. o: { placeId, about, now }.
export async function trialForLead(env, lead, o) {
  o = o || {};
  if (!lead || !lead.id || one(lead.business).length < 2) return null;
  await ensureTrials(env);
  const now = o.now || Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO trials (id, lead_id, phone, business, town, type, place_id, about, lang, created, menu_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
    .bind(token(), String(lead.id), e164(lead.phone), one(lead.business).slice(0, 80), one(lead.town).slice(0, 60), one(lead.type).slice(0, 60), o.placeId || '', o.about || '', lead.lang === 'es' ? 'es' : '', iso(now), iso(now + MENU_DAYS * DAY)).run();
  const t = await env.DB.prepare('SELECT * FROM trials WHERE lead_id = ?1').bind(String(lead.id)).first();
  if (!t) return null;
  // a later audit of the same request found the place, or its website said more: keep the newer
  const placeId = o.placeId || t.place_id, about = o.about || t.about, phone = t.phone || e164(lead.phone);
  if (placeId !== t.place_id || about !== t.about || phone !== t.phone) {
    await env.DB.prepare('UPDATE trials SET place_id = ?1, about = ?2, phone = ?3 WHERE id = ?4').bind(placeId, about, phone, t.id).run();
    Object.assign(t, { place_id: placeId, about, phone });
  }
  return t;
}
export const hearLink = t => SITE + '/hear/' + t.id;
export async function trialById(env, id) {
  if (!TOKEN_RE.test(String(id || ''))) return null;
  await ensureTrials(env);
  return env.DB.prepare('SELECT * FROM trials WHERE id = ?1').bind(String(id)).first().catch(() => null);
}

// "Get Max ready" on the page: this phone, for 30 minutes. Returns the row, or why not.
export async function readyLine(env, t, phone, now) {
  const p = e164(phone);
  if (!p) return { ok: false, why: 'phone' };
  if ((+t.calls || 0) >= CALLS_EACH) return { ok: false, why: 'used' };
  now = now || Date.now();
  await env.DB.prepare('UPDATE trials SET phone = ?1, ready_until = ?2 WHERE id = ?3').bind(p, iso(now + READY_MS), t.id).run();
  return { ok: true, phone: p, until: now + READY_MS };
}

async function callsToday(env, now) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM trial_calls WHERE at > ?1').bind(iso(now - DAY)).first().catch(() => null);
  return (r && +r.n) || 0;
}
async function underCap(env, now) {
  if ((await callsToday(env, now)) < PER_DAY) return true;
  try { await (await import('./ops.js')).opsAlert(env, 'trial-cap', '', PER_DAY + ' "Hear Max as your business" calls in 24 hours. Until that drops, owners who call hear Max as Always Open instead. If these are real owners, raise PER_DAY in trial.js.'); } catch (e) { /* the call goes on as Always Open */ }
  return false;
}

// A call to Always Open's line from this number: is there a trial for it? { row, ready } or null.
export async function trialFor(env, from, now) {
  if (!E164.test(String(from || ''))) return null;
  await ensureTrials(env);
  now = now || Date.now();
  const t = iso(now);
  const row = await env.DB.prepare('SELECT * FROM trials WHERE phone = ?1 AND calls < ?2 AND (ready_until > ?3 OR menu_until > ?3) ORDER BY ready_until DESC, created DESC LIMIT 1')
    .bind(String(from), CALLS_EACH, t).first().catch(() => null);
  if (!row || !(await underCap(env, now))) return null;
  return { row, ready: String(row.ready_until || '') > t };
}

// "To hear Max answer as <business>, press 1." Put before Max's usual answer: a key press goes to /voice/trial; no key, and
// Twilio goes on to Max as Always Open.
export function menuTwiml(env, row) {
  const es = row.lang === 'es', biz = spokenName(row.business, '');
  const act = SITE + '/voice/trial/' + env.VOICE_KEY + '?t=' + row.id;
  const text = es ? 'Hola, habla Always Open. Para oír a Max contestar como ' + biz + ', marque 1. Si no, espere en la línea.'
    : 'Hi, this is Always Open. To hear Max answer as ' + biz + ', the way your customers would, press 1. Otherwise, stay on the line.';
  return '<Gather input="dtmf" numDigits="1" timeout="4" action="' + xa(act) + '" method="POST"><Say voice="' + (es ? 'Polly.Lupe-Neural" language="es-US' : 'Polly.Matthew-Neural') + '">' + xa(text) + '</Say></Gather>';
}

// Takes one of the audit's three calls and builds the line Max answers as. Null when there is none left (or the day's
// limit is reached), and the call goes on as Always Open. h.details: Google's place details, for tests.
export async function startCall(env, row, sid, from, now, h) {
  if (!row || !SID_RE.test(String(sid || '')) || row.phone !== from) return null;
  await ensureTrials(env);
  now = now || Date.now();
  if (!(await underCap(env, now))) return null;
  const u = await env.DB.prepare('UPDATE trials SET calls = calls + 1, last_at = ?1 WHERE id = ?2 AND calls < ?3').bind(iso(now), row.id, CALLS_EACH).run();
  if (!(u && u.meta && u.meta.changes)) return null;
  const line = await persona(env, row, sid, h);
  await env.DB.prepare('INSERT OR REPLACE INTO trial_calls (sid, trial_id, at, line) VALUES (?1, ?2, ?3, ?4)').bind(sid, row.id, iso(now), JSON.stringify(line)).run();
  return line;
}
export async function startCallFor(env, id, sid, from, now, h) { return startCall(env, await trialById(env, id), sid, from, now, h); }

// The line for one trial call (voice.js lineFor, number "trial:<CallSid>").
export async function trialLine(env, sid) {
  if (!SID_RE.test(String(sid || ''))) return null;
  await ensureTrials(env);
  const r = await env.DB.prepare('SELECT line FROM trial_calls WHERE sid = ?1').bind(String(sid)).first().catch(() => null);
  if (!r || !r.line) return null;
  try { return JSON.parse(r.line); } catch (e) { return null; }
}

// ---------- who Max is on the call ----------
const G_FIELDS = ['displayName', 'formattedAddress', 'primaryType', 'primaryTypeDisplayName', 'regularOpeningHours', 'websiteUri', 'businessStatus'];
async function details(env, row) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    if (row.place_id) {
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(row.place_id), { headers: { 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': G_FIELDS.join(',') }, signal: ctrl.signal });
      return r.ok ? await r.json() : null;
    }
    // No place yet (an audit sent by text, before its page was opened): one search, kept only if it is the business they
    // named. Its place ID is kept (Google allows that); nothing else is.
    if (one(row.business).length < 2) return null;
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.PLACES_KEY, 'X-Goog-FieldMask': ['id'].concat(G_FIELDS).map(f => 'places.' + f).join(',') },
      body: JSON.stringify({ textQuery: one(row.business) + (row.town ? ' in ' + one(row.town) : ''), pageSize: 1 }) });
    const p = r.ok ? (((await r.json()) || {}).places || [])[0] : null;
    if (!p || !p.id || !(await import('./mail.js')).nameMatch(one(row.business), one(p.displayName && p.displayName.text), one(row.town))) return null;
    await env.DB.prepare("UPDATE trials SET place_id = ?1 WHERE id = ?2 AND place_id = ''").bind(String(p.id).slice(0, 300), row.id).run();
    return p;
  } finally { clearTimeout(timer); }
}
// "SINCLAIR PLUMBING, LLC" -> "Sinclair Plumbing": how the business would answer its own phone.
export function spokenName(name, typed) {
  let n = one(name).replace(/[<>{}\[\]"]/g, '').replace(/,?\s+(llc|l\.l\.c\.|inc\.?|incorporated|co\.|corp\.?|corporation|ltd\.?|pllc|plc)\.?$/i, '').trim();
  const t = one(typed).replace(/[<>{}\[\]"]/g, '');
  // Google names are often stuffed ("Sinclair Plumbing - Water Heater Repair Eatonton GA"): the name they typed then
  if (t && n.length > t.length + 12) n = t;
  if (!n) n = t;
  if (n && (n === n.toLowerCase() || n === n.toUpperCase())) n = n.toLowerCase().replace(/(^|[\s&/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return n.slice(0, 60) || 'the business';
}
// Google's weekday hours, said the way a person would, and in a form the booking reads (availability.js parseHours):
// "Monday to Friday 8 AM to 5 PM, Saturday 9 AM to noon, closed Sunday."
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function spokenHours(descs) {
  const by = {};
  for (const d of descs || []) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.+)$/.exec(String(d || ''));
    if (m && WEEK.indexOf(m[1]) > -1) by[m[1]] = String(m[2]).replace(/[    ]/g, ' ').replace(/\s*[–—]\s*/g, ' to ').replace(/(\d):00\b/g, '$1')
      .replace(/\b12 PM\b/g, 'noon').replace(/\b12 AM\b/g, 'midnight').replace(/,\s*/g, ' and ').replace(/open 24 hours/i, 'open 24 hours').replace(/\s+/g, ' ').trim();
  }
  if (!WEEK.some(d => by[d])) return '';
  const groups = [];
  for (const d of WEEK) { const h = by[d] || '', g = groups[groups.length - 1]; if (g && g.h === h) g.days.push(d); else groups.push({ days: [d], h }); }
  const out = groups.filter(g => g.h).map(g => {
    const span = g.days.length > 1 ? g.days[0] + ' to ' + g.days[g.days.length - 1] : g.days[0];
    return /^closed$/i.test(g.h) ? 'closed ' + span : span + ' ' + g.h;
  });
  // the open days first, then the closed ones
  return out.filter(x => !/^closed /.test(x)).concat(out.filter(x => /^closed /.test(x))).join(', ') + '.';
}
const townOf = addr => { const p = one(addr).split(',').map(x => x.trim()); return p.length >= 3 ? p[p.length - 3] + ', ' + p[p.length - 2].replace(/\s*\d{5}(-\d{4})?$/, '') : ''; };
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
export function trialNote(name) {
  return 'This is a trial call: the caller is most likely the owner of ' + name + ', hearing how you would answer their customers. Treat them exactly like a customer. ' +
    'What you know about ' + name + ' came from its Google profile and website just now; if they ask how you know it, say so. ' +
    'If they ask about you or how to get you for their business, say Always Open runs this line and Chris from Always Open will reach out.';
}
export async function persona(env, row, sid, h) {
  h = h || {};
  let g = null;
  if (env.PLACES_KEY) { try { g = await (h.details || details)(env, row); } catch (e) { g = null; } }
  const gname = g && g.displayName ? one(g.displayName.text) : '';
  const name = spokenName(gname || row.business, row.business);
  const typeName = g && g.primaryTypeDisplayName ? one(g.primaryTypeDisplayName.text).replace(/[<>{}\[\]]/g, '').slice(0, 60) : '';
  // The kind of work: from the name and the type they picked, or else from what Google calls them ("Plumber", "HVAC contractor")
  let industry = industryOf(name, row.type);
  if (!industry || industry === 'contractor') industry = industryOf(typeName) || industry;
  const town = one(row.town) || townOf(g && g.formattedAddress);
  const facts = {
    services: [typeName ? 'Listed on Google as: ' + typeName + '.' : '', row.about ? 'Its website says: ' + row.about : ''].filter(Boolean).join(' '),
    area: town ? town + ' and the area around it.' : '',
    hours: g && g.regularOpeningHours ? spokenHours(g.regularOpeningHours.weekdayDescriptions) : '',
    address: g && g.formattedAddress ? one(g.formattedAddress).replace(/, USA$/, '').slice(0, 160) : '',
    website: g && g.websiteUri ? domainOf(g.websiteUri) : '',
    notes: trialNote(name)
  };
  return {
    number: 'trial:' + sid, client_id: PREFIX + row.id, business: name, on_air: 1, regulated: MESSAGE_ONLY.has(industry) ? 1 : 0,
    industry: industry || '', town, facts: JSON.stringify(facts), transfer_to: '', transfer_when: 'never', spanish: 1, owner_set: '{}',
    tz: zoneGuess({ town, phone: row.phone }).tz, updated: iso(Date.now())
  };
}

// ---------- after the call ----------
// From the write-up (voice.js writeUp), once per call. o: { note, outcome, summary, heard, seconds, booked }. h: { send, ping } for tests.
export async function trialDone(env, call, o, h) {
  h = h || {};
  o = o || {};
  await ensureTrials(env);
  const now = h.now || Date.now();
  const u = await env.DB.prepare("UPDATE trial_calls SET done = ?1 WHERE sid = ?2 AND done = ''").bind(iso(now), String(call.id)).run();
  if (!(u && u.meta && u.meta.changes)) return 'already';
  const tc = await env.DB.prepare('SELECT * FROM trial_calls WHERE sid = ?1').bind(String(call.id)).first();
  const t = tc ? await env.DB.prepare('SELECT * FROM trials WHERE id = ?1').bind(tc.trial_id).first() : null;
  let line = {}; try { line = JSON.parse((tc && tc.line) || '{}') || {}; } catch (e) { line = {}; }
  const biz = line.business || (t && spokenName(t.business, t.business)) || 'their business';
  // Google's details go now; the line keeps the name and kind of work, so a late look-up still finds the call's line.
  await env.DB.prepare('UPDATE trial_calls SET line = ?1 WHERE sid = ?2').bind(JSON.stringify(Object.assign({}, line, { business: biz, facts: JSON.stringify({ notes: trialNote(biz) }) })), String(call.id)).run();
  if (!t) return 'no trial';
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?1').bind(t.lead_id).first().catch(() => null);
  const note = o.note || null, heard = +o.heard || 0;
  const left = Math.max(0, CALLS_EACH - (+t.calls || 0));
  const when = note && note.when ? one(note.when) : '';
  const title = !heard ? 'Hung up at the greeting' : (note && note.urgent ? 'Urgent: ' : 'New call: ') + (one(note && note.name) || 'a caller') + (note && note.reason ? ', ' + one(note.reason).replace(/\.$/, '') : '');
  // The owner's email: the note Max would have sent them, only when they said something and it was not a robocall.
  let mailed = '';
  if (lead && heard && o.outcome !== 'spam') {
    try {
      mailed = await (await import('./leadmail.js')).trialMail(env, lead, { business: biz, title, summary: one(o.summary), when, callback: note && note.callback, left, hear: hearLink(t) }, h);
    } catch (e) { mailed = 'failed: ' + one((e && e.message) || e).slice(0, 80); }
    await env.DB.prepare('UPDATE trial_calls SET emailed = ?1 WHERE sid = ?2').bind(mailed.slice(0, 60), String(call.id)).run();
  }
  // Christopher: a hot lead, while it is fresh
  const secs = +o.seconds || 0, len = secs >= 60 ? Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s' : secs + ' s';
  const who = lead ? [one(lead.name), shownPhone(lead.phone || t.phone), lead.grade ? 'grade ' + lead.grade : ''].filter(Boolean).join(', ') : shownPhone(t.phone);
  const body = who + '. A ' + len + ' call' + (heard ? ': ' + one(o.summary).slice(0, 220) : ', hung up at the greeting.') + (mailed === 'sent' ? ' They got the note by email.' : '') + ' Call them while it is fresh.';
  const ping = h.ping || (async (ti, b) => (await import('./app.js')).opsPing(env, ti, b, 'high', 'telephone_receiver'));
  try { await ping(biz + ' just heard Max as their business', body); } catch (e) { /* the call is written up either way */ }
  return mailed || 'pinged';
}

// ---------- the page: /hear/<token> ----------
const nb = t => '<span style="white-space:nowrap">' + esc(t) + '</span>';   // a phone number never splits across lines
const PAGE_EXTRA = '.call{display:block;text-align:center;margin:16px 0 4px;padding:16px;border-radius:14px;background:#5CC9A4;color:#04140E;font-weight:800;font-size:20px;text-decoration:none;box-shadow:0 0 16px rgba(92,201,164,.55)}' +
  '.try{margin:12px 0 0;padding-left:20px}.try li{margin:0 0 6px}h1{font-size:24px;line-height:1.2;margin:0 0 10px;color:#fff}';
export async function handleHear(req, env, url, h) {
  h = h || {};
  const L = await import('./leadmail.js');
  const id = url.pathname.slice('/hear/'.length).replace(/\/$/, '');
  const t = await trialById(env, id);
  const page = (title, body, es) => L.auditPage(title, '<style>' + PAGE_EXTRA + '</style>' + body, es);
  if (!t) return page('Not found', '<div class="card"><p style="margin:0">That link has expired. Call ' + LINE_TEXT + ' any hour and Max will help.</p></div>');
  const es = t.lang === 'es', now = h.now || Date.now();
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?1').bind(t.lead_id).first().catch(() => null);
  const biz = esc(spokenName(t.business, t.business)), left = Math.max(0, CALLS_EACH - (+t.calls || 0));
  const start = await L.goLink(env, t.lead_id, 'start');
  if (!left) {
    return page(es ? 'Ya usó sus llamadas' : 'You’ve used your calls', '<div class="card"><h1>' + (es ? 'Ya oyó a Max como ' : 'You’ve heard Max as ') + biz + '</h1><p>' +
      (es ? 'Ya usó sus tres llamadas de prueba. Para que Max conteste sus llamadas de verdad, empiece su primer mes; si no vale la pena, no lo paga.' : 'That was all three trial calls. To have Max answer your real calls, start your first month. If it’s not worth it, you don’t pay for it.') +
      '</p><a class="call" href="' + esc(start) + '">' + (es ? 'Empezar mi primer mes' : 'Start my first month') + '</a></div>', es);
  }
  if (req.method === 'POST') {
    let phone = '';
    try { phone = one((await req.formData()).get('phone')); } catch (e) { phone = ''; }
    if (!(await L.pagePostOk(req, env, 'hear', now))) return page(es ? 'Un momento' : 'One moment', '<div class="card"><p style="margin:0">' + (es ? 'Demasiados intentos desde aquí. Intente en una hora, o llame al ' : 'That’s a lot of tries from here. Try again in an hour, or call ') + LINE_TEXT + '.</p></div>', es);
    const r = await readyLine(env, t, phone, now);
    if (!r.ok) return page(es ? 'Revise el número' : 'Check the number', '<div class="card"><p style="margin:0">' + (es ? 'Ese número no parece correcto. ' : 'That number doesn’t look right. ') + '<a style="color:#FF8C82" href="/hear/' + t.id + '">' + (es ? 'Volver' : 'Go back') + '</a></p></div>', es);
    return page(es ? 'Max está listo' : 'Max is ready', '<div class="card"><h1>' + (es ? 'Max está listo' : 'Max is ready') + '</h1><p style="margin:0">' +
      (es ? 'Llame al ' + nb(LINE_TEXT) + ' desde el ' + nb(shownPhone(r.phone)) + ' en los próximos 30 minutos. Max contesta como ' + biz + '.' : 'Call ' + nb(LINE_TEXT) + ' from ' + nb(shownPhone(r.phone)) + ' in the next 30 minutes. Max answers as ' + biz + '.') +
      '</p><a class="call" href="tel:' + LINE_E164 + '">' + (es ? 'Llamar al ' : 'Call ') + LINE_TEXT + '</a>' + tryList(es, t, lead) +
      '<p class="note">' + (es ? '¿Llama desde otro teléfono? ' : 'Calling from a different phone? ') + '<a style="color:#FF8C82" href="/hear/' + t.id + '">' + (es ? 'Cambie el número' : 'Change the number') + '</a>.</p></div>', es);
  }
  const phone = shownPhone(t.phone || (lead && lead.phone));
  return page((es ? 'Escuche a Max como ' : 'Hear Max as ') + spokenName(t.business, t.business), '<div class="card"><h1>' + (es ? 'Escuche a Max contestar como ' : 'Hear Max answer as ') + biz + '</h1><p style="margin:0">' +
    (es ? 'Llame a nuestra línea y Max contesta como ' + biz + ', como lo oirían sus clientes en su primer día: su nombre, su tipo de trabajo, y su horario y dirección de Google.'
      : 'Call our line and Max answers as ' + biz + ', the way your customers would hear him on his first day: your name, your kind of work, and your hours and address from Google.') +
    '</p>' + tryList(es, t, lead) + '</div>' +
    '<div class="copy"><b>' + (es ? 'El teléfono desde el que va a llamar' : 'The phone you’ll call from') + '</b><form method="post"><input type="tel" name="phone" required autocomplete="tel" inputmode="tel" value="' + esc(phone) + '" placeholder="(478) 555-0100" aria-label="' + (es ? 'Su número' : 'Your phone number') + '"><button type="submit">' + (es ? 'Preparar a Max' : 'Get Max ready') + '</button></form></div>' +
    '<p class="note">' + (es ? 'Le quedan ' + left + (left === 1 ? ' llamada' : ' llamadas') + ' de prueba. Max no graba la llamada.' : left + (left === 1 ? ' trial call' : ' trial calls') + ' left. Max never records the call.') +
    (t.phone && String(t.menu_until || '') > iso(now) ? (es ? ' También puede llamar al ' + nb(LINE_TEXT) + ' desde el ' + nb(shownPhone(t.phone)) + ' y marcar 1.' : ' You can also just call ' + nb(LINE_TEXT) + ' from ' + nb(shownPhone(t.phone)) + ' and press 1.') : '') + '</p>', es);
}
function tryList(es, t, lead) {
  const regulated = MESSAGE_ONLY.has(industryOf(t.business, t.type));
  const items = es ? (regulated ? ['Pregunte su horario.', 'Deje un mensaje como lo haría un cliente.'] : ['Pregunte si abren el sábado.', 'Cuente un problema, como lo haría un cliente.', 'Pida una cita.'])
    : (regulated ? ['Ask when you’re open.', 'Leave a message the way a client would.'] : ['Ask if you’re open Saturday.', 'Describe a problem, the way a customer would.', 'Try to book a time.']);
  return '<ul class="try">' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul><p class="note">' + (es ? 'Después le mandamos por correo la nota que Max le habría enviado.' : 'Afterward we email you the note Max would have sent you.') + '</p>';
}

// ---------- every 10 minutes: tidy up ----------
// Google's details off any call whose write-up never came (2 hours on), pencilled-in trial visits after a day, and the
// call rows after 60 days. An audit's trial itself is kept with its lead.
export async function trialCron(env, now) {
  await ensureTrials(env);
  now = now || Date.now();
  const old = ((await env.DB.prepare("SELECT sid, line FROM trial_calls WHERE at < ?1 AND done = '' LIMIT 20").bind(iso(now - 2 * 3600e3)).all()).results) || [];
  for (const r of old) {
    let line = {}; try { line = JSON.parse(r.line || '{}') || {}; } catch (e) { line = {}; }
    await env.DB.prepare("UPDATE trial_calls SET done = ?1, line = ?2 WHERE sid = ?3 AND done = ''").bind(iso(now), JSON.stringify(Object.assign({}, line, { facts: JSON.stringify({ notes: trialNote(line.business || 'the business') }) })), r.sid).run();
  }
  try { await env.DB.prepare("DELETE FROM line_bookings WHERE client_id LIKE 'trial-%' AND end < ?1").bind(now - DAY).run(); } catch (e) { /* no bookings table yet */ }
  await env.DB.prepare('DELETE FROM trial_calls WHERE at < ?1').bind(iso(now - 60 * DAY)).run();
  return { tidied: old.length };
}
