// Node has no "cloudflare:email" or "cloudflare:workers"; the rehearsal gives the worker small stand-ins for both.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:email') return { url: 'data:text/javascript,export class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }', shortCircuit: true };
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
  return next(specifier, context);
}
