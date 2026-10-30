// Hear Max: a real call on the website. Max records no customer's call, ever. The one sample comes from a staged call
// Christopher makes himself:
//   1. He opens /ops/hear-max?t=<ops board token> on his phone, types the number he will call from, and taps Ready.
//      That arms the Always Open line for 30 minutes, for that one number, for one call.
//   2. He calls (706) 460-2226 from that number. Max answers as Mike’s Plumbing, a made-up plumber with real prices and hours on file (its greeting already says the
//      call may be recorded), and Twilio records that call only (<Start><Recording>). The call is marked a test.
//   3. When the recording is done, Twilio calls /voice/recorded/<VOICE_KEY>; we fetch the MP3, keep it in hear_max, delete
//      Twilio's copy, and push "Hear Max sample saved". A 10-minute job does the same if that callback never came.
//   4. /hear-max.json says whether a sample exists (seconds, caption, the call written out); /hear-max.mp3 serves it with
//      byte ranges (iPhones need them). The site shows the player only when a sample exists.
// A newer good recording (8 seconds or more) replaces the old one; replaced ones are deleted after a week.
const SITE = 'https://alwaysopenoffice.com';
const ARM_MS = 30 * 60e3;
const MIN_SECONDS = 8;
export const SAMPLE_CLIENT = 'demo-plumbing';
const E164 = /^\+1\d{10}$/;
const ready = new WeakSet();
export async function ensureHear(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hear_max (id TEXT PRIMARY KEY, call_sid TEXT, at TEXT, seconds INTEGER, lang TEXT DEFAULT 'en', mime TEXT, data BLOB, caption TEXT DEFAULT '', current INTEGER DEFAULT 0)").run();
  // The part of the call the site plays: starting mid-call, at the hard question, so the first thing a visitor hears is Max handling it.
  for (const c of ['start_at INTEGER DEFAULT 0', 'end_at INTEGER DEFAULT 0']) { try { await env.DB.prepare('ALTER TABLE hear_max ADD COLUMN ' + c).run(); } catch (e) { /* already there */ } }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hear_max_arm (k TEXT PRIMARY KEY, from_ TEXT, as_client TEXT, lang TEXT DEFAULT 'en', until TEXT, call_sid TEXT DEFAULT '', used_at TEXT DEFAULT '', status TEXT DEFAULT '')").run();
  ready.add(env.DB);
}
const twilioAuth = env => 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);

export async function arm(env, from, lang, now) {
  await ensureHear(env);
  const d = String(from || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) return { ok: false, error: 'Type the 10-digit number you will call from.' };
  const e164 = '+1' + d, l = lang === 'es' ? 'es' : 'en';
  await env.DB.prepare("INSERT INTO hear_max_arm (k, from_, as_client, lang, until, call_sid, used_at, status) VALUES ('arm', ?1, ?2, ?3, ?4, '', '', 'armed') ON CONFLICT(k) DO UPDATE SET from_ = excluded.from_, as_client = excluded.as_client, lang = excluded.lang, until = excluded.until, call_sid = '', used_at = '', status = 'armed'")
    .bind(e164, SAMPLE_CLIENT, l, new Date((now || Date.now()) + ARM_MS).toISOString()).run();
  return { ok: true, from: e164, lang: l };
}
// Called by the voice webhook for a call to Always Open's own line. Returns the line to answer as, or null. Uses the arm up.
export async function takeArm(env, from, callSid, now) {
  try { await ensureHear(env); } catch (e) { return null; }
  const r = await env.DB.prepare("SELECT * FROM hear_max_arm WHERE k = 'arm' AND status = 'armed' AND from_ = ?1 AND until > ?2").bind(String(from || ''), new Date(now || Date.now()).toISOString()).first().catch(() => null);
  if (!r) return null;
  const line = await env.DB.prepare('SELECT * FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(r.as_client).first().catch(() => null);
  if (!line) return null;
  const u = await env.DB.prepare("UPDATE hear_max_arm SET status = 'calling', call_sid = ?1, used_at = ?2 WHERE k = 'arm' AND status = 'armed'").bind(callSid, new Date(now || Date.now()).toISOString()).run();
  if (!(u.meta && u.meta.changes)) return null;
  return { line, lang: r.lang || 'en' };
}
export function recordingTwiml(env) {
  return '<Start><Recording channels="mono" recordingStatusCallback="' + SITE + '/voice/recorded/' + env.VOICE_KEY + '" recordingStatusCallbackEvent="completed"/></Start>';
}

function captionFor(industry, at) {
  // A staged sample call, said plainly: it is our demo line, not a customer's business.
  const who = { plumbing: 'Our demo plumbing line', hvac: 'Our demo heating and air line', electrical: 'Our demo electrician’s line', salon: 'Our demo salon line' }[industry] || 'Our demo line';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return who + ', ' + p.weekday + ' at ' + p.hour + ':' + p.minute + ' ' + (p.dayPeriod || '').toUpperCase();
}
// Fetch Twilio's MP3, keep it, delete Twilio's copy. `h.fetch` for tests.
export async function saveRecording(env, rec, h) {
  await ensureHear(env);
  const a = await env.DB.prepare("SELECT * FROM hear_max_arm WHERE k = 'arm' AND call_sid = ?1").bind(String(rec.callSid || '')).first().catch(() => null);
  if (!a) return { ok: false, why: 'not the armed call' };
  const f = (h && h.fetch) || fetch;
  const seconds = Math.round(+rec.seconds || 0);
  if (seconds < MIN_SECONDS) {
    await env.DB.prepare("UPDATE hear_max_arm SET status = 'too short' WHERE k = 'arm'").run();
    if (h && h.ping) await h.ping('Hear Max: that call was too short', 'The recording was ' + seconds + ' seconds. Open the Hear Max page again and make a call of 20 to 30 seconds.');
    return { ok: false, why: 'too short' };
  }
  const r = await f(String(rec.url).replace(/\.(mp3|wav)$/, '') + '.mp3', { headers: { authorization: twilioAuth(env) } });
  if (!r.ok) return { ok: false, why: 'Twilio answered ' + r.status };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 2000) return { ok: false, why: 'empty file' };
  const line = await env.DB.prepare('SELECT industry FROM voice_lines WHERE client_id = ?1 LIMIT 1').bind(a.as_client).first().catch(() => null);
  const at = a.used_at || new Date().toISOString(), lang = a.lang || 'en';
  const caption = (lang === 'es' ? 'En español. ' : '') + (env.HEAR_MAX_CAPTION || captionFor(line && line.industry, at));
  await env.DB.batch([
    env.DB.prepare('UPDATE hear_max SET current = 0 WHERE lang = ?1').bind(lang),
    env.DB.prepare('INSERT OR REPLACE INTO hear_max (id, call_sid, at, seconds, lang, mime, data, caption, current) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)').bind(String(rec.sid), a.call_sid, at, seconds, lang, 'audio/mpeg', bytes, caption),
    env.DB.prepare("UPDATE hear_max_arm SET status = 'saved' WHERE k = 'arm'"),
    env.DB.prepare('DELETE FROM hear_max WHERE current = 0 AND at < ?1').bind(new Date(Date.now() - 7 * 864e5).toISOString())
  ]);
  try { await f('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Recordings/' + rec.sid + '.json', { method: 'DELETE', headers: { authorization: twilioAuth(env) } }); } catch (e) { /* Twilio keeps its copy; harmless */ }
  if (h && h.ping) await h.ping('Hear Max sample saved, ' + seconds + ' seconds', 'It is live on the site now' + (lang === 'es' ? ' (the Spanish one)' : '') + '. Tap to hear it the way visitors will.', SITE + '/#hear');
  return { ok: true, seconds, bytes: bytes.length };
}
// Twilio's status callback (form post).
export async function recordedHook(env, form, h) {
  if (String(form.get('RecordingStatus') || '') !== 'completed') return { ok: false, why: 'not completed' };
  return saveRecording(env, { sid: form.get('RecordingSid'), url: form.get('RecordingUrl'), seconds: form.get('RecordingDuration'), callSid: form.get('CallSid') }, h);
}
// Every 10 minutes: an armed call that ended over three minutes ago with nothing saved gets looked up once more.
export async function hearMaxCron(env, now, h) {
  now = now || Date.now();
  await ensureHear(env);
  const a = await env.DB.prepare("SELECT * FROM hear_max_arm WHERE k = 'arm' AND status = 'calling' AND call_sid != ''").first().catch(() => null);
  if (!a) return { skipped: 'nothing waiting' };
  if (now - Date.parse(a.used_at) < 3 * 60e3) return { skipped: 'call may still be on' };
  if (now - Date.parse(a.used_at) > 2 * 864e5) {
    await env.DB.prepare("UPDATE hear_max_arm SET status = 'missed' WHERE k = 'arm'").run();
    if (h && h.alert) await h.alert('hear-max', 'always-open', 'The Hear Max call (' + a.call_sid + ') never produced a recording. Open the Hear Max page and call again.');
    return { missed: true };
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return { skipped: 'no Twilio keys' };
  const f = (h && h.fetch) || fetch;
  const r = await f('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Calls/' + a.call_sid + '/Recordings.json', { headers: { authorization: twilioAuth(env) } });
  const j = await r.json().catch(() => ({}));
  const rec = (j.recordings || []).find(x => x.status === 'completed');
  if (!rec) return { skipped: 'no recording yet' };
  return saveRecording(env, { sid: rec.sid, url: 'https://api.twilio.com' + String(rec.uri || '').replace(/\.json$/, ''), seconds: rec.duration, callSid: a.call_sid }, h);
}

// The call written out, for people who would rather read it. Max's lines and the caller's, nothing else.
async function transcriptOf(env, callSid) {
  const r = await env.DB.prepare('SELECT transcript FROM app_calls WHERE id = ?1').bind(callSid).first().catch(() => null);
  let t = []; try { t = JSON.parse((r && r.transcript) || '[]'); } catch (e) { t = []; }
  return t.filter(x => x && x.t).slice(0, 24).map(x => ({ who: x.w === 'caller' ? 'Caller' : 'Max', t: String(x.t).slice(0, 300) }));
}
export async function current(env, lang) {
  await ensureHear(env);
  return env.DB.prepare('SELECT id, call_sid, at, seconds, caption, lang, start_at, end_at FROM hear_max WHERE current = 1 AND lang = ?1 ORDER BY at DESC LIMIT 1').bind(lang === 'es' ? 'es' : 'en').first().catch(() => null);
}
export async function serveJson(env, url) {
  const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
  const c = await current(env, lang);
  const head = { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' };
  if (!c) return new Response(JSON.stringify({ ok: false }), { status: 404, headers: head });
  const w = clipOf(c);
  return new Response(JSON.stringify({ ok: true, src: '/hear-max' + (lang === 'es' ? '-es' : '') + '.mp3?v=' + encodeURIComponent(c.id.slice(-8)), seconds: w.to - w.from, from: w.from, to: w.to, caption: c.caption, lines: await transcriptOf(env, c.call_sid) }), { headers: head });
}
// The window the site plays, in whole seconds inside the recording.
export function clipOf(c) {
  const len = Math.max(0, +c.seconds || 0);
  const from = Math.min(Math.max(0, +c.start_at || 0), Math.max(0, len - 5));
  const to = (+c.end_at || 0) > from + 4 ? Math.min(+c.end_at, len) : len;
  return { from, to };
}
// The MP3, with byte ranges: Safari asks for bytes=0-1 first and plays nothing without a 206.
export async function serveAudio(env, req, lang) {
  const c = await current(env, lang);
  if (!c) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT data FROM hear_max WHERE id = ?1').bind(c.id).first();
  const all = row && row.data ? new Uint8Array(row.data) : new Uint8Array(0);
  const head = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (m && all.length) {
    let start = m[1] === '' ? Math.max(0, all.length - (+m[2] || 0)) : +m[1], end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], all.length - 1) : all.length - 1;
    if (start > end || start >= all.length) return new Response(null, { status: 416, headers: Object.assign({ 'content-range': 'bytes */' + all.length }, head) });
    return new Response(req.method === 'HEAD' ? null : all.slice(start, end + 1), { status: 206, headers: Object.assign({ 'content-range': 'bytes ' + start + '-' + end + '/' + all.length, 'content-length': String(end - start + 1) }, head) });
  }
  return new Response(req.method === 'HEAD' ? null : all, { headers: Object.assign({ 'content-length': String(all.length) }, head) });
}

// The page Christopher opens from the ops board: arm the line, hear what is live, take it down.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function armPage(env, req, url, okToken) {
  if (!okToken) return new Response('Open this from the ops board link.', { status: 403 });
  await ensureHear(env);
  let note = '';
  if (req.method === 'POST') {
    const f = await req.formData().catch(() => new FormData());
    if (f.get('action') === 'clip') {
      const lang = f.get('lang') === 'es' ? 'es' : 'en', num = k => Math.max(0, Math.round(+String(f.get(k) || '0').replace(/[^\d.]/g, '') || 0));
      const cap = String(f.get('caption') || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      await env.DB.prepare('UPDATE hear_max SET start_at = ?1, end_at = ?2' + (cap ? ', caption = ?4' : '') + ' WHERE current = 1 AND lang = ?3').bind(num('start'), num('end'), lang, cap).run();
      note = 'Saved. The site now plays the part you picked.';
    }
    else if (f.get('action') === 'remove') { await env.DB.prepare('UPDATE hear_max SET current = 0 WHERE lang = ?1').bind(f.get('lang') === 'es' ? 'es' : 'en').run(); note = 'Taken down. The site shows no player until you record a new one.'; }
    else { const r = await arm(env, f.get('from'), f.get('lang')); note = r.ok ? 'READY' : r.error; }
  }
  const a = await env.DB.prepare("SELECT * FROM hear_max_arm WHERE k = 'arm'").first().catch(() => null);
  const en = await current(env, 'en'), es = await current(env, 'es');
  const armed = a && a.status === 'armed' && Date.parse(a.until) > Date.now();
  const say = { calling: 'A call is on or just ended. The recording shows up here within a few minutes.', saved: 'Saved and live on the site.', 'too short': 'The last call was too short to use. Arm again and talk for 20 to 30 seconds.', missed: 'The last call left no recording. Arm again and call.' };
  const live = (c, l) => { if (!c) return ''; const w = clipOf(c); return '<div class="card"><b>' + (l === 'es' ? 'Spanish sample' : 'Live on the site') + ': ' + (w.to - w.from) + ' seconds' + (w.from ? ', starting ' + w.from + ' seconds in' : '') + '</b><p>' + esc(c.caption) + '</p><audio controls preload="none" src="/hear-max' + (l === 'es' ? '-es' : '') + '.mp3?v=' + esc(c.id.slice(-8)) + '"></audio><p>That is the whole recording (' + c.seconds + ' seconds). Find where the hard question starts, then set the part the site plays.</p><form method="post" class="clip"><input type="hidden" name="action" value="clip"><input type="hidden" name="lang" value="' + l + '"><label>Start at second<input name="start" inputmode="numeric" value="' + w.from + '"></label><label>End at second (0 = the end)<input name="end" inputmode="numeric" value="' + (+c.end_at || 0) + '"></label><label>Caption under the player<input name="caption" value="' + esc(c.caption) + '"></label><button>Save the part the site plays</button></form><form method="post"><input type="hidden" name="action" value="remove"><input type="hidden" name="lang" value="' + l + '"><button class="line">Take it down</button></form></div>'; };
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Hear Max sample</title><style>' +
    'body{margin:0;background:#0F131B;color:#ECEEF3;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:20px 16px}main{max-width:520px;margin:0 auto;display:grid;gap:14px}h1{margin:0;font-size:1.6rem}p{margin:0;color:#C9D0DC}' +
    '.card{border:1.5px solid #262E40;border-radius:16px;padding:16px;display:grid;gap:10px}.ok{border-color:#FF6A5E;box-shadow:0 0 24px rgba(255,90,77,.3)}label{display:grid;gap:6px;font-weight:600}input,select{font:inherit;padding:12px;border-radius:11px;border:1.5px solid #262E40;background:#171D2C;color:#ECEEF3}' +
    'button,.call{font:700 17px system-ui,sans-serif;min-height:48px;padding:12px 18px;border-radius:12px;border:0;background:#D92D20;color:#fff;text-decoration:none;text-align:center;display:block}button.line{background:transparent;border:2px solid #C9D0DC;color:#ECEEF3}audio{width:100%}</style></head><body><main>' +
    '<h1>Hear Max on the website</h1><p>One staged call becomes the sample visitors play on the home page. Only your number, only for the next 30 minutes, only one call. Max answers as the demo plumbing line, and its greeting already says the call may be recorded.</p>' +
    (note === 'READY' || armed ? '<div class="card ok"><b>Ready. Call now from ' + esc(a.from_) + '.</b><p>Play the tough caller from the script: start simple, then ask the hard question all at once. Give a made-up name and number, and hang up after Max wraps up. A minute or two is fine; you pick the part the site plays afterward. Twenty to thirty seconds is plenty.' + (a.lang === 'es' ? ' Speak Spanish the whole call.' : '') + '</p><a class="call" href="tel:+17064602226">Call (706) 460-2226</a><p>Ready until ' + esc(new Date(a.until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })) + '.</p></div>' : '') +
    (note && note !== 'READY' ? '<div class="card"><p>' + esc(note) + '</p></div>' : '') +
    (!armed && a && say[a.status] ? '<div class="card"><p>' + esc(say[a.status]) + '</p></div>' : '') +
    live(en, 'en') + live(es, 'es') +
    (armed ? '' : '<form method="post" class="card"><label>The number you will call from<input name="from" inputmode="tel" autocomplete="tel" placeholder="478-555-0123" required></label><label>Language<select name="lang"><option value="en">English</option><option value="es">Spanish</option></select></label><button>Ready, I will call now</button></form>') +
    '</main></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
