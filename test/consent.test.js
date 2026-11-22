// Customers sign up for a business's texts themselves (consent.js): the page, the one text, the YES, JOIN by text,
// STOP, the guards, and what the owner sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const S = await import('../src/sms.js');
const C = await import('../src/consent.js');
const P = await import('../src/past.js');

const LINE = '+14785551001', NOW = Date.parse('2026-11-23T15:00:00Z');
const sm = n => 'SM' + String(n).padStart(32, '0');
async function world(o) {
  o = o || {};
  const w = new H.World(), DB = H.makeDB(), env = H.makeEnv(w, DB);
  H.installFetch(w, env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, regulated, phone) VALUES ('c1', 'h1', ?1, 1, ?2, '+14785550100')").bind(o.biz || 'Quillen Plumbing', o.regulated ? 1 : 0).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, updated) VALUES (?1, 'c1', ?2, 1, '2026-10-01')").bind(LINE, o.biz || 'Quillen Plumbing').run();
  if (!o.unregistered) await DB.prepare("INSERT INTO sms_brands (client_id, messaging_sid, status) VALUES ('c1', ?1, 'approved')").bind('MG' + 'c'.repeat(32)).run();
  const link = await C.signupLink(env, 'c1');
  return { w, DB, env, link, code: link.split('/ok/')[1] };
}
const get = (x, path) => C.handleSignup(new Request(x.link + (path || '')), x.env, new URL(x.link + (path || '')), NOW);
function post(x, fields, ip) {
  const body = new URLSearchParams(Object.assign({ name: 'Jane Doe', phone: '(478) 555-2000', agree: 'yes', t: String(NOW - 20000), website: '' }, fields)).toString();
  return C.handleSignup(new Request(x.link, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip || '203.0.113.9', 'user-agent': 'Mozilla/5.0 (iPhone) test' } }), x.env, new URL(x.link), NOW);
}
const text = (x, from, body, n) => S.handleSms(null, x.env, new URLSearchParams({ MessageSid: sm(n || 1), From: from, To: LINE, Body: body }), true);
const rows = (x, sql, ...a) => x.DB.prepare(sql).bind(...a).all().then(r => r.results);

test('a customer signs up on the page, gets one text, and their YES makes them OK to contact', async () => {
  const x = await world();
  assert.match(x.link, /^https:\/\/alwaysopenoffice\.com\/ok\/[a-z2-9]{10}$/, 'a short, random link');
  assert.equal(await C.signupLink(x.env, 'c1'), x.link, 'the same link every time');
  const page = await get(x), h = await page.text();
  assert.equal(page.status, 200);
  assert.match(h, /<h1>Texts from Quillen Plumbing<\/h1>/);
  assert.ok(h.includes(C.pageWords('Quillen Plumbing').replace(/'/g, '&#39;')), 'the exact words are beside the box');
  assert.match(h, /<input type="checkbox" name="agree" value="yes" required>/, 'the box starts unticked');
  assert.match(h, /Or text <b>JOIN<\/b> to \(478\) 555-1001/);
  const r = await post(x), done = await r.text();
  assert.equal(r.status, 200);
  assert.match(done, /We just texted \(478\) 555-2000 from Quillen Plumbing \(\(478\) 555-1001\)\. Reply <b>YES<\/b>/);
  assert.equal(x.w.texts.length, 1, 'one text');
  assert.equal(x.w.texts[0].To, '+14785552000');
  assert.equal(x.w.texts[0].From, LINE, 'from the business’s own number');
  assert.equal(x.w.texts[0].MessagingServiceSid, 'MG' + 'c'.repeat(32), 'through the business’s own registered texting');
  assert.equal(x.w.texts[0].Body, C.askText('Quillen Plumbing'));
  assert.ok(C.askText('Quillen Plumbing').length <= 160, 'one segment for a usual name');
  assert.ok(/^[\x20-\x7e]+$/.test(C.askText('Quillen Plumbing')), 'plain characters only');
  const [c0] = await rows(x, "SELECT * FROM biz_consent WHERE client_id = 'c1'");
  assert.equal(c0.status, 'pending');
  assert.equal(c0.how, 'web');
  assert.equal(c0.name, 'Jane Doe');
  assert.equal(c0.phone10, '4785552000');
  assert.equal(c0.words, C.pageWords('Quillen Plumbing'), 'the words they saw are kept');
  assert.match(c0.words_v, /^[0-9a-f]{16}$/, 'with their fingerprint');
  assert.equal(c0.ip, '203.0.113.9');
  assert.equal(c0.ua, 'Mozilla/5.0 (iPhone) test');
  assert.match(c0.text_sid, /^SM/);
  assert.equal((await rows(x, "SELECT * FROM biz_customers WHERE client_id = 'c1' AND agreed = 1")).length, 0, 'nobody is OK to contact before the YES');

  const res = await text(x, '+14785552000', 'Yes!', 7), xml = await res.text();
  assert.match(xml, /<Message>Quillen Plumbing: you're signed up for our texts\. Reply STOP any time to end\.<\/Message>/);
  const [c1] = await rows(x, "SELECT * FROM biz_consent WHERE client_id = 'c1'");
  assert.equal(c1.status, 'confirmed');
  assert.equal(c1.confirm_sid, sm(7), 'the YES text’s id is kept');
  assert.ok(c1.confirmed_at);
  const [cu] = await rows(x, "SELECT * FROM biz_customers WHERE client_id = 'c1' AND phone10 = '4785552000'");
  assert.equal(cu.agreed, 1);
  assert.equal(cu.agreed_how, 'self');
  assert.equal(cu.name, 'Jane Doe');
  assert.equal(cu.phone, '(478) 555-2000');
  const [inbox] = await rows(x, "SELECT text, by FROM biz_msgs WHERE client_id = 'c1' AND dir = 'in'");
  assert.deepEqual(inbox, { text: 'Yes!', by: 'Signed up for texts' }, 'the owner sees it in the inbox');
  const st = await C.signupState(x.env, 'c1');
  assert.deepEqual(st, { url: x.link, ready: true, self: 1 }, 'the owner’s app: the link and one sign-up');
  // the owner's list
  const list = await (await P.apiImport(new Request('https://x/', { method: 'POST', body: JSON.stringify({ action: 'list' }) }), x.env, { client_id: 'c1', regulated: 0 })).json();
  assert.equal(list.signup.url, x.link);
  assert.equal(list.customers[0].self, true, 'marked as signed up themselves');
});

test('STOP ends it at once, and a YES later is not a new OK', async () => {
  const x = await world();
  await post(x);
  await text(x, '+14785552000', 'YES', 1);
  await text(x, '+14785552000', 'STOP', 2);
  const [c] = await rows(x, "SELECT status, ended_why FROM biz_consent WHERE client_id = 'c1'");
  assert.deepEqual(c, { status: 'revoked', ended_why: 'STOP' });
  const [cu] = await rows(x, "SELECT agreed, optout FROM biz_customers WHERE client_id = 'c1' AND phone10 = '4785552000'");
  assert.deepEqual(cu, { agreed: 0, optout: 1 });
  // after STOP, the page says how to come back and sends nothing
  const before = x.w.texts.length, r = await post(x), h = await r.text();
  assert.equal(r.status, 409);
  assert.match(h, /To turn texts back on, text <b>START<\/b> to \(478\) 555-1001/);
  assert.equal(x.w.texts.length, before);
});

test('JOIN by text, then YES; a second JOIN is told they are in', async () => {
  const x = await world();
  const a = await (await text(x, '+14785553000', 'Join', 1)).text();
  assert.ok(a.includes('<Message>' + C.askText('Quillen Plumbing').replace(/&/g, '&amp;') + '</Message>'));
  const [p] = await rows(x, "SELECT how, status, words FROM biz_consent WHERE phone10 = '4785553000'");
  assert.deepEqual(p, { how: 'keyword', status: 'pending', words: C.askText('Quillen Plumbing') }, 'the words of the text they answered are kept');
  const b = await (await text(x, '+14785553000', 'y', 2)).text();
  assert.match(b, /you're signed up/);
  const c = await (await text(x, '+14785553000', 'JOIN', 3)).text();
  assert.match(c, /You're already signed up for texts from Quillen Plumbing/);
  const [cu] = await rows(x, "SELECT agreed, agreed_how FROM biz_customers WHERE phone10 = '4785553000'");
  assert.deepEqual(cu, { agreed: 1, agreed_how: 'self' });
});

test('a YES with no sign-up waiting is not a sign-up, and an old sign-up text no longer counts', async () => {
  const x = await world();
  await text(x, '+14785554000', 'yes', 1);
  assert.equal((await rows(x, 'SELECT * FROM biz_consent')).length, 0);
  assert.equal((await rows(x, "SELECT * FROM biz_customers WHERE agreed = 1")).length, 0);
  // a sign-up text from three days ago
  await x.DB.prepare("INSERT INTO biz_consent (client_id, phone10, how, status, asked_at) VALUES ('c1', '4785554000', 'web', 'pending', ?1)").bind(new Date(Date.now() - 72 * 3600e3).toISOString()).run();
  await text(x, '+14785554000', 'yes', 2);
  assert.equal((await rows(x, "SELECT * FROM biz_customers WHERE agreed = 1")).length, 0, 'past 48 hours a YES confirms nothing');
});

test('the guards: bots, the box, the number, repeats and floods', async () => {
  const x = await world();
  const bad = async (f, status, re, ip) => { const r = await post(x, f, ip); assert.equal(r.status, status, JSON.stringify(f)); assert.match(await r.text(), re); };
  await bad({ website: 'http://spam' }, 400, /didn’t go through/);
  await bad({ t: String(NOW - 500) }, 400, /didn’t go through/);
  await bad({ t: String(NOW - 3 * 86400e3) }, 400, /didn’t go through/);
  await bad({ agree: '' }, 400, /Tick the box/);
  await bad({ name: '' }, 400, /type your name/);
  await bad({ phone: '555-12' }, 400, /10-digit US mobile/);
  await bad({ phone: '(111) 111-1111' }, 400, /10-digit US mobile/);
  await bad({ phone: LINE }, 400, /business’s own number/);
  assert.equal(x.w.texts.length, 0, 'none of those sent a text');
  // the second sign-up for the same number in a day sends nothing more
  await post(x, {}, '198.51.100.1');
  const r2 = await post(x, {}, '198.51.100.2');
  assert.match(await r2.text(), /We already texted \(478\) 555-2000/);
  assert.equal(x.w.texts.length, 1);
  // five an hour from one address
  for (let i = 0; i < 5; i++) await post(x, { phone: '(478) 555-21' + String(i).padStart(2, '0') }, '192.0.2.7');
  assert.equal(x.w.texts.length, 6);
  await bad({ phone: '(478) 555-2199' }, 429, /Too many sign-ups from here/, '192.0.2.7');
  assert.equal(x.w.texts.length, 6, 'the sixth from one address in an hour is refused');
});

test('links that don’t work: unknown, a regulated business, and one that can’t text yet', async () => {
  const x = await world();
  const u = 'https://alwaysopenoffice.com/ok/zzzzzzzzzz';
  assert.equal((await C.handleSignup(new Request(u), x.env, new URL(u), NOW)).status, 404);
  const u2 = x.link + '/nope';
  assert.equal((await C.handleSignup(new Request(u2), x.env, new URL(u2), NOW)).status, 404);
  const reg = await world({ regulated: true });
  assert.match(await (await get(reg)).text(), /can’t sign people up for texts here/);
  assert.equal((await post(reg)).status, 200);
  assert.equal(reg.w.texts.length, 0, 'a regulated business sends nothing');
  assert.equal((await C.signupState(reg.env, 'c1')).ready, false);
  const un = await world({ unregistered: true });
  assert.match(await (await get(un)).text(), /aren’t switched on yet/);
  await post(un);
  assert.equal(un.w.texts.length, 0);
  assert.deepEqual(await C.signupState(un.env, 'c1'), { url: '', ready: false, self: 0 }, 'the owner sees no link until texting works');
  // JOIN to a business whose texting isn't registered is just a text for the owner
  await text(un, '+14785555000', 'JOIN', 1);
  assert.equal((await rows(un, 'SELECT * FROM biz_consent')).length, 0);
});

test('the QR code to print', async () => {
  const x = await world();
  const r = await get(x, '/qr.svg');
  assert.equal(r.headers.get('content-type'), 'image/svg+xml');
  assert.match(await r.text(), /^<svg/);
});

test('removing customers: one ends their sign-up; "remove all imported" keeps the ones who signed up themselves', async () => {
  const x = await world();
  await post(x);
  await text(x, '+14785552000', 'YES', 1);
  await x.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone10, agreed, source, opt_token) VALUES ('c1', '4785559000', 'Imported Ike', '4785559000', 0, 'import', 'tok1')").run();
  const api = b => P.apiImport(new Request('https://x/', { method: 'POST', body: JSON.stringify(b) }), x.env, { client_id: 'c1', regulated: 0 }).then(r => r.json());
  assert.equal((await api({ action: 'wipe', confirm: true })).ok, true);
  const left = await rows(x, "SELECT name, agreed_how FROM biz_customers WHERE client_id = 'c1'");
  assert.deepEqual(left, [{ name: 'Jane Doe', agreed_how: 'self' }], 'the import went, the sign-up stayed');
  const [cu] = await rows(x, "SELECT id FROM biz_customers WHERE client_id = 'c1'");
  assert.equal((await api({ action: 'forget', id: cu.id })).ok, true);
  const [c] = await rows(x, "SELECT status, ended_why FROM biz_consent WHERE client_id = 'c1'");
  assert.deepEqual(c, { status: 'revoked', ended_why: 'removed by the business' }, 'the record stays, marked ended');
  // the owner marking someone OK is recorded as the owner's OK
  await x.DB.prepare("INSERT INTO biz_customers (client_id, ckey, name, phone10, agreed, source, opt_token) VALUES ('c1', '4785559001', 'Owner Olive', '4785559001', 0, 'import', 'tok2')").run();
  const [o] = await rows(x, "SELECT id FROM biz_customers WHERE name = 'Owner Olive'");
  await api({ action: 'agree', id: o.id });
  const [oo] = await rows(x, "SELECT agreed, agreed_how FROM biz_customers WHERE id = ?1", o.id);
  assert.deepEqual(oo, { agreed: 1, agreed_how: 'owner' });
});
