// Review replies: two more versions of a draft to pick from, and review-request emails after a finished job.
// Every version runs through Compliance Guard before the owner sees it. Nothing is sent until the owner approves it.
import { guard, mailTo, pushClient } from './app.js';
import { ensurePast, ckeyOf, ph10 } from './past.js';
import { logAct } from './biz.js';

const SITE = 'https://alwaysopenoffice.com';
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;
const now = () => new Date().toISOString();
const aj = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
const one = s => String(s || '').replace(/[\r\n\t]+/g, ' ').trim();
function tok(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join(''); }

const READY = new WeakSet();
export async function ensureReviews(env) {
  if (READY.has(env)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_alts (item_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, alts TEXT DEFAULT '[]', created TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS biz_reviewreq (item_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, ckey TEXT DEFAULT '', first TEXT DEFAULT '', email TEXT DEFAULT '', job TEXT DEFAULT '', status TEXT DEFAULT 'pending', result TEXT DEFAULT '', created TEXT, sent_at TEXT DEFAULT '')")
  ]);
  READY.add(env);
}

// Other kinds share app_items; these are the ones that are not a review reply.
export const NOT_REVIEW = "('post', 'invoice', 'reviewreq')";

// ---------- three versions ----------
async function askClaude(env, system, user, max) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace': env.ANTHROPIC_WORKSPACE } : {}),
    body: JSON.stringify({ model: env.INSIGHT_MODEL || 'claude-haiku-5-5', max_tokens: max || 500, system, messages: [{ role: 'user', content: user }] })
  });
  const j = await r.json().catch(() => ({}));
  return (j.content || []).map(x => x.text || '').join('');
}

export function versionsOn(env) { return !!env.ANTHROPIC_API_KEY; }

const SYS = 'You rewrite a business owner\'s reply to a customer review. Return ONLY a JSON array of two strings: the first a shorter version (at most two sentences), the second a warmer version (same length as the draft or a little longer). ' +
  'Keep every fact from the draft; add none. Never promise an outcome, never mention prices, discounts, rates or quotes, never give advice, never offer anything for a review, never say the business is the best or number one, never claim the reviewer is a client or mention any account, policy, claim or appointment detail. ' +
  'Plain, sincere, no exclamation marks in a row, no emojis. Sign off the same way the draft does, if it does.';

export async function apiVersions(req, env, c) {
  let b = {}; try { b = await req.json(); } catch (e) { return aj({ ok: false, error: 'Bad request' }, 400); }
  const id = cl(b.id, 80);
  if (!id) return aj({ ok: false, error: 'Bad request' }, 400);
  await ensureReviews(env);
  const it = await env.DB.prepare('SELECT id, kind, context, stars, text, status FROM app_items WHERE id = ?1 AND client_id = ?2').bind(id, c.client_id).first();
  if (!it) return aj({ ok: false, error: 'That one is gone.' }, 404);
  if (['post', 'invoice', 'reviewreq'].includes(it.kind)) return aj({ ok: false, error: 'Versions are for review replies.' }, 400);
  if (it.status !== 'pending') return aj({ ok: false, error: 'Already handled.' }, 409);
  const cached = await env.DB.prepare('SELECT alts FROM biz_alts WHERE item_id = ?1').bind(id).first();
  if (cached) { let a = []; try { a = JSON.parse(cached.alts); } catch (e) { a = []; } return aj({ ok: true, versions: a, cached: true }); }
  if (!versionsOn(env)) return aj({ ok: false, error: 'Other versions aren’t available right now.' }, 503);
  const user = 'Their review (' + (it.stars || 0) + ' stars): ' + (it.context || '(rating only)') + '\n\nThe draft reply:\n' + it.text + (+c.regulated ? '\n\nThis business is in a regulated field. Keep it general: thank them, say the team is glad or sorry, and invite them to call.' : '');
  let raw = '';
  try { raw = await askClaude(env, SYS, user, 500); } catch (e) { raw = ''; }
  let arr = [];
  try { const m = raw.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; } catch (e) { arr = []; }
  const labels = ['Shorter', 'Warmer'];
  const versions = [];
  arr.slice(0, 2).forEach((t, i) => {
    const text = cl(t, 1200);
    if (!text || text === String(it.text).trim()) return;
    const hits = guard(text, c, it.kind);
    if (hits.length || /\b(guarantee[sd]?|promise[sd]?|discount|% ?off|free\b|best in|#1|number one|cheapest)/i.test(text)) return;             // a version that fails the Guard is never offered
    versions.push({ label: labels[i] || 'Another way', text });
  });
  await env.DB.prepare('INSERT OR REPLACE INTO biz_alts (item_id, client_id, alts, created) VALUES (?1, ?2, ?3, ?4)').bind(id, c.client_id, JSON.stringify(versions), now()).run();
  if (!versions.length) return aj({ ok: false, error: 'No other version passed the checks. Edit the draft instead.' }, 422);
  return aj({ ok: true, versions });
}

// ---------- review-request emails ----------
export function reviewRequestText(first, biz, job, link) {
  return 'Hi ' + first + ',\n\nThanks for letting ' + biz + ' take care of ' + (job ? job.replace(/[.?!]+$/, '') : 'your job') + '. ' +
    'If you have a minute, a quick Google review helps other people find us, and it helps us know what to keep doing:\n' + link +
    '\n\nWe send this to every customer, not only the happy ones. If something was not right, reply to this email and we will make it right.\n\nThank you,\n' + biz;
}

// Called from the finished-job form when the owner typed an email. Creates the draft the owner approves.
export async function queueReviewRequest(env, c, first, email, job, by) {
  await ensureReviews(env); await ensurePast(env);
  const link = /^https:\/\//.test(c.review_link || '') ? c.review_link : '';
  if (!link) return { ok: false, error: 'Add your Google review link first (Settings, Your Google review link), then we can email a request.' };
  const ckey = ckeyOf('', email);
  const ts = now();
  await env.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone, phone10, email, agreed, agreed_at, opt_token, source, created, updated) VALUES (?1,?2,?3,'','',?4,1,?5,?6,'job',?5,?5) ON CONFLICT(client_id, ckey) DO UPDATE SET name = CASE WHEN name = '' THEN excluded.name ELSE name END, agreed = CASE WHEN optout = 1 THEN 0 ELSE 1 END, agreed_at = CASE WHEN optout = 1 THEN agreed_at ELSE excluded.agreed_at END, updated = excluded.updated")
    .bind(c.client_id, ckey, first, email, ts, tok(16)).run();
  const cu = await env.DB.prepare('SELECT optout FROM biz_customers WHERE client_id = ?1 AND ckey = ?2').bind(c.client_id, ckey).first();
  if (cu && +cu.optout) return { ok: false, error: 'They asked us to stop, so no request goes out.' };
  const dup = await env.DB.prepare("SELECT item_id FROM biz_reviewreq WHERE client_id = ?1 AND ckey = ?2 AND created > ?3").bind(c.client_id, ckey, new Date(Date.now() - 60 * 86400000).toISOString()).first();
  if (dup) return { ok: true, duplicate: true, message: 'Already on the list. Each customer gets one request.' };
  const id = 'rq' + tok(14);
  const text = reviewRequestText(first, c.business || 'us', job, link);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified) VALUES (?1, ?2, 'reviewreq', ?3, ?4, 0, ?5, 'pending', 1, 0, ?6, ?6, 0)")
      .bind(id, c.client_id, 'Review request for ' + first, 'Email to ' + email, text, ts),
    env.DB.prepare('INSERT INTO biz_reviewreq (item_id, client_id, ckey, first, email, job, status, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').bind(id, c.client_id, ckey, first, email, job, 'pending', ts)
  ]);
  try { await logAct(env, Object.assign({}, c, { staff: by && by !== 'Owner' ? by : c.staff }), 'Added a review request for ' + first); } catch (e) { /* log is best effort */ }
  return { ok: true, id, draft: true };
}

// Runs after the owner approves the draft: one email, with a working opt-out link.
export async function sendReviewRequest(env, c, it, text) {
  await ensureReviews(env);
  const rq = await env.DB.prepare('SELECT * FROM biz_reviewreq WHERE item_id = ?1 AND client_id = ?2').bind(it.id, c.client_id).first();
  if (!rq || rq.status !== 'pending') return 'skipped';
  const cu = await env.DB.prepare('SELECT agreed, optout, opt_token FROM biz_customers WHERE client_id = ?1 AND ckey = ?2').bind(c.client_id, rq.ckey).first();
  if (!cu || +cu.optout || !+cu.agreed) {
    await env.DB.prepare("UPDATE biz_reviewreq SET status = 'skipped', result = 'not allowed to contact' WHERE item_id = ?1").bind(it.id).run();
    return 'skipped';
  }
  const claim = await env.DB.prepare("UPDATE biz_reviewreq SET status = 'sending' WHERE item_id = ?1 AND status = 'pending'").bind(it.id).run();
  if (!claim.meta.changes) return 'skipped';
  const footer = '\n\nIf you’d rather not get notes like this from ' + (c.business || 'us') + ', tell us here and we’ll stop: ' + SITE + '/u/' + cu.opt_token;
  let r = 'failed';
  try { r = await mailTo(env, rq.email, 'A quick note from ' + (c.business || 'your service team'), one(text) ? text + footer : it.text + footer, c.business); } catch (e) { r = 'failed'; }
  await env.DB.prepare('UPDATE biz_reviewreq SET status = ?1, result = ?2, sent_at = ?3 WHERE item_id = ?4').bind(r === 'sent' ? 'sent' : 'failed', 'email:' + r, now(), it.id).run();
  if (r !== 'sent') { try { await pushClient(env, c.client_id, { aps: { alert: { title: 'A review request did not send', body: 'The email to ' + rq.first + ' could not be delivered. Add them again from the app.' }, sound: 'default' } }); } catch (e) { /* best effort */ } }
  return r;
}

export function reviewReqValid(email) { return EMAIL_RE.test(String(email || '').trim()); }
export { ph10 };
