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

export const GUARDS = ['g-safety', 'g-once', 'g-town', 'g-history', 'g-promise', 'g-short', 'g-ask2', 'g-stock', 'g-sales', 'g-audit', 'g-canned', 'g-callback', 'g-closer', 'g-ask3'];

const lc = x => String(x || '').toLowerCase().replace(/[’‘]/g, "'");
const norm = t => lc(t).replace(/[^a-z0-9'áéíóúñü]+/g, ' ').replace(/\s+/g, ' ').trim();
const isQ = t => /\?["')\]]*\s*$/.test(String(t || '').trim());
const words = t => (String(t || '').match(/[A-Za-zÀ-ÿ0-9']+/g) || []).length;

// "S.I.", "Mr.", "St.", "$1,450.00" stay whole when a reply is split into sentences.
// a.m., p.m. and the rest never end a sentence, the same as the live call's splitter (voice.js ABBR): "at seven p.m. gets a
// live answer" was split in two on a Nov 6 practice run and the second half cut.
const KEEP = /\b(S\.I\.|A\.I\.|Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Ave\.|Rd\.|No\.|Jr\.|Sr\.|a\.m\.|p\.m\.|vs\.|etc\.|e\.g\.|i\.e\.)|\d\.\d/g;
// A control tag ([ASK: can he come tonight?], [BOOK 2 | Dana | no hot water.]) is one piece, whatever punctuation it
// carries: its marks are hidden while a reply is split into sentences and put back after.
export const tagHide = t => String(t || '').replace(/\[[^\]]*\]/g, m => m.replace(/[.!?]/g, c => c === '.' ? '\u0001' : c === '?' ? '\u0002' : '\u0003'));
export const tagShow = t => String(t || '').replace(/\u0001/g, '.').replace(/\u0002/g, '?').replace(/\u0003/g, '!');
export function sentencesOf(text) {
  const t = tagHide(text).replace(KEEP, m => m.replace(/\./g, '\u0001'));
  // a sentence ends where the live call ends one: end punctuation followed by a space or the end, so
  // "alwaysopenoffice.com" stays whole (the old split cut it into "alwaysopenoffice." and "com ...", Nov 5)
  const out = [], re = /[.!?]+["')\]]*(?:\s+|$)/g;
  let last = 0, m;
  while ((m = re.exec(t))) { if (!m[0].length) { re.lastIndex++; continue; } out.push(t.slice(last, m.index + m[0].length)); last = m.index + m[0].length; }
  if (last < t.length) out.push(t.slice(last));
  return out.map(tagShow).filter(x => x.length);
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
// Narrowed after the first run (33 cuts, many leaving a flat 'A 24 foot pontoon.' with nothing to move the call on):
// asking again a turn later is what a good receptionist does ("Got it. And your name?"), and an "I still need ..."
// sentence is usually the only question, so cutting it drops the ask with the wording. What stays: the number once
// when caller ID has it, the name at most twice, nothing they already gave.
// "Anything else on your list?" closed six answers in a row on a Nov 21, 2026 practice call (a State Farm agent with
// a list of questions): asked again only once two replies have gone by without it.
const ANY_ELSE = /\b(anything else|what else|any other (question|questions|thing|things)|something else|more questions)\b/i;
function askLess(s, ctx) {
  if (isQ(s) && ANY_ELSE.test(s) && (ctx.msgs || []).filter(m => m.r === 'a').slice(-2).some(m => sentencesOf(m.t).some(x => isQ(x) && ANY_ELSE.test(x)))) return true;
  const a = asksFor(s);
  if (!a.length || DIGITS.test(s)) return false;
  const st = ctx.state || { asked: {}, have: {} };
  const callerId = ctx.callerId !== false;
  const blocked = k => st.have[k] || (k === 'number' && callerId && (st.asked.number || 0) >= 1) || (k === 'name' && (st.asked.name || 0) >= 2);
  return a.every(blocked);
}
// 7c-3 (Brief 3, Part 7). Stock lines: a statement that says again what Max already said this call ("The owner knows it's
//    urgent and will call you as soon as he can" three times), and the filler "while I've got you". Safety steps,
//    questions and read-backs are never cut here. (Mining phrases across calls was skipped on purpose: "Chris calls back
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
//    their turn) or carries something they need (a price, the booking page, Chris, S.I., refund, contract, cancel,
//    transcripts, texting, the audit, a business day). Questions and safety steps always stay.
const SALES_KEEP = /\$|\b(\d+|dollars?|price|cost|month|day|plan|starter|growth|pro|booking|book|chris|automated assistant|s\.i\.|refund\w*|contract|cancel\w*|transcripts?|record\w*|audio|13 months|text\w*|carriers?|approve\w*|audit|business day|privacy|patient|month to month|no setup)\b/i;
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'what', 'can', 'are', 'how', 'just', 'like', 'okay', 'have', 'does', 'did', 'about', 'there', 'they', 'them', 'its', "it's", 'would', 'will', 'from', 'get', 'got']);
function salesShape(s, ctx) {
  if (!ctx.L || !ctx.L.own) return false;
  if (isQ(s) || SAFETY.test(s)) return false;
  if (sentencesOf(ctx.spoken || '').length < 2) return false;
  if (SALES_KEEP.test(s)) return false;
  const asked = new Set(norm(ctx.said).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
  return !norm(s).split(' ').some(w => asked.has(w));
}
// 8a (Brief 3, Part 8). The free audit is offered once. Christopher's Nov 5 call: "Want the free audit texted to you?"
//    closed three replies in a row until he said "I don't want the free audit." After one offer they didn't take, a
//    sentence offering it again is cut; after a no, any mention of it is.
const AUDIT = /\b(free )?audit\b|\bauditor[ií]a\b/i;
const AUDIT_OFFER = /\b(want|like|should i|can i|shall i|happy to)\b[^.?!]*\b(audit|auditor[ií]a)\b|\b(audit|auditor[ií]a)\b[^.?!]*\?/i;
const TAKES = /\b(yes|yeah|yep|sure|ok(ay)?|please|text (it|me)|send (it|me)|go ahead|s[ií]|claro|m[aá]ndel[oa])\b/i;
const NO_AUDIT = /\b(don'?t|do not|no) (want|need)\b[^.?!]*\baudit\b|\bno,? (thanks|thank you)\b|\bstop (asking|offering)\b|\bnot interested\b/i;
// The call back, offered a third time (Nov 21, 2026 practice calls: "Want Chris to call you?" on turns 3, 4 and 5, while
// the owner's own rule is twice a call at most). Once they said yes or gave a number, it is not offered again either.
// Nov 21, 2026 replay of 26 practice calls on the live line: "Want me to have Chris walk you through it?" is the same
// offer, and so is "Want me to set that up?" right after "he calls back within one business day" (it slipped past as a
// third offer in a row). A caller who asks for the call themselves ("have somebody call me back") has said yes.
const CALLBACK_OFFER = /\b(chris|him|someone|somebody|the team)\b[^.?!]*\b(call|ring|reach)\b[^.?!]*\?|\b(want|like)\b[^.?!]*\b(a|that) (call|call back|callback)\b[^.?!]*\?|\bset (that|a|the) call up\b[^.?!]*\?|\bset up (that|a|the) call\b[^.?!]*\?|\b(chris|him)\b[^.?!]*\b(walk|go over|go through|talk)\b[^.?!]*\?|\b(put|get|have) you down for (a|the|that) (call|call back|callback|call-back)\b[^.?!]*\?|\b(want|like)\b[^.?!]*\b(the|a) (callback|call-back|call back) (with|from) chris\b[^.?!]*\?|\bque (chris|[eé]l) (te|le) (llame|marque|devuelva la llamada)\b[^.?!]*\?|\b(una )?llamada de chris\b[^.?!]*\?/i;
const SET_UP = /\b(want|like|should|shall)\b[^.?!]*\b(set (that|it|this) up|line (that|it) up|arrange (that|it))\b[^.?!]*\?|^\s*(want|like) that\?/i;
const CALL_MENTION = /\b(calls?|ring|reach)\b[^.?!]*\b(back|you)\b|\bcall-?back\b/i;
const WANTS_CALL = /\b(call|ring) me\b|\bcall (me )?back\b|\bcallback\b|\bhave (him|chris|somebody|someone|the team) (call|ring|reach)\b|\b(get|put|take) (my|me) (name )?down\b|\bsign me up\b/i;
const NO_CALL = /\b(don'?t|do not|no need to|never)\s+(need\s+(a\s+|to\s+)?)?(call|ring)|\bno call|\bnot interested\b/i;
// a yes to the offer starts the answer: "ok then sing me a little song" (Nov 21 replay) is not one
const CB_TAKES = /^\W*(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead|that works|sounds good|do it|alright|all right|s[ií]|claro)\b(?!\W*(then|but)\b)/i;
const isOffer = (s, around) => CALLBACK_OFFER.test(s) || (SET_UP.test(s) && CALL_MENTION.test(around || ''));
export function callbackOffers(msgs) {
  let offered = 0, taken = false, lastOffer = -1;
  (msgs || []).forEach((m, i) => {
    const t = String(m.t || '');
    if (m.r === 'a' && sentencesOf(t).some((x, k, all) => isOffer(x, all.slice(0, k).join(' ')))) { offered++; lastOffer = i; }
    if (m.r === 'u' && !NO_CALL.test(t) && ((lastOffer > -1 && i === lastOffer + 1 && (CB_TAKES.test(t) || /\d{3}/.test(t))) || WANTS_CALL.test(t))) taken = true;
  });
  return { offered, taken };
}
const NAME_NUMBER_ASK = /\b(best number|right number|number (for|to reach|to call)|your (name|number)|what'?s the name|name for|area code)\b/i;
function callbackTwice(s, ctx) {
  // Always Open's own line only: there the owner set the limit; on a business's line the call back is the job
  if (!(ctx.L && ctx.L.own)) return false;
  if (isOffer(s, ctx.spoken)) { const c = callbackOffers(ctx.msgs); return c.taken || c.offered >= 2; }
  // The name or number asked right after an offer that was just cut asked for a call they have not said yes to
  // (Nov 21 replay: "Now, want Chris to call you back?" was cut and "Is 404-555-0187 the best number?" went out alone).
  if (ctx.lastCut === 'g-callback' && isQ(s) && NAME_NUMBER_ASK.test(s)) return !callbackOffers(ctx.msgs).taken && !auditState(ctx.msgs).taken;
  return false;
}
export function auditState(msgs) {
  let offered = 0, taken = false, declined = false, lastOffer = -1;
  (msgs || []).forEach((m, i) => {
    const t = String(m.t || '');
    if (m.r === 'a' && AUDIT_OFFER.test(t)) { offered++; lastOffer = i; }
    if (m.r === 'u') {
      if (NO_AUDIT.test(t) || (AUDIT.test(t) && /\b(no|don'?t|not)\b/i.test(t))) declined = true;
      else if (lastOffer > -1 && i === lastOffer + 1 && TAKES.test(t)) taken = true;
    }
  });
  return { offered, taken, declined };
}
function auditOnce(s, ctx) {
  if (!AUDIT.test(s)) return false;
  const a = auditState(ctx.msgs);
  if (a.declined) return true;
  return a.offered >= 1 && !a.taken && AUDIT_OFFER.test(s);
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
// Brief 5 follow-up (Nov 5, 5:57 PM call: answers of 50 and 60 words): two statements, then stop, unless the caller
// asked for the detail. A question at the end is kept, and so is a safety step.
const MORE = /\b(tell me more|more detail|in detail|explain|walk me through|everything|all of it|break it down|go on)\b/;
// What an owner must hear before trusting us with their name and their customers: nothing goes out without their approval,
// Compliance Guard checks it, they send follow-ups themselves, we never contact their customers or need their records.
// Nov 6 practice runs for an insurance agency (State Farm): g-short cut exactly these. Kept the first time Max says one.
const ASSURE = /\b(compliance guard|until you approve|you approve|approve it|nothing goes out|sign(s|ed)? off|sign-off|send it yourself|you send it|never (text|call|contact|email|message)s? (your|their|any)|never need|(customer|policy) records|waits? for your (ok|okay|approval)|wait on your ok)\b/;
// "How does it work / what do you ask them / who sees it": the answer is the steps, so it gets one more sentence.
// A price objection ("how is that worth $149", "why hire you over a person") gets the same room for its answer.
// "What do I lose if I go with that one?" too (Nov 21 replay: the answer, what Starter leaves out, was the sentence cut).
const HOWQ = /\b(how (does|do|would|will|is|can|did)|how (it|this|that|you|we) (would|will|does|do|could) work|how it works|what do (you|they) (do|ask|say|send|see)|who (sees|gets|can see)|where does|worth|expensive|smarter|cheaper|hire (you|a person|someone|somebody)|what (do|would|will|did) (i|we) (lose|miss|give up|skip|get)|what'?s the difference|what('s| is) not (on|in))\b/;
// A quote still open in what was said so far: its next sentence closes it. Nov 21 replay: the length cut took the second
// line of a song Max sang for a caller, the closing quote with it, and what followed was said inside the open quote.
const openQuote = t => { const x = String(t || ''); return (x.match(/"/g) || []).length % 2 === 1 || (x.match(/“/g) || []).length > (x.match(/”/g) || []).length; };
// What a feature can't do, or the plan it is on, the first time it is said (Nov 21 replay: the length cut took "If your
// tee sheet is separate software, it doesn't connect." and left "I can." for a golf shop; it took "Yelp isn't covered,
// though." and "It's on Growth and Pro." too). Up to 30 words, and never past 65 in all: on the third replay the caveat
// came as one 24-word sentence ("Tee sheet software is different: it doesn't connect, so I'd take the time ...") and
// was cut again, after "Yep, I can book it right on the call.".
const LIMIT = /\b(doesn'?t|does not|don'?t|do not|won'?t|will not|can'?t|cannot|isn'?t|is not|aren'?t|are not)\s+(connect|sync|link|covered|cover|included|include|work with)\b|\bnot (covered|included|connected)\b|\b(on|in) (growth|pro)( and pro)?\b|\b(growth|pro) plan\b|\bnot on (starter|growth)\b/;
function shortReply(s, ctx) {
  if (isQ(s) || SAFETY.test(s)) return false;
  if (MORE.test(lc(ctx.said))) return false;
  if (openQuote(ctx.spoken)) return false;
  if (LIMIT.test(lc(s)) && words(s) <= 30 && words(ctx.spoken || '') + words(s) <= 65) {
    const said = (ctx.msgs || []).filter(m => m.r === 'a').flatMap(m => sentencesOf(m.t)).map(norm);
    if (!said.includes(norm(s))) return false;
  }
  if (ASSURE.test(lc(s))) {
    const before = (ctx.msgs || []).filter(m => m.r === 'a').map(m => lc(m.t)).join(' ');
    const k = (lc(s).match(ASSURE) || [])[0];
    if (k && !before.includes(k)) return false;
  }
  // a sentence about what they just said ("For a pressure washing crew, ...") is the answer, not padding: kept
  const mine = new Set((lc(ctx.said).match(/[a-z']{5,}/g) || []).filter(x => !/^(about|would|could|should|there|their|which|where|what's|exactly|really|thing|things|always|right)$/.test(x)));
  if ((lc(s).match(/[a-z']{5,}/g) || []).some(x => mine.has(x))) return false;
  // a short opener ("Fair pushback.", "Yep.") is not one of the two: on Nov 5 it cut the actual answer after it
  const before = sentencesOf(ctx.spoken || '').filter(x => !isQ(x) && words(x) > 3).length, w = words(ctx.spoken || '');
  if (!before) return false;
  const how = HOWQ.test(lc(ctx.said)), v3 = !!(ctx.L && Array.isArray(ctx.L.features) && ctx.L.features.includes('v3'));
  return before >= ((ctx.urgent || ctx.danger || how) ? 3 : 2) || w + words(s) > (how ? (v3 ? 46 : 55) : (v3 ? 34 : 40));
}

// Brief 5 (Nov 5, 2026 call): canned comebacks that tell a caller they are talking to a script ("Give me a minute to
// change your mind", "Ha, okay, you're testing me", "That's a sharp ear", "The voice is the part I can't fully smooth
// out yet"). Max says he is an automated assistant when asked and gets back to the question; he never remarks on his own voice.
const CANNED = /\b(change your mind|(you're|you are) testing me|testing me\b|sharp ear|nice try|guilty|(can't|cannot) (fully )?smooth|(my|the) voice (is|isn't|sounds|part)|i'd rather you hear it|test me|put me to the test|outside (of )?my lane|outside what i can help with|sounds interesting, though)\b|^\s*ha[,.!]/i;
function cannedLine(sentence) { return CANNED.test(lc(sentence)); }
// v3: a stock closing question after a real answer ("Does that sound like your day?", "Make sense?", "Want to hear how that
// works?", "Which part do you want more on?"). The answer stands on its own and the caller talks next. A question that moves
// the call on (their name, their business, a time) is not one of these.
const CLOSER = /^\W*(so,?\s+|now,?\s+|and\s+)?((does|do|would|did) (that|this|it|any of that|all that) (sound|make sense|fit|help|cover|work|answer|seem|clear)|makes? sense|sound good|how does (that|this) sound|(want|would you like|wanna|do you want) (me )?to (hear|know|walk|go (over|through)|see|show|try|dig|get into)|want (the rest|more|to hear more)|which (part|one|piece)( of (that|those))? (do you want|would you like|should i|sounds|matters)|(is there )?anything (else|more)|what else|(any )?other questions|is that (helpful|what you (meant|needed))|that help)\b[^?]*\?\W*$/i;
function stockCloser(s, ctx) {
  if (!isQ(s) || !CLOSER.test(String(s).trim())) return false;
  return sentencesOf(ctx.spoken || '').some(x => !isQ(x) && words(x) >= 4);
}
// v3 (loop 2): the same question two replies in a row, or a third time, after the caller let it pass: their name, the
// shop's name, their town, or a read-back of the same number. Loop 1's lowest grades were nearly all this ("repeats the
// 'What's the shop called?' question twice, ignoring the caller's pivots").
const NAME_ASK = /\b(your name|name (for|so|should i)|who (am i|should i) (be )?(putting|put) down|(what'?s|what is) the (name|shop|business|company)\b|(shop|business|company|salon|store|truck|studio) (called|name)\b|name of (your|the) (shop|business|company|salon|store))/i;
const TOWN_ASK = /\b(what town|which town|where are you (located|based)|what city|where'?s the (shop|business))\b/i;
const digitsOf = t => (lc(t).match(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\b/g) || []).map(w => ({ zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 })[w] ?? w).join('');
function askThird(s, ctx) {
  if (!isQ(s)) return false;
  const mine = (ctx.msgs || []).filter(m => m.r === 'a').slice(1).map(m => String(m.t || ''));
  const d = digitsOf(s);
  if (d.length >= 7) return mine.some(t => isQ(sentencesOf(t).slice(-1)[0] || '') && digitsOf(t).includes(d));
  return [NAME_ASK, TOWN_ASK].some(k => k.test(s) && (mine.filter(t => k.test(t)).length >= 2 || (mine.length > 0 && k.test(mine[mine.length - 1]))));
}
const ORDER = [['g-canned', cannedLine], ['g-closer', stockCloser], ['g-ask3', askThird], ['g-safety', safetyThenAsk], ['g-once', askOnce], ['g-ask2', askLess], ['g-stock', noStock], ['g-sales', salesShape], ['g-audit', auditOnce], ['g-callback', callbackTwice], ['g-town', noLeadingTown], ['g-history', noHistoryQ], ['g-promise', noPromise], ['g-short', shortReply]];

export function guardOne(sentence, ctx) {
  // a control tag on its own ([END], [TRANSFER], [BOOK ...]) is never cut: the phone line acts on it
  if (!/[a-z0-9]/i.test(String(sentence || '').replace(/\[[^\]]*\]?/g, ''))) return '';
  let cut = '';
  for (const [k, f] of ORDER) if (ON(ctx, k) && f(sentence, ctx)) { cut = k; break; }
  // what the last sentence of this reply lost, for a guard that depends on it (g-callback: the ask after a cut offer)
  if (ctx) ctx.lastCut = cut;
  return cut;
}

// A whole reply (practice calls): the same per-sentence decisions the live call makes as the words stream in.
export function guardText(text, ctx) {
  const parts = sentencesOf(text);
  if (!parts.length) return { text, cuts: [] };
  let spoken = '';
  const keep = [], cuts = [], c = Object.assign({}, ctx, { lastCut: '' });
  for (const p of parts) {
    c.spoken = spoken;
    const g = guardOne(p, c);
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
