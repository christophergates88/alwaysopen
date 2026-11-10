// Shoulder Tap: Max asks the owner while the caller is still on the line.
// A caller asks something only the owner knows and that decides whether they go ahead ("can you come tonight?", "how
// much for my job?"). Without this Max says the owner will call back, and some of those callers ring the next business.
// With it Max says he is checking, keeps taking their details, and the owner gets the question at once: a text to their
// own phone, a push, and the live card in the app. They answer with a reply text or one tap, and Max tells the caller
// in the same call. No answer in TAP_WAIT_MS and Max says they will get a call back, exactly as he would have without
// it. An answer that arrives after the call is over is kept on the call, and the owner is told to ring them.
// The owner can start it too: "Tell Max" on the live card says a line to the caller mid-call, and "Take the call" puts
// the caller through.
// The call room (voice.js) owns the timing and the words. Here: what may be asked and answered, who is told and how,
// and the table (call_taps) the app, the text webhook and the call room all read.
import { sendText, ph10, OWN, TEXTING_ON } from './sms.js';
import { callHoursOk, tzFor } from './callbacks.js';
import { TEAM } from './facts.js';

export const TAP_WAIT_MS = 75000;        // how long Max waits for the owner before he says they will get a call back
export const TAP_HOLD_MS = 8000;         // a silent caller hears "Still checking..." once, after this
export const TAP_MAX = 2;                // questions to the owner in one call
export const TAP_PER_HOUR = 12;          // questions to one owner in an hour, across calls
export const TAP_LATE_MS = 10 * 60000;   // an owner's text this long after the question still belongs to that question
export const TAP_SAY_MS = 2500;          // how long the plain-speech wording may take before the owner's own words are used
const E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

const one = s => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/[\[\]<>{}]/g, '').replace(/\s{2,}/g, ' ').trim();
// The question as the owner reads it: one line, no control characters or brackets, a question mark at the end.
export function cleanAsk(q) {
  let t = one(q).replace(/^["'“”‘’\s:]+|["'“”‘’\s]+$/g, '').slice(0, 140).trim();
  if (!/[a-z0-9]/i.test(t)) return '';
  // a link or web address is never put in the owner's text (a caller could get one sent from the business's own number)
  if (/https?:|www\.|[a-z0-9-]\.[a-z]{2,}\b|@/i.test(t)) return '';
  if (!/[?.!]$/.test(t)) t += '?';
  return t;
}
// A reaction, not an answer: an iPhone tapback ('Liked "Max: Live call..."'), Android's 'Reacted 👍 to', or a reply with
// no letters or digits ("?", "👍"). The question stays open and the owner is asked for words (Nov 10: Max read the
// tapback out, the caller's own number included).
export function notAnAnswer(t) {
  const x = String(t || '').trim();
  if (!/[\p{L}\p{N}]/u.test(x)) return true;
  return /^(Liked|Loved|Disliked|Laughed at|Emphasized|Emphasised|Questioned|Reacted\s.{1,12}\sto|Removed (a|an)\s.{1,20}\sfrom)\s*[“"']/i.test(x);
}
// The owner's answer as Max gets it: one line, nothing that could be read as a control tag.
export function cleanAnswer(t) { return one(t).slice(0, 240).trim(); }
export function tapId() { const b = crypto.getRandomValues(new Uint8Array(12)); return 'tp' + [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
const fmt = e => { const d = ph10(e); return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : ''; };
const nowIso = () => new Date(Date.now()).toISOString();
// Caller ID names arrive in capitals ("TOM REYES"): shown the way a person writes a name.
const nameCase = n => { const t = one(n).slice(0, 40); return t && t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : t; };

// The owner's switch (the Max tab): 'day' (8 AM to 9 PM, the default), 'always', or 'off'.
export function tapPref(line) {
  let o = {}; try { o = JSON.parse((line && line.owner_set) || '{}') || {}; } catch (e) { o = {}; }
  return o.tap === 'off' || o.tap === 'always' ? o.tap : 'day';
}
// Who has Shoulder Tap. On for every line that is not regulated since Nov 10, 2026 (the Worker setting TAP_LIVE = "1" in
// wrangler.toml; without it, as in the tests, only lines whose facts list it: features for every call, testFeatures for
// the owner's own test calls). One line can be switched off from HQ: facts.off: ["tap"]. The owner has their own switch.
export function tapFeature(line, test, env) {
  let f = {}; try { f = JSON.parse((line && line.facts) || '{}') || {}; } catch (e) { f = {}; }
  if (Array.isArray(f.off) && f.off.includes('tap')) return false;
  if (env && String(env.TAP_LIVE || '') === '1') return true;
  const on = k => Array.isArray(f[k]) && f[k].includes('tap');
  return on('features') || (!!test && on('testFeatures'));
}

// ---------- the words ----------
// The text the owner gets. Short enough to read at a glance; the first line says it is happening now. biz: set when
// the text comes from Always Open's own number (a business whose texting registration is not approved yet).
export function tapText(o) {
  const who = o.name || fmt(o.caller) || 'a caller', max = o.max || 'Max';
  return max + ': Live call from ' + who + (o.biz ? ' for ' + o.biz : '') + '.\nThey ask: "' + o.q + '"\nReply to this text now and ' + max + ' tells them. No reply in a minute and he says you will call back.';
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// What Max says when the answer comes, in the owner's own words (used when the plain-speech wording is not ready in time).
// q: the question it answers; without one the owner sent the line on their own ("Tell Max").
export function relayLine(who, text, lang, q) {
  const t = cleanAnswer(text).replace(/\s*[.!]+$/, '');
  if (lang === 'es-US') { const w = who || 'el dueño'; return q ? 'Ya me respondieron. ' + cap(w) + ' dice: ' + t + '.' : 'Me acaba de llegar un mensaje de ' + w + ': ' + t + '.'; }
  const w = who || 'the owner';
  return q ? 'I just heard back. ' + cap(w) + ' says: ' + t + '.' : 'I just got a note from ' + w + ': ' + t + '.';
}
// What Max says when nobody answered in time: the same call-back promise he would have made without asking.
export function missLine(who, lang) {
  if (lang === 'es-US') return 'No pude localizar a ' + (who || 'el dueño') + ' en este momento, pero ya tiene su pregunta y le devolverá la llamada.';
  return 'I couldn’t reach ' + (who || 'the owner') + ' just now, but they have your question and will call you back about it.';
}
// What a quiet caller hears while Max waits on the owner: once after TAP_HOLD_MS, then now and then. n: which time this is.
export function holdLine(who, lang, n) {
  const w = who || (lang === 'es-US' ? 'el dueño' : 'the owner');
  if (lang === 'es-US') return n > 1 ? 'Sigo aquí con usted. Estoy esperando la respuesta.' : 'Sigo consultando con ' + w + '. Un momento más.';
  return n > 2 ? 'Thanks for holding. Should be any second.' : n > 1 ? 'Still with you. Just waiting to hear back.' : 'Still checking with ' + w + '. One more moment.';
}
export function takeLine(who, lang) {
  if (lang === 'es-US') return 'Buenas noticias: ' + (who || 'el dueño') + ' puede atenderle ahora mismo. Un momento, le comunico.';
  return 'Good news: ' + (who || 'the owner') + ' can take your call right now. One moment while I connect you.';
}
// The rule in Max's instructions, only on calls where the owner can be reached right now.
export function tapRule(L, short) {
  const who = (L.tap && L.tap.who) || 'the owner';
  // Firm, with examples: worded as "you may", the real model kept leaving these for the callback (Nov 10 practice calls)
  const when = 'a price for their specific job, whether someone can come today or at a certain time, whether we do that kind of job or brand, or how a job or part of theirs stands';
  const ex = 'For example: "How much to put in a toilet I already bought?" gets "Let me check with ' + who + ' right now. Is the old one still in?" ending with [ASK: Install price, customer has the toilet?]; "Did ' + who + ' ever get that part?" gets "Let me check with ' + who + ' right now. What\'s your name?" ending with [ASK: Did the part come in for this customer?].';
  if (short) return 'Checking with ' + who + ': when they ask ' + when + ', and it is not written above, do not leave it for the callback: say "Let me check with ' + who + ' right now.", carry on with your next question, and end that reply with [ASK: the question for ' + who + ', 12 words or fewer]. ' + ex + ' The answer comes within a minute and you will be told it; never guess it. Not for emergencies or danger, not for what is written above, and at most once per question.';
  return 'Checking with ' + who + ' during the call: when the caller asks ' + when + ', and the answer is not written above, do not say you do not know or that it waits for the callback. Ask ' + who + ' while the caller is on the line: say "Let me check with ' + who + ' right now." and, in the same reply, carry on with the next thing you need from the caller. End that reply with [ASK: the question for ' + who + ', in 12 words or fewer, with the detail they need to answer it]. ' + ex + ' ' +
    'The answer usually comes within a minute and you will be told what it is; never say or guess what it will be. Not for an emergency or a danger call (those have their own steps), not for anything written above, and at most once per question.';
}
// The note Max gets each turn while a question is out, and for the two turns after the answer.
export function tapNote(s) {
  if (!s || !s.line || !s.line.tap) return '';
  const who = s.line.tap.who || 'the owner', out = [];
  const t = s.tap, told = s.tapTold;
  if (t && !t.done) out.push('You asked ' + who + ': "' + t.q + '". No answer yet. Never guess the answer and never say it is taking long. Keep helping with what you can (their name, the best number, the address); if they ask, say you are still checking.');
  if (s.tapGot && !s.tapGot.miss) out.push(who + ' has answered. The caller hears the answer at the start of this reply; go on from there.');
  if (told && (s.turn || 0) - (told.turn || 0) <= 2) {
    if (told.miss) out.push('You could not reach ' + who + ' in time and told the caller they will get a call back about "' + told.q + '". Do not offer to check again on this call.');
    else out.push(who + ' answered' + (told.q ? ' the question "' + told.q + '"' : '') + ': "' + told.text + '". You told the caller in these words: "' + told.line + '". Treat it as settled: never contradict it or add to it. If the caller talked over it, tell them again plainly. Then move the call on: get what is still needed (name, number, address) and say what happens next.');
  }
  if ((s.tapN || 0) >= TAP_MAX) out.push('You have already checked with ' + who + ' ' + (s.tapN === 1 ? 'once' : s.tapN + ' times') + ' on this call: do not use [ASK] again; anything else goes to the callback.');
  return out.join(' ');
}
// One sentence on the call's write-up for each question, so the owner sees it wherever the call shows (app, push, text).
export function tapSummary(taps) {
  const out = [];
  for (const t of (Array.isArray(taps) ? taps : []).slice(0, 4)) {
    if (!t) continue;
    if (t.tell) { out.push('You told Max mid-call: “' + t.a + '”'); continue; }
    if (t.take) { out.push('You took the call from the app.'); continue; }
    out.push('Max asked you mid-call: “' + t.q + '” ' + (t.a ? 'You answered: “' + t.a + '”' : 'No answer came in time, so he promised a call back.'));
  }
  return out.length ? ' ' + out.join(' ') : '';
}

// ---------- the table ----------
const READY = new WeakSet();
export async function ensureTaps(env) {
  if (READY.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS call_taps (id TEXT PRIMARY KEY, call_id TEXT NOT NULL, client_id TEXT NOT NULL, kind TEXT DEFAULT 'ask', q TEXT DEFAULT '', asked_at TEXT, status TEXT DEFAULT 'open', answer TEXT DEFAULT '', answered_at TEXT DEFAULT '', via TEXT DEFAULT '', by TEXT DEFAULT '', notified TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS call_taps_client ON call_taps (client_id, asked_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS call_taps_call ON call_taps (call_id)')
  ]);
  READY.add(env.DB);
}

// Who answers for this business, and on what number. Always Open's own line asks Christopher.
async function ownerOf(env, cid) {
  if (cid === OWN) return { phone: String(env.OPS_TEXT_TO || ''), first: TEAM.founder.split(' ')[0] };   // the name Max already says on that line
  const c = await env.DB.prepare('SELECT phone, owner_first FROM app_clients WHERE client_id = ?1 AND active = 1').bind(cid).first().catch(() => null);
  return c ? { phone: String(c.phone || ''), first: String(c.owner_first || '').replace(/[^A-Za-z .'-]/g, '').trim().slice(0, 30) } : null;
}

// At the start of a call: may Max ask the owner on this one? Returns { who } (the name Max uses) or null.
// Only when the line has the feature, the owner has not switched it off, it is an hour they take questions (their own
// test calls may try it at any hour), there is a phone to reach them on, and they have not been asked too often.
export async function tapSetup(env, call, line, now) {
  if (!line || +line.regulated || !tapFeature(line, !!call.test, env)) return null;
  const pref = tapPref(line);
  if (pref === 'off') return null;
  const cid = call.client_id;
  const own = await ownerOf(env, cid);
  if (!own || !ph10(own.phone)) return null;
  if (!call.test && pref !== 'always' && !callHoursOk(await tzFor(env, cid), now || Date.now())) return null;
  await ensureTaps(env);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM call_taps WHERE client_id = ?1 AND kind = 'ask' AND asked_at > ?2").bind(cid, new Date((now || Date.now()) - 3600e3).toISOString()).first().catch(() => null);
  if (n && +n.n >= TAP_PER_HOUR) return null;
  return { who: own.first || '' };
}

// Max asked: the row, then the text and the push. o: { id, sid, cid, caller, q, max, biz, test }.
// Returns { ok } (false when nobody could be told, so the call room does not keep the caller waiting).
export async function openTap(env, o, h) {
  h = h || {};
  await ensureTaps(env);
  const now = nowIso();
  // One open question per business at a time, so the owner's reply can only belong to one caller (Nov 10: with two
  // calls waiting, Mike's "Yes, 7 tonight" for Dana was told to Tom), and the hour's limit counted again here, not only
  // when the call began. Both in the statement that saves the question; a refused one gets the callback promise.
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO call_taps (id, call_id, client_id, kind, q, asked_at, status) SELECT ?1, ?2, ?3, 'ask', ?4, ?5, 'open' WHERE NOT EXISTS (SELECT 1 FROM call_taps WHERE client_id = ?3 AND kind = 'ask' AND status = 'open' AND call_id != ?2 AND asked_at > ?6) AND (SELECT COUNT(*) FROM call_taps WHERE client_id = ?3 AND kind = 'ask' AND asked_at > ?7) < ?8")
    .bind(o.id, o.sid, o.cid, o.q, now, new Date(Date.now() - TAP_WAIT_MS - 30000).toISOString(), new Date(Date.now() - 3600e3).toISOString(), TAP_PER_HOUR).run().catch(() => null);
  if (!(ins && ins.meta && ins.meta.changes)) return { ok: false, told: [], busy: true };
  const own = await ownerOf(env, o.cid);
  const told = [];
  let name = '';
  try { const c = await env.DB.prepare('SELECT caller_name FROM app_calls WHERE id = ?1').bind(o.sid).first(); name = nameCase(c && c.caller_name); } catch (e) { name = ''; }
  if (own && ph10(own.phone) && TEXTING_ON) {
    const send = h.text || sendText;
    let r = null;
    try { r = await send(env, { clientId: o.cid, to: own.phone, kind: 'tap', body: tapText({ max: o.max, name, caller: o.caller, q: o.q }) }); } catch (e) { r = null; }
    // A business whose own texting registration is not approved yet still gets the question: from Always Open's own
    // number, as Always Open writing to its client. The reply comes back to that number (tapFromOwnerText).
    if (!(r && r.ok) && o.cid !== OWN && r && /not registered|no number/.test(String(r.why || ''))) {
      try { r = await send(env, { clientId: OWN, to: own.phone, kind: 'tap', body: tapText({ max: o.max, name, caller: o.caller, q: o.q, biz: one(o.biz).slice(0, 60) }) }); } catch (e) { r = null; }
    }
    if (r && r.ok) told.push('text');
  }
  try {
    const app = await import('./app.js');
    if (o.cid === OWN) { await app.opsPing(env, 'Max is asking you (live call)', '“' + o.q + '” Reply to his text and he tells the caller.', 'high', 'raised_hand'); told.push('push'); }
    else { await app.pushClient(env, o.cid, { aps: { alert: { title: (o.test ? 'Test call: ' : '') + (o.max || 'Max') + ' is asking you', body: ('“' + o.q + '” They are still on the line. Tap to answer.').slice(0, 300) }, sound: 'default', 'interruption-level': 'time-sensitive', 'thread-id': 'calls' }, screen: 'today', call: o.sid, tap: o.id }); told.push('push'); }
  } catch (e) { /* the text went, or nobody was told (below) */ }
  // Only a text that left counts as "told": the reply to it is how every owner can answer today (the push opens the
  // app, where the web app has the answer buttons and the iPhone app gets them in its next version).
  const ok = told.includes('text');
  await env.DB.prepare('UPDATE call_taps SET notified = ?1 WHERE id = ?2').bind(told.join(','), o.id).run().catch(() => {});
  return { ok, told };
}

// The call room is told (it says the words); returns 'said', 'queued' or 'late'.
async function poke(env, callId, o) {
  if (!env.CALLROOM) return 'late';
  try { return await env.CALLROOM.get(env.CALLROOM.idFromName(callId)).tapAnswer(o); } catch (e) { return 'late'; }
}
async function liveCall(env, callId, cid) {
  return env.DB.prepare("SELECT id, caller, caller_name, outcome, test FROM app_calls WHERE id = ?1 AND client_id = ?2").bind(callId, cid).first().catch(() => null);
}
const REPLY = {
  said: name => 'Got it. ' + name + ' is telling them now.',
  queued: name => 'Got it. ' + name + ' tells them as soon as they stop talking.',
  ringing: () => 'Got it. They are being put through to you now, so answer your phone. Your answer is on the call too.',
  late: (name, row, call) => 'That call ended before your answer got there' + (row && row.q ? '. They asked: "' + row.q + '"' : '') + '. ' + (call && fmt(call.caller) ? 'Call them back: ' + fmt(call.caller) + '.' : 'It is in your calls list.')
};
async function record(env, row, text, via, by, state) {
  const now = nowIso();
  await env.DB.prepare('UPDATE call_taps SET status = ?1, answer = ?2, answered_at = ?3, via = ?4, by = ?5 WHERE id = ?6').bind(state === 'late' ? 'late' : 'answered', text, now, via, String(by || '').slice(0, 40), row.id).run();
  // too late for the caller to hear: the answer still reaches the owner's own record of the call
  if (state === 'late') await env.DB.prepare("UPDATE app_calls SET summary = TRIM(COALESCE(summary, '') || ?1), hq_synced = 0 WHERE id = ?2 AND outcome != 'live'").bind(' You answered after the call ended: “' + text + '”', row.call_id).run().catch(() => {});
}

// The owner texted their own business line. If Max has a question out for them (or just had one, and the call is still
// on), the text is the answer, and never a standing note for Max. Returns { reply } for the text back, or null when this
// text is not about a live question (the caller's usual handling carries on).
export async function tapFromText(env, cid, body, maxName) {
  await ensureTaps(env);
  const since = new Date(Date.now() - TAP_LATE_MS).toISOString();
  const row = await env.DB.prepare("SELECT * FROM call_taps WHERE client_id = ?1 AND kind = 'ask' AND asked_at > ?2 ORDER BY asked_at DESC LIMIT 1").bind(cid, since).first().catch(() => null);
  if (!row) return null;
  if ((row.status === 'open' || row.status === 'timeout') && notAnAnswer(body)) return { state: 'reaction', reply: 'Type the answer in words and ' + (maxName || 'Max') + ' tells them.' };
  const text = cleanAnswer(body);
  if (!text) return null;
  const call = await liveCall(env, row.call_id, cid);
  const live = !!call && call.outcome === 'live';
  const waiting = row.status === 'open' || row.status === 'timeout';
  // the call is over and this question already has its answer: an ordinary text
  if (!live && !waiting) return null;
  const name = maxName || 'Max';
  const state = live ? await poke(env, row.call_id, { id: waiting ? row.id : '', text, via: 'text' }) : 'late';
  if (waiting) await record(env, row, text, 'text', 'Owner (text)', state);
  else if (state !== 'late' && state !== 'ringing') await env.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status, answer, answered_at, via, by) VALUES (?1, ?2, ?3, 'tell', '', ?4, 'answered', ?5, ?4, 'text', 'Owner (text)')").bind(tapId(), row.call_id, cid, nowIso(), text).run().catch(() => {});
  else return null;
  return { state, reply: REPLY[state](name, row, call) };
}

// A text to Always Open's own number from an owner's phone: the answer to a question that went out from that number
// (their own texting is not registered yet), or Christopher answering for Always Open's own line.
export async function tapFromOwnerText(env, from10, body, maxName) {
  await ensureTaps(env);
  const since = new Date(Date.now() - TAP_LATE_MS).toISOString();
  // The sender's own businesses only, the one with a question still open first, then the newest (Nov 10: the first 20
  // businesses in no order were tried, so an owner with two could answer the wrong caller, and past 20 nobody matched).
  const rows = (await env.DB.prepare("SELECT client_id, MAX(asked_at) AS last, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM call_taps WHERE kind = 'ask' AND asked_at > ?1 GROUP BY client_id ORDER BY open DESC, last DESC LIMIT 500").bind(since).all().catch(() => ({ results: [] }))).results || [];
  for (const r of rows) {
    const own = await ownerOf(env, r.client_id);
    if (!(own && ph10(own.phone) && ph10(own.phone) === from10)) continue;
    const t = await tapFromText(env, r.client_id, body, maxName);
    if (t) return t;
  }
  return null;
}

// From the app's live card: answer Max's question, tell Max something, or take the call. b: { call, id, text, action }.
export async function tapFromApp(env, c, b) {
  if (c.role === 'tech') return { ok: false, error: 'Ask the owner for this one.' };
  const callId = String((b && b.call) || '');
  if (!/^CA[0-9a-f]{32}$/.test(callId)) return { ok: false, error: 'Bad request' };
  const call = await liveCall(env, callId, c.client_id);
  if (!call) return { ok: false, error: 'That call is gone. Pull down to refresh.' };
  const line = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(c.client_id).first().catch(() => null);
  // the owner's own test call counts as the test it is (Nov 10: the app refused to answer on the rollout's test calls)
  if (!line || +line.regulated || !tapFeature(line, !!+call.test, env) || tapPref(line) === 'off') return { ok: false, error: 'Shoulder Tap is not on for your line.' };
  await ensureTaps(env);
  const by = c.staff || c.whoName || c.owner_first || 'Owner';
  if (b.action === 'take') {
    if (call.outcome !== 'live') return { ok: true, state: 'late', said: 'That call just ended. It is in your calls list.' };
    let state = 'late';
    try { state = await env.CALLROOM.get(env.CALLROOM.idFromName(callId)).tapPut({ by }); } catch (e) { state = 'late'; }
    if (state === 'off') return { ok: false, error: 'Add the number Max should ring on the Max tab first (Put callers through).' };
    if (state !== 'late') await env.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status, answer, answered_at, via, by) VALUES (?1, ?2, ?3, 'take', '', ?4, 'answered', '', ?4, 'app', ?5)").bind(tapId(), callId, c.client_id, nowIso(), by).run().catch(() => {});
    return { ok: true, state, said: state === 'late' ? 'That call just ended. It is in your calls list.' : 'Putting them through to you now. Your phone is about to ring.' };
  }
  const text = cleanAnswer(b.text);
  if (!text) return { ok: false, error: 'Type what Max should tell them.' };
  const id = String(b.id || '');
  const row = /^tp[0-9a-f]{24}$/.test(id) ? await env.DB.prepare('SELECT * FROM call_taps WHERE id = ?1 AND client_id = ?2 AND call_id = ?3').bind(id, c.client_id, callId).first().catch(() => null) : null;
  const waiting = !!row && (row.status === 'open' || row.status === 'timeout');
  const state = call.outcome === 'live' ? await poke(env, callId, { id: waiting ? row.id : '', text, via: 'app' }) : 'late';
  if (waiting) await record(env, row, text, 'app', by, state);
  else if (state !== 'late' && state !== 'ringing') await env.DB.prepare("INSERT INTO call_taps (id, call_id, client_id, kind, q, asked_at, status, answer, answered_at, via, by) VALUES (?1, ?2, ?3, 'tell', '', ?4, 'answered', ?5, ?4, 'app', ?6)").bind(tapId(), callId, c.client_id, nowIso(), text, by).run().catch(() => {});
  const name = 'Max';
  return { ok: true, state, said: REPLY[state](name, row, call) };
}

// The call is over: a question still open was never answered in time.
export async function closeTaps(env, callId) {
  try { await ensureTaps(env); await env.DB.prepare("UPDATE call_taps SET status = 'timeout' WHERE call_id = ?1 AND status = 'open'").bind(callId).run(); } catch (e) { /* a log, never the call */ }
}
export async function markTap(env, id, status) {
  try { await env.DB.prepare('UPDATE call_taps SET status = ?1 WHERE id = ?2 AND status IN (\'open\', \'answered\')').bind(status, id).run(); } catch (e) { /* a log, never the call */ }
}

// For the app: the question out on each live call, and whether this line has Shoulder Tap at all.
export async function tapState(env, line, liveIds) {
  // on for the owner's own test calls too: they see the card and the question on those calls
  const on = !!line && !+line.regulated && tapFeature(line, true, env);
  const out = { on, when: line ? tapPref(line) : 'day', open: {}, month: null };
  // the demo account shows the card with a made-up month (its line never takes a real call, so nothing is ever asked)
  if (line && line.client_id === 'demo-plumbing') return Object.assign(out, { on: true, month: { asked: 9, answered: 8, secs: 21 } });
  if (!on) return out;
  await ensureTaps(env);
  const ids = (liveIds || []).filter(x => /^CA[0-9a-f]{32}$/.test(x)).slice(0, 5);
  if (ids.length) {
    const rows = (await env.DB.prepare("SELECT id, call_id, q, asked_at FROM call_taps WHERE kind = 'ask' AND status = 'open' AND call_id IN (" + ids.map((_, i) => '?' + (i + 1)).join(',') + ') ORDER BY asked_at').bind(...ids).all()).results || [];
    for (const r of rows) { const left = Math.round((Date.parse(r.asked_at) + TAP_WAIT_MS - Date.now()) / 1000); if (left > -20) out.open[r.call_id] = { id: r.id, q: r.q, at: r.asked_at, left: Math.max(0, left) }; }
  }
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = (await env.DB.prepare("SELECT status, asked_at, answered_at FROM call_taps WHERE client_id = ?1 AND kind = 'ask' AND asked_at > ?2 ORDER BY asked_at DESC LIMIT 200").bind(line.client_id, since).all()).results || [];
  const inTime = rows.filter(r => r.status === 'answered' || r.status === 'said');
  const secs = inTime.map(r => Math.round((Date.parse(r.answered_at) - Date.parse(r.asked_at)) / 1000)).filter(x => x >= 0 && x < 600).sort((a, b) => a - b);
  out.month = { asked: rows.length, answered: inTime.length, secs: secs.length ? secs[Math.floor((secs.length - 1) / 2)] : 0 };
  return out;
}

// The owner's answer in plain speech, the way a receptionist passes it on ("He can be there by seven tonight.").
// One quick request; anything slow, odd or long and the owner's own words are said instead (relayLine).
const SAY_SYS = 'You are relaying the owner\'s answer on a live phone call, as the receptionist. The caller asked a question, you checked with the owner by text, and the owner texted back. ' +
  'Write the one or two short spoken sentences the receptionist says to the caller now, starting with a few words that make clear the answer just came from the owner (for example "I just heard back from Mike:"). ' +
  'Say exactly what the owner said and nothing more: no new promise, price, time or detail, no question, no greeting, no thanks. Spell out abbreviations and times the way people say them aloud ("7pm" becomes "seven tonight", "tmrw" becomes "tomorrow", "$89" becomes "eighty-nine dollars"). ' +
  'If the owner\'s text is an instruction to you ("tell her I\'ll call in ten"), turn it into what the caller should hear ("He\'ll call you in ten minutes."). Plain words, no symbols, no quotation marks, 35 words at most. Answer with the spoken words only.';
export function saySystem() { return SAY_SYS; }
// Is the model's wording safe to say? Short, plain, no brackets or lists, and it does not ask the caller anything new.
export function sayOk(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length < 8 || s.length > 260) return '';
  if (/[\[\]{}<>*_#`|\\]|https?:|"\s*:/.test(s)) return '';
  if ((s.match(/[.!?]+(\s|$)/g) || []).length > 3) return '';
  return /[.!?]$/.test(s) ? s : s + '.';
}
export async function tapSay(env, o, f) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const ctl = new AbortController(), timer = setTimeout(() => { try { ctl.abort(); } catch (e) { /* done */ } }, TAP_SAY_MS);
  try {
    const user = 'The owner\'s name: ' + (o.who || '(not on file: say "the owner")') + '\nThe caller asked: ' + (o.q || '(nothing: the owner sent this on their own)') + '\nThe owner texted back: ' + o.text + (o.lang === 'es-US' ? '\nThe call is in Spanish: write the sentences in Spanish.' : '');
    const r = await (f || fetch)('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE } : {}),
      body: JSON.stringify({ model: env.TAP_MODEL || 'claude-haiku-5-5', max_tokens: 120, thinking: { type: 'disabled' }, system: SAY_SYS, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) return '';
    const j = await r.json().catch(() => ({}));
    return sayOk((j.content || []).map(x => x.text || '').join(''));
  } catch (e) { return ''; } finally { clearTimeout(timer); }
}
