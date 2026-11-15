// Always Open HQ, the analytical half (Nov 15, 2026). The one-list page answered "what needs me" and folded the rest
// away; he said it was "NOT like I want. I need it more analytical so I can see everything". This file reads every
// number the site keeps about itself and draws it: the system (checks, every background job, the 4 AM test call, the
// backup, crashes), the money (revenue, Twilio's balance, cost, margin), sales (letters, audits, requests, follow-ups),
// Max's calls (per day, when they come, how they ended, how he sounded), texts, clients, and the work in the pipes.
// opshq.js puts the panels on the page around the things that need him, which keep their buttons.
//   dashState(env, now)   everything below, read fresh; each part is on its own, so one that fails leaves a gap, not a crash
//   shape(raw, now)       pure: the hourly counts as Eastern days, the day-by-time grid, and the 30-day totals (tests)
//   the rest              pure HTML: tiles, tables, column charts, a line, a grid. No library; the page weighs nothing.
// Charts follow one set of rules: two series at most (blue, then orange), thin columns, a legend whenever there are
// two, every value also in a table cell or a tooltip, status always an icon and a word, never a colour alone.
const DAY = 864e5, ET = 'America/New_York', DEMO = 'demo-plumbing';
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = n => Math.round(+n || 0).toLocaleString('en-US');
export const usd = n => (n < 0 ? '−$' : '$') + Math.abs(+n || 0).toLocaleString('en-US', { minimumFractionDigits: Math.abs(+n || 0) < 100 && (+n || 0) % 1 ? 2 : 0, maximumFractionDigits: Math.abs(+n || 0) < 100 ? 2 : 0 });
export const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '–');
const pl = (n, one, many) => num(n) + ' ' + (+n === 1 ? one : many);

// ---------- time, in Eastern ----------
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
export function etOf(ms) {
  const p = {}; for (const x of PARTS.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24, wd: p.weekday };
}
// The `n` Eastern days ending today, oldest first. Stepped on the calendar, so a 23- or 25-hour day never repeats or skips.
export function dayKeys(now, n) {
  const t = etOf(now).day, base = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  const out = []; for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * DAY).toISOString().slice(0, 10));
  return out;
}
const dayLabel = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const wdOf = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
export function ago(iso, now) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso); if (!t) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return m + ' min';
  if (m < 48 * 60) return Math.round(m / 60) + ' hr';
  return Math.round(m / 1440) + ' days';
}
const stamp = (iso, now) => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso); if (!t) return '';
  const d = new Date(t), time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
  if (etOf(t).day === etOf(now).day) return 'Today ' + time;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ET }) + ' ' + time;
};

// ---------- reading ----------
export const BANDS = ['6–9a', '9a–12', '12–3p', '3–6p', '6–9p', 'Night'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const bandOf = h => (h >= 6 && h < 9 ? 0 : h >= 9 && h < 12 ? 1 : h >= 12 && h < 15 ? 2 : h >= 15 && h < 18 ? 3 : h >= 18 && h < 21 ? 4 : 5);

// Pure. raw.*H are rows counted by UTC hour ({ h: '2026-11-15T14', ... }); they come back as Eastern days.
export function shape(raw, now) {
  const keys = dayKeys(now, 60), idx = {}; keys.forEach((k, i) => { idx[k] = i; });
  const blank = () => ({ real: 0, test: 0, secs: 0, audits: 0, leads: 0, texts: 0, errors: 0 });
  const all = keys.map(k => Object.assign({ d: k, label: dayLabel(k), wd: wdOf(k) }, blank()));
  const heat = WD.map(() => [0, 0, 0, 0, 0, 0]);
  const cut = keys[30];   // the first of the last 30 days
  const put = (rows, f) => { for (const r of rows || []) { const t = Date.parse(String(r.h || '') + ':00:00Z'); if (!t) continue; const e = etOf(t), i = idx[e.day]; if (i != null) f(all[i], r, e); } };
  put(raw.callsH, (d, r, e) => {
    d.real += +r.real || 0; d.test += +r.test || 0; d.secs += +r.secs || 0;
    if (e.day >= cut && +r.real) { const w = WD.indexOf(e.wd); if (w > -1) heat[w][bandOf(e.hour)] += +r.real; }
  });
  put(raw.auditsH, (d, r) => { d.audits += +r.n || 0; });
  put(raw.leadsH, (d, r) => { d.leads += +r.n || 0; });
  put(raw.textsH, (d, r) => { d.texts += +r.n || 0; });
  put(raw.errorsH, (d, r) => { d.errors += +r.n || 0; });
  const sum = (list, k) => list.reduce((s, x) => s + x[k], 0);
  const days = all.slice(30), before = all.slice(0, 30), tot = {}, prev = {};
  for (const k of Object.keys(blank())) { tot[k] = sum(days, k); prev[k] = sum(before, k); }
  return { days, tot, prev, heat, week: { real: sum(days.slice(23), 'real'), test: sum(days.slice(23), 'test'), prevReal: sum(days.slice(16, 23), 'real') } };
}

// Renewals from wrangler.toml ("name:YYYY-MM-DD|name:YYYY-MM-DD"), soonest first.
export function renewals(spec, now) {
  return String(spec || '').split('|').map(x => { const i = x.lastIndexOf(':'); const date = x.slice(i + 1).trim(), t = Date.parse(date + 'T12:00:00Z'); return i > 0 && t ? { name: x.slice(0, i).trim(), date, days: Math.round((t - now) / DAY) } : null; }).filter(Boolean).sort((a, b) => a.days - b.days);
}

export async function dashState(env, now) {
  now = now || Date.now();
  const iso = ms => new Date(ms).toISOString();
  const d7 = iso(now - 7 * DAY), d30 = iso(now - 30 * DAY), d61 = iso(now - 61 * DAY), d90 = iso(now - 90 * DAY), nowIso = iso(now);
  // A table that is not there yet reads as empty; a query written for a newer layout falls back to its older form.
  const q = async (sql, ...b) => { try { return ((await env.DB.prepare(sql).bind(...b).all()).results) || []; } catch (e) { return []; } };
  const q2 = async (sql, old, ...b) => { try { return ((await env.DB.prepare(sql).bind(...b).all()).results) || []; } catch (e) { return q(old, ...b); } };
  const safe = async f => { try { return await f(); } catch (e) { return null; } };
  const notTest = "LEFT JOIN app_calls k ON l.origin LIKE 'phone %' AND k.id = substr(l.origin, 7) WHERE COALESCE(k.test, 0) = 0 AND l.status != 'spam'";
  const R = {};
  const jobs = {
    callsH: q("SELECT substr(at, 1, 13) AS h, SUM(CASE WHEN test = 0 THEN 1 ELSE 0 END) AS real, SUM(CASE WHEN test = 1 THEN 1 ELSE 0 END) AS test, SUM(CASE WHEN test = 0 THEN seconds ELSE 0 END) AS secs FROM app_calls WHERE at > ?1 AND client_id != ?2 AND outcome != 'spam' GROUP BY h", d61, DEMO),
    callOut: q('SELECT outcome, test, COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS secs FROM app_calls WHERE at > ?1 AND client_id != ?2 GROUP BY outcome, test', d30, DEMO),
    callWho: q("SELECT k.client_id, COALESCE(c.business, k.client_id) AS business, COUNT(*) AS n, COALESCE(SUM(k.seconds), 0) / 60.0 AS minutes, MAX(k.at) AS last FROM app_calls k LEFT JOIN app_clients c ON c.client_id = k.client_id WHERE k.at > ?1 AND k.test = 0 AND k.outcome != 'spam' GROUP BY k.client_id ORDER BY n DESC", d30),
    auditsH: q('SELECT substr(at, 1, 13) AS h, COUNT(*) AS n FROM audits WHERE at > ?1 GROUP BY h', d61),
    audits90: q('SELECT COUNT(*) AS n FROM audits WHERE at > ?1', d90),
    auditG: q("SELECT CASE WHEN score >= 90 THEN 'A' WHEN score >= 78 THEN 'B' WHEN score >= 62 THEN 'C' WHEN score >= 40 THEN 'D' ELSE 'F' END AS g, COUNT(*) AS n FROM audits WHERE at > ?1 AND score IS NOT NULL GROUP BY g", d30),
    leadsH: q2('SELECT substr(l.at, 1, 13) AS h, COUNT(*) AS n FROM leads l ' + notTest + " AND (l.status != 'letter' OR COALESCE(l.callme_at, '') != '') AND l.at > ?1 GROUP BY h",
      'SELECT substr(l.at, 1, 13) AS h, COUNT(*) AS n FROM leads l ' + notTest + " AND l.status != 'letter' AND l.at > ?1 GROUP BY h", d61),
    leadStat: q("SELECT l.status, CASE WHEN l.origin LIKE 'phone %' THEN 'phone' WHEN l.origin LIKE 'letter%' THEN 'letter' ELSE 'form' END AS src, COUNT(*) AS n FROM leads l " + notTest + ' AND l.at > ?1 GROUP BY l.status, src', d90),
    leadMail: q("SELECT COUNT(*) AS n, SUM(CASE WHEN audit = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN audit = 'missed' THEN 1 ELSE 0 END) AS missed, SUM(CASE WHEN COALESCE(views, '') NOT IN ('', '0') THEN 1 ELSE 0 END) AS viewed, SUM(CASE WHEN COALESCE(engaged, '') != '' THEN 1 ELSE 0 END) AS engaged, SUM(CASE WHEN COALESCE(fu1_at, '') != '' THEN 1 ELSE 0 END) AS fu1, SUM(CASE WHEN COALESCE(fu2_at, '') != '' THEN 1 ELSE 0 END) AS fu2, SUM(CASE WHEN COALESCE(stop, '') = 'unsubscribed' THEN 1 ELSE 0 END) AS unsub, SUM(CASE WHEN COALESCE(callme_at, '') != '' THEN 1 ELSE 0 END) AS callme FROM leads WHERE at > ?1 AND status != 'spam' AND COALESCE(email, '') != ''", d90),
    letters: q("SELECT status, COUNT(*) AS n, COALESCE(SUM(cost), 0) AS cost, SUM(CASE WHEN COALESCE(opened_at, '') != '' THEN 1 ELSE 0 END) AS opened, MAX(sent_at) AS last FROM mail_queue GROUP BY status"),
    textsH: q("SELECT substr(at, 1, 13) AS h, COUNT(*) AS n FROM sms_log WHERE at > ?1 AND status NOT IN ('skipped', 'held') GROUP BY h", d61),
    textsK: q('SELECT kind, status, COUNT(*) AS n FROM sms_log WHERE at > ?1 GROUP BY kind, status', d30),
    textsC: q("SELECT client_id, COUNT(*) AS n FROM sms_log WHERE at > ?1 AND status NOT IN ('skipped', 'held') GROUP BY client_id", d30),
    optouts: q('SELECT COUNT(*) AS n FROM sms_optout'),
    brands: q('SELECT status, COUNT(*) AS n FROM sms_brands GROUP BY status'),
    a2p: q('SELECT status, COUNT(*) AS n FROM a2p_reg GROUP BY status'),
    items: q('SELECT kind, status, COUNT(*) AS n FROM app_items WHERE client_id != ?1 GROUP BY kind, status', DEMO),
    conn: q("SELECT 'Google Business Profile' AS k, COUNT(*) AS n FROM gbp_tokens UNION ALL SELECT 'Google Calendar', COUNT(*) FROM gcal_tokens UNION ALL SELECT 'Facebook and Instagram', COUNT(*) FROM meta_pages"),
    connBad: q('SELECT COUNT(*) AS n FROM connection_health WHERE broken_at IS NOT NULL'),
    social: q('SELECT day, theme, result FROM social_posts ORDER BY day DESC LIMIT 6'),
    callbacks: q('SELECT status, COUNT(*) AS n FROM callbacks GROUP BY status'),
    checkins: q('SELECT status, COUNT(*) AS n FROM checkins WHERE created > ?1 GROUP BY status', d30),
    outcalls: q('SELECT status, COUNT(*) AS n FROM outcalls GROUP BY status'),
    followups: q('SELECT status, COUNT(*) AS n FROM app_followups WHERE client_id != ?1 GROUP BY status', DEMO),
    outreach: q("SELECT COALESCE(NULLIF(outcome, ''), NULLIF(status, ''), 'placed') AS k, COUNT(*) AS n FROM outreach_calls WHERE at > ?1 GROUP BY k", d30),
    outlists: q('SELECT status, COUNT(*) AS n FROM outreach_lists GROUP BY status'),
    pushq: q("SELECT status, COALESCE(NULLIF(via, ''), '') AS via, COUNT(*) AS n FROM push_queue WHERE at > ?1 GROUP BY status, via", d7),
    provision: q('SELECT status, COUNT(*) AS n FROM provision GROUP BY status'),
    lines: q('SELECT v.number, v.client_id, COALESCE(c.business, v.business, v.client_id) AS business, v.on_air, v.industry, v.spanish FROM voice_lines v LEFT JOIN app_clients c ON c.client_id = v.client_id ORDER BY business'),
    heartbeats: q('SELECT task, at FROM heartbeats'),
    drills: q('SELECT day, status, attempt, detail FROM drill_runs ORDER BY day DESC LIMIT 14'),
    errorsR: q('SELECT route, COUNT(*) AS n, MAX(at) AS last, MAX(message) AS msg FROM errors WHERE at > ?1 GROUP BY route ORDER BY n DESC LIMIT 12', d7),
    errorsH: q('SELECT substr(at, 1, 13) AS h, COUNT(*) AS n FROM errors WHERE at > ?1 GROUP BY h', d61),
    alerts: q("SELECT type, at, n FROM ops_alerts WHERE at > ?1 AND type NOT LIKE 'board:%' ORDER BY at DESC LIMIT 12", now - 7 * DAY),
    fund: q("SELECT at, value FROM funding_log WHERE service = 'twilio' AND at > ?1 ORDER BY at", d30),
    health: safe(async () => (await import('./ops.js')).healthStatus(env, now)),
    cron: safe(async () => (await import('./ops.js')).cronRuns(env)),
    backup: safe(async () => (await import('./backup.js')).lastBackup(env)),
    launch: safe(async () => (await import('./launch.js')).launchState(env)),
    numbers: safe(async () => (await import('./numbers.js')).numbersState(env, now)),
    grades: safe(async () => (await import('./grades.js')).statsFor(env, d30, nowIso)),
    gradesPrev: safe(async () => (await import('./grades.js')).statsFor(env, d61, d30))
  };
  const names = Object.keys(jobs), got = await Promise.all(names.map(k => jobs[k]));
  names.forEach((k, i) => { R[k] = got[i]; });
  // Twilio: the latest reading, what a day costs (the last week's drops), and one closing balance per Eastern day.
  let twilio = null;
  if ((R.fund || []).length) {
    const f = R.fund, bal = +f[f.length - 1].value, wk = f.filter(r => Date.parse(r.at) > now - 7 * DAY);
    let perDay = 0; try { perDay = (await import('./funding.js')).burnPerDay(wk); } catch (e) { perDay = 0; }
    const byDay = new Map(); for (const r of f) byDay.set(etOf(Date.parse(r.at)).day, +r.value);
    twilio = { balance: bal, perDay, daysLeft: perDay > 0 ? bal / perDay : null, at: f[f.length - 1].at, series: [...byDay].map(([d, v]) => ({ d, label: dayLabel(d), v })) };
  }
  return Object.assign({ now, twilio, renewals: renewals(env.RENEWALS, now) }, R, shape(R, now));
}

// ---------- small pieces ----------
// A state is always an icon and a word. kind: ok | warn | bad | off.
const ICON = { ok: '✓', warn: '!', bad: '✕', off: '–' };
export const st = (kind, label) => '<span class="st ' + kind + '"><i aria-hidden="true">' + ICON[kind] + '</i>' + esc(label) + '</span>';
export const panel = (title, body, o) => '<div class="pn' + (o && o.w ? ' w' + o.w : '') + '"' + (o && o.id ? ' id="' + o.id + '"' : '') + '><h3>' + esc(title) + (o && o.n != null ? ' <span class="ct">' + esc(o.n) + '</span>' : '') + '</h3>' + (o && o.sub ? '<p class="ps">' + esc(o.sub) + '</p>' : '') + body + '</div>';
// head: ['Name', ['Calls', 'r'], ...] ('r' = a number column). rows: arrays of ready HTML.
export function table(head, rows, empty) {
  if (!rows.length) return '<p class="nil">' + esc(empty || 'Nothing yet.') + '</p>';
  const cls = head.map(h => (Array.isArray(h) && h[1] === 'r' ? ' class="r"' : ''));
  return '<div class="tw"><table class="tb"><thead><tr>' + head.map((h, i) => '<th' + cls[i] + '>' + esc(Array.isArray(h) ? h[0] : h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map((c, i) => '<td' + (cls[i] || '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
const delta = (cur, prev, label) => (prev == null || (!cur && !prev) ? '' : (cur === prev ? 'the same as ' : (cur > prev ? 'up ' : 'down ') + num(Math.abs(cur - prev)) + ' on ') + label);
// One figure. state (optional) puts an icon and a word under it.
export const tile = (value, label, sub, o) => '<a class="kp" href="#' + esc((o && o.to) || 'top') + '"><span class="kl">' + esc(label) + '</span><b>' + esc(value) + '</b>' +
  (o && o.state ? st(o.state[0], o.state[1]) : '') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</a>';

// ---------- charts ----------
// A chart is a plot that stretches to its box (so it is as sharp on a phone as on a desk) with its words set around it
// in ordinary text, which never stretches. The plot's own space is 1000 wide by 100 tall whatever its size on screen.
// The top of the scale: a round number whose half is round too, so the middle line never reads 2.5 calls.
export const niceMax = m => { if (m <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); for (const k of [1, 2, 4, 6, 8, 10]) if (m <= k * p) return k * p; return 10 * p; };
const tick = v => (v >= 10000 ? (v / 1000) + 'K' : num(v));
const f1 = n => (+n).toFixed(1);
const frame = (h, yl, plot, over, xl, label, wide) => '<div class="cv' + (wide ? ' end' : '') + '"><div class="cy" style="height:' + h + 'px;width:' + (Math.max(...yl.map(t => String(t[1]).length)) * 0.62 + 0.3).toFixed(1) + 'em">' + yl.map(t => '<span style="bottom:' + f1(t[0]) + '%">' + esc(t[1]) + '</span>').join('') + '</div>' +
  '<div class="cp" style="height:' + h + 'px"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="' + esc(label || '') + '">' + plot + '</svg>' + over + '</div>' +
  '<div class="cx">' + xl.map(t => '<span>' + esc(t) + '</span>').join('') + '</div></div>';
const grid = max => [0, max / 2, max].map(v => '<line class="' + (v ? 'gr' : 'bl') + '" x1="0" x2="1000" y1="' + f1(100 - v / max * 100) + '" y2="' + f1(100 - v / max * 100) + '"/>').join('');
const xLabels = (pts, k) => { const n = pts.length, want = Math.min(k || 5, n), out = []; for (let i = 0; i < want; i++) out.push(pts[Math.round(i * (n - 1) / Math.max(1, want - 1))].label); return out; };
// Columns, one per day. series: [{ name, key }] (one or two; two are stacked with a gap between). Each day is its own
// hit area carrying the whole readout, so a thumb never has to land on a thin bar.
export function columns(days, series, o) {
  o = o || {};
  const n = days.length || 1, band = 1000 / n, bw = band * 0.72, gap = 1.4, r = 2.6;
  const totals = days.map(d => series.reduce((s, x) => s + (+d[x.key] || 0), 0)), max = niceMax(Math.max(1, ...totals));
  let marks = '', hits = '';
  days.forEach((d, i) => {
    const x = i * band + (band - bw) / 2; let base = 100;
    const live = series.map((s, k) => ({ k, v: +d[s.key] || 0 })).filter(z => z.v > 0);
    live.forEach((z, j) => {
      const full = z.v / max * 100, top = j === live.length - 1, g = j ? gap : 0, h = Math.max(0.8, full - g), y0 = base - g - h, ry = top ? Math.min(r, h) : 0, rx = bw * 0.22;
      marks += ry > 0.3 ? '<path class="s' + (z.k + 1) + '" d="M' + f1(x) + ' ' + f1(y0 + h) + 'V' + f1(y0 + ry) + 'A' + f1(rx) + ' ' + f1(ry) + ' 0 0 1 ' + f1(x + rx) + ' ' + f1(y0) + 'H' + f1(x + bw - rx) + 'A' + f1(rx) + ' ' + f1(ry) + ' 0 0 1 ' + f1(x + bw) + ' ' + f1(y0 + ry) + 'V' + f1(y0 + h) + 'Z"/>'
        : '<rect class="s' + (z.k + 1) + '" x="' + f1(x) + '" y="' + f1(y0) + '" width="' + f1(bw) + '" height="' + f1(h) + '"/>';
      base -= full;
    });
    const tip = d.wd + ' ' + d.label + ': ' + series.map(s => num(d[s.key]) + ' ' + s.name).join(', ');
    hits += '<rect class="hit" tabindex="0" x="' + f1(i * band) + '" y="0" width="' + f1(band) + '" height="100" data-tip="' + esc(tip) + '"><title>' + esc(tip) + '</title></rect>';
  });
  const legend = series.length > 1 ? '<div class="lg">' + series.map((s, k) => '<span><i class="key s' + (k + 1) + '"></i>' + esc(s.name) + '</span>').join('') + '</div>' : '';
  return legend + frame(o.h || 150, [[0, '0'], [50, tick(max / 2)], [100, tick(max)]], grid(max) + marks + hits, '', xLabels(days, 5), o.label);
}
// One line: a 2px stroke, a faint wash under it, the last value named at its end.
export function line(points, o) {
  o = o || {};
  if (points.length < 2) return '<p class="nil">' + esc(o.empty || 'Not enough readings yet to draw a line.') + '</p>';
  const n = points.length, vals = points.map(p => +p.v || 0), max = niceMax(Math.max(1, ...vals)), fmt = o.fmt || num;
  const x = i => i * 1000 / (n - 1), y = v => 100 - v / max * 100;
  const d = vals.map((v, i) => (i ? 'L' : 'M') + f1(x(i)) + ' ' + f1(y(v))).join('');
  const hits = points.map((p, i) => { const tip = p.label + ': ' + fmt(p.v); return '<rect class="hit" tabindex="0" x="' + f1(x(i) - 500 / (n - 1)) + '" y="0" width="' + f1(1000 / (n - 1)) + '" height="100" data-tip="' + esc(tip) + '"><title>' + esc(tip) + '</title></rect>'; }).join('');
  const last = vals[n - 1], up = f1(last / max * 100);
  return frame(o.h || 150, [[0, fmt(0)], [50, fmt(max / 2)], [100, fmt(max)]], grid(max) + '<path class="wash" d="' + d + 'L1000 100L0 100Z"/><path class="ln" d="' + d + '"/>' + hits,
    '<i class="dot" style="bottom:' + up + '%"></i><b class="endl" style="bottom:' + up + '%">' + esc(fmt(last)) + '</b>', xLabels(points, 3), o.label, true);
}
// Day by time of day: one hue, deeper = more, and the count printed in every cell (it is its own table).
export function heatGrid(heat) {
  const max = Math.max(0, ...heat.flat());
  const cls = v => (!v ? 'h0' : 'h' + Math.max(1, Math.ceil(v / max * 5)));
  return '<div class="tw"><table class="hm"><thead><tr><th></th>' + BANDS.map(b => '<th>' + esc(b) + '</th>').join('') + '</tr></thead><tbody>' +
    heat.map((row, i) => '<tr><th>' + WD[i] + '</th>' + row.map((v, j) => '<td class="' + cls(v) + '" tabindex="0" data-tip="' + WD[i] + ' ' + esc(BANDS[j]) + ': ' + pl(v, 'call', 'calls') + '">' + (v || '·') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
// A funnel or a ranking: label, a thin bar, the count, and (when given) what share of the step above it kept.
export function bars(rows, o) {
  const max = Math.max(1, ...rows.map(r => +r.v || 0));
  return '<div class="hb">' + rows.map(r => '<div class="hr"><span class="hl">' + esc(r.label) + '</span><span class="ht"><i style="width:' + ((+r.v || 0) / max * 100).toFixed(1) + '%"></i></span><b>' + esc(o && o.fmt ? o.fmt(r.v) : num(r.v)) + '</b><span class="hn">' + esc(r.note || '') + '</span></div>').join('') + '</div>';
}

// ---------- the panels ----------
const CHECKS = { d1: 'Database', email: 'Email out', texting: 'Twilio keys', 'max-line': 'Max’s line', cron: 'The 10-minute run', 'twilio-numbers': 'Every number reaches us', 'apple-push': 'iPhone push key', ntfy: 'Phone alerts', stripe: 'Stripe', backup: 'Weekly backup', 'google-connections': 'Google connections' };
// An alarm's code, in words: health:stripe -> Check failing: Stripe.
export const alarmName = t => { const s = String(t || ''), i = s.indexOf(':'), k = i < 0 ? s : s.slice(0, i), r = i < 0 ? '' : s.slice(i + 1);
  return k === 'health' ? 'Check failing: ' + (CHECKS[r] || r) : k === 'cron' ? 'Job failing: ' + r : k === 'crash' ? 'Page crashed: ' + r : k === 'deploy' ? 'A deploy did not go through' : k === 'google-connection' ? 'A client’s Google ' + r + ' connection broke' : s; };
const by = (rows, k, v) => { const m = {}; for (const r of rows || []) m[r[k]] = (m[r[k]] || 0) + (+r[v || 'n'] || 0); return m; };

export function systemPanels(d) {
  const now = d.now, out = [];
  const checks = (d.health && d.health.checks) || [], bad = checks.filter(c => !c.ok);
  out.push(panel('Checks', table(['Check', 'State', 'What it says'], checks.slice().sort((a, b) => a.ok - b.ok).map(c => [esc(CHECKS[c.name] || c.name), c.ok ? st('ok', 'Passing') : st('bad', 'Failing'), c.ok ? '' : esc(c.why || '')]), 'The checks have not run yet.'),
    { w: 6, n: checks.length ? (bad.length ? bad.length + ' failing' : 'all ' + checks.length + ' passing') : null, sub: 'Looked at every 10 minutes; the slower ones once an hour.' }));
  // every background job: failing first, then the one that ran longest ago
  const cron = (d.cron || []).slice().sort((a, b) => (+a.ok - +b.ok) || (Date.parse(a.at) - Date.parse(b.at))), failed = cron.filter(r => !+r.ok);
  out.push(panel('Background jobs', cron.length ? '<ul class="jobs">' + cron.map(r => '<li class="' + (+r.ok ? '' : 'bad') + '" tabindex="0" data-tip="' + esc(r.name + ': last ran ' + stamp(r.at, now) + ', took ' + (+r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + ' s' : (+r.ms || 0) + ' ms') + (r.note ? '. ' + r.note : '')) + '">' + st(+r.ok ? 'ok' : 'bad', r.name) + '<span>' + esc(ago(r.at, now)) + '</span></li>').join('') + '</ul>' : '<p class="nil">No job has run yet.</p>',
    { w: 6, n: cron.length ? (failed.length ? failed.length + ' failing' : 'all ' + cron.length + ' ran clean') : null, sub: 'Each job’s last run and how long ago. Weekly jobs show days.' }));
  // the 4 AM test call, the last 14 mornings
  const dr = (d.drills || []).slice().reverse();
  const dk = s => (s === 'passed' ? 'ok' : s === 'failed' ? 'bad' : 'warn');
  out.push(panel('The 4 AM test call', dr.length ? '<div class="strip">' + dr.map(r => '<span class="sq ' + dk(r.status) + '" tabindex="0" data-tip="' + esc(dayLabel(r.day) + ': ' + r.status + (+r.attempt > 1 ? ' on try ' + r.attempt : '') + (r.detail ? '. ' + r.detail : '')) + '"><i aria-hidden="true">' + ICON[dk(r.status)] + '</i><small>' + esc(dayLabel(r.day).replace(/^[A-Za-z]+ /, '')) + '</small></span>').join('') + '</div>' +
    '<p class="ps">' + dr.filter(r => r.status === 'passed').length + ' of ' + dr.length + ' passed. Latest: ' + esc(dr[dr.length - 1].status) + (dr[dr.length - 1].detail ? ', ' + esc(String(dr[dr.length - 1].detail).slice(0, 160)) : '') + '.</p>' : '<p class="nil">No test call on record yet.</p>',
    { w: 4, sub: 'A real call to Max every night, judged on what he said.' }));
  // safety nets
  const hb = (d.heartbeats || []).find(r => r.task === 'check'), hbH = hb ? (now - Date.parse(hb.at)) / 36e5 : null, bk = d.backup;
  const pq = d.pushq || [], pqDone = pq.filter(r => r.status === 'done'), via = by(pqDone, 'via'), pqN = k => pq.filter(r => r.status === k).reduce((s, r) => s + +r.n, 0);
  out.push(panel('Safety nets', table(['Net', 'State', 'Detail'], [
    ['Weekly backup', bk ? st(now - Date.parse(bk.at) < 9 * DAY ? 'ok' : 'warn', now - Date.parse(bk.at) < 9 * DAY ? 'Fresh' : 'Late') : st('off', 'None yet'), bk ? esc(ago(bk.at, now) + ' ago, ' + num(bk.rows) + ' rows in ' + num(bk.tables) + ' tables, ' + (bk.bytes / 1024).toFixed(0) + ' KB') : ''],
    ['The Always Open check', hb ? st(hbH < 14 ? 'ok' : hbH < 30 ? 'warn' : 'bad', hbH < 14 ? 'Running' : hbH < 30 ? 'Late' : 'Stopped') : st('off', 'No run yet'), hb ? 'last ran ' + esc(ago(hb.at, now)) + ' ago' : ''],
    ['Phone alerts, 7 days', st(pqN('dropped') ? 'warn' : 'ok', pqN('dropped') ? pqN('dropped') + ' dropped' : 'All delivered'), esc(pl(pqN('done'), 'sent', 'sent') + (via.text ? ', ' + via.text + ' by text' : '') + (via.mac ? ', ' + via.mac + ' by the Mac' : '') + (pqN('queued') + pqN('out') ? ', ' + (pqN('queued') + pqN('out')) + ' waiting' : ''))]
  ]), { w: 4 }));
  const er = d.errorsR || [], erN = er.reduce((s, r) => s + +r.n, 0);
  out.push(panel('Crashes, 7 days', er.length ? table(['Page', ['Times', 'r'], 'Last', 'What it said'], er.map(r => [esc(r.route), num(r.n), esc(ago(r.last, now)) + ' ago', esc(String(r.msg || '').slice(0, 120))])) : '<p class="nil ok">' + ICON.ok + ' No page crashed in the last 7 days.</p>',
    { w: 4, n: erN ? erN : null }));
  const al = d.alerts || [];
  out.push(panel('Alarms that went off, 7 days', al.length ? table(['Alarm', 'Last time', ['Times', 'r']], al.map(r => [esc(alarmName(r.type)), esc(stamp(+r.at, now)), num(r.n)])) : '<p class="nil ok">' + ICON.ok + ' Nothing set off an alarm in the last 7 days.</p>', { w: 6 }));
  const ln = d.lines || [];
  out.push(panel('Phone lines', table(['Number', 'Answers for', 'Max', 'Spanish'], ln.map(r => [esc(String(r.number || '').replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')), esc(r.business), +r.on_air ? st('ok', 'Answering') : st('off', 'Off'), +r.spanish ? 'Yes' : 'No']), 'No line is set up yet.'), { w: 6, n: ln.length }));
  const L = d.launch || {}, rn = d.renewals || [];
  const lrow = (k, name) => { const x = L[k] || {}; return [name, x.on ? st('ok', 'On') : st('off', 'Off'), esc(x.detail || x.state || 'not checked yet')]; };
  out.push(panel('Approvals and renewals', table(['Thing', 'State', 'Detail'], [lrow('google', 'Posting on Google for clients'), lrow('meta', 'Posting on Facebook and Instagram')]
    .concat(rn.map(r => [esc(r.name), st(r.days < 8 ? 'bad' : r.days < 31 ? 'warn' : 'ok', r.days < 0 ? 'Overdue' : 'In ' + r.days + ' days'), 'renews ' + esc(r.date)]))), { w: 12 }));
  return out.join('');
}

export function moneyPanels(d) {
  const N = d.numbers, tw = d.twilio, out = [];
  if (tw) out.push(panel('Twilio balance, 30 days', line(tw.series, { fmt: v => usd(Math.round(v)), label: 'Twilio balance by day' }),
    { w: 6, sub: usd(tw.balance) + ' now, spending about ' + usd(tw.perDay) + ' a day' + (tw.daysLeft != null ? ', so about ' + Math.round(tw.daysLeft) + ' days left.' : '.') + ' Twilio carries Max’s calls and every text.' }));
  else out.push(panel('Twilio balance, 30 days', '<p class="nil">The balance has not been read yet.</p>', { w: 6 }));
  if (!N) return out.join('') + panel('Revenue and cost', '<p class="nil">The numbers could not be read just now.</p>', { w: 6 });
  const plans = Object.keys(N.mrr.byPlan || {}).map(k => [esc(k), num(N.mrr.byPlan[k].n), usd(N.mrr.byPlan[k].cents / 100)]);
  out.push(panel('Revenue and cost, a month', table(['Line', ['Amount', 'r'], 'Where it comes from'], [
    ['Revenue', usd(N.mrr.cents / 100), esc(pl(N.mrr.clients, 'paying client', 'paying clients'))],
    ['Twilio', usd(-N.costs.twilio), N.costs.readings < 24 ? 'real, but only ' + N.costs.readings + ' readings so far' : 'real, from its balance, last 30 days'],
    ['Claude on calls', usd(-N.costs.claude), 'estimated from the words used'],
    ['<b>Margin</b>', '<b>' + usd(N.margin) + '</b>', N.mrr.cents ? esc(pct(N.margin, N.mrr.cents / 100)) + ' of revenue' : 'no revenue yet, so this is what it costs to stay open']
  ]) + (plans.length ? table(['Plan', ['Clients', 'r'], ['A month', 'r']], plans) : ''), { w: 6 }));
  const f = N.funnel.now, p = N.funnel.prev, mo = String(N.month).split(' ')[0], pm = String(N.prevMonth).split(' ')[0];
  out.push(panel('The website funnel, by month', table(['Step', [mo + ' so far', 'r'], [pm, 'r']], [
    ['Free audits run', num(f.audits), num(p.audits)], ['Requests', num(f.requests), num(p.requests)], ['Signups', num(f.signups), num(p.signups)], ['Cancellations', num(f.cancels), num(p.cancels)],
    ['Audit to request', pct(f.requests, f.audits), pct(p.requests, p.audits)], ['Request to signup', pct(f.signups, f.requests), pct(p.signups, p.requests)]]), { w: 6 }));
  out.push(panel('Each client, last 30 days', table(['Business', 'Plan', ['Revenue', 'r'], ['Calls', 'r'], ['Minutes', 'r'], ['Texts', 'r'], ['Est. cost', 'r'], ['Margin', 'r']],
    (N.perClient || []).map(r => [esc(r.business), esc(r.plan), usd(r.revenue), num(r.calls), num(r.minutes), num(r.texts), usd(r.cost), usd(r.margin)]), 'No paying clients yet. Each one gets a row here with what they pay and what they cost.'), { w: 6, sub: 'Lowest margin first.' }));
  if ((N.history || []).length >= 2 && N.history.some(h => +h.mrr_cents > 0)) out.push(panel('Monthly revenue over time', line(N.history.map(h => ({ label: dayLabel(h.day), v: h.mrr_cents / 100 })), { fmt: v => usd(Math.round(v)), label: 'Monthly revenue by day' }), { w: 6, sub: 'A snapshot a day.' }));
  if ((N.cohorts || []).length) out.push(panel('Who stays', table(['Signed up', ['Joined', 'r'], ['Still paying', 'r'], ['Kept', 'r']], N.cohorts.map(c => [esc(c.label), num(c.joined), num(c.active), pct(c.active, c.joined)])), { w: 6 }));
  return out.join('');
}

export function salesPanels(d) {
  const out = [], days = d.days || [];
  const LT = {}; for (const r of d.letters || []) LT[r.status] = r;
  const sent = +((LT.sent || {}).n) || 0, opened = +((LT.sent || {}).opened) || 0, lcost = (+((LT.sent || {}).cost) || 0) / 100;
  const ls = d.leadStat || [], n = f => ls.filter(f).reduce((s, r) => s + +r.n, 0);
  const asked = n(r => r.status !== 'letter'), talking = n(r => r.status === 'talking'), won = n(r => r.status === 'won'), lost = n(r => r.status === 'lost');
  out.push(panel('From first touch to client, 90 days', bars([
    { label: 'Letters mailed', v: sent, note: lcost ? usd(lcost) + ' in postage' : '' },
    { label: 'Letters opened', v: opened, note: sent ? pct(opened, sent) + ' of mailed' : '' },
    { label: 'Free audits run', v: +(((d.audits90 || [])[0] || {}).n) || 0, note: 'on the website and for letters' },
    { label: 'Requests', v: asked, note: 'form, phone or letter' },
    { label: 'Talking', v: talking, note: asked ? pct(talking, asked) + ' of requests' : '' },
    { label: 'Won', v: won, note: asked ? pct(won, asked) + ' of requests' : '' },
    { label: 'Lost', v: lost, note: asked ? pct(lost, asked) + ' of requests' : '' }
  ]), { w: 6, sub: 'Test calls and spam are left out.' }));
  const src = ['form', 'phone', 'letter'], sname = { form: 'Website form', phone: 'Called the sales line', letter: 'Mailed letter' };
  out.push(panel('Requests by where they came from, 90 days', table(['Source', ['New', 'r'], ['Talking', 'r'], ['Won', 'r'], ['Lost', 'r'], ['All', 'r']],
    src.map(k => { const g = s => n(r => r.src === k && (s ? (s === 'new' ? (r.status === 'new' || r.status === 'letter') : r.status === s) : true)); return [sname[k], num(g('new')), num(g('talking')), num(g('won')), num(g('lost')), num(g())]; })) +
    (((LT.queued || {}).n || (LT.failed || {}).n || (LT.skipped || {}).n) ? '<p class="ps">Letters: ' + esc([LT.queued ? num(LT.queued.n) + ' waiting to mail' : '', LT.skipped ? num(LT.skipped.n) + ' skipped' : '', LT.failed ? num(LT.failed.n) + ' failed' : ''].filter(Boolean).join(', ')) + '.</p>' : ''),
    { w: 6, sub: 'A letter counts as New until they ask for a call.' }));
  out.push(panel('Free audits a day', columns(days, [{ name: 'audits', key: 'audits' }], { label: 'Free audits run each day, last 30 days', h: 150 }), { w: 6, n: d.tot ? num(d.tot.audits) + ' in 30 days' : null, sub: d.tot ? delta(d.tot.audits, d.prev.audits, 'the 30 days before') : '' }));
  out.push(panel('Requests a day', columns(days, [{ name: 'requests', key: 'leads' }], { label: 'Requests each day, last 30 days', h: 150 }), { w: 6, n: d.tot ? num(d.tot.leads) + ' in 30 days' : null, sub: d.tot ? delta(d.tot.leads, d.prev.leads, 'the 30 days before') : '' }));
  const m = (d.leadMail || [])[0] || {}, got = (+m.sent || 0) + (+m.missed || 0);
  out.push(panel('The audit email and its two follow-ups, 90 days', table(['Step', ['Count', 'r'], ['Share', 'r']], [
    ['Requests with an email', num(m.n), ''], ['Audit email sent', num(m.sent), pct(+m.sent || 0, +m.n || 0)], ['Audit could not be built (they got a note instead)', num(m.missed), pct(+m.missed || 0, +m.n || 0)],
    ['Opened their audit page', num(m.viewed), pct(+m.viewed || 0, +m.sent || 0)], ['Clicked through from the email', num(m.engaged), pct(+m.engaged || 0, got)],
    ['First follow-up sent', num(m.fu1), pct(+m.fu1 || 0, got)], ['Second follow-up sent', num(m.fu2), pct(+m.fu2 || 0, got)],
    ['Asked for a call', num(m.callme), pct(+m.callme || 0, got)], ['Unsubscribed', num(m.unsub), pct(+m.unsub || 0, got)]]), { w: 6, sub: 'Share is of the step it follows from.' }));
  const G = by(d.auditG, 'g');
  out.push(panel('Grades the audits gave, 30 days', bars(['A', 'B', 'C', 'D', 'F'].map(g => ({ label: 'Grade ' + g, v: G[g] || 0 }))), { w: 6, sub: 'A low grade is a business with something for us to fix.' }));
  return out.join('');
}

export function callPanels(d) {
  const out = [], days = d.days || [], tot = d.tot || {}, wk = d.week || {};
  out.push(panel('Calls a day', columns(days, [{ name: 'real calls', key: 'real' }, { name: 'test calls', key: 'test' }], { label: 'Calls Max took each day, last 30 days', h: 180 }),
    { w: 8, n: num(tot.real) + ' real, ' + num(tot.test) + ' test', sub: 'Last 30 days. This week ' + num(wk.real) + ' real' + (wk.prevReal != null ? ' (' + num(wk.prevReal) + ' the week before)' : '') + '. The sample business is left out.' }));
  out.push(panel('When real calls come in', heatGrid(d.heat || WD.map(() => [0, 0, 0, 0, 0, 0])), { w: 4, sub: 'Last 30 days, Eastern. Night is 9 PM to 6 AM.' }));
  const co = d.callOut || [], outs = [...new Set(co.map(r => r.outcome || 'unknown'))];
  const g = (o, t, k) => co.filter(r => (r.outcome || 'unknown') === o && +r.test === t).reduce((s, r) => s + (+r[k] || 0), 0);
  const ON = { done: 'Finished', hangup: 'Caller hung up', transferred: 'Put through to the owner', failed: 'Failed', live: 'Still open', spam: 'Spam', limited: 'Over the minutes cap', interview: 'Setup interview' };
  out.push(panel('How calls ended, 30 days', table(['Ending', ['Real', 'r'], ['Test', 'r'], ['Real minutes', 'r']],
    outs.sort((a, b) => g(b, 0, 'n') + g(b, 1, 'n') - g(a, 0, 'n') - g(a, 1, 'n')).map(o => [esc(ON[o] || o), num(g(o, 0, 'n')), num(g(o, 1, 'n')), num(g(o, 0, 'secs') / 60)]), 'No calls in the last 30 days.'), { w: 4 }));
  const a = d.grades, b = d.gradesPrev, sec = ms => (ms ? (ms / 1000).toFixed(1) + ' s' : '–'), sc = x => (x && x.human >= 0 ? x.human + ' / 10' : '–');
  out.push(panel('How Max sounded', a && a.calls ? table(['Measure', ['Last 30 days', 'r'], ['30 before', 'r']], [
    ['Calls graded', num(a.calls), num(b && b.calls)], ['Sounded like a person (middle score)', sc(a), sc(b)], ['Time to his first word (middle)', sec(a.firstWordMs), sec(b && b.firstWordMs)], ['Slowest answer', sec(a.slowestMs), sec(b && b.slowestMs)],
    ['Booked a time', num(a.booked), num(b && b.booked)], ['Caller hung up early', num(a.hungUp) + ' (' + a.hangupShare + '%)', b ? num(b.hungUp) + ' (' + b.hangupShare + '%)' : '–'], ['Misheard the caller', num(a.misheard), num(b && b.misheard)], ['Asked the same thing twice', num(a.askedTwice), num(b && b.askedTwice)],
    ['Ended with no next step', num(a.noNextStep), num(b && b.noNextStep)], ['Caller asked for a person', num(a.askedPerson), num(b && b.askedPerson)], ['Caller was upset', num(a.upset), num(b && b.upset)], ['Calls with a hard mistake', num(a.hardCalls), num(b && b.hardCalls)]])
    : '<p class="nil">No graded calls in the last 30 days.</p>', { w: 4, sub: 'Every call is graded when it ends, test calls included.' }));
  out.push(panel('Real calls by line, 30 days', table(['Line', ['Calls', 'r'], ['Minutes', 'r'], 'Last call'], (d.callWho || []).map(r => [esc(r.client_id === 'always-open' ? 'Always Open sales line' : r.business) + (r.client_id === DEMO ? ' <span class="mu">(sample)</span>' : ''), num(r.n), num(r.minutes), esc(ago(r.last, d.now)) + ' ago']), 'No real calls in the last 30 days.'), { w: 4 }));
  return out.join('');
}

export function textPanels(d) {
  const out = [], tk = d.textsK || [], kinds = [...new Set(tk.map(r => r.kind || 'other'))];
  const okSt = s => !/^(failed|undelivered|skipped|held)$/.test(s || ''), g = (k, f) => tk.filter(r => (r.kind || 'other') === k && f(r.status || '')).reduce((s, r) => s + +r.n, 0);
  out.push(panel('Texts a day', columns(d.days || [], [{ name: 'texts', key: 'texts' }], { label: 'Texts sent each day, last 30 days', h: 150 }), { w: 6, n: d.tot ? num(d.tot.texts) + ' in 30 days' : null, sub: d.tot ? delta(d.tot.texts, d.prev.texts, 'the 30 days before') : '' }));
  out.push(panel('Texts by kind, 30 days', table(['Kind', ['Went out', 'r'], ['Failed', 'r'], ['Held back', 'r']], kinds.sort((a, b) => g(b, okSt) - g(a, okSt)).map(k => [esc(k), num(g(k, okSt)), num(g(k, s => /^(failed|undelivered)$/.test(s))), num(g(k, s => /^(skipped|held)$/.test(s)))]), 'No texts in the last 30 days.'),
    { w: 6, sub: 'Held back means a rule stopped it: quiet hours, an opt-out, or texting not approved for that business.' }));
  const br = by(d.brands, 'status'), ap = by(d.a2p, 'status'), pv = by(d.provision, 'status'), list = o => Object.keys(o).map(k => o[k] + ' ' + k).join(', ') || 'none';
  out.push(panel('Texting and numbers, where each stands', table(['Thing', 'Count'], [['People who replied STOP', num(((d.optouts || [])[0] || {}).n)], ['Texting brands', esc(list(br))], ['Carrier registrations', esc(list(ap))], ['Numbers being set up', esc(list(pv))]]), { w: 6 }));
  return out.join('');
}

export function workPanels(d) {
  const out = [], it = d.items || [], kinds = [...new Set(it.map(r => r.kind || 'other'))], stt = [...new Set(it.map(r => r.status || ''))];
  out.push(panel('Replies and posts, by where they stand', table(['Kind'].concat(stt.map(s => [s || 'unset', 'r'])), kinds.map(k => [esc(k)].concat(stt.map(s => num(it.filter(r => (r.kind || 'other') === k && (r.status || '') === s).reduce((a, r) => a + +r.n, 0))))), 'No replies or posts drafted yet.'),
    { w: 6, sub: 'Every client together, the sample business left out. Pending waits on the owner’s OK.' }));
  const cb = (d.connBad || [])[0];
  out.push(panel('Connections clients have made', table(['Connection', ['Clients', 'r']], (d.conn || []).map(r => [esc(r.k), num(r.n)]), 'None yet.') + (cb && +cb.n ? '<p class="ps">' + st('bad', cb.n + ' broken and waiting on the owner to reconnect') + '</p>' : ''), { w: 6 }));
  const row = (name, rows, open, note) => { const m = by(rows, 'status'), all = Object.values(m).reduce((s, x) => s + x, 0), w = open.reduce((s, k) => s + (m[k] || 0), 0); return [name, num(w), num(all - w), esc(note)]; };
  const oc = by(d.outreach, 'k');
  out.push(panel('Work in the pipes', table(['Queue', ['Waiting', 'r'], ['Finished', 'r'], 'What it is'], [
    row('Call-backs', d.callbacks, ['pending', 'asap'], 'Max promised a caller the owner would ring back'),
    row('Three-day check-ins', d.checkins, ['pending'], 'Max calling to ask if the work held up, 30 days'),
    row('Calls Max owes', d.outcalls, ['pending'], 'reminders and follow-up calls he places himself'),
    row('Quotes and invoices to chase', d.followups, ['open'], 'follow-ups the owners logged'),
    row('Outreach numbers', d.outlists, ['ready'], 'businesses on clients’ calling lists')
  ]) + (Object.keys(oc).length ? '<p class="ps">Outreach calls placed in 30 days: ' + esc(Object.keys(oc).map(k => oc[k] + ' ' + k).join(', ')) + '.</p>' : ''), { w: 6 }));
  const so = d.social || [];
  out.push(panel('Always Open’s own posts', table(['Day', 'Theme', 'Result'], so.map(r => [esc(dayLabel(r.day)), esc(r.theme || ''), esc(String(r.result || '').slice(0, 80))]), 'Nothing posted yet.'), { w: 6, sub: 'Monday, Wednesday and Friday, once Facebook and Instagram are approved.' }));
  return out.join('');
}

// ---------- the look ----------
// Ink, surfaces, the two series colours and the four states come as a set for light and for dark; the item cards
// further up the page (opshq.js) read the same names, so the whole page is one piece.
export const DASH_CSS = ':root{color-scheme:light dark;--plane:#f9f9f7;--paper:#fcfcfb;--soft:#f3f2ee;--ink:#0b0b0b;--slate:#52514e;--mute:#898781;--line:#e1e0d9;--axis:#c3c2b7;--s1:#2a78d6;--s2:#eb6834;--good:#0ca30c;--warnc:#fab219;--crit:#d03b3b;--ok:#006300;--warn:#8a5a00;--hot:#b3261e;' +
  '--h1:#cde2fb;--h2:#9ec5f4;--h3:#6da7ec;--h4:#2a78d6;--h5:#184f95;--hd:#0b0b0b;--hl:#fff}' +
  '@media(prefers-color-scheme:dark){:root{--plane:#0d0d0d;--paper:#1a1a19;--soft:#232321;--ink:#f0efec;--slate:#c3c2b7;--mute:#898781;--line:#2c2c2a;--axis:#383835;--s1:#3987e5;--s2:#d95926;--ok:#5cc98a;--warn:#f2c46b;--hot:#ff8a80;' +
  '--h1:#0d366b;--h2:#184f95;--h3:#256abf;--h4:#3987e5;--h5:#86b6ef}}' +
  '*{box-sizing:border-box}html{scroll-padding-top:106px}body{margin:0;background:var(--plane);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}' +
  'main{max-width:1480px;margin:0 auto;padding:0 12px 80px}a{color:inherit}p{margin:0}' +
  // the bar that stays: the name, the two things that matter most, and the way around
  '.top{position:sticky;top:0;z-index:5;background:var(--plane);margin:0 -12px;padding:10px 12px 0;border-bottom:1px solid var(--line)}.top .r1{display:flex;align-items:baseline;gap:10px}' +
  'h1{font-size:20px;margin:0;font-weight:800;letter-spacing:-.01em}.top .asof{margin-left:auto;font-size:13px;color:var(--slate);white-space:nowrap}.top .asof a{font-weight:600}' +
  '.jump{display:flex;gap:6px;overflow-x:auto;padding:8px 0;scrollbar-width:none}.jump::-webkit-scrollbar{display:none}.jump a{flex:none;font-size:13.5px;font-weight:600;text-decoration:none;padding:7px 12px;border-radius:99px;border:1px solid var(--line);background:var(--paper);min-height:36px;display:inline-flex;align-items:center;gap:6px}' +
  '.jump a b{font-variant-numeric:tabular-nums;background:var(--ink);color:var(--paper);border-radius:99px;padding:0 7px;font-size:12px;line-height:18px}' +
  'h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin:26px 0 10px;display:flex;align-items:baseline;gap:10px}h2 small{text-transform:none;letter-spacing:0;font-weight:400;font-size:13px}' +
  // tiles
  '.kps{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:14px}.kp{display:grid;gap:1px;align-content:start;text-decoration:none;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-width:0}' +
  '.kp .kl{font-size:12.5px;color:var(--slate);font-weight:600}.kp b{font-size:25px;line-height:1.15;font-weight:700;letter-spacing:-.01em;overflow-wrap:anywhere}.kp small{font-size:12px;color:var(--slate);line-height:1.3}.kp .st{font-size:12.5px}' +
  // panels on a 12-column grid; one column on a phone
  '.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px}.pn{grid-column:span 12;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}' +
  '@media(min-width:900px){.pn.w4{grid-column:span 4}.pn.w6{grid-column:span 6}.pn.w8{grid-column:span 8}}@media(min-width:900px) and (max-width:1199px){.pn.w4{grid-column:span 6}.pn.w8{grid-column:span 12}}' +
  '.pn h3{font-size:15px;margin:0 0 2px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.pn h3 .ct{font-weight:500;font-size:13px;color:var(--slate)}.ps{font-size:13px;color:var(--slate);margin:2px 0 8px}.pn>.ps:last-child{margin:8px 0 0}' +
  '.nil{font-size:14px;color:var(--slate);padding:10px 0 2px}.nil.ok{color:var(--ink)}.mu{color:var(--mute);font-weight:400}' +
  // tables: numbers line up in their columns
  '.tw{overflow-x:auto;margin-top:6px}.tb{width:100%;border-collapse:collapse;font-size:13.5px}.tb th{font-size:12px;color:var(--slate);font-weight:600;text-align:left;padding:5px 14px 5px 0;border-bottom:1px solid var(--axis);white-space:nowrap}' +
  '.tb td{padding:6px 14px 6px 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}.tb td:first-child{min-width:132px}.tb tr:last-child td{border-bottom:0}.tb .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.tb th:last-child,.tb td:last-child{padding-right:0}.tb td small{display:block;color:var(--slate);font-size:12px}' +
  // a state: the icon wears the colour, the word stays ink
  '.st{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.st i{font-style:normal;font-weight:800;font-size:11px;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex:none}' +
  '.st.ok i{background:var(--good)}.st.warn i{background:var(--warnc);color:#0b0b0b}.st.bad i{background:var(--crit)}.st.off i{background:var(--axis);color:var(--ink)}' +
  // charts: the plot stretches, the words around it do not
  '.cv{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:6px;margin-top:8px}.cv.end{padding-right:50px}.cy{position:relative;font-size:11px}.cy span{position:absolute;right:0;transform:translateY(50%);color:var(--mute);line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}' +
  '.cp{position:relative;min-width:0}.cp svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}.cp line,.cp .ln{vector-effect:non-scaling-stroke}.cp .gr{stroke:var(--line);stroke-width:1}.cp .bl{stroke:var(--axis);stroke-width:1}' +
  '.cp .s1{fill:var(--s1)}.cp .s2{fill:var(--s2)}.cp .ln{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.cp .wash{fill:var(--s1);opacity:.1}' +
  '.cp .dot{position:absolute;right:-5px;width:10px;height:10px;margin-bottom:-5px;border-radius:50%;background:var(--s1);box-shadow:0 0 0 2px var(--paper)}.cp .endl{position:absolute;left:100%;margin-left:10px;transform:translateY(50%);font-size:12px;line-height:1;white-space:nowrap}' +
  '.cp .hit{fill:transparent;outline:0}.cp .hit:hover,.cp .hit:focus{fill:var(--ink);fill-opacity:.07}' +
  '.cx{grid-column:2;display:flex;justify-content:space-between;font-size:11px;color:var(--mute);margin-top:5px;font-variant-numeric:tabular-nums;white-space:nowrap}' +
  '.lg{display:flex;gap:14px;font-size:12.5px;color:var(--slate);margin-top:4px}.lg span{display:inline-flex;align-items:center;gap:5px}.key{width:10px;height:10px;border-radius:2px;display:inline-block}.key.s1{background:var(--s1)}.key.s2{background:var(--s2)}' +
  '.hm{border-collapse:separate;border-spacing:2px;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}.hm th{font-weight:600;color:var(--slate);font-size:11.5px;padding:2px 4px;white-space:nowrap}.hm tbody th{text-align:left}' +
  '.hm td{text-align:center;height:30px;min-width:38px;border-radius:4px;color:var(--mute)}.hm .h1{background:var(--h1)}.hm .h2{background:var(--h2)}.hm .h3{background:var(--h3)}.hm .h4{background:var(--h4)}.hm .h5{background:var(--h5)}' +
  '.hm .h1,.hm .h2,.hm .h3{color:var(--hd)}.hm .h4,.hm .h5{color:var(--hl)}@media(prefers-color-scheme:dark){.hm .h1,.hm .h2,.hm .h3,.hm .h4{color:#fff}.hm .h5{color:#0b0b0b}}' +
  '.hb{display:grid;gap:7px;margin-top:8px}.hr{display:grid;grid-template-columns:minmax(96px,9.5em) 1fr auto;gap:2px 10px;align-items:center;font-size:13.5px}.hr .ht{height:12px;background:var(--soft);border-radius:0 4px 4px 0;overflow:hidden}.hr .ht i{display:block;height:100%;background:var(--s1);border-radius:0 4px 4px 0;min-width:0}' +
  '.hr b{font-variant-numeric:tabular-nums;text-align:right;min-width:2.2em}.hr .hn{grid-column:2/4;font-size:12px;color:var(--slate);margin-top:-2px}.hr .hn:empty{display:none}' +
  '.jobs{list-style:none;margin:8px 0 0;padding:0;columns:150px;column-gap:16px;font-size:13px}.jobs li{display:flex;justify-content:space-between;gap:8px;padding:3px 0;break-inside:avoid;border-bottom:1px solid var(--line)}.jobs li span:last-child{color:var(--slate);font-variant-numeric:tabular-nums;white-space:nowrap}.jobs .st{min-width:0;overflow:hidden}.jobs li{min-width:0}' +
  '.strip{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}.sq{width:34px;display:grid;justify-items:center;gap:2px}.sq i{font-style:normal;font-weight:800;font-size:13px;width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff}.sq.ok i{background:var(--good)}.sq.bad i{background:var(--crit)}.sq.warn i{background:var(--warnc);color:#0b0b0b}.sq small{font-size:10.5px;color:var(--slate)}' +
  '#tip{position:fixed;z-index:9;pointer-events:none;background:var(--ink);color:var(--paper);font-size:12.5px;font-weight:600;padding:6px 9px;border-radius:8px;max-width:280px;box-shadow:0 4px 14px rgba(0,0,0,.25)}#tip[hidden]{display:none}' +
  '[data-tip]:focus-visible{outline:2px solid var(--ink);outline-offset:1px}';

// What runs in the page for the charts: one small readout that follows the finger or the pointer. It stands alone (it
// is sent as text) and writes only plain text, never markup.
export function dashClient() {
  var tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; tip.setAttribute('role', 'status'); document.body.appendChild(tip);
  function show(el, x, y) {
    tip.textContent = el.getAttribute('data-tip'); tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight, r = el.getBoundingClientRect();
    if (x == null) { x = r.left + r.width / 2; y = r.top; }
    tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x - w / 2)) + 'px';
    tip.style.top = (y - h - 12 < 6 ? y + 18 : y - h - 12) + 'px';
  }
  function hide() { tip.hidden = true; }
  document.addEventListener('pointermove', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
  document.addEventListener('pointerdown', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
  document.addEventListener('focusin', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide); window.addEventListener('scroll', hide, { passive: true });
  // The numbers go stale, so the page reads itself again every five minutes, unless something is being typed.
  setInterval(function () {
    var busy = false; document.querySelectorAll('textarea,input.note,input[data-f]').forEach(function (x) { if (x.type !== 'checkbox' && x.value) busy = true; });
    if (!busy && document.visibilityState === 'visible') location.reload();
  }, 300000);
}
