// Review requests for Always Open itself: every client a month in, whatever kind of month they had (no review gating),
// once, three a day at most, in their 10 AM hour, with their own month's numbers; email when the text can't go; a tap is
// counted; a reply reaches Christopher, loudly when it reads like a complaint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDB } from './rehearsal/harness.js';
import { candidates, askCron, tap, onReply, monthWords, askText, asksLine } from '../src/ourreviews.js';

const DAY = 864e5;
const now = Date.parse('2026-11-12T15:20:00Z');   // 10:20 AM Eastern (standard time)
async function seeded() {
  const db = makeDB(); const env = { DB: db, ALWAYS_OPEN_REVIEW_LINK: 'https://g.page/r/always-open/review' };
  await db.prepare('CREATE TABLE IF NOT EXISTS ops_alerts (type TEXT PRIMARY KEY, at INTEGER, n INTEGER, prev INTEGER DEFAULT 0)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS connection_health (client_id TEXT, kind TEXT, broken_at TEXT, why TEXT, checked_at TEXT, told_at TEXT, PRIMARY KEY (client_id, kind))').run();
  const client = async (id, days, extra) => {
    const e = Object.assign({ status: 'active', phone: '(478) 555-01' + String(10 + id.length), email: id + '@example.test', approved: 6 }, extra || {});
    await db.prepare("INSERT INTO app_clients (client_id, code_hash, business, owner_first, active) VALUES (?1, ?2, ?3, ?4, 1)").bind(id, 'h-' + id, id.toUpperCase() + ' Co.', 'Sam').run();
    await db.prepare('INSERT INTO billing (client_id, session_id, status, owner, email, phone, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(id, 's-' + id, e.status, 'Sam Lee', e.email, e.phone, new Date(now - days * DAY).toISOString()).run();
    for (let i = 0; i < e.approved; i++) await db.prepare("INSERT INTO app_items (id, client_id, kind, status, created, decided_at) VALUES (?1, ?2, 'reply', 'approved', ?3, ?3)").bind(id + i, id, new Date(now - 5 * DAY).toISOString()).run();
  };
  await client('good', 35);
  await client('early', 12);
  await client('late', 60);
  await client('quiet', 35, { approved: 2 });
  await client('pastdue', 35, { status: 'past_due' });
  await client('alerted', 35); await db.prepare("INSERT INTO ops_alerts (type, at, n) VALUES ('quiet-line:alerted', ?1, 1)").bind(now - 2 * DAY).run();
  await client('broken', 35); await db.prepare("INSERT INTO connection_health (client_id, kind, broken_at) VALUES ('broken', 'profile', '2026-11-01')").run();
  await client('stopped', 35, { phone: '(478) 555-0199', email: '' }); await db.prepare("INSERT INTO sms_optout (client_id, phone10, at) VALUES ('always-open', '4785550199', '2026-11-01')").run();
  for (let i = 0; i < 4; i++) await db.prepare("INSERT INTO app_calls (id, client_id, number, at, outcome, test) VALUES (?1, 'good', '+14785550100', ?2, 'done', 0)").bind('CA' + i, new Date(now - 10 * DAY).toISOString()).run();
  return env;
}

test('every client a month in is asked, whatever kind of month they had; every other one says why not', async () => {
  const env = await seeded();
  await env.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('gone', 'h-gone', 'Gone Co.', 1)").run();
  await env.DB.prepare("INSERT INTO billing (client_id, session_id, status, email, created) VALUES ('gone', 's-gone', 'canceled', 'gone@example.test', ?1)").bind(new Date(now - 35 * DAY).toISOString()).run();
  const { out, skipped } = await candidates(env, now);
  assert.deepEqual(out.map(c => c.client_id).sort(), ['alerted', 'broken', 'good', 'pastdue', 'quiet'], 'few approvals, an alert, a broken connection or a late bill never decide who is asked');
  const why = Object.fromEntries(skipped.map(s => [s.client_id, s.why]));
  assert.deepEqual(why, { early: 'not 30 to 45 days in', late: 'not 30 to 45 days in', stopped: 'opted out of our texts', gone: 'billing is canceled' });
});

test('one text in their 10 AM hour, with their own numbers and a counted link; never twice; email when the text cannot go', async () => {
  const env = await seeded();
  const texts = [], mails = [];
  const h = { send: async o => { texts.push(o); return { ok: true }; }, mail: async (to, s, t) => { mails.push({ to, t }); return 'sent'; } };
  assert.deepEqual(await askCron(env, now - 2 * 3600e3, h), { asked: 0 }, '8 AM is too early');
  assert.deepEqual(await askCron(env, now, h), { asked: 3 }, 'three a day at most');
  assert.equal(texts.length, 3);
  const good = texts.find(x => x.to === '4785550114');
  assert.ok(good, 'the good client is among the first three');
  assert.match(good.body, /^Hi Sam, it’s the Always Open team\. A month in: Max has taken 4 calls for you and 6 reviews got answered\. Would you leave an honest Google review of us\? It helps other owners decide: https:\/\/alwaysopenoffice\.com\/r\/[A-Za-z0-9]{16} Questions or anything to change, just reply here\.$/);
  assert.doesNotMatch(texts.map(x => x.body).join(' '), /Christopher|If it has helped/);
  assert.deepEqual(await askCron(env, now + 20 * 60e3, h), { skipped: 'three today already' });
  assert.deepEqual(await askCron(env, now + DAY, h), { asked: 2 }, 'the other two the next day');
  assert.deepEqual(await askCron(env, now + 2 * DAY, h), { asked: 0 }, 'once only');
  const token = good.body.match(/\/r\/([A-Za-z0-9]{16})/)[1];
  assert.equal(await tap(env, token, now + 3600e3), 'good');
  assert.equal(await tap(env, 'x'.repeat(16)), null);
  assert.equal(await asksLine(env, now + 3600e3), '5 asks sent this month, 1 tapped');

  const env2 = await seeded();
  const h2 = { send: async () => ({ ok: false, why: 'texting not registered for this business' }), mail: h.mail };
  assert.deepEqual(await askCron(env2, now, h2), { asked: 3 });
  assert.equal(mails.length, 3); assert.ok(mails.some(m => m.to === 'good@example.test'));
  assert.match(mails[0].t, /Questions or anything to change, just reply to this email\.$/);
  assert.deepEqual(await askCron({ DB: env2.DB }, now, h2), { skipped: 'no review link set' });
});

test('three a day at most across everyone', async () => {
  const env = await seeded();
  for (const id of ['b1', 'b2', 'b3', 'b4']) {
    await env.DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES (?1, ?2, ?3, 1)").bind(id, 'h' + id, id).run();
    await env.DB.prepare("INSERT INTO billing (client_id, session_id, status, email, created) VALUES (?1, ?2, 'active', ?3, ?4)").bind(id, 's' + id, id + '@x.test', new Date(now - 33 * DAY).toISOString()).run();
    for (let i = 0; i < 5; i++) await env.DB.prepare("INSERT INTO app_items (id, client_id, kind, status, created) VALUES (?1, ?2, 'post', 'approved', ?3)").bind(id + i, id, new Date(now).toISOString()).run();
  }
  const h = { send: async () => ({ ok: true }), mail: async () => 'sent' };
  assert.deepEqual(await askCron(env, now, h), { asked: 3 });
  assert.deepEqual(await askCron(env, now + 600e3, h), { skipped: 'three today already' });
});

test('a reply reaches Christopher, at high priority when it reads like a complaint; the words for a quiet month', async () => {
  const env = await seeded();
  await askCron(env, now, { send: async () => ({ ok: true }) });
  const pings = [];
  const ping = async (t, b, pr) => pings.push({ t, b, pr });
  assert.equal(await onReply(env, '4785550114', 'Happy to! Done.', ping, now + 3600e3), 'reply');
  assert.equal(await onReply(env, '4785550114', 'Honestly the calls are not working for us.', ping, now + 7200e3), 'complaint');
  assert.deepEqual(pings.map(p => [p.t, p.pr]), [['Sam at GOOD Co. replied to the review ask', 'default'], ['Sam at GOOD Co. replied to the review ask', 'high']]);
  assert.equal(await onReply(env, '4785550000', 'Who is this?', ping, now), false, 'anyone else goes to the inbox as usual');
  assert.equal((await monthWords(env, 'early', new Date(now - 30 * DAY).toISOString())).text, '6 reviews got answered');
  assert.equal(askText({ first: '' }, '', 'L', true), 'Hi there, it’s the Always Open team. A few months in. Would you leave an honest Google review of us? It helps other owners decide: L Questions or anything to change, just reply here.');
});
