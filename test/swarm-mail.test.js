// Fix wave, Nov 24, 2026: the mail fixes (headers, alerts, client mail failures, follow-up wording, report timing,
// audit polish, reply push, holidays, send record).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const L = await import('../src/leadmail.js');

const AUDIT = {
  found: true, at: '2026-11-20T20:00:00Z', score: 58, grade: 'D',
  business: { name: 'Sinclair Plumbing', type: 'Plumber', rating: 4.3, reviews: 31, address: 'Eatonton, GA' },
  areas: [{ label: 'Reviews', grade: 'D' }], findings: [{ weight: 18, title: 'No hours on Google', saw: 'x', fix: 'We add hours.' }], fine: [], rivals: []
};
const ADDR = '100 Main St, Springfield, GA 30000';
const LEAD = { name: 'Dana Whitfield', email: 'dana@example.com', business: 'Sinclair Plumbing', town: 'Eatonton, GA', plan: 'Growth' };
const addLead = async (DB, email, business, extra) => (await DB.prepare("INSERT INTO leads (at, name, email, business, town, plan, status) VALUES (?1, 'Dana Whitfield', ?2, ?3, 'Eatonton, GA', 'Growth', 'new')").bind(new Date().toISOString(), email, business).run()).meta.last_row_id;
const mailEnv = (extra, fail) => { const sent = []; const env = Object.assign({ DB: H.makeDB(), LEADS_KEY: 'k', BUSINESS_ADDRESS: ADDR }, extra); env.SEND_MAIL = { send: async m => { sent.push(m); if (fail && fail(m, sent.length)) throw new Error('mail service down'); } }; return { env, sent }; };

// ---- C1: List-Unsubscribe on marketing mail
test('C1: the audit, the miss email and the follow-ups carry a one-click unsubscribe header', async () => {
  const { env, sent } = mailEnv();
  let id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  assert.equal(await L.sendAudit(env, LEAD, id, { run: async () => AUDIT }), 'sent');
  const h1 = sent[0].headers;
  assert.match(h1['List-Unsubscribe'], /^<https:\/\/alwaysopenoffice\.com\/lead\/stop\?i=\d+&k=[0-9a-f]{24}>$/);
  assert.equal(h1['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  id = await addLead(env.DB, 'al@example.com', 'Als Fixit');
  assert.equal(await L.sendAudit(env, { name: 'Al', email: 'al@example.com', business: 'Als Fixit', town: 'Gray' }, id, { run: async () => ({ found: false }) }), 'missed');
  assert.match(sent[1].headers['List-Unsubscribe'], /lead\/stop\?i=\d+/);
});
test('C1: the plain-text fallback send keeps the header', async () => {
  const { env, sent } = mailEnv({}, (m, n) => n === 1);
  const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  assert.equal(await L.sendAudit(env, LEAD, id, { run: async () => AUDIT }), 'sent');
  assert.equal(sent.length, 2); assert.equal(sent[1].html, undefined);
  assert.match(sent[1].headers['List-Unsubscribe'], /^<https:\/\/.*lead\/stop/);
});
test('C1: both follow-ups carry the header', async () => {
  const { env, sent } = mailEnv();
  const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  await L.sendAudit(env, LEAD, id, { run: async () => AUDIT });
  await env.DB.prepare("UPDATE leads SET engaged = '2026-11-20T21:00:00Z', audit_at = '2026-11-16T15:00:00Z' WHERE id = ?1").bind(id).run();
  const t = Date.parse('2026-11-18T15:00:00Z');   // Wednesday 10 AM Eastern
  await L.followCron(env, t, {});
  const fu = sent[sent.length - 1];
  assert.match(fu.subject, /quickest win/);
  assert.match(fu.headers['List-Unsubscribe'], /lead\/stop\?i=/);
});

// ---- C2: audit problems reach Christopher by email and the morning list, not a silent night push
const alertRows = async DB => ((await DB.prepare('SELECT type FROM ops_alerts').all()).results || []).map(r => r.type);
test('C2: a failed audit email raises mail-send on the first failure and audit-failed on the third, through opsAlert', async () => {
  const { env } = mailEnv({}, () => true);
  const pushed = []; env.NTFY_URL = 'https://ntfy.example/x'; const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => { pushed.push(String(o && o.body)); return new Response('ok'); };
  try {
    const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
    const phone = []; const h = { run: async () => AUDIT, ping: async (t, b) => phone.push(t) };
    assert.equal(await L.sendAudit(env, LEAD, id, h), 'retry');
    assert.ok((await alertRows(env.DB)).includes('mail-send|' + id), 'the first failure says the mail service may be down');
    await L.sendAudit(env, LEAD, id, h); await L.sendAudit(env, LEAD, id, h);
    assert.ok((await alertRows(env.DB)).includes('audit-failed|' + id));
    assert.deepEqual(phone, [], 'no direct phone push: it is silent at night and sends no email');
  } finally { globalThis.fetch = f0; }
});
test('C2: a miss and a held audit also go through opsAlert', async () => {
  const { env } = mailEnv();
  const id = await addLead(env.DB, 'al@example.com', 'Als Fixit');
  await L.sendAudit(env, { name: 'Al', email: 'al@example.com', business: 'Als Fixit', town: 'Gray' }, id, { run: async () => ({ found: false }), ping: async () => assert.fail('direct push used') });
  assert.ok((await alertRows(env.DB)).includes('audit-failed|' + id));
  const id2 = await addLead(env.DB, 'bo@example.com', 'Bo');
  await L.sendAudit(env, { name: 'Bo', email: 'bo@example.com', business: 'Bo', net_hash: 'n1' }, id2, { run: async () => ({ found: false }) });
  for (const e of ['c1', 'c2', 'c3']) { const i = await addLead(env.DB, e + '@example.com', 'X'); await L.sendAudit(env, { name: 'X', email: e + '@example.com', business: 'X', net_hash: 'n1' }, i, { run: async () => ({ found: false }) }); }
  const held = await addLead(env.DB, 'zed@example.com', 'Zed');
  assert.equal(await L.sendAudit(env, { name: 'Z', email: 'zed@example.com', business: 'Zed', net_hash: 'n1' }, held, { run: async () => ({ found: false }), ping: async () => assert.fail('direct push used') }), 'limited');
  assert.ok((await alertRows(env.DB)).includes('audit-failed|' + held), 'held: told through opsAlert');
});
test('C2: the operator lead email does not say the audit was sent before it was', async () => {
  const { leadEmail } = await import('../src/index.js');
  const e = leadEmail({ name: 'Dana', business: 'Sinclair', email: 'd@example.com' }, 7, '2026-11-24');
  const row = e.lines.find(l => l.k === 'Audit email');
  assert.equal(row.v, 'sending now');
});

// ---- C3: client mail failures are not swallowed
const CL = await import('../src/clientmail.js');
const R = await import('../src/report.js');
const MAIL = { subject: 's', html: '<p>x</p>', text: 'x' };
test('C3: sendNeon raises a mail-send alert when the send fails, and says nothing when it works', async () => {
  const bad = mailEnv({}, () => true).env;
  assert.match(await CL.sendNeon(bad, 'owner@example.com', MAIL, { who: 'c1' }), /^failed: mail service down/);
  assert.deepEqual(await alertRows(bad.DB), ['mail-send|c1']);
  const good = mailEnv().env;
  assert.equal(await CL.sendNeon(good, 'owner@example.com', MAIL), 'sent');
  assert.deepEqual(await alertRows(good.DB).catch(() => []), []);
});
async function reportWorld(failMail) {
  const { env, sent } = mailEnv({}, failMail);
  await env.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, owner_first, phone, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing', 'Sam', '+14785551234', 1, 'Growth')").run();
  await env.DB.prepare("INSERT INTO billing (client_id, email, created) VALUES ('c1', 'sam@example.com', '2026-09-01T00:00:00Z')").run().catch(async e => { throw e; });
  await env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, created, updated) VALUES ('r1', 'c1', 'review', 'Dana', 'Fast.', 5, '', 'pending', '2026-10-12T15:00:00Z', '2026-10-12T15:00:00Z')").run().catch(() => {});
  return { env, sent };
}
const runRow = env => env.DB.prepare("SELECT result FROM report_runs WHERE client_id = 'c1'").first();
test('C3: a failed report email is not marked done; it is tried again, three times in all', async () => {
  let down = true; const { env, sent } = await reportWorld(() => down);
  const t = Date.parse('2026-11-02T15:00:00Z');
  await R.monthReportCron(env, t);
  assert.equal((await runRow(env)).result, 'email retry 1');
  await R.monthReportCron(env, t + 600e3);
  assert.equal((await runRow(env)).result, 'email retry 2');
  await R.monthReportCron(env, t + 1200e3);
  assert.equal((await runRow(env)).result, 'made, email failed', 'stops after three');
  const n = sent.length; await R.monthReportCron(env, t + 1800e3); assert.equal(sent.length, n, 'no loop');
});
test('C3: a failed report email is sent on the next pass once the mail service is back', async () => {
  let down = true; const { env, sent } = await reportWorld(() => down);
  const t = Date.parse('2026-11-02T15:00:00Z');
  await R.monthReportCron(env, t);
  down = false; await R.monthReportCron(env, t + 600e3);
  assert.equal((await runRow(env)).result, 'made');
  assert.equal(sent.filter(m => /report is ready/.test(m.subject)).length >= 1, true);
});

// ---- C6: the month report goes out on the client's own 2nd, in their own zone
test('C6: not at 7 PM Eastern on the 1st; yes once it is the 2nd where the client lives', async () => {
  const m = R.monthOf(Date.parse('2026-12-02T00:30:00Z'));
  assert.equal(m.key, '2026-11');
  const ET = 'America/New_York', PT = 'America/Los_Angeles';
  assert.equal(R.dueFor(m, ET, Date.parse('2026-12-02T00:30:00Z')), false, '7:30 PM Eastern on Dec 1');
  assert.equal(R.dueFor(m, ET, Date.parse('2026-12-02T05:30:00Z')), true, 'Dec 2, 12:30 AM Eastern');
  assert.equal(R.dueFor(m, PT, Date.parse('2026-12-02T05:30:00Z')), false, 'still Dec 1 in Pacific');
  assert.equal(R.dueFor(m, PT, Date.parse('2026-12-02T09:00:00Z')), true);
  const jan = R.monthOf(Date.parse('2027-01-02T01:00:00Z'));
  assert.equal(jan.key, '2026-12');
  assert.equal(R.dueFor(jan, ET, Date.parse('2027-01-02T01:00:00Z')), false, 'Dec to Jan: Jan 1 in Eastern');
  assert.equal(R.dueFor(jan, ET, Date.parse('2027-01-02T12:00:00Z')), true);
});
test('C6: the cron sends nothing on the evening of the 1st, then sends in the morning of the 2nd', async () => {
  const { env, sent } = await reportWorld();
  await env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, created, updated) VALUES ('r2', 'c1', 'review', 'Al', 'Good.', 5, '', 'pending', '2026-11-12T15:00:00Z', '2026-11-12T15:00:00Z')").run();
  await R.monthReportCron(env, Date.parse('2026-12-02T00:30:00Z'));   // Dec 1, 7:30 PM Eastern
  assert.equal(sent.length, 0); assert.equal(await runRow(env), null);
  await R.monthReportCron(env, Date.parse('2026-12-02T14:00:00Z'));
  assert.equal(sent.length, 1);
});
test('C6: dates in the record print in the client zone', () => {
  const m = Object.assign(R.monthOf(Date.parse('2026-11-02T14:00:00Z')), { tz: 'America/Los_Angeles' });
  const d = R.buildMonth({ business: 'X' }, m, { reviews: [{ id: 'r', title: 'A', stars: 5, context: 'ok', status: 'pending', text: 't', created: '2026-10-01T05:30:00Z' }], posts: [], posted: [], calls: 0 }, null, Date.parse('2026-11-02T14:00:00Z'));
  assert.equal(d.record.revs[0].d, 'Sep 30, 2026', '5:30 AM UTC on Oct 1 is Sep 30 in Los Angeles');
});

// ---- C4: follow-ups to a lead who never got an audit
test('C4: no grade means no "did you look at the audit" and no "the audit is yours to keep"', () => {
  const lead = { name: 'Al Jones', email: 'al@example.com', plan: 'Growth' };
  for (const n of [1, 2]) for (const l of [lead, Object.assign({}, lead, { lang: 'es' })]) {
    const m = L.followMail(l, n, 'https://alwaysopenoffice.com/lead/stop?i=1&k=a', { BUSINESS_ADDRESS: ADDR }, null);
    assert.doesNotMatch(m.text, /chance to look at the audit|yours to keep|quickest win|Pudo ver|es suya|lo más rápido/i);
    assert.match(m.text, /as it shows on Google|como aparece en Google/);
    assert.ok(m.text.split('--')[0].length < 360, 'short');
  }
  const graded = L.followMail(Object.assign({}, lead, { grade: 'D' }), 1, 'https://x/stop', { BUSINESS_ADDRESS: ADDR }, null);
  assert.match(graded.text, /chance to look at the audit/);
});

// ---- C7: audit email polish
test('C7: "an A", "an F"; no fix heading over "nothing major to fix"; natural words with no business name', async () => {
  const none = { ...AUDIT, grade: 'A', score: 95, findings: [], fine: [] };
  const A = L.auditMail(LEAD, none, 'https://alwaysopenoffice.com/lead/stop?i=1&k=a', { BUSINESS_ADDRESS: ADDR });
  assert.equal(A.subject, 'Your free audit: Sinclair Plumbing gets an A');
  assert.equal(L.auditMail(LEAD, { ...none, grade: 'F' }, 'https://x/s', { BUSINESS_ADDRESS: ADDR }).subject, 'Your free audit: Sinclair Plumbing gets an F');
  assert.equal(L.auditMail(LEAD, { ...none, grade: 'B' }, 'https://x/s', { BUSINESS_ADDRESS: ADDR }).subject, 'Your free audit: Sinclair Plumbing gets a B');
  for (const t of [A.text, A.html]) { assert.doesNotMatch(t, /things we’d fix first|first thing we’d fix/); assert.match(t, /nothing major to fix/); }
  const bare = L.auditMail({ ...LEAD, business: '' }, { ...AUDIT, business: {} }, 'https://x/s', { BUSINESS_ADDRESS: ADDR });
  assert.equal(bare.subject, 'Your free audit: your grade is a D');
  assert.doesNotMatch(bare.text, /your business: D/);
  const r = CL.reportEmail({}, '', {});
  assert.equal(r.subject, 'Your last month report is ready');
  assert.doesNotMatch(r.subject, /Last month|your business/);
  assert.equal(CL.reportEmail({ business: 'Sinclair Plumbing' }, 'October 2026', {}).subject, 'Your October report is ready: Sinclair Plumbing');
});

// ---- C8: a prospect's reply to the audit pushes Christopher
test('C8: a reply from a lead pushes at high priority with the first line, no links; a stranger or a "stop" does not', async () => {
  const M = await import('../src/mailin.js');
  const { env } = mailEnv({ MAIL_TO: 'owner@example.com' });
  const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  await L.ensureLeadMail(env);
  const pings = []; const ping = async (e, t, b, pr) => pings.push({ t, b, pr });
  const msg = raw => ({ rawSize: raw.length, raw: new Response(raw).body, forward: async () => {} });
  const mine = 'From: Dana <dana@example.com>\r\nSubject: Re: Your free audit\r\n\r\nSounds good, call me at 3 see https://evil.example/x for details\r\n\r\n> quoted old text';
  const r = await M.inbound(msg(mine), env, {}, { ping });
  assert.equal(r.lead, 1);
  assert.deepEqual(pings.map(p => p.t), ['Dana Whitfield replied to their audit']);
  assert.equal(pings[0].pr, 'high');
  assert.equal(pings[0].b, 'Sounds good, call me at 3 see for details');
  await M.inbound(msg('From: Nobody <nobody@example.com>\r\nSubject: hi\r\n\r\nhello'), env, {}, { ping });
  const id2 = await addLead(env.DB, 'al@example.com', 'Als Fixit');
  await M.inbound(msg('From: Al <al@example.com>\r\nSubject: Re: audit\r\n\r\nstop'), env, {}, { ping });
  assert.equal(pings.length, 1, 'a stranger and a stop do not wake Christopher');
});

// ---- C9: no follow-ups on a holiday
test('C9: follow-ups wait on Thanksgiving and the day after, and go the next business day', async () => {
  const { env, sent } = mailEnv();
  const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  await L.sendAudit(env, LEAD, id, { run: async () => AUDIT });
  const n0 = sent.length;
  await env.DB.prepare("UPDATE leads SET engaged = '2026-11-20T21:00:00Z', audit_at = '2026-11-20T15:00:00Z' WHERE id = ?1").bind(id).run();
  assert.deepEqual(await L.followCron(env, Date.parse('2026-11-26T16:00:00Z'), {}), { quiet: true, holiday: true });   // Thanksgiving, 11 AM Eastern
  assert.deepEqual(await L.followCron(env, Date.parse('2026-11-27T16:00:00Z'), {}), { quiet: true, holiday: true });   // the day after
  assert.equal(sent.length, n0);
  const r = await L.followCron(env, Date.parse('2026-11-30T16:00:00Z'), {});   // Monday
  assert.equal(r.sent, 1); assert.equal(sent.length, n0 + 1);
});

// ---- C10: a record of real sends
test('C10: mailSendState keeps last ok and last error per stream, and ignores the operator’s own address', async () => {
  let down = false; const { env } = mailEnv({ MAIL_TO: 'owner@example.com' }, () => down);
  assert.deepEqual(await CL.mailSendState(env), { leads: { okAt: '', errAt: '', err: '' }, clients: { okAt: '', errAt: '', err: '' } });
  await CL.sendNeon(env, 'sam@example.com', MAIL);
  const id = await addLead(env.DB, 'dana@example.com', 'Sinclair Plumbing');
  await L.sendAudit(env, LEAD, id, { run: async () => AUDIT });
  let s = await CL.mailSendState(env);
  assert.ok(s.clients.okAt && s.leads.okAt); assert.equal(s.clients.err, ''); assert.equal(s.leads.errAt, '');
  down = true;
  await CL.sendNeon(env, 'sam@example.com', MAIL);
  const id2 = await addLead(env.DB, 'bo@example.com', 'Sinclair Plumbing');
  await L.sendAudit(env, { ...LEAD, email: 'bo@example.com' }, id2, { run: async () => AUDIT });
  s = await CL.mailSendState(env);
  assert.match(s.clients.err, /mail service down/); assert.match(s.leads.err, /mail service down/);
  assert.ok(s.clients.okAt && s.leads.okAt, 'the last good one is still there');
  const before = JSON.stringify(s); await CL.sendNeon(env, 'owner@example.com', MAIL);
  assert.equal(JSON.stringify(await CL.mailSendState(env)), before, 'the operator’s own address proves nothing');
});
