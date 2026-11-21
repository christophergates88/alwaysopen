// Gates HQ's own database (Nov 21, 2026 audit). Christopher's private data (texts answered as him, his plans, where he
// is, home sensing, calls made for him, his health) lives in HQDB, apart from Always Open's business data in DB, so
// nothing on the business side reads it. Every Gates HQ entry point (its routes, its jobs, its call rooms) hands its
// code hqEnv(env): a copy of env whose DB is Gates HQ's database. Without an HQDB binding (tests, a fresh setup) it
// is the one database, as before.
// Its Claude calls use Gates HQ's own key, HQ_ANTHROPIC_API_KEY, once one is set as a Worker secret, so Gates HQ's use
// is counted and capped apart from Max's; until then they use Max's key, as before.
const made = new WeakMap();
export function hqEnv(env) {
  if (!env || !env.HQDB || env.HQDB === env.DB || env.__hq) return env;
  let e = made.get(env);
  if (!e) {
    e = Object.assign({}, env, { DB: env.HQDB }, env.HQ_ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.HQ_ANTHROPIC_API_KEY } : {});
    Object.defineProperty(e, '__hq', { value: true });
    made.set(env, e);
  }
  return e;
}
