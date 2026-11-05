// Outreach calls to businesses (Brief 3, Part 8d, Nov 5, 2026). Christopher asked for cold-calling outreach as a feature.
//
// Consumers are never called. Under the TCPA a prerecorded or artificial voice calling a cell phone or residential line
// for marketing needs the called person's prior express written consent, the FCC ruled in Feb 2024 that AI-generated
// voices count as artificial, and the National Do Not Call Registry covers consumer sales calls; damages are $500-$1,500 a
// call. Calls to a client's own past customers who said yes stay in outcalls.js (quote, due) with the yes on file.
//
// Business-to-business only, and only through every gate below:
//   - a list the client supplies and attests in the app is theirs and is businesses (outreach_attest)
//   - every number checked on import with Twilio Lookup; only landlines and fixed VoIP are callable (mobile is skipped:
//     the TCPA consent rule for artificial voices covers cell phones, and many small businesses answer on a cell)
//   - never a regulated client; the owner's switch on; Christopher's kill switch on (billing_config outreach_enabled)
//   - business hours in the called number's time zone (callHoursOk), one attempt per number per 30 days
//   - "stop", "remove", 9 ends outreach calls to that number for good, for every client (outreach_optout)
//   - the first sentence says it is an automated assistant and the call is recorded; the owner's offer is one sentence,
//     checked at save time; one yes/no question; a yes becomes a lead, anything else ends the call; never called back.
//
// OUTREACH_LIVE is false: nothing here dials until a lawyer has read the B2B plan and Christopher says go. Then it is one
// line, changed and deployed on purpose, plus his kill switch in the database. test/outreach.test.js holds both.
import { callHoursOk, ph10, xml, xa, readAnswer, tzFor, dialOut, zonesOfNumber } from './callbacks.js';
import { contradicts } from './disclosure.js';
import { hardErrors } from './grades.js';

const SITE = 'https://alwaysopenoffice.com';
export const OUTREACH_LIVE = false;
export const KIND = { key: 'outreach', label: 'Outreach calls to businesses', sub: 'Max calls a list of businesses you give him, with one sentence you write, and asks if they want a call from you. Business landlines only.' };
export const ATTEST = 'I confirm this list is mine to use, every number on it is a business, and I have the right to contact them about my services. I understand Max only calls business landlines, during business hours, at most once a month per number, and that anyone who says stop is never called again.';
export const CALLABLE = new Set(['landline', 'fixedVoip']);
export const DAYS_BETWEEN = 30;
const MAX_ROWS = 500;

const readyDBs = new WeakSet();
export async function ensureOutreach(env) {
  if (readyDBs.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outreach_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, business TEXT DEFAULT '', phone TEXT NOT NULL, contact TEXT DEFAULT '', line_type TEXT DEFAULT '', status TEXT DEFAULT 'ready', last_called TEXT DEFAULT '', attempts INTEGER DEFAULT 0, result TEXT DEFAULT '', created TEXT, UNIQUE(client_id, phone))"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS outreach_optout (phone10 TEXT PRIMARY KEY, at TEXT, client_id TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS outreach_attest (client_id TEXT PRIMARY KEY, text TEXT, at TEXT, by TEXT)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outreach_pitch (client_id TEXT PRIMARY KEY, text TEXT, on_ INTEGER DEFAULT 0, at TEXT)")
  ]);
  readyDBs.add(env.DB);
}

// "business,phone,contact" rows (a header row is skipped); numbers normalized, duplicates dropped.
export function parseList(csv) {
  const out = [], seen = new Set();
  for (const line of String(csv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/,|\t/).map(x => x.trim().replace(/^"|"$/g, ''));
    const i = cells.findIndex(x => ph10(x));
    if (i < 0) continue;
    const p = ph10(cells[i]);
    if (seen.has(p)) continue;
    seen.add(p);
    const rest = cells.filter((_, j) => j !== i);
    out.push({ phone: '+1' + p, business: (rest[0] || '').slice(0, 80), contact: (rest[1] || '').slice(0, 60) });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

// Twilio Lookup line type: landline, mobile, fixedVoip, nonFixedVoip, tollFree, ... ('' when it can't be read).
export async function lineType(env, e164, f) {
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return '';
  try {
    const r = await (f || fetch)('https://lookups.twilio.com/v2/PhoneNumbers/' + encodeURIComponent(e164) + '?Fields=line_type_intelligence', { headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) } });
    const j = await r.json().catch(() => ({}));
    return String((j.line_type_intelligence && j.line_type_intelligence.type) || '');
  } catch (e) { return ''; }
}

// The owner pastes or uploads a list. Every number is checked; mobiles and unknowns are kept but marked skipped.
export async function importList(env, c, csv, lookup) {
  await ensureOutreach(env);
  if (+c.regulated) return { ok: false, error: 'Outreach calls are not available for regulated businesses.' };
  if (!(await attested(env, c.client_id))) return { ok: false, error: 'Please confirm the list is yours and is businesses first.' };
  const rows = parseList(csv);
  if (!rows.length) return { ok: false, error: 'No phone numbers found. One business per line: name, phone, contact.' };
  const look = lookup || (p => lineType(env, p));
  let ready = 0, skipped = 0;
  for (const r of rows) {
    const t = await look(r.phone);
    const ok = CALLABLE.has(t);
    if (ok) ready++; else skipped++;
    await env.DB.prepare("INSERT INTO outreach_lists (client_id, business, phone, contact, line_type, status, created) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(client_id, phone) DO UPDATE SET business = excluded.business, contact = excluded.contact, line_type = excluded.line_type, status = CASE WHEN outreach_lists.status IN ('optout','interested') THEN outreach_lists.status ELSE excluded.status END")
      .bind(c.client_id, r.business, r.phone, r.contact, t || 'unknown', ok ? 'ready' : 'skipped: ' + (t || 'unknown'), new Date().toISOString()).run();
  }
  return { ok: true, ready, skipped, message: ready + ' business landline' + (ready === 1 ? '' : 's') + ' ready' + (skipped ? ', ' + skipped + ' skipped (mobile or unknown numbers are never called)' : '') + '.' };
}

export async function attested(env, cid) {
  await ensureOutreach(env);
  return !!(await env.DB.prepare('SELECT 1 AS y FROM outreach_attest WHERE client_id = ?1').bind(cid).first());
}
export async function attest(env, c, by) {
  await ensureOutreach(env);
  if (+c.regulated) return { ok: false, error: 'Outreach calls are not available for regulated businesses.' };
  await env.DB.prepare('INSERT OR REPLACE INTO outreach_attest (client_id, text, at, by) VALUES (?1,?2,?3,?4)').bind(c.client_id, ATTEST, new Date().toISOString(), String(by || '').slice(0, 60)).run();
  return { ok: true };
}

// The one sentence Max says for the owner. Checked when saved: short, no claim to be a person, nothing the scanner flags.
export function pitchProblems(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(), out = [];
  if (!t) out.push('Write one sentence about what you offer.');
  if (t.length > 240) out.push('Keep it to one sentence, 240 characters at most.');
  if (contradicts(t)) out.push('It cannot say Max is a person or that the call is not recorded.');
  const hits = hardErrors([{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'hello' }, { r: 'a', t }], {});
  for (const h of hits) if (h.flag !== 'price') out.push('It cannot promise "' + h.quote + '".');
  if (/[<>[\]{}]/.test(t)) out.push('Plain words only.');
  return out;
}
export async function savePitch(env, c, text, on) {
  await ensureOutreach(env);
  if (+c.regulated) return { ok: false, error: 'Outreach calls are not available for regulated businesses.' };
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const p = pitchProblems(t);
  if (p.length) return { ok: false, error: p.join(' ') };
  await env.DB.prepare('INSERT OR REPLACE INTO outreach_pitch (client_id, text, on_, at) VALUES (?1,?2,?3,?4)').bind(c.client_id, t, on ? 1 : 0, new Date().toISOString()).run();
  return { ok: true };
}

// Every reason a row can't be called right now; empty means it could be.
export function blockedBy(row, ctx) {
  const why = [];
  if (!OUTREACH_LIVE) why.push('not live (lawyer review)');
  if (!ctx.killSwitchOn) why.push('kill switch off');
  if (ctx.regulated) why.push('regulated client');
  if (!ctx.attested) why.push('no attestation');
  if (!ctx.pitchOn || !ctx.pitch) why.push('owner switch off');
  if (!CALLABLE.has(row.line_type)) why.push('not a business landline');
  if (row.status !== 'ready') why.push('status ' + row.status);
  if (ctx.optedOut) why.push('opted out');
  if (row.last_called && (ctx.now - Date.parse(row.last_called)) < DAYS_BETWEEN * 86400000) why.push('called in the last ' + DAYS_BETWEEN + ' days');
  if (!ctx.hoursOk) why.push('outside business hours');
  return why;
}

// Business hours where the called number is: Monday to Friday, 9 AM to 5 PM (stricter than the 8-to-9 window for customers
// who asked to hear from a business), and inside callHoursOk too.
export function businessHoursOk(phone, at, tzFallback) {
  const tz = (zonesOfNumber(phone) || [])[0] || tzFallback || 'America/New_York';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
    const h = +parts.hour % 24;
    return !/Sat|Sun/.test(parts.weekday) && h >= 9 && h < 17 && callHoursOk(tz, at, phone);
  } catch (e) { return false; }
}
export async function killSwitchOn(env) {
  try { const r = await env.DB.prepare("SELECT v FROM billing_config WHERE k = 'outreach_enabled'").first(); return !!(r && r.v === '1'); } catch (e) { return false; }
}

// The cron: counts what could be called; dials nothing until OUTREACH_LIVE and the kill switch are both on.
export async function outreachCron(env, now) {
  await ensureOutreach(env);
  now = now || Date.now();
  const kill = await killSwitchOn(env);
  const rows = ((await env.DB.prepare("SELECT o.*, l.number, l.business AS biz, l.regulated, l.owner_set, p.text AS pitch, p.on_ AS pitch_on, (SELECT 1 FROM outreach_attest a WHERE a.client_id = o.client_id) AS att, (SELECT 1 FROM outreach_optout x WHERE x.phone10 = substr(o.phone, 3)) AS opted FROM outreach_lists o LEFT JOIN voice_lines l ON l.client_id = o.client_id LEFT JOIN outreach_pitch p ON p.client_id = o.client_id WHERE o.status = 'ready' LIMIT 200").all()).results) || [];
  let could = 0, dialed = 0;
  for (const r of rows) {
    const hoursOk = businessHoursOk(r.phone, now, await tzFor(env, r.client_id).catch(() => 'America/New_York'));
    const why = blockedBy(r, { now, killSwitchOn: kill, regulated: !!+r.regulated, attested: !!r.att, pitch: r.pitch, pitchOn: !!+r.pitch_on, optedOut: !!r.opted, hoursOk });
    if (why.length === 1 && why[0] === 'not live (lawyer review)') could++;
    if (why.length) continue;
    const d = await dialOut(env, { number: r.number }, r.phone, '/voice/or/' + env.VOICE_KEY + '?id=' + r.id, '/voice/orstatus/' + env.VOICE_KEY + '?id=' + r.id);
    await env.DB.prepare("UPDATE outreach_lists SET attempts = attempts + 1, last_called = ?1, status = ?2, result = ?3 WHERE id = ?4").bind(new Date(now).toISOString(), d.ok ? 'called' : 'ready', d.ok ? 'dialed' : d.why, r.id).run();
    if (d.ok) dialed++;
  }
  return { could, dialed };
}

// What Max says when the business picks up.
export function script(biz, pitch, owner) {
  const who = owner ? owner.split(' ')[0] : 'someone from ' + biz;
  return 'Hi, this is Max, an automated assistant calling for ' + biz + '. This call is recorded. ' + pitch + ' Would you like ' + who + ' to give you a call about it? You can say yes or no. To never get these calls again, say stop.';
}
async function rowOf(env, id) {
  return await env.DB.prepare("SELECT o.*, l.business AS biz, l.regulated, p.text AS pitch, json_extract(l.owner_set, '$.ownerName') AS owner FROM outreach_lists o LEFT JOIN voice_lines l ON l.client_id = o.client_id LEFT JOIN outreach_pitch p ON p.client_id = o.client_id WHERE o.id = ?1").bind(id).first().catch(() => null);
}
// /voice/or/<key>?id=   (not routed while OUTREACH_LIVE is false; the cron never dials)
export async function outreachTwiml(env, url, form) {
  if (!OUTREACH_LIVE) return xml('<Hangup/>');
  const id = +url.searchParams.get('id') || 0, r = await rowOf(env, id);
  if (!r || +r.regulated || !r.pitch) return xml('<Hangup/>');
  if (String(form.get('AnsweredBy') || '').startsWith('machine')) {
    await env.DB.prepare("UPDATE outreach_lists SET result = 'voicemail' WHERE id = ?1").bind(id).run().catch(() => {});
    return xml('<Hangup/>');   // no voicemail pitches
  }
  const act = SITE + '/voice/org/' + env.VOICE_KEY + '?id=' + id;
  return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" actionOnEmptyResult="true" action="' + xa(act) + '" method="POST"><Say>' + xa(script(r.biz || 'a local business', r.pitch, r.owner)) + '</Say></Gather><Hangup/>');
}
export async function outreachGather(env, url, form) {
  if (!OUTREACH_LIVE) return xml('<Hangup/>');
  const id = +url.searchParams.get('id') || 0, r = await rowOf(env, id);
  if (!r) return xml('<Hangup/>');
  const ans = readAnswer(form.get('Digits'), form.get('SpeechResult')), now = new Date().toISOString();
  const said = String(form.get('SpeechResult') || '').toLowerCase();
  if (ans === 'stop' || /\b(remove|take me off|do not call|don'?t call)\b/.test(said)) {
    await env.DB.prepare('INSERT OR REPLACE INTO outreach_optout (phone10, at, client_id) VALUES (?1,?2,?3)').bind(ph10(r.phone), now, r.client_id).run();
    await env.DB.prepare("UPDATE outreach_lists SET status = 'optout', result = 'asked not to be called' WHERE id = ?1").bind(id).run();
    return xml('<Say>Understood. You will not get these calls again. Goodbye.</Say><Hangup/>');
  }
  if (ans === 'yes') {
    await env.DB.prepare("INSERT INTO app_leads (client_id, at, name, phone, need, sms_ok, status) VALUES (?1,?2,?3,?4,?5,0,'new')").bind(r.client_id, now, r.contact || r.business || '', r.phone, 'Outreach: wants a call. ' + (r.business || '')).run();
    await env.DB.prepare("UPDATE outreach_lists SET status = 'interested', result = 'wants a call' WHERE id = ?1").bind(id).run();
    return xml('<Say>Great, thank you. ' + xa(r.biz || 'They') + ' will call you. Goodbye.</Say><Hangup/>');
  }
  await env.DB.prepare("UPDATE outreach_lists SET status = 'done', result = ?1 WHERE id = ?2").bind(ans === 'no' ? 'not interested' : 'no clear answer', id).run();
  return xml('<Say>No problem. Thanks for your time. Goodbye.</Say><Hangup/>');
}

// For the app and the monthly page.
export async function outreachState(env, c) {
  await ensureOutreach(env);
  if (+c.regulated) return null;
  const p = await env.DB.prepare('SELECT text, on_ FROM outreach_pitch WHERE client_id = ?1').bind(c.client_id).first();
  const counts = ((await env.DB.prepare("SELECT status, COUNT(*) AS n FROM outreach_lists WHERE client_id = ?1 GROUP BY status").bind(c.client_id).all()).results) || [];
  const n = k => counts.filter(x => String(x.status).startsWith(k)).reduce((a, x) => a + x.n, 0);
  return { live: OUTREACH_LIVE, label: KIND.label, sub: KIND.sub, attest: ATTEST, attested: await attested(env, c.client_id), pitch: p ? p.text : '', on: !!(p && +p.on_),
    counts: { ready: n('ready'), skipped: n('skipped'), called: n('called') + n('done'), interested: n('interested'), optout: n('optout') } };
}
