// A copy of the data somewhere else. Every Sunday in the small hours, the tables that matter are written out as
// gzip JSON lines: to the BACKUPS bucket (R2) when one is bound, otherwise as an attachment on an email to Christopher.
// Tokens, keys and device tokens are never exported. D1's own 30-day point-in-time restore is the first line of
// recovery; this is the copy that survives the account. The drill that proves a restore works is in docs/restore.md.
import { EmailMessage } from 'cloudflare:email';
export const TABLES = ['app_clients', 'app_staff', 'app_locations', 'voice_lines', 'app_calls', 'call_grades', 'leads', 'app_leads', 'app_items', 'app_followups', 'app_messages', 'app_months',
  'biz_jobs', 'biz_customers', 'biz_quotes', 'biz_pay', 'biz_prefs', 'app_invoices', 'line_bookings', 'billing', 'callbacks', 'checkins', 'checkin_prefs', 'fillweek', 'fillweek_offers',
  'sms_optout', 'call_optout', 'referrals', 'referral_bank', 'map_listing', 'handoffs', 'handoff_prefs', 'gbp_locations', 'gbp_seen', 'gbp_posted', 'minute_overage', 'line_interviews', 'line_audio_meta'];
const ready = new WeakSet();
async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS backup_runs (week TEXT PRIMARY KEY, at TEXT, bytes INTEGER, where_ TEXT, tables INTEGER, rows INTEGER)').run();
  ready.add(env.DB);
}
export function isoWeek(now) {
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return d.getUTCFullYear() + '-W' + String(1 + Math.round(((d - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0');
}
// Every table as JSON lines: one {table, row} per line, so a restore can stream it. Tables that don't exist are skipped.
export async function dump(env) {
  const parts = []; let tables = 0, rows = 0;
  for (const t of TABLES) {
    let res;
    try { res = await env.DB.prepare('SELECT * FROM ' + t).all(); } catch (e) { continue; }
    tables++;
    for (const r of (res.results || [])) { rows++; parts.push(JSON.stringify({ table: t, row: r })); }
  }
  return { text: parts.join('\n') + '\n', tables, rows };
}
export async function gzip(text) {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export async function runBackup(env, now, h) {
  now = now || Date.now();
  await ensure(env);
  const d = await dump(env);
  const gz = await gzip(d.text);
  const name = 'alwaysopen-' + new Date(now).toISOString().slice(0, 10) + '.jsonl.gz';
  let where = '';
  if (env.BACKUPS) {
    await env.BACKUPS.put('backups/' + name, gz, { httpMetadata: { contentType: 'application/gzip' } });
    where = 'r2:backups/' + name;
  } else if (env.EMAIL && env.MAIL_FROM && env.MAIL_TO) {
    const boundary = 'ao' + crypto.randomUUID().replace(/-/g, '');
    const raw = ['From: "Always Open backups" <' + env.MAIL_FROM + '>', 'To: <' + env.MAIL_TO + '>', 'Subject: Always Open weekly backup ' + new Date(now).toISOString().slice(0, 10),
      'Message-ID: <' + crypto.randomUUID() + '@' + (env.MAIL_FROM.split('@')[1] || 'localhost') + '>', 'Date: ' + new Date(now).toUTCString(), 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"', '', '--' + boundary, 'Content-Type: text/plain; charset=utf-8', '',
      'The weekly copy of the Always Open data: ' + d.tables + ' tables, ' + d.rows + ' rows, ' + Math.round(gz.length / 1024) + ' KB. Keep this email. How to restore from it is in docs/restore.md in the repo. Turn on R2 in Cloudflare and these go to a bucket instead.', '',
      '--' + boundary, 'Content-Type: application/gzip; name="' + name + '"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="' + name + '"', '',
      b64(gz).replace(/(.{76})/g, '$1\r\n'), '--' + boundary + '--', ''].join('\r\n');
    await (h && h.send ? h.send(raw) : env.EMAIL.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw)));
    where = 'email:' + env.MAIL_TO;
  } else {
    where = 'nowhere: no R2 bucket bound and no email';
  }
  await env.DB.prepare('INSERT OR REPLACE INTO backup_runs (week, at, bytes, where_, tables, rows) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(isoWeek(now), new Date(now).toISOString(), gz.length, where, d.tables, d.rows).run();
  return { week: isoWeek(now), bytes: gz.length, where, tables: d.tables, rows: d.rows };
}
// Sundays between 3 and 5 AM Eastern (7 to 9 UTC in summer, 8 to 10 in winter): once a week.
export async function backupCron(env, now, h) {
  now = now || Date.now();
  const d = new Date(now);
  if (d.getUTCDay() !== 0 || d.getUTCHours() < 7 || d.getUTCHours() > 10) return { skipped: 'not the hour' };
  await ensure(env);
  const done = await env.DB.prepare('SELECT at FROM backup_runs WHERE week = ?1').bind(isoWeek(now)).first();
  if (done) return { skipped: 'done this week' };
  return runBackup(env, now, h);
}
export async function lastBackup(env) {
  await ensure(env);
  return env.DB.prepare('SELECT week, at, bytes, where_, tables, rows FROM backup_runs ORDER BY at DESC LIMIT 1').first();
}
