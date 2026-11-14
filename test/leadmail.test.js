// Speed to lead: the free audit goes out by email within a minute of the request, and it is the whole proposal, sent
// once. Then one reminder at most, with nothing new in it, and never one after the person signs up, replies, or taps
// the stop link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const L = await import('../src/leadmail.js');

const AUDIT = {
  found: true, at: '2026-10-29T20:00:00Z', score: 58, grade: 'D',
  business: { name: 'Sinclair Plumbing', type: 'Plumber', rating: 4.3, reviews: 31, address: 'Eatonton, GA' },
  areas: [{ label: 'Reviews', grade: 'D' }, { label: 'Google profile', grade: 'C' }, { label: 'Website', grade: 'A' }],
  findings: [
    { weight: 18, title: 'Fewer reviews than nearby competitors', saw: '31 reviews, while the top nearby competitors average 140.', fix: 'We ask every customer for a review after each job.' },
    { weight: 12, title: 'No hours on Google', saw: 'Google does not list opening hours.', fix: 'We add hours, holiday hours and closures, and keep them current.' },
    { weight: 12, title: 'Rating below 4.5', saw: 'A 4.3 rating.', fix: 'We reply to every review.' },
    { weight: 6, title: 'No tap-to-call button on the website', saw: 'x', fix: 'y' }],
  fine: ['Website works on phones'], rivals: [{ name: 'Riverbend Plumbing', rating: 4.8, reviews: 211 }]
};
const ENV = { BUSINESS_ADDRESS: '103 W Sumter St, Eatonton, GA 31024' };
const LEAD = { name: 'Dana Whitfield', email: 'dana@example.com', business: 'Sinclair Plumbing', town: 'Eatonton, GA', plan: 'Growth (most picked)', type: 'Contractor or trade' };

test('the audit email: the grade, the three fixes, a sample page, how to start, Katie, the stop link and the address', () => {
  const m = L.auditMail(LEAD, AUDIT, 'https://alwaysopenoffice.com/lead/stop?i=7&k=abc', ENV);
  assert.equal(m.subject, 'Your free audit: Sinclair Plumbing gets a D');
  for (const t of [m.text, m.html]) {
    assert.match(t, /Hi Dana,/);
    assert.match(t, /Fewer reviews than nearby competitors/); assert.match(t, /No hours on Google/); assert.match(t, /Rating below 4\.5/);
    assert.doesNotMatch(t, /tap-to-call/, 'three fixes, not four');
    assert.match(t, /alwaysopenoffice\.com\/sample-report/);
    assert.match(t, /alwaysopenoffice\.com\/start\?plan=Growth/);
    assert.match(t, /\(706\) 460-2226/);
    assert.match(t, /Katie answers, usually the same business day/);
    assert.match(t, /lead\/stop\?i=7&(amp;)?k=abc/);
    assert.match(t, /103 W Sumter St, Eatonton, GA 31024/);
    assert.doesNotMatch(t, /Riverbend/, 'competitors only as an average, never by name');
    assert.doesNotMatch(t, /\bAI\b/);
  }
  assert.match(m.text, /4\.3 stars from 31 reviews on Google today/);
  // one proposal: what it costs is in it (the plan they picked marked), and it says that this is everything
  const p = L.auditMail(LEAD, AUDIT, 'https://x/stop', ENV, '', { pageLink: 'https://alwaysopenoffice.com/your-audit/abcdefghjkmnpqrs' });
  for (const t of [p.text, p.html]) {
    assert.match(t, /What it costs/);
    assert.match(t, /Starter: about \$5 a day \(\$149 a month\)/);
    assert.match(t, /Growth \(the one you picked\): about \$10 a day \(\$299 a month\)/);
    assert.match(t, /Pro: about \$16 a day \(\$499 a month\)/);
    assert.match(t, /That’s everything, in one place: what we found, what we’d do, what it costs and how to start\./);
    assert.match(t, /alwaysopenoffice\.com\/your-audit\/abcdefghjkmnpqrs/);
  }
});

test('in Spanish when they wrote in Spanish', () => {
  const m = L.auditMail(Object.assign({}, LEAD, { lang: 'es', plan: 'Not sure yet' }), AUDIT, 'https://x/stop', ENV);
  assert.equal(m.subject, 'Su auditoría gratis: Sinclair Plumbing saca una D');
  assert.match(m.text, /Hola, Dana:/); assert.match(m.text, /Menos reseñas que la competencia cercana/); assert.match(m.text, /Sin horario en Google/);
  assert.match(m.text, /Reseñas D · Perfil de Google C · Sitio web A/);
  assert.match(m.text, /alwaysopenoffice\.com\/start\n|alwaysopenoffice\.com\/start$/m, 'no plan picked: the plain start page');
  assert.doesNotMatch(m.text, /while the top nearby/, 'no English details in the Spanish email');
});

test('Google can’t find it: a short email asking for the name, and Katie by hand', () => {
  const m = L.missMail({ name: 'Al', business: 'Als Fixit', town: 'Gray' }, 'https://x/stop', ENV);
  assert.equal(m.subject, 'Your free audit: one quick question');
  assert.match(m.text, /couldn’t find an exact match/); assert.match(m.text, /Katie will look it up by hand and send it within one business day/);
});

test('sending: once per address a week, a miss pings Christopher, a failure pings him too', async () => {
  const DB = H.makeDB(), env = { DB, LEADS_KEY: 'k', BUSINESS_ADDRESS: ENV.BUSINESS_ADDRESS };
  const sent = [], pings = [];
  const h = { run: async (e, q) => (q === 'Sinclair Plumbing' ? AUDIT : { found: false }), send: async (to, m) => { sent.push({ to, subject: m.subject }); return 'sent'; }, ping: async (t, b) => pings.push(t + ' | ' + b) };
  const add = async (email, business) => (await DB.prepare("INSERT INTO leads (at, name, email, business, town, plan, status) VALUES (?1, 'Dana Whitfield', ?2, ?3, 'Eatonton, GA', 'Growth', 'new')").bind(new Date().toISOString(), email, business).run()).meta.last_row_id;
  let id = await add('dana@example.com', 'Sinclair Plumbing');
  assert.equal(await L.sendAudit(env, Object.assign({}, LEAD), id, h), 'sent');
  assert.deepEqual(sent[0], { to: 'dana@example.com', subject: 'Your free audit: Sinclair Plumbing gets a D' });
  const row = await DB.prepare('SELECT audit, grade, top FROM leads WHERE id = ?1').bind(id).first();
  assert.equal(row.audit, 'sent'); assert.equal(row.grade, 'D');
  assert.deepEqual(JSON.parse(row.top), { title: 'Fewer reviews than nearby competitors', fix: 'We ask every customer for a review after each job.' }, 'our words only');
  id = await add('DANA@example.com', 'Sinclair Plumbing');
  assert.equal(await L.sendAudit(env, Object.assign({}, LEAD, { email: 'DANA@example.com' }), id, h), 'repeat');
  id = await add('al@example.com', 'Als Fixit');
  assert.equal(await L.sendAudit(env, { name: 'Al', email: 'al@example.com', business: 'Als Fixit', town: 'Gray' }, id, h), 'missed');
  assert.equal(sent.length, 2); assert.equal(sent[1].subject, 'Your free audit: one quick question');
  assert.match(pings[0], /^Audit needs a hand: Als Fixit/);
  id = await add('bo@example.com', 'Sinclair Plumbing');
  const failing = Object.assign({}, h, { send: async () => 'failed: nope' });
  assert.equal(await L.sendAudit(env, Object.assign({}, LEAD, { email: 'bo@example.com' }), id, failing), 'retry', 'a failed send is tried again, not handed to Christopher');
  assert.equal(pings.length, 1);
  assert.equal(await L.sendAudit(env, Object.assign({}, LEAD, { email: 'bo@example.com' }), id, failing), 'retry');
  assert.equal(await L.sendAudit(env, Object.assign({}, LEAD, { email: 'bo@example.com' }), id, failing), 'failed: nope');
  assert.match(pings[1], /^Audit email did not send/);
  assert.match(pings[1], /tried 3 times/);
});

test('audit retries: a failed send, or a request whose audit never started, goes out on the next pass', async () => {
  const DB = H.makeDB(), env = { DB, LEADS_KEY: 'k', BUSINESS_ADDRESS: ENV.BUSINESS_ADDRESS };
  await L.ensureLeadMail(env);
  const now = Date.parse('2026-10-29T08:00:00Z');   // 4 AM Eastern: retries run at any hour
  const add = async (email, business, mins, audit, at2) => (await DB.prepare("INSERT INTO leads (at, name, email, business, town, plan, status, audit, audit_at) VALUES (?1, 'Dana', ?2, ?3, 'Eatonton, GA', 'Growth', 'new', ?4, ?5)")
    .bind(new Date(now - mins * 60e3).toISOString(), email, business, audit, at2 ? new Date(now - at2 * 60e3).toISOString() : null).run()).meta.last_row_id;
  const stuck = await add('dana@example.com', 'Sinclair Plumbing', 20, null);     // the worker stopped before the audit ran
  const failed = await add('sam@example.com', 'Sinclair Plumbing', 30, 'retry', 15);
  await add('new@example.com', 'Sinclair Plumbing', 2, null);                  // too fresh: the first try may still be running
  await add('old@example.com', 'Sinclair Plumbing', 2 * 1440, null);           // from before this existed: left alone
  await add('', 'Phone caller', 30, null);                                     // no email: nothing to retry
  const sent = [];
  const h = { run: async () => AUDIT, send: async (to) => { sent.push(to); return 'sent'; }, ping: async () => {} };
  const r = await L.auditRetryCron(env, now, h);
  assert.equal(r.tried, 2);
  assert.deepEqual(sent.sort(), ['dana@example.com', 'sam@example.com']);
  for (const id of [stuck, failed]) assert.equal((await DB.prepare('SELECT audit FROM leads WHERE id = ?1').bind(id).first()).audit, 'sent');
  assert.equal((await L.auditRetryCron(env, now + 10 * 60e3, h)).tried, 1, 'only the fresh one, now old enough');
});

test('one reminder, three days on, with nothing new in it; weekday business hours; never after a signup or the stop link', async () => {
  const DB = H.makeDB(), env = { DB, LEADS_KEY: 'k', BUSINESS_ADDRESS: ENV.BUSINESS_ADDRESS };
  await L.ensureLeadMail(env);
  const t0 = Date.parse('2026-10-26T14:00:00Z');   // Monday 10 AM Eastern
  // engaged: each of these addresses clicked through the audit email (a stranger's address never does; sitefixes.test.js)
  const add = async (email, business) => (await DB.prepare("INSERT INTO leads (at, name, email, business, plan, status, audit, audit_at, grade, top, engaged) VALUES (?1, 'Dana Whitfield', ?2, ?3, 'Growth', 'new', 'sent', ?1, 'D', ?4, ?1)")
    .bind(new Date(t0).toISOString(), email, business, JSON.stringify({ title: 'No hours on Google', fix: 'We add hours, holiday hours and closures, and keep them current.' })).run()).meta.last_row_id;
  const a = await add('dana@example.com', 'Sinclair Plumbing'), b = await add('sam@example.com', 'Oak Electric'), c = await add('lee@example.com', 'Lee Lawn');
  const sent = []; const h = { send: async (to, m) => { sent.push({ to, subject: m.subject, text: m.text }); return 'sent'; } };
  assert.deepEqual(await L.followCron(env, t0 + 2 * 864e5, h), { sent: 0, stopped: 0 }, 'not before day 3');
  assert.deepEqual(await L.followCron(env, Date.parse('2026-10-30T02:00:00Z'), h), { quiet: true }, '10 PM Eastern: quiet');
  assert.deepEqual(await L.followCron({ DB, LEADS_KEY: 'k' }, t0 + 3 * 864e5, h), { held: 'no postal address set' });
  // Lee signs up; Sam taps the stop link
  await DB.prepare("INSERT INTO billing (client_id, session_id, business, email, status, created) VALUES ('lee', 's1', 'Lee Lawn', 'LEE@example.com', 'active', ?1)").bind(new Date().toISOString()).run();
  const stop = new URL(await L.stopLink(env, b));
  // opening the link (a mail scanner does) only shows the button; the tap is a POST
  assert.match(await (await L.handleStop(new Request(stop), env, stop)).text(), /Stop the emails/);
  const page = await L.handleStop(new Request(stop, { method: 'POST' }), env, stop);
  assert.match(await page.text(), /No more emails/);
  const bad = new URL('https://alwaysopenoffice.com/lead/stop?i=' + a + '&k=0000');
  assert.match(await (await L.handleStop(new Request(bad), env, bad)).text(), /didn’t work/);
  let r = await L.followCron(env, t0 + 3 * 864e5, h);   // Thursday 10 AM
  assert.deepEqual(r, { sent: 1, stopped: 1 });
  assert.equal(sent[0].to, 'dana@example.com'); assert.equal(sent[0].subject, 'Your free audit: still here when you’re ready', 'no "Re:" and nothing typed into the form');
  assert.match(sent[0].text, /One reminder, and it’s the only one we’ll send: your audit and our proposal are still here: https:\/\/alwaysopenoffice\.com\/your-audit\/[A-Za-z0-9]{16}/);
  assert.match(sent[0].text, /Nothing has changed\./);
  assert.doesNotMatch(sent[0].text, /quickest win|Last note|Sinclair/, 'no new pitch, and nothing typed into the form');
  assert.match(sent[0].text, /lead\/stop\?i=/); assert.match(sent[0].text, /103 W Sumter St/);
  // its link opens their own proposal page
  const tokenOf = (await DB.prepare('SELECT token FROM leads WHERE id = ?1').bind(a).first()).token;
  assert.match(sent[0].text, new RegExp('/your-audit/' + tokenOf));
  for (const d of [4, 7, 9, 14]) assert.deepEqual(await L.followCron(env, t0 + d * 864e5, h), { sent: 0, stopped: 0 }, 'one reminder, never a second (day ' + d + ')');
  assert.equal(sent.length, 1);
  const rows = (await DB.prepare('SELECT email, stop FROM leads ORDER BY id').all()).results.map(x => [x.email, x.stop || '']);
  assert.deepEqual(rows, [['dana@example.com', ''], ['sam@example.com', 'unsubscribed'], ['lee@example.com', 'signed up']]);
});

test('a proposal made by hand: one page, one link, emailed once if there is an address, and never the automatic reminder', async () => {
  const DB = H.makeDB(), env = { DB, LEADS_KEY: 'k', BUSINESS_ADDRESS: ENV.BUSINESS_ADDRESS };
  await L.ensureLeadMail(env);
  const t0 = Date.parse('2026-10-26T14:00:00Z');
  const sent = []; const h = { run: async () => AUDIT, send: async (to, m) => { sent.push({ to, subject: m.subject, text: m.text }); return 'sent'; }, now: t0 };
  assert.equal((await L.makeProposal(env, { business: '' }, h)).ok, false);
  assert.match((await L.makeProposal(env, { business: 'Nobody Here LLC', town: 'Gray, GA' }, Object.assign({}, h, { run: async () => ({ found: false }) }))).error, /no exact match for “Nobody Here LLC, Gray, GA”/);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM leads').first()).n, 0, 'no match, nothing saved');
  const r = await L.makeProposal(env, { business: 'Sinclair Plumbing', town: 'Eatonton, GA', name: 'Dana', email: 'Dana@Example.com' }, h);
  assert.equal(r.ok, true); assert.equal(r.grade, 'D'); assert.equal(r.emailed, 'Emailed to dana@example.com.');
  assert.match(r.link, /^https:\/\/alwaysopenoffice\.com\/your-audit\/[A-Za-z0-9]{16}$/);
  assert.equal(r.text, 'Here’s the Always Open proposal for Sinclair Plumbing: what we found, what we’d do, what it costs and how to start, all on one page. ' + r.link);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Here’s the proposal for Sinclair Plumbing\./);
  assert.match(sent[0].text, /What it costs/); assert.ok(sent[0].text.includes(r.link));
  assert.match(sent[0].text, /because you asked Always Open for a proposal/);
  // a double tap is the same proposal, and nothing is emailed twice
  const again = await L.makeProposal(env, { business: 'Sinclair Plumbing', town: 'Eatonton, GA', email: 'dana@example.com' }, Object.assign({}, h, { now: t0 + 60e3 }));
  assert.equal(again.link, r.link); assert.equal(sent.length, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM leads').first()).n, 1);
  // the page is the whole proposal, and stays whole after the fresh look-ups are used up
  const url = new URL(r.link);
  let html = await (await L.handleAuditPage(new Request(url), env, url, { run: async () => AUDIT })).text();
  assert.match(html, /<title>Proposal: Sinclair Plumbing<\/title>/); assert.match(html, /What it costs/); assert.match(html, /Call Max at \(706\) 460-2226 any hour/);
  await DB.prepare("UPDATE leads SET views = '9' WHERE id = ?1").bind(r.id).run();
  html = await (await L.handleAuditPage(new Request(url), env, url, { run: async () => { throw new Error('must not look up'); } })).text();
  for (const w of [/Sinclair Plumbing/, /What we’d fix first/, /Fewer reviews than nearby competitors/, /What it costs/, /about \$5 a day/, /Start my first month/, /If it’s not worth it, you don’t pay for it/]) assert.match(html, w);
  // it is his to follow up: clicked or not, the automatic reminder never goes
  await DB.prepare('UPDATE leads SET engaged = ?1 WHERE id = ?2').bind(new Date(t0).toISOString(), r.id).run();
  assert.deepEqual(await L.followCron(env, t0 + 3 * 864e5, h), { sent: 0, stopped: 0 });
  assert.equal(sent.length, 1);
});

test('the website form: the audit email goes out on its own, and the page says so', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const out = [];
  env.SEND_MAIL = { send: async m => { out.push(m); } };
  env.BUSINESS_ADDRESS = ENV.BUSINESS_ADDRESS;
  world.places = { places: [{ id: 'p1', displayName: { text: 'Sinclair Plumbing' }, formattedAddress: 'Eatonton, GA', rating: 4.3, userRatingCount: 31, primaryTypeDisplayName: { text: 'Plumber' }, businessStatus: 'OPERATIONAL', regularOpeningHours: { weekdayDescriptions: ['Mon 8-5'] }, photos: [] }] };
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  const r = await site.call('/lead', { headers: { accept: 'application/json' }, form: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '(478) 555-0101', business: 'Sinclair Plumbing', town: 'Eatonton, GA', type: 'Contractor or trade', plan: 'Growth', t: String(Date.now() - 60000) } });
  assert.equal(r.status, 200);
  assert.match(r.json().message, /Your free audit is on its way to your inbox now, and Katie follows up within one business day/);
  assert.equal(out.length, 1, 'one email to the person who asked');
  assert.equal(out[0].to, 'dana@example.com'); assert.match(out[0].subject, /^Your free audit: Sinclair Plumbing gets a [A-F]$/);
  assert.equal(out[0].from.email, 'hello@alwaysopenoffice.com'); assert.equal(out[0].replyTo, 'hello@alwaysopenoffice.com');
  const row = await DB.prepare("SELECT audit, grade FROM leads WHERE email = 'dana@example.com'").first();
  assert.equal(row.audit, 'sent'); assert.match(row.grade, /^[A-F]$/);
});

test('a message to Always Open’s Facebook Page gets an answer right away, once a day per person', async () => {
  const B = await import('../src/biz.js');
  const DB = H.makeDB(), env = { DB };
  const calls = [];
  const h = { fetch: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ message_id: 'm' + calls.length })); } };
  const pg = { page_id: '123', page_token: 'tok' };
  assert.equal(await B.instantReply(env, pg, 'psid1', 'How much is it?', h), 'sent');
  assert.match(calls[0].url, /\/123\/messages\?access_token=tok$/);
  assert.equal(calls[0].body.messaging_type, 'RESPONSE'); assert.equal(calls[0].body.recipient.id, 'psid1');
  assert.match(calls[0].body.message.text, /free audit in a few minutes: https:\/\/alwaysopenoffice\.com\/#contact/);
  assert.match(calls[0].body.message.text, /\(706\) 460-2226/); assert.doesNotMatch(calls[0].body.message.text, /\bAI\b/);
  assert.equal(await B.instantReply(env, pg, 'psid1', 'Also, Saturdays?', h), 'already', 'once a day per person');
  assert.equal(await B.instantReply(env, pg, 'psid2', 'stop', h), 'skipped');
  assert.equal(calls.length, 1);
});

test('a caller who says yes gets one text with a private link; the page shows the audit and can email a copy', async () => {
  const DB = H.makeDB(), env = { DB, LEADS_KEY: 'k', BUSINESS_ADDRESS: ENV.BUSINESS_ADDRESS };
  await L.ensureLeadMail(env);
  const id = (await DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, status) VALUES (?1, 'Dana', '', '+14785550101', 'Sinclair Plumbing', 'Eatonton', 'new')").bind(new Date().toISOString()).run()).meta.last_row_id;
  const texts = [];
  assert.equal(await L.textAudit(env, id, '+14785550101', { business: '' }, { sendText: async o => { texts.push(o); return { ok: true }; } }), 'not offered', 'no business name, no text');
  assert.equal(await L.textAudit(env, id, '+14785550101', { business: 'Sinclair Plumbing', town: 'Eatonton' }, { sendText: async o => { texts.push(o); return { ok: true }; } }), 'texted');
  assert.equal(texts.length, 1);
  assert.equal(texts[0].clientId, 'always-open'); assert.equal(texts[0].kind, 'reply'); assert.equal(texts[0].to, '+14785550101');
  const m = /https:\/\/alwaysopenoffice\.com\/your-audit\/([A-Za-z0-9]{16}) /.exec(texts[0].body);
  assert.ok(m, texts[0].body); assert.match(texts[0].body, /Reply STOP to opt out\.$/);
  assert.match(texts[0].body, /Everything is on that one page\./); assert.doesNotMatch(texts[0].body, /follow up/);
  const url = new URL('https://alwaysopenoffice.com/your-audit/' + m[1]);
  const sent = [], pings = [];
  const h = { run: async () => AUDIT, send: async (to, mm) => { sent.push({ to, subject: mm.subject }); return 'sent'; }, ping: async t => pings.push(t) };
  let r = await L.handleAuditPage(new Request(url), env, url, h);
  let html = await r.text();
  assert.match(html, /Sinclair Plumbing · how you look to people searching Google/); assert.match(html, /Reply to our text, or email hello@alwaysopenoffice\.com/);
  assert.match(html, /Want a copy by email\?/); assert.match(html, /noindex/);
  r = await L.handleAuditPage(new Request(url, { method: 'POST', body: new URLSearchParams({ email: 'Dana@Example.com' }) }), env, url, h);
  assert.match(await r.text(), /A copy is on its way to dana@example\.com/);
  assert.deepEqual(sent, [{ to: 'dana@example.com', subject: 'Your audit copy: grade D' }], 'built from what the page kept, with no second Google lookup');
  const row = await DB.prepare('SELECT email, audit, sms_ok FROM leads WHERE id = ?1').bind(id).first();
  assert.deepEqual([row.email, row.audit, row.sms_ok], ['dana@example.com', 'sent', 'yes'], 'the copy starts the follow-ups');
  const bad = new URL('https://alwaysopenoffice.com/your-audit/nope');
  assert.match(await (await L.handleAuditPage(new Request(bad), env, bad, h)).text(), /isn’t right/);
  // Google can't find it: the page says so, and Christopher hears about it once
  const id2 = (await DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, status) VALUES (?1, 'Al', '', '+14785550102', 'Als Fixit', 'Gray', 'new')").bind(new Date().toISOString()).run()).meta.last_row_id;
  await L.textAudit(env, id2, '+14785550102', { business: 'Als Fixit', town: 'Gray' }, { sendText: async o => { texts.push(o); return { ok: true }; } });
  const u2 = new URL(/https:\S+/.exec(texts[1].body)[0]);
  const miss = { run: async () => ({ found: false }), ping: async t => pings.push(t) };
  assert.match(await (await L.handleAuditPage(new Request(u2), env, u2, miss)).text(), /couldn’t find an exact match/);
  await L.handleAuditPage(new Request(u2), env, u2, miss);
  assert.deepEqual(pings, ['Audit needs a hand: Als Fixit']);
});

test('Max offers the audit by text on Always Open’s own line only', async () => {
  const V = await import('../src/voice.js');
  const own = V.systemPrompt(V.lineView({ client_id: 'always-open', business: 'Always Open', facts: '{}' }), '+14785550101', 'en-US');
  const other = V.systemPrompt(V.lineView({ client_id: 'c1', business: 'Sinclair Plumbing', facts: '{}' }), '+14785550101', 'en-US');
  assert.match(own, /I can text you a free audit of how your business looks on Google\. Want it\?/);
  assert.match(own, /never send it without a yes/);
  assert.doesNotMatch(other, /free audit/);
});
