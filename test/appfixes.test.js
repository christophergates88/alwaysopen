// Fixes from the Oct 30, 2026 review of the owner app and customer texting: keywords only as whole texts and every text
// reaching the owner, one text per follow-up however runs overlap, follow-ups not starved by later ones, invoice texts
// held at night sent in the morning, failed automatic texts back with the owner, phones tied to the link they used,
// staff names forced for any body, per-item approval reminders, refreshes that wait while the owner types, the
// text-back card, the runbook's pause command, and no texts to a number typed into the public booking page until it
// texts in first (with a day's ceiling per business).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const SMS = await import('../src/sms.js');
const AUTO = await import('../src/autotext.js');
const APP = await import('../src/app.js');
const EXTRAS = await import('../src/extras.js');
const CHECKS = await import('../src/checks.js');
const { appHtml } = await import('../src/apppage.js');
const { default: worker } = await import('../src/index.js');

const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = 'O'.repeat(30), STAFF = 'S'.repeat(30), LINE = '+14785550100';
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const sid = n => 'SM' + String(n).padStart(32, '0');

async function setup(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, o.apns ? { APNS_KEY: PEM, APNS_KEY_ID: 'KEY1234567' } : {});
  H.installFetch(world, env);
  const q = (sql, ...a) => DB.prepare(sql).bind(...a).run();
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('c1', ?1, 'sinclair', 'Sinclair Plumbing', 'Pro', 'Dana', 1)", sha(OWNER));
  await q("INSERT INTO voice_lines (number, client_id, business, on_air, updated) VALUES (?1, 'c1', 'Sinclair Plumbing', 1, '2026-10-01')", LINE);
  if (o.brand !== false) await SMS.setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  const site = H.makeClient(worker, env);
  const pushes = () => world.calls.filter(c => /push\.apple\.com/.test(c.url)).map(c => JSON.parse(c.body));
  return { world, DB, env, q, all, site, pushes };
}
const inbound = (env, from, body, n) => SMS.handleSms(null, env, new URLSearchParams({ From: from, To: LINE, Body: body, MessageSid: sid(n) }), true);

// ---------- 1. keywords ----------
test('1. STOP, START and HELP count only as the whole text, and every text reaches the owner (keywords marked)', async () => {
  const { env, q, all, site, pushes } = await setup({ apns: true });
  await site.call('/app/' + OWNER + '/api/device', { json: { token: 'a'.repeat(64) } });
  const sentences = ['Cancel my appointment Tuesday, something came up', 'Help! water is pouring out under the sink', 'Stop by after 3 if you can', 'End of the day works for me', 'Info on your water heater prices?', 'Quit calling? no, call me back please'];
  let n = 0;
  for (const body of sentences) {
    n++;
    const from = '+1478365' + String(1000 + n);
    const res = await inbound(env, from, body, n);
    assert.doesNotMatch(await res.text(), /<Message>/, body + ': no automatic answer');
    assert.equal((await all('SELECT 1 FROM sms_optout WHERE phone10 = ?1', from.slice(2))).length, 0, body + ': not an opt-out');
    assert.deepEqual((await all('SELECT text, by FROM biz_msgs WHERE ext_id = ?1', sid(n))).map(r => [r.text, r.by]), [[body, '']], body + ': in the inbox');
  }
  // The whole text is a keyword: honored, and still saved for the owner, marked.
  const stop = await inbound(env, '+14783652001', ' Stop. ', 20);
  assert.doesNotMatch(await stop.text(), /<Message>/);
  assert.equal((await all("SELECT 1 FROM sms_optout WHERE client_id = 'c1' AND phone10 = '4783652001'")).length, 1);
  assert.deepEqual((await all('SELECT text, by FROM biz_msgs WHERE ext_id = ?1', sid(20)))[0], { text: 'Stop.', by: 'Opted out of texts' });
  const help = await inbound(env, '+14783652002', 'HELP', 21);
  assert.match(await help.text(), /<Message>This is the text line for Sinclair Plumbing/);
  assert.equal((await all('SELECT by FROM biz_msgs WHERE ext_id = ?1', sid(21)))[0].by, 'Answered automatically');
  // Someone who opted out: a sentence starting with Yes is a message (they stay opted out); a bare YES puts them back.
  await q("INSERT INTO sms_optout (client_id, phone10, at) VALUES ('c1', '4783659999', 'x')");
  const yesSentence = await inbound(env, '+14783659999', 'Yes can you come Thursday at 2?', 30);
  assert.doesNotMatch(await yesSentence.text(), /<Message>/);
  assert.equal((await all("SELECT 1 FROM sms_optout WHERE phone10 = '4783659999'")).length, 1, 'still opted out');
  assert.equal((await all('SELECT 1 FROM biz_msgs WHERE ext_id = ?1', sid(30))).length, 1, 'the message is in the inbox');
  const yes = await inbound(env, '+14783659999', 'yes', 31);
  assert.match(await yes.text(), /You are back on the list for Sinclair Plumbing/);
  assert.equal((await all("SELECT 1 FROM sms_optout WHERE phone10 = '4783659999'")).length, 0);
  assert.equal((await all('SELECT by FROM biz_msgs WHERE ext_id = ?1', sid(31)))[0].by, 'Back on texts');
  // The owner's phone heard about every one of them, the STOP included.
  const notes = pushes().map(p => p.aps.alert.body);
  for (const body of sentences) assert.ok(notes.includes(body), 'pushed: ' + body);
  assert.ok(notes.some(b => /^“Stop\.”: they won’t get texts from you any more/.test(b)), 'the STOP is pushed, marked');
  assert.ok(notes.includes('HELP') && notes.includes('Yes can you come Thursday at 2?'));
  assert.equal(SMS.keywordOf('STOP ALL'), 'stop');
  assert.equal(SMS.keywordOf('stop sending the guy on monday'), '');
});

// ---------- 2. claims ----------
test('2. two overlapping runs send one confirmation, and a held text is released for the next run', async () => {
  const { world, env, q, all } = await setup();
  const appt = new Date(Date.now() + 3 * 864e5).toISOString();
  await q("INSERT INTO app_followups (client_id, kind, name, phone, due, consent, status, created, by, appt_at) VALUES ('c1','appointment','Pat Lee','4783651111',?1,1,'open',?2,'Booking page',?3)", appt.slice(0, 10), new Date().toISOString(), appt);
  await Promise.all([AUTO.autoCron(env), AUTO.autoCron(env), AUTO.autoCron(env)]);
  assert.equal(world.texts.filter(t => t.To === '+14783651111').length, 1);
  assert.match((await all('SELECT auto_conf FROM app_followups'))[0].auto_conf, /^\d{4}-/);
  // A run that died after claiming: not sent again, and handed back to the owner with a reason.
  await q("INSERT INTO app_followups (client_id, kind, name, phone, due, consent, status, created, by, auto_fu) VALUES ('c1','quote','Old Claim','4783651112','2026-10-01',1,'open','x','Owner',?1)", 'sending:' + new Date(Date.now() - 3600e3).toISOString());
  await AUTO.autoCron(env);
  const row = (await all("SELECT * FROM app_followups WHERE name = 'Old Claim'"))[0];
  assert.equal(row.auto_fu, 'skip:not sure it went');
  assert.match(AUTO.autoFail(row), /couldn’t confirm our text went out/);
  assert.equal(world.texts.filter(t => t.To === '+14783651112').length, 0);
});

// ---------- 3. due rows only ----------
test('3. rows that are not due, or belong to a business that cannot text, never hold back a new booking', async () => {
  const { world, env, q } = await setup();
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, active) VALUES ('c2', 'h2', 'other', 'Other Co', 'Pro', 1)");
  const later = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10), now = new Date().toISOString();
  for (let i = 0; i < 70; i++) await q("INSERT INTO app_followups (client_id, kind, name, phone, due, consent, status, created, by) VALUES ('c1','quote',?1,'4783652000',?2,1,'open',?3,'Owner')", 'Q' + i, later, now);
  for (let i = 0; i < 70; i++) await q("INSERT INTO app_followups (client_id, kind, name, phone, due, consent, status, created, by, appt_at) VALUES ('c2','appointment',?1,'4783652001',?2,1,'open',?3,'Owner',?4)", 'A' + i, later, now, later + 'T15:00:00Z');
  const appt = new Date(Date.now() + 2 * 864e5).toISOString();
  await q("INSERT INTO app_followups (client_id, kind, name, phone, due, consent, status, created, by, appt_at) VALUES ('c1','appointment','New Booker','4783653333',?1,1,'open',?2,'Booking page',?3)", appt.slice(0, 10), now, appt);
  await AUTO.autoCron(env);
  assert.equal(world.texts.filter(t => t.To === '+14783653333').length, 1, 'confirmed on the first run');
  assert.equal(world.texts.length, 1, 'nothing else was due');
});

// ---------- 4. invoice texts approved at night ----------
test('4. an invoice reminder approved at night waits and goes out in the morning; a paid one never does', async () => {
  const { world, env, q, all, site } = await setup();
  const real = Date.now, NIGHT = Date.parse('2026-10-30T02:30:00Z'), MORNING = Date.parse('2026-10-30T13:30:00Z');   // 10:30 PM and 9:30 AM Eastern
  try {
    Date.now = () => NIGHT;
    await EXTRAS.ensureInvoices(env);
    for (const [id, phone] of [[1, '4783651111'], [2, '4783651122']]) {
      await q("INSERT INTO app_invoices (id, client_id, token, name, phone, amount, due, sms_ok, status, created) VALUES (?1,'c1',?2,'Pat',?3,48000,'2026-10-20',1,'open','x')", id, 't' + id, phone);
      await q("INSERT INTO app_items (id, client_id, kind, title, text, status, created) VALUES (?1,'c1','invoice','Invoice reminder: Pat','Hi Pat, a reminder about invoice for $480.','pending',?2)", 'inv-' + id + '-7', new Date(NIGHT).toISOString());
      const r = await site.call('/app/' + OWNER + '/api/decide', { json: { id: 'inv-' + id + '-7', action: 'approve' } });
      assert.equal(r.status, 200);
    }
    assert.equal(world.texts.length, 0, 'nothing at night');
    assert.equal((await all("SELECT COUNT(*) AS n FROM app_invoices WHERE text_wait != ''"))[0].n, 2, 'both wait');
    await EXTRAS.invoiceCron(env, NIGHT + 600e3);
    assert.equal(world.texts.length, 0, 'still night');
    await q("UPDATE app_invoices SET status = 'paid' WHERE id = 2");
    Date.now = () => MORNING;
    await EXTRAS.invoiceCron(env, MORNING);
    assert.deepEqual(world.texts.map(t => t.To), ['+14783651111'], 'the morning run sends the open one only');
    assert.equal(world.texts[0].Body, 'Hi Pat, a reminder about invoice for $480.');
    await EXTRAS.invoiceCron(env, MORNING + 600e3);
    assert.equal(world.texts.length, 1, 'once');
    assert.equal((await all("SELECT COUNT(*) AS n FROM app_invoices WHERE text_wait != ''"))[0].n, 0);
  } finally { Date.now = real; }
});

// ---------- 5. a failed automatic text goes back to the owner ----------
test('5. a consented follow-up we could not text comes back in the owner’s reminder, and the card says why', async () => {
  const { env, q, all, site } = await setup();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  await q("INSERT INTO sms_optout (client_id, phone10, at) VALUES ('c1','4783657777','x')");
  await q("INSERT INTO app_followups (client_id, kind, name, phone, amount, due, consent, status, created, by) VALUES ('c1','quote','Opted Out Olivia','4783657777','$4,800',?1,1,'open',?2,'Owner')", today, new Date().toISOString());
  const t = Date.parse(today + 'T15:00:00Z');   // 10 or 11 AM Eastern
  await AUTO.autoCron(env, t);
  await APP.appCron(env, t);
  const row = (await all('SELECT auto_fu, reminded FROM app_followups'))[0];
  assert.equal(row.auto_fu, 'skip:opted out');
  assert.ok(row.reminded, 'the owner was reminded');
  const st = (await site.call('/app/' + OWNER + '/api/state')).json();
  const fu = st.followups.find(x => x.name === 'Opted Out Olivia');
  assert.match(fu.notTexted, /opted out of texts/);
  // The card shows the reason instead of "we text them for you".
  const js = appHtml({ base: '/app/x', business: 'X' }).split('<script>')[1].split('</script>')[0];
  const src = js.match(/function fuCard\(x\)\{[\s\S]*?\n\}/)[0];
  const card = new Function('S', 'esc', 'isDue', 'dueText', 'FUK', 'smsHref', 'fuText', src + '; return fuCard;')({ autoText: true }, s => String(s), () => false, () => 'Due today', { quote: 'Quote' }, () => '', () => '');
  const html = card(fu);
  assert.match(html, /Not texted\.<\/b> They opted out of texts/);
  assert.doesNotMatch(html, /we text them for you/);
  assert.match(card(Object.assign({}, fu, { notTexted: '' })), /we text them for you/);
});

// ---------- 6. phones tied to their link ----------
test('6. notifications go only to phones whose link still works, and never for a client that is off', async () => {
  const { env, q, site } = await setup();
  env.APNS_KEY = 'x'; env.APNS_KEY_ID = 'y';   // counts only; nothing is signed
  await q("INSERT INTO app_staff (code_hash, client_id, name, created, role) VALUES (?1,'c1','Jake',?2,'manager')", sha(STAFF), new Date().toISOString());
  await site.call('/app/' + OWNER + '/api/device', { json: { token: 'a'.repeat(64) } });
  await site.call('/app/' + STAFF + '/api/device', { json: { token: 'b'.repeat(64) } });
  await site.call('/app/' + STAFF + '/api/device', { json: { token: 'c'.repeat(64), live: 'start' } });
  await q("INSERT INTO app_devices (token, client_id, platform, env, created, last_seen) VALUES (?1, 'c1', 'ios', 'production', 'x', 'x')", 'd'.repeat(64));   // from before: no link
  // A phone from before links were recorded keeps its pushes while the client is on (the iPhone app only re-sends its
  // token when linked), until it registers again and is held to its link like the rest.
  assert.equal(await APP.pushClient(env, 'c1', { aps: { alert: 'x' } }), 3, 'the owner, the staff member and the older phone');
  assert.equal(await APP.liveCallStart(env, 'c1', 'CA1', 'Sinclair', ''), 1);
  await q('DELETE FROM app_staff WHERE code_hash = ?1', sha(STAFF));   // HQ removes Jake
  assert.equal(await APP.pushClient(env, 'c1', { aps: { alert: 'x' } }), 2, 'removed staff get nothing');
  assert.equal(await APP.liveCallStart(env, 'c1', 'CA2', 'Sinclair', ''), 0);
  await q("UPDATE app_clients SET code_hash = 'replaced' WHERE client_id = 'c1'");   // a leaked code replaced
  assert.equal(await APP.pushClient(env, 'c1', { aps: { alert: 'x' } }), 1, 'the old link gets nothing (only the older phone, until it registers again)');
  await q("UPDATE app_clients SET code_hash = ?1, active = 0 WHERE client_id = 'c1'", sha(OWNER));
  assert.equal(await APP.pushClient(env, 'c1', { aps: { alert: 'x' } }), 0, 'a client that is off gets nothing');
  await q("UPDATE app_clients SET active = 1 WHERE client_id = 'c1'");
  await site.call('/app/' + OWNER + '/api/device', { json: { token: 'd'.repeat(64) } });
  assert.equal((await env.DB.prepare('SELECT code_hash FROM app_devices WHERE token = ?1').bind('d'.repeat(64)).first()).code_hash, sha(OWNER), 'registering again records the link');
});

// ---------- 7. staff names ----------
test('7. a staff link records its own name whatever the content type says', async () => {
  const { env, q, all, site } = await setup();
  await q("INSERT INTO app_staff (code_hash, client_id, name, created, role) VALUES (?1,'c1','Jake',?2,'manager')", sha(STAFF), new Date().toISOString());
  for (const id of ['i1', 'i2', 'i3']) await q("INSERT INTO app_items (id, client_id, kind, title, stars, text, status, created) VALUES (?1,'c1','reply','Al',5,'Thanks so much, Al.','pending',?2)", id, new Date().toISOString());
  await site.call('/app/' + STAFF + '/api/decide', { json: { id: 'i1', action: 'approve', by: 'Dana' } });
  await site.call('/app/' + STAFF + '/api/decide', { body: JSON.stringify({ id: 'i2', action: 'approve', by: 'Dana' }), headers: { 'content-type': 'text/plain' } });
  await site.call('/app/' + STAFF + '/api/decide', { body: JSON.stringify({ id: 'i3', action: 'skip', by: 'Dana' }) });
  assert.deepEqual((await all('SELECT decided_by FROM app_items ORDER BY id')).map(r => r.decided_by), ['Jake', 'Jake', 'Jake']);
  await site.call('/app/' + STAFF + '/api/message', { body: JSON.stringify({ text: 'Hours change next week', by: 'Dana' }), headers: { 'content-type': 'text/plain' } });
  assert.equal((await all("SELECT by FROM app_messages WHERE dir = 'in'"))[0].by, 'Jake');
  // The owner still signs with the name they give.
  await q("INSERT INTO app_items (id, client_id, kind, title, stars, text, status, created) VALUES ('i4','c1','reply','Al',5,'Thanks so much, Al.','pending',?1)", new Date().toISOString());
  await site.call('/app/' + OWNER + '/api/decide', { body: JSON.stringify({ id: 'i4', action: 'approve', by: 'Dana' }), headers: { 'content-type': 'text/plain' } });
  assert.equal((await all("SELECT decided_by FROM app_items WHERE id = 'i4'"))[0].decided_by, 'Dana');
});

// ---------- 8. approval reminders per item ----------
test('8. a low review gets its own 6-hour reminder even after an older item was reminded', async () => {
  const { env, q } = await setup();
  await CHECKS.ensureChecks(env);
  const t0 = Date.parse('2026-11-02T14:00:00Z');   // Monday 9 AM Eastern
  await q("INSERT INTO app_items (id, client_id, kind, title, text, status, created) VALUES ('post1','c1','post','A post','Fall special','pending',?1)", new Date(t0 - 30 * 3600e3).toISOString());
  const pushes = [];
  const h = { pushClient: (cid, n) => { pushes.push(n.aps.alert.title); return 1; }, mail: () => 'off' };
  await CHECKS.approvalNudges(env, t0, h);
  await q("INSERT INTO app_items (id, client_id, kind, title, stars, text, status, created) VALUES ('rev2','c1','reply','Angry Al',2,'Sorry to hear','pending',?1)", new Date(t0 + 1800e3).toISOString());
  await q("INSERT INTO app_items (id, client_id, kind, title, text, status, created) VALUES ('post2','c1','post','Another','Winter tips','pending',?1)", new Date(t0 - 22 * 3600e3).toISOString());
  await CHECKS.approvalNudges(env, t0 + 3 * 3600e3, h);   // post2 is a day old now, but they heard from us 3 hours ago
  assert.deepEqual(pushes, ['Something is waiting for your OK']);
  const r = await CHECKS.approvalNudges(env, t0 + 7 * 3600e3, h);   // 4 PM: the 2-star review is 6.5 hours old
  assert.deepEqual(pushes, ['Something is waiting for your OK', 'A 2-star review is waiting for your OK']);
  assert.deepEqual(r.nudged.map(x => [x.client, x.level]), [['c1', 1]]);
  assert.deepEqual((await CHECKS.approvalNudges(env, t0 + 8 * 3600e3, h)).nudged, [], 'each item once per level');
});

// ---------- 9 and 10. the page ----------
const PAGE_JS = appHtml({ base: '/app/x', business: 'X' }).split('<script>')[1].split('</script>')[0];
const fnSrc = name => (PAGE_JS.match(new RegExp('^function ' + name + '\\([^)]*\\)\\{.*\\}$', 'm')) || PAGE_JS.match(new RegExp('^function ' + name + '\\([^)]*\\)\\{\\n[\\s\\S]*?\\n\\}', 'm')))[0];
test('9. automatic refreshes wait while any field has focus or unsaved changes; asked-for refreshes still run', () => {
  const el = (tag, type, value, def) => ({ tagName: tag, type, value, defaultValue: def == null ? value : def });
  const body = { tagName: 'BODY' };
  const doc = { activeElement: body, body, visibilityState: 'visible', contains: () => true };
  const calls = [];
  const make = touched => new Function('document', 'TOUCHED', 'load', 'livePoll', [fnSrc('unsaved'), fnSrc('editing'), fnSrc('autoLoad')].join('\n') + '; return { editing, autoLoad };')(doc, touched, (a, b) => calls.push('load:' + a + ',' + b), () => calls.push('poll'));
  let p = make([]);
  assert.equal(p.editing(), false);
  p.autoLoad(); assert.deepEqual(calls.splice(0), ['load:true,true']);
  doc.activeElement = el('TEXTAREA', 'textarea', 'Ask about', '');   // "Teach Max", or any field: no id list
  assert.equal(p.editing(), true);
  p.autoLoad(); assert.deepEqual(calls.splice(0), ['poll'], 'skipped, and the live poll keeps going');
  doc.activeElement = el('INPUT', 'time', '08:00');
  assert.equal(p.editing(), true, 'booking hours');
  doc.activeElement = el('INPUT', 'button', '');
  assert.equal(p.editing(), false, 'a focused button is not typing');
  doc.activeElement = body;
  p = make([el('INPUT', 'text', 'Maxine', 'Max')]);   // the voice name, typed and not saved, focus elsewhere
  assert.equal(p.editing(), true);
  p = make([el('INPUT', 'text', 'Max', 'Max')]);
  assert.equal(p.editing(), false, 'typed back to what was saved');
  p = make([{ tagName: 'SELECT', options: [{ defaultSelected: true, selected: false }, { defaultSelected: false, selected: true }] }]);
  assert.equal(p.editing(), true, 'a changed select');
  p = make([{ tagName: 'INPUT', type: 'checkbox', checked: true, defaultChecked: false }]);
  assert.equal(p.editing(), true, 'a ticked box');
  // Every automatic path goes through the check; the refresh button and pull-down call load() directly.
  assert.match(fnSrc('livePoll'), /setTimeout\(autoLoad,ms\)/);
  assert.match(PAGE_JS, /setInterval\(function\(\)\{[^\n]*!editing\(\)\)load\(true,true\);\},60000\)/);
  assert.match(PAGE_JS, /visibilitychange',function\(\)\{if\(document\.visibilityState==='visible'&&!editing\(\)\)load\(true,true\);\}/);
  assert.match(fnSrc('load'), /if\(auto&&editing\(\)\)\{livePoll\(\);return;\}/, 'typing started while it loaded: nothing is replaced');
  assert.match(PAGE_JS, /\$\('#refresh'\)\.addEventListener\('click',function\(\)\{load\(\);\}\)/);
});
test('10. the text-back card says what is true: on, off, or waiting', () => {
  const note = S => new Function('S', fnSrc('textbackNote') + '; return textbackNote();')(S);
  assert.match(note({ after: { canText: false, textback: true } }), /Waiting on carrier approval/);
  assert.match(note({ after: { canText: true, textback: true } }), /chip ok">On</);
  assert.match(note({ after: { canText: true, textback: false } }), /chip">Off</);
  assert.match(note({ after: null, texting: { status: 'approved' } }), />On</);
  assert.match(note({ after: null, texting: { status: 'in_review' }, autoText: false }), /Waiting/);
  assert.doesNotMatch(PAGE_JS, /Waiting on carrier approval<\/span> Texting turns on once carriers approve your number, usually about two weeks\.<\/p><\/div>':/, 'no longer hard-coded');
  for (const s of [note({ after: { canText: true, textback: true } }), note({ after: { canText: true, textback: false } }), note({ after: { canText: false } })]) assert.doesNotMatch(s, /\bAI\b|\blocal\b|receptionist|front desk/i);
});

// ---------- 11. the runbook ----------
test('11. the runbook pauses a line with the column that exists', () => {
  const md = fs.readFileSync(new URL('../docs/runbook.md', import.meta.url), 'utf8');
  const pause = md.split('## How to pause a line')[1].split('\n## ')[0];
  assert.match(pause, /UPDATE voice_lines SET on_air = 0\s+WHERE client_id = '<id>'/);
  assert.doesNotMatch(pause, /hq_on/);
  const schema = fs.readFileSync(new URL('./fixtures/schema.sql', import.meta.url), 'utf8');
  assert.match(schema.match(/CREATE TABLE voice_lines \([^\n]*/)[0], /\bon_air INTEGER/);
});

// ---------- 12. the public booking page ----------
test('12. the booking page texts nobody until that number texts in; a business has a day’s ceiling on automatic texts', async () => {
  const { world, env, q, all, site } = await setup();
  await q("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES ('c1', 'r', 'America/New_York', 'x')");
  const harness = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/oauth2\.googleapis\.com\/token/.test(url)) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
    if (/googleapis\.com\/calendar\/v3/.test(url)) return new Response(JSON.stringify(init && init.method === 'POST' ? { id: 'ev1' } : { items: [], timeZone: 'America/New_York' }), { headers: { 'content-type': 'application/json' } });
    return harness(input, init);
  };
  try {
    const form = (await site.call('/b/sinclair')).text;
    const slots = [...form.matchAll(/name="slot" value="(\d+)"/g)].map(m => m[1]);
    assert.ok(slots.length >= 2, 'the page offers times');
    // Someone books with a stranger's number and ticks "text me": nothing goes to that number.
    const r1 = await site.call('/b/sinclair', { form: { name: 'Mallory', phone: '478-365-4444', slot: slots[0], sms_ok: 'yes', t: '0', website: '' }, ip: '198.51.100.1' });
    assert.equal(r1.status, 200);
    assert.match(r1.text, /text YES to \(478\) 555-0100 from the number you gave us/);
    // The real customer books and texts in: the confirmation goes, to them only.
    await site.call('/b/sinclair', { form: { name: 'Pat Lee', phone: '478-365-5555', slot: slots[1], sms_ok: 'yes', t: '0', website: '' }, ip: '198.51.100.2' });
    await AUTO.autoCron(env);
    assert.equal(world.texts.length, 0, 'no text before they text in');
    assert.deepEqual((await all("SELECT consent, auto_conf FROM app_followups WHERE by = 'Booking page' ORDER BY id")).map(r => [r.consent, r.auto_conf]), [[0, 'wait:text'], [0, 'wait:text']]);
    await inbound(env, '+14783655555', 'YES', 50);
    assert.deepEqual(world.texts.map(t => t.To), ['+14783655555'], 'confirmed once they texted in');
    assert.match(world.texts[0].Body, /^Hi Pat, this is Sinclair Plumbing\. You’re set for /);
    await AUTO.autoCron(env);
    assert.equal(world.texts.length, 1, 'the stranger’s number still gets nothing');
    assert.equal((await all("SELECT 1 FROM biz_msgs WHERE thread = '4783655555'")).length, 1, 'their YES is in the inbox too');
    // A YES to a Fill my week offer books through the same path, and they texted in, so their confirmation goes at once.
    const open = await (await import('../src/gcal.js')).openSlots(env, 'c1', Date.now(), 12);
    const fday = (await import('../src/fillweek.js')).openDays(open.slots, open.tz, Date.now() - 36 * 3600e3)[0].day;
    await q("INSERT INTO fillweek_runs (id, client_id, day, created) VALUES (1, 'c1', ?1, ?2)", fday, new Date().toISOString());
    await q("INSERT INTO fillweek_offers (run_id, client_id, phone10, name, day, status, at) VALUES (1, 'c1', '4783657000', 'Lee Fill', ?1, 'sent', ?2)", fday, new Date().toISOString());
    await inbound(env, '+14783657000', 'Yes', 60);
    assert.deepEqual(world.texts.filter(t => t.To === '+14783657000').map(t => t.Body.slice(0, 40)), ['Hi Lee, this is Sinclair Plumbing. You’r']);
  } finally { globalThis.fetch = harness; }
  // A day's ceiling per business on automatic texts (an hour's ceiling already existed); what the owner types still goes.
  const earlier = new Date(Date.now() - 3 * 3600e3).toISOString();
  await env.DB.batch(Array.from({ length: 200 }, (_, i) => env.DB.prepare("INSERT INTO sms_log (client_id, to10, at, kind, sid, status) VALUES ('c1', ?1, ?2, 'confirm', 'SMx', 'delivered')").bind('47836' + String(10000 + i), earlier)));
  const held = await SMS.sendText(env, { clientId: 'c1', to: '4783656666', body: 'Sorry we missed you', kind: 'textback' });
  assert.deepEqual([held.ok, held.why, held.retry], [false, 'held: daily ceiling', true]);
  const typed = await SMS.sendText(env, { clientId: 'c1', to: '4783656666', body: 'On my way', kind: 'reply' });
  assert.equal(typed.ok, true);
});
