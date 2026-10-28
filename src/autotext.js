// Texts we send for the business, from its own registered number, so the owner doesn't have to:
//   appointments: a confirmation right away and a reminder the afternoon before;
//   quotes and invoices: one friendly follow-up on the day the owner picked.
// Only when every one of these is true: the business's texting registration is approved, the customer said yes to texts
// (the owner ticks that box when adding it, or the customer ticks it on the booking page), the business isn't regulated,
// and the number hasn't opted out. Owner-added follow-ups come with Pro; booking-page confirmations come with every plan.
// Otherwise nothing changes: the owner gets the reminder with the text written, and sends it from their own phone.
// Every text names the business and says how to stop. Daytime only, in the business's time zone.
const late = p => import(p);

let ready = false;
export async function ensureAuto(env) {
  if (ready) return;
  for (const col of ["appt_at TEXT DEFAULT ''", "auto_conf TEXT DEFAULT ''", "auto_rem TEXT DEFAULT ''", "auto_fu TEXT DEFAULT ''"]) {
    try { await env.DB.prepare('ALTER TABLE app_followups ADD COLUMN ' + col).run(); } catch (e) { /* already there */ }
  }
  ready = true;
}

// Can we text this business's customers for it right now?
export async function autoReady(env, c, booking) {
  if (!c || +c.regulated) return false;
  const { TEXTING_ON, senderFor } = await late('./sms.js');
  if (!TEXTING_ON || !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return false;
  if (!booking) { const { features } = await late('./app.js'); if (!features(c).followups) return false; }
  return !!(await senderFor(env, c.client_id).catch(() => null));
}

const first = n => String(n || '').trim().split(/\s+/)[0] || 'there';
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
export function whenText(tz, apptAt, due) {
  const t = Date.parse(apptAt || '');
  if (t) return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' }).format(t) + ' at ' + hourText(tz, apptAt);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due || '')) { const [y, m, d] = due.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  return '';
}
const hourText = (tz, apptAt) => { const t = Date.parse(apptAt || ''); return t ? new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(t).replace(':00', '') : ''; };
const STOP = ' Reply STOP to end texts.';
export function confirmText(biz, x, tz) {
  const w = whenText(tz, x.appt_at, x.due);
  return 'Hi ' + first(x.name) + ', this is ' + clean(biz) + '. You’re set' + (w ? ' for ' + w : '') + '. Reply here if you need to change it.' + STOP;
}
export function reminderText(biz, x, tz) {
  const h = hourText(tz, x.appt_at);
  return 'Hi ' + first(x.name) + ', a reminder from ' + clean(biz) + ': we’ll see you tomorrow' + (h ? ' at ' + h : '') + '. Reply here if anything changes.' + STOP;
}
export function followText(biz, x) {
  const amt = x.amount ? ' for ' + clean(x.amount) : '';
  if (x.kind === 'invoice') return 'Hi ' + first(x.name) + ', this is ' + clean(biz) + '. A friendly reminder about your invoice' + amt + '. Reply here with any questions.' + STOP;
  return 'Hi ' + first(x.name) + ', this is ' + clean(biz) + '. Checking in on the quote' + amt + ' we sent. Any questions? Just reply here.' + STOP;
}

// Which text is due for one follow-up now. now = ms; l = local clock { day, hour } in the business's zone; tomorrow = local day string.
export function nextStep(x, now, l, tomorrow) {
  if (x.status !== 'open' || !+x.consent || !/^\d{10}$/.test(x.phone || '')) return null;
  if (x.kind === 'appointment') {
    const t = Date.parse(x.appt_at || '') || (x.due ? Date.parse(x.due + 'T23:59:00Z') : 0);
    if (!x.auto_conf) {
      if (t && t < now) return { mark: 'auto_conf', value: 'skip:past' };
      return { send: 'confirm' };
    }
    if (!x.auto_rem) {
      const day = x.due;
      if (t && t < now) return { mark: 'auto_rem', value: 'skip:past' };
      if (day === tomorrow && l.hour >= 16 && l.hour < 20) {
        if (/^\d{4}-/.test(x.auto_conf) && now - Date.parse(x.auto_conf) < 12 * 3600e3) return { mark: 'auto_rem', value: 'skip:just confirmed' };
        return { send: 'reminder' };
      }
      if (day && day <= l.day) return { mark: 'auto_rem', value: 'skip:same day' };
    }
    return null;
  }
  if ((x.kind === 'quote' || x.kind === 'invoice') && !x.auto_fu && x.due && x.due <= l.day && l.hour >= 10 && l.hour < 18) return { send: 'follow' };
  return null;
}

// Every 10 minutes.
export async function autoCron(env, at) {
  await ensureAuto(env);
  const now = at || Date.now();
  const rows = ((await env.DB.prepare("SELECT f.*, c.business, c.regulated, c.tier, c.feats, c.active FROM app_followups f JOIN app_clients c ON c.client_id = f.client_id WHERE f.status = 'open' AND f.consent = 1 AND f.phone != '' AND c.active = 1 AND ((f.kind = 'appointment' AND (f.auto_conf = '' OR f.auto_rem = '')) OR (f.kind IN ('quote', 'invoice') AND f.auto_fu = '' AND f.due != '')) ORDER BY f.id LIMIT 60").all()).results) || [];
  if (!rows.length) return { sent: 0 };
  const { tzFor, local } = await late('./callbacks.js');
  const { sendText } = await late('./sms.js');
  const okFor = {}, tzOf = {};
  let sent = 0;
  const told = {};
  for (const x of rows) {
    const cid = x.client_id, booking = x.by === 'Booking page';
    const key = cid + (booking ? ':b' : '');
    if (okFor[key] === undefined) okFor[key] = await autoReady(env, x, booking);
    if (!okFor[key]) continue;
    if (!tzOf[cid]) tzOf[cid] = await tzFor(env, cid);
    const tz = tzOf[cid], l = local(tz, now), tomorrow = local(tz, now + 864e5).day;
    const step = nextStep(x, now, l, tomorrow);
    if (!step) continue;
    if (step.mark) { await env.DB.prepare('UPDATE app_followups SET ' + step.mark + ' = ?1 WHERE id = ?2').bind(step.value, x.id).run(); continue; }
    const body = step.send === 'confirm' ? confirmText(x.business, x, tz) : (step.send === 'reminder' ? reminderText(x.business, x, tz) : followText(x.business, x));
    const kind = step.send === 'confirm' ? (booking ? 'confirm' : 'apptconfirm') : (step.send === 'reminder' ? 'reminder' : 'followup');
    const r = await sendText(env, { clientId: cid, to: x.phone, body, kind, tz });
    const col = step.send === 'confirm' ? 'auto_conf' : (step.send === 'reminder' ? 'auto_rem' : 'auto_fu');
    if (r.ok) {
      sent++;
      // The owner's own due-day reminder isn't needed for something we already sent.
      await env.DB.prepare('UPDATE app_followups SET ' + col + " = ?1, reminded = CASE WHEN reminded = '' OR reminded IS NULL THEN ?1 ELSE reminded END WHERE id = ?2").bind(new Date(now).toISOString(), x.id).run();
      (told[cid] = told[cid] || []).push((step.send === 'follow' ? (x.kind === 'invoice' ? 'invoice' : 'quote') + ' follow-up' : (step.send === 'confirm' ? 'confirmation' : 'reminder')) + ' to ' + first(x.name));
    } else if (r.retry) { /* after hours: next pass */ }
    else if (r.why === 'texting not registered for this business' || r.why === 'texting not set up') { okFor[key] = false; }
    else await env.DB.prepare('UPDATE app_followups SET ' + col + ' = ?1 WHERE id = ?2').bind('skip:' + String(r.why || 'failed').slice(0, 60), x.id).run();
  }
  if (Object.keys(told).length) {
    const { pushClient } = await late('./app.js');
    for (const cid of Object.keys(told)) {
      const list = told[cid];
      await pushClient(env, cid, { aps: { alert: { title: list.length === 1 ? 'We texted for you' : 'We sent ' + list.length + ' texts for you', body: 'Sent: ' + list.join(', ') + '. Replies land in your inbox.' }, sound: 'default', 'thread-id': 'followups' }, screen: 'home' }).catch(() => {});
    }
  }
  return { sent };
}

// The booking page: a customer picked a time and ticked "text me". Their confirmation goes out within minutes.
export async function fromBooking(env, cid, o) {
  await ensureAuto(env);
  const p = String(o.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(p)) return;
  const { tzFor, local } = await late('./callbacks.js');
  const tz = await tzFor(env, cid), day = local(tz, o.start).day, now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_followups (client_id, kind, name, phone, amount, due, note, consent, status, created, by, hq_synced, reminded, appt_at) VALUES (?1, 'appointment', ?2, ?3, '', ?4, 'Booked online', 1, 'open', ?5, 'Booking page', 0, 'booking', ?6)")
    .bind(cid, String(o.name || '').slice(0, 60), p, day, now, new Date(o.start).toISOString()).run();
  try { await autoCron(env); } catch (e) { /* the timer sends it */ }
}

// For one follow-up in the app: what we texted, if anything.
export function autoNote(x) {
  const d = v => /^\d{4}-/.test(v || '') ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '';
  const bits = [];
  if (d(x.auto_conf)) bits.push('Confirmation texted ' + d(x.auto_conf));
  if (d(x.auto_rem)) bits.push('reminder texted ' + d(x.auto_rem));
  if (d(x.auto_fu)) bits.push('Texted ' + d(x.auto_fu));
  return bits.join(', ');
}
