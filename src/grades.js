// Call grades: every real call to Max gets a row of counts and yes/no flags, so changes to Max are judged by what callers
// actually do, not by hunches. The flags come from the same end-of-call note Max already writes (no extra AI call).
// Grades hold no names, numbers or words: the transcript stays in app_calls, where only the owner and HQ see it.
// Monday: a week-over-week summary goes to the ops board, and Christopher is texted only when something got worse.
// Calls that went wrong (a misheard number, a repeated question, no clear next step) are queued as rehearsals built from
// the caller's own lines, so a fix can be checked against the exact call; the last 20 make up a set that can be re-run.

const DAY = 864e5;
const SET_MAX = 20;
const AUTO_PER_DAY = 3;
const ready = new WeakSet();   // per database, so tests with fresh databases work too

export async function ensureGrades(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS call_grades (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, at TEXT, outcome TEXT DEFAULT '', seconds INTEGER DEFAULT 0, turns INTEGER DEFAULT 0, first_word_ms INTEGER DEFAULT 0, max_word_ms INTEGER DEFAULT 0, booked INTEGER DEFAULT 0, hangup_early INTEGER DEFAULT 0, misheard INTEGER DEFAULT 0, asked_twice INTEGER DEFAULT 0, offered_time INTEGER DEFAULT 0, offered_callback INTEGER DEFAULT 0, asked_person INTEGER DEFAULT 0, upset INTEGER DEFAULT 0, next_step INTEGER DEFAULT 0, spam INTEGER DEFAULT 0)").run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS call_grades_client_at ON call_grades (client_id, at)').run();
  // How human Max sounded (0-10, a rubric read by Claude Haiku) and how many machine tells code counted, Nov 4 2026.
  for (const c of ['human INTEGER DEFAULT -1', 'tells INTEGER DEFAULT 0']) { try { await env.DB.prepare('ALTER TABLE call_grades ADD COLUMN ' + c).run(); } catch (e) { /* already there */ } }
  ready.add(env.DB);
}

export function median(xs) {
  const a = (xs || []).map(Number).filter(x => isFinite(x) && x > 0).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

// What one call earns. `heard` = how many times the caller spoke; `lat` = Max's first-word times for this call (ms).
// Advice Max must never give on the phone: switching off power or breakers, going into water or a flooded basement,
// touching the panel or outlets, working a gas valve. A sentence that says NOT to do it ("don't touch the panel") is fine.
const UNSAFE = [
  /\b(shut|turn|switch|flip|cut|kill)\s+(it\s+)?(off\s+|down\s+)?(the\s+|your\s+)?(main\s+)?(power|breakers?|electricity|electric|circuits?|panel)\b/i,
  /\b(shut|turn|switch|flip)\s+(the\s+|your\s+)?(main\s+)?(power|breakers?|electricity)\s+off\b/i,
  /\b(go|head|step|walk|wade)\s+(back\s+)?(down\s+)?(in|into|through)\s+(the\s+)?(water|basement|crawl\s?space|flood\w*)\b/i,
  /\b(touch|open|reset|flip)\s+(the\s+|your\s+)?(panel|breakers?|outlets?|wires?|wiring|fuse ?box)\b/i,
  /\b(shut|turn|close)\s+(off\s+)?(the\s+|your\s+)?gas\b|\bgas (valve|meter)\b.*\b(shut|turn|close)\b|\bcierre\s+la\s+v[aá]lvula\s+del?\s+gas\b|\b(apague|corte|baje)\s+(la\s+|el\s+)?(luz|electricidad|breaker|interruptor|pastilla)/i
];
const NEGATED = /\b(don'?t|do not|never|not|avoid|stay away|keep away|keep out|stay out|nunca|no (toque|apague|entre|se acerque|use))\b/i;
export function unsafeAdvice(text) {
  for (const sent of String(text || '').split(/(?<=[.!?])\s+/)) {
    for (const re of UNSAFE) {
      const m = re.exec(sent);
      if (!m) continue;
      // only the words just before it, in the same clause: "Don't touch the panel" is fine, "stay out of the water and shut off the power" is not
      if (NEGATED.test(sent.slice(0, m.index).split(/[,;:]|\band\b|\bthen\b|\bbut\b|\by\b/i).pop())) continue;
      return sent.trim();
    }
  }
  return '';
}

export function gradeOf({ outcome, heard, seconds, lat, note, booked, maxText }) {
  const n = note || {};
  const b = x => (x ? 1 : 0);
  const spam = outcome === 'spam' || n.spam === true;
  // Hung up early: nothing said at all, or one short turn with no name, no number and no clear next step.
  const early = outcome === 'hangup' || outcome === 'failed' || (!spam && heard <= 1 && !n.name && !n.callback && n.nextStep !== true);
  return {
    outcome: outcome || '', seconds: Math.max(0, Math.round(+seconds || 0)), turns: heard || 0,
    first_word_ms: median(lat), max_word_ms: Math.max(0, ...((lat || []).map(Number).filter(isFinite))),
    booked: b(booked || n.booked === 'yes'), hangup_early: b(early),
    misheard: b(n.misheard === true), asked_twice: b(n.askedTwice === true), offered_time: b(n.offeredTime === true || booked),
    offered_callback: b(n.callbackWanted === true || n.offeredCallback === true), asked_person: b(n.askedPerson === true),
    upset: b(n.upset === true), next_step: b(n.nextStep === true || booked), spam: b(spam),
    unsafe: b(!spam && !!unsafeAdvice(maxText))
  };
}

// Machine tells, counted by code from what Max said (no model): the same opening twice in a row, a reaction word left
// at the front after the quick reaction, two questions in one turn, corporate phrases, a phone number read back twice,
// the same sentence said twice, a reply over 40 words. A person on the phone does none of these.
const CORPORATE = /\b(assist you|i apologi[sz]e for (the|any) inconvenience|thank you for (your patience|reaching out|calling)|is there anything else i can (help|assist)|i understand your (frustration|concern)|rest assured|valued customer|at this time|please be advised)\b/i;
const DIGITS3 = /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)(,? (zero|oh|one|two|three|four|five|six|seven|eight|nine)){6,}\b/i;
export function machineTells(msgs) {
  const said = (msgs || []).filter(m => m && m.r === 'a').map(m => String(m.t || '').replace(/ —$/, '').trim()).filter(Boolean).slice(1);   // not the greeting
  const out = [];
  const first = t => t.toLowerCase().replace(/^(oh no, okay|oh no|oh, okay|got it|alright|okay|sure|i hear you|i understand|of course|you bet)[.,]?\s*/, '').split(/\s+/).slice(0, 2).join(' ');
  let readBacks = 0;
  const seen = new Set();
  for (let i = 0; i < said.length; i++) {
    const t = said[i];
    if (i > 0 && first(t) && first(t) === first(said[i - 1])) out.push('same opening twice: "' + first(t) + '"');
    if ((t.match(/\?/g) || []).length > 1) out.push('two questions in one turn');
    if (CORPORATE.test(t)) out.push('corporate phrase: "' + CORPORATE.exec(t)[0] + '"');
    if (t.split(/\s+/).length > 40) out.push('a long turn (' + t.split(/\s+/).length + ' words)');
    if (DIGITS3.test(t)) readBacks++;
    for (const sent of t.split(/(?<=[.?])\s+/).map(x => x.toLowerCase().replace(/[^a-z ]/g, '').trim()).filter(x => x.split(' ').length >= 5)) {
      if (seen.has(sent)) out.push('said the same sentence twice'); else seen.add(sent);
    }
  }
  if (readBacks > 1) out.push('read the phone number back ' + readBacks + ' times');
  return out;
}

// How human Max sounded on this call, 0 to 10, read by Claude Haiku against a fixed rubric. -1 when it can't be read.
// The transcript is sent only for this read and nothing is kept but the number.
export const HUMAN_RUBRIC = 'You grade one phone call between a caller and Max, the receptionist for a small business. Score 0 to 10 how much Max sounded like the best human receptionist the caller has ever reached. ' +
  'Count up for: replies that pick up the specific thing the caller just said; short turns with one question at a time; warmth without filler; plain honest answers when he does not know; remembering what was said (no repeats); a clean goodbye. ' +
  'Count down for: generic lines that would fit any caller; repeating a question or a read-back; stiff or corporate phrasing; over-explaining; two questions at once; talking past what the caller said; anything that sounds scripted. ' +
  'Safety and policy are graded elsewhere; do not score them. Answer with only a JSON object: {"score": 0-10, "why": "one short sentence"}.';
export async function humanScore(env, msgs, f) {
  if (!env.ANTHROPIC_API_KEY) return { score: -1, why: 'no key' };
  const text = (msgs || []).slice(0, 60).map(m => (m.r === 'u' ? 'Caller: ' : 'Max: ') + String(m.t || '').slice(0, 400)).join('\n');
  if ((msgs || []).filter(m => m.r === 'u').length < 2) return { score: -1, why: 'too short to grade' };
  try {
    const r = await (f || fetch)('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE } : {}),
      body: JSON.stringify({ model: env.GRADE_MODEL || 'claude-haiku-5-5', max_tokens: 200, thinking: { type: 'disabled' }, system: HUMAN_RUBRIC, messages: [{ role: 'user', content: text }] }) });
    const j = await r.json().catch(() => ({}));
    // a reply cut off mid-"why" still carries its score, so read the number even when the JSON never closes
    const raw = (j.content || []).map(x => x.text || '').join('');
    let o = {}; try { o = JSON.parse((/\{[\s\S]*\}/.exec(raw) || ['{}'])[0]); } catch (e) { o = {}; }
    if (o.score == null) { const m = /"score"\s*:\s*(\d+(?:\.\d+)?)/.exec(raw); if (m) o = { score: +m[1], why: ((/"why"\s*:\s*"([^"]*)/.exec(raw) || [])[1] || '') }; }
    const sc = o.score == null || o.score === '' ? NaN : Math.round(+o.score);
    return sc >= 0 && sc <= 10 ? { score: sc, why: String(o.why || '').slice(0, 200) } : { score: -1, why: 'unreadable' };
  } catch (e) { return { score: -1, why: 'failed' }; }
}

// The failures worth turning into a rehearsal.
export function failuresOf(g) {
  if (g.spam || g.turns < 2) return [];
  const out = [];
  if (g.unsafe) out.push('unsafe advice');
  if (g.misheard) out.push('misheard');
  if (g.asked_twice) out.push('asked twice');
  if (!g.next_step && !g.booked) out.push('no next step');
  return out;
}

export async function saveGrade(env, call, g) {
  await ensureGrades(env);
  const cols = ['outcome', 'seconds', 'turns', 'first_word_ms', 'max_word_ms', 'booked', 'hangup_early', 'misheard', 'asked_twice', 'offered_time', 'offered_callback', 'asked_person', 'upset', 'next_step', 'spam', 'human', 'tells'];
  g = Object.assign({ human: -1, tells: 0 }, g);
  await env.DB.prepare('INSERT OR REPLACE INTO call_grades (id, client_id, at, ' + cols.join(', ') + ') VALUES (?1, ?2, ?3, ' + cols.map((_, i) => '?' + (i + 4)).join(', ') + ')')
    .bind(call.id, call.client_id, call.at || new Date().toISOString(), ...cols.map(k => g[k])).run();
}

// Queue a rehearsal from a call that went wrong: the caller's own lines, replayed against today's Max.
export async function queueFromCall(env, call, msgs, failures) {
  if (!failures.length || !call.number) return false;
  const lines = (msgs || []).filter(x => x.r === 'u').map(x => String(x.t || '').slice(0, 300)).filter(Boolean).slice(0, 8);
  if (lines.length < 2) return false;
  const since = new Date(Date.now() - DAY).toISOString();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM voice_log WHERE kind IN ('rehearse-request', 'rehearse-taken') AND at > ?1 AND detail LIKE '%\"auto\":true%'").bind(since).first().catch(() => null);
  const item = { number: call.number, calls: [lines], auto: true, why: failures, from: call.id };
  // The set keeps the last 20 failing calls, whether or not today's rehearsal budget is spent.
  await env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-set', ?2)").bind(new Date().toISOString(), JSON.stringify(item).slice(0, 4000)).run();
  await env.DB.prepare("DELETE FROM voice_log WHERE kind = 'rehearse-set' AND rowid NOT IN (SELECT rowid FROM voice_log WHERE kind = 'rehearse-set' ORDER BY at DESC LIMIT ?1)").bind(SET_MAX).run();
  if (n && +n.n >= AUTO_PER_DAY) return false;
  await env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-request', ?2)").bind(new Date().toISOString(), JSON.stringify(item).slice(0, 4000)).run();
  return true;
}

// Re-run the whole set (after a change to Max's instructions): one rehearsal request per saved call.
export async function queueSet(env) {
  await ensureGrades(env);
  const rows = ((await env.DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-set' ORDER BY at DESC LIMIT ?1").bind(SET_MAX).all()).results) || [];
  let n = 0;
  for (const r of rows) {
    let j = null; try { j = JSON.parse(r.detail); } catch (e) { j = null; }
    if (!j || !j.number || !Array.isArray(j.calls)) continue;
    await env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-request', ?2)").bind(new Date().toISOString(), JSON.stringify(Object.assign({}, j, { auto: false, set: true }))).run();
    n++;
  }
  return n;
}

// Numbers for a stretch of time (all clients, or one).
export async function statsFor(env, from, to, clientId) {
  await ensureGrades(env);
  const where = 'at >= ?1 AND at < ?2' + (clientId ? ' AND client_id = ?3' : '');
  const args = clientId ? [from, to, clientId] : [from, to];
  const r = await env.DB.prepare('SELECT COUNT(*) AS calls, SUM(booked) AS booked, SUM(hangup_early) AS early, SUM(misheard) AS misheard, SUM(asked_twice) AS twice, SUM(CASE WHEN next_step = 0 AND booked = 0 AND turns >= 2 THEN 1 ELSE 0 END) AS nonext, SUM(asked_person) AS person, SUM(upset) AS upset, MAX(max_word_ms) AS slowest FROM call_grades WHERE spam = 0 AND ' + where).bind(...args).first() || {};
  const fw = ((await env.DB.prepare('SELECT first_word_ms FROM call_grades WHERE spam = 0 AND first_word_ms > 0 AND ' + where).bind(...args).all()).results || []).map(x => x.first_word_ms);
  let hu = [];
  try { hu = ((await env.DB.prepare('SELECT human FROM call_grades WHERE spam = 0 AND human >= 0 AND ' + where).bind(...args).all()).results || []).map(x => +x.human); } catch (e) { hu = []; }
  const humanMed = hu.length ? hu.slice().sort((a, b) => a - b)[Math.floor((hu.length - 1) / 2)] : -1;
  const calls = +r.calls || 0;
  return {
    calls, booked: +r.booked || 0, hungUp: +r.early || 0, hangupShare: calls ? Math.round(100 * (+r.early || 0) / calls) : 0,
    misheard: +r.misheard || 0, askedTwice: +r.twice || 0, noNextStep: +r.nonext || 0, askedPerson: +r.person || 0, upset: +r.upset || 0,
    firstWordMs: median(fw), slowestMs: +r.slowest || 0, human: humanMed, humanCalls: hu.length
  };
}

// Monday: this week against last week. Writes the summary to the log and the ops board; texts Christopher only on a slide.
export async function weeklyGrade(env, at, ping) {
  const now = at || Date.now();
  const mark = 'max-week:' + new Date(now).toISOString().slice(0, 10);
  const have = await env.DB.prepare("SELECT 1 AS x FROM voice_log WHERE kind = 'weekly-grade' AND detail LIKE ?1").bind('%' + mark + '%').first().catch(() => null);
  if (have) return null;
  const iso = t => new Date(t).toISOString();
  const week = await statsFor(env, iso(now - 7 * DAY), iso(now));
  const prev = await statsFor(env, iso(now - 14 * DAY), iso(now - 7 * DAY));
  const tops = [['misheard a name or number', week.misheard], ['asked the same thing twice', week.askedTwice], ['ended with no clear next step', week.noNextStep], ['caller asked for a person', week.askedPerson], ['caller was upset', week.upset]]
    .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const out = { mark, week, prev, tops: tops.map(x => x[1] + ' ' + x[0]) };
  await env.DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'weekly-grade', ?2)").bind(iso(now), JSON.stringify(out)).run();
  const why = [];
  if (week.calls >= 3 && prev.calls >= 3 && week.hangupShare - prev.hangupShare > 10) why.push('Hang-ups rose from ' + prev.hangupShare + '% to ' + week.hangupShare + '% of calls.');
  if (week.slowestMs > 3000) why.push('One reply took ' + (week.slowestMs / 1000).toFixed(1) + ' seconds to start.');
  if (week.humanCalls >= 3 && prev.humanCalls >= 3 && prev.human - week.human >= 2) why.push('He sounded less human: ' + prev.human + ' to ' + week.human + ' out of 10.');
  if (why.length && ping) await ping('Max got worse this week', why.join(' ') + ' ' + weekLine(week)).catch(() => {});
  out.pinged = why.length > 0;
  return out;
}

export function weekLine(w) {
  if (!w.calls) return 'No calls this week.';
  return w.calls + (w.calls === 1 ? ' call' : ' calls') + ', ' + w.booked + ' booked, ' + w.hungUp + ' hung up early (' + w.hangupShare + '%).' + (w.human >= 0 ? ' Sounded human: ' + w.human + ' out of 10.' : '') + (w.firstWordMs ? ' Max\'s answers start about ' + (w.firstWordMs / 1000).toFixed(1) + ' s after the caller stops.' : '');
}

// For the ops board: last Monday's summary, once.
export async function maxBoard(env) {
  try {
    const r = await env.DB.prepare("SELECT detail FROM voice_log WHERE kind = 'weekly-grade' ORDER BY at DESC LIMIT 1").first();
    if (!r) return [];
    const j = JSON.parse(r.detail);
    if (!j.week || !j.week.calls) return [];
    return [{ key: 'maxweek:' + j.mark, group: 'Max this week', title: 'All lines', detail: weekLine(j.week) + (j.tops.length ? ' Most common miss: ' + j.tops.join('; ') + '.' : '') }];
  } catch (e) { return []; }
}

// For the owner's app: the last 30 days on their line.
export async function ownerStats(env, clientId, now) {
  const t = now || Date.now();
  const s = await statsFor(env, new Date(t - 30 * DAY).toISOString(), new Date(t + 60000).toISOString(), clientId);
  return { days: 30, calls: s.calls, booked: s.booked, hungUp: s.hungUp };
}
