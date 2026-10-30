// Checks and balances: is Always Open keeping its promises, not just running?
//
//   approvals   Drafts waiting on an owner's OK. Reminders at 1 day and 3 days (a review under 4 stars after 6 hours),
//               by push to the app, or by email when they have no app. "Every review answered" depends on that tap.
//   setup       New clients whose line has had no real call: forwarding probably isn't on, so they get nothing for
//               their money. Nudges with the exact steps on day 2 and day 5; Christopher hears on day 7.
//   messages    Owner messages to us. An instant "got it, Katie will reply by …", a push to Christopher after 4 business
//               hours with no answer, and the 7 AM push after one business day.
//   spend       Today's Claude use, minutes and texts against a normal day; 3x normal is an alert. (The hard ceiling on
//               texts lives in sms.js, where every text goes through.)
//   paying      Every paying client is served and every served client is paying: Stripe's word on each subscription
//               against the line and the app. A cancellation Stripe confirms turns the line off; anything else is a
//               note for Christopher, because money and service decisions are his.
//   delivery    Texts that carriers stopped delivering (filtering shows up only in Twilio's own records), and the
//               email records (SPF, DMARC) that keep our audit emails out of spam.
// Everything here runs from the 10-minute cron with its own pace, keeps its marks in checks_meta, and adds its open
// items to the 7 AM push (morningChecks). Owner-facing reminders only go out 9 AM to 7 PM Eastern.
const SITE = 'https://alwaysopenoffice.com';
const FROM = { email: 'hello@alwaysopenoffice.com', name: 'Always Open' };
const H = 3600e3, DAY = 24 * H;
const AUTO_BY = 'Always Open (automatic)';
const INTERNAL = new Set(['always-open', 'demo-plumbing']);

const ready = new WeakSet();
export async function ensureChecks(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS checks_meta (k TEXT PRIMARY KEY, at TEXT, v TEXT)').run();
  for (const col of ['nudge INTEGER DEFAULT 0', 'nudged_at TEXT']) { try { await env.DB.prepare('ALTER TABLE app_items ADD COLUMN ' + col).run(); } catch (e) { /* already there */ } }
  ready.add(env.DB);
}
const getMark = async (env, k) => (await env.DB.prepare('SELECT at, v FROM checks_meta WHERE k = ?1').bind(k).first().catch(() => null)) || null;
const setMark = (env, k, v, at) => env.DB.prepare('INSERT OR REPLACE INTO checks_meta (k, at, v) VALUES (?1, ?2, ?3)').bind(k, new Date(at || Date.now()).toISOString(), String(v == null ? '' : v)).run();
// Runs fn at most once per `every` ms (by the mark k).
async function paced(env, k, every, now, fn) {
  const m = await getMark(env, 'ran:' + k);
  if (m && now - Date.parse(m.at) < every) return { skipped: true };
  await setMark(env, 'ran:' + k, '', now);
  return fn();
}

export function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24, minute: +p.minute, wd: p.weekday };
}
const daytime = now => { const h = eastern(now).hour; return h >= 9 && h < 19; };
const weekday = now => !/Sat|Sun/.test(eastern(now).wd);
// Business hours (Mon to Fri, 9 to 5 Eastern) between two moments, in hours, counted a quarter hour at a time.
export function businessHours(from, to) {
  let n = 0;
  for (let t = from; t < to && n < 400; t += 15 * 60e3) { const e = eastern(t); if (!/Sat|Sun/.test(e.wd) && e.hour >= 9 && e.hour < 17) n += 0.25; }
  return n;
}
const dayName = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

async function ping(env, h, title, body, priority, tags) {
  if (h.ping) return h.ping(title, body, priority || 'default');
  return (await import('./app.js')).opsPing(env, title, body, priority || 'default', tags || 'clipboard');
}
async function pushOwner(env, h, cid, note) {
  if (h.pushClient) return h.pushClient(cid, note);
  return (await import('./app.js')).pushClient(env, cid, note).catch(() => 0);
}
// Owner email (only for owners who signed up online: that is where their address and app link are).
async function mailOwner(env, h, to, subject, text) {
  if (h.mail) return h.mail(to, subject, text);
  if (!env.SEND_MAIL || !/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(to || '')) return 'off';
  try { await env.SEND_MAIL.send({ to, from: FROM, replyTo: FROM.email, subject, text }); return 'sent'; } catch (e) { return 'failed'; }
}
const ownerOf = async (env, cid) => env.DB.prepare("SELECT b.email, b.code, b.owner, c.owner_first, c.business FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id WHERE c.client_id = ?1").bind(cid).first().catch(() => null);
const firstName = o => String((o && (o.owner_first || String(o.owner || '').split(/\s+/)[0])) || '').trim();

// ---------- approvals ----------
export async function approvalNudges(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!daytime(now)) return { skipped: 'night' };
  const rows = ((await env.DB.prepare("SELECT client_id, MIN(created) AS oldest, COUNT(*) AS n, MAX(nudge) AS level, SUM(CASE WHEN kind = 'reply' AND stars BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS low, MIN(CASE WHEN kind = 'reply' AND stars BETWEEN 1 AND 3 THEN created END) AS low_at, MIN(CASE WHEN kind = 'reply' AND stars BETWEEN 1 AND 3 THEN stars END) AS stars FROM app_items WHERE status = 'pending' GROUP BY client_id").all()).results) || [];
  const out = [];
  for (const r of rows) {
    if (INTERNAL.has(r.client_id)) continue;
    const age = now - Date.parse(r.oldest), lowAge = r.low_at ? now - Date.parse(r.low_at) : 0, level = +r.level || 0;
    let want = 0;
    if (age >= 3 * DAY) want = 2; else if (age >= DAY || (r.low && lowAge >= 6 * H)) want = 1;
    if (want <= level) continue;
    const o = await ownerOf(env, r.client_id);
    const n = +r.n, low = +r.low;
    const title = low ? 'A ' + r.stars + '-star review is waiting for your OK' : (n === 1 ? 'Something is waiting for your OK' : n + ' things are waiting for your OK');
    const body = (low ? 'Our reply is ready. Answering it today shows people reading your reviews that you care. ' : '') +
      (n > 1 || !low ? plural(n, 'reply or post', 'replies and posts') + ' waiting, the oldest from ' + dayName(r.oldest) + '. ' : '') +
      'Open the app and tap OK, or change anything first.';
    let via = (await pushOwner(env, h, r.client_id, { aps: { alert: { title, body }, sound: 'default', 'thread-id': 'approve' }, screen: 'approve' })) ? 'push' : '';
    if (!via && o && o.email && o.code) {
      const hi = firstName(o) ? 'Hi ' + firstName(o) + ',\n\n' : '';
      via = (await mailOwner(env, h, o.email, title, hi + body.replace('Open the app', 'Open your Always Open app (' + SITE + '/app/' + o.code + ')') + '\n\nAlways Open\n' + (env.BUSINESS_ADDRESS || ''))) === 'sent' ? 'email' : '';
    }
    await env.DB.prepare("UPDATE app_items SET nudge = ?1, nudged_at = ?2 WHERE client_id = ?3 AND status = 'pending'").bind(want, new Date(now).toISOString(), r.client_id).run();
    out.push({ client: r.client_id, level: want, via: via || 'none' });
  }
  return { nudged: out };
}

// ---------- new clients who never got set up ----------
export async function setupNudges(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!daytime(now)) return { skipped: 'night' };
  const lines = ((await env.DB.prepare("SELECT p.client_id, p.number, p.created, b.status, c.business FROM provision p JOIN app_clients c ON c.client_id = p.client_id LEFT JOIN billing b ON b.client_id = p.client_id WHERE p.status = 'live' AND c.active = 1 AND p.created > ?1")
    .bind(new Date(now - 21 * DAY).toISOString()).all().catch(() => ({ results: [] }))).results) || [];
  const out = [];
  for (const l of lines) {
    if (INTERNAL.has(l.client_id) || (l.status && !/^(active|trialing|past_due)$/.test(l.status))) continue;
    const calls = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam')").bind(l.client_id).first();
    if (calls && +calls.n > 0) continue;
    const age = (now - Date.parse(l.created)) / DAY;
    const want = age >= 7 ? 3 : (age >= 5 ? 2 : (age >= 2 ? 1 : 0));
    const k = 'setup:' + l.client_id, m = await getMark(env, k), done = m ? +m.v || 0 : 0;
    if (!want || want <= done) continue;
    if (want === 3) {
      await ping(env, h, 'Always Open: ' + (l.business || 'a new client') + ' has had no calls in a week', 'Max’s line has had no calls since it went live ' + Math.floor(age) + ' days ago, so their missed calls are probably not forwarded to it yet. They got two reminders with the steps. Worth a call to walk them through it.', 'default', 'telephone');
    } else {
      const o = await ownerOf(env, l.client_id);
      const num = String(l.number || '').replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
      const title = want === 1 ? 'Max hasn’t had a call yet' : 'Your missed calls still aren’t reaching Max';
      const body = 'Forward your missed calls to Max’s line, ' + num + ', so he can answer the ones you can’t. It takes a minute, and your phone still rings first. ' + (want === 2 ? 'Until then, callers you miss still go to voicemail. ' : '') + 'The steps for your carrier are in the app under Your first hour.';
      let via = (await pushOwner(env, h, l.client_id, { aps: { alert: { title, body }, sound: 'default' }, screen: 'home' })) ? 'push' : '';
      if (o && o.email && o.code) {
        const hi = firstName(o) ? 'Hi ' + firstName(o) + ',\n\n' : '';
        const sent = await mailOwner(env, h, o.email, title, hi + body.replace('The steps for your carrier are in the app under Your first hour.', 'The steps for your carrier: ' + SITE + '/app/' + o.code + '/help/forwarding') + '\n\nIf you already forwarded them, call Max’s line once from another phone and let it ring through, so we know it’s working. Questions? Reply to this email and Katie will help.\n\nAlways Open\n' + (env.BUSINESS_ADDRESS || ''));
        if (sent === 'sent') via = via ? via + ' and email' : 'email';
      }
      out.push({ client: l.client_id, step: want, via: via || 'none' });
    }
    await setMark(env, k, want, now);
  }
  return { nudged: out };
}

// ---------- owner messages to us ----------
// Right after an owner writes (app.js): one automatic note saying when Katie will answer. At most one every 4 hours.
export function replyBy(now) {
  const e = eastern(now);
  if (!/Sat|Sun/.test(e.wd) && e.hour >= 9 && e.hour < 15) return 'Katie will reply within a few hours.';
  // The next business morning.
  let t = now + H;
  for (let i = 0; i < 96; i++, t += H) { const x = eastern(t); if (!/Sat|Sun/.test(x.wd) && x.hour === 10) break; }
  const e2 = eastern(t), when = e2.day === eastern(now + DAY).day ? 'tomorrow' : new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  return 'Katie will reply by 10 AM ' + when + '.';
}
export async function ackMessage(env, cid, by, now) {
  now = now || Date.now();
  if (INTERNAL.has(cid)) return '';
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_messages WHERE client_id = ?1 AND dir = 'out' AND by = ?2 AND at > ?3").bind(cid, AUTO_BY, new Date(now - 4 * H).toISOString()).first().catch(() => null);
  if (recent && +recent.n) return '';
  const who = String(by || '').trim().split(/\s+/)[0];
  const text = 'Got it' + (who && !/^(owner|staff)$/i.test(who) ? ', ' + who : '') + '. ' + replyBy(now);
  await env.DB.prepare("INSERT INTO app_messages (client_id, at, by, text, hq_synced, dir, notified) VALUES (?1, ?2, ?3, ?4, 1, 'out', 0)").bind(cid, new Date(now).toISOString(), AUTO_BY, text).run();
  return text;
}
// Owner messages with no human answer after them.
async function unanswered(env, now) {
  const rows = ((await env.DB.prepare("SELECT m.id, m.client_id, m.at, m.by, m.text, c.business FROM app_messages m LEFT JOIN app_clients c ON c.client_id = m.client_id WHERE m.dir = 'in' AND m.at > ?1 AND NOT EXISTS (SELECT 1 FROM app_messages r WHERE r.client_id = m.client_id AND r.dir = 'out' AND r.by != ?2 AND r.at >= m.at) ORDER BY m.at")
    .bind(new Date(now - 14 * DAY).toISOString(), AUTO_BY).all()).results) || [];
  return rows.filter(r => !INTERNAL.has(r.client_id));
}
export async function messageTimer(env, now, h) {
  now = now || Date.now(); h = h || {};
  const late = [];
  for (const r of await unanswered(env, now)) {
    const bh = businessHours(Date.parse(r.at), now);
    if (bh < 4) continue;
    const k = 'msg:' + r.id;
    if (await getMark(env, k)) continue;
    await setMark(env, k, 'reminded', now);
    late.push(r);
  }
  if (late.length) {
    const lines = late.slice(0, 4).map(r => (r.business || r.client_id) + ' (' + (r.by || 'owner') + '): ' + String(r.text || '').replace(/\s+/g, ' ').slice(0, 90));
    await ping(env, h, 'Always Open: ' + plural(late.length, 'client message') + ' waiting over 4 business hours', lines.join('\n') + '\nAnswer in Always Open HQ, Clients, Client app, so it shows in their app.', 'high', 'speech_balloon');
  }
  return { reminded: late.length };
}

// ---------- spending ----------
// Rolling 24 hours against the median of the 7 days before. A spike is 3x normal and above a floor that keeps a
// quiet week from making a normal day look like one.
const SPEND = {
  claude: { sql: "SELECT COALESCE(SUM(ai_in + ai_out), 0) AS n FROM app_calls WHERE at >= ?1 AND at < ?2", floor: 1500000, what: 'Claude use on calls (tokens)' },
  minutes: { sql: "SELECT COALESCE(SUM(seconds), 0) / 60 AS n FROM app_calls WHERE at >= ?1 AND at < ?2", floor: 300, what: 'call minutes' },
  texts: { sql: "SELECT COUNT(*) AS n FROM sms_log WHERE at >= ?1 AND at < ?2 AND status NOT IN ('skipped', 'held')", floor: 150, what: 'texts sent' }
};
export async function spendWatch(env, now, h) {
  now = now || Date.now(); h = h || {};
  const out = {};
  for (const [k, s] of Object.entries(SPEND)) {
    const q = async (a, b) => { const r = await env.DB.prepare(s.sql).bind(new Date(a).toISOString(), new Date(b).toISOString()).first().catch(() => null); return +(r && r.n) || 0; };
    const today = await q(now - DAY, now);
    const days = []; for (let d = 1; d <= 7; d++) days.push(await q(now - (d + 1) * DAY, now - d * DAY));
    const normal = days.slice().sort((a, b) => a - b)[3];
    out[k] = { today, normal };
    if (today < s.floor || today < 3 * Math.max(normal, 1)) continue;
    const mk = 'spend:' + k + ':' + eastern(now).day;
    if (await getMark(env, mk)) continue;
    await setMark(env, mk, today, now);
    const send = h.alert || (async (t, d) => (await import('./ops.js')).opsAlert(env, t, '', d));
    await send('spend:' + k, 'Spending spike: ' + Math.round(today).toLocaleString('en-US') + ' ' + s.what + ' in the last 24 hours, against about ' + Math.round(normal).toLocaleString('en-US') + ' on a normal day. Could be a busy day, a robocall storm or something looping. The ops board shows which client.' + (k === 'texts' ? ' Non-urgent texts are held past the hourly ceiling until it calms down.' : ''));
    out[k].alert = true;
  }
  return out;
}

// ---------- paying and served ----------
export async function payingServed(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!env.STRIPE_KEY) return { off: true };
  const stripe = h.stripe || (await import('./billing.js')).stripe;
  try { await (await import('./billing.js')).ensureEvents(env, stripe); } catch (e) { /* tried again tomorrow */ }
  const rows = ((await env.DB.prepare("SELECT b.client_id, b.business, b.sub, b.status, b.updated, c.active, v.on_air FROM billing b LEFT JOIN app_clients c ON c.client_id = b.client_id LEFT JOIN voice_lines v ON v.client_id = b.client_id WHERE b.sub IS NOT NULL AND b.sub != ''").all()).results) || [];
  const notes = [], fixed = [];
  for (const r of rows) {
    let st = '';
    try { st = String((await stripe(env, 'GET', 'subscriptions/' + r.sub)).status || ''); } catch (e) { st = e && e.status === 404 ? 'canceled' : ''; }
    if (!st) continue;
    if (st !== r.status) await env.DB.prepare('UPDATE billing SET status = ?1, updated = ?2 WHERE client_id = ?3').bind(st, new Date(now).toISOString(), r.client_id).run();
    const biz = r.business || r.client_id;
    if (/^(canceled|incomplete_expired)$/.test(st) && (+r.active === 1 || +r.on_air === 1)) {
      // Stripe says it is over: the same as the cancellation webhook would have done.
      await env.DB.prepare('UPDATE app_clients SET active = 0 WHERE client_id = ?1').bind(r.client_id).run();
      try { await (await import('./provision.js')).lineEnded(env, r.client_id); } catch (e) { /* the line check will say */ }
      fixed.push(biz + ' (canceled in Stripe, still on: turned off)');
    } else if (/^(active|trialing)$/.test(st) && +r.active === 0) {
      notes.push(biz + ' is paying (Stripe: ' + st + ') but their app is off');
    } else if (st === 'unpaid' || (st === 'past_due' && r.status === 'past_due' && now - Date.parse(r.updated || 0) > 14 * DAY)) {
      const k = 'unpaid:' + r.client_id + ':' + eastern(now).day.slice(0, 7);
      if (!(await getMark(env, k))) { await setMark(env, k, st, now); notes.push(biz + ' hasn’t paid in over two weeks (Stripe: ' + st + ') and is still being served. Your call: pause or keep going'); }
    }
  }
  if (fixed.length || notes.length) await ping(env, h, 'Always Open: billing and service checked', fixed.concat(notes).join('\n'), notes.length ? 'high' : 'default', 'moneybag');
  return { checked: rows.length, fixed, notes };
}

// ---------- delivery ----------
// Outbound texts Twilio could not deliver in the last 24 hours (error 30007 is carrier filtering).
export async function textDelivery(env, now, h) {
  now = now || Date.now(); h = h || {};
  if (!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)) return { off: true };
  const f = h.fetch || fetch;
  const r = await f('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=300&DateSent%3E=' + new Date(now - DAY).toISOString().slice(0, 10), { headers: { authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN) } });
  if (!r.ok) throw new Error('Twilio answered ' + r.status + ' for the list of texts');
  const j = await r.json();
  const out = (j.messages || []).filter(m => /^outbound/.test(m.direction || '') && now - (Date.parse(m.date_sent || m.date_created) || 0) < DAY);
  const bad = out.filter(m => /^(failed|undelivered)$/.test(m.status || ''));
  const res = { sent: out.length, failed: bad.length };
  if (bad.length < 5 || bad.length / Math.max(out.length, 1) < 0.15) return res;
  const k = 'texts-failing:' + eastern(now).day;
  if (await getMark(env, k)) return res;
  await setMark(env, k, bad.length, now);
  const codes = {}; for (const m of bad) codes[m.error_code || '?'] = (codes[m.error_code || '?'] || 0) + 1;
  const top = Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => c + ' (' + n + ')').join(', ');
  const send = h.alert || (async (t, d) => (await import('./ops.js')).opsAlert(env, t, '', d));
  await send('text-delivery', bad.length + ' of ' + out.length + ' texts in the last 24 hours were not delivered. Twilio error codes: ' + top + '. 30007 means carriers are filtering them: check the wording of the last texts sent and the campaign in Twilio’s console.');
  res.alert = true;
  return res;
}
// The domain's mail records, read through Cloudflare's public DNS.
export async function mailRecords(env, now, h) {
  now = now || Date.now(); h = h || {};
  const f = h.fetch || fetch;
  const domain = String(env.MAIL_DOMAIN || 'alwaysopenoffice.com');
  const txt = async name => {
    const r = await f('https://cloudflare-dns.com/dns-query?type=TXT&name=' + encodeURIComponent(name), { headers: { accept: 'application/dns-json' } });
    if (!r.ok) throw new Error('DNS answered ' + r.status);
    const j = await r.json();
    return (j.Answer || []).map(a => String(a.data || '').replace(/^"|"$/g, '').replace(/" "/g, ''));
  };
  const spf = (await txt(domain)).some(t => /^v=spf1\b/i.test(t)), dmarc = (await txt('_dmarc.' + domain)).some(t => /^v=DMARC1\b/i.test(t));
  const res = { spf, dmarc };
  if (spf && dmarc) return res;
  const k = 'mail-records:' + eastern(now).day.slice(0, 7);
  if (await getMark(env, k)) return res;
  await setMark(env, k, JSON.stringify(res), now);
  const send = h.alert || (async (t, d) => (await import('./ops.js')).opsAlert(env, t, '', d));
  await send('mail-records', 'The mail records for ' + domain + ' are missing: ' + [spf ? '' : 'SPF', dmarc ? '' : 'DMARC'].filter(Boolean).join(' and ') + '. Without them, audit emails and owner reminders are more likely to land in spam. Cloudflare dashboard, ' + domain + ', DNS (Email Routing sets SPF; DMARC is one TXT record at _dmarc).');
  res.alert = true;
  return res;
}

// ---------- the 10-minute run ----------
export async function checksCron(env, now, h) {
  now = now || Date.now(); h = h || {};
  await ensureChecks(env);
  const out = {};
  const step = async (k, every, fn) => { try { out[k] = await paced(env, k, every, now, fn); } catch (e) { out[k] = { error: String((e && e.message) || e).slice(0, 160) }; } };
  await step('approvals', 30 * 60e3, () => approvalNudges(env, now, h));
  await step('setup', 6 * H, () => setupNudges(env, now, h));
  await step('messages', 10 * 60e3 - 5000, () => messageTimer(env, now, h));
  await step('spend', H, () => spendWatch(env, now, h));
  await step('paying', 20 * H, () => payingServed(env, now, h));
  await step('texts', 3 * H, () => textDelivery(env, now, h));
  await step('mail', 20 * H, () => mailRecords(env, now, h));
  const errs = Object.entries(out).filter(([, v]) => v && v.error);
  if (errs.length) throw new Error(errs.map(([k, v]) => k + ': ' + v.error).join('; '));
  return out;
}

// ---------- for the 7 AM push ----------
export async function morningChecks(env, now) {
  now = now || Date.now();
  const parts = [];
  try {
    await ensureChecks(env);
    const stale = ((await env.DB.prepare("SELECT i.client_id, c.business, COUNT(*) AS n, MIN(i.created) AS oldest FROM app_items i LEFT JOIN app_clients c ON c.client_id = i.client_id WHERE i.status = 'pending' AND i.created < ?1 GROUP BY i.client_id ORDER BY oldest LIMIT 4")
      .bind(new Date(now - 3 * DAY).toISOString()).all()).results || []).filter(r => !INTERNAL.has(r.client_id));
    if (stale.length) parts.push('Waiting on owners: ' + stale.map(r => (r.business || r.client_id) + ' (' + r.n + ', oldest ' + Math.floor((now - Date.parse(r.oldest)) / DAY) + ' days)').join(', ') + '.');
    // Unanswered for most of a business day: yesterday morning's message shows in this morning's push.
    const msgs = (await unanswered(env, now)).filter(r => businessHours(Date.parse(r.at), now) >= 6);
    if (msgs.length) parts.push('Unanswered client messages: ' + msgs.slice(0, 4).map(r => (r.business || r.client_id)).join(', ') + '.');
    const setup = ((await env.DB.prepare("SELECT k FROM checks_meta WHERE k LIKE 'setup:%' AND v = '3'").all()).results || []).map(r => r.k.slice(6));
    if (setup.length) {
      const names = [];
      for (const cid of setup.slice(0, 4)) {
        const c = await env.DB.prepare("SELECT business FROM app_clients WHERE client_id = ?1").bind(cid).first().catch(() => null);
        const calls = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND test = 0").bind(cid).first().catch(() => null);
        if (!(calls && +calls.n)) names.push((c && c.business) || cid);
      }
      if (names.length) parts.push('No calls yet, forwarding probably off: ' + names.join(', ') + '.');
    }
  } catch (e) { /* the push still goes */ }
  // Paying clients showing the signs that come before a cancellation (drift.js).
  try { const D = await import('./drift.js'); const t = D.driftText(await D.driftRows(env, now)); if (t) parts.push(t); } catch (e) { /* the push still goes */ }
  return parts.join(' ');
}
