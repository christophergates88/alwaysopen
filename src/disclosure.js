// What Max says about himself on every call, in one place: the phone line (voice.js) adds it to every greeting, and
// the owner's app (app.js) shows it in the default greeting. Change the wording here and only here.
export const DISCLOSURE = 'I\'m S.I., and this call may be recorded.';

// A greeting that says Max is not an AI, is a person, or that calls are not recorded is never used.
const DENY_AI = /\b(?:[Nn]o|NO|[Nn]ot|NOT|[Nn]ever|[Nn]othing|[Ii]sn['’]?t|[Aa]in['’]?t|[Aa]ren['’]?t|[Ww]ithout|[Dd]on['’]?t|[Dd]o not|[Dd]oesn['’]?t|[Dd]oes not)\b(?:\s+[\w'’]+){0,3}?\s+(?:an?\s+)?(?:AI|A\.I\.?|SI|S\.I\.?)(?![\w])|\b(?:AI|A\.I\.?)\s+(?:could|can|will|would|won['’]?t|can['’]?t)\s+(?:never\s+)?(?:replace|beat|do)\b/;
const DENY_WORDS = /\b(?:no|not|never|nothing|isn['’]?t|ain['’]?t|aren['’]?t|without|won['’]?t be|will not be|don['’]?t|do not|doesn['’]?t|does not)\b(?:\s+[\w'’]+){0,3}?\s+(?:an?\s+)?(?:robots?|bots?|machines?|computers?|automated|automation|automatic|artificial|recorded|recording|recordings|record)\b|\b(?:robots?|machines?|computers?)\s+(?:could|can|will|would)\s+never\b/i;
// Claiming to BE a person; reaching one ("press 0 to reach a real person") is fine.
const CLAIMS_HUMAN = /\b(?:I['’]?m|I am|this is|you['’]?re (?:talking|speaking) (?:to|with)|you are (?:talking|speaking) (?:to|with))\s+(?:a\s+|an\s+)?(?:real |live |actual )?(?:person|human|human being|receptionist)\b|\b(?:at|from|on) the front desk\b/i;
export function contradicts(t) { t = String(t || ''); return DENY_AI.test(t) || DENY_WORDS.test(t) || CLAIMS_HUMAN.test(t); }

// The owner's own greeting with the disclosure in it. Nothing the owner wrote is taken out (their business name lives in
// those sentences). If their words already say both things (an assistant of some kind, and that calls are recorded),
// they play as written; otherwise the disclosure goes in after their first sentence (before it, if that is a question).
const SAYS_AUTOMATED = /\b(?:AI|A\.I\.|S\.I\.)(?![\w])|\b(?:automated|virtual|digital)\s+(?:assistant|agent)\b|\bartificial intelligence\b/i;
const SAYS_RECORDED = /\brecord(?:ed|ing)\b/i;
export function withDisclosure(t) {
  t = String(t || '');
  const n = x => String(x).replace(/[’‘]/g, '\'').toLowerCase();
  if (n(t).indexOf(n(DISCLOSURE)) > -1) return t;
  // what the app put in greetings before (it becomes the one disclosure)
  const legacy = /\s*I['’]m (?:an )?S\.I\.,?(?: assistant,?)? and this call may be recorded\./i;
  if (legacy.test(t)) return t.replace(legacy, ' ' + DISCLOSURE).trim();
  if (SAYS_AUTOMATED.test(t) && SAYS_RECORDED.test(t)) return t;
  const parts = t.replace(/\b([AS])\.I\./g, '$1\u0001I\u0001').split(/(?<=[.!?]["'”’)]*)\s+/).map(x => x.replace(/\u0001/g, '.')).filter(x => x.trim());
  const at = parts.length >= 2 ? 1 : (parts.length === 1 && /\?["'”’)]*$/.test(parts[0]) ? 0 : parts.length);
  parts.splice(at, 0, DISCLOSURE);
  return parts.join(' ');
}
