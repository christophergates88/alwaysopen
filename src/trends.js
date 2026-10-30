// Twelve months at a glance, and everything since the business joined, from Always Open's own records only.
// Nothing here keeps Google's numbers we may not store (ratings and review counts from Places): only what Always Open
// did and wrote down itself, plus the monthly "what assistants say" check (aicheck.js). Counts, hours and money only;
// no customer is ever named.
//   gather(): one client's rows for a span of months.   series(): pure, the months as numbers (tests).
//   since(): pure, the running totals and first-month-against-latest.   lines(): pure, what changed, in plain words.
import { local, tzFor } from './callbacks.js';
import { isAfterHours } from './answerrate.js';
import { figure, dollars } from './money.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SPAN = 12;
const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const labelOf = ym => MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
export const shortOf = ym => SHORT[+ym.slice(5, 7) - 1];

// The `n` month keys ending with the month that holds `at` in `tz`, oldest first.
export function monthKeys(tz, at, n) {
  const cur = local(tz, at).day.slice(0, 7);
  let y = +cur.slice(0, 4), m = +cur.slice(5, 7);
  const out = [];
  for (let i = 0; i < (n || SPAN); i++) {
    out.unshift(y + '-' + String(m).padStart(2, '0'));
    m--; if (!m) { m = 12; y--; }
  }
  return out;
}

// ---------- reading ----------
export async function gather(env, cid, fromIso, toIso) {
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const one = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).first()) || null; } catch (e) { return null; } };
  const a = fromIso, b = toIso;
  const [calls, bookings, reviews, texts, won, requests, ai, settings, joined] = await Promise.all([
    all("SELECT id, at, outcome, caller_name, callback, reason, seconds FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND at < ?3 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview', 'failed')", cid, a, b),
    all("SELECT call_id FROM line_bookings WHERE client_id = ?1 AND status != 'cancelled' AND call_id != '' AND created >= ?2 AND created < ?3", cid, a, b),
    all("SELECT created, decided_at, status FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'review') AND created >= ?2 AND created < ?3", cid, a, b),
    all("SELECT at FROM sms_log WHERE client_id = ?1 AND kind = 'textback' AND status NOT IN ('skipped', 'held', 'failed') AND at >= ?2 AND at < ?3", cid, a, b),
    all("SELECT updated, ROUND(amount / 100.0) AS amount FROM biz_jobs WHERE client_id = ?1 AND stage IN ('booked', 'done', 'paid') AND source != 'demo' AND updated >= ?2 AND updated < ?3", cid, a, b),
    all('SELECT at FROM app_leads WHERE client_id = ?1 AND at >= ?2 AND at < ?3', cid, a, b),
    all('SELECT month, data FROM ai_checks WHERE client_id = ?1', cid),
    one('SELECT avg_job, win_rate FROM app_settings WHERE client_id = ?1', cid),
    joinedAt(env, cid)
  ]);
  return { calls, bookings, reviews, texts, won, requests, ai, avgJob: +(settings && settings.avg_job) || 0, winRate: settings && settings.win_rate != null ? +settings.win_rate : 30, joined };
}

// The business's first day with us: signup, or the first call or item if those came first (clients added by hand).
export async function joinedAt(env, cid) {
  const one = async sql => { try { const r = await env.DB.prepare(sql).bind(cid).first(); return (r && r.t) || ''; } catch (e) { return ''; } };
  const all = [await one('SELECT created AS t FROM billing WHERE client_id = ?1'), await one('SELECT MIN(at) AS t FROM app_calls WHERE client_id = ?1 AND test = 0'),
    await one('SELECT MIN(created) AS t FROM app_items WHERE client_id = ?1')].filter(x => Date.parse(x));
  return all.sort((x, y) => Date.parse(x) - Date.parse(y))[0] || '';
}

// ---------- the months, as numbers ----------
// rows: gather()'s. ctx: { tz, keys (month keys, oldest first), now }.
export function series(rows, ctx) {
  const tz = ctx.tz || 'America/New_York', keys = ctx.keys;
  const idx = {}; keys.forEach((k, i) => { idx[k] = i; });
  const blank = () => ({ calls: 0, after: 0, leads: 0, afterLeads: 0, booked: 0, afterBooked: 0, minutes: 0, reviews: 0, replied: 0, replyHrs: null, textbacks: 0, requests: 0, won: 0, aiRank: null, worth: 0, worthLow: 0, worthHigh: 0 });
  const m = keys.map(() => blank());
  const hrs = keys.map(() => []);
  const at = iso => { const t = Date.parse(iso || ''); if (!t) return -1; const k = local(tz, t).day.slice(0, 7); return idx[k] == null ? -1 : idx[k]; };
  const booked = new Set((rows.bookings || []).map(r => String(r.call_id)).filter(Boolean));
  for (const c of rows.calls || []) {
    const t = Date.parse(c.at || ''); if (!t) continue;
    const l = local(tz, t), i = idx[l.day.slice(0, 7)]; if (i == null) continue;
    const isBooked = booked.has(String(c.id));
    const isLead = isBooked || ((c.outcome === 'done' || c.outcome === 'transferred') && !!(String(c.caller_name || '').trim() || String(c.callback || '').trim() || String(c.reason || '').trim()));
    const ah = isAfterHours(l);
    m[i].calls++; m[i].minutes += Math.max(0, +c.seconds || 0) / 60;
    if (ah) m[i].after++;
    if (isLead) { m[i].leads++; if (ah) m[i].afterLeads++; }
    if (isBooked) { m[i].booked++; if (ah) m[i].afterBooked++; }
  }
  for (const r of rows.reviews || []) {
    const i = at(r.created); if (i < 0) continue;
    m[i].reviews++;
    if (r.status === 'approved' || r.status === 'closed') {
      m[i].replied++;
      const h = (Date.parse(r.decided_at) - Date.parse(r.created)) / 36e5;
      if (isFinite(h) && h >= 0) hrs[i].push(h);
    }
  }
  for (const r of rows.texts || []) { const i = at(r.at); if (i > -1) m[i].textbacks++; }
  for (const r of rows.requests || []) { const i = at(r.at); if (i > -1) m[i].requests++; }
  for (const r of rows.won || []) { const i = at(r.updated); if (i > -1) m[i].won += Math.max(0, +r.amount || 0); }
  for (const r of rows.ai || []) {
    const i = idx[String(r.month || '')]; if (i == null) continue;
    let d = {}; try { d = JSON.parse(r.data || '{}') || {}; } catch (e) { d = {}; }
    if (d.error) continue;
    m[i].aiRank = d.mentioned ? (+d.rank || 0) : 0;
  }
  keys.forEach((k, i) => {
    m[i].minutes = Math.round(m[i].minutes);
    const h = median(hrs[i]); m[i].replyHrs = h == null ? null : Math.round(h * 10) / 10;
    const f = figure({ after: m[i].after, leads: m[i].afterLeads, booked: m[i].afterBooked }, rows.avgJob, rows.winRate);
    m[i].worth = f.mid; m[i].worthLow = f.low; m[i].worthHigh = f.high;
  });
  const joinedKey = rows.joined ? local(tz, Date.parse(rows.joined)).day.slice(0, 7) : '';
  const nowKey = keys[keys.length - 1];
  return keys.map((k, i) => Object.assign({ month: k, label: labelOf(k), short: shortOf(k), before: !!joinedKey && k < joinedKey, partial: k === nowKey, joinedHere: k === joinedKey }, m[i]));
}

// ---------- since they joined ----------
// Totals over every month since joining, and the first full month against the latest full month.
export function since(months, joined, opts) {
  opts = opts || {};
  const live = months.filter(x => !x.before);
  const sum = k => live.reduce((s, x) => s + (+x[k] || 0), 0);
  const hrs = live.filter(x => x.replyHrs != null);
  const out = {
    joined: joined || '', joinedLabel: joined ? labelOf(String(joined).slice(0, 7)) : '', months: live.length,
    calls: sum('calls'), after: sum('after'), leads: sum('leads'), booked: sum('booked'), minutes: sum('minutes'), reviews: sum('reviews'), replied: sum('replied'),
    textbacks: sum('textbacks'), requests: sum('requests'), won: sum('won'), worth: opts.noMoney ? 0 : sum('worth'),
    replyHrs: hrs.length ? Math.round(hrs.reduce((s, x) => s + x.replyHrs * x.replied, 0) / Math.max(1, hrs.reduce((s, x) => s + x.replied, 0)) * 10) / 10 : null,
    first: null, latest: null
  };
  // A month counts as full when they were with us the whole month and it has ended. The month they joined in is skipped
  // when there is a later full one, so a half month never sets the "before".
  const full = live.filter(x => !x.partial);
  const candidates = full.length > 1 ? full.filter(x => !x.joinedHere) : full;
  if (candidates.length >= 2) { out.first = pickMonth(candidates[0], opts.noMoney); out.latest = pickMonth(candidates[candidates.length - 1], opts.noMoney); }
  return out;
}
export function pickMonth(x, noMoney) {
  return { month: x.month, label: x.label, calls: x.calls, after: x.after, leads: x.leads + x.requests, booked: x.booked, reviews: x.reviews, replied: x.replied, replyHrs: x.replyHrs, textbacks: x.textbacks, won: x.won, worth: noMoney ? 0 : x.worth, aiRank: x.aiRank };
}

// ---------- what changed, in words an owner could repeat ----------
export function lines(months, s, opts) {
  opts = opts || {};
  const out = [];
  const live = months.filter(x => !x.before);
  if (s.after) out.push(pl(s.after, 'call', 'calls') + ' came in after hours or on a weekend since ' + (s.joinedLabel ? s.joinedLabel.split(' ')[0] : 'you joined') + '. Before Max, every one of them reached voicemail.' + (s.leads ? ' ' + pl(s.leads, 'caller', 'callers') + ' in all left their details.' : ''));
  if (!opts.noMoney && s.worth) out.push('At your average job and win rate, the after-hours calls alone come to about ' + dollars(s.worth) + ' since you joined.');
  const full = live.filter(x => !x.partial && x.calls);
  if (full.length >= 2) {
    const best = full.slice().sort((x, y) => y.calls - x.calls)[0];
    out.push('Your busiest month was ' + best.label.split(' ')[0] + ', with ' + pl(best.calls, 'call', 'calls') + ' answered.');
  }
  if (s.first && s.latest) {
    const f = s.first, l = s.latest;
    if (f.replyHrs != null && l.replyHrs != null && f.replyHrs - l.replyHrs >= 2) out.push('Review replies went out in about ' + Math.round(l.replyHrs) + ' hours in ' + l.label.split(' ')[0] + ', down from ' + Math.round(f.replyHrs) + ' in ' + f.label.split(' ')[0] + '.');
    if (l.leads - f.leads >= 3) out.push('Leads went from ' + f.leads + ' in ' + f.label.split(' ')[0] + ' to ' + l.leads + ' in ' + l.label.split(' ')[0] + '.');
  }
  const ranked = live.filter(x => x.aiRank != null);
  if (ranked.length >= 2) {
    const a = ranked[0], b = ranked[ranked.length - 1];
    if (a.aiRank !== b.aiRank) {
      if (b.aiRank && (!a.aiRank || b.aiRank < a.aiRank)) out.push('Asked for a business like yours, an AI assistant now names you ' + ord(b.aiRank) + (a.aiRank ? ', up from ' + ord(a.aiRank) : '; in ' + a.label.split(' ')[0] + ' it did not name you') + '.');
      else if (a.aiRank && (!b.aiRank || b.aiRank > a.aiRank)) out.push('AI assistants named you ' + ord(a.aiRank) + ' in ' + a.label.split(' ')[0] + (b.aiRank ? ' and ' + ord(b.aiRank) + ' now' : ' but not this time') + '. We are fixing the details they get wrong.');
    }
  }
  if (s.textbacks) out.push(pl(s.textbacks, 'caller', 'callers') + ' who hung up got a text back within a minute.');
  return out.slice(0, 5);
}

// ---------- one client, ready for the year page and the app ----------
export async function trendsFor(env, c, now) {
  now = now || Date.now();
  const cid = c.client_id || c;
  const tz = await tzFor(env, cid);
  const keys = monthKeys(tz, now, SPAN);
  const from = new Date(Date.parse(keys[0] + '-01T00:00:00Z') - 2 * 864e5).toISOString(), to = new Date(now + 864e5).toISOString();
  const rows = await gather(env, cid, from, to);
  const noMoney = c.role === 'tech';
  if (noMoney) rows.avgJob = 0;
  const months = series(rows, { tz, keys, now });
  const s = since(months, rows.joined, { noMoney });
  // Totals before the twelve months shown, so "since you joined" stays true for a business with us longer than a year.
  if (rows.joined && Date.parse(rows.joined) < Date.parse(from)) {
    const older = await gather(env, cid, rows.joined, from);
    const olderKeys = monthKeysBetween(local(tz, Date.parse(rows.joined)).day.slice(0, 7), keys[0]);
    if (olderKeys.length) {
      if (noMoney) older.avgJob = 0;
      const om = series(Object.assign(older, { joined: rows.joined }), { tz, keys: olderKeys, now });
      for (const k of ['calls', 'after', 'leads', 'booked', 'minutes', 'reviews', 'replied', 'textbacks', 'requests', 'won', 'worth']) s[k] += om.filter(x => !x.before).reduce((t, x) => t + (+x[k] || 0), 0);
      s.months += om.filter(x => !x.before).length;
      // The real "before" is their first full month, which is older than the twelve shown.
      const firstFull = om.filter(x => !x.before && !x.joinedHere && !x.partial)[0];
      if (firstFull && s.latest) s.first = pickMonth(firstFull, noMoney);
    }
  }
  return { tz, months, since: s, lines: lines(months, s, { noMoney }), avgJob: rows.avgJob, winRate: rows.winRate, noMoney };
}

// Month keys from `a` up to but not including `b`.
export function monthKeysBetween(a, b) {
  const out = [];
  let y = +a.slice(0, 4), m = +a.slice(5, 7);
  for (let i = 0; i < 240; i++) {
    const k = y + '-' + String(m).padStart(2, '0');
    if (k >= b) break;
    out.push(k);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// The short version for the monthly report and the app's Home card: one sentence of the running totals.
export function sinceLine(s, opts) {
  opts = opts || {};
  if (!s || !s.calls || !s.joinedLabel) return '';
  return 'Since you joined in ' + s.joinedLabel + ': ' + pl(s.calls, 'call', 'calls') + ' answered, ' + s.after + ' of them after hours' + (!opts.noMoney && s.worth ? ', worth about ' + dollars(s.worth) + ' at your numbers' : '') + '.';
}
