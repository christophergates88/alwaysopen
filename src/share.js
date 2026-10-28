// Estimated potential share. A simple, documented choice model (Huff-style) over the businesses in the client's competitor
// watch: each business gets an attractiveness score from its public Google rating and review count, and the client's
// estimated share is its score over the sum. It is a model estimate, shown as a range, never a market-share fact and
// never a promise. Factors are stated as facts ("5 fewer reviews than the nearest rival"), never as advice.
// Google content rule (the owner's): raw competitor numbers are kept under 7 days; only place IDs and the client's own
// computed estimate are kept longer.
const ALPHA = 1.5;            // how strongly differences in score turn into differences in share
const RATING_W = 2.0;         // rating matters a lot: (r/5)^2
const VOLUME_W = 1.0;         // review count on a log scale: more reviews, diminishing returns
export const KEEP_RAW_DAYS = 5;

export function attractiveness(row) {
  const r = Math.max(0, Math.min(5, +row.rating || 0)), n = Math.max(0, +row.reviews || 0);
  if (!r && !n) return 0;
  return Math.pow(r / 5, RATING_W) * Math.pow(Math.log1p(n), VOLUME_W);
}

// rows: [{ name, own, rating, reviews }]. Returns null when there is nothing to compare against.
export function estimate(rows) {
  const list = (rows || []).filter(x => x && (x.rating || x.reviews));
  const me = list.find(x => x.own);
  const others = list.filter(x => !x.own);
  if (!me || !others.length) return null;
  const scores = list.map(x => Math.pow(attractiveness(x), ALPHA));
  const total = scores.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const share = Math.pow(attractiveness(me), ALPHA) / total;
  const pct = Math.round(share * 100);
  const spread = Math.max(2, Math.round(pct * 0.15));
  const lo = Math.max(0, pct - spread), hi = Math.min(100, pct + spread);
  // Facts that hold the estimate back, biggest first. Never advice.
  const factors = [];
  const topRated = others.slice().sort((a, b) => (+b.rating || 0) - (+a.rating || 0))[0];
  const mostReviewed = others.slice().sort((a, b) => (+b.reviews || 0) - (+a.reviews || 0))[0];
  if (topRated && (+topRated.rating || 0) > (+me.rating || 0) + 0.05) factors.push({ gap: (+topRated.rating - +me.rating) * 40, text: 'Your rating is ' + (Math.round((+topRated.rating - +me.rating) * 10) / 10).toFixed(1) + ' below ' + topRated.name + ', the top-rated business nearby.' });
  if (mostReviewed && (+mostReviewed.reviews || 0) > (+me.reviews || 0)) factors.push({ gap: Math.log1p(+mostReviewed.reviews - +me.reviews) * 10, text: 'You have ' + (+mostReviewed.reviews - +me.reviews) + ' fewer reviews than ' + mostReviewed.name + '.' });
  const nearest = others.slice().sort((a, b) => Math.abs(attractiveness(b) - attractiveness(me)) - Math.abs(attractiveness(a) - attractiveness(me)))[0];
  if (nearest && nearest !== mostReviewed && (+nearest.reviews || 0) > (+me.reviews || 0)) factors.push({ gap: Math.log1p(+nearest.reviews - +me.reviews) * 8, text: nearest.name + ' has ' + (+nearest.reviews - +me.reviews) + ' more reviews than you.' });
  factors.sort((a, b) => b.gap - a.gap);
  return { pct, lo, hi, range: lo + '-' + hi + '%', factors: factors.slice(0, 2).map(f => f.text), compared: others.length };
}

export function assumptionsText(regulated) {
  return 'How this is estimated: each business in your competitor watch gets a score from its public Google rating and how many reviews it has (rating counts most; reviews count on a sliding scale, so the hundredth review matters less than the tenth). Your estimated potential share is your score as a part of the total. It is a model estimate for the businesses on this list, not a measured market share, and it says nothing about what will happen. ' +
    (regulated ? 'For your field we compare rating and review count only, like for like.' : 'Prices, hours and distance are not in the estimate yet; when a public price is available for your kind of business it will be stated as a fact, never guessed.');
}

let ready = false;
export async function ensureShare(env) {
  if (ready) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS share_hist (client_id TEXT NOT NULL, week TEXT NOT NULL, pct INTEGER, lo INTEGER, hi INTEGER, compared INTEGER, factors TEXT DEFAULT \'[]\', at TEXT, PRIMARY KEY (client_id, week))').run();
  ready = true;
}

export async function saveShare(env, cid, week, est) {
  if (!est) return;
  await ensureShare(env);
  await env.DB.prepare('INSERT OR REPLACE INTO share_hist (client_id, week, pct, lo, hi, compared, factors, at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(cid, week, est.pct, est.lo, est.hi, est.compared, JSON.stringify(est.factors), new Date().toISOString()).run();
}

// For the app: this week's estimate, what moved since the last check, the factors, and the assumptions.
export async function shareState(env, cid, week, rows, regulated) {
  await ensureShare(env);
  const est = estimate(rows);
  if (est) await saveShare(env, cid, week, est);
  const prev = await env.DB.prepare('SELECT pct, week FROM share_hist WHERE client_id = ?1 AND week < ?2 ORDER BY week DESC LIMIT 1').bind(cid, week).first().catch(() => null);
  if (!est) return null;
  const moved = prev ? est.pct - (+prev.pct || 0) : null;
  return { pct: est.pct, lo: est.lo, hi: est.hi, range: est.range, compared: est.compared, factors: est.factors,
    moved: moved == null ? '' : (moved === 0 ? 'Same as the last check.' : (moved > 0 ? 'Up ' + moved + ' points since the last check.' : 'Down ' + (-moved) + ' points since the last check.')),
    assumptions: assumptionsText(regulated) };
}

// Every run: clear raw competitor numbers older than KEEP_RAW_DAYS (place IDs and the client's own estimate stay).
export async function cleanupRaw(env) {
  const cut = new Date(Date.now() - KEEP_RAW_DAYS * 864e5).toISOString();
  try { const r = await env.DB.prepare('UPDATE rival_snap SET rating = NULL, reviews = NULL WHERE at < ?1 AND (rating IS NOT NULL OR reviews IS NOT NULL)').bind(cut).run(); return (r && r.meta && r.meta.changes) || 0; } catch (e) { return 0; }
}
