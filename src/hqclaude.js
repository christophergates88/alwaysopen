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
  if (!env.ANTHROPIC_API_KEY) return { ok: false, status: 0, error: 'Claude is not set up on the Always Open worker.' };
  let r;
  try {
    r = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE } : {}),
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

export class HqClaude extends WorkerEntrypoint {
  async messages(body) { return askClaude(this.env, body); }
}
