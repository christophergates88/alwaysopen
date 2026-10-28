// Fill my week (Pro). When the owner's Google Calendar has an open weekday coming up, past customers who agreed to hear
// from the business and are due again get one text: "Sam has Thursday at 9 AM open... Want it? Reply YES". The first
// YES gets booked on the calendar, gets a confirmation and a reminder the day before, and the owner gets a push.
// Anything else they reply lands in the owner's inbox like any text.
// Rules, all enforced here: the owner turned it on and accepted the one-line agreement; Pro; never for regulated
// businesses; texting is registered for this business (the offer goes from its own number); only customers marked as
// agreeing to hear from the business, never one who opted out; last job 6 months to 3 years ago; at most 8 per run; no
// customer more than once in 90 days; one run per 14 days unless the owner taps it; daytime only.
// Texts only: Max does not place these calls. A sales call in an automated voice needs written consent that our records
// don't capture, so calls stay out until that's settled.
const MAX_OFFERS = 8, GAP_DAYS = 90, RUN_GAP_DAYS = 14, MIN_AGE_D = 182, MAX_AGE_D = 3 * 365;
export const AGREEMENT = 'Fill my week texts past customers who agreed to hear from you when your calendar has an open day coming up. Each customer gets at most one offer in 90 days, STOP is honored at once, and you stay responsible for the offer made in your name.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let ready = false;
export async function ensureFill(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fillweek (client_id TEXT PRIMARY KEY, on_ INTEGER DEFAULT 0, agreed_at TEXT DEFAULT '', agreed_by TEXT DEFAULT '', updated TEXT DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fillweek_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, day TEXT, created TEXT, by TEXT DEFAULT '', offers INTEGER DEFAULT 0, booked INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fillweek_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, client_id TEXT NOT NULL, phone10 TEXT NOT NULL, name TEXT DEFAULT '', job TEXT DEFAULT '', day TEXT DEFAULT '', status TEXT DEFAULT 'sent', at TEXT, result TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fillweek_offers_p ON fillweek_offers (client_id, phone10, at)')
  ]);
  ready = true;
}

const ph10 = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return /^\d{10}$/.test(d) ? d : ''; };
const first = n => String(n || '').trim().split(/\s+/)[0] || 'there';
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

// Who gets an offer. customers: [{name, phone10, agreed, optout}]; jobs: [{phone, title, at}];
// recent: phone10s offered in the last 90 days; stopped: phone10s that opted out of texts.
export function pickCandidates(customers, jobs, recent, stopped, now) {
  const last = new Map();
  for (const j of jobs) {
    const p = ph10(j.phone), t = Date.parse(j.at || '');
    if (!p || !t) continue;
    const o = last.get(p);
    if (!o || t > o.at) last.set(p, { at: t, job: clean(j.title).slice(0, 60), amount: +j.amount || 0 });
  }
  const skip = new Set([...(recent || []), ...(stopped || [])]);
  const out = [];
  for (const c of customers) {
    const p = ph10(c.phone10 || c.phone);
    if (!p || !+c.agreed || +c.optout || skip.has(p)) continue;
    const l = last.get(p);
    if (!l) continue;
    const age = (now - l.at) / 864e5;
    if (age < MIN_AGE_D || age > MAX_AGE_D) continue;
    out.push({ phone10: p, name: clean(c.name).slice(0, 60), job: l.job, lastAt: l.at, amount: l.amount });
    skip.add(p);
  }
  out.sort((a, b) => (b.amount - a.amount) || (a.lastAt - b.lastAt));
  return out.slice(0, MAX_OFFERS);
}

export function whenText(lastAt, now) {
  const d = new Date(lastAt);
  return now - lastAt < 330 * 864e5 ? 'last ' + MONTHS[d.getUTCMonth()] : 'back in ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
export function offerText(biz, owner, slotSay, cand, now) {
  const why = cand.job ? 'since your ' + cand.job.replace(/[.?!]+$/, '').toLowerCase() + ' ' + whenText(cand.lastAt, now) : 'since it’s been a while since your last visit';
  return 'Hi ' + first(cand.name) + ', this is ' + clean(biz) + '. ' + (owner ? clean(owner) : 'We') + ' ' + (owner ? 'has ' : 'have ') + slotSay + ' open and thought of you ' + why + '. Want it? Reply YES or a better time. Reply STOP to end texts.';
}
// "Thursday at 9 AM" from a slot's spoken text ("Thursday, November 5 at 9 AM").
export function shortSlot(say) { return String(say || '').replace(/,\s*[A-Za-z]+ \d{1,2}/, '').replace(/\s+/g, ' ').trim(); }

async function row(env, cid) {
  await ensureFill(env);
  const r = await env.DB.prepare('SELECT * FROM fillweek WHERE client_id = ?1').bind(cid).first().catch(() => null);
  return { on: !!(r && +r.on_), agreedAt: (r && r.agreed_at) || '' };
}
async function readiness(env, c) {
  if (+c.regulated) return { ok: false, why: 'Not available for regulated businesses.' };
  if (!(c.tier === 'Pro' || String(c.feats || '').split(',').map(s => s.trim()).includes('fillweek'))) return { ok: false, why: 'Comes with Pro.' };
  const { senderFor, TEXTING_ON } = await import('./sms.js');
  if (!TEXTING_ON || !(await senderFor(env, c.client_id).catch(() => null))) return { ok: false, why: 'Texting under your business name needs to be approved first.' };
  const { gcalStatus } = await import('./gcal.js');
  if (!(await gcalStatus(env, c.client_id)).connected) return { ok: false, why: 'Connect your Google Calendar first, so offers only go out for times that are really open.' };
  return { ok: true };
}

// The days worth filling: weekdays in the next 7 days, at least 2 days out, with 2 or more open slots (3+ open hours).
export function openDays(slots, tz, now) {
  const by = new Map();
  for (const s of slots || []) {
    if (s.start < now + 36 * 3600e3) continue;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(s.start);
    if (!by.has(day)) by.set(day, []);
    by.get(day).push(s);
  }
  return [...by.entries()].filter(([, l]) => l.length >= 2).map(([day, l]) => ({ day, slots: l.sort((a, b) => a.start - b.start) })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Run once for one client. day: 'YYYY-MM-DD' (optional; the first open day otherwise).
export async function runFill(env, c, opts) {
  await ensureFill(env);
  const now = (opts && opts.now) || Date.now();
  const ready = await readiness(env, c);
  if (!ready.ok) return { ok: false, error: ready.why };
  const cb = await import('./callbacks.js');
  const lh = cb.local(await cb.tzFor(env, c.client_id), now).hour;
  if (lh < 9 || lh >= 19) return { ok: false, error: 'Offers go out between 9 AM and 7 PM. Tap it again then.' };
  const { openSlots } = await import('./gcal.js');
  const open = await openSlots(env, c.client_id, now, 12).catch(() => null);
  if (!open) return { ok: false, error: 'Could not read your calendar. Try again in a minute.' };
  const days = openDays(open.slots, open.tz, now);
  const pick = (opts && opts.day) ? days.find(d => d.day === opts.day) : days[0];
  if (!pick) return { ok: false, error: 'No weekday in the next week has a few open hours on your calendar.' };
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const customers = await all('SELECT name, phone, phone10, agreed, optout FROM biz_customers WHERE client_id = ?1 AND agreed = 1 AND optout = 0 AND phone10 != \'\' LIMIT 5000', c.client_id);
  const jobs = (await all("SELECT phone, title, amount, CASE WHEN source = 'import' THEN created ELSE COALESCE(NULLIF(updated, ''), created) END AS at FROM biz_jobs WHERE client_id = ?1 AND (stage IN ('done', 'paid') OR source = 'import') LIMIT 8000", c.client_id))
    .concat(await all('SELECT phone, job AS title, 0 AS amount, at FROM app_jobs WHERE client_id = ?1 LIMIT 8000', c.client_id));
  const recent = (await all('SELECT phone10 FROM fillweek_offers WHERE client_id = ?1 AND at > ?2', c.client_id, new Date(now - GAP_DAYS * 864e5).toISOString())).map(r => r.phone10);
  const stopped = (await all('SELECT phone10 FROM sms_optout WHERE client_id = ?1', c.client_id)).map(r => r.phone10);
  const cands = pickCandidates(customers, jobs, recent, stopped, now);
  if (!cands.length) return { ok: false, error: 'Nobody is due right now: no past customer who agreed to hear from you had their last job 6 months to 3 years ago, or they already got an offer lately.' };
  const ins = await env.DB.prepare('INSERT INTO fillweek_runs (client_id, day, created, by) VALUES (?1, ?2, ?3, ?4)').bind(c.client_id, pick.day, new Date(now).toISOString(), (opts && opts.by) || 'Always Open').run();
  const runId = ins && ins.meta && ins.meta.last_row_id;
  const { sendText } = await import('./sms.js');
  const { tzFor } = await import('./callbacks.js');
  const tz = await tzFor(env, c.client_id);
  const slotSay = shortSlot(pick.slots[0].say);
  let sent = 0;
  for (const x of cands) {
    const body = offerText(c.business, c.owner_first, slotSay, x, now);
    const r = await sendText(env, { clientId: c.client_id, to: x.phone10, body, kind: 'fillweek', tz });
    await env.DB.prepare('INSERT INTO fillweek_offers (run_id, client_id, phone10, name, job, day, status, at, result) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
      .bind(runId, c.client_id, x.phone10, x.name, x.job, pick.day, r.ok ? 'sent' : 'failed', new Date(now).toISOString(), r.ok ? '' : String(r.why || '').slice(0, 80)).run();
    if (r.ok) sent++;
    else if (r.retry) break;   // after hours: stop here, nothing more tonight
  }
  await env.DB.prepare('UPDATE fillweek_runs SET offers = ?1 WHERE id = ?2').bind(sent, runId).run();
  try { await (await import('./biz.js')).logAct(env, Object.assign({}, c, { staff: (opts && opts.by) || 'Always Open' }), 'Fill my week: offered ' + slotSay + ' to ' + sent + (sent === 1 ? ' past customer' : ' past customers')); } catch (e) {}
  return { ok: true, sent, day: pick.day, slot: slotSay };
}

// From handleSms, before the text goes to the inbox: a YES to a live offer books the first open time that day.
// Returns { book: true, reply } when it handled the booking, or null.
export async function onReply(env, cid, from10, body) {
  await ensureFill(env);
  const offer = await env.DB.prepare("SELECT * FROM fillweek_offers WHERE client_id = ?1 AND phone10 = ?2 AND status = 'sent' AND at > ?3 ORDER BY id DESC LIMIT 1").bind(cid, from10, new Date(Date.now() - 3 * 864e5).toISOString()).first().catch(() => null);
  if (!offer) return null;
  if (!/^\s*(yes|yeah|yep|yup|sure|ok|okay|y|i'?ll take it|that works)\b/i.test(String(body || ''))) {
    await env.DB.prepare("UPDATE fillweek_offers SET status = 'replied' WHERE id = ?1").bind(offer.id).run();
    return null;
  }
  const c = await env.DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(cid).first();
  const { openSlots, bookSlot } = await import('./gcal.js');
  const open = await openSlots(env, cid, Date.now(), 12).catch(() => null);
  const day = open ? openDays(open.slots, open.tz, Date.now() - 36 * 3600e3).find(d => d.day === offer.day) : null;
  const slot = day && day.slots[0];
  const { sendText } = await import('./sms.js');
  const { pushClient } = await import('./app.js');
  const who = offer.name || ('(' + from10.slice(0, 3) + ') ' + from10.slice(3, 6) + '-' + from10.slice(6));
  if (!slot || !(await bookSlot(env, cid, slot, { name: offer.name, phone: from10, reason: 'Fill my week' + (offer.job ? ': ' + offer.job : ''), via: 'Fill my week (they replied YES)' }))) {
    await env.DB.prepare("UPDATE fillweek_offers SET status = 'taken', result = 'no open time left' WHERE id = ?1").bind(offer.id).run();
    await sendText(env, { clientId: cid, to: from10, kind: 'reply', body: 'Thanks, ' + first(offer.name) + '. That time just filled. ' + (c && c.owner_first ? c.owner_first + ' will' : 'We’ll') + ' call you to find another.' });
    await pushClient(env, cid, { aps: { alert: { title: who + ' said yes, but the day filled', body: 'Call them to find another time.' }, sound: 'default', 'thread-id': 'fillweek' }, screen: 'home' }).catch(() => {});
    return { book: false };
  }
  await env.DB.prepare("UPDATE fillweek_offers SET status = 'booked', result = ?1 WHERE id = ?2").bind(slot.say, offer.id).run();
  await env.DB.prepare('UPDATE fillweek_runs SET booked = booked + 1 WHERE id = ?1').bind(offer.run_id).run().catch(() => {});
  // The same confirmation and day-before reminder a booking-page customer gets (they said yes to texts).
  try { await (await import('./autotext.js')).fromBooking(env, cid, { name: offer.name, phone: from10, start: slot.start }); } catch (e) { /* the calendar has it either way */ }
  await pushClient(env, cid, { aps: { alert: { title: 'Fill my week: ' + who + ' booked', body: shortSlot(slot.say) + (offer.job ? ', last time: ' + offer.job : '') + '. It’s on your calendar.' }, sound: 'default', 'thread-id': 'fillweek' }, screen: 'home' }).catch(() => {});
  return { book: true };
}

// Once a day per client, mid-morning in their time: a run when an open day is coming up and none ran in 14 days.
export async function fillCron(env, at) {
  await ensureFill(env);
  const now = at || Date.now();
  const rows = ((await env.DB.prepare("SELECT c.* FROM fillweek f JOIN app_clients c ON c.client_id = f.client_id WHERE f.on_ = 1 AND c.active = 1 AND c.regulated = 0 AND NOT EXISTS (SELECT 1 FROM fillweek_runs r WHERE r.client_id = f.client_id AND r.created > ?1) LIMIT 10").bind(new Date(now - RUN_GAP_DAYS * 864e5).toISOString()).all()).results) || [];
  const { tzFor, local } = await import('./callbacks.js');
  let ran = 0;
  for (const c of rows) {
    const l = local(await tzFor(env, c.client_id), now);
    if (l.hour < 10 || l.hour >= 11 || l.wd === 'Sat' || l.wd === 'Sun') continue;
    const r = await runFill(env, c, { now }).catch(() => null);
    if (r && r.ok) {
      ran++;
      try { await (await import('./app.js')).pushClient(env, c.client_id, { aps: { alert: { title: 'Fill my week: ' + r.slot + ' offered', body: 'Texted ' + r.sent + (r.sent === 1 ? ' past customer' : ' past customers') + '. The first YES gets booked on your calendar.' }, sound: 'default', 'thread-id': 'fillweek' }, screen: 'home' }); } catch (e) {}
    }
  }
  // Offers nobody answered are done once their day has passed.
  await env.DB.prepare("UPDATE fillweek_offers SET status = 'expired' WHERE status = 'sent' AND day < ?1").bind(new Date(now).toISOString().slice(0, 10)).run().catch(() => {});
  return { ran };
}

// App: POST /api/fillweek { action: 'agree' (agree: true) | 'off' | 'run' (day?) }
export async function apiFill(req, env, c) {
  await ensureFill(env);
  if (+c.regulated) return { ok: false, error: 'Not available for regulated businesses.' };
  if (c.staff) return { ok: false, error: 'Only the owner can use this.' };
  let b = {}; try { b = await req.json(); } catch (e) {}
  const now = new Date().toISOString();
  if (b.action === 'agree') {
    if (b.agree !== true) return { ok: false, error: 'Read the agreement and tick the box first.' };
    await env.DB.prepare("INSERT INTO fillweek (client_id, on_, agreed_at, agreed_by, updated) VALUES (?1, 1, ?2, ?3, ?2) ON CONFLICT(client_id) DO UPDATE SET on_ = 1, agreed_at = excluded.agreed_at, agreed_by = excluded.agreed_by, updated = excluded.updated").bind(c.client_id, now, String(b.by || 'Owner').slice(0, 40)).run();
    return { ok: true, on: true, message: 'Fill my week is on.' };
  }
  if (b.action === 'off') {
    await env.DB.prepare("INSERT INTO fillweek (client_id, on_, updated) VALUES (?1, 0, ?2) ON CONFLICT(client_id) DO UPDATE SET on_ = 0, updated = excluded.updated").bind(c.client_id, now).run();
    return { ok: true, on: false, message: 'Fill my week is off.' };
  }
  if (b.action === 'run') {
    const r = await row(env, c.client_id);
    if (!r.on) return { ok: false, error: 'Turn Fill my week on first.' };
    const res = await runFill(env, c, { day: /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : '', by: String(b.by || 'Owner').slice(0, 40) });
    return res.ok ? { ok: true, message: 'Offered ' + res.slot + ' to ' + res.sent + (res.sent === 1 ? ' past customer.' : ' past customers.') + ' The first YES gets booked.' } : res;
  }
  return { ok: false, error: 'Bad request' };
}

// For the app.
export async function fillState(env, c) {
  if (+c.regulated || c.staff) return null;
  const r = await row(env, c.client_id);
  const ready = await readiness(env, c).catch(() => ({ ok: false, why: '' }));
  const last = await env.DB.prepare('SELECT day, created, offers, booked FROM fillweek_runs WHERE client_id = ?1 ORDER BY id DESC LIMIT 1').bind(c.client_id).first().catch(() => null);
  return { on: r.on, ready: ready.ok, why: ready.ok ? '' : ready.why, agreement: AGREEMENT,
    last: last ? { day: last.day, at: last.created, offers: +last.offers || 0, booked: +last.booked || 0 } : null };
}
