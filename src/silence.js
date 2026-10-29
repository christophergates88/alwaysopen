// Silence detectors, run on the Monday cron. Nothing fails when a number is pointed at the wrong webhook, a forwarding
// rule is turned off, or a Google connection dies: the calls and reviews just stop. These two checks notice.
//   - a live line with zero calls in the last 7 days that averaged 3 or more a week over the 4 weeks before
//   - a connected business profile with no review seen in 14 days that had reviews in the 60 days before
// Each sends one alert naming the business and the likely causes. A line that was always quiet sends nothing.
const DAY = 864e5, WEEK = 7 * DAY;
export const QUIET_LINE_MIN_PER_WEEK = 3;

export async function quietLines(env, now) {
  const lines = ((await env.DB.prepare("SELECT l.number, l.client_id, l.business FROM voice_lines l JOIN app_clients c ON c.client_id = l.client_id WHERE l.on_air = 1 AND c.active = 1 AND l.client_id NOT IN ('demo-plumbing', 'always-open')").all()).results) || [];
  const out = [];
  for (const l of lines) {
    const r = await env.DB.prepare("SELECT SUM(CASE WHEN at >= ?2 THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN at < ?2 AND at >= ?3 THEN 1 ELSE 0 END) AS before FROM app_calls WHERE number = ?1 AND test = 0 AND outcome NOT IN ('limited', 'spam') AND at >= ?3").bind(l.number, new Date(now - WEEK).toISOString(), new Date(now - 5 * WEEK).toISOString()).first();
    const week = +(r && r.week) || 0, before = +(r && r.before) || 0;
    if (week === 0 && before / 4 >= QUIET_LINE_MIN_PER_WEEK) out.push({ client_id: l.client_id, business: l.business || l.client_id, number: l.number, perWeek: Math.round(before / 4) });
  }
  return out;
}
export async function quietProfiles(env, now) {
  const rows = ((await env.DB.prepare("SELECT t.client_id, c.business FROM gbp_tokens t JOIN app_clients c ON c.client_id = t.client_id WHERE c.active = 1 AND t.client_id NOT IN ('demo-plumbing', 'always-open')").all()).results) || [];
  const out = [];
  for (const p of rows) {
    const r = await env.DB.prepare('SELECT SUM(CASE WHEN at >= ?2 THEN 1 ELSE 0 END) AS recent, SUM(CASE WHEN at < ?2 AND at >= ?3 THEN 1 ELSE 0 END) AS before FROM gbp_seen WHERE client_id = ?1 AND at >= ?3').bind(p.client_id, new Date(now - 14 * DAY).toISOString(), new Date(now - 74 * DAY).toISOString()).first();
    if ((+(r && r.recent) || 0) === 0 && (+(r && r.before) || 0) > 0) out.push({ client_id: p.client_id, business: p.business || p.client_id, before: +r.before });
  }
  return out;
}
export async function silenceWeekly(env, now, alert) {
  now = now || Date.now();
  const lines = await quietLines(env, now), profiles = await quietProfiles(env, now);
  for (const l of lines) await alert('quiet-line:' + l.client_id, l.client_id, l.business + ' had no calls this week on a line that averaged ' + l.perWeek + ' a week. Likely causes: the number was repointed in Twilio, the owner turned off call forwarding, or the business closed for the week. Check the number in Twilio and ask the owner.');
  for (const p of profiles) await alert('quiet-profile:' + p.client_id, p.client_id, p.business + ' has had no new Google reviews seen in two weeks after ' + p.before + ' in the two months before. Likely causes: the Google connection dropped, or the profile lost its manager. Check the reconnect card and the profile.');
  return { lines: lines.length, profiles: profiles.length };
}
