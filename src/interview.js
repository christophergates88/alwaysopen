// Max learns the business by asking the owner. Two ways in, same result:
//  - "Have Max call me": Max phones the owner and asks the questions below, one at a time (a normal CallRoom call in
//    interview mode). What he heard is written up as facts and waits in the app until the owner taps "Looks right".
//  - "Type it in": the same questions as fields on the Max tab; what the owner types is used right away.
// Facts live in the line's owner_set (owner_set.facts), over HQ's own facts, and Max's instructions read them (voice.js lineView).

export const FACTS = [
  { key: 'services', label: 'What you do, and what you don’t', ask: 'What kind of work do you do, and is there anything you don’t do?', hint: 'For example: repairs, water heaters, drain cleaning. We don’t do septic or wells.', max: 600 },
  { key: 'area', label: 'Where you work', ask: 'Which towns do you cover, and how far out do you go?', hint: 'For example: Eatonton, Milledgeville and Madison, about 30 miles out.', max: 300 },
  { key: 'prices', label: 'Prices Max can share', ask: 'Any prices you’re happy for me to give callers, like a service-call fee or a starting price?', hint: 'For example: $89 service call, waived if we do the work. Leave blank and Max says the team will quote.', max: 400 },
  { key: 'urgent', label: 'What counts as urgent', ask: 'What counts as an emergency for you, something you’d want to hear about right away?', hint: 'For example: water leaking now, no heat, a gas smell.', max: 300 },
  { key: 'next', label: 'What happens after a call', ask: 'When someone calls, what should I tell them happens next?', hint: 'For example: Sam calls back within the hour during the day.', max: 300 },
  { key: 'booking', label: 'How booking works', ask: 'Do you want me to offer open times and book them, or take the time they want and have you confirm?', hint: 'For example: book them; jobs take about two hours.', max: 300 },
  { key: 'intake', label: 'What Max asks every caller', ask: 'Besides their name and number, what should I ask every caller?', hint: 'For example: the address, and whether the water is shut off.', max: 300 },
  { key: 'website', label: 'Your website', hint: 'example.com', max: 120 },
  { key: 'address', label: 'An address callers can visit', hint: 'Leave blank if customers don’t come to you.', max: 160 }
];
export const FACT_KEYS = FACTS.map(f => f.key);
const ASKED = FACTS.filter(f => f.ask);
const DAY = 864e5;
const PER_DAY = 3;
const oneLine = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const cleanFact = (v, max) => oneLine(v).replace(/[\[\]<>{}]/g, '').slice(0, max);
const parse = s => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };

const ready = new WeakSet();
export async function ensureInterviews(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS line_interviews (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, number TEXT NOT NULL, phone TEXT NOT NULL, sid TEXT DEFAULT '', status TEXT DEFAULT 'calling', created TEXT, updated TEXT, result TEXT DEFAULT '')").run();
  ready.add(env.DB);
}

// Clean what the owner typed (or what the interview heard) into fact values. Unknown keys are dropped.
export function cleanFacts(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const f of FACTS) if (obj[f.key] != null) out[f.key] = cleanFact(obj[f.key], f.max);
  return out;
}

// For the app: each fact with its question, what Max uses now, and anything the interview heard that waits for the owner.
export function knowOut(rawFacts, ownerSet) {
  const f = parse(rawFacts), o = typeof ownerSet === 'string' ? parse(ownerSet) : (ownerSet || {});
  const mine = o.facts && typeof o.facts === 'object' ? o.facts : {};
  const pend = o.pending && o.pending.facts ? o.pending.facts : null;
  return {
    know: FACTS.map(x => ({ key: x.key, label: x.label, hint: x.hint, value: typeof mine[x.key] === 'string' ? mine[x.key] : oneLine(f[x.key] || '').slice(0, x.max) })),
    pending: pend ? { at: o.pending.at || '', items: FACTS.filter(x => pend[x.key]).map(x => ({ key: x.key, label: x.label, value: pend[x.key] })) } : null,
    knows: !!((typeof mine.services === 'string' ? mine.services : f.services) && (typeof mine.area === 'string' ? mine.area : f.area))
  };
}

// ---------- the call ----------
export async function startInterview(env, c, line, phone, dialOut, key) {
  await ensureInterviews(env);
  const d = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return { ok: false, error: 'Add the 10-digit number Max should call.' };
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM line_interviews WHERE client_id = ?1 AND created > ?2').bind(c.client_id, new Date(Date.now() - DAY).toISOString()).first();
  if (n && +n.n >= PER_DAY) return { ok: false, error: 'Max has called three times today. Try again tomorrow, or type the answers in below.' };
  const at = new Date().toISOString();
  const r = await env.DB.prepare("INSERT INTO line_interviews (client_id, number, phone, status, created, updated) VALUES (?1, ?2, ?3, 'calling', ?4, ?4)").bind(c.client_id, line.number, '+1' + d, at).run();
  const id = r.meta.last_row_id;
  const call = await dialOut(env, { number: line.number }, '+1' + d, '/voice/iv/' + key + '?i=' + id, '/voice/ivstatus/' + key + '?i=' + id);
  await env.DB.prepare('UPDATE line_interviews SET sid = ?1, status = ?2, result = ?3, updated = ?4 WHERE id = ?5')
    .bind(call.ok ? call.sid : '', call.ok ? 'calling' : 'failed', call.ok ? '' : String(call.why || '').slice(0, 200), new Date().toISOString(), id).run();
  return call.ok ? { ok: true, id, message: 'Max is calling you now. It takes about three minutes.' } : { ok: false, error: 'Max could not place the call. Try again in a minute, or type the answers in below.' };
}

export async function interviewFor(env, sid) {
  try { await ensureInterviews(env); return await env.DB.prepare('SELECT * FROM line_interviews WHERE sid = ?1').bind(sid).first(); } catch (e) { return null; }
}
export async function interviewById(env, id) {
  try { await ensureInterviews(env); return await env.DB.prepare('SELECT * FROM line_interviews WHERE id = ?1').bind(+id || 0).first(); } catch (e) { return null; }
}

export function interviewGreeting(L) {
  return 'Hi, it’s ' + (L.name || 'Max') + ', the phone assistant for ' + (L.business || 'your business') + '. I’m an S.I., and this call may be recorded. ' +
    'I have a few quick questions so I can answer your callers better. First, what kind of work do you do, and is there anything you don’t do?';
}

export function interviewPrompt(L, wrapUp) {
  const qs = ASKED.slice(1).map((f, i) => (i + 2) + '. ' + f.ask).join('\n');
  return [
    'You are ' + (L.name || 'Max') + ', the AI phone assistant for ' + L.business + '. You are on the phone with the owner, who asked you to call so you can learn about the business. You are not taking a customer call.',
    'They have already heard: "' + interviewGreeting(L) + '" Do not repeat it.',
    '',
    'How you talk: plain, warm and even, like a capable new hire on their first day. One short sentence, then the question. Never more than about 25 words a turn. No lists, no formatting, no exclamation marks.',
    '',
    'Ask these, one at a time, in this order. Skip any they already answered. If an answer is vague, ask one short follow-up, then move on. Never ask the same thing twice.',
    '1. ' + ASKED[0].ask,
    qs,
    L.regulated ? '' : (ASKED.length + 1) + '. Do you want me to speak Spanish with callers who speak Spanish?',
    '',
    'After the last question, say in one sentence that you will send what you heard to their app so they can check it before you use it, thank them, say goodbye, and end that reply with [END].',
    'If they want to stop early, say you will send what you have, thank them, and end with [END].',
    'Never promise anything about their customers, prices or schedule. Never ask for passwords, card numbers or personal details.',
    'Controls (never say these out loud): end your final reply with [END].',
    wrapUp ? '\nThe call is running long. Thank them, say you will send what you have, and end with [END].' : ''
  ].filter(x => x !== '').join('\n');
}

// After the call: turn what the owner said into facts that wait for their OK.
export async function interviewWriteUp(env, call, msgs, line, brain, push) {
  const row = await interviewFor(env, call.id);
  const said = (msgs || []).filter(x => x.r === 'u').length;
  if (!row) return false;
  if (!said) {
    await env.DB.prepare("UPDATE line_interviews SET status = 'no answers', updated = ?1 WHERE id = ?2").bind(new Date().toISOString(), row.id).run();
    return true;
  }
  const text = msgs.map(x => (x.r === 'u' ? 'Owner: ' : 'Assistant: ') + x.t).join('\n').slice(0, 14000);
  const sys = 'From this phone interview of a small business owner, write what their AI receptionist should know. Answer with JSON only, with exactly these keys, each a short plain statement in the owner’s own terms, or "" if they did not say: ' +
    FACTS.map(f => '"' + f.key + '" (' + f.label.toLowerCase() + ')').join(', ') + ', "spanish" (true, false, or null if not discussed), "book" ("book" if they want the assistant to book open times, "hold" if they want to confirm times themselves, or ""), ' +
    '"slot_minutes" (how long a typical visit takes, in minutes, or 0). Write facts, not instructions, in third person about the business ("We do repairs and water heaters. We don’t do septic."). Never include anything about specific customers.';
  let j = null;
  try { const r = await brain(env, sys, [{ role: 'user', content: 'The interview:\n' + text }], null, 700); j = parseJson(r.text); } catch (e) { j = null; }
  const facts = cleanFacts(j || {});
  for (const k of Object.keys(facts)) if (!facts[k]) delete facts[k];
  const pending = { facts, at: new Date().toISOString(), sid: call.id };
  if (j && typeof j.spanish === 'boolean') pending.spanish = j.spanish;
  if (j && (j.book === 'book' || j.book === 'hold')) pending.book = j.book;
  if (j && +j.slot_minutes >= 15 && +j.slot_minutes <= 480) pending.slotMin = Math.round(+j.slot_minutes);
  const raw = await env.DB.prepare('SELECT owner_set FROM voice_lines WHERE number = ?1').bind(row.number).first();
  const o = parse(raw && raw.owner_set);
  o.pending = pending;
  await env.DB.prepare('UPDATE voice_lines SET owner_set = ?1 WHERE number = ?2').bind(JSON.stringify(o), row.number).run();
  await env.DB.prepare("UPDATE line_interviews SET status = 'done', result = ?1, updated = ?2 WHERE id = ?3").bind(JSON.stringify(pending).slice(0, 4000), new Date().toISOString(), row.id).run();
  const n = Object.keys(facts).length;
  if (push) await push(env, call.client_id, { aps: { alert: { title: lineName(line) + ' learned about your business', body: n ? 'Check what ' + lineName(line) + ' heard on the Max tab, then tap Looks right. Nothing changes until you do.' : lineName(line) + ' did not catch enough. Try again, or type the answers in on the Max tab.' }, sound: 'default' }, screen: 'max' }).catch(() => {});
  return true;
}

// The owner's call to the interview: pending facts go live (merged over what they had), or are thrown away.
export function applyPending(o, keep) {
  const p = o && o.pending;
  if (!p) return { o, changes: [] };
  const changes = [];
  if (keep) {
    o.facts = Object.assign({}, o.facts || {}, p.facts || {});
    for (const k of Object.keys(p.facts || {})) changes.push(k + ': ' + p.facts[k].slice(0, 80));
    if (typeof p.spanish === 'boolean') { o.spanish = p.spanish; changes.push(p.spanish ? 'answers Spanish-speaking callers in Spanish' : 'English only'); }
    if (p.book) { o.book = Object.assign({}, o.book || {}, { mode: p.book }, p.slotMin ? { slotMin: p.slotMin } : {}); changes.push('booking: ' + (p.book === 'book' ? 'Max books open times' : 'Max takes a time for you to confirm')); }
  } else changes.push('discarded what the interview heard');
  delete o.pending;
  return { o, changes };
}

function lineName(line) { try { return oneLine(String(parse(line.facts).name || '')).replace(/[^A-Za-z .'-]/g, '').slice(0, 30) || 'Max'; } catch (e) { return 'Max'; } }
function parseJson(t) {
  const s = String(t || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}
