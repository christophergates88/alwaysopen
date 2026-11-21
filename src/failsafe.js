// Always Open's part of Christopher's Failsafe (Nov 21, 2026 audit). When his Failsafe trips (five quiet days, or his
// stop button; the "Failsafe watch" task keeps its state in Gates HQ's hq_kv 'failsafe'), paying clients are not left
// on their own: every 10 minutes this looks at that one row and, the first time it reads "tripped",
//   - pauses each paying client's billing at Stripe (pause_collection, "void": no invoice while he's away),
//   - posts a note in every active client's app: Max keeps answering, billing is paused, replies wait for him,
//   - and the automatic "got it" answer to a client's message says he's away instead of promising 6 PM.
// When the Failsafe reads "armed" again (he turned it back on), billing resumes for exactly the clients it paused, and
// each gets a short note. What it did is kept in billing_config 'failsafe_clients', so nothing runs twice.
// It reads only that one Gates HQ row (state and trip time), never anything else of his.
import { hqEnv } from './hqdb.js';
import { stripe as stripeCall } from './billing.js';

const KEY = 'failsafe_clients';
const BY = 'Always Open';
export const AWAY_NOTE = 'A note from Always Open: Chris is away for a few days. Max keeps answering your calls and texts as usual. ' +
  'Your billing is paused while he is out, so this time is not charged. Messages here are saved and he will answer them when he is back.';
export const BACK_NOTE = 'A note from Always Open: Chris is back. Billing picks up again on your next date, and he is answering messages here.';
export const AWAY_ACK = 'Chris is away for a few days. Your message is saved and he will answer it when he is back. Max keeps answering your calls as usual.';

async function stateOf(env) {
  const h = hqEnv(env);
  try {
    const r = await h.DB.prepare("SELECT v FROM hq_kv WHERE k = 'failsafe'").first();
    const v = JSON.parse((r && r.v) || '{}') || {};
    return { state: String(v.state || ''), at: String((v.trip && v.trip.at) || '') };
  } catch (e) { return { state: '', at: '' }; }
}
async function mine(env) {
  try { const r = await env.DB.prepare('SELECT v FROM billing_config WHERE k = ?1').bind(KEY).first(); return JSON.parse((r && r.v) || 'null'); }
  catch (e) { return null; }
}
async function save(env, v) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run();
  if (v) await env.DB.prepare('INSERT OR REPLACE INTO billing_config (k, v) VALUES (?1, ?2)').bind(KEY, JSON.stringify(v)).run();
  else await env.DB.prepare('DELETE FROM billing_config WHERE k = ?1').bind(KEY).run();
}
async function note(env, cid, text, now) {
  await env.DB.prepare("INSERT INTO app_messages (client_id, at, by, text, hq_synced, dir, notified) VALUES (?1, ?2, ?3, ?4, 1, 'out', 0)").bind(cid, new Date(now).toISOString(), BY, text).run();
}
const INTERNAL = new Set(['always-open', 'demo-plumbing']);

// Is he away by his Failsafe? Read by checks.js before it promises a reply time.
export async function away(env) { const m = await mine(env); return !!(m && m.tripped_at && !m.back_at); }

export async function failsafeCron(env, now, h) {
  now = now || Date.now(); h = h || {};
  const call = h.stripe || stripeCall;
  const s = await stateOf(env), m = await mine(env);
  if (s.state === 'tripped' && !(m && m.tripped_at)) {
    const clients = ((await env.DB.prepare('SELECT client_id FROM app_clients WHERE active = 1').all().catch(() => ({}))).results || []).map(r => r.client_id).filter(c => !INTERNAL.has(c));
    const paying = ((await env.DB.prepare("SELECT client_id, sub FROM billing WHERE status IN ('active', 'trialing', 'past_due') AND sub IS NOT NULL AND sub != ''").all().catch(() => ({}))).results) || [];
    const paused = [], failed = [];
    for (const b of paying) {
      if (INTERNAL.has(b.client_id)) continue;
      try {
        await call(env, 'POST', 'subscriptions/' + b.sub, { pause_collection: { behavior: 'void' } }, 'failsafe-pause-' + b.sub + '-' + s.at);
        await env.DB.prepare("UPDATE billing SET status = 'paused', updated = ?1 WHERE client_id = ?2").bind(new Date(now).toISOString(), b.client_id).run();
        paused.push(b.client_id);
      } catch (e) { failed.push(b.client_id); }
    }
    for (const c of clients) await note(env, c, AWAY_NOTE, now).catch(() => {});
    await save(env, { tripped_at: s.at || new Date(now).toISOString(), done_at: new Date(now).toISOString(), paused, failed, told: clients.length });
    return 'tripped: ' + paused.length + ' paused, ' + clients.length + ' told' + (failed.length ? ', ' + failed.length + ' could not be paused' : '');
  }
  if (m && m.tripped_at && !m.back_at && s.state === 'armed') {
    const resumed = [];
    for (const cid of m.paused || []) {
      const b = await env.DB.prepare('SELECT sub FROM billing WHERE client_id = ?1').bind(cid).first().catch(() => null);
      if (!b || !b.sub) continue;
      try {
        await call(env, 'POST', 'subscriptions/' + b.sub, { pause_collection: '' }, 'failsafe-resume-' + b.sub + '-' + m.tripped_at);
        await env.DB.prepare("UPDATE billing SET status = 'active', updated = ?1 WHERE client_id = ?2").bind(new Date(now).toISOString(), cid).run();
        resumed.push(cid);
      } catch (e) { /* tried again next run */ }
    }
    if (resumed.length < (m.paused || []).length) { await save(env, Object.assign({}, m, { resumed })); return 'back: ' + resumed.length + ' of ' + m.paused.length + ' resumed, the rest next run'; }
    const clients = ((await env.DB.prepare('SELECT client_id FROM app_clients WHERE active = 1').all().catch(() => ({}))).results || []).map(r => r.client_id).filter(c => !INTERNAL.has(c));
    for (const c of clients) await note(env, c, BACK_NOTE, now).catch(() => {});
    await save(env, null);
    return 'back: ' + resumed.length + ' resumed';
  }
  return s.state || 'no failsafe';
}
