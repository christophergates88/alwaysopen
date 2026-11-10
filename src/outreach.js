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
// Live since Nov 10, 2026: the lawyer (Carter) read the B2B plan and said it was fine, and Christopher said go. Still behind
// Christopher's kill switch in the database (billing_config outreach_enabled) and, for each client, the owner's own switch,
// which only turns on once the owner has signed the Outreach terms below (the current version, by typed name).
import { callHoursOk, ph10, xml, xa, readAnswer, tzFor, dialOut, zonesOfNumber } from './callbacks.js';
import { contradicts } from './disclosure.js';
import { hardErrors } from './grades.js';

const SITE = 'https://alwaysopenoffice.com';
export const OUTREACH_LIVE = true;
export const KIND = { key: 'outreach', label: 'Outreach calls to businesses', sub: 'Max calls a list of businesses you give him, with one sentence you write, and asks if they want a call from you. Business landlines only.' };
export const ATTEST = 'I confirm this list is mine to use, every number on it is a business, and I have the right to contact them about my services. I understand Max only calls business landlines, during business hours, at most once a month per number, and that anyone who says stop is never called again.';
// The Outreach terms the owner signs before the switch turns on: they are the caller, they answer for their list and their
// words, they release and indemnify Always Open. A new version (change TERMS_VERSION) asks every owner to sign again.
// Drafted Nov 10, 2026 for Carter to read; not legal advice to the client, and it says so.
export const TERMS_VERSION = '2026-11-10';
export const TERMS_TITLE = 'Outreach Calls: Terms, Release and Indemnity';
export const TERMS = [
  ['Who is calling', 'Outreach calls are placed at your direction, to the list you provide, saying the words you write, to promote your business. For every purpose, including the Telephone Consumer Protection Act (47 U.S.C. § 227), the FCC’s rules, the Telemarketing Sales Rule (16 C.F.R. Part 310) and any state telemarketing or calling law, you are the seller and the party on whose behalf each call is made, and you decide whether, whom and when to call. Always Open, a service of Lake Country Foam Party, LLC ("Always Open", "we"), only provides the technology that places the calls you direct.'],
  ['Your promises', 'You represent and warrant that: (a) you lawfully obtained every number on your list and have the right to use it to contact those businesses about your services; (b) every number belongs to a business and is not a residential line or a personal or wireless number of any individual; (c) you will not upload any number that is on the National Do Not Call Registry, a state do-not-call list, or your own do-not-call list, unless the law allows that call; (d) your message is true, not misleading, and does not claim to be from a person; (e) you hold any registration, license or bond a state requires of you to make these calls; and (f) you will follow every law that applies to these calls, wherever the called business is.'],
  ['What we do and may do', 'We check numbers and call only lines reported as business landlines, only during weekday business hours where the number is, at most once a month per number, and never again to anyone who says stop. These checks are a courtesy, not a promise that any call is lawful, and they do not shift your responsibility to us. We may refuse, pause or end Outreach, remove any number or change your message at any time, without notice. We keep your list, your signed terms, your message and records of every call, and may share them with any authority or court, or to defend a claim.'],
  ['Release', 'To the fullest extent the law allows, you release and forever discharge Always Open and Lake Country Foam Party, LLC, and its members, managers, employees, contractors and agents, from any and all claims, demands, losses and liabilities of any kind, known or unknown, arising out of or related to Outreach calls made for you, your list, your message, or your use or misuse of Outreach.'],
  ['Indemnity', 'You will defend, indemnify and hold harmless Always Open and Lake Country Foam Party, LLC, and its members, managers, employees, contractors and agents, from and against any claim, lawsuit, investigation, fine, penalty, statutory damages, judgment, settlement, cost and attorneys’ fees arising out of or related to: (a) any call made at your direction; (b) your list or your message; (c) any breach of these terms or of your promises above; or (d) any violation of law by you or on your behalf. This applies even if a claim is made against us directly.'],
  ['Limits', 'Outreach is provided "as is". We make no promise about results or that any call complies with any law. To the fullest extent the law allows, our total liability to you for anything related to Outreach is limited to the fees you paid us in the month the claim arose, and we are not liable for any indirect, incidental, special, consequential or punitive damages.'],
  ['Not legal advice', 'Nothing we say or provide is legal advice. Calling laws are strict and change often. You should have your own attorney review your list, your message and your plans before you turn Outreach on.'],
  ['General', 'These terms add to our Terms of Service and survive the end of Outreach or of your plan. Georgia law governs them. If any part is found unenforceable, the rest still applies. By typing your name and tapping "I agree", you sign these terms electronically, with the same effect as a handwritten signature, on your own behalf and for your business, and you confirm you have the authority to do so.']
];
export const TERMS_TEXT = TERMS_TITLE + ' (version ' + TERMS_VERSION + ')\n\n' + TERMS.map(([h, t]) => h + '. ' + t).join('\n\n');
export async function termsHash() {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TERMS_TEXT));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outreach_pitch (client_id TEXT PRIMARY KEY, text TEXT, on_ INTEGER DEFAULT 0, at TEXT)"),
    // every signature kept: who typed what name, when, from where, and exactly which text (its hash)
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outreach_terms (client_id TEXT NOT NULL, version TEXT NOT NULL, hash TEXT, name TEXT, by TEXT, at TEXT, ip_hash TEXT, ua TEXT, PRIMARY KEY (client_id, version))")
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

// Signed the current version of the terms (an older confirmation, or an older version, does not count).
export async function attested(env, cid) {
  await ensureOutreach(env);
  return !!(await env.DB.prepare('SELECT 1 AS y FROM outreach_terms WHERE client_id = ?1 AND version = ?2').bind(cid, TERMS_VERSION).first());
}
export async function signedAt(env, cid) {
  await ensureOutreach(env);
  return await env.DB.prepare('SELECT name, at FROM outreach_terms WHERE client_id = ?1 AND version = ?2').bind(cid, TERMS_VERSION).first().catch(() => null);
}
// The owner signs: b = { version, name, agree: true }; meta = { by, ip, ua } from the request.
export async function agree(env, c, b, meta) {
  await ensureOutreach(env);
  if (+c.regulated) return { ok: false, error: 'Outreach calls are not available for regulated businesses.' };
  if (c.staff) return { ok: false, error: 'Only the owner can sign these terms.' };
  if (!b || b.agree !== true) return { ok: false, error: 'Tick the box to agree to the terms.' };
  if (String(b.version || '') !== TERMS_VERSION) return { ok: false, error: 'These terms were updated. Pull down to refresh and read the new version.' };
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 3 || !/[A-Za-z]{2,}/.test(name) || !/\s/.test(name)) return { ok: false, error: 'Type your full name to sign.' };
  meta = meta || {};
  await env.DB.prepare('INSERT OR REPLACE INTO outreach_terms (client_id, version, hash, name, by, at, ip_hash, ua) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
    .bind(c.client_id, TERMS_VERSION, await termsHash(), name, String(meta.by || '').slice(0, 60), new Date().toISOString(), String(meta.ip || '').slice(0, 80), String(meta.ua || '').slice(0, 200)).run();
  try { await (await import('./app.js')).opsPing(env, 'Outreach terms signed: ' + (c.business || c.client_id), name + ' signed the Outreach terms (version ' + TERMS_VERSION + ').', 'default', 'telephone_receiver'); } catch (e) { /* the signature stands */ }
  return { ok: true, message: 'Signed. Now turn Outreach on.' };
}
// Kept for an app that still sends the old one-tap confirmation: it no longer counts as signing.
export async function attest(env, c) {
  return { ok: false, error: 'Read and sign the Outreach terms first.' };
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
  if (on && !(await attested(env, c.client_id))) return { ok: false, error: 'Read and sign the Outreach terms before turning it on.', needTerms: true };
  await env.DB.prepare('INSERT OR REPLACE INTO outreach_pitch (client_id, text, on_, at) VALUES (?1,?2,?3,?4)').bind(c.client_id, t, on ? 1 : 0, new Date().toISOString()).run();
  return { ok: true };
}

// Every reason a row can't be called right now; empty means it could be.
export function blockedBy(row, ctx) {
  const why = [];
  if (!OUTREACH_LIVE) why.push('not live');
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
  const rows = ((await env.DB.prepare("SELECT o.*, l.number, l.business AS biz, l.regulated, l.owner_set, p.text AS pitch, p.on_ AS pitch_on, (SELECT 1 FROM outreach_terms a WHERE a.client_id = o.client_id AND a.version = ?1) AS att, (SELECT 1 FROM outreach_optout x WHERE x.phone10 = substr(o.phone, 3)) AS opted FROM outreach_lists o LEFT JOIN voice_lines l ON l.client_id = o.client_id LEFT JOIN outreach_pitch p ON p.client_id = o.client_id WHERE o.status = 'ready' LIMIT 200").bind(TERMS_VERSION).all()).results) || [];
  let could = 0, dialed = 0;
  const gone = new Map();
  for (const r of rows) {
    // a client whose plan ended, or whose line is paused, calls nobody (the same rule as Max's other outgoing calls)
    if (!gone.has(r.client_id)) {
      const a = await env.DB.prepare('SELECT active FROM app_clients WHERE client_id = ?1').bind(r.client_id).first().catch(() => null);
      const l = await env.DB.prepare('SELECT on_air, owner_set FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(r.client_id).first().catch(() => null);
      let off = false; try { off = !!(JSON.parse((l && l.owner_set) || '{}') || {}).off; } catch (e) { off = false; }
      gone.set(r.client_id, (a && !+a.active) || (l && l.on_air != null && !+l.on_air) || off);
    }
    if (gone.get(r.client_id)) continue;
    const hoursOk = businessHoursOk(r.phone, now, await tzFor(env, r.client_id).catch(() => 'America/New_York'));
    const why = blockedBy(r, { now, killSwitchOn: kill, regulated: !!+r.regulated, attested: !!r.att, pitch: r.pitch, pitchOn: !!+r.pitch_on, optedOut: !!r.opted, hoursOk });
    if (why.length === 1 && why[0] === 'not live') could++;
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
// Twilio's status for an outreach call: no answer, busy or failed is written down; the number is not tried again this month.
export async function outreachStatus(env, url, form) {
  const id = +url.searchParams.get('id') || 0, st = String(form.get('CallStatus') || '');
  if (id && /^(no-answer|busy|failed|canceled)$/.test(st)) await env.DB.prepare("UPDATE outreach_lists SET result = ?1 WHERE id = ?2 AND status = 'called'").bind(st, id).run().catch(() => {});
  return new Response('ok');
}
// /voice/or/<key>?id=
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
  const signed = await signedAt(env, c.client_id);
  return { live: OUTREACH_LIVE, label: KIND.label, sub: KIND.sub, attest: ATTEST, attested: !!signed, signed: signed ? { name: signed.name, at: signed.at } : null,
    terms: { version: TERMS_VERSION, title: TERMS_TITLE, parts: TERMS.map(([h, t]) => ({ h, t })) }, pitch: p ? p.text : '', on: !!(p && +p.on_),
    counts: { ready: n('ready'), skipped: n('skipped'), called: n('called') + n('done'), interested: n('interested'), optout: n('optout') } };
}
