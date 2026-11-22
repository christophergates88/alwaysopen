// Gates HQ's own server is the Mac's door now (Nov 22, 2026).
//
// Gates HQ 2 (gates-hq-brain, Gates HQ's own private worker) takes the Mac's Gates HQ traffic with Gates HQ's own Mac
// key, so the Mac's Gates HQ modules no longer need this worker's ops key. The routes that still need this worker
// (Claude's key for answering his texts and reading plans, his calls line) are handed on through this entrypoint: a
// service binding, which only a worker in this Cloudflare account can reach, never the internet. Only those routes
// pass, and they run exactly as when the Mac calls them here: through the same router, with this worker's ops key
// added here (it never leaves this worker). The old way (the Mac straight to /ops/hq-*) keeps working too.
import { WorkerEntrypoint } from 'cloudflare:workers';

export const MAC_ROUTES = /^\/ops\/hq-(plans|text|text-queue|call-tick)$/;
const MAX_BODY = 400000;
const no = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// req: the Mac's request as Gates HQ 2 hands it on (the path is one of MAC_ROUTES); worker: this worker's own router.
export async function handOn(env, ctx, req, worker) {
  const u = new URL(req.url);
  if (!MAC_ROUTES.test(u.pathname)) return no(404, 'not a Gates HQ route');
  if (!env.LEADS_KEY) return no(503, 'not set up');
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  if (body && body.byteLength > MAX_BODY) return no(413, 'too big');
  const h = new Headers({ 'x-key': env.LEADS_KEY, 'user-agent': 'gates-hq-brain' });
  for (const k of ['content-type', 'accept']) { const v = req.headers.get(k); if (v) h.set(k, v); }
  return worker.fetch(new Request('https://alwaysopenoffice.com' + u.pathname + u.search, { method: req.method, headers: h, body }), env, ctx);
}

export class HqMac extends WorkerEntrypoint {
  async fetch(req) { return handOn(this.env, this.ctx, req, (await import('./index.js')).default); }
}
