// Mail into the Worker (src/mailin.js): everything is forwarded first; a Google review email becomes a draft in the owner's
// app (owner's voice for regular clients, approved wording only for regulated ones); a rate wave pushes once a week;
// a lead's reply stops their follow-ups; insurance clients get season-calendar posts; and nothing runs twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const M = await import('../src/mailin.js');

async function seeded() {
  const db = makeDB();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, owner_first, phone, active, tier) VALUES ('c1', 'h1', 'Sinclair Plumbing, LLC', 'Sam', '+14785551234', 1, 'Growth')").run();
  await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, phone, active, regulated, tier) VALUES ('c2', 'h2', 'Gates Insurance Agency', '+14785550142', 1, 1, 'Pro')").run();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES ('+14785550101', 'c2', 'Gates Insurance Agency', 1, 'insurance', 'Eatonton', '2026-10-01T00:00:00Z')").run();
  return db;
}
const pings = [];
const ping = async (env, title, body, pr) => { pings.push({ title, body, pr }); };
const g = (subject, text) => ({ from: 'businessprofile-noreply@google.com', subject, auth: 'mx.cloudflare.net; dkim=pass header.d=google.com; dmarc=pass header.from=google.com', text });

test('reading a raw email: headers, quoted-printable, base64 and HTML parts', () => {
  const raw = 'From: "Google Business Profile" <businessprofile-noreply@google.com>\r\nSubject: =?UTF-8?Q?New_review_for_Sinclair_Plumbing?=\r\nAuthentication-Results: mx.cloudflare.net;\r\n\tdkim=pass header.d=google.com header.s=20260707;\r\n\tdmarc=pass header.from=google.com policy.dmarc=reject;\r\n\tspf=pass smtp.mailfrom=google.com\r\n' +
    'Content-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nDana R. left a 5=E2=98=85 review=\r\n: Fixed our leak fast.\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>x</p>\r\n--b1--\r\n';
  const m = M.readEmail(raw);
  assert.equal(m.from, 'businessprofile-noreply@google.com');
  assert.equal(m.subject, 'New review for Sinclair Plumbing');
  assert.match(m.text, /Dana R\. left a 5★ review: Fixed our leak fast\./);
  assert.equal(M.fromGoogle(m), true);
  const b64 = M.readEmail('From: x@google.com\r\nSubject: Your review\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n' + btoa('<div>Hello&nbsp;there</div><style>a{}</style>'));
  assert.equal(b64.text, 'Hello there');
});

test('only real Google mail counts: lookalike domains and failed signatures are ignored', () => {
  assert.equal(M.fromGoogle({ from: 'reviews@google.com.evil.io', subject: 'New review', auth: '', text: '' }), false);
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', subject: 'New review', auth: 'dkim=fail; dmarc=fail', text: '' }), false);
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', subject: 'Your verification', auth: 'mx.cloudflare.net; dmarc=pass header.from=google.com', text: 'Submit a new video.' }), false);
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', subject: 'New review', auth: '', text: '' }), false, 'no result from Cloudflare: not trusted');
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', subject: 'New review', auth: 'mx.cloudflare.net; dmarc=pass header.from=google.com.evil.io', text: '' }), false);
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', subject: 'New review', auth: 'mx.evil.io; dmarc=pass header.from=google.com', text: '' }), false, 'someone else’s result');
  assert.equal(M.fromGoogle({ from: 'noreply@google.com', froms: 2, subject: 'New review', auth: 'mx.cloudflare.net; dmarc=pass header.from=google.com', text: '' }), false, 'two From lines');
  // A forger adds their own "pass" lower down; Cloudflare's own result sits on top and says fail.
  const forged = M.readEmail('Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=fail header.from=google.com policy.dmarc=reject\r\nFrom: <businessprofile-noreply@google.com>\r\nAuthentication-Results: mx.cloudflare.net; dmarc=pass header.from=google.com\r\nSubject: New review for Sinclair Plumbing\r\n\r\nDana left a review');
  assert.equal(M.googleAuth(forged), 'dmarc did not pass');
  const two = M.readEmail('Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=google.com\r\nFrom: <evil@example.com>\r\nFrom: <businessprofile-noreply@google.com>\r\nSubject: New review\r\n\r\nx');
  assert.equal(M.fromGoogle(two), false);
});

test('a forged review email drafts nothing and tells Christopher once a day; an out-of-office reply does not stop follow-ups', async () => {
  const db = await seeded(); const env = { DB: db, MAIL_TO: 'owner@example.com' }; pings.length = 0;
  for (const col of ['stop', 'stop_at']) { try { await db.prepare('ALTER TABLE leads ADD COLUMN ' + col + ' TEXT').run(); } catch (e) {} }
  await db.prepare("INSERT INTO leads (at, email, stop) VALUES ('2026-11-01T00:00:00Z', 'sam@example.com', '')").run();
  const msg = raw => ({ rawSize: raw.length, raw: new Response(raw).body, forward: async () => {} });
  const fake = 'From: <businessprofile-noreply@google.com>\r\nSubject: New review for Sinclair Plumbing\r\n\r\nDana left a 1-star review';
  const r = await M.inbound(msg(fake), env, {}, { ping });
  assert.equal(r.skipped, 'unverified: no cloudflare result');
  await M.inbound(msg(fake), env, {}, { ping });
  assert.equal(pings.filter(p => /was not trusted/.test(p.title)).length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM app_items').first()).n, 0);
  const ooo = await M.inbound(msg('From: Sam <sam@example.com>\r\nAuto-Submitted: auto-replied\r\nSubject: Out of office\r\n\r\nAway until Monday'), env, {});
  assert.equal(ooo.skipped, 'auto-reply');
  assert.equal((await db.prepare("SELECT stop FROM leads WHERE email = 'sam@example.com'").first()).stop, '');
});

test('a regular client: the review becomes a draft in the owner’s voice, once, and a low rating pushes', async () => {
  const db = await seeded(); const env = { DB: db }; pings.length = 0;
  const rv = { business: 'Sinclair Plumbing', reviewer: 'Dana Ruiz', stars: 2, text: 'Showed up late and left a mess.', lang: 'en', otherBusiness: false };
  const h = { review: rv, draft: 'Dana, we are sorry the visit fell short. Please call us at 478-555-1234 so we can make it right. — Sam', ping, now: Date.parse('2026-11-04T15:00:00Z') };
  const r = await M.reviewFromEmail(env, g('New review', ''), h);
  assert.ok(r.drafted && r.drafted.startsWith('m:'), JSON.stringify(r));
  const it = await db.prepare("SELECT client_id, kind, title, stars, status, checked, context FROM app_items WHERE id = ?1").bind(r.drafted).first();
  assert.deepEqual({ ...it }, { client_id: 'c1', kind: 'reply', title: 'Dana R.', stars: 2, status: 'pending', checked: 0, context: 'Showed up late and left a mess.' });
  assert.ok(pings.some(p => /2-star review for Sinclair Plumbing/.test(p.title) && p.pr === 'high'));
  assert.equal((await M.reviewFromEmail(env, g('New review', ''), h)).skipped, 'already drafted', 'the same email twice drafts once');
});

test('a draft that fails Compliance Guard is not put in front of the owner; Christopher is told', async () => {
  const db = await seeded(); const env = { DB: db }; pings.length = 0;
  const rv = { business: 'Sinclair Plumbing', reviewer: 'Jo', stars: 5, text: 'Great!', lang: 'en' };
  const r = await M.reviewFromEmail(env, g('New review', ''), { review: rv, draft: 'Thanks Jo! Leave us another review and get 10% off next time.', ping, now: Date.now() });
  assert.equal(r.skipped, 'no draft');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM app_items").first()).n, 0);
  assert.ok(pings.some(p => /needs a reply written/.test(p.title)));
});

test('a regulated client gets the approved wording only, picked by the first rule that fits, in the review’s language', async () => {
  const db = await seeded(); const env = { DB: db }; pings.length = 0;
  const now = Date.parse('2026-11-04T15:00:00Z');
  const a = await M.reviewFromEmail(env, g('New review', ''), { review: { business: 'Gates Insurance Agency', reviewer: 'R. Patel', stars: 1, text: 'My rates went up again and nobody called back.', lang: 'en' }, ping, now });
  assert.equal(a.key, 'rate');
  const it = await db.prepare("SELECT text, checked FROM app_items WHERE id = ?1").bind(a.drafted).first();
  assert.equal(it.text, 'Thank you for taking the time to share this. We understand your frustration and would welcome the chance to talk with you. Please contact our office directly at 478-555-0142.', 'an initial is not used as a name');
  assert.equal(it.checked, 1);
  const b = await M.reviewFromEmail(env, g('New review', ''), { review: { business: 'Gates Insurance Agency', reviewer: '', stars: 5, text: '', lang: 'es' }, ping, now: now + 1000 });
  assert.equal(b.key, 's5_none');
  assert.equal((await db.prepare("SELECT text FROM app_items WHERE id = ?1").bind(b.drafted).first()).text, 'Gracias por las 5 estrellas. Se lo agradecemos.');
  // a second review about rates in the same week is a wave: one push, not two
  pings.length = 0;
  await M.reviewFromEmail(env, g('New review', ''), { review: { business: 'Gates Insurance Agency', reviewer: 'Lee M', stars: 2, text: 'Premium increase with no warning.', lang: 'en' }, ping, now: now + 2000 });
  await M.reviewFromEmail(env, g('New review', ''), { review: { business: 'Gates Insurance Agency', reviewer: 'Ann K', stars: 1, text: 'The price went up 30%.', lang: 'en' }, ping, now: now + 3000 });
  assert.equal(pings.filter(p => /Rate-increase wave/.test(p.title)).length, 1);
});

test('the approved wording fits every case cleanly', () => {
  assert.equal(M.libraryKey({ text: 'The adjuster never called about my claim', stars: 5 }), 'claim');
  assert.equal(M.libraryKey({ text: 'Great people', stars: 4 }), 's4');
  assert.equal(M.libraryKey({ text: 'Great people', stars: 5 }), 's5_text');
  assert.equal(M.libraryKey({ text: '', stars: 0 }), 'low');
  assert.equal(M.libraryKey({ text: 'Best tacos in town', stars: 5, otherBusiness: true }), 'wrong');
  assert.equal(M.libraryKey({ text: 'Great rates and Jane is so helpful', stars: 5 }), 's5_text', 'a happy review about rates is thanked, not met with "we understand your frustration"');
  assert.equal(M.libraryKey({ text: 'Good prices', stars: 4 }), 's4');
  assert.equal(M.libraryKey({ text: 'My premium went up again', stars: 2 }), 'rate');
  assert.equal(M.libraryKey({ text: 'My premium went up again', stars: 0 }), 'rate');
  assert.equal(M.libraryText('wrong', 'en', 'Ann', '4785550142'), 'Thank you for taking the time to write, Ann. From the details, this review may have been meant for another business. If you would like to talk with us, please contact our office directly at 478-555-0142.', 'the approved wording from HQ, word for word');
  assert.equal(M.libraryText('low', 'en', '', ''), 'We take all feedback seriously and would like to hear more. Please contact our office directly.');
  assert.equal(M.libraryText('claim', 'en', 'Ann', '(478) 555-0142'), 'Thank you for reaching out, Ann. To protect everyone\'s privacy we don\'t discuss details here, but we would like to hear from you. Please contact our office directly at 478-555-0142.');
  for (const k of Object.keys(M.REPLY_LIBRARY)) for (const lang of ['en', 'es']) {
    const t = M.libraryText(k, lang, '', '');
    assert.doesNotMatch(t, /\{|\}|\s,|,\s*\.|\.\./, k + ' ' + lang + ': ' + t);
  }
});

test('an unknown business drafts nothing and says so; a lead’s reply stops follow-ups', async () => {
  const db = await seeded(); const env = { DB: db }; pings.length = 0;
  assert.equal((await M.reviewFromEmail(env, g('New review', ''), { review: { business: 'Someone Else LLC', reviewer: 'A', stars: 5, text: '' }, ping })).skipped, 'unknown business');
  assert.ok(pings.some(p => /unknown business/.test(p.title)));
  for (const col of ['stop', 'stop_at']) { try { await db.prepare('ALTER TABLE leads ADD COLUMN ' + col + ' TEXT').run(); } catch (e) {} }
  await db.prepare("INSERT INTO leads (at, email, stop) VALUES ('2026-11-01T00:00:00Z', 'Sam@Example.com', '')").run();
  assert.equal(await M.leadReplied(env, 'sam@example.com'), 1);
  assert.equal((await db.prepare("SELECT stop FROM leads WHERE lower(email) = 'sam@example.com'").first()).stop, 'replied');
  assert.equal(await M.leadReplied(env, 'sam@example.com'), 0, 'already stopped');
});

test('the email handler forwards every message first, even one it cannot read', async () => {
  const db = await seeded(); const env = { DB: db, MAIL_TO: 'owner@example.com' };
  const fwd = [];
  const msg = (raw) => ({ rawSize: raw.length, raw: new Response(raw).body, forward: async to => { fwd.push(to); } });
  const r = await M.inbound(msg('From: friend@example.com\r\nSubject: hi\r\n\r\nhello'), env, {});
  assert.deepEqual(fwd, ['owner@example.com']);
  assert.equal(r.forwarded, 'ok');
  const big = { rawSize: 5e6, raw: new Response('x').body, forward: async to => { fwd.push(to); } };
  assert.equal((await M.inbound(big, env, {})).forwarded, 'ok');
  assert.equal(fwd.length, 2);
});

test('season-calendar posts: insurance clients only, about every two weeks, this month’s topics only, once a day', async () => {
  const db = await seeded(); const env = { DB: db };
  const d1 = Date.parse('2026-11-04T15:00:00Z');
  assert.deepEqual(await M.seasonPosts(env, d1), { made: 1 });
  assert.deepEqual(await M.seasonPosts(env, d1 + 3600e3), { skipped: 'done today' });
  assert.deepEqual(await M.seasonPosts(env, d1 + 8 * 864e5), { made: 0 }, 'not again within two weeks');
  assert.deepEqual(await M.seasonPosts(env, d1 + 14 * 864e5), { made: 1 });
  const posts = (await db.prepare("SELECT client_id, title, checked, context FROM app_items WHERE kind = 'post' ORDER BY created").all()).results;
  assert.equal(posts.length, 2);
  assert.ok(posts.every(p => p.client_id === 'c2' && p.checked === 1 && p.context === 'From the season calendar'));
  assert.notEqual(posts[0].title, posts[1].title);
  assert.equal(M.POST_CALENDAR.length, 24);
  assert.equal(M.nextCalendarPost([[11, 'A', 'a'], [12, 'B', 'b']], 11, ['A']), null, 'a used month waits for next month, never takes December’s');
  assert.deepEqual(await M.seasonPosts(env, d1 + 26 * 864e5), { made: 0 }, 'Nov 30: both November posts are used, December’s wait for December');
  // a whole year, week by week: never more than two a month, and each in its own month
  const db2 = await seeded(); const env2 = { DB: db2 };
  for (let t = Date.parse('2026-01-05T15:00:00Z'); t < Date.parse('2026-12-31T15:00:00Z'); t += 7 * 864e5) await M.seasonPosts(env2, t);
  const all = (await db2.prepare("SELECT title, created FROM app_items WHERE kind = 'post'").all()).results;
  assert.equal(all.length, 24);
  for (const p of all) { const m = +p.created.slice(5, 7); assert.ok(M.POST_CALENDAR.some(x => x[0] === m && x[1] === p.title), p.title + ' in month ' + m); }
});
