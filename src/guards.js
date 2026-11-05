// Guards: checks that run on every sentence Max is about to say, live and in practice calls, before it is spoken.
// A guard only ever removes a sentence; it never adds or rewrites words, so a guard cannot introduce a new mistake.
// (Build Brief 3, Nov 5, 2026: rewording Max's instructions kept trading one mistake for another; v7's notes lost 16-21.)
//
// guardOne(sentence, ctx) -> '' to keep it, or the name of the guard that cut it.
// guardText(text, ctx)    -> { text, cuts } for a whole reply (practice calls); the live call runs guardOne per sentence.
// ctx = { L, msgs, said, urgent, upset, danger, spoken, state, on }
//   msgs    the call so far, the caller's latest turn included, this reply not
//   spoken  what has already gone out in this reply (sentences kept before this one)
//   state   callState(msgs, L)
//   on      the guards switched on (a Set of names; 'all' = every guard)
// A reply is never cut to nothing: if every sentence would go, it is said as written (dead air is worse than a flaw).
import { hardErrors } from './grades.js';

export const GUARDS = ['g-safety', 'g-once', 'g-town', 'g-history', 'g-promise', 'g-short', 'g-ask2', 'g-stock', 'g-sales'];

const lc = x => String(x || '').toLowerCase().replace(/[’‘]/g, "'");
const norm = t => lc(t).replace(/[^a-z0-9'áéíóúñü]+/g, ' ').replace(/\s+/g, ' ').trim();
const isQ = t => /\?["')\]]*\s*$/.test(String(t || '').trim());
const words = t => (String(t || '').match(/[A-Za-zÀ-ÿ0-9']+/g) || []).length;

// "S.I.", "Mr.", "St.", "$1,450.00" stay whole when a reply is split into sentences.
const KEEP = /\b(S\.I\.|A\.I\.|Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Ave\.|Rd\.|No\.)|\d\.\d/g;
export function sentencesOf(text) {
  const t = String(text || '').replace(KEEP, m => m.replace(/\./g, '\u0001'));
  return (t.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || []).map(x => x.replace(/\u0001/g, '.')).filter(x => x.length);
}

// What a question asks for, by detail.
const ASK = {
  name: /\b(your name|the name|who am i (talking|speaking) (to|with)|what should i call you|who('s| is) calling|su nombre|tu nombre|c[oó]mo se llama|a nombre de qui[eé]n)\b|^\s*(and )?(the )?name\b/i,
  number: /\b(number|phone|reach you|call you back on|n[uú]mero|tel[eé]fono)\b/i,
  address: /\b(address|street|direcci[oó]n|calle)\b/i,
  town: /\b(town|city|pueblo|ciudad)\b/i,
  time: /\b(what time|when (works|would|is good|is best)|which day|what day|morning or afternoon|qu[eé] hora|qu[eé] d[ií]a)\b/i
};
export function asksFor(sentence) {
  if (!isQ(sentence)) return [];
  return Object.keys(ASK).filter(k => ASK[k].test(sentence));
}
// A safety step: something to do (or not do) this minute to stay safe or stop damage.
export const SAFETY = /\b(shut|turn) (it |that |the water |the gas |the main )?(off|the (main|valve|water|cold))\b|\bvalves?\b|\bstay (out|back|away|off|clear|outside)\b|\bkeep (clear|away|back|the baby|everyone|the kids)\b|\b911\b|\bdon'?t (touch|step|go (back )?in|unplug|flush|run)\b|\bget (out|outside|everyone out|away)\b|\bbreakers?\b|\bsmell (gas|burning)\b|\bwarmest room\b|\bcierre\b|\bv[aá]lvula\b|\bal[eé]je(se|nse)\b|\bsalga(n)?\b|\bno (toque|pise|entre)\b/i;
// The owner's past-service question ("when did you last have work done, and who did it?").
const HISTORY = /\b(last (had|have|time|did)|who did (it|the work|that)|been in with us( before)?|work done (on|before|there)|previous (plumber|company|work|visit)|had (it|that|this) (serviced|looked at) before|have you (used|called) us before|ha venido (antes|con nosotros)|qui[eé]n (lo|la) hizo)\b/i;
// Towns around the lines Max answers (Lake Oconee / Lake Sinclair). Any of these named in a question the caller never
// said is a leading guess.
const AREA_TOWNS = ['Eatonton', 'Milledgeville', 'Madison', 'Greensboro', 'Gray', 'Macon', 'Sparta', 'Monticello', 'Putnam', 'Baldwin', 'Lake Oconee', 'Lake Sinclair', 'Reynolds Plantation', 'Covington', 'Athens', 'Atlanta', 'Warner Robins', 'Haddock', 'Shady Dale', 'Crawfordville', 'Siloam', 'White Plains', 'Buckhead', 'Rutledge'];

// What the call has established so far, read from the messages, so live calls and practice calls agree (Brief 3, Part 3).
export function callState(msgs, L, helpers) {
  L = L || {};
  const h = helpers || {};
  const asked = { name: 0, number: 0, address: 0, town: 0, time: 0 };
  const saidNorm = new Set(), saidCount = new Map();
  const us = [];
  let lastAsked = [];
  for (const m of (msgs || [])) {
    if (m.r === 'u') { us.push(lc(m.t)); continue; }
    lastAsked = [];
    for (const s of sentencesOf(m.t)) { const n = norm(s); saidNorm.add(n); saidCount.set(n, (saidCount.get(n) || 0) + 1); for (const k of asksFor(s)) { asked[k]++; lastAsked.push(k); } }
  }
  const all = us.join(' ');
  const have = {
    number: us.some(x => (h.phone && h.phone(x)) || (h.sameNum && h.sameNum.test(x))),
    town: placesIn(L).some(t => all.includes(lc(t))),
    address: !!(h.street && us.some(x => h.street.test(x)))
  };
  return { asked, have, saidNorm, saidCount, lastAsked: [...new Set(lastAsked)], safetyGiven: (msgs || []).some(m => m.r === 'a' && SAFETY.test(String(m.t || ''))) };
}
function placesIn(L) {
  const own = String(L.town || '').split(/,\s*/)[0];
  const area = (String(L.area || '').match(/[A-Z][a-z]+(?: [A-Z][a-z]+)?/g) || []);
  return [...new Set([own, ...area, ...AREA_TOWNS].filter(Boolean))];
}

const ON = (ctx, k) => !!(ctx.on && (ctx.on.has('all') || ctx.on.has(k)));

// ---- the six guards ----
// 1. A name, number or address ask in the same reply as a safety step (it comes next turn instead).
// Once they say they're safe or the step is done ("we're outside", "I'm not there", "ya cerré la llave"), a reminder like
// "Good, stay out there." no longer holds the name back (Nov 5: the smoke call never got a name), and it only applies in
// the first three caller turns, so details always get taken.
const SAFE_NOW = /\b(we'?re|i'?m|everyone'?s|we are|i am|they'?re) (all )?(out|outside|out of the (house|building|boat)|not (there|home|on it|near it|in there))\b|\bnot there\b|\b(it'?s|it is|water'?s|water is|gas is|power is|valve is) (off|shut|closed)\b|\b(turned|shut|closed|switched) (it|that|the (water|valve|main|gas|breaker))( off)?\b|\b(yes|yeah|yep|ok|okay),? (it'?s|i did|done|off)\b|\bya (cerr|apagu|sal)\w*|\b(estamos|estoy) (afuera|fuera)\b|\bafuera\b/i;
function safetyThenAsk(s, ctx) {
  const a = asksFor(s);
  if (!a.some(k => k === 'name' || k === 'number' || k === 'address' || k === 'town')) return false;
  if (!(ctx.urgent || ctx.danger) || !SAFETY.test(ctx.spoken || '')) return false;
  if (SAFE_NOW.test(String(ctx.said || ''))) return false;
  return (ctx.msgs || []).filter(m => m.r === 'u').length <= 3;
}
// 2. The same ask again: word for word, a third time for the same detail, or for a detail the caller already gave.
function askOnce(s, ctx) {
  const a = asksFor(s);
  if (!a.length) return false;
  const st = ctx.state || { asked: {}, have: {}, saidCount: new Map() };
  // a read-back ("four seven eight, five five five ... right?") is a check, not a new ask
  if (/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d)\b(,? +\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d)\b){2,}/i.test(s)) return false;
  // an ask only about a detail they already gave ("is this the best number?" after "same number")
  if (a.every(k => st.have[k])) return true;
  // the same ask, word for word, a third time
  return (st.saidCount.get(norm(s)) || 0) >= 2;
}
// 7a (Brief 3, Part 7). Asking more than a person would: the number is worth one ask (caller ID already has it), no
//    detail is asked two turns running, the name at most twice, and "I still need ..." is never said.
const STILL = /\b(i still need|i still don'?t have|still need (your|the|a)|i'?m still missing|todav[ií]a no tengo|todav[ií]a necesito|me falta (su|tu|el|la))\b/i;
const DIGITS = /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d)\b(,? +\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d)\b){2,}/i;
function askLess(s, ctx) {
  if (STILL.test(s)) return true;
  const a = asksFor(s);
  if (!a.length || DIGITS.test(s)) return false;
  const st = ctx.state || { asked: {}, have: {}, lastAsked: [] };
  const callerId = ctx.callerId !== false;
  const blocked = k => st.have[k] || (st.lastAsked || []).includes(k) || (k === 'number' && callerId && (st.asked.number || 0) >= 1) || (k === 'name' && (st.asked.name || 0) >= 2);
  return a.every(blocked);
}
// 7c-3 (Brief 3, Part 7). Stock lines: a statement that says again what Max already said this call ("The owner knows it's
//    urgent and will call you as soon as he can" three times), and the filler "while I've got you". Safety steps,
//    questions and read-backs are never cut here. (Mining phrases across calls was skipped on purpose: "Katie calls back
//    within one business day" is on most calls, and every caller still needs to hear it once.)
const toks = t => new Set(norm(t).split(' ').filter(w => w.length > 2));
function sameAs(a, b) { const x = toks(a), y = toks(b); if (x.size < 5 || y.size < 5) return false; let n = 0; for (const w of x) if (y.has(w)) n++; return n / (x.size + y.size - n) >= 0.6; }
function noStock(s, ctx) {
  if (/\bwhile i'?ve got you\b|\bmientras le tengo\b/i.test(s)) return true;
  if (isQ(s) || SAFETY.test(s) || DIGITS.test(s)) return false;
  const before = (ctx.msgs || []).filter(m => m.r === 'a').slice(1).flatMap(m => sentencesOf(m.t));   // the greeting is not counted
  return before.concat(sentencesOf(ctx.spoken || '')).some(b => sameAs(s, b));
}
// 7b (Brief 3, Part 7). Always Open's own line runs long because its facts invite a pitch. Cut by shape, not by count:
//    from the third sentence of a reply, a statement stays only if it answers what the caller asked (shares words with
//    their turn) or carries something they need (a price, the booking page, Katie, S.I., refund, contract, cancel,
//    transcripts, texting, the audit, a business day). Questions and safety steps always stay.
const SALES_KEEP = /\$|\b(\d+|dollars?|price|cost|month|day|plan|starter|growth|pro|booking|book|katie|s\.i\.|refund\w*|contract|cancel\w*|transcripts?|record\w*|audio|13 months|text\w*|carriers?|approve\w*|audit|business day|privacy|patient|month to month|no setup)\b/i;
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'what', 'can', 'are', 'how', 'just', 'like', 'okay', 'have', 'does', 'did', 'about', 'there', 'they', 'them', 'its', "it's", 'would', 'will', 'from', 'get', 'got']);
function salesShape(s, ctx) {
  if (!ctx.L || !ctx.L.own) return false;
  if (isQ(s) || SAFETY.test(s)) return false;
  if (sentencesOf(ctx.spoken || '').length < 2) return false;
  if (SALES_KEEP.test(s)) return false;
  const asked = new Set(norm(ctx.said).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
  return !norm(s).split(' ').some(w => asked.has(w));
}
// 3. A question that names a town the caller never said ("Are you in Milledgeville?", "Is that in Eatonton?").
function noLeadingTown(s, ctx) {
  if (!isQ(s)) return false;
  const said = (ctx.msgs || []).filter(m => m.r === 'u').map(m => lc(m.t)).join(' ');
  for (const t of placesIn(ctx.L || {})) if (new RegExp('\\b' + t.replace(/ /g, '\\s+') + '\\b').test(s) && !said.includes(lc(t))) return true;
  // "Which town is Gray in?": the place they named is the town
  const w = /\b([Ww]hich|[Ww]hat) (town|city) is ([A-Z][a-z]+)\b/.exec(s);
  if (w && said.includes(lc(w[3])) && placesIn(ctx.L || {}).some(t => lc(t) === lc(w[3]))) return true;
  return false;
}
// 4. The past-service question on an emergency, with an upset caller, at the goodbye, or on a regulated line.
function noHistoryQ(s, ctx) {
  if (!isQ(s) || !HISTORY.test(s)) return false;
  // once Max has given a safety step this call, it is an emergency, whatever the detector said (Nov 5: 'water is coming
  // through my ceiling' was not flagged urgent)
  return !!(ctx.urgent || ctx.upset || ctx.danger || ctx.wrap || (ctx.state && ctx.state.safetyGiven) || (ctx.L && ctx.L.regulated));
}
// 5. Anything the hard-error scanner would flag: a promise, a price, a booking, an invented name, town or record,
//    advice on a regulated line, reassurance he can't give. The scanner's allowances (the caller's own words, the line's
//    own promise and prices) apply because it reads the whole call.
const PROMISE_FLAGS = new Set(['human', 'ai-word', 'time-promise', 'price', 'booked', 'invented-name', 'assumed-place', 'invented-record', 'regulated-advice', 'reassure', 'digit-short']);
function noPromise(s, ctx) {
  const hits = hardErrors((ctx.msgs || []).concat({ r: 'a', t: (ctx.spoken ? ctx.spoken + ' ' : '') + s }), ctx.L || {});
  const w = lc(s);
  return hits.some(x => PROMISE_FLAGS.has(x.flag) && w.includes(lc(x.quote).replace(/ \(\d+\)$/, '')));
}
// 6. Past the length a person would say in one breath: three sentences on an urgent call, five otherwise, or about 40
//    words. A question (always last) and a safety step are never cut.
function shortReply(s, ctx) {
  if (isQ(s) || SAFETY.test(s)) return false;
  const before = sentencesOf(ctx.spoken || '').length, w = words(ctx.spoken || '');
  if (!before) return false;
  return before >= ((ctx.urgent || ctx.danger) ? 3 : 5) || w + words(s) > 40;
}

const ORDER = [['g-safety', safetyThenAsk], ['g-once', askOnce], ['g-ask2', askLess], ['g-stock', noStock], ['g-sales', salesShape], ['g-town', noLeadingTown], ['g-history', noHistoryQ], ['g-promise', noPromise], ['g-short', shortReply]];

export function guardOne(sentence, ctx) {
  // a control tag on its own ([END], [TRANSFER], [BOOK ...]) is never cut: the phone line acts on it
  if (!/[a-z0-9]/i.test(String(sentence || '').replace(/\[[^\]]*\]?/g, ''))) return '';
  for (const [k, f] of ORDER) if (ON(ctx, k) && f(sentence, ctx)) return k;
  return '';
}

// A whole reply (practice calls): the same per-sentence decisions the live call makes as the words stream in.
export function guardText(text, ctx) {
  const parts = sentencesOf(text);
  if (!parts.length) return { text, cuts: [] };
  let spoken = '';
  const keep = [], cuts = [];
  for (const p of parts) {
    const g = guardOne(p, Object.assign({}, ctx, { spoken }));
    if (g) { cuts.push({ guard: g, text: p.trim().slice(0, 120) }); continue; }
    keep.push(p); spoken += p;
  }
  if (!keep.some(x => /[a-z0-9]/i.test(x.replace(/\[[^\]]*\]?/g, '')))) return { text, cuts: cuts.length ? [{ guard: 'kept-all', text: '' }] : [] };
  return { text: keep.join(''), cuts };
}

// The switches on for this line: features named in GUARDS, or every guard once they ship ('all').
export function guardsOn(L, live) {
  const f = Array.isArray(L && L.features) ? L.features : [];
  const on = new Set(f.filter(k => GUARDS.includes(k)));
  for (const k of (live || [])) on.add(k);
  return on;
}
