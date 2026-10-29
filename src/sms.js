// Texting (Twilio). Every text the system sends goes through sendText, so the rules live in one place:
// nothing sends unless TEXTING_ON, the number has not opted out, and it is a decent hour for the customer.
// Replies come back through /voice/sms/<key> and land in the owner's inbox; STOP is honored at once.
// Tables create themselves on first use. Never logs a message body, only its length.

export const TEXTING_ON = true;   // the Twilio campaign is approved (Oct 28, 2026)
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/';
const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|no more|don'?t text( me)?|remove me)\b/i;
const START_RE = /^\s*(start|unstop|yes|resume)\b/i;
const HELP_RE = /^\s*(help|info)\b/i;
// Kinds that answer something the customer just did may go out at any hour; the rest wait for daytime.
const ANYTIME = new Set(['reply', 'test', 'textback', 'confirm', 'booking', 'onway']);   // answers to someone who just called or texted, and "on the way" (the owner is literally driving there)

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
  ]);
  ready = true;
}

function hourIn(tz) {
  try { return +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz || 'America/New_York' }).format(new Date()); }
  catch (e) { return new Date().getUTCHours() - 4; }
}

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
// Carrier rules (A2P 10DLC): every business that texts needs its own registered brand and campaign; one campaign can't
// speak for several companies. Always Open's own campaign covers Always Open's own number only. A client's texts go out
// through that client's own Messaging Service, set once their registration is approved; until then nothing is sent for them.
export const OWN = 'always-open';
async function ensureBrands(env) {
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
  if (!ANYTIME.has(kind)) { const h = hourIn(o.tz); if (h < 8 || h >= 21) { await log('held', 'after hours'); return { ok: false, why: 'after hours', retry: true }; } }
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
  const cid = line.client_id, now = new Date().toISOString();
  if (STOP_RE.test(body)) {
    await env.DB.prepare('INSERT OR REPLACE INTO sms_optout (client_id, phone10, at) VALUES (?1,?2,?3)').bind(cid, from10, now).run();
    await env.DB.prepare('UPDATE biz_customers SET optout = 1, agreed = 0, updated = ?1 WHERE client_id = ?2 AND phone10 = ?3').bind(now, cid, from10).run().catch(() => {});
    return xml();
  }
  if (START_RE.test(body) && await env.DB.prepare('SELECT 1 AS x FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, from10).first()) {
    await env.DB.prepare('DELETE FROM sms_optout WHERE client_id = ?1 AND phone10 = ?2').bind(cid, from10).run();
    await env.DB.prepare('UPDATE biz_customers SET optout = 0, updated = ?1 WHERE client_id = ?2 AND phone10 = ?3').bind(now, cid, from10).run().catch(() => {});
    return xml('<Message>You are back on the list for ' + (line.business || 'this business').replace(/[<&>]/g, '') + '. Reply STOP any time to end texts.</Message>');
  }
  if (HELP_RE.test(body)) return xml('<Message>This is the text line for ' + (line.business || 'this business').replace(/[<&>]/g, '') + '. Reply STOP to end texts. Call the business for anything else.</Message>');
  // A YES to a Fill my week offer books the time (fillweek.js pushes the owner); the text still lands in the inbox.
  let filled = null;
  try { filled = await (await import('./fillweek.js')).onReply(env, cid, from10, body); } catch (e) { filled = null; }
  const cu = await env.DB.prepare('SELECT name FROM biz_customers WHERE client_id = ?1 AND phone10 = ?2 LIMIT 1').bind(cid, from10).first().catch(() => null);
  const name = (cu && cu.name) || '';
  const sid = String(form.get('MessageSid') || '');
  await env.DB.prepare("INSERT OR IGNORE INTO biz_msgs (client_id, channel, thread, name, text, dir, at, status, ext_id) VALUES (?1,'text',?2,?3,?4,'in',?5,'new',?6)").bind(cid, from10, name, body, now, sid).run().catch(() => {});
  const who = name || ('(' + from10.slice(0, 3) + ') ' + from10.slice(3, 6) + '-' + from10.slice(6));
  if (filled) return xml();
  // An owner answering Always Open's own review ask: straight to Christopher's phone (ourreviews.js).
  if (cid === OWN) { try { const app = await import('./app.js'); if (await (await import('./ourreviews.js')).onReply(env, from10, body, (t, b, pr, tag) => app.opsPing(env, t, b, pr, tag))) return xml(); } catch (e) { /* falls through to the inbox push */ } }
  const { pushClient } = await import('./app.js').catch(() => ({ pushClient: async () => {} }));
  await pushClient(env, cid, { aps: { alert: { title: 'Text from ' + who, body: body.slice(0, 200) }, sound: 'default', 'thread-id': 'inbox' }, screen: 'inbox' }).catch(() => {});
  return xml();
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
