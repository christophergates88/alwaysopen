// The business, in numbers: Christopher's own page at /ops/numbers (same key or link as the ops board).
// Monthly revenue from Stripe plans, the website funnel (free audits, requests, signups), what Max did across every
// client, what it cost (Twilio's real balance drops, plus estimates for Claude and per-client usage), the margin, and
// which signup months are still with us. A once-a-day snapshot keeps the revenue history so the trend builds itself.
// Reads our own tables only; nothing here reaches a client.
import { PLANS } from './billing.js';
import { DEMO_ID } from './demo.js';
import { INTERNAL } from './drift.js';
import { burnPerDay } from './funding.js';

const DAY = 864e5;
const MAX_CENTS = 14900;
// Usage rates for the per-client estimate. Twilio's real total comes from its balance; these only split it fairly
// and show the shape. Change them here if the bills say otherwise.
export const RATES = { voicePerMin: 0.08, perText: 0.011, numberPerMonth: 1.15, claudeInPerM: 1, claudeOutPerM: 5 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(+n || 0)).toLocaleString('en-US');
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
const num = n => Math.round(+n || 0).toLocaleString('en-US');

// Eastern month start (ISO) for the month holding `t`, and `back` months before it.
export function monthStart(t, back) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  let y = +p.year, m = +p.month - (back || 0);
  while (m < 1) { m += 12; y--; }
  return { key: y + '-' + String(m).padStart(2, '0'), iso: new Date(Date.UTC(y, m - 1, 1, 5)).toISOString(), label: MONTHS[m - 1] + ' ' + y };
}

// Pure: monthly revenue from billing rows.
export function mrrOf(rows) {
  let cents = 0, n = 0; const byPlan = {};
  for (const b of rows) {
    if (INTERNAL.has(b.client_id) || b.client_id === DEMO_ID) continue;
    if (!/^(active|trialing|past_due)$/.test(b.status || '')) continue;
    const p = PLANS[b.plan] ? b.plan : 'Starter';
    const c = PLANS[p].cents + (+b.max ? MAX_CENTS : 0);
    cents += c; n++;
    byPlan[p] = byPlan[p] || { n: 0, cents: 0 }; byPlan[p].n++; byPlan[p].cents += c;
  }
  return { cents, clients: n, byPlan };
}

// Pure: what one client's usage is estimated to cost in a month.
export function costOf(u, rates) {
  const r = rates || RATES;
  return (+u.minutes || 0) * r.voicePerMin + (+u.texts || 0) * r.perText + (+u.numbers || 0) * r.numberPerMonth +
    (+u.aiIn || 0) / 1e6 * r.claudeInPerM + (+u.aiOut || 0) / 1e6 * r.claudeOutPerM;
}

// Twilio money actually spent over a span, from the hourly balance readings (funding.js); top-ups are ignored.
export function spentFrom(readings) {
  const r = readings.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let s = 0; for (let i = 1; i < r.length; i++) { const d = r[i - 1].value - r[i].value; if (d > 0) s += d; }
  return s;
}

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS numbers_daily (day TEXT PRIMARY KEY, mrr_cents INTEGER, clients INTEGER, calls INTEGER, at TEXT)').run();
  ready = true;
}

export async function numbersState(env, now) {
  now = now || Date.now();
  await ensure(env);
  const all = async (sql, ...p) => { try { return ((await env.DB.prepare(sql).bind(...p).all()).results) || []; } catch (e) { return []; } };
  const one = async (sql, ...p) => { try { return (await env.DB.prepare(sql).bind(...p).first()) || {}; } catch (e) { return {}; } };
  const cur = monthStart(now, 0), prev = monthStart(now, 1), d30 = new Date(now - 30 * DAY).toISOString(), nowIso = new Date(now).toISOString();
  const billing = await all('SELECT b.client_id, COALESCE(NULLIF(c.business, \'\'), b.business) AS business, b.plan, b.max, b.status, b.created, b.updated FROM billing b LEFT JOIN app_clients c ON c.client_id = b.client_id');
  const mrr = mrrOf(billing);
  const real = billing.filter(b => !INTERNAL.has(b.client_id) && b.client_id !== DEMO_ID);
  const inSpan = (t, a, b) => { const x = Date.parse(t || ''); return x >= Date.parse(a) && x < Date.parse(b); };
  const signups = (a, b) => real.filter(x => inSpan(x.created, a, b)).length;
  const cancels = (a, b) => real.filter(x => /^(canceled|incomplete_expired)$/.test(x.status || '') && inSpan(x.updated, a, b)).length;
  const funnel = async (a, b) => ({
    audits: +(await one('SELECT COUNT(*) AS n FROM audits WHERE at >= ?1 AND at < ?2', a, b)).n || 0,
    requests: +(await one("SELECT COUNT(*) AS n FROM leads WHERE at >= ?1 AND at < ?2 AND status != 'spam'", a, b)).n || 0,
    signups: signups(a, b), cancels: cancels(a, b)
  });
  const fNow = await funnel(cur.iso, nowIso), fPrev = await funnel(prev.iso, cur.iso);
  // Across every client, this month so far.
  const net = await one("SELECT COUNT(*) AS calls, COALESCE(SUM(seconds), 0) / 60 AS minutes, COALESCE(SUM(ai_in), 0) AS ai_in, COALESCE(SUM(ai_out), 0) AS ai_out FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited') AND client_id NOT IN ('demo-plumbing')", cur.iso);
  const texts = +(await one("SELECT COUNT(*) AS n FROM sms_log WHERE at >= ?1 AND status NOT IN ('skipped', 'held')", cur.iso)).n || 0;
  let caught = 0, after = 0;
  try {
    const M = await import('./money.js');
    for (const b of real.filter(x => /^(active|trialing|past_due)$/.test(x.status || ''))) { const m = await M.caughtFor(env, b.client_id, now); caught += m.mid || 0; after += m.afterHoursCalls || 0; }
  } catch (e) { /* counts only */ }
  // Cost, last 30 days: Twilio's real spend from its balance, and the per-client estimate beside it.
  const tw = await all("SELECT at, value FROM funding_log WHERE service = 'twilio' AND at >= ?1 ORDER BY at", d30);
  const twilioSpent = spentFrom(tw);
  const twilioRate = burnPerDay(tw);
  const usage = await all("SELECT client_id, COUNT(*) AS calls, COALESCE(SUM(seconds), 0) / 60.0 AS minutes, COALESCE(SUM(ai_in), 0) AS ai_in, COALESCE(SUM(ai_out), 0) AS ai_out FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited') GROUP BY client_id", d30);
  const tx = await all("SELECT client_id, COUNT(*) AS n FROM sms_log WHERE at >= ?1 AND status NOT IN ('skipped', 'held') GROUP BY client_id", d30);
  const nums = await all('SELECT client_id, COUNT(*) AS n FROM voice_lines WHERE on_air = 1 GROUP BY client_id');
  const T = {}; for (const r of tx) T[r.client_id] = +r.n || 0;
  const N = {}; for (const r of nums) N[r.client_id] = +r.n || 0;
  const U = {}; for (const r of usage) U[r.client_id] = r;
  const perClient = real.filter(b => /^(active|trialing|past_due)$/.test(b.status || '')).map(b => {
    const u = U[b.client_id] || {};
    const rev = ((PLANS[b.plan] || PLANS.Starter).cents + (+b.max ? MAX_CENTS : 0)) / 100;
    const use = { minutes: +u.minutes || 0, texts: T[b.client_id] || 0, numbers: N[b.client_id] || 0, aiIn: +u.ai_in || 0, aiOut: +u.ai_out || 0 };
    const cost = costOf(use);
    return { client_id: b.client_id, business: b.business || b.client_id, plan: b.plan || 'Starter', revenue: rev, calls: +u.calls || 0, minutes: Math.round(use.minutes), texts: use.texts, cost, margin: rev - cost };
  }).sort((a, b) => a.margin - b.margin);
  const own = U['always-open'] || {};
  const ownCost = costOf({ minutes: +own.minutes || 0, texts: T['always-open'] || 0, numbers: N['always-open'] || 0, aiIn: +own.ai_in || 0, aiOut: +own.ai_out || 0 });
  const estTotal = perClient.reduce((s, x) => s + x.cost, 0) + ownCost;
  const claudeEst = Object.values(U).reduce((s, r) => s + (+r.ai_in || 0) / 1e6 * RATES.claudeInPerM + (+r.ai_out || 0) / 1e6 * RATES.claudeOutPerM, 0);
  const costs = { twilio: twilioSpent, twilioPerDay: twilioRate, claude: claudeEst, estimated: estTotal, readings: tw.length };
  const monthlyCost = (twilioSpent || (estTotal - claudeEst)) + claudeEst;
  // Which signup months are still with us.
  const cohorts = {};
  for (const b of real) {
    if (!b.created) continue;
    const k = monthStart(Date.parse(b.created), 0).key;
    cohorts[k] = cohorts[k] || { key: k, label: monthStart(Date.parse(b.created), 0).label, joined: 0, active: 0 };
    cohorts[k].joined++;
    if (/^(active|trialing|past_due)$/.test(b.status || '')) cohorts[k].active++;
  }
  const history = await all('SELECT day, mrr_cents, clients, calls FROM numbers_daily ORDER BY day DESC LIMIT 400');
  return { at: nowIso, month: cur.label, prevMonth: prev.label, mrr, funnel: { now: fNow, prev: fPrev }, network: { calls: +net.calls || 0, minutes: Math.round(+net.minutes || 0), texts, after, caught },
    costs, monthlyCost, margin: mrr.cents / 100 - monthlyCost, perClient, cohorts: Object.values(cohorts).sort((a, b) => a.key < b.key ? 1 : -1), history: history.reverse() };
}

// Once a day: today's revenue and client count, so the trend line has a past.
export async function numbersDaily(env, now) {
  now = now || Date.now();
  await ensure(env);
  const day = new Date(now).toISOString().slice(0, 10);
  const have = await env.DB.prepare('SELECT 1 AS x FROM numbers_daily WHERE day = ?1').bind(day).first();
  if (have) return { skipped: true };
  const billing = ((await env.DB.prepare('SELECT client_id, plan, max, status FROM billing').all()).results) || [];
  const m = mrrOf(billing);
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_calls WHERE at >= ?1 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited')").bind(new Date(now - DAY).toISOString()).first().catch(() => null);
  await env.DB.prepare('INSERT OR IGNORE INTO numbers_daily (day, mrr_cents, clients, calls, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(day, m.cents, m.clients, +(c && c.n) || 0, new Date(now).toISOString()).run();
  return { day, mrr: m.cents / 100, clients: m.clients };
}

// A small line chart of the daily revenue snapshots.
export function sparkline(points) {
  if (points.length < 2) return '';
  const W = 600, H = 120, pad = 18;
  const vals = points.map(p => p.mrr_cents / 100), max = Math.max(1, ...vals), min = Math.min(...vals, 0);
  const x = i => pad + i * (W - pad * 2) / (points.length - 1), y = v => H - pad - (v - min) / Math.max(1, max - min) * (H - pad * 2);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const last = vals.length - 1;
  return '<svg class="nm-spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly revenue by day"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
    '<circle cx="' + x(last).toFixed(1) + '" cy="' + y(vals[last]).toFixed(1) + '" r="4.5" fill="currentColor"/>' +
    '<text x="' + pad + '" y="' + (H - 2) + '">' + esc(points[0].day) + '</text><text x="' + (W - pad) + '" y="' + (H - 2) + '" text-anchor="end">' + esc(points[last].day) + '</text></svg>';
}

export function renderNumbers(s, back) {
  const f = s.funnel.now, p = s.funnel.prev;
  const tile = (v, label, sub, cls) => '<div class="nm-t' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + esc(label) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
  const plans = Object.keys(PLANS).map(k => s.mrr.byPlan[k] ? k + ' ' + s.mrr.byPlan[k].n : '').filter(Boolean).join(' · ') || 'no paying clients yet';
  const frow = (name, a, b) => '<tr><th>' + esc(name) + '</th><td>' + num(a) + '</td><td>' + num(b) + '</td></tr>';
  const pc = s.perClient.map(r => '<tr class="' + (r.margin < 0 ? 'neg' : '') + '"><td><b>' + esc(r.business) + '</b><span>' + esc(r.plan) + '</span></td><td>' + $(r.revenue) + '</td><td>' + num(r.calls) + '</td><td>' + num(r.minutes) + '</td><td>' + num(r.texts) + '</td><td>' + $(r.cost) + '</td><td>' + $(r.margin) + '</td></tr>').join('');
  const co = s.cohorts.map(c => '<tr><th>' + esc(c.label) + '</th><td>' + c.joined + '</td><td>' + c.active + '</td><td>' + pct(c.active, c.joined) + '</td></tr>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>The numbers</title><style>' + CSS + '</style></head><body><main>' +
    '<p class="nm-top"><a href="' + esc(back) + '">← This week</a><span>As of ' + esc(new Date(s.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span></p>' +
    '<h1>Always Open, in numbers</h1>' +
    '<div class="nm-tiles">' +
    tile($(s.mrr.cents / 100), 'monthly revenue', s.mrr.clients + ' paying · ' + plans) +
    tile($(s.monthlyCost), 'monthly cost', 'Twilio last 30 days + Claude estimate') +
    tile($(s.margin), 'monthly margin', s.mrr.cents ? pct(s.margin, s.mrr.cents / 100) + ' of revenue' : '', s.margin < 0 ? 'neg' : 'pos') +
    tile(num(s.network.calls), 'calls Max answered', s.month.split(' ')[0] + ' so far, ' + num(s.network.minutes) + ' minutes') +
    '</div>' +
    (s.history.length >= 2 ? '<section><h2>Monthly revenue over time</h2>' + sparkline(s.history) + '</section>' : '<section><h2>Monthly revenue over time</h2><p class="sub">A snapshot is saved once a day, so this line starts drawing tomorrow.</p></section>') +
    '<section><h2>The funnel</h2><p class="sub">Free audits run on the website, requests sent, and signups. ' + esc(s.month.split(' ')[0]) + ' is so far.</p>' +
    '<table class="nm"><thead><tr><th></th><th>' + esc(s.month.split(' ')[0]) + '</th><th>' + esc(s.prevMonth.split(' ')[0]) + '</th></tr></thead><tbody>' +
    frow('Free audits run', f.audits, p.audits) + frow('Requests', f.requests, p.requests) + frow('Signups', f.signups, p.signups) + frow('Cancellations', f.cancels, p.cancels) +
    '<tr><th>Audit to request</th><td>' + pct(f.requests, f.audits) + '</td><td>' + pct(p.requests, p.audits) + '</td></tr><tr><th>Request to signup</th><td>' + pct(f.signups, f.requests) + '</td><td>' + pct(p.signups, p.requests) + '</td></tr></tbody></table></section>' +
    '<section><h2>What Max did for clients</h2><p class="sub">' + esc(s.month.split(' ')[0]) + ' so far, every paying client together.</p><ul class="nm-l"><li><b>' + num(s.network.after) + '</b> after-hours calls answered</li><li><b>' + $(s.network.caught) + '</b> what those were worth, at each owner’s own numbers (only owners who set an average job)</li><li><b>' + num(s.network.texts) + '</b> texts sent</li></ul></section>' +
    '<section><h2>Costs, last 30 days</h2><ul class="nm-l"><li><b>' + $(s.costs.twilio) + '</b> Twilio, from its real balance' + (s.costs.readings < 24 ? ' (only ' + s.costs.readings + ' readings so far, so this is low)' : ', about ' + $(s.costs.twilioPerDay) + ' a day') + '</li><li><b>' + $(s.costs.claude) + '</b> Claude on calls, estimated from tokens at $' + RATES.claudeInPerM + ' in and $' + RATES.claudeOutPerM + ' out per million (drafts and posts not counted)</li><li><b>' + $(s.costs.estimated) + '</b> the per-client estimate below, for comparison with Twilio’s real number</li></ul></section>' +
    '<section><h2>Per client, last 30 days</h2><p class="sub">Revenue is the plan price. Cost is estimated from minutes, texts, numbers and tokens. Lowest margin first.</p>' +
    (pc ? '<div class="nm-wrap"><table class="nm pc"><thead><tr><th>Business</th><th>Plan</th><th>Calls</th><th>Minutes</th><th>Texts</th><th>Est. cost</th><th>Margin</th></tr></thead><tbody>' + pc + '</tbody></table></div>' : '<p class="sub">No paying clients yet.</p>') + '</section>' +
    '<section><h2>Who stays</h2><p class="sub">Clients by the month they signed up, and how many are still paying.</p>' +
    (co ? '<table class="nm"><thead><tr><th>Signed up</th><th>Joined</th><th>Still with us</th><th>Kept</th></tr></thead><tbody>' + co + '</tbody></table>' : '<p class="sub">No signups yet.</p>') + '</section>' +
    '<p class="nm-foot">Estimates use the rates in numbers.js: voice $' + RATES.voicePerMin + '/min, texts $' + RATES.perText + ' each, numbers $' + RATES.numberPerMonth + '/month.</p>' +
    '</main></body></html>';
}

const CSS = ':root{--ink:#171B26;--slate:#586075;--line:#DCDAD3;--paper:#F5F4F0;--card:#fff;--sign:#D92D20;--ok:#1C6B54}@media(prefers-color-scheme:dark){:root{--ink:#EEF0F4;--slate:#9AA3B5;--line:#2B3243;--paper:#12151D;--card:#1A1F2B;--sign:#FF5A4D;--ok:#5CC9A4}}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:860px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:18px}' +
  'h1{font-size:28px;margin:0}h2{font-size:16px;margin:0 0 4px}.sub{margin:0 0 8px;color:var(--slate);font-size:13.5px}section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}' +
  '.nm-top{display:flex;justify-content:space-between;margin:0;font-size:13px;color:var(--slate)}.nm-top a{color:var(--sign);font-weight:600;text-decoration:none}' +
  '.nm-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px}.nm-t{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:grid;gap:2px}.nm-t b{font-size:26px;font-variant-numeric:tabular-nums}.nm-t span{font-weight:600;font-size:13.5px}.nm-t small{color:var(--slate);font-size:12.5px}.nm-t.pos b{color:var(--ok)}.nm-t.neg b{color:var(--sign)}' +
  '.nm{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}.nm th,.nm td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right}.nm th:first-child,.nm td:first-child{text-align:left}.nm thead th{font-size:12px;color:var(--slate)}.nm td span{display:block;font-size:12px;color:var(--slate)}.nm tr.neg td:last-child{color:var(--sign);font-weight:700}' +
  '.nm-wrap{overflow-x:auto}.nm-l{margin:0;padding-left:18px}.nm-l li{margin:4px 0}.nm-spark{width:100%;height:auto;color:var(--sign)}.nm-spark text{font-size:11px;fill:var(--slate)}.nm-foot{color:var(--slate);font-size:12.5px;margin:0}';
