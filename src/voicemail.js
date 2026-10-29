// Voicemail: the backup for every way a caller can miss Max.
//
//   1. Our server or the database is down when the call comes in. Twilio plays the number's fallback instead: a short
//      greeting and a voicemail, served by Twilio itself (twimlets.com), so it works with Cloudflare completely down.
//   2. Our own code fails while answering. The catch in voice.js plays the same voicemail.
//   3. Max's connection drops partway through a call. He offers the voicemail instead of hanging up.
//
// Nothing is lost either way. When Twilio finishes a recording it tells us (/voice/vm/<key>) if we are up; and every
// 10 minutes a sweep asks Twilio for the calls to our numbers that never reached us, plus any recording we were not
// told about. Each one is written up like an ordinary Max call (voice.js writeUp): the owner gets it in the app with
// what the caller said, a caller who left nothing gets the usual missed-call text (only while the call is fresh), and
// the recording is deleted from Twilio once its words are saved. Callers never ring an owner's cell from here: the old
// fallback dialed the urgent-transfer number, which at 3 AM meant waking them because our server was down.
const SITE = 'https://alwaysopenoffice.com';
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
const VOICE = 'Polly.Matthew';
const SID_RE = /^CA[0-9a-f]{32}$/, REC_RE = /^RE[0-9a-f]{32}$/;
const SETTLE_MS = 2 * 60e3;          // a call this fresh may still be finishing its recording
const STUCK_MS = 90 * 60e3;          // a call row still "live" this long after it started never got its write-up
const TEXTBACK_MS = 30 * 60e3;       // the missed-call text only goes while the call is this fresh
const LOOKBACK_MS = 26 * 3600e3;     // never look further back than this, however long we were down
const MAX_TRIES = 3, PER_RUN = 8;

const clean = s => String(s == null ? '' : s).replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const xa = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = t => new Date(t).toISOString();
const echo = tw => 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(tw);
const GOODBYE = '<Response><Say voice="' + VOICE + '">Got it. Thank you, goodbye.</Say><Hangup/></Response>';

// What the caller hears and does. The <Record> action is Twilio's own goodbye, so it never depends on us; the
// recording callback is how we hear about it fast when we are up.
export function voicemailInner(business, callbackUrl) {
  const biz = clean(business);
  const ask = 'Thanks for calling' + (biz ? ' ' + biz : '') + '. Please leave your name, your number and what you need after the tone, and we’ll get back to you.';
  const cb = callbackUrl ? ' recordingStatusCallback="' + xa(callbackUrl) + '" recordingStatusCallbackMethod="POST"' : '';
  return '<Say voice="' + VOICE + '">' + ask + '</Say><Record maxLength="180" timeout="5" playBeep="true" method="GET" action="' + xa(echo(GOODBYE)) + '"' + cb + '/>' +
    '<Say voice="' + VOICE + '">We didn’t get a message. Please call back any time. Goodbye.</Say><Hangup/>';
}
export function voicemailTwiml(business, callbackUrl) { return '<Response>' + voicemailInner(business, callbackUrl) + '</Response>'; }
export function callbackUrl(env) { return env && env.VOICE_KEY ? SITE + '/voice/vm/' + env.VOICE_KEY : ''; }
// The number's fallback (provision.js sets it on every new number; the hourly check puts it on older ones).
export function fallbackUrl(business, voiceKey) { return echo(voicemailTwiml(business, voiceKey ? SITE + '/voice/vm/' + voiceKey : '')); }
export function hasVoicemail(url) { let u = String(url || ''); try { u = decodeURIComponent(u); } catch (e) { /* as is */ } return /twimlets\.com\/echo/.test(u) && /<Record\b/.test(u); }

const ready = new WeakSet();
export async function ensureVoicemail(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS vm_seen (call_sid TEXT PRIMARY KEY, at TEXT, status TEXT DEFAULT '', tries INTEGER DEFAULT 0, rec_sid TEXT DEFAULT '', note TEXT DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS vm_meta (k TEXT PRIMARY KEY, v TEXT)')
  ]);
  ready.add(env.DB);
}

const auth = env => 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
function tw(env, h, path, method) {
  const f = (h && h.fetch) || fetch;
  const url = /^\/2010-04-01\//.test(path) ? 'https://api.twilio.com' + path : TW + env.TWILIO_ACCOUNT_SID + path;
  return f(url, { method: method || 'GET', headers: { authorization: auth(env) } });
}
async function mark(env, sid, status, note, rec, tries) {
  await env.DB.prepare('INSERT INTO vm_seen (call_sid, at, status, tries, rec_sid, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(call_sid) DO UPDATE SET at = excluded.at, status = excluded.status, tries = excluded.tries, rec_sid = excluded.rec_sid, note = excluded.note')
    .bind(sid, iso(Date.now()), status, tries || 0, rec || '', String(note || '').slice(0, 200)).run();
  return status;
}
const triesOf = async (env, sid) => { const r = await env.DB.prepare('SELECT tries FROM vm_seen WHERE call_sid = ?1').bind(sid).first().catch(() => null); return (r && +r.tries) || 0; };

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
// The words of a recording, by Workers AI's speech-to-text. h.transcribe stands in for it in tests.
async function transcribe(env, recSid, h) {
  if (h && h.transcribe) return String(await h.transcribe(recSid) || '').trim();
  const r = await tw(env, h, '/Recordings/' + recSid + '.mp3');
  if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the recording');
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!env.AI) throw new Error('no speech-to-text on this worker');
  let out;
  try { out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64(buf) }); }
  catch (e) { out = await env.AI.run('@cf/openai/whisper', { audio: Array.from(buf) }); }
  return String((out && out.text) || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
}
// The finished voicemail on a call, if the caller left one worth hearing (two seconds or more).
async function recordingOf(env, sid, h) {
  const r = await tw(env, h, '/Calls/' + sid + '/Recordings.json');
  if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the call’s recordings');
  const j = await r.json();
  return (j.recordings || []).find(x => x.status === 'completed' && +x.duration >= 2 && REC_RE.test(x.sid || '')) || null;
}
const dropRecording = (env, rec, h) => tw(env, h, '/Recordings/' + rec + '.json', 'DELETE').catch(() => null);

// A call that never got to Max (or got cut off before Max wrote it up): write it up now.
// c: { sid, from, to, start, end, name }.
async function takeMissed(env, c, now, h) {
  const line = await env.DB.prepare('SELECT client_id FROM voice_lines WHERE number = ?1').bind(c.to).first();
  if (!line) return mark(env, c.sid, 'skipped', 'not one of our lines');
  const tries = await triesOf(env, c.sid);
  let rec = null, said = '';
  try {
    rec = await recordingOf(env, c.sid, h);
    if (rec) said = (await transcribe(env, rec.sid, h)) || 'They left a voicemail with no words we could make out. Call them back.';
  } catch (e) {
    if (tries + 1 < MAX_TRIES) { await mark(env, c.sid, 'retry', (e && e.message) || e, rec ? rec.sid : '', tries + 1); return 'retry'; }
    if (rec) said = 'They left a voicemail that could not be played back. Call them back.';
  }
  await env.DB.prepare("INSERT OR IGNORE INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, status, notified, hq_synced, test) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'live', 'new', 0, 0, 0)")
    .bind(c.sid, line.client_id, c.to, iso(Date.parse(c.start) || now), c.from || '', clean(c.name)).run();
  const fresh = now - (Date.parse(c.end || c.start) || now) < TEXTBACK_MS;
  await (h.writeUp || (await import('./voice.js')).voicemailWriteUp)(env, c.sid, said, { textback: fresh });
  if (rec && said && !/could not be played back|no words we could make out/.test(said)) await dropRecording(env, rec.sid, h);
  return mark(env, c.sid, 'done', rec ? 'voicemail' : 'no message', rec ? rec.sid : '', tries);
}

// A call Max had already written up as failed: the voicemail that followed goes to the owner as its own note.
async function takeAppended(env, row, now, h) {
  const tries = await triesOf(env, row.id);
  let rec = null, said = '';
  try {
    rec = await recordingOf(env, row.id, h);
    if (!rec) return mark(env, row.id, 'done', 'no voicemail after the failure');
    said = await transcribe(env, rec.sid, h);
  } catch (e) {
    if (tries + 1 < MAX_TRIES) { await mark(env, row.id, 'retry', (e && e.message) || e, rec ? rec.sid : '', tries + 1); return 'retry'; }
    said = '';
  }
  const words = said || 'They left a voicemail that could not be played back. Call them back.';
  await env.DB.prepare("UPDATE app_calls SET summary = ?1, details = TRIM(COALESCE(details, '') || ' ' || ?2), hq_synced = 0 WHERE id = ?3")
    .bind(('They left a voicemail: ' + words).slice(0, 600), ('Voicemail: ' + words).slice(0, 2000), row.id).run();
  const app = h.app || await import('./app.js');
  const who = row.caller_name || row.caller || 'a caller';
  if (row.client_id === 'always-open') await app.opsPing(env, 'Always Open: voicemail from ' + who, words.slice(0, 600), 'default', 'telephone_receiver');
  else await app.pushClient(env, row.client_id, { aps: { alert: { title: 'Voicemail from ' + who, body: (words + ' Tap to call back.').slice(0, 600) }, sound: 'default', 'thread-id': 'calls' }, screen: 'calls', call: row.id }).catch(() => {});
  if (rec && said) await dropRecording(env, rec.sid, h);
  return mark(env, row.id, 'done', 'voicemail after the failure', rec ? rec.sid : '', tries);
}

// Twilio's note that a recording finished (the recordingStatusCallback on our voicemail). The words go out at once.
export async function voicemailHook(env, form, h) {
  h = h || {};
  const sid = String(form.get('CallSid') || ''), st = String(form.get('RecordingStatus') || '');
  if (!SID_RE.test(sid) || (st && st !== 'completed')) return 'ignored';
  await ensureVoicemail(env);
  const seen = await env.DB.prepare('SELECT status FROM vm_seen WHERE call_sid = ?1').bind(sid).first().catch(() => null);
  if (seen && seen.status === 'done') return 'already';
  const now = Date.now();
  const row = await env.DB.prepare('SELECT id, client_id, number, at, caller, caller_name, outcome FROM app_calls WHERE id = ?1').bind(sid).first();
  if (row && row.outcome !== 'live') return takeAppended(env, row, now, h);
  if (row) return takeMissed(env, { sid, from: row.caller, to: row.number, start: row.at, end: iso(now), name: row.caller_name }, now, h);
  const r = await tw(env, h, '/Calls/' + sid + '.json');
  if (!r.ok) return 'unknown call';
  const c = await r.json();
  return takeMissed(env, { sid, from: c.from, to: c.to, start: c.start_time, end: c.end_time || iso(now), name: c.caller_name }, now, h);
}

// Every 10 minutes: the calls to our numbers that have no write-up, and failed calls that may have a voicemail.
export async function vmSweep(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return { off: true };
  await ensureVoicemail(env);
  const lines = new Set((((await env.DB.prepare('SELECT number FROM voice_lines WHERE on_air = 1').all()).results) || []).map(r => r.number));
  if (!lines.size) return { lines: 0 };
  const last = await env.DB.prepare("SELECT v FROM vm_meta WHERE k = 'swept'").first().catch(() => null);
  const from = Math.max(now - LOOKBACK_MS, (last && Date.parse(last.v)) ? Date.parse(last.v) - 30 * 60e3 : now - 3 * 3600e3);
  // Twilio filters by day; the time is checked here.
  const calls = [];
  let path = '/Calls.json?PageSize=200&StartTime%3E=' + iso(from).slice(0, 10);
  for (let page = 0; page < 5 && path; page++) {
    const r = await tw(env, h, path);
    if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the list of calls');
    const j = await r.json();
    for (const c of j.calls || []) calls.push(c);
    path = j.next_page_uri || '';
  }
  const ended = /^(completed|busy|no-answer|canceled|failed)$/;
  const cand = calls.filter(c => c.direction === 'inbound' && lines.has(c.to) && ended.test(c.status) && SID_RE.test(c.sid || '') &&
    Date.parse(c.start_time) >= from && now - (Date.parse(c.end_time || c.start_time) || now) >= SETTLE_MS);
  const known = new Set();
  for (let i = 0; i < cand.length; i += 50) {
    const ids = cand.slice(i, i + 50).map(c => c.sid), qs = ids.map((_, k) => '?' + (k + 1)).join(',');
    for (const r of ((await env.DB.prepare('SELECT id FROM app_calls WHERE id IN (' + qs + ')').bind(...ids).all()).results || [])) known.add(r.id);
    for (const r of ((await env.DB.prepare("SELECT call_sid FROM vm_seen WHERE status IN ('done', 'skipped') AND call_sid IN (" + qs + ')').bind(...ids).all()).results || [])) known.add(r.call_sid);
  }
  const out = { checked: cand.length, delivered: 0, retry: 0, appended: 0 };
  const todo = cand.filter(c => !known.has(c.sid)).map(c => ({ sid: c.sid, from: c.from, to: c.to, start: c.start_time, end: c.end_time, name: c.caller_name }));
  // A call row left "live" long after it started never got its write-up (our code stopped between answering and Max).
  const stuck = ((await env.DB.prepare("SELECT c.id, c.number, c.caller, c.caller_name, c.at FROM app_calls c LEFT JOIN vm_seen v ON v.call_sid = c.id WHERE c.outcome = 'live' AND c.test = 0 AND c.at > ?1 AND c.at < ?2 AND (v.call_sid IS NULL OR v.status = 'retry') LIMIT 5")
    .bind(iso(from), iso(now - STUCK_MS)).all()).results) || [];
  for (const s of stuck) if (!todo.find(t => t.sid === s.id)) todo.push({ sid: s.id, from: s.caller, to: s.number, start: s.at, end: s.at, name: s.caller_name });
  for (const c of todo.slice(0, PER_RUN)) {
    const r = await takeMissed(env, c, now, h);
    if (r === 'done') out.delivered++; else if (r === 'retry') out.retry++;
  }
  // Failed calls whose voicemail we never heard about (the callback normally brings it).
  const failed = ((await env.DB.prepare("SELECT c.id, c.client_id, c.caller, c.caller_name FROM app_calls c LEFT JOIN vm_seen v ON v.call_sid = c.id WHERE c.outcome = 'failed' AND c.test = 0 AND c.at > ?1 AND c.at < ?2 AND (v.call_sid IS NULL OR v.status = 'retry') LIMIT 5")
    .bind(iso(from), iso(now - SETTLE_MS)).all()).results) || [];
  for (const row of failed) if (await takeAppended(env, row, now, h) === 'done') out.appended++;
  // Move the window on only when nothing is waiting for another try.
  if (!out.retry) await env.DB.prepare("INSERT OR REPLACE INTO vm_meta (k, v) VALUES ('swept', ?1)").bind(iso(now)).run();
  if (out.delivered && h.ping !== false) {
    const ping = h.ping || (async (t, b) => (await import('./app.js')).opsPing(env, t, b, 'default', 'telephone_receiver'));
    await ping('Always Open: ' + out.delivered + (out.delivered === 1 ? ' call' : ' calls') + ' missed Max', (out.delivered === 1 ? 'It reached' : 'They reached') + ' the voicemail backup instead, and ' + (out.delivered === 1 ? 'it is' : 'they are') + ' now in the owners’ apps like any other call. Usually that means the site or Max was down for a few minutes.');
  }
  return out;
}
