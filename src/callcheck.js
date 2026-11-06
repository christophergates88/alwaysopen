// Build Brief 6, Part 4: how a call SOUNDED, measured, so nothing about Max's voice ships on a transcript alone.
// gapsOf: from the timeline Max logs on test calls (Twilio's speaking events: C+/C- caller, A+/A- Max), the silence a
// caller hears after they stop talking, and any silence inside Max's own turn.
// tellsOf: the eight items of the standard, counted from the transcript by code (not by a judge).

// tl: [[ms, code, extra?], ...]
export function gapsOf(tl) {
  const ev = (tl || []).filter(x => Array.isArray(x) && /^[AC][+-]$/.test(x[1]));
  const turns = [];
  let callerStop = null, inMax = false, lastMaxOff = null, cur = null;
  for (const [t, c] of ev) {
    if (c === 'C+') { if (cur) turns.push(cur); cur = null; callerStop = null; inMax = false; continue; }
    if (c === 'C-') { callerStop = t; inMax = false; lastMaxOff = null; continue; }
    if (c === 'A+') {
      if (callerStop != null && !inMax) { cur = { reply: t - callerStop, inner: [] }; inMax = true; }
      else if (inMax && lastMaxOff != null && cur) cur.inner.push(t - lastMaxOff);
      lastMaxOff = null;
      continue;
    }
    if (c === 'A-') lastMaxOff = t;
  }
  if (cur) turns.push(cur);
  return {
    turns: turns.map(x => ({ reply: x.reply, inner: x.inner })),
    slowReplies: turns.filter(x => x.reply > 1000).length,
    deadAir: turns.filter(x => x.reply > 4000).length,
    innerGaps: turns.reduce((n, x) => n + x.inner.filter(g => g > 700).length, 0),
    worstReply: turns.reduce((m, x) => Math.max(m, x.reply), 0),
    worstInner: turns.reduce((m, x) => Math.max(m, ...x.inner, 0), 0)
  };
}

const sentences = t => String(t || '').replace(/\b(S\.I\.|Mr\.|Mrs\.|Dr\.|St\.|a\.m\.|p\.m\.)/gi, m => m.replace(/\./g, '\u0001')).split(/(?<=[.!?])\s+/).map(x => x.replace(/\u0001/g, '.').trim()).filter(Boolean);
const words = t => (String(t || '').match(/[A-Za-z0-9'’$]+/g) || []).length;
const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const YN_Q = /^(so )?(is|are|do|does|did|can|could|will|would|should|have|has|was|were)\b|^so (you're|you are) (telling|saying)\b/i;
const YN_A = /^(yes|yeah|yep|yup|no|nope|not (really|exactly|quite)|right|correct|sure|absolutely|it does|it is|i do|i can|we do|we can|sí|no)\b/i;
const REACTIONS = /^(okay|ok|sure|right|got it|alright|oh no|hm+|mm-?hm|good question|let me see|fair( enough)?|totally fair|i hear you|of course|you bet)[,.!]?\s*/i;
const SELF = /\b(my voice|the voice is|test me|put me to the test|change your mind|sharp ear|you're testing me)\b/i;

// msgs: [{ r: 'a'|'u', t }] in order; the first 'a' entries before any 'u' are the greeting.
export function tellsOf(msgs) {
  const m = (msgs || []).filter(x => x && (x.r === 'a' || x.r === 'u'));
  const firstU = m.findIndex(x => x.r === 'u');
  const replies = firstU < 0 ? [] : m.slice(firstU).map((x, i, arr) => ({ x, prevU: x.r === 'a' ? [...arr.slice(0, i)].reverse().find(y => y.r === 'u') : null })).filter(o => o.x.r === 'a');
  const out = { notAnswered: 0, sameOpener: 0, askedTwice: 0, bareReaction: 0, longSentence: 0, longReply: 0, aboutSelf: 0, examples: [] };
  const asked = new Map();
  let prevOpen = '';
  for (const { x, prevU } of replies) {
    const t = String(x.t || '').trim();
    const ss = sentences(t);
    const open = norm(t).split(' ').slice(0, 2).join(' ');
    if (open && open === prevOpen) { out.sameOpener++; out.examples.push('same opener: ' + t.slice(0, 50)); }
    prevOpen = open;
    const q = prevU ? String(prevU.t || '').trim() : '';
    if (q && YN_Q.test(norm(q)) && /\?$|^so (you're|you are)/i.test(q.trim() + (/\?$/.test(q) ? '' : ''))) {
      const body = t.replace(REACTIONS, '').replace(REACTIONS, '');
      const head = norm(body).split(' ').slice(0, 5).join(' ');
      if (!YN_A.test(body) && !/\b(yes|yeah|yep|no|nope|not)\b/.test(head)) { out.notAnswered++; out.examples.push('did not answer "' + q.slice(0, 40) + '": ' + body.slice(0, 50)); }
    }
    for (const s of ss.filter(s => /\?$/.test(s))) { const k = norm(s); asked.set(k, (asked.get(k) || 0) + 1); if (asked.get(k) === 2) { out.askedTwice++; out.examples.push('asked twice: ' + s.slice(0, 50)); } }
    const stripped = t.replace(REACTIONS, '').trim();
    if (!stripped || /[—–-]\s*$/.test(t) && words(stripped) <= 4) { out.bareReaction++; out.examples.push('nothing after the reaction: ' + t.slice(0, 50)); }
    for (const s of ss) if (words(s) > 15) { out.longSentence++; out.examples.push('long sentence (' + words(s) + ' words): ' + s.slice(0, 50)); }
    const statements = ss.filter(s => !/\?$/.test(s) && words(s) > 3).length;
    if (statements > 2) { out.longReply++; out.examples.push('long reply (' + statements + ' statements): ' + t.slice(0, 50)); }
    if (SELF.test(t)) { out.aboutSelf++; out.examples.push('about himself: ' + t.slice(0, 50)); }
  }
  out.total = out.notAnswered + out.sameOpener + out.askedTwice + out.bareReaction + out.longSentence + out.longReply + out.aboutSelf;
  out.examples = out.examples.slice(0, 12);
  return out;
}

// The recorded drill call, played from Twilio with our credentials: /voice/drill/<sid>/<token>
export async function drillToken(env, sid) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.VOICE_KEY || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('drill:' + sid)))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
export async function drillAudio(env, sid, token, h) {
  if (!/^CA[0-9a-f]{32}$/.test(String(sid || '')) || !env.VOICE_KEY || token !== await drillToken(env, sid)) return new Response('Not found', { status: 404 });
  const f = (h && h.fetch) || fetch;
  const auth = { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) };
  const base = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID;
  const list = await f(base + '/Calls/' + sid + '/Recordings.json', { headers: auth }).then(r => r.json()).catch(() => ({}));
  const rec = (list.recordings || []).find(x => x.status === 'completed');
  if (!rec) return new Response('The recording is not ready yet. Try again in a minute.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const a = await f(base + '/Recordings/' + rec.sid + '.mp3', { headers: auth });
  if (!a.ok) return new Response('Could not fetch the recording.', { status: 502 });
  return new Response(a.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600', 'content-disposition': 'inline; filename="max-drill-' + sid.slice(-6) + '.mp3"' } });
}
