// The website and lead pipeline fixes of Oct 30, 2026: the audit email can't be aimed at strangers, the audit page can't
// be used to send mail or pushes in bulk, a visitor's clock never loses a lead, a bad address never jams the retry queue,
// a stop is for the address and survives a key change, mailed letters only go to the business that was queued (once),
// Google's names aren't kept, and the site says only what the service does today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const L = await import('../src/leadmail.js');
const M = await import('../src/mail.js');
const { THEMES } = await import('../src/social.js');
const { default: worker } = await import('../src/index.js');

const PLACE = { id: 'ChIJsinclair', displayName: { text: 'Sinclair Plumbing' }, formattedAddress: '12 Oak St, Eatonton, GA 31024, USA', rating: 4.3, userRatingCount: 31, primaryTypeDisplayName: { text: 'Plumber' }, businessStatus: 'OPERATIONAL', regularOpeningHours: { weekdayDescriptions: ['Mon 8-5'] }, photos: [] };
function site(extra) {
  const world = new H.World(), DB = H.makeDB(), out = [];
  const env = H.makeEnv(world, DB, Object.assign({ BUSINESS_ADDRESS: '103 W Sumter St, Eatonton, GA 31024', SEND_MAIL: { send: async m => { out.push(m); } } }, extra || {}));
  H.installFetch(world, env);
  world.places = { places: [PLACE] };
  return { world, DB, env, out, client: H.makeClient(worker, env) };
}
const form = o => Object.assign({ name: 'Dana Whitfield', email: 'dana@example.com', phone: '', business: 'Sinclair Plumbing', town: 'Eatonton, GA', type: 'Contractor or trade', plan: 'Growth', t: String(Date.now() - 60000) }, o);
const ask = (s, o, ip) => s.client.call('/lead', { form: form(o), headers: { accept: 'application/json' }, ip: ip || '198.51.100.20' });
const placesCalls = w => w.calls.filter(c => /places\.googleapis/.test(c.url)).length;

// ---------- 1. the form can't be aimed at strangers ----------
test('one audit per address in 30 days (dots and +tags are the same Gmail box), three a day per network, and the page says what happens', async () => {
  const s = site();
  let r = await ask(s, { email: 'dana.whit@gmail.com' }, '198.51.100.20');
  assert.match(r.json().message, /Your free audit is on its way/, 'a real lead still gets the audit at once');
  assert.equal(s.out.length, 1);
  r = await ask(s, { email: 'DanaWhit+x@googlemail.com' }, '192.0.2.50');
  assert.equal(s.out.length, 1, 'the same mailbox, spelled another way, gets nothing new');
  assert.doesNotMatch(r.json().message, /on its way/, 'and the page does not promise it');
  assert.match(r.json().message, /Katie follows up within one business day/);
  // three different addresses from one network get audits; the fourth that day is held, and Christopher hears quietly
  for (const [i, e] of ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'].entries()) await ask(s, { email: e }, '203.0.113.' + (10 + i));
  assert.deepEqual(s.out.map(m => m.to).slice(1), ['a@example.org', 'b@example.org', 'c@example.org']);
  const held = await s.DB.prepare("SELECT audit FROM leads WHERE email = 'd@example.org'").first();
  assert.equal(held.audit, 'held: network limit');
  assert.ok(s.world.pushes.some(p => /Audit held/.test(p.title) && p.priority === 'low'));
  // a different network the same day is fine
  await ask(s, { email: 'e@example.org' }, '203.0.114.10');
  assert.equal(s.out.at(-1).to, 'e@example.org');
});

test('what they typed stays out of the subject and is quoted plainly, without links or phone numbers', async () => {
  const s = site();
  s.world.places = { places: [] };
  await ask(s, { email: 'stranger@example.org', business: 'WIN A FREE IPHONE at evil.example/claim', town: 'call 1-900-555-0100 now' });
  const m = s.out[0];
  assert.equal(m.subject, 'Your free audit: one quick question');
  assert.match(m.text, /We looked on Google for “WIN A FREE IPHONE at, call now” and couldn’t find an exact match/);
  assert.doesNotMatch(m.text + m.html, /evil\.example|900-555/);
  const f = L.followMail({ name: 'Free', business: 'WIN A FREE IPHONE', plan: 'Growth', grade: 'D' }, 1, 'https://x/stop', { BUSINESS_ADDRESS: 'x' }, null);
  assert.equal(f.subject, 'Your free audit: the quickest win', 'no "Re:" (it is not a reply) and no typed text');
  assert.doesNotMatch(f.subject + f.text, /IPHONE/);
  assert.equal(L.followMail({ lang: 'es' }, 2, 'https://x/stop', {}, null).subject, 'Última nota sobre su auditoría');
});

test('no follow-ups until the address clicks through our email; a click in the first two minutes is a mail scanner', async () => {
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  const row = await s.DB.prepare("SELECT id, audit FROM leads WHERE email = 'dana@example.com'").first();
  assert.equal(row.audit, 'sent');
  const html = s.out[0].html;
  const go = /https:\/\/alwaysopenoffice\.com\/lead\/go\?i=\d+&amp;to=start&amp;k=[0-9a-f]{24}/.exec(html);
  assert.ok(go, 'the Start button counts the click');
  assert.match(s.out[0].text, /alwaysopenoffice\.com\/start\?plan=Growth/, 'the plain text keeps the plain link');
  const link = go[0].replace(/&amp;/g, '&');
  // the scanner, seconds after delivery: redirected, not counted
  let r = await s.client.call(link.replace('https://alwaysopenoffice.com', ''));
  assert.equal(r.status, 302); assert.equal(r.location, 'https://alwaysopenoffice.com/start?plan=Growth');
  assert.equal((await s.DB.prepare('SELECT engaged FROM leads WHERE id = ?1').bind(row.id).first()).engaged || '', '');
  // the follow-up is due (day 2, a weekday at 10 AM Eastern), but nobody has shown the address is real
  const t0 = Date.parse('2026-10-26T14:00:00Z');
  await s.DB.prepare('UPDATE leads SET audit_at = ?1 WHERE id = ?2').bind(new Date(t0).toISOString(), row.id).run();
  const sent = []; const h = { send: async (to, m) => { sent.push({ to, subject: m.subject }); return 'sent'; } };
  assert.deepEqual(await L.followCron(s.env, t0 + 2 * 864e5, h), { sent: 0, stopped: 0 });
  // a person clicks later: now it counts, and the follow-up goes
  r = await s.client.call(link.replace('https://alwaysopenoffice.com', ''));
  assert.equal(r.status, 302);
  assert.ok((await s.DB.prepare('SELECT engaged FROM leads WHERE id = ?1').bind(row.id).first()).engaged);
  assert.deepEqual(await L.followCron(s.env, t0 + 2 * 864e5, h), { sent: 1, stopped: 0 });
  assert.equal(sent[0].subject, 'Your free audit: the quickest win');
  // a forged click link changes nothing and goes home
  r = await s.client.call('/lead/go?i=' + row.id + '&to=start&k=' + '0'.repeat(24));
  assert.equal(r.location, 'https://alwaysopenoffice.com/');
});

// ---------- 2. the audit page can't send mail or pushes in bulk ----------
test('the audit page: one copy per link a day, no Google lookup on a post, the lead keeps its address, a few posts per sender, one call-me push a day', async () => {
  const s = site();
  await L.ensureLeadMail(s.env);
  const tok = 'AbCdEfGhJkMnPqRs';
  await s.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, origin, ip_hash, status, token, audit, audit_at) VALUES (?1, '', '', '', 'Sinclair Plumbing', 'Eatonton', 'letter 1', '', 'letter', ?2, 'letter', ?1)").bind(new Date().toISOString(), tok).run();
  const u = '/your-audit/' + tok;
  let r = await s.client.call(u, { ip: '198.51.100.30' });
  assert.match(r.text, /Sinclair Plumbing/);
  const kept = await s.DB.prepare('SELECT grade, fixes, place_id, business FROM leads WHERE token = ?1').bind(tok).first();
  assert.equal(kept.place_id, 'ChIJsinclair'); assert.match(kept.grade, /^[A-F]$/);
  assert.ok(JSON.parse(kept.fixes).every(f => Object.keys(f).join() === 'title,fix'), 'our words only');
  const before = placesCalls(s.world);
  r = await s.client.call(u, { form: { email: 'owner@sinclair.example' }, ip: '198.51.100.30' });
  assert.match(r.text, /A copy is on its way to owner@sinclair\.example/);
  assert.equal(placesCalls(s.world), before, 'the copy is built from what the page kept');
  assert.equal(s.out.length, 1); assert.equal(s.out[0].subject, 'Your audit copy: grade ' + kept.grade);
  assert.match(s.out[0].text, /alwaysopenoffice\.com\/your-audit\/AbCdEfGhJkMnPqRs/);
  r = await s.client.call(u, { form: { email: 'someone@else.example' }, ip: '198.51.100.31' });
  assert.match(r.text, /already went out today/);
  assert.equal(s.out.length, 1, 'one copy per link a day');
  assert.equal((await s.DB.prepare('SELECT email FROM leads WHERE token = ?1').bind(tok).first()).email, 'owner@sinclair.example', 'not overwritten');
  // call me: one push a day, however many posts
  const p0 = s.world.pushes.length;
  for (const n of ['(478) 555-0110', '(478) 555-0111', '(478) 555-0111']) await s.client.call(u, { form: { phone: n }, ip: '198.51.100.32' });
  assert.equal(s.world.pushes.length - p0, 1);
  assert.equal((await s.DB.prepare('SELECT phone FROM leads WHERE token = ?1').bind(tok).first()).phone, '(478) 555-0111', 'the corrected number is kept for the call');
  // six posts an hour from one sender, then a polite no
  for (let i = 0; i < 7; i++) r = await s.client.call(u, { form: { email: 'x' + i + '@else.example' }, ip: '198.51.100.40' });
  assert.match(r.text, /a lot of tries from here/);
});

// ---------- 3. a visitor's clock never loses a lead ----------
test('the form time is signed by us: a fast browser clock is fine, and a too-quick form still reaches Christopher quietly', async () => {
  const s = site();
  const getStamp = async () => (await s.client.call('/lead?t=1', { headers: { accept: 'application/json' } })).json().t;
  assert.match(await getStamp(), /^\d{13}\.[0-9a-f]{24}$/);
  // a browser clock two minutes fast (the old way, from a page loaded before this change): not a bot
  let r = await ask(s, { email: 'skew@example.org', t: String(Date.now() + 120000) });
  assert.equal((await s.DB.prepare("SELECT status FROM leads WHERE email = 'skew@example.org'").first()).status, 'new');
  assert.match(r.json().message, /on its way/);
  // a signed time from a minute ago: fine
  await ask(s, { email: 'ok@example.org', t: await L.formStamp(s.env, Date.now() - 60000) });
  assert.equal((await s.DB.prepare("SELECT status FROM leads WHERE email = 'ok@example.org'").first()).status, 'new');
  // sent a second after the page loaded (autofill): held, no audit email, but Christopher gets it quietly, and the page says no more than is true
  const mails0 = s.world.mail.length, sent0 = s.out.length;
  r = await ask(s, { email: 'fast@example.org', business: 'Quick Co', t: await getStamp() });
  const row = await s.DB.prepare("SELECT status, reason FROM leads WHERE email = 'fast@example.org'").first();
  assert.deepEqual([row.status, row.reason], ['spam', 'timing only: sent too fast']);
  assert.equal(s.out.length, sent0, 'no audit email to an address a bot may have typed');
  assert.ok(s.world.pushes.some(p => /lead to check: Quick Co/.test(p.title) && p.priority === 'low'));
  assert.equal(s.world.mail.length, mails0 + 1, 'the lead email still goes to Christopher');
  assert.match(s.world.mail.at(-1).raw, /held for a look/);
  assert.doesNotMatch(r.json().message, /on its way/);
  // a forged stamp counts as no stamp: held the same way, never dropped
  await ask(s, { email: 'forged@example.org', t: '1700000000000.' + 'a'.repeat(24) });
  assert.match((await s.DB.prepare("SELECT reason FROM leads WHERE email = 'forged@example.org'").first()).reason, /^timing only/);
});

// ---------- 4. one email check, and the retry queue never sticks ----------
test('one email check everywhere: joe@gmail.c is refused by the form, and a bad row already queued leaves the queue', async () => {
  assert.equal(L.validEmail('joe@gmail.c'), false);
  for (const ok of ['dana@example.com', "o'brien@sub.example.co.uk", 'ana+citas@salon.example', 'josé@ejemplo.es']) assert.equal(L.validEmail(ok), true, ok);
  for (const bad of ['joe@gmail', 'joe@@x.com', 'a b@x.com', 'joe@x.c0m', '<a@x.com>']) assert.equal(L.validEmail(bad), false, bad);
  const s = site();
  const r = await ask(s, { email: 'joe@gmail.c' });
  assert.equal(r.status, 400); assert.match(r.text, /valid email/);
  // rows from before the shared check: five bad ones, then a real lead
  await L.ensureLeadMail(s.env);
  const now = Date.now(), at = new Date(now - 20 * 60e3).toISOString();
  for (let i = 0; i < 5; i++) await s.DB.prepare("INSERT INTO leads (at, name, email, business, town, status) VALUES (?1, 'Joe', ?2, 'Acme', 'Gray', 'new')").bind(at, 'joe' + i + '@gmail.c').run();
  await s.DB.prepare("INSERT INTO leads (at, name, email, business, town, status) VALUES (?1, 'Real', 'real@customer.com', 'Sinclair Plumbing', 'Eatonton', 'new')").bind(at).run();
  let res = await L.auditRetryCron(s.env, now, {});
  assert.deepEqual(res.results, ['no email', 'no email', 'no email', 'no email', 'no email']);
  res = await L.auditRetryCron(s.env, now + 10 * 60e3, {});
  assert.deepEqual(res.results, ['sent'], 'the real lead behind them goes out on the next pass');
});

// ---------- 5. a stop is for the address, and survives a key change ----------
async function oldStopSig(key, id) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('stop:' + id)))].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
test('the stop link: signed with a stored secret, old links keep working after the ops key changes, and the address is never emailed again', async () => {
  const DB = H.makeDB();
  // a lead emailed before this change, its stop link signed with the old ops key
  const id = (await DB.prepare("INSERT INTO leads (at, name, email, business, status) VALUES (?1, 'Dana', 'Dana.Whit@gmail.com', 'Sinclair Plumbing', 'new')").bind(new Date().toISOString()).run()).meta.last_row_id;
  const oldLink = 'https://alwaysopenoffice.com/lead/stop?i=' + id + '&k=' + await oldStopSig('old-ops-key', id);
  await L.ensureLeadMail({ DB, LEADS_KEY: 'old-ops-key' });             // the first run after the deploy writes the old signatures down
  const env = { DB, LEADS_KEY: 'a-brand-new-ops-key' };                // then the ops key is rotated
  const fresh = new URL(await L.stopLink(env, id));
  assert.notEqual(fresh.searchParams.get('k'), await oldStopSig('a-brand-new-ops-key', id), 'not signed with the ops key');
  const u = new URL(oldLink);
  assert.match(await (await L.handleStop(new Request(u), env, u)).text(), /No more emails/);
  const bad = new URL('https://alwaysopenoffice.com/lead/stop?i=' + id + '&k=' + 'f'.repeat(24));
  assert.match(await (await L.handleStop(new Request(bad), env, bad)).text(), /didn’t work/);
  assert.equal(await L.suppressed(env, 'danawhit@gmail.com'), true, 'the address, not just the row');
  // a new request typed with the same mailbox: no audit email, and the page says so honestly
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  const row = await s.DB.prepare("SELECT id FROM leads WHERE email = 'dana@example.com'").first();
  const link = new URL(await L.stopLink(s.env, row.id));
  await s.client.call(link.pathname + link.search);
  const r = await ask(s, { email: 'DANA@example.com', business: 'Another Co' }, '192.0.2.77');
  assert.equal(s.out.length, 1, 'only the first audit');
  assert.doesNotMatch(r.json().message, /on its way/);
  assert.equal((await s.DB.prepare("SELECT audit FROM leads WHERE business = 'Another Co'").first()).audit, 'stopped');
});

// ---------- 6 and 7. mailed letters ----------
const TUE_11 = Date.parse('2026-11-03T16:00:00Z');
function letters() {
  const s = site({ LOB_KEY: 'live_abc123' });
  const lob = [];
  const g = (id, name, address) => ({ found: true, at: '', grade: 'D', score: 48, business: { id, name, address: address || '12 Oak St, Eatonton, GA 31024, USA', type: 'Plumber', rating: 3.9, reviews: 4, status: 'OPERATIONAL' }, areas: [], findings: [{ title: 'No hours on Google', saw: 'x', fix: 'We add hours.' }], fine: [] });
  const google = { 'Sinclair Plumbing': g('ChIJsame', 'Sinclair Plumbing & Drain LLC'), 'Sinclair Drain': g('ChIJsame', 'Sinclair Plumbing & Drain LLC'), 'Joes Plumbing': g('ChIJother', 'Middle Georgia Plumbing'), 'Oak Lawn Care': g('ChIJoak', 'Oak Lawn Care Co'), 'Riverbend Heating': g('ChIJriver', 'Riverbend Heating and Air') };
  const h = { ping: false, run: async (e, q) => google[q] || { found: false }, fetch: async (url, init) => { lob.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'ltr_' + lob.length, expected_delivery_date: '2026-11-06' })); } };
  return Object.assign(s, { lob, h });
}
test('a letter goes only to the business that was queued, once per Google place, never to a client by another name', async () => {
  assert.equal(M.nameMatch('Sinclair Plumbing', 'Sinclair Plumbing & Drain LLC', 'Eatonton'), true);
  assert.equal(M.nameMatch('Sinclair Plumbing', 'Sinclair Dental', ''), false, 'one shared word is not a match');
  assert.equal(M.nameMatch('Joes Plumbing', 'Middle Georgia Plumbing', ''), false, 'a trade word is not a match');
  assert.equal(M.nameMatch('A1 Plumbing', 'A-1 Plumbing Inc.', ''), true);
  const s = letters();
  await M.turnOn(s.env, 10, 100);
  await M.queueLetters(s.env, [{ q: 'Sinclair Plumbing', town: 'Eatonton' }, { q: 'Sinclair Drain', town: 'Eatonton, GA' }, { q: 'Joes Plumbing', town: 'Gray' }]);
  let r = await M.mailCron(s.env, TUE_11, s.h);
  assert.deepEqual(r.results.map(x => x.result), ['sent', 'skipped: mailed in the last 6 months', 'skipped: Google’s top match has a different name']);
  assert.equal(s.lob.length, 1, 'two spellings of one business: one letter');
  // the lead keeps the queued name and the place ID; Google's display name is kept nowhere
  const lead = await s.DB.prepare("SELECT business, place_id FROM leads WHERE origin LIKE 'letter%'").first();
  assert.deepEqual([lead.business, lead.place_id], ['Sinclair Plumbing', 'ChIJsame']);
  const dump = JSON.stringify((await s.DB.prepare('SELECT * FROM leads').all()).results) + JSON.stringify((await s.DB.prepare('SELECT * FROM mail_queue').all()).results);
  assert.doesNotMatch(dump, /Drain LLC|Middle Georgia/);
  // clients: by Google's name, and by their own Google profile's place ID
  await s.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('oak', 'h-oak', 'Oak Lawn Care', 1), ('rb', 'h-rb', 'RB Comfort', 1)").run();
  await s.DB.prepare("CREATE TABLE IF NOT EXISTS rival_profile (client_id TEXT PRIMARY KEY, place_id TEXT DEFAULT '', found INTEGER DEFAULT 0)").run();
  await s.DB.prepare("INSERT INTO rival_profile (client_id, place_id, found) VALUES ('rb', 'ChIJriver', 1)").run();
  await M.queueLetters(s.env, [{ q: 'Oak Lawn Care', slug: 'oak-2', town: 'Eatonton' }, { q: 'Riverbend Heating', town: 'Eatonton' }]);
  r = await M.mailCron(s.env, TUE_11 + 10 * 60e3, s.h);
  assert.deepEqual(r.results.map(x => x.result), ['skipped: already a client', 'skipped: already a client']);
});

// ---------- 8 to 12. what the site says ----------
const PUB = 'public';
const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html') && f !== 'og-share.html');
const text = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const visible = f => text(f).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

test('review requests: every customer, after every job; nothing on the site or in our posts suggests only happy ones are asked', () => {
  const GATING = [/A yes (becomes|turns into) (the|a) review/i, /before it (becomes|turns into) a (review|one-star|bad review)/i, /so happy (clients|customers)/i, /Un sí se convierte en la solicitud/i, /antes de (que se convierta|volverse) (en )?(una )?reseña/i, /clientes contentos/i, /Pressing 1 turns into a review/i, /from happy customers/i];
  const sources = pages.map(f => [f, text(f)]).concat([['social.js', fs.readFileSync('src/social.js', 'utf8')], ['social cards', fs.readFileSync('tools/social/make.mjs', 'utf8')], ['audit.js', fs.readFileSync('src/audit.js', 'utf8')]]);
  for (const [f, s] of sources) for (const re of GATING) assert.doesNotMatch(s, re, f + ' ' + re);
  for (const f of ['index.html', 'plumbing.html', 'builders.html']) assert.match(text(f), /Every customer gets the review request, whatever they answer/, f);
});

test('Storm Desk and Rate-Shock Radar say what they do today: central Georgia, read by our team', () => {
  for (const f of pages) {
    const s = visible(f);
    assert.doesNotMatch(s, /drafted that minute|ready the minute a|the minute a (weather )?warning|lista en el minuto|en ese mismo minuto/, f);
    if (/Storm Desk/.test(s)) assert.match(s, /central Georgia|centro de Georgia/, f + ' sells Storm Desk without saying where it works');
  }
  const ins = visible('insurance.html');
  assert.doesNotMatch(ins, /Rate complaints double|heads-up the same day|a week early|Rate complaints doubled/);
  for (const t of ['Eatonton', 'Madison', 'Greensboro', 'Milledgeville', 'Monticello', 'Gray', 'Sparta', 'Macon']) assert.match(ins, new RegExp('covers[^<]*' + t), t);
  const storm = THEMES.find(t => t.name === 'storm');
  assert.match(storm.about + storm.fallback, /central Georgia/);
});

test('honest labels: a sample call, no receptionist, Max on every plan, nobody named Christopher, Google Maps credited under the grade', () => {
  const hm = fs.readFileSync('public/hear-max.js', 'utf8');
  assert.match(hm, /A sample call to our demo line\./); assert.doesNotMatch(hm, /real call|llamada real/);
  for (const f of pages) {
    const s = visible(f);
    assert.doesNotMatch(s, /receptionist|recepcionista/i, f);
    assert.doesNotMatch(s, /If you add Max|Max comes with both|Max comes with it,/, f);
    assert.doesNotMatch(s.replace(/<script[\s\S]*?<\/script>/g, ' '), /Christopher/, f);
  }
  for (const f of ['index.html', 'hvac.html', 'plumbing.html', 'auto-repair.html', 'dental.html', 'marine.html', 'restaurants.html', 'salons.html', 'builders.html', 'insurance.html']) assert.match(text(f), /Ratings and review counts from Google Maps/, f + ' shows Google data under the grade without credit');
  assert.match(text('index.html'), /id="check-go">Send me the full audit<\/a>'\+\s*'<p class="muted gsrc">/, 'the home page’s own grade box too');
  const idx = fs.readFileSync('src/index.js', 'utf8');
  assert.doesNotMatch(idx, /'Christopher at Always Open'/);
  assert.match(idx, /mailTo\(env, to, subj, text, 'Always Open', \{ replyTo: 'hello@alwaysopenoffice\.com' \}\)/);
});

test('the 320 px header fits: the phone kit has a narrow-screen rule for the ES/EN switch', () => {
  for (const f of ['index.html', 'plumbing.html', 'insurance.html', 'dental.html']) assert.match(text(f), /@media \(max-width:360px\)\{\.top,html\[data-lang="es"\] \.top\{gap:6px\}\.top \.wordmark\{font-size:1rem/, f);
});
