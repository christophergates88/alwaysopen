// Texting (Twilio). Every text the system sends goes through sendText, so the rules live in one place:
// nothing sends unless TEXTING_ON, the number has not opted out, and it is a decent hour for the customer.
// Replies come back through /voice/sms/<key> and land in the owner's inbox; STOP is honored at once.
// Tables create themselves on first use. Never logs a message body, only its length.

export const TEXTING_ON = true;   // the Twilio campaign is approved (Oct 28, 2026)
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/';
// Carrier keywords count only when they are the whole text ("STOP", "stop.", " Help "), never the first word of a
// sentence: "Cancel my appointment Tuesday" or "Stop by after 3" is a message for the owner, not an opt-out.
const STOP_WORDS = new Set(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout', 'opt out', 'opt-out', 'stop texting me', "don't text me", 'dont text me', 'do not text me', 'remove me']);
const START_WORDS = new Set(['start', 'unstop', 'yes']);   // only for a number that opted out
const HELP_WORDS = new Set(['help', 'info']);
// Someone saying in plain words to stop texting them, anywhere in the text, is an opt-out too ("Please stop texting me",
// "Remove me from your list"). "Stop by after 3" and "cancel my appointment" are not.
const STOP_SAID = /\b(?:stop|quit) (?:texting|messaging|sending (?:me )?(?:texts|messages))\b|\b(?:don'?t|do not|never) (?:text|message) me\b|\b(?:remove|take) me (?:off|from) (?:your|the|this) (?:list|texts|text list|messages)\b|\bunsubscribe me\b|\bno more (?:texts|messages)\b/i;
export function keywordOf(body) {
  const w = String(body || '').replace(/[‘’]/g, "'").trim().toLowerCase().replace(/[\s.!]+$/, '').replace(/\s+/g, ' ');
  if (STOP_WORDS.has(w) || STOP_SAID.test(w)) return 'stop';
  return START_WORDS.has(w) ? 'start' : (HELP_WORDS.has(w) ? 'help' : '');
}
// Kinds that answer something the customer just did may go out at any hour; the rest wait for daytime.
const ANYTIME = new Set(['reply', 'test', 'textback', 'confirm', 'booking', 'onway', 'ops']);   // 'ops': only ever to Christopher; push.js decides the hour
const TEXTS_PER_CLIENT_HOUR = 60, TEXTS_PER_HOUR = 400;   // answers to someone who just called or texted, and "on the way" (the owner is literally driving there)
const TEXTS_PER_CLIENT_DAY = 200;   // automatic texts for one business in a day, whatever starts them

export function textingReady(env) { return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN); }

export function ph10(s) {
  let d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : '';
}

let ready = false;
export async function ensureSms(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS sms_log (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, to10 TEXT NOT NULL, at TEXT, kind TEXT DEFAULT '', sid TEXT DEFAULT '', status TEXT DEFAULT '', why TEXT DEFAULT '', len INTEGER DEFAULT 0)"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sms_optout (client_id TEXT NOT NULL, phone10 TEXT NOT NULL, at TEXT, PRIMARY KEY (client_id, phone10))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sms_log_client ON sms_log (client_id, at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sms_seen (sid TEXT PRIMARY KEY, at TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sms_meta (k TEXT PRIMARY KEY, v TEXT)'),
  ]);
  ready = true;
}

function hourIn(tz, now) {
  const d = new Date(now || Date.now());
  try { return +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz || 'America/New_York' }).format(d); }
  catch (e) { return (d.getUTCHours() + 20) % 24; }
}
// Daytime for the customer (8 AM to 9 PM in the business's zone): when texts that aren't an answer may go out.
export function textDaytime(tz, now) { const h = hourIn(tz, now); return h >= 8 && h < 21; }

async function optedOut(env, cid, p10) {
  const a = await env.DB.prepare('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, p10).first().catch(() => null);
  if (a) return true;
  const b = await env.DB.prepare('SELECT 1 AS x FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 AND optout = 1').bind(cid, p10).first().catch(() => null);
  return !!b;
}

async function fromFor(env, cid) {
  const l = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 AND on_air = 1 ORDER BY updated DESC LIMIT 1').bind(cid).first().catch(() => null);
  return (l && l.number) || env.TWILIO_FROM || '';
}
// The business's own texting number (the one its customers text), or '' when it has none of its own.
export async function ownNumber(env, cid) {
  const l = await env.DB.prepare('SELECT number FROM voice_lines WHERE client_id = ?1 AND on_air = 1 ORDER BY updated DESC LIMIT 1').bind(cid).first().catch(() => null);
  return /^\+1\d{10}$/.test((l && l.number) || '') ? l.number : '';
}
// Carrier rules (A2P 10DLC): every business that texts needs its own registered brand and campaign; one campaign can't
// speak for several companies. Always Open's own campaign covers Always Open's own number only. A client's texts go out
// through that client's own Messaging Service, set once their registration is approved; until then nothing is sent for them.
export const OWN = 'always-open';
export async function ensureBrands(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sms_brands (client_id TEXT PRIMARY KEY, messaging_sid TEXT DEFAULT '', status TEXT DEFAULT 'pending', updated TEXT)").run();
}
export async function senderFor(env, cid) {
  if (cid === OWN) return env.TWILIO_MESSAGING_SID ? { mg: env.TWILIO_MESSAGING_SID } : { mg: '' };
  await ensureBrands(env);
  const b = await env.DB.prepare("SELECT messaging_sid FROM sms_brands WHERE client_id = ?1 AND status = 'approved'").bind(cid).first().catch(() => null);
  return b && /^MG[0-9a-f]{32}$/i.test(b.messaging_sid || '') ? { mg: b.messaging_sid } : null;
}
export async function setBrand(env, cid, mg, status) {
  await ensureBrands(env);
  await env.DB.prepare('INSERT INTO sms_brands (client_id, messaging_sid, status, updated) VALUES (?1,?2,?3,?4) ON CONFLICT(client_id) DO UPDATE SET messaging_sid = excluded.messaging_sid, status = excluded.status, updated = excluded.updated').bind(cid, mg || '', status || 'pending', new Date().toISOString()).run();
}

// sendText(env, { clientId, to, body, kind, tz }) -> { ok, sid?, why? }. kind: reply | test | textback | confirm | reminder | revive | invoice | review.
export async function sendText(env, o) {
  const cid = String(o.clientId || ''), to10 = ph10(o.to), kind = String(o.kind || 'other'), body = String(o.body || '').trim().slice(0, 1000);
  const log = async (status, why, sid) => { try { await ensureSms(env); await env.DB.prepare('INSERT INTO sms_log (client_id, to10, at, kind, sid, status, why, len) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(cid, to10, new Date().toISOString(), kind, sid || '', status, why || '', body.length).run(); } catch (e) {} };
  if (!TEXTING_ON) return { ok: false, why: 'texting off' };
  if (!textingReady(env)) { await log('skipped', 'not set up'); return { ok: false, why: 'texting not set up' }; }
  if (!to10 || !body || !cid) return { ok: false, why: 'bad number' };
  await ensureSms(env);
  if (await optedOut(env, cid, to10)) { await log('skipped', 'opted out'); return { ok: false, why: 'opted out' }; }
  if (!ANYTIME.has(kind) && !textDaytime(o.tz)) { await log('held', 'after hours'); return { ok: false, why: 'after hours', retry: true }; }
  // The hourly ceiling: something looping can't text hundreds of customers before anyone looks. What an owner types
  // (reply) and tests always go; automatic texts wait for the next hour (checks.js watches the daily totals too).
  // A day's ceiling per business as well, so nothing (a busy public page, a loop) runs one number into the ground.
  if (kind !== 'reply' && kind !== 'test') {
    const hour = new Date(Date.now() - 3600e3).toISOString(), day = new Date(Date.now() - 24 * 3600e3).toISOString(), sent = "status NOT IN ('skipped', 'held', 'failed')";
    const [mine, all, today] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM sms_log WHERE client_id = ?1 AND at > ?2 AND ' + sent).bind(cid, hour).first().catch(() => null),
      env.DB.prepare('SELECT COUNT(*) AS n FROM sms_log WHERE at > ?1 AND ' + sent).bind(hour).first().catch(() => null),
      cid === OWN ? null : env.DB.prepare("SELECT COUNT(*) AS n FROM sms_log WHERE client_id = ?1 AND at > ?2 AND kind NOT IN ('reply', 'test') AND " + sent).bind(cid, day).first().catch(() => null)]);
    if (today && +today.n >= TEXTS_PER_CLIENT_DAY) {
      await log('held', 'daily ceiling');
      try { await (await import('./ops.js')).opsAlert(env, 'text-ceiling', cid, 'One business sent ' + today.n + ' automatic texts in the last day, so its automatic texts are waiting. Look at the ops board for what is sending them.'); } catch (e) { /* the hold stands */ }
      return { ok: false, why: 'held: daily ceiling', retry: true };
    }
    if ((mine && +mine.n >= TEXTS_PER_CLIENT_HOUR) || (all && +all.n >= TEXTS_PER_HOUR)) {
      await log('held', 'hourly ceiling');
      try { await (await import('./ops.js')).opsAlert(env, 'text-ceiling', cid, (mine && +mine.n >= TEXTS_PER_CLIENT_HOUR ? 'One business sent ' + mine.n : 'All businesses together sent ' + all.n) + ' automatic texts in the last hour, so automatic texts are waiting for the next hour. Look at the ops board for what is sending them.'); } catch (e) { /* the hold stands */ }
      return { ok: false, why: 'held: hourly ceiling', retry: true };
    }
  }
  const form = new URLSearchParams({ To: '+1' + to10, Body: body });
  // The A2P campaign lives on a Messaging Service; the text still goes out from the client's own number so replies reach their line.
  const sender = await senderFor(env, cid);
  if (!sender) { await log('skipped', 'not registered'); return { ok: false, why: 'texting not registered for this business' }; }
  const from = await fromFor(env, cid);
  if (sender.mg) { form.set('MessagingServiceSid', sender.mg); if (from) form.set('From', from); }
  else { if (!from) { await log('skipped', 'no number'); return { ok: false, why: 'no number to send from' }; } form.set('From', from); }
  let r, j = {};
  try {
    r = await fetch(TWILIO + env.TWILIO_ACCOUNT_SID + '/Messages.json', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    j = await r.json().catch(() => ({}));
  } catch (e) { await log('failed', 'unreachable'); return { ok: false, why: 'Twilio unreachable' }; }
  if (!r.ok || !j.sid) { const why = String((j && j.message) || ('Twilio answered ' + r.status)).slice(0, 160); await log('failed', why); return { ok: false, why }; }
  await log(j.status || 'queued', '', j.sid);
  return { ok: true, sid: j.sid };
}

// Twilio "A message comes in" webhook: /voice/sms/<VOICE_KEY>. STOP ends texting for that number with that business;
// anything else goes to the owner's inbox as a text thread. Twilio also handles STOP on its own side.
export async function handleSms(req, env, form, sigOk) {
  if (!sigOk) return new Response('Forbidden', { status: 403 });
  const from10 = ph10(form.get('From')), to = String(form.get('To') || ''), body = String(form.get('Body') || '').trim().slice(0, 1600);
  const xml = (s) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + (s || '') + '</Response>', { headers: { 'content-type': 'text/xml' } });
  const line = await env.DB.prepare('SELECT client_id, business FROM voice_lines WHERE number = ?1').bind(to).first().catch(() => null);
  if (!line || !from10) return xml();
  await ensureSms(env);
  // Each text once: Twilio retrying, or the sweep below picking up one we already have, changes nothing.
  const msgSid = String(form.get('MessageSid') || '');
  if (/^SM[0-9a-f]{32}$/.test(msgSid)) {
    const fresh = await env.DB.prepare('INSERT OR IGNORE INTO sms_seen (sid, at) VALUES (?1, ?2)').bind(msgSid, new Date().toISOString()).run().catch(() => null);
    if (fresh && fresh.meta && fresh.meta.changes === 0) return xml();
  }
  const cid = line.client_id, now = new Date().toISOString(), biz = (line.business || 'this business').replace(/[<&>]/g, '');
  // STOP, START and HELP only when they are the whole text. Whatever it is, the text is saved for the owner below.
  let key = keywordOf(body), reply = '', mark = '';
  if (key === 'start' && !(await env.DB.prepare('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, from10).first().catch(() => null))) key = '';
  if (key === 'stop') {
    await env.DB.prepare('INSERT OR REPLACE INTO sms_optout (client_id, phone10, at) VALUES (?1,?2,?3)').bind(cid, from10, now).run();
    await env.DB.prepare('UPDATE biz_customers SET optout = 1, agreed = 0, updated = ?1 WHERE client_id = ?2 AND phone10 = ?3').bind(now, cid, from10).run().catch(() => {});
    mark = 'Opted out of texts';
  } else if (key === 'start') {
    await env.DB.prepare('DELETE FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, from10).run();
    await env.DB.prepare('UPDATE biz_customers SET optout = 0, updated = ?1 WHERE client_id = ?2 AND phone10 = ?3').bind(now, cid, from10).run().catch(() => {});
    reply = '<Message>You are back on the list for ' + biz + '. Reply STOP any time to end texts.</Message>';
    mark = 'Back on texts';
  } else if (key === 'help') {
    reply = '<Message>This is the text line for ' + biz + '. Reply STOP to end texts. Call the business for anything else.</Message>';
    mark = 'Answered automatically';
  }
  // A YES to a Fill my week offer books the time (fillweek.js pushes the owner); the text still lands in the inbox.
  let filled = null;
  if (!key) { try { filled = await (await import('./fillweek.js')).onReply(env, cid, from10, body); } catch (e) { filled = null; } }
  const cu = await env.DB.prepare('SELECT name FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 LIMIT 1').bind(cid, from10).first().catch(() => null);
  const name = (cu && cu.name) || '';
  const sid = String(form.get('MessageSid') || '');
  await env.DB.prepare("INSERT OR IGNORE INTO biz_msgs (client_id, channel, thread, name, text, dir, at, by, status, ext_id) VALUES (?1,'text',?2,?3,?4,'in',?5,?6,'new',?7)").bind(cid, from10, name, body, now, mark, sid || null).run().catch(() => {});
  const who = name || ('(' + from10.slice(0, 3) + ') ' + from10.slice(3, 6) + '-' + from10.slice(6));
  // Someone who booked online and ticked "text me" proves the number is theirs by texting in: their confirmation goes now.
  // (A YES to a Fill my week offer books through the same path just above, so its confirmation goes here too.)
  if (key !== 'stop') { try { await (await import('./autotext.js')).textedIn(env, cid, from10); } catch (e) { /* the timer picks it up */ } }
  if (filled) return xml(reply);
  // An owner answering Always Open's own review ask: straight to Christopher's phone (ourreviews.js).
  if (cid === OWN && !key) { try { const app = await import('./app.js'); if (await (await import('./ourreviews.js')).onReply(env, from10, body, (t, b, pr, tag) => app.opsPing(env, t, b, pr, tag))) return xml(); } catch (e) { /* falls through to the inbox push */ } }
  const said = key === 'stop' ? '“' + body + '”: they won’t get texts from you any more. Call them if you need to reach them.' : (key === 'start' ? '“' + body + '”: they’re back on texts from you.' : body);
  const { pushClient } = await import('./app.js').catch(() => ({ pushClient: async () => {} }));
  await pushClient(env, cid, { aps: { alert: { title: 'Text from ' + who, body: said.slice(0, 200) }, sound: 'default', 'thread-id': 'inbox' }, screen: 'inbox' }).catch(() => {});
  return xml(reply);
}

// Owner replies to a text thread from the inbox: msg-text-<phone10>.
export async function replyText(env, c, thread, text) {
  const to10 = ph10(thread);
  if (!to10) return { ok: false, error: 'Bad thread' };
  const r = await sendText(env, { clientId: c.client_id, to: to10, body: text, kind: 'reply' });
  if (!r.ok) return { ok: false, error: r.why === 'opted out' ? 'They asked not to be texted.' : (r.why === 'texting not set up' ? 'Texting is not set up yet.' : 'The text did not go through. Try again, or call them.') };
  await env.DB.prepare("INSERT INTO biz_msgs (client_id, channel, thread, name, text, dir, at, by, status, ext_id) VALUES (?1,'text',?2,'',?3,'out',?4,?5,'read',?6)").bind(c.client_id, to10, text, new Date().toISOString(), c.staff || 'Owner', r.sid).run().catch(() => {});
  return { ok: true };
}

export async function smsCounts(env, cid, since) {
  await ensureSms(env);
  const r = await env.DB.prepare("SELECT SUM(CASE WHEN status IN ('queued','sent','delivered','accepted','sending') THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM sms_log WHERE client_id = ?1 AND at > ?2").bind(cid, since || '').first().catch(() => null);
  return { sent: +(r && r.sent) || 0, failed: +(r && r.failed) || 0 };
}

// Texts that never reached us. When the site is down, Twilio still receives a customer's text (a reply to the owner, a
// YES to a Fill my week offer, a STOP) but cannot hand it to us, and nothing retries it. Every 10 minutes this asks
// Twilio for the texts to our numbers and runs any we never saw through handleSms, exactly as if it had just arrived
// (the inbox, the owner's push, the opt-out list). Automatic answers (HELP, START) are not sent this late.
// Starts from the first run after this was added, so texts handled before sms_seen existed are never handled twice.
const SWEEP_SETTLE_MS = 2 * 60e3, SWEEP_LOOKBACK_MS = 26 * 3600e3;
export async function smsSweep(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!textingReady(env)) return { off: true };
  await ensureSms(env);
  const meta = async k => { const r = await env.DB.prepare('SELECT v FROM sms_meta WHERE k = ?1').bind(k).first().catch(() => null); return r ? Date.parse(r.v) || 0 : 0; };
  const put = (k, t) => env.DB.prepare('INSERT OR REPLACE INTO sms_meta (k, v) VALUES (?1, ?2)').bind(k, new Date(t).toISOString()).run();
  const start = await meta('start');
  if (!start) { await put('start', now); await put('swept', now); return { started: true }; }
  const lines = new Set((((await env.DB.prepare('SELECT number FROM voice_lines').all()).results) || []).map(r => r.number));
  if (!lines.size) return { lines: 0 };
  const swept = await meta('swept');
  const from = Math.max(start, now - SWEEP_LOOKBACK_MS, (swept || now) - 30 * 60e3);
  const f = h.fetch || fetch, auth = 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
  const msgs = [];
  let url = TWILIO + env.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=200&DateSent%3E=' + new Date(from).toISOString().slice(0, 10);
  for (let page = 0; page < 5 && url; page++) {
    const r = await f(url, { headers: { authorization: auth } });
    if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the list of texts');
    const j = await r.json();
    for (const m of j.messages || []) msgs.push(m);
    url = j.next_page_uri ? 'https://api.twilio.com' + j.next_page_uri : '';
  }
  const cand = msgs.filter(m => m.direction === 'inbound' && lines.has(m.to) && /^SM[0-9a-f]{32}$/.test(m.sid || '') &&
    (Date.parse(m.date_sent || m.date_created) || 0) >= from && now - (Date.parse(m.date_sent || m.date_created) || now) >= SWEEP_SETTLE_MS);
  const seen = new Set();
  for (let i = 0; i < cand.length; i += 50) {
    const ids = cand.slice(i, i + 50).map(m => m.sid);
    for (const r of ((await env.DB.prepare('SELECT sid FROM sms_seen WHERE sid IN (' + ids.map((_, k) => '?' + (k + 1)).join(',') + ')').bind(...ids).all()).results || [])) seen.add(r.sid);
  }
  const missed = cand.filter(m => !seen.has(m.sid)).sort((a, b) => Date.parse(a.date_sent) - Date.parse(b.date_sent)).slice(0, 20);
  for (const m of missed) await handleSms(null, env, new URLSearchParams({ MessageSid: m.sid, From: m.from || '', To: m.to || '', Body: m.body || '' }), true);
  await put('swept', now);
  if (missed.length && h.ping !== false) {
    const ping = h.ping || (async (t, b) => (await import('./app.js')).opsPing(env, t, b, 'default', 'speech_balloon'));
    await ping('Always Open: ' + missed.length + (missed.length === 1 ? ' text' : ' texts') + ' picked up late', (missed.length === 1 ? 'A customer text' : 'Customer texts') + ' arrived while the site could not take ' + (missed.length === 1 ? 'it' : 'them') + '. ' + (missed.length === 1 ? 'It is' : 'They are') + ' now in the owners’ inboxes.');
  }
  return { checked: cand.length, delivered: missed.length };
}
