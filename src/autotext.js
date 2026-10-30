// Texts we send for the business, from its own registered number, so the owner doesn't have to:
//   appointments: a confirmation right away and a reminder the afternoon before;
//   quotes and invoices: one friendly follow-up on the day the owner picked.
// Only when every one of these is true: the business's texting registration is approved, the customer said yes to texts
// (the owner ticks that box when adding it, or the customer ticks it on the booking page and then texts the business's
// number once, so a stranger can't make the business text someone else's phone), the business isn't regulated,
// and the number hasn't opted out. Owner-added follow-ups come with Pro; booking-page confirmations come with every plan.
// Otherwise nothing changes: the owner gets the reminder with the text written, and sends it from their own phone.
// Every text names the business and says how to stop. Daytime only, in the business's time zone.

// Each auto_* column: '' (not yet), 'sending:<when>' (one run has claimed it and is texting now), an ISO time (texted),
// 'skip:<why>' (not texted, and the owner's own reminder covers it), or for auto_conf 'wait:text' (booked online and
// ticked "text me": nothing goes to that number until it texts the business first, which proves it is theirs).
const ready = new WeakSet();
export async function ensureAuto(env) {
  if (ready.has(env.DB)) return;
  for (const col of ["appt_at TEXT DEFAULT ''", "auto_conf TEXT DEFAULT ''", "auto_rem TEXT DEFAULT ''", "auto_fu TEXT DEFAULT ''"]) {
    try { await env.DB.prepare('ALTER TABLE app_followups ADD COLUMN ' + col).run(); } catch (e) { /* already there */ }
  }
  ready.add(env.DB);
}

// Can we text this business's customers for it right now?
export async function autoReady(env, c, booking) {
  if (!c || +c.regulated) return false;
  const { TEXTING_ON, senderFor } = await import('./sms.js');
  if (!TEXTING_ON || !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return false;
  if (!booking) { const { features } = await import('./app.js'); if (!features(c).followups) return false; }
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
    if (/^(sending|wait):/.test(x.auto_conf)) return null;   // the confirmation is going out right now, or waits on them
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

// Every 10 minutes, and right after a follow-up is added or a booker texts in (only: [ids] limits it to those rows).
// Two runs can overlap (the timer and one of those), so each text is claimed first: the run that changes the column
// from '' to 'sending:…' sends it, any other run leaves it alone.
const CLAIM_STALE_MS = 30 * 60e3;
export async function autoCron(env, at, only) {
  await ensureAuto(env);
  const now = at || Date.now();
  const sms = await import('./sms.js');
  if (!sms.TEXTING_ON || !sms.textingReady(env)) return { sent: 0 };
  await sms.ensureBrands(env);
  // A run that died between claiming and finishing: we can't tell whether that text went, so it isn't sent again.
  // The owner's own reminder covers it instead (remindFollowups in app.js), and the app says why.
  const stale = 'sending:' + new Date(now - CLAIM_STALE_MS).toISOString();
  await env.DB.batch(['auto_conf', 'auto_rem', 'auto_fu'].map(col => env.DB.prepare('UPDATE app_followups SET ' + col + " = 'skip:not sure it went' WHERE " + col + " LIKE 'sending:%' AND " + col + ' < ?1').bind(stale)));
  // Only rows with something due now, for businesses whose texting is ready: rows waiting on a later day never fill
  // the batch and hold back a new booking's confirmation. "Today" and "tomorrow" in the business's own zone are at
  // most these UTC days; nextStep below decides exactly.
  const day = n => new Date(now + n * 864e5).toISOString().slice(0, 10);
  const ids = Array.isArray(only) ? only.map(n => parseInt(n, 10)).filter(n => n > 0).slice(0, 50) : null;
  if (ids && !ids.length) return { sent: 0 };
  const rows = ((await env.DB.prepare("SELECT f.*, c.business, c.regulated, c.tier, c.feats, c.active FROM app_followups f JOIN app_clients c ON c.client_id = f.client_id " +
    "JOIN sms_brands b ON b.client_id = f.client_id AND b.status = 'approved' AND b.messaging_sid LIKE 'MG%' AND length(b.messaging_sid) = 34 " +
    "WHERE f.status = 'open' AND f.consent = 1 AND length(f.phone) = 10 AND c.active = 1 AND COALESCE(c.regulated, 0) = 0 " +
    "AND (f.by = 'Booking page' OR c.tier = 'Pro' OR (',' || REPLACE(COALESCE(c.feats, ''), ' ', '') || ',') LIKE '%,followups,%') " +
    "AND ((f.kind = 'appointment' AND (f.auto_conf = '' OR (f.auto_rem = '' AND f.due != '' AND f.due <= ?2))) OR (f.kind IN ('quote', 'invoice') AND f.auto_fu = '' AND f.due != '' AND f.due <= ?1)) " +
    (ids ? 'AND f.id IN (' + ids.map((_, i) => '?' + (i + 3)).join(',') + ') ' : '') +
    "ORDER BY CASE WHEN f.kind = 'appointment' AND f.auto_conf = '' THEN 0 ELSE 1 END, f.id LIMIT 60").bind(day(1), day(2), ...(ids || [])).all()).results) || [];
  if (!rows.length) return { sent: 0 };
  const { tzFor, local } = await import('./callbacks.js');
  const { sendText } = sms;
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
    if (step.mark) { await env.DB.prepare('UPDATE app_followups SET ' + step.mark + ' = ?1 WHERE id = ?2 AND ' + step.mark + " = ''").bind(step.value, x.id).run(); continue; }
    const col = step.send === 'confirm' ? 'auto_conf' : (step.send === 'reminder' ? 'auto_rem' : 'auto_fu');
    const claim = 'sending:' + new Date(now).toISOString();
    const got = await env.DB.prepare('UPDATE app_followups SET ' + col + ' = ?1 WHERE id = ?2 AND ' + col + " = ''").bind(claim, x.id).run();
    if (!(got && got.meta && got.meta.changes === 1)) continue;   // another run has it
    const body = step.send === 'confirm' ? confirmText(x.business, x, tz) : (step.send === 'reminder' ? reminderText(x.business, x, tz) : followText(x.business, x));
    const kind = step.send === 'confirm' ? (booking ? 'confirm' : 'apptconfirm') : (step.send === 'reminder' ? 'reminder' : 'followup');
    let r;
    try { r = await sendText(env, { clientId: cid, to: x.phone, body, kind, tz }); } catch (e) { r = { ok: false, retry: true }; }
    const release = () => env.DB.prepare('UPDATE app_followups SET ' + col + " = '' WHERE id = ?1 AND " + col + ' = ?2').bind(x.id, claim).run();
    if (r.ok) {
      sent++;
      // The owner's own due-day reminder isn't needed for something we already sent.
      await env.DB.prepare('UPDATE app_followups SET ' + col + " = ?1, reminded = CASE WHEN reminded = '' OR reminded IS NULL THEN ?1 ELSE reminded END WHERE id = ?2").bind(new Date(now).toISOString(), x.id).run();
      (told[cid] = told[cid] || []).push((step.send === 'follow' ? (x.kind === 'invoice' ? 'invoice' : 'quote') + ' follow-up' : (step.send === 'confirm' ? 'confirmation' : 'reminder')) + ' to ' + first(x.name));
    } else if (r.retry) { await release(); /* after hours or a ceiling: next pass */ }
    else if (r.why === 'texting not registered for this business' || r.why === 'texting not set up') { await release(); okFor[key] = false; }
    else await env.DB.prepare('UPDATE app_followups SET ' + col + ' = ?1 WHERE id = ?2').bind('skip:' + String(r.why || 'failed').slice(0, 60), x.id).run();
  }
  if (Object.keys(told).length) {
    const { pushClient } = await import('./app.js');
    for (const cid of Object.keys(told)) {
      const list = told[cid];
      await pushClient(env, cid, { aps: { alert: { title: list.length === 1 ? 'We texted for you' : 'We sent ' + list.length + ' texts for you', body: 'Sent: ' + list.join(', ') + '. Replies land in your inbox.' }, sound: 'default', 'thread-id': 'followups' }, screen: 'home' }).catch(() => {});
    }
  }
  return { sent };
}

// The booking page: a customer picked a time and ticked "text me". Anyone can type any number into a public page, so
// nothing is texted to that number yet: the page asks them to text the business's number first, and their text
// (textedIn, from sms.js) turns the confirmation and the reminder on. Returns the number to text, or '' when this
// business can't text yet (then the page says nothing about texts).
const BOOK_WAIT_DAYS = 14;
export async function fromBooking(env, cid, o) {
  await ensureAuto(env);
  const p = String(o.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(p)) return '';
  const { tzFor, local } = await import('./callbacks.js');
  const tz = await tzFor(env, cid), day = local(tz, o.start).day, now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO app_followups (client_id, kind, name, phone, amount, due, note, consent, status, created, by, hq_synced, reminded, appt_at, auto_conf) VALUES (?1, 'appointment', ?2, ?3, '', ?4, 'Booked online', 0, 'open', ?5, 'Booking page', 0, 'booking', ?6, 'wait:text')")
    .bind(cid, String(o.name || '').slice(0, 60), p, day, now, new Date(o.start).toISOString()).run();
  const c = await env.DB.prepare('SELECT client_id, regulated, tier, feats FROM app_clients WHERE client_id = ?1').bind(cid).first().catch(() => null);
  if (!(await autoReady(env, c, true).catch(() => false))) return '';
  return (await import('./sms.js')).ownNumber(env, cid);
}
// A text came in from this number (sms.js): bookings from it that wait on "text us first" can be texted now.
export async function textedIn(env, cid, from10) {
  if (!/^\d{10}$/.test(from10 || '')) return 0;
  await ensureAuto(env);
  const since = new Date(Date.now() - BOOK_WAIT_DAYS * 864e5).toISOString();
  const rows = ((await env.DB.prepare("SELECT id FROM app_followups WHERE client_id = ?1 AND phone = ?2 AND by = 'Booking page' AND status = 'open' AND consent = 0 AND auto_conf = 'wait:text' AND created > ?3 LIMIT 5").bind(cid, from10, since).all()).results) || [];
  if (!rows.length) return 0;
  const ids = [];
  for (const r of rows) {
    const u = await env.DB.prepare("UPDATE app_followups SET consent = 1, auto_conf = '' WHERE id = ?1 AND auto_conf = 'wait:text'").bind(r.id).run();
    if (u && u.meta && u.meta.changes) ids.push(r.id);
  }
  if (ids.length) { try { await autoCron(env, Date.now(), ids); } catch (e) { /* the timer sends it */ } }
  return ids.length;
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
// For one follow-up the customer said yes to: why our text did not go, in plain words, or '' if nothing failed.
// A row with a reason here is back in the owner's own due-day reminder (remindFollowups in app.js).
const BENIGN = new Set(['past', 'same day', 'just confirmed']);
export function autoFail(x) {
  if (!x || !+x.consent) return '';
  const cols = x.kind === 'appointment' ? [x.auto_conf, x.auto_rem] : [x.auto_fu];
  for (const v of cols) {
    const m = /^skip:(.*)$/.exec(String(v || ''));
    if (!m || BENIGN.has(m[1])) continue;
    if (m[1] === 'opted out') return 'They opted out of texts, so we didn’t text them. Give them a call.';
    if (m[1] === 'bad number') return 'That number can’t get texts, so we didn’t text them. Give them a call.';
    if (m[1] === 'not sure it went') return 'We couldn’t confirm our text went out, so it’s back with you. Text or call them.';
    return 'Our text to them didn’t go through, so it’s back with you. Text or call them.';
  }
  return '';
}
