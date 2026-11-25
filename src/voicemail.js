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
//
// Nothing of a caller's voicemail is left on Twilio (Nov 24, 2026). Every recording ends one of three ways:
//   - its words reach the owner, and Twilio's copy is deleted;
//   - its words could not be written out, so the audio itself is moved into our own storage, whatever its size, for the
//     owner to hear for 14 days, and Twilio's copy is deleted;
//   - Twilio will not hand it over or will not delete it: it waits in vm_due, every sweep tries again, the owner hears it
//     the moment it comes in, and at 14 days Twilio's copy is deleted whatever happened. Christopher is told when a
//     delete is still being refused hours later.
// Once a day the sweep also lists every recording on the Twilio account and puts any that slipped past all of that (a
// callback that came late, an outage longer than the sweep looks back) through the same steps.
import { ownerOff } from './callbacks.js';
const SITE = 'https://alwaysopenoffice.com';
const TW = 'https://api.twilio.com/2010-04-01/Accounts/';
const VOICE = 'Polly.Matthew';
const SID_RE = /^CA[0-9a-f]{32}$/, REC_RE = /^RE[0-9a-f]{32}$/;
const SETTLE_MS = 2 * 60e3;          // a call this fresh may still be finishing its recording
const STUCK_MS = 90 * 60e3;          // a call row still "live" this long after it started never got its write-up
const TEXTBACK_MS = 30 * 60e3;       // the missed-call text only goes while the call is this fresh
const LOOKBACK_MS = 26 * 3600e3;     // never look further back than this, however long we were down
const MAX_TRIES = 3, PER_RUN = 8;
const PART = 1000000;                  // bytes of audio in one row (D1 holds 2 MB in one value); a longer recording takes more rows
const AUDIO_CAP = 24 * PART;           // the most we keep of one recording: over an hour and a half of Twilio's mp3. Our own voicemail stops at 3 minutes, about 0.7 MB
const AUDIO_KEEP_MS = 14 * 86400e3;    // a voicemail that could not be written out is kept this long for the owner to hear
const DUE_PER_RUN = 6, TW_PER_RUN = 40, NAG_TRIES = 12;
const COULD_NOT = 'They left a voicemail we could not write out. Listen to it here.';
const ON_ITS_WAY = 'They left a voicemail we could not write out. The recording is still coming in and will be here to listen to. Call them back.';
const NO_PLAY = 'They left a voicemail that could not be played back. Call them back.';
const NO_WORDS = 'They left a voicemail with no words we could make out. Call them back.';

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
    env.DB.prepare('CREATE TABLE IF NOT EXISTS vm_meta (k TEXT PRIMARY KEY, v TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS line_audio (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, mime TEXT, data BLOB, created TEXT)'),
    // a recording longer than one row: line_audio holds its first part, the rest are here in order (n = 1, 2, ...). at:
    // when the part was written (ms), so the daily sweep can tell a recording still being stored from one left half-done.
    env.DB.prepare('CREATE TABLE IF NOT EXISTS line_audio_parts (id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB, at INTEGER DEFAULT 0, PRIMARY KEY (id, n))'),
    // recordings Twilio still holds that we are not finished with. want: 'hear' (write it out for the owner), 'keep' (bring
    // the audio in for the owner), 'delete' (only Twilio's copy is left to remove). next: when to try again (ms).
    env.DB.prepare("CREATE TABLE IF NOT EXISTS vm_due (rec_sid TEXT PRIMARY KEY, call_sid TEXT DEFAULT '', client_id TEXT DEFAULT '', want TEXT, since TEXT, tries INTEGER DEFAULT 0, next INTEGER DEFAULT 0, why TEXT DEFAULT '')")
  ]);
  // Nov 24, 2026: voicemail audio shares the table with owners' greetings; kind '' is a greeting, 'voicemail' is kept 14 days.
  // bytes and parts: the whole recording's size and how many rows it takes (1 when it fits in this row).
  for (const col of ["kind TEXT DEFAULT ''", "call_id TEXT DEFAULT ''", 'bytes INTEGER DEFAULT 0', 'parts INTEGER DEFAULT 1']) { try { await env.DB.prepare('ALTER TABLE line_audio ADD COLUMN ' + col).run(); } catch (e) { /* already there */ } }
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
// A call to a line the owner paused never reaches Max: it rings through to their own phone (or hears a short message).
// It is noted here so the sweep never writes it up as a hang-up.
export async function markPassedBy(env, sid, note) {
  if (!SID_RE.test(String(sid || ''))) return;
  await ensureVoicemail(env);
  await env.DB.prepare("INSERT OR IGNORE INTO vm_seen (call_sid, at, status, tries, rec_sid, note) VALUES (?1, ?2, 'skipped', 0, '', ?3)").bind(sid, iso(Date.now()), String(note || 'line paused').slice(0, 200)).run();
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
// The finished voicemail on a call, if the caller left one worth hearing (two seconds or more). A finished recording
// shorter than that is a click or a breath: it is deleted from Twilio here, since nothing else would ever look at it.
async function recordingOf(env, sid, h, ctx) {
  const r = await tw(env, h, '/Calls/' + sid + '/Recordings.json');
  if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the call’s recordings');
  const j = await r.json();
  const done = (j.recordings || []).filter(x => x.status === 'completed' && REC_RE.test(x.sid || ''));
  for (const x of done) if (!(+x.duration >= 2)) await dropRecording(env, x.sid, h, Object.assign({ call: sid }, ctx || {}));
  return done.find(x => +x.duration >= 2) || null;
}
const vlog = (env, detail) => env.DB.prepare('INSERT INTO voice_log (at, kind, detail) VALUES (?1, ?2, ?3)').bind(iso(Date.now()), 'voicemail-audio', String(detail).slice(0, 600)).run().catch(() => {});

// A recording Twilio still holds that we are not finished with. It is tried again from the next sweep on (settle()).
// A row already waiting keeps its count and its clock; only what is wanted of it moves on. since: when the voicemail
// was left, when known (the 14 days count from then).
async function due(env, rec, callSid, clientId, want, now, why, since) {
  await env.DB.prepare("INSERT INTO vm_due (rec_sid, call_sid, client_id, want, since, tries, next, why) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7) ON CONFLICT(rec_sid) DO UPDATE SET want = CASE WHEN vm_due.want = 'delete' THEN 'delete' ELSE excluded.want END, why = excluded.why")
    .bind(rec, callSid || '', clientId || '', want, iso(Math.min(now, since || now)), now, String(why || '').slice(0, 200)).run();
}
// Delete Twilio's copy of a recording. Gone already counts. A refusal is not shrugged off: the recording waits in vm_due
// and the delete is tried again every sweep until Twilio takes it. ctx: { call, client, now, since }.
async function dropRecording(env, rec, h, ctx) {
  ctx = ctx || {};
  let ok = false, why = '';
  try { const r = await tw(env, h, '/Recordings/' + rec + '.json', 'DELETE'); ok = r.ok || r.status === 404; if (!ok) why = 'Twilio answered ' + r.status + ' to the delete'; }
  catch (e) { why = (e && e.message) || String(e); }
  try {
    if (ok) await env.DB.prepare('DELETE FROM vm_due WHERE rec_sid = ?1').bind(rec).run();
    else await due(env, rec, ctx.call, ctx.client, 'delete', ctx.now || Date.now(), why, ctx.since);
  } catch (e) { /* the daily look at Twilio's own list finds it again */ }
  return ok;
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[x % 62]).join('');
// Write a recording into our own storage as it arrives, a row at a time, so its size never matters: the first part in
// line_audio (written last, so a half-stored recording is never served), the rest in line_audio_parts. Past AUDIO_CAP
// the rest is left out; an mp3 cut short still plays up to the cut. Returns { id, bytes, cut }.
async function storeAudio(env, clientId, callSid, resp, now) {
  const id = newId();
  let first = null, n = 0, total = 0, cut = false, held = [], heldLen = 0;
  const put = async chunk => {
    if (n === 0) first = chunk; else await env.DB.prepare('INSERT INTO line_audio_parts (id, n, data, at) VALUES (?1, ?2, ?3, ?4)').bind(id, n, chunk, Date.now()).run();
    n++; total += chunk.length;
  };
  const take = size => {   // the next `size` bytes of what is held, as one array
    const out = new Uint8Array(size); let at = 0;
    while (at < size) { const c = held[0], want = size - at; if (c.length <= want) { out.set(c, at); at += c.length; held.shift(); } else { out.set(c.subarray(0, want), at); held[0] = c.subarray(want); at = size; } }
    heldLen -= size; return out;
  };
  try {
    const reader = resp.body ? resp.body.getReader() : null;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      held.push(value); heldLen += value.length;
      while (heldLen >= PART && total < AUDIO_CAP) await put(take(PART));
      if (total >= AUDIO_CAP && heldLen) { cut = true; held = []; heldLen = 0; try { await reader.cancel(); } catch (e) { /* closed already */ } break; }   // there is more audio than we keep
    }
    if (heldLen && total < AUDIO_CAP) await put(take(heldLen));   // the last, shorter part (the cap is a whole number of parts, so it always fits)
    if (!total) throw new Error('audio is empty');
    await env.DB.prepare("INSERT INTO line_audio (id, client_id, mime, data, created, kind, call_id, bytes, parts) VALUES (?1, ?2, 'audio/mpeg', ?3, ?4, 'voicemail', ?5, ?6, ?7)").bind(id, clientId, first, iso(now), callSid, total, n).run();
  } catch (e) {
    await env.DB.prepare('DELETE FROM line_audio_parts WHERE id = ?1').bind(id).run().catch(() => {});
    throw e;
  }
  return { id, bytes: total, cut };
}

// A recording we could not write out: its audio is moved into our own storage for the owner to hear, and Twilio's copy
// is deleted. Returns { id } when it is in; { gone: true } when Twilio no longer has it at all (nothing is left there);
// or { wait: true } when Twilio would not hand it over this time: it then waits in vm_due and is tried again every
// sweep. since: when the voicemail was left. The 14 days the owner can listen count from then, however late the audio came.
async function keepAudio(env, clientId, callSid, rec, h, now, since) {
  now = now || Date.now();
  try {
    const r = await tw(env, h, '/Recordings/' + rec + '.mp3');
    // a missing file is only "gone" when Twilio has no record of the recording either; otherwise it is tried again
    if (r.status === 404 && (await tw(env, h, '/Recordings/' + rec + '.json')).status === 404) {
      await env.DB.prepare('DELETE FROM vm_due WHERE rec_sid = ?1').bind(rec).run().catch(() => {});
      await vlog(env, 'call ' + callSid + ': Twilio no longer has the recording');
      return { gone: true };
    }
    if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the audio');
    const kept = await storeAudio(env, clientId, callSid, r, Math.min(now, since || now));
    if (kept.cut) await vlog(env, 'call ' + callSid + ': the recording is longer than we keep; its first ' + (AUDIO_CAP / PART) + ' MB is kept');
    await dropRecording(env, rec, h, { call: callSid, client: clientId, now, since });
    return { id: kept.id };
  } catch (e) {
    const why = (e && e.message) || String(e);
    await vlog(env, 'call ' + callSid + ': voicemail audio not in yet, trying again (' + why + ')');
    await due(env, rec, callSid, clientId, 'keep', now, why, since).catch(() => {});
    return { wait: true };
  }
}

// A call that never got to Max (or got cut off before Max wrote it up): write it up now.
// c: { sid, from, to, start, end, name }.
async function takeMissed(env, c, now, h) {
  const line = await env.DB.prepare('SELECT client_id FROM voice_lines WHERE number = ?1').bind(c.to).first();
  if (!line) return mark(env, c.sid, 'skipped', 'not one of our lines');
  const tries = await triesOf(env, c.sid);
  const left = Math.min(now, Date.parse(c.start) || now);   // when the voicemail was left
  const ctx = { call: c.sid, client: line.client_id, now, since: left };
  let rec = null, said = '', kept = null, heard = false;
  try {
    rec = await recordingOf(env, c.sid, h, ctx);
    if (rec) { said = (await transcribe(env, rec.sid, h)) || NO_WORDS; heard = true; }
  } catch (e) {
    if (tries + 1 < MAX_TRIES) { await mark(env, c.sid, 'retry', (e && e.message) || e, rec ? rec.sid : '', tries + 1); return 'retry'; }
    if (rec) {
      kept = await keepAudio(env, line.client_id, c.sid, rec.sid, h, now, left);
      said = kept.id ? COULD_NOT : kept.wait ? ON_ITS_WAY : NO_PLAY;
    }
  }
  await env.DB.prepare("INSERT OR IGNORE INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, status, notified, hq_synced, test) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'live', 'new', 0, 0, 0)")
    .bind(c.sid, line.client_id, c.to, iso(Date.parse(c.start) || now), c.from || '', clean(c.name)).run();
  const fresh = now - (Date.parse(c.end || c.start) || now) < TEXTBACK_MS;
  await (h.writeUp || (await import('./voice.js')).voicemailWriteUp)(env, c.sid, said, { textback: fresh });
  if (kept && (kept.id || kept.wait)) await env.DB.prepare('UPDATE app_calls SET summary = ?1, hq_synced = 0 WHERE id = ?2').bind(said, c.sid).run();   // the owner's words, not a paraphrase
  // Deleted from Twilio once the owner has what there is: the words, or "no words we could make out". (When the words
  // could not be written out at all, keepAudio above has already moved the audio here and deleted Twilio's copy, or
  // left the recording waiting in vm_due to be tried again.)
  if (rec && heard) await dropRecording(env, rec.sid, h, ctx);
  return mark(env, c.sid, 'done', rec ? 'voicemail' : 'no message', rec ? rec.sid : '', tries);
}

// A call Max had already written up as failed: the voicemail that followed goes to the owner as its own note.
async function takeAppended(env, row, now, h) {
  const tries = await triesOf(env, row.id);
  const ctx = { call: row.id, client: row.client_id, now };
  let rec = null, said = '', heard = false, kept = null;
  try {
    rec = await recordingOf(env, row.id, h, ctx);
    if (!rec) return mark(env, row.id, 'done', 'no voicemail after the failure');
    said = await transcribe(env, rec.sid, h);
    heard = true;
  } catch (e) {
    if (tries + 1 < MAX_TRIES) { await mark(env, row.id, 'retry', (e && e.message) || e, rec ? rec.sid : '', tries + 1); return 'retry'; }
    said = '';
    if (rec) kept = await keepAudio(env, row.client_id, row.id, rec.sid, h, now);
  }
  const whole = kept && (kept.id || kept.wait);   // a line that stands on its own, not "They left a voicemail: ..."
  const words = kept && kept.id ? COULD_NOT : kept && kept.wait ? ON_ITS_WAY : said || (heard ? NO_WORDS : NO_PLAY);
  await env.DB.prepare("UPDATE app_calls SET summary = ?1, details = TRIM(COALESCE(details, '') || ' ' || ?2), hq_synced = 0 WHERE id = ?3")
    .bind((whole ? words : 'They left a voicemail: ' + words).slice(0, 600), ('Voicemail: ' + words).slice(0, 2000), row.id).run();
  // A robocall that talks into the voicemail ("this is a recorded message, press 1") is filed as spam, with no push. Past
  // a line's daily limits that is most of what calls (Nov 24, 2026), and a flood of them must not buzz the owner's phone.
  let robo = false;
  if (heard && said) { try { robo = (await import('./voice.js')).looksRobo(said); } catch (e) { robo = false; } }
  if (robo) {
    await env.DB.prepare("UPDATE app_calls SET outcome = 'spam', hq_synced = 0 WHERE id = ?1 AND outcome IN ('limited', 'failed', 'hangup')").bind(row.id).run();
    await dropRecording(env, rec.sid, h, ctx);
    return mark(env, row.id, 'done', 'voicemail was a robocall', rec.sid, tries);
  }
  const app = h.app || await import('./app.js');
  const who = row.caller_name || row.caller || 'a caller';
  if (row.client_id === 'always-open') await app.opsPing(env, 'Always Open: voicemail from ' + who, words.slice(0, 600), 'default', 'telephone_receiver');
  else await app.pushClient(env, row.client_id, { aps: { alert: { title: 'Voicemail from ' + who, body: (words + (whole ? '' : ' Tap to call back.')).slice(0, 600) }, sound: 'default', 'thread-id': 'calls' }, screen: 'calls', call: row.id }).catch(() => {});
  if (rec && heard) await dropRecording(env, rec.sid, h, ctx);   // words or none: the owner has what there is (Nov 24, 2026)
  return mark(env, row.id, 'done', 'voicemail after the failure', rec ? rec.sid : '', tries);
}

// Every sweep: the recordings Twilio still holds that we are not finished with (vm_due). Each is tried again, less
// often as the tries mount (10 minutes, then 20, up to hourly). At 14 days whatever is left is deleted from Twilio.
async function settle(env, now, h, only) {   // only: one recording (Twilio's late note about it), not the whole queue
  const out = { tried: 0, cleared: 0 };
  const rows = ((only ? await env.DB.prepare('SELECT * FROM vm_due WHERE rec_sid = ?1').bind(only).all()
    : await env.DB.prepare('SELECT * FROM vm_due WHERE next <= ?1 ORDER BY next LIMIT ' + DUE_PER_RUN).bind(now).all()).results) || [];
  for (const d of rows) {
    out.tried++;
    const ctx = { call: d.call_sid, client: d.client_id, now };
    let want = d.want;
    if (want === 'keep' && now - (Date.parse(d.since) || now) >= AUDIO_KEEP_MS) {
      // 14 days of trying to bring the audio in. The privacy page promises the recording is gone by now, so only the
      // delete is left. (A recording still to be written out, 'hear', is delivered first: its write-up either deletes it
      // or turns it into a 'keep'.)
      want = 'delete';
      await env.DB.prepare("UPDATE vm_due SET want = 'delete' WHERE rec_sid = ?1").bind(d.rec_sid).run();
      await env.DB.prepare('UPDATE app_calls SET summary = ?1, hq_synced = 0 WHERE id = ?2 AND summary = ?3').bind(NO_PLAY, d.call_sid, ON_ITS_WAY).run().catch(() => {});
    }
    try {
      if (want === 'delete') await dropRecording(env, d.rec_sid, h, ctx);
      else if (want === 'hear') {
        // found on Twilio with no write-up: the same steps as a voicemail left after a failed call
        const row = await env.DB.prepare('SELECT id, client_id, caller, caller_name FROM app_calls WHERE id = ?1').bind(d.call_sid).first();
        if (!row) await dropRecording(env, d.rec_sid, h, ctx);
        else if (await takeAppended(env, row, now, h) === 'done') await env.DB.prepare("DELETE FROM vm_due WHERE rec_sid = ?1 AND want = 'hear'").bind(d.rec_sid).run();
      } else {
        const k = await keepAudio(env, d.client_id, d.call_sid, d.rec_sid, h, now, Date.parse(d.since) || now);
        if (k.id) await lateAudio(env, d, h);
        else if (k.gone) await env.DB.prepare('UPDATE app_calls SET summary = ?1, hq_synced = 0 WHERE id = ?2 AND summary = ?3').bind(NO_PLAY, d.call_sid, ON_ITS_WAY).run().catch(() => {});
      }
    } catch (e) { await vlog(env, 'recording ' + d.rec_sid + ': ' + ((e && e.message) || e)); }
    // still waiting? count the try and set the next one
    const left = await env.DB.prepare('SELECT want, why FROM vm_due WHERE rec_sid = ?1').bind(d.rec_sid).first().catch(() => null);
    if (!left) { out.cleared++; continue; }
    const tries = (+d.tries || 0) + 1;
    await env.DB.prepare('UPDATE vm_due SET tries = ?1, next = ?2 WHERE rec_sid = ?3').bind(tries, now + Math.min(tries, 6) * 10 * 60e3, d.rec_sid).run().catch(() => {});
    if (left.want === 'delete' && tries % NAG_TRIES === 0) {
      try { await (await import('./ops.js')).opsAlert(env, 'voicemail-stuck', '', 'Twilio has refused ' + tries + ' times to delete a voicemail recording (' + d.rec_sid + '): ' + (left.why || 'no reason given') + '. It is tried again every hour.'); } catch (e) { /* tried again next time */ }
    }
  }
  return out;
}
// The audio came in on a later try: the card gets its Listen button and the owner is told.
async function lateAudio(env, d, h) {
  await env.DB.prepare("UPDATE app_calls SET summary = ?1, hq_synced = 0 WHERE id = ?2 AND (summary = ?3 OR summary LIKE '%could not be played back%')").bind(COULD_NOT, d.call_sid, ON_ITS_WAY).run().catch(() => {});
  const row = await env.DB.prepare('SELECT caller, caller_name FROM app_calls WHERE id = ?1').bind(d.call_sid).first().catch(() => null);
  const who = (row && (row.caller_name || row.caller)) || 'a caller';
  try {
    const app = h.app || await import('./app.js');
    if (d.client_id === 'always-open') await app.opsPing(env, 'Always Open: voicemail from ' + who, 'The recording is in. Open the call to listen.', 'default', 'telephone_receiver');
    else await app.pushClient(env, d.client_id, { aps: { alert: { title: 'Voicemail from ' + who, body: 'The recording is ready. Tap to listen.' }, sound: 'default', 'thread-id': 'calls' }, screen: 'calls', call: d.call_sid });
  } catch (e) { /* the card has it either way */ }
}

// Once a day: Twilio's own list of recordings, so nothing of a customer's call is there that we do not know about. A
// recording on a call to a customer's line that is finished with is deleted; one nobody ever wrote out (its callback
// came after the call was written up, or we were down longer than the sweep looks back) goes through the usual steps.
// Test and sample calls are left to hearmax.js and the drill, which look after their own recordings.
async function sweepTwilio(env, now, h) {
  const last = await env.DB.prepare("SELECT v FROM vm_meta WHERE k = 'twilio_swept'").first().catch(() => null);
  if (last && now - Date.parse(last.v) < 86400e3) return null;
  const out = { seen: 0, deleted: 0, queued: 0 };
  // the one call the Hear Max page is waiting on keeps its recording until hearmax.js has saved it
  const armed = await env.DB.prepare("SELECT call_sid FROM hear_max_arm WHERE k = 'arm' AND status = 'calling'").first().catch(() => null);
  let path = '/Recordings.json?PageSize=200', work = 0, full = true;
  scan: for (let page = 0; page < 5 && path; page++) {
    const r = await tw(env, h, path);
    if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the list of recordings');
    const j = await r.json();
    for (const x of j.recordings || []) {
      if (!REC_RE.test(x.sid || '') || !SID_RE.test(x.call_sid || '')) continue;
      if (now - (Date.parse(x.date_created) || 0) < 2 * 3600e3) continue;   // the ordinary steps may still be at work on it
      out.seen++;
      if (await env.DB.prepare('SELECT 1 AS y FROM vm_due WHERE rec_sid = ?1').bind(x.sid).first()) continue;   // already being tried
      if (armed && armed.call_sid === x.call_sid) continue;
      if (/^(in-progress|paused|processing)$/.test(String(x.status || ''))) continue;   // still being made: the ordinary steps take it
      const call = await env.DB.prepare('SELECT id, client_id, number, at, caller, caller_name, outcome, test FROM app_calls WHERE id = ?1').bind(x.call_sid).first();
      if (call && +call.test) continue;
      const seen = await env.DB.prepare('SELECT status, rec_sid FROM vm_seen WHERE call_sid = ?1').bind(x.call_sid).first();
      if (!call && seen && seen.status === 'skipped') continue;   // looked up before: not a customer's call (a drill call we placed, say)
      if (work >= TW_PER_RUN) { full = false; break scan; }   // the rest at the next sweep, ten minutes on
      work++;
      if (!call) {
        // never written up at all: is it a call to one of our customers' lines?
        const cr = await tw(env, h, '/Calls/' + x.call_sid + '.json');
        if (!cr.ok) { full = false; continue; }
        const c = await cr.json();
        const line = c.direction === 'inbound' ? await env.DB.prepare('SELECT client_id FROM voice_lines WHERE number = ?1').bind(c.to || '').first() : null;
        if (!line) { await mark(env, x.call_sid, 'skipped', 'a recording on a call that is not to a customer’s line'); continue; }
        if (await takeMissed(env, { sid: x.call_sid, from: c.from, to: c.to, start: c.start_time, end: c.end_time || c.start_time, name: c.caller_name }, now, h) === 'retry') full = false;
        out.queued++; continue;
      }
      const ctx = { call: x.call_sid, client: call.client_id, now, since: Date.parse(x.date_created) || now };
      const have = await env.DB.prepare("SELECT 1 AS y FROM line_audio WHERE kind = 'voicemail' AND call_id = ?1").bind(x.call_sid).first();
      const card = await env.DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(x.call_sid).first();
      const unheard = /could not be played back/.test((card && card.summary) || '');   // the owner was told there was a voicemail but never got it
      if (x.status !== 'completed' || !(+x.duration >= 2) || have || (seen && seen.status === 'done' && seen.rec_sid === x.sid && !unheard)) {
        if (await dropRecording(env, x.sid, h, ctx)) out.deleted++;
        continue;
      }
      if (call.outcome === 'live') {
        // not written up yet. The sweep's own pass takes a stuck call within a day; past that (we were down longer) it is done here
        if (now - (Date.parse(call.at) || now) > LOOKBACK_MS - 3600e3 && await takeMissed(env, { sid: call.id, from: call.caller, to: call.number, start: call.at, end: call.at, name: call.caller_name }, now, h) === 'retry') full = false;
        continue;
      }
      await due(env, x.sid, x.call_sid, call.client_id, unheard ? 'keep' : 'hear', now, 'found on Twilio with no write-up', Date.parse(x.date_created) || now);
      out.queued++;
    }
    path = j.next_page_uri || '';
  }
  if (full) await env.DB.prepare("INSERT OR REPLACE INTO vm_meta (k, v) VALUES ('twilio_swept', ?1)").bind(iso(now)).run();
  return out;
}

// Twilio's note that a recording finished (the recordingStatusCallback on our voicemail). The words go out at once.
export async function voicemailHook(env, form, h) {
  h = h || {};
  const sid = String(form.get('CallSid') || ''), st = String(form.get('RecordingStatus') || '');
  if (!SID_RE.test(sid) || (st && st !== 'completed')) return 'ignored';
  await ensureVoicemail(env);
  const seen = await env.DB.prepare('SELECT status, rec_sid FROM vm_seen WHERE call_sid = ?1').bind(sid).first().catch(() => null);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT id, client_id, number, at, caller, caller_name, outcome FROM app_calls WHERE id = ?1').bind(sid).first();
  if (seen && seen.status === 'done') {
    // Written up already. If this is a recording that write-up never saw (it finished late), it still goes to the owner
    // and off Twilio: it waits in vm_due and is taken from there, now and at each sweep until it is done.
    const rs = String(form.get('RecordingSid') || '');
    if (!REC_RE.test(rs) || seen.rec_sid === rs || !row || row.outcome === 'live') return 'already';
    await due(env, rs, sid, row.client_id, 'hear', now, 'finished after the call was written up');
    await settle(env, now, h, rs);
    return 'late';
  }
  if (row && row.outcome !== 'live') return takeAppended(env, row, now, h);
  if (row) return takeMissed(env, { sid, from: row.caller, to: row.number, start: row.at, end: iso(now), name: row.caller_name }, now, h);
  const r = await tw(env, h, '/Calls/' + sid + '.json');
  if (!r.ok) return 'unknown call';
  const c = await r.json();
  return takeMissed(env, { sid, from: c.from, to: c.to, start: c.start_time, end: c.end_time || iso(now), name: c.caller_name }, now, h);
}

// Once a day: voicemail audio older than 14 days is deleted (its row stays as a note for 60 days so the link can say so).
// Greeting audio (kind '') is never touched.
async function sweepAudio(env, now) {
  try {
    const last = await env.DB.prepare("SELECT v FROM vm_meta WHERE k = 'audio_swept'").first();
    if (last && now - Date.parse(last.v) < 86400e3) return;
    await env.DB.prepare("DELETE FROM line_audio_parts WHERE id IN (SELECT id FROM line_audio WHERE kind = 'voicemail' AND created < ?1)").bind(iso(now - AUDIO_KEEP_MS)).run();
    await env.DB.prepare("UPDATE line_audio SET data = NULL WHERE kind = 'voicemail' AND data IS NOT NULL AND created < ?1").bind(iso(now - AUDIO_KEEP_MS)).run();
    await env.DB.prepare("DELETE FROM line_audio WHERE kind = 'voicemail' AND created < ?1").bind(iso(now - 60 * 86400e3)).run();
    // parts whose recording never finished storing (the worker was stopped partway): gone once they are an hour old.
    // Not younger ones: a recording being stored right now writes its first part last.
    await env.DB.prepare('DELETE FROM line_audio_parts WHERE at < ?1 AND id NOT IN (SELECT id FROM line_audio)').bind(Math.min(now, Date.now()) - 3600e3).run();
    await env.DB.prepare("INSERT OR REPLACE INTO vm_meta (k, v) VALUES ('audio_swept', ?1)").bind(iso(now)).run();
  } catch (e) { /* tried again at the next sweep */ }
}

// Every 10 minutes: the calls to our numbers that have no write-up, and failed calls that may have a voicemail.
export async function vmSweep(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return { off: true };
  await ensureVoicemail(env);
  await sweepAudio(env, now);
  // Twilio's copies first, whatever happens below: (once a day) Twilio's own list, then what is waiting to be tried again.
  try { await sweepTwilio(env, now, h); } catch (e) { await vlog(env, 'the daily look at Twilio’s recordings failed: ' + ((e && e.message) || e)); }
  try { await settle(env, now, h); } catch (e) { await vlog(env, 'the waiting recordings could not be tried: ' + ((e && e.message) || e)); }
  // Lines on the air for callers: HQ has them on and the owner has not paused Max (as withOwner in app.js). Calls to a
  // paused line ring through to the owner's phone; they were never Max's to miss.
  const lines = new Set((((await env.DB.prepare('SELECT number, owner_set FROM voice_lines WHERE on_air = 1').all()).results) || []).filter(r => !ownerOff(r.owner_set)).map(r => r.number));
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
  // Not a call Max is putting through (transferred = 2): that one is written up from the dial's result (voice.js).
  const stuck = ((await env.DB.prepare("SELECT c.id, c.number, c.caller, c.caller_name, c.at FROM app_calls c LEFT JOIN vm_seen v ON v.call_sid = c.id WHERE c.outcome = 'live' AND c.test = 0 AND COALESCE(c.transferred, 0) != 2 AND c.at > ?1 AND c.at < ?2 AND (v.call_sid IS NULL OR v.status = 'retry') LIMIT 5")
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
