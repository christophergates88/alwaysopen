// Claude for Gates HQ's private brain (Nov 13, 2026).
//
// The brain is a separate worker in this same Cloudflare account. Its Ask box (questions, "make a call", "text for
// me") needs Claude, and the Claude key lives here. So the brain sends its Messages API request through a service
// binding to this entrypoint, and the key is never copied anywhere. It is an RPC entrypoint: only a worker in this
// account that binds to it can reach it, never the internet. It keeps to two models, caps the length, never streams,
// and passes everything else through unchanged (the brain's own tools, and Claude's web search).
import { WorkerEntrypoint } from 'cloudflare:workers';

export const HQ_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 4000;

export function relayBody(body) {
  const b = Object.assign({}, body || {});
  if (!HQ_MODELS.includes(b.model)) b.model = HQ_MODELS[0];
  b.max_tokens = Math.max(1, Math.min(MAX_TOKENS, Math.round(Number(b.max_tokens) || 1200)));
  delete b.stream;
  return b;
}

// One Messages API call. Returns { ok, status, body } or { ok: false, status, error } (never throws).
export async function askClaude(env, body, fetcher = fetch) {
  // Gates HQ's own key when one is set (hqdb.js), else Max's
  const key = env.HQ_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, status: 0, error: 'Claude is not set up on the Always Open worker.' };
  let r;
  try {
    r = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: Object.assign({ authorization: 'Bearer ' + key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE } : {}),
      body: JSON.stringify(relayBody(body)),
      signal: AbortSignal.timeout(90000),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'Claude could not be reached.' };
  }
  const j = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, status: r.status, body: j };
  return { ok: false, status: r.status, error: String((j && j.error && j.error.message) || 'HTTP ' + r.status).slice(0, 300) };
}

// Always Open's live numbers for Gates HQ 2's Work lane: counts only. Since the database split (Nov 21, 2026) the brain
// has no way into the business database, so it asks here. wk and day0 are ISO times (the week's start, today's start).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export async function aoNumbers(env, wk, day0) {
  if (!ISO.test(String(wk)) || !ISO.test(String(day0))) return null;
  try {
    const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM app_clients WHERE active = 1) AS clients,
      (SELECT COUNT(*) FROM billing WHERE status IN ('active', 'past_due')) AS paying,
      (SELECT COUNT(*) FROM app_items WHERE status = 'pending' AND kind IN ('reply', 'post')) AS waiting,
      (SELECT COUNT(*) FROM app_calls WHERE test = 0 AND at >= ?1) AS calls7,
      (SELECT COUNT(*) FROM app_calls WHERE test = 0 AND at >= ?2) AS calls_today,
      (SELECT COUNT(*) FROM leads WHERE at >= ?1) AS leads7,
      (SELECT COUNT(*) FROM app_messages WHERE dir = 'in' AND at >= ?1) AS msgs7`).bind(wk, day0).first();
    return r ? { clients: +r.clients || 0, paying: +r.paying || 0, waiting_owners: +r.waiting || 0, calls7: +r.calls7 || 0, calls_today: +r.calls_today || 0, leads7: +r.leads7 || 0, msgs7: +r.msgs7 || 0 } : null;
  } catch (e) { return null; }
}

export class HqClaude extends WorkerEntrypoint {
  async messages(body) { return askClaude(this.env, body); }
  async alwaysOpenNumbers(wk, day0) { return aoNumbers(this.env, wk, day0); }
}
