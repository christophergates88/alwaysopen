// Max's job description: what the owner lets Max do on a call, in plain switches on the Max tab ("Job description").
// The choices live in the line's owner_set.duties (same column as the owner's other Max settings, so HQ never
// overwrites them). dutyLines() turns them into short rules for Max's instructions; voice.js adds them to the prompt.
// Booking, call-backs and the calls Max makes keep their own switches (Booking and After the call tabs); the job
// description only covers what Max may say and offer while he is on the phone.
//
// tellMax(): the owner texts the business line ("closed Friday", "no jobs in Macon") or types it in the app, and it
// goes straight into "What should Max tell callers?", dated, so Max knows it on the next call.

export const DUTIES = [
  { key: 'allDay', label: 'Answer during business hours too', sub: 'When you can’t get to the phone during the day, he picks up instead of letting it ring out.', def: false },
  { key: 'prices', label: 'Give your standard prices', sub: 'Only the prices you list below. For anything else he says you’ll quote it.', def: false, text: 'priceList', textLabel: 'Your standard prices', textHint: 'Service call $89. Water heater flush $149.' },
  { key: 'pastService', label: 'Ask about past service', sub: 'When they last had work done, and who did it, so you walk in knowing.', def: true },
  { key: 'plans', label: 'Mention your service plan', sub: 'A short line about your maintenance plan or membership, once, when it fits.', def: false, text: 'planText', textLabel: 'Your service plan, in a sentence', textHint: 'Two tune-ups a year and 10% off repairs for $15 a month.' },
  { key: 'payments', label: 'Tell callers how you take payment', sub: 'Cards, cash, financing: whatever you write below.', def: false, text: 'payText', textLabel: 'How you take payment', textHint: 'Card, cash or check. Financing on jobs over $1,000.' },
  { key: 'areaOnly', label: 'Turn away work outside your area', sub: 'Politely, using the area you serve on the Teach tab. Off: he takes the message and you decide.', def: false }
];
const KEYS = new Set(DUTIES.map(d => d.key));
const TEXT_KEYS = new Set(DUTIES.filter(d => d.text).map(d => d.text));

function parse(s) { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } }
const one = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/[\[\]<>{}]/g, '').replace(/\s{2,}/g, ' ').trim();

// The saved choices with defaults filled in. Accepts the duties object itself or a voice_lines row (owner_set).
export function dutiesOf(x) {
  const src = x && typeof x === 'object' && 'owner_set' in x ? parse(x.owner_set).duties : x;
  const d = src && typeof src === 'object' ? src : {};
  const out = {};
  for (const k of DUTIES) {
    out[k.key] = typeof d[k.key] === 'boolean' ? d[k.key] : k.def;
    if (k.text) out[k.text] = one(d[k.text]).slice(0, 400);
  }
  return out;
}

// What the app sends: only known keys, booleans and short text.
export function cleanDuties(b, prev) {
  const out = dutiesOf(prev || {});
  if (!b || typeof b !== 'object') return out;
  for (const k of Object.keys(b)) {
    if (KEYS.has(k) && typeof b[k] === 'boolean') out[k] = b[k];
    else if (TEXT_KEYS.has(k) && typeof b[k] === 'string') out[k] = one(b[k]).slice(0, 400);
  }
  return out;
}

// Plain rules for Max's instructions, one per line. Always returns the rules for every duty, on or off, so Max never
// guesses (a price he wasn't given is never said).
// Nov 5: the tighter past-service wording is tested behind the v7 switch before it reaches real callers.
let PAST_SERVICE_V7 = false;
export function dutyLines(x, opts) {
  PAST_SERVICE_V7 = !!(opts && opts.v7);
  const d = dutiesOf(x), out = [];
  out.push(d.allDay ? 'You answer during business hours too, whenever the owner can’t get to the phone. Treat those callers exactly the same.' : 'You mostly answer when the business is closed. If someone calls during open hours, help them the same way.');
  if (d.prices && d.priceList) out.push('You may give these standard prices, exactly as written, and no others: ' + d.priceList + '. For anything not on this list, say the owner will quote it.');
  else out.push('Never give a price or a price range. Say the owner will quote it after hearing about the job.');
  if (d.pastService) out.push(PAST_SERVICE_V7 ? 'Once, mid-call on a routine job, ask when they last had this kind of work done and who did it. Put it in your note. Skip it on an emergency, with an upset caller, or once they are wrapping up.' : 'Once, when it fits, ask when they last had this kind of work done and who did it. Put it in your note.');
  if (d.plans && d.planText) out.push('Once, near the end and only if it fits, mention the service plan in one sentence: ' + d.planText + ' Never push it.');
  if (d.payments && d.payText) out.push('If asked how they can pay: ' + d.payText);
  else out.push('If asked how they can pay, say the owner will go over that with them.');
  out.push(d.areaOnly ? 'If the job is clearly outside the area the business serves, politely say it is outside the service area and thank them. Do not take a booking for it.' : 'If the job might be outside the service area, take the message anyway and say the owner will let them know.');
  return out;
}

// For the app's Job description card: the switches with their current values.
export function dutiesOut(line) {
  const d = dutiesOf(line);
  return { values: d, list: DUTIES.map(k => ({ key: k.key, label: k.label, sub: k.sub, text: k.text || '', textLabel: k.textLabel || '', textHint: k.textHint || '' })) };
}

// One-line summary of what changed, for the owner's change log and Chris's ping.
export function dutyChanges(a, b) {
  const x = dutiesOf(a), y = dutiesOf(b), out = [];
  for (const k of DUTIES) {
    if (x[k.key] !== y[k.key]) out.push((y[k.key] ? 'Max now: ' : 'Max no longer: ') + k.label.toLowerCase());
    if (k.text && x[k.text] !== y[k.text]) out.push(k.textLabel.toLowerCase() + ': ' + (y[k.text] ? y[k.text].slice(0, 120) : '(cleared)'));
  }
  return out;
}

// ---------- telling Max something ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const OWNER_MAX = 800;   // the "What should Max tell callers?" box (app.js keeps it to 800 too)

// Pure: add a dated note to the owner's text for Max, dropping the oldest dated notes first when it gets long.
export function addNote(cur, note, at) {
  const d = new Date(at || Date.now());
  const n = one(note).replace(/[.!\s]+$/, '').slice(0, 280);
  if (!n) return String(cur || '');
  const stamp = '(' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ') ' + n.charAt(0).toUpperCase() + n.slice(1) + '.';
  let base = String(cur || '').trim();
  let out = base ? base + ' ' + stamp : stamp;
  // Over the limit: take out the oldest dated notes (never the owner's own undated text).
  while (out.length > OWNER_MAX) {
    const m = base.match(/\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\) [^()]*?(?=\s*\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\) |\s*$)/);
    if (!m) { out = out.slice(out.length - OWNER_MAX); break; }
    base = (base.slice(0, m.index) + base.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
    out = base ? base + ' ' + stamp : stamp;
  }
  return out;
}
// Pure: take the last dated note back out ("UNDO").
export function dropLastNote(cur) {
  const s = String(cur || '');
  const re = /\s*\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\) [^()]*?\.\s*$/;
  return re.test(s) ? s.replace(re, '').trim() : null;
}
// Is this text an instruction for Max (from the owner's own phone)? Short, not a carrier keyword, not a question to a customer.
export function looksLikeNote(body) {
  const t = one(body);
  return t.length >= 3 && t.length <= 280;
}

// Save a note for every line the business has. Returns { ok, text, undone? }.
export async function tellMax(env, cid, body, by) {
  const t = one(body);
  const undo = /^undo$/i.test(t);
  if (!undo && !looksLikeNote(t)) return { ok: false, error: 'Keep it to a sentence or two.' };
  const lines = ((await env.DB.prepare('SELECT number, owner_set, facts FROM voice_lines WHERE client_id = ?1').bind(cid).all()).results) || [];
  if (!lines.length) return { ok: false, error: 'There is no phone line yet.' };
  const now = new Date().toISOString();
  let undone = false;
  for (const ln of lines) {
    const o = parse(ln.owner_set);
    const hq = parse(ln.facts);
    const cur = typeof o.owner === 'string' ? o.owner : String(hq.owner || '');
    let next;
    if (undo) { next = dropLastNote(cur); if (next == null) continue; undone = true; }
    else next = addNote(cur, t, now);
    o.owner = next; o.at = now; o.by = by || 'Owner';
    await env.DB.prepare('UPDATE voice_lines SET owner_set = ?1 WHERE number = ?2 AND client_id = ?3').bind(JSON.stringify(o), ln.number, cid).run();
  }
  try { await env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'line-edit', ?2)").bind(now, JSON.stringify({ cid, by: by || 'Owner', changes: [undo ? 'took back the last note for Max' : 'told Max: ' + t.slice(0, 200)] })).run(); } catch (e) { /* the note is saved either way */ }
  if (undo) return undone ? { ok: true, undone: true, text: 'Done. Max forgot the last thing you told him.' } : { ok: true, undone: false, text: 'Nothing to take back.' };
  return { ok: true, text: 'Got it. Max knows: ' + t.replace(/[.!\s]+$/, '') + '. Text UNDO to take it back.' };
}
