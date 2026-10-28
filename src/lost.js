// Why callers walked. When a caller decides not to go ahead, Max asks one plain question, once, and the answer is kept
// as a count: price, timing, distance, not what we do, something else. The owner sees the counts, never a sales pitch.
// Not asked on regulated lines unless the owner turns it on. Table creates itself on first use.
export const REASONS = ['price', 'timing', 'distance', 'notus', 'other'];
export const LABELS = { price: 'said price', timing: 'wanted a different time', distance: 'said too far', notus: 'needed work you do not do', other: 'said something else' };

let ready = false;
export async function ensureLost(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS call_lost (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, call_sid TEXT DEFAULT '', at TEXT, reason TEXT NOT NULL, note TEXT DEFAULT '')").run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS call_lost_client ON call_lost (client_id, at)').run().catch(() => {});
  ready = true;
}

export function normalizeReason(r) {
  const s = String(r || '').toLowerCase();
  if (/price|cost|expens|cheap|money|budget|quote/.test(s)) return 'price';
  if (/time|timing|soon|today|wait|schedul|date|week|busy|later/.test(s)) return 'timing';
  if (/far|drive|distance|area|town|travel|miles|location/.test(s)) return 'distance';
  if (/not ?us|don'?t do|do not do|wrong|not what|service|outside|other business/.test(s)) return 'notus';
  return s ? 'other' : '';
}

// Called from the end-of-call note: booked === 'no' and a reason means they walked and said why.
export async function recordLost(env, cid, sid, reason, note) {
  const r = normalizeReason(reason);
  if (!r || !cid) return false;
  await ensureLost(env);
  await env.DB.prepare('INSERT INTO call_lost (client_id, call_sid, at, reason, note) VALUES (?1,?2,?3,?4,?5)').bind(cid, sid || '', new Date().toISOString(), r, String(note || '').slice(0, 120)).run();
  return true;
}

function counts(rows) {
  const c = { price: 0, timing: 0, distance: 0, notus: 0, other: 0, total: 0 };
  for (const r of rows) { if (c[r.reason] != null) { c[r.reason] += +r.n || 0; c.total += +r.n || 0; } }
  return c;
}

// For the app: this month and last month, and the top three as plain lines.
export async function lostState(env, cid) {
  await ensureLost(env);
  const now = new Date(), m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), m1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const q = async (a, b) => (((await env.DB.prepare('SELECT reason, COUNT(*) AS n FROM call_lost WHERE client_id = ?1 AND at >= ?2 AND at < ?3 GROUP BY reason').bind(cid, a, b).all()).results) || []);
  const month = counts(await q(m0, '9')), last = counts(await q(m1, m0));
  const top = REASONS.map(r => [r, month[r]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => n + ' ' + LABELS[r]);
  return { month, last, top, line: lostLine(month) };
}

export function lostLine(c) {
  if (!c || !c.total) return '';
  const parts = REASONS.map(r => [r, c[r]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).map(([r, n]) => n + ' ' + LABELS[r]);
  return 'Callers who did not book this month: ' + parts.join(', ') + '.';
}

export async function lostSince(env, cid, since) {
  await ensureLost(env);
  const rows = ((await env.DB.prepare('SELECT reason, COUNT(*) AS n FROM call_lost WHERE client_id = ?1 AND at > ?2 GROUP BY reason').bind(cid, since).all()).results) || [];
  return counts(rows);
}
