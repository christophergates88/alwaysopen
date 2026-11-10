// More reasons for Max to pick up the phone, all to the owner or to a customer who already agreed to hear from the business:
//   to the owner:    urgent  (an active problem is on the line right now), rundown (the day, once, at 7 AM)
//   to a customer:   confirm (the day before an appointment), noshow (missed it: offer a new time), onway (tap "on my way"),
//                    quote (an estimate nobody answered, three days on), due (a past customer who agreed to calls, six months on)
// The customer's yes is the one already on file: the box the owner checked when the appointment, quote or job was logged,
// or the OK for a call at the finished job. Nobody is asked twice. Every customer call follows the one set of rules in
// callbacks.js (8 AM to 9 PM for them, automated-and-recorded notice first, "stop" or 9 ends calls for good, two tries,
// never on regulated lines). Owner switches live in the app under After the call.
import { dialOut, callOptedOut, tzFor, local, fromLocal, fmtPhone, xml, xa, ensureCallbacks, callHoursOk, readAnswer, lineLive, ph10 } from './callbacks.js';
const pushClient = async (...a) => { try { return await (await import('./app.js')).pushClient(...a); } catch (e) { return 0; } };
const logAct = async (...a) => { try { return await (await import('./biz.js')).logAct(...a); } catch (e) {} };

export const KINDS = {
  urgent: { owner: true, def: 1, label: 'Ring me on an urgent call', sub: 'Max rings your phone the moment a caller has an active problem, on top of the alert.' },
  rundown: { owner: true, def: 0, label: 'Morning rundown call', sub: 'A one-minute call at 7 AM with the day’s visits and call-backs.' },
  confirm: { def: 1, label: 'Confirm appointments', sub: 'The day before, Max calls the customer to confirm or find a new time.' },
  noshow: { def: 1, label: 'Rebook missed visits', sub: 'If a customer misses a visit, Max calls once to offer a new time.' },
  onway: { def: 1, label: 'On-my-way call', sub: 'When you tap On my way on a job, Max calls the customer as well as texting.' },
  quote: { def: 0, label: 'Follow up on estimates', sub: 'Three days after an estimate with no answer, Max calls once to ask if they want a call from you.' },
  due: { def: 0, label: 'Due-for-service calls', sub: 'Six months after a job, Max calls customers who said calls are OK to offer to set up the next visit.' },
  // Not calls, but switches the owner flips in the same place: Max's behavior toward the owner.
  summary: { owner: true, setting: true, def: 1, label: 'Text me after every call', sub: 'Within a minute of each call: who called, what they need, how urgent, and their number to tap. Between 9 PM and 8 AM only urgent calls are texted; the rest are waiting in the app in the morning.' }
};
const KEYS = Object.keys(KINDS);

const readyDBs = new WeakSet();
export async function ensureOutcalls(env) {
  if (readyDBs.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS outcalls (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT NOT NULL, name TEXT DEFAULT '', topic TEXT DEFAULT '', ref TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, result TEXT DEFAULT '', created TEXT DEFAULT '', done_at TEXT DEFAULT '')"),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS outcalls_ref ON outcalls (client_id, ref)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS outcalls_due ON outcalls (status, due_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS outcall_prefs (client_id TEXT NOT NULL, k TEXT NOT NULL, on_ INTEGER DEFAULT 0, PRIMARY KEY (client_id, k))'),
  ]);
  await ensureCallbacks(env);
  readyDBs.add(env.DB);
}

export async function prefsOf(env, cid, regulated) {
  await ensureOutcalls(env);
  const out = {};
  for (const k of KEYS) out[k] = regulated ? false : !!KINDS[k].def;
  if (regulated) return out;
  const rows = ((await env.DB.prepare('SELECT k, on_ FROM outcall_prefs WHERE client_id = ?1').bind(cid).all()).results) || [];
  for (const r of rows) if (r.k in out) out[r.k] = !!+r.on_;
  return out;
}

// App: POST /api/outcalls { key, on }
export async function apiOutcalls(req, env, c) {
  await ensureOutcalls(env);
  if (+c.regulated) return { ok: false, error: 'Calls out are not available for regulated businesses.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (!KEYS.includes(b.key) || typeof b.on !== 'boolean') return { ok: false, error: 'Bad request' };
  await env.DB.prepare('INSERT INTO outcall_prefs (client_id, k, on_) VALUES (?1,?2,?3) ON CONFLICT(client_id, k) DO UPDATE SET on_ = excluded.on_').bind(c.client_id, b.key, b.on ? 1 : 0).run();
  return { ok: true, key: b.key, on: b.on, message: KINDS[b.key].label + (b.on ? ' is on.' : ' is off.') };
}
export async function outcallsState(env, c) {
  const on = await prefsOf(env, c.client_id, +c.regulated);
  return { on, list: KEYS.map(x => ({ key: x, owner: !!KINDS[x].owner, setting: !!KINDS[x].setting, label: KINDS[x].label, sub: KINDS[x].sub })) };
}

async function lineOf(env, cid) { return await env.DB.prepare('SELECT number, business, regulated, on_air, owner_set, transfer_to FROM voice_lines WHERE client_id = ?1 ORDER BY number LIMIT 1').bind(cid).first().catch(() => null); }
const e164 = p => { const d = ph10(p); return d ? '+1' + d : ''; };

// Queue a call once (the ref is the guard). Returns the new id, or 0 when it was already queued.
export async function queue(env, o) {
  await ensureOutcalls(env);
  const ph = e164(o.phone); if (!ph) return 0;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO outcalls (client_id, kind, phone, name, topic, ref, due_at, status, created) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending',?8)")
    .bind(o.client_id, o.kind, ph, String(o.name || '').slice(0, 40), String(o.topic || '').slice(0, 500), o.ref, o.due_at || new Date().toISOString(), new Date().toISOString()).run();
  return r && r.meta && r.meta.changes ? r.meta.last_row_id : 0;
}

// An urgent call is on the line now: ring the owner (their own number, any hour).
export async function ringOwner(env, cid, sid, text) {
  try {
    await ensureOutcalls(env);
    const c = await env.DB.prepare('SELECT phone, regulated, active FROM app_clients WHERE client_id = ?1').bind(cid).first();
    if (!c || +c.regulated || (c.active != null && !+c.active)) return false;
    if (!(await prefsOf(env, cid, 0)).urgent) return false;
    const id = await queue(env, { client_id: cid, kind: 'urgent', phone: c.phone, name: '', topic: String(text || '').slice(0, 120), ref: 'urgent:' + sid });
    if (!id) return false;
    const row = await env.DB.prepare('SELECT * FROM outcalls WHERE id = ?1').bind(id).first();
    return await place(env, row);
  } catch (e) { return false; }
}

// "On my way" on a job: one call to the customer, if the owner has it on and they have not opted out.
export async function queueOnWay(env, c, job, who, mins) {
  try {
    if (+c.regulated || !(await prefsOf(env, c.client_id, 0)).onway) return false;
    const id = await queue(env, { client_id: c.client_id, kind: 'onway', phone: job.phone, name: String(job.name || '').split(' ')[0], topic: (who || 'Someone') + ' is on the way' + (mins >= 5 && mins <= 240 ? ', about ' + mins + ' minutes out' : ''), ref: 'onway:' + job.id + ':' + Date.now().toString(36) });
    if (!id) return false;
    return await place(env, await env.DB.prepare('SELECT * FROM outcalls WHERE id = ?1').bind(id).first());
  } catch (e) { return false; }
}

// Dial one queued call, with every rule. True when Twilio took it.
async function place(env, r, now) {
  now = now || Date.now();   // the cron's own clock, so a test at a fixed hour and a tick near midnight both read right
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return false;
  const line = await lineOf(env, r.client_id);
  const skip = (why, final) => env.DB.prepare('UPDATE outcalls SET status = ?1, result = ?2 WHERE id = ?3 AND status = \'pending\'').bind(final ? 'skipped' : 'pending', why, r.id).run().catch(() => {});
  if (!line || +line.regulated) { await skip('regulated or no line', true); return false; }
  if (!lineLive(line)) { await skip('line paused', false); return false; }
  const owner = !!(KINDS[r.kind] && KINDS[r.kind].owner);
  if (!owner) {
    if (await callOptedOut(env, r.client_id, r.phone)) { await skip('opted out', true); return false; }
    if (!callHoursOk(await tzFor(env, r.client_id), now, r.phone)) return false;   // a later tick
  }
  if (+r.attempts >= 2) { await skip('tried twice', true); return false; }
  // the thing this call is about is still open: an appointment or estimate the owner removed or closed is never called
  // about (Nov 10: Max's second try still rang a customer whose appointment the owner had deleted)
  const m = /^(confirm|noshow|quote):(\d+)$/.exec(String(r.ref || ''));
  if (m) {
    const f = await env.DB.prepare("SELECT status FROM app_followups WHERE id = ?1 AND client_id = ?2").bind(+m[2], r.client_id).first().catch(() => null);
    if (!f || f.status !== 'open') { await skip('closed by the owner', true); return false; }
  }
  if (r.kind === 'urgent' && now - Date.parse(r.created) > 3600e3) { await skip('too late to matter', true); return false; }
  const claim = await env.DB.prepare("UPDATE outcalls SET attempts = attempts + 1, result = 'calling', due_at = ?1 WHERE id = ?2 AND status = 'pending' AND attempts = ?3")
    .bind(new Date(now + 3 * 3600e3).toISOString(), r.id, r.attempts).run();
  if (claim && claim.meta && claim.meta.changes === 0) return false;
  const d = await dialOut(env, { number: line.number }, r.phone, '/voice/oc/' + env.VOICE_KEY + '?id=' + r.id, '/voice/ocstatus/' + env.VOICE_KEY + '?id=' + r.id);
  if (!d.ok) { await env.DB.prepare('UPDATE outcalls SET result = ?1 WHERE id = ?2').bind('failed: ' + String(d.why || '').slice(0, 80), r.id).run().catch(() => {}); return false; }
  const verb = { urgent: 'rang the owner about an urgent call', rundown: 'called the owner with the morning rundown', confirm: 'to confirm the appointment', noshow: 'to offer a new time after a missed visit', onway: 'to say someone is on the way', quote: 'to follow up on the estimate', due: 'to offer the next visit' }[r.kind];
  await logAct(env, { client_id: r.client_id, staff: 'Max' }, owner ? 'Max ' + verb : 'Max called ' + (r.name || fmtPhone(r.phone)) + ' ' + verb);
  return true;
}

const SITE = 'https://alwaysopenoffice.com';
async function row(env, id) { return id ? await env.DB.prepare('SELECT o.*, l.business FROM outcalls o LEFT JOIN voice_lines l ON l.client_id = o.client_id WHERE o.id = ?1').bind(id).first() : null; }
const ASK = {
  confirm: r => (r.topic || 'your appointment') + '. Press 1 to confirm, or press 2 if you need a different time.',
  noshow: r => 'We missed you for ' + (r.topic || 'your visit') + '. Press 1 and the team will call you to set a new time, or press 2 if you do not need one.',
  quote: r => 'Just following up on your estimate' + (r.topic ? ' for ' + r.topic : '') + '. Press 1 if you would like a call about it, or press 2 if not.',
  due: r => 'It has been a while since ' + (r.topic || 'your last visit') + '. Press 1 if you would like a call to set up the next one, or press 2 if not right now.'
};
// Twilio asks what to say: /voice/oc/<key>?id=
export async function outcallTwiml(env, url, form) {
  const id = +url.searchParams.get('id') || 0, r = await row(env, id);
  if (!r) return xml('<Hangup/>');
  const biz = xa(r.business || 'the business'), spec = KINDS[r.kind] || {};
  const machine = String(form.get('AnsweredBy') || '').startsWith('machine');
  if (spec.owner) {
    const msg = r.kind === 'urgent' ? 'Urgent. ' + xa(r.topic || 'A caller has an active problem') + '. Check the Always Open app for their number.' : xa(r.topic || 'Nothing on the schedule yet.');
    await env.DB.prepare("UPDATE outcalls SET status = 'done', result = 'delivered', done_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), id).run();
    return xml('<Say>Hi, this is Max for ' + biz + '. ' + msg + ' ' + (r.kind === 'urgent' ? msg : '') + '</Say><Hangup/>');
  }
  const first = (r.name ? 'Hi ' + xa(r.name.split(' ')[0]) + '. ' : 'Hi. ') + 'This is Max, the automated assistant for ' + biz + '. This call may be recorded. ';
  if (machine) {
    await env.DB.prepare("UPDATE outcalls SET result = 'voicemail' WHERE id = ?1").bind(id).run().catch(() => {});
    if (r.kind === 'onway') await env.DB.prepare("UPDATE outcalls SET status = 'done' WHERE id = ?1").bind(id).run().catch(() => {});
    return xml('<Say>' + first + (r.kind === 'onway' ? xa(r.topic) + '.' : 'Please call ' + biz + ' when you get a chance. Thank you.') + '</Say><Hangup/>');
  }
  await env.DB.prepare("UPDATE outcalls SET status = CASE WHEN ?1 = 'onway' THEN 'done' ELSE status END, result = 'answered' WHERE id = ?2").bind(r.kind, id).run().catch(() => {});
  if (r.kind === 'onway') return xml('<Say>' + first + xa(r.topic) + '. Thank you. Goodbye.</Say><Hangup/>');
  const act = SITE + '/voice/ocg/' + env.VOICE_KEY + '?id=' + id;
  return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" actionOnEmptyResult="true" action="' + xa(act) + '" method="POST"><Say>' + first + xa(ASK[r.kind](r)) + '</Say></Gather><Hangup/>');
}

// The customer answered: /voice/ocg/<key>?id=  (&a=1 once asked a second time)
export async function outcallGather(env, url, form) {
  const id = +url.searchParams.get('id') || 0, r = await row(env, id);
  if (!r) return xml('<Hangup/>');
  const ans = readAnswer(form.get('Digits'), form.get('SpeechResult'));
  const who = r.name || fmtPhone(r.phone), now = new Date().toISOString(), biz = xa(r.business || 'the business');
  const done = (st, res) => env.DB.prepare('UPDATE outcalls SET status = ?1, result = ?2, done_at = ?3 WHERE id = ?4').bind(st, res, now, id).run();
  const callback = async (reason, urgent) => {
    await env.DB.prepare("INSERT INTO callbacks (client_id, call_sid, phone, name, reason, due_at, status, created, urgent, note) VALUES (?1,'',?2,?3,?4,?5,'asap',?6,?7,?8)").bind(r.client_id, r.phone, r.name || '', reason, now, now, urgent ? 1 : 0, 'Max asked them on the phone.').run();
  };
  const tell = (title, body) => pushClient(env, r.client_id, { aps: { alert: { title, body }, sound: 'default', 'thread-id': 'callbacks' }, screen: 'home' });
  if (ans === 'stop') {
    await env.DB.prepare('INSERT OR REPLACE INTO call_optout (client_id, phone10, at) VALUES (?1,?2,?3)').bind(r.client_id, ph10(r.phone), now).run();
    await done('optout', 'asked not to be called');
    return xml('<Say>Understood. No more calls like this. Goodbye.</Say><Hangup/>');
  }
  if (ans === 'yes') {
    if (r.kind === 'confirm') { await done('yes', 'confirmed'); await tell(who + ' confirmed', r.topic || 'Their appointment is confirmed.'); return xml('<Say>Thank you, you are confirmed. Goodbye.</Say><Hangup/>'); }
    await done('yes', 'wants a call'); await callback(({ noshow: 'Missed visit: wants a new time. ', quote: 'Wants a call about the estimate. ', due: 'Wants to set up the next visit. ' }[r.kind] || '') + (r.topic || ''), r.kind === 'noshow');
    await tell(who + ' wants a call', ({ noshow: 'They missed a visit and want a new time.', quote: 'About the estimate you sent.', due: 'They would like to set up the next visit.' }[r.kind] || 'Tap to see the number.'));
    return xml('<Say>Thank you. ' + biz + ' will call you. Goodbye.</Say><Hangup/>');
  }
  if (ans === 'no') {
    if (r.kind === 'confirm') { await done('no', 'needs a different time'); await callback('Needs a different time. ' + (r.topic || ''), true); await tell(who + ' needs a different time', (r.topic || 'Their appointment') + '. Call them to move it.'); return xml('<Say>No problem. ' + biz + ' will call you to find a better time. Goodbye.</Say><Hangup/>'); }
    await done('no', 'declined'); return xml('<Say>No problem. Thank you. Goodbye.</Say><Hangup/>');
  }
  if (url.searchParams.get('a') !== '1') {
    const act = SITE + '/voice/ocg/' + env.VOICE_KEY + '?id=' + id + '&a=1';
    return xml('<Gather input="dtmf speech" numDigits="1" timeout="6" actionOnEmptyResult="true" action="' + xa(act) + '" method="POST"><Say>Sorry, I did not catch that. ' + xa(ASK[r.kind](r)) + '</Say></Gather><Hangup/>');
  }
  await done('done', 'no clear answer');
  return xml('<Say>Sorry, I did not catch that. Please call ' + biz + ' if you need anything. Goodbye.</Say><Hangup/>');
}

export async function outcallStatus(env, url, form) {
  const id = +url.searchParams.get('id') || 0, st = String(form.get('CallStatus') || '');
  if (id && /^(no-answer|busy|failed|canceled)$/.test(st)) {
    const r = await env.DB.prepare('SELECT attempts, kind, status FROM outcalls WHERE id = ?1').bind(id).first();
    if (r && r.status === 'pending') {
      if (+r.attempts >= 2) await env.DB.prepare("UPDATE outcalls SET status = 'noanswer', result = ?1 WHERE id = ?2").bind(st, id).run();
      else await env.DB.prepare('UPDATE outcalls SET result = ?1 WHERE id = ?2').bind(st, id).run();
    }
  }
  return new Response('ok');
}

// ---------- the cron: find what is due, then dial ----------
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
export async function outCallsCron(env, now) {
  now = now || Date.now();
  await ensureOutcalls(env);
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.VOICE_KEY)) return { calls: 0 };
  const stats = { queued: 0, calls: 0 };
  const iso = ms => new Date(ms).toISOString();
  const clients = ((await env.DB.prepare("SELECT c.client_id, c.business, c.phone FROM app_clients c JOIN voice_lines l ON l.client_id = c.client_id WHERE c.active = 1 AND c.regulated = 0 AND l.on_air = 1 GROUP BY c.client_id LIMIT 400").all()).results) || [];
  for (const c of clients) {
    let p; try { p = await prefsOf(env, c.client_id, 0); } catch (e) { continue; }
    const tz = await tzFor(env, c.client_id);
    const add = async (kind, f, topic, due) => { if (await queue(env, { client_id: c.client_id, kind, phone: f.phone, name: String(f.name || '').split(' ')[0], topic, ref: kind + ':' + (f.ref || f.id), due_at: due || iso(now) })) stats.queued++; };
    try {
      if (p.confirm) for (const f of ((await env.DB.prepare("SELECT id, name, phone, appt_at, note FROM app_followups WHERE client_id = ?1 AND kind = 'appointment' AND status = 'open' AND consent = 1 AND appt_at != '' AND appt_at > ?2 AND appt_at < ?3 LIMIT 20").bind(c.client_id, iso(now + 14 * 3600e3), iso(now + 30 * 3600e3)).all()).results) || []) {
        const l = local(tz, Date.parse(f.appt_at)); await add('confirm', f, 'Your appointment with ' + clean(c.business) + ' is ' + (l.day === local(tz, now).day ? 'today' : 'tomorrow') + ' at ' + sayHour(l.hour, l.minute));
      }
      if (p.noshow) for (const f of ((await env.DB.prepare("SELECT id, name, phone, appt_at FROM app_followups WHERE client_id = ?1 AND kind = 'appointment' AND status = 'open' AND consent = 1 AND appt_at != '' AND appt_at < ?2 AND appt_at > ?3 LIMIT 20").bind(c.client_id, iso(now - 90 * 60e3), iso(now - 24 * 3600e3)).all()).results) || []) {
        const l = local(tz, Date.parse(f.appt_at)); await add('noshow', f, 'your visit at ' + sayHour(l.hour, l.minute));
      }
      if (p.quote) for (const f of ((await env.DB.prepare("SELECT id, name, phone, note FROM app_followups WHERE client_id = ?1 AND kind = 'quote' AND status = 'open' AND consent = 1 AND created < ?2 AND created > ?3 LIMIT 20").bind(c.client_id, iso(now - 3 * 864e5), iso(now - 30 * 864e5)).all()).results) || []) await add('quote', f, clean(f.note).slice(0, 60));
      if (p.due) for (const f of ((await env.DB.prepare("SELECT k.id, k.first AS name, k.phone, k.job FROM checkins k WHERE k.client_id = ?1 AND k.status IN ('yes','no','done') AND k.done_at < ?2 AND k.done_at > ?3 AND NOT EXISTS (SELECT 1 FROM app_jobs j WHERE j.client_id = k.client_id AND j.phone = substr(k.phone, 3) AND j.at > ?2) LIMIT 20").bind(c.client_id, iso(now - 180 * 864e5), iso(now - 400 * 864e5)).all()).results) || []) await add('due', Object.assign(f, { ref: ph10(f.phone) + ':' + Math.floor(now / (180 * 864e5)) }), 'your ' + clean(f.job || 'last visit'));
      if (p.rundown && local(tz, now).hour === 7) {
        const day = local(tz, now).day, dayStart = fromLocal(tz, day, 0, 0), dayEnd = dayStart + 864e5;
        const ap = ((await env.DB.prepare("SELECT appt_at, name FROM app_followups WHERE client_id = ?1 AND kind = 'appointment' AND status = 'open' AND appt_at >= ?2 AND appt_at < ?3 ORDER BY appt_at LIMIT 6").bind(c.client_id, iso(dayStart), iso(dayEnd)).all()).results) || [];
        const cb = ((await env.DB.prepare("SELECT COUNT(*) AS n FROM callbacks WHERE client_id = ?1 AND status IN ('pending','asap','missed')").bind(c.client_id).first()) || {}).n || 0;
        const text = 'Here is your day. ' + (ap.length ? 'You have ' + ap.length + (ap.length === 1 ? ' visit' : ' visits') + ': ' + ap.map(a => clean(a.name || 'a customer') + ' at ' + (l => sayHour(l.hour, l.minute))(local(tz, Date.parse(a.appt_at)))).join(', ') + '. ' : 'Nothing is scheduled yet. ') + (+cb ? 'You owe ' + cb + (+cb === 1 ? ' call-back.' : ' call-backs.') : 'No call-backs waiting.');
        if (await queue(env, { client_id: c.client_id, kind: 'rundown', phone: c.phone, topic: text, ref: 'rundown:' + day })) stats.queued++;
      }
    } catch (e) { /* one client's data never stops the rest */ }
  }
  const due = ((await env.DB.prepare("SELECT * FROM outcalls WHERE status = 'pending' AND due_at <= ?1 AND attempts < 2 ORDER BY due_at LIMIT 40").bind(iso(now)).all()).results) || [];
  for (const r of due) if (await place(env, r, now)) stats.calls++;
  return stats;
}
function sayHour(h, m) { const ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12; return hh + (m ? ' ' + (m < 10 ? 'oh ' : '') + m : '') + ' ' + ap; }
