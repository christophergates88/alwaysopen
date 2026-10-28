// Voice check-in after the job. Three days after the owner logs a finished job, if the customer agreed to a quick call and
// the owner turned check-in calls on, Max calls once between 10 AM and 6 PM their time: "Did the work hold up?"
// Yes becomes the review ask. No reaches the owner before it becomes a one-star review. Never on regulated lines.
// Outbound rules are the same as every other call Max places: automated-and-recorded notice first, 9 or stop ends it for good.
import { dialOut, callOptedOut, tzFor, local, fromLocal, fmtPhone, xml, xa, ensureCallbacks } from './callbacks.js';
import { sendText, TEXTING_ON } from './sms.js';
const pushClient = async (...a) => { try { return await (await import('./app.js')).pushClient(...a); } catch (e) { return 0; } };
const logAct = async (...a) => { try { return await (await import('./biz.js')).logAct(...a); } catch (e) {} };

const DAYS_AFTER = 3;

let ready = false;
export async function ensureCheckins(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, phone TEXT NOT NULL, first TEXT DEFAULT '', job TEXT DEFAULT '', due_at TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, result TEXT DEFAULT '', note TEXT DEFAULT '', created TEXT, done_at TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS checkins_due ON checkins (status, due_at)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS checkin_prefs (client_id TEXT PRIMARY KEY, on_ INTEGER DEFAULT 0, updated TEXT DEFAULT '')"),
  ]);
  ready = true;
}

export async function checkinsOn(env, cid) {
  await ensureCheckins(env);
  const r = await env.DB.prepare('SELECT on_ FROM checkin_prefs WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return !!(r && +r.on_);
}

// App: POST /api/checkins { on: bool }
export async function apiCheckins(req, env, c) {
  await ensureCheckins(env);
  if (c.regulated) return { ok: false, error: 'Check-in calls are not available for regulated businesses.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (typeof b.on !== 'boolean') return { ok: false, error: 'Bad request' };
  await env.DB.prepare('INSERT INTO checkin_prefs (client_id, on_, updated) VALUES (?1,?2,?3) ON CONFLICT(client_id) DO UPDATE SET on_ = excluded.on_, updated = excluded.updated').bind(c.client_id, b.on ? 1 : 0, new Date().toISOString()).run();
  return { ok: true, on: b.on, message: b.on ? 'Check-in calls are on.' : 'Check-in calls are off.' };
}

// Called when a finished job is logged with the customer's OK for a call.
export async function scheduleCheckin(env, c, first, phone10, job) {
  if (!phone10 || c.regulated || !(await checkinsOn(env, c.client_id))) return null;
  const tz = await tzFor(env, c.client_id);
  const day = new Date(Date.now() + DAYS_AFTER * 864e5).toISOString().slice(0, 10);
  const due = fromLocal(tz, day, 11, 0);
  await env.DB.prepare('INSERT INTO checkins (client_id, phone, first, job, due_at, status, created) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(c.client_id, '+1' + phone10, String(first || '').slice(0, 40), String(job || '').slice(0, 80), new Date(due).toISOString(), 'pending', new Date().toISOString()).run();
  return true;
}

function callWindowOk(tz) { const h = local(tz, Date.now()).hour; return h >= 10 && h < 18; }

// Every 10 minutes: place the due check-in calls.
export async function checkinCron(env) {
  await ensureCheckins(env); await ensureCallbacks(env);
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return { calls: 0 };
  const due = ((await env.DB.prepare("SELECT k.*, l.number, l.business, l.regulated FROM checkins k LEFT JOIN voice_lines l ON l.client_id = k.client_id WHERE k.status = 'pending' AND k.due_at <= ?1 AND k.attempts < 2 ORDER BY k.due_at LIMIT 30").bind(new Date().toISOString()).all()).results) || [];
  let calls = 0;
  for (const r of due) {
    if (!r.number || +r.regulated) { await env.DB.prepare("UPDATE checkins SET status = 'skipped', result = 'no line' WHERE id = ?1").bind(r.id).run(); continue; }
    if (!(await checkinsOn(env, r.client_id))) { await env.DB.prepare("UPDATE checkins SET status = 'skipped', result = 'turned off' WHERE id = ?1").bind(r.id).run(); continue; }
    if (await callOptedOut(env, r.client_id, r.phone)) { await env.DB.prepare("UPDATE checkins SET status = 'skipped', result = 'opted out' WHERE id = ?1").bind(r.id).run(); continue; }
    const tz = await tzFor(env, r.client_id);
    if (!callWindowOk(tz)) continue;   // try again on a later tick
    const d = await dialOut(env, { number: r.number }, r.phone, '/voice/ci/' + env.VOICE_KEY + '?id=' + r.id, '/voice/cistatus/' + env.VOICE_KEY + '?id=' + r.id);
    await env.DB.prepare('UPDATE checkins SET attempts = attempts + 1, result = ?1 WHERE id = ?2').bind(d.ok ? 'calling' : 'failed: ' + String(d.why || '').slice(0, 80), r.id).run();
    if (d.ok) { calls++; await logAct(env, { client_id: r.client_id, staff: 'Max' }, 'Max called ' + (r.first || fmtPhone(r.phone)) + ' to check the work held up'); }
  }
  return { calls };
}

async function row(env, id) { return id ? await env.DB.prepare('SELECT k.*, l.business, c.review_link FROM checkins k LEFT JOIN voice_lines l ON l.client_id = k.client_id LEFT JOIN app_clients c ON c.client_id = k.client_id WHERE k.id = ?1').bind(id).first() : null; }

// Twilio asks what to say: /voice/ci/<key>?id=
export async function checkinTwiml(env, url, form) {
  const id = +url.searchParams.get('id') || 0, r = await row(env, id);
  if (!r) return xml('<Hangup/>');
  const biz = xa(r.business || 'the business');
  if (String(form.get('AnsweredBy') || '').startsWith('machine')) {
    await env.DB.prepare("UPDATE checkins SET result = 'voicemail', due_at = ?1 WHERE id = ?2").bind(new Date(Date.now() + 864e5).toISOString(), id).run();
    return xml('<Say>Hi, this is Max, the automated assistant for ' + biz + '. Just checking the recent work held up. If anything is not right, call ' + biz + ' and they will sort it out. Thank you.</Say><Hangup/>');
  }
  const first = r.first ? 'Hi ' + xa(r.first) + '. ' : 'Hi. ';
  const act = SITE(env) + '/voice/cig/' + env.VOICE_KEY + '?id=' + id;
  return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" action="' + xa(act) + '" method="POST"><Say>' + first + 'This is Max, the automated assistant for ' + biz + '. This call may be recorded. Quick one: did the ' + xa(r.job || 'work') + ' hold up? Press 1 or say yes if it did. Press 2 if something is not right. Press 9 if you would rather not get calls like this.</Say></Gather><Say>Sorry, I did not catch that. If anything is not right, call ' + biz + '. Thank you. Goodbye.</Say><Hangup/>');
}
const SITE = () => 'https://alwaysopenoffice.com';

// The customer answered: /voice/cig/<key>?id=
export async function checkinGather(env, url, form) {
  const id = +url.searchParams.get('id') || 0, r = await row(env, id);
  if (!r) return xml('<Hangup/>');
  const d = String(form.get('Digits') || ''), sp = String(form.get('SpeechResult') || '').toLowerCase();
  const yes = d === '1' || /\b(yes|yeah|yep|it did|fine|good|great|all good)\b/.test(sp), no = d === '2' || /\b(no|not|problem|issue|wrong|leak|broke|again)\b/.test(sp), stop = d === '9' || /\b(stop|don'?t call|do not call|remove)\b/.test(sp);
  const who = r.first || fmtPhone(r.phone), biz = xa(r.business || 'the business'), now = new Date().toISOString();
  if (stop) {
    await env.DB.prepare('INSERT OR REPLACE INTO call_optout (client_id, phone10, at) VALUES (?1,?2,?3)').bind(r.client_id, r.phone.replace(/\D/g, '').slice(-10), now).run();
    await env.DB.prepare("UPDATE checkins SET status = 'optout', result = 'asked not to be called', done_at = ?1 WHERE id = ?2").bind(now, id).run();
    return xml('<Say>Understood. No more calls like this. Goodbye.</Say><Hangup/>');
  }
  if (no) {
    await env.DB.prepare("UPDATE checkins SET status = 'no', result = 'something is not right', done_at = ?1 WHERE id = ?2").bind(now, id).run();
    await ensureCallbacks(env);
    await env.DB.prepare("INSERT INTO callbacks (client_id, call_sid, phone, name, reason, due_at, status, created, urgent, note) VALUES (?1,'',?2,?3,?4,?5,'asap',?6,1,?7)")
      .bind(r.client_id, r.phone, r.first || '', 'Check-in: something is not right with the ' + (r.job || 'work'), now, now, 'They told Max the work did not hold up.').run();
    await pushClient(env, r.client_id, { aps: { alert: { title: who + ' says something is not right', body: 'Max checked in on the ' + (r.job || 'job') + '. Call them before it becomes a review.' }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' });
    return xml('<Say>Sorry to hear that. He will call you himself to put it right. Thank you for telling me. Goodbye.</Say><Hangup/>');
  }
  if (yes) {
    await env.DB.prepare("UPDATE checkins SET status = 'yes', result = 'held up', done_at = ?1 WHERE id = ?2").bind(now, id).run();
    let tail = 'Glad to hear it. Thank you. Goodbye.';
    const link = /^https:\/\//.test(r.review_link || '') ? r.review_link : '';
    if (link && TEXTING_ON) {
      const t = await sendText(env, { clientId: r.client_id, to: r.phone, kind: 'review', body: (r.first ? r.first + ', thanks' : 'Thanks') + ' for letting ' + (r.business || 'us') + ' help. If you have a minute, a quick Google review means a lot: ' + link + ' Reply STOP to end texts.' });
      if (t.ok) { tail = 'Glad to hear it. A link to leave a quick review is on its way by text, if you have a minute. Thank you. Goodbye.'; await env.DB.prepare("UPDATE checkins SET note = 'review link texted' WHERE id = ?1").bind(id).run(); }
    }
    return xml('<Say>' + tail + '</Say><Hangup/>');
  }
  return xml('<Say>Sorry, I did not catch that. If anything is not right, call ' + biz + '. Thank you. Goodbye.</Say><Hangup/>');
}

export async function checkinStatus(env, url, form) {
  const id = +url.searchParams.get('id') || 0, st = String(form.get('CallStatus') || '');
  if (id && /^(no-answer|busy|failed|canceled)$/.test(st)) {
    const r = await env.DB.prepare('SELECT attempts FROM checkins WHERE id = ?1').bind(id).first();
    if (r && +r.attempts >= 2) await env.DB.prepare("UPDATE checkins SET status = 'noanswer', result = ?1 WHERE id = ?2 AND status = 'pending'").bind(st, id).run();
    else await env.DB.prepare("UPDATE checkins SET result = ?1, due_at = ?2 WHERE id = ?3 AND status = 'pending'").bind(st, new Date(Date.now() + 864e5).toISOString(), id).run();
  }
  return new Response('ok');
}

export async function checkinState(env, cid) {
  await ensureCheckins(env);
  const on = await checkinsOn(env, cid);
  const m0 = new Date(); m0.setUTCDate(1); m0.setUTCHours(0, 0, 0, 0);
  const rows = ((await env.DB.prepare('SELECT status, COUNT(*) AS n FROM checkins WHERE client_id = ?1 AND created >= ?2 GROUP BY status').bind(cid, m0.toISOString()).all()).results) || [];
  const c = { yes: 0, no: 0, noanswer: 0, pending: 0 };
  for (const r of rows) if (c[r.status] != null) c[r.status] = +r.n;
  const line = c.yes + c.no + c.noanswer ? 'Check-ins this month: ' + c.yes + ' held up' + (c.no ? ', ' + c.no + ' needed a second visit' : '') + (c.noanswer ? ', ' + c.noanswer + ' could not be reached' : '') + '.' : '';
  return { on, month: c, line };
}
