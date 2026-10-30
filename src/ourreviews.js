// Review requests for Always Open itself. Every client, a month in, gets one text asking for an honest Google review of
// Always Open, with their own month's numbers in it. Nobody is picked for being happy or skipped for having a hard
// month (Google's rules, and ours): the only conditions are that they are a current client, 30 to 45 days in, with a
// phone or email, and never opted out of texts from us. One ask per owner; a second only after 90 days if the first
// link was never opened. At most 3 a day across everyone, in the 10 AM hour of the owner's own time. From Always
// Open's own number; if that text can't go (texting not approved yet), the same words go by email. The link runs
// through /r/<token> so a tap counts. A reply to it comes to Christopher's phone, at high priority when it reads like
// a complaint, so it gets fixed; it never changes who is asked.
// Nothing happens until ALWAYS_OPEN_REVIEW_LINK (the Google review link for Always Open) is set in wrangler.toml.
import { tzFor, local } from './callbacks.js';
const DAY = 864e5;
export const PER_DAY = 3, ASK_HOUR = 10;
const COMPLAINT_RE = /\b(refund|cancel|unhappy|angry|furious|terrible|worst|scam|fraud|not working|doesn'?t work|didn'?t work|problem|issue|wrong|disappoint|frustrat|waste)\w*/i;
const ready = new WeakSet();
export async function ensureAsks(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS our_review_asks (client_id TEXT PRIMARY KEY, token TEXT UNIQUE, phone10 TEXT DEFAULT '', asked_at TEXT, asks INTEGER DEFAULT 1, tapped_at TEXT DEFAULT '', by TEXT DEFAULT '', replied_at TEXT DEFAULT '')").run();
  ready.add(env.DB);
}
const ph10 = p => { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? d : ''; };
function tok(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); }

// Who qualifies right now, and why each other active client does not (for the ops board and tests).
export async function candidates(env, now) {
  await ensureAsks(env);
  now = now || Date.now();
  const q = async (sql, ...a) => { try { return ((await env.DB.prepare(sql).bind(...a).all()).results) || []; } catch (e) { return []; } };
  const one = async (sql, ...a) => { try { return await env.DB.prepare(sql).bind(...a).first(); } catch (e) { return null; } };
  const rows = await q("SELECT c.client_id, c.business, c.owner_first, c.regulated, b.owner, b.phone, b.email, b.status, b.created FROM app_clients c JOIN billing b ON b.client_id = c.client_id WHERE c.active = 1 AND c.client_id NOT IN ('demo-plumbing', 'always-open')");
  const out = [], skipped = [];
  for (const r of rows) {
    const skip = why => skipped.push({ client_id: r.client_id, why });
    const prev = await one('SELECT asked_at, asks, tapped_at FROM our_review_asks WHERE client_id = ?1', r.client_id);
    const age = (now - Date.parse(r.created || '')) / DAY;
    if (prev) {
      if (prev.tapped_at || +prev.asks >= 2 || now - Date.parse(prev.asked_at) < 90 * DAY) { skip('asked already'); continue; }
    } else if (!(age >= 30 && age <= 45)) { skip('not 30 to 45 days in'); continue; }
    // A canceled subscription is no longer a client. Nothing about how their month went decides anything.
    if (r.status === 'canceled') { skip('billing is canceled'); continue; }
    const phone10 = ph10(r.phone), email = /@/.test(r.email || '') ? r.email : '';
    if (!phone10 && !email) { skip('no phone or email'); continue; }
    if (phone10 && await one("SELECT 1 AS x FROM sms_optout WHERE client_id = 'always-open' AND phone10 = ?1", phone10)) { skip('opted out of our texts'); continue; }
    out.push({ client_id: r.client_id, business: r.business || '', first: r.owner_first || String(r.owner || '').split(/\s+/)[0] || '', phone10, email, since: r.created, second: !!prev });
  }
  return { out, skipped };
}

// Their month in one clause: "Max has taken 41 calls for you and 9 reviews got answered".
export async function monthWords(env, cid, since) {
  const n = async (sql, ...a) => { try { const r = await env.DB.prepare(sql).bind(...a).first(); return +(r && r.n) || 0; } catch (e) { return 0; } };
  const calls = await n("SELECT COUNT(*) AS n FROM app_calls WHERE client_id = ?1 AND at >= ?2 AND test = 0 AND outcome NOT IN ('live', 'spam', 'limited', 'interview')", cid, since);
  const replies = await n("SELECT COUNT(*) AS n FROM app_items WHERE client_id = ?1 AND kind IN ('reply', 'review') AND status = 'approved' AND COALESCE(decided_at, created) >= ?2", cid, since);
  const pl = (x, a, b) => x + ' ' + (x === 1 ? a : b);
  const bits = [];
  if (calls) bits.push('Max has taken ' + pl(calls, 'call', 'calls') + ' for you');
  if (replies) bits.push(pl(replies, 'review', 'reviews') + ' got answered');
  return { calls, replies, text: bits.join(' and ') };
}
// The same words for every client: an honest review, good or bad.
export function askText(c, words, link, second) {
  return 'Hi ' + (c.first || 'there') + ', it’s the Always Open team. ' + (second ? 'A few months in' : 'A month in') + (words ? ': ' + words + '.' : '.') + ' Would you leave an honest Google review of us? It helps other owners decide: ' + link + ' Questions or anything to change, just reply here.';
}

// Every 10 minutes. h: { send(text) -> {ok, why}, mail(to, subject, text) -> result, now }
export async function askCron(env, now, h) {
  now = now || Date.now();
  const link = String(env.ALWAYS_OPEN_REVIEW_LINK || '').trim();
  if (!/^https:\/\//.test(link)) return { skipped: 'no review link set' };
  await ensureAsks(env);
  const today = new Date(now - DAY).toISOString();
  const sent = await env.DB.prepare('SELECT COUNT(*) AS n FROM our_review_asks WHERE asked_at > ?1').bind(today).first();
  let left = PER_DAY - (+(sent && sent.n) || 0);
  if (left <= 0) return { skipped: 'three today already' };
  const { out } = await candidates(env, now);
  let asked = 0;
  for (const c of out) {
    if (left <= 0) break;
    const tz = await tzFor(env, c.client_id);
    if (local(tz, now).hour !== ASK_HOUR) continue;
    const token = tok(16), at = new Date(now).toISOString();
    // Marked before sending, so a slow send can never make a second ask.
    const mark = await env.DB.prepare("INSERT INTO our_review_asks (client_id, token, phone10, asked_at, asks, tapped_at, by) VALUES (?1, ?2, ?3, ?4, 1, '', '') ON CONFLICT(client_id) DO UPDATE SET token = excluded.token, phone10 = excluded.phone10, asked_at = excluded.asked_at, asks = our_review_asks.asks + 1, by = '' WHERE our_review_asks.asked_at < ?5")
      .bind(c.client_id, token, c.phone10, at, new Date(now - 90 * DAY).toISOString()).run();
    if (!(mark.meta && mark.meta.changes)) continue;
    const words = await monthWords(env, c.client_id, c.since);
    const text = askText(c, words.text, 'https://alwaysopenoffice.com/r/' + token, c.second);
    let by = '';
    if (c.phone10 && h && h.send) { const r = await h.send({ to: c.phone10, body: text, tz }); if (r && r.ok) by = 'text'; }
    if (!by && c.email && h && h.mail) { const r = await h.mail(c.email, 'A month with Always Open', text.replace(/ just reply here\.$/, ' just reply to this email.')); if (r === 'sent' || (r && r.ok)) by = 'email'; }
    await env.DB.prepare('UPDATE our_review_asks SET by = ?1 WHERE client_id = ?2').bind(by || 'failed', c.client_id).run();
    if (by) { asked++; left--; }
  }
  return { asked };
}

// /r/<token>: count the tap, then on to Google.
export async function tap(env, token, now) {
  if (!/^[A-Za-z0-9]{16}$/.test(token || '')) return null;
  await ensureAsks(env);
  const r = await env.DB.prepare('SELECT client_id FROM our_review_asks WHERE token = ?1').bind(token).first().catch(() => null);
  if (!r) return null;
  await env.DB.prepare("UPDATE our_review_asks SET tapped_at = ?1 WHERE token = ?2 AND tapped_at = ''").bind(new Date(now || Date.now()).toISOString(), token).run();
  return r.client_id;
}
// A text to Always Open's number from an owner we asked in the last two weeks: to Christopher's phone.
export async function onReply(env, from10, body, ping, now) {
  await ensureAsks(env);
  now = now || Date.now();
  const r = await env.DB.prepare("SELECT a.client_id, c.business, c.owner_first FROM our_review_asks a JOIN app_clients c ON c.client_id = a.client_id WHERE a.phone10 = ?1 AND a.asked_at > ?2").bind(from10, new Date(now - 14 * DAY).toISOString()).first().catch(() => null);
  if (!r) return false;
  await env.DB.prepare('UPDATE our_review_asks SET replied_at = ?1 WHERE client_id = ?2').bind(new Date(now).toISOString(), r.client_id).run();
  const complaint = COMPLAINT_RE.test(body || '');
  await ping((r.owner_first ? r.owner_first + ' at ' : '') + (r.business || r.client_id) + ' replied to the review ask', String(body || '').slice(0, 300), complaint ? 'high' : 'default', complaint ? 'warning' : 'speech_balloon');
  return complaint ? 'complaint' : 'reply';
}
// One line for the ops board.
export async function asksLine(env, now) {
  now = now || Date.now();
  if (!/^https:\/\//.test(String(env.ALWAYS_OPEN_REVIEW_LINK || ''))) return 'off until the Google review link for Always Open is set (send it to Claude)';
  await ensureAsks(env);
  const m = new Date(now); const start = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1)).toISOString();
  const r = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN tapped_at != '' THEN 1 ELSE 0 END) AS t FROM our_review_asks WHERE asked_at >= ?1 AND by IN ('text', 'email')").bind(start).first();
  const n = +(r && r.n) || 0, t = +(r && r.t) || 0;
  return n + (n === 1 ? ' ask' : ' asks') + ' sent this month, ' + t + ' tapped';
}
