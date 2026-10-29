// Phone pushes when ntfy refuses this server (its free tier is limited per address, and Workers share addresses):
// the push waits, the Mac relay carries it, the cron retries, important ones become one text in the day, and the
// hourly check only complains when nothing is getting through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const P = await import('../src/push.js');

const NTFY = 'https://ntfy.example.test/topic';
const envFor = extra => Object.assign({ DB: H.makeDB(), NTFY_URL: NTFY, OPS_TEXT_TO: '+14785550188' }, extra || {});
const ntfyAnswering = (status, log) => async (url, init) => { if (log) log.push({ url: String(url), title: init.headers.Title, body: init.body }); return new Response('', { status }); };
const queueRow = async (env, at, title, priority, status) => { await P.ensurePush(env); return env.DB.prepare("INSERT INTO push_queue (at, title, body, priority, tags, click, status, why) VALUES (?1, ?2, 'b', ?3, '', '', ?4, 'ntfy answered 429')").bind(new Date(at).toISOString(), title, priority, status || 'queued').run(); };
const rows = async env => ((await env.DB.prepare('SELECT id, title, status, via FROM push_queue ORDER BY id').all()).results);

test('a push ntfy takes goes straight through; one it refuses waits, with the reason', async () => {
  const env = envFor(), sent = [];
  assert.equal(await P.push(env, { title: 'Always Open lead: Sinclair Plumbing — new', body: 'Dana', priority: 'high', tags: 'telephone_receiver' }, { fetch: ntfyAnswering(200, sent) }), 'sent');
  assert.equal(sent[0].title, 'Always Open lead: Sinclair Plumbing - new', 'the title header is plain ASCII');
  assert.equal((await rows(env)).length, 0);
  for (const st of [429, 522]) assert.equal(await P.push(env, { title: 'Refused ' + st, body: 'x' }, { fetch: ntfyAnswering(st) }), 'queued');
  assert.equal(await P.push(env, { title: 'No answer', body: 'x' }, { fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } }), 'queued');
  const q = (await env.DB.prepare('SELECT why FROM push_queue ORDER BY id').all()).results.map(r => r.why);
  assert.deepEqual(q, ['ntfy answered 429', 'ntfy answered 522', 'ntfy did not answer in time']);
  assert.equal(await P.push({ DB: env.DB }, { title: 'x' }), 'off', 'no topic set: nothing to do');
});

test('the Mac relay takes waiting pushes, a lease brings back any it never confirms, and done is done', async () => {
  const env = envFor(), now = Date.parse('2026-10-29T15:00:00Z');
  await queueRow(env, now - 60e3, 'One', 'high'); await queueRow(env, now - 30e3, 'Two', 'default');
  let t = await P.relayTake(env, now);
  assert.deepEqual(t.items.map(i => i.title), ['One', 'Two']);
  assert.deepEqual((await P.relayTake(env, now + 60e3)).items, [], 'handed out once');
  assert.deepEqual((await P.relayDone(env, { done: [t.items[0].id], failed: [t.items[1].id] }, now + 90e3)), { ok: true, done: 1, failed: 1 });
  t = await P.relayTake(env, now + 120e3);
  assert.deepEqual(t.items.map(i => i.title), ['Two'], 'the one the Mac could not send comes back');
  assert.deepEqual((await P.relayTake(env, now + 120e3 + 6 * 60e3)).items.map(i => i.title), ['Two'], 'never confirmed: back after the lease');
  assert.deepEqual((await rows(env)).map(r => [r.title, r.status, r.via]), [['One', 'done', 'mac'], ['Two', 'out', '']]);
});

test('the cron: ntfy again first, then one text for important ones (daytime only), and a day-old push is dropped', async () => {
  const env = envFor(), day = Date.parse('2026-10-29T15:00:00Z'), night = Date.parse('2026-10-30T04:00:00Z');   // 11 AM and midnight Eastern
  await queueRow(env, day - 12 * 60e3, 'Always Open problem: health:twilio-numbers', 'high');
  await queueRow(env, day - 11 * 60e3, 'Always Open lead: Oak Street Dental', 'high');
  await queueRow(env, day - 12 * 60e3, 'Rate-Shock Radar: complaints rising', 'default');
  await queueRow(env, day - 2 * 60e3, 'Always Open lead: just now', 'high');
  const texts = [];
  // still refused, 11 AM: the two important ones over 10 minutes old go as one text
  let r = await P.pushCron(env, day, { fetch: ntfyAnswering(429), text: async b => { texts.push(b); return { ok: true }; } });
  assert.deepEqual(r, { waiting: 2, sent: 0, texted: 2, dropped: 0 });
  assert.equal(texts.length, 1, 'one text, not one per alert');
  assert.match(texts[0], /^Always Open: 2 alerts didn’t reach your phone app\.\nAlways Open problem: health:twilio-numbers: b\nAlways Open lead: Oak Street Dental: b$/);
  // ntfy works again: the rest go straight out
  const sent = [];
  r = await P.pushCron(env, day + 10 * 60e3, { fetch: ntfyAnswering(200, sent), text: async () => { throw new Error('no text needed'); } });
  assert.deepEqual(r, { waiting: 0, sent: 2, texted: 0, dropped: 0 });
  assert.deepEqual((await rows(env)).map(x => x.via), ['text', 'text', 'direct', 'direct']);
  // at night an important one waits for morning; a day-old one is dropped
  const env2 = envFor();
  await queueRow(env2, night - 30 * 60e3, 'Always Open lead: late', 'high');
  await queueRow(env2, night - 25 * 3600e3, 'Storm Desk: old', 'high');
  r = await P.pushCron(env2, night, { fetch: ntfyAnswering(522), text: async b => { texts.push(b); return { ok: true }; } });
  assert.equal(texts.length, 1, 'no text between 9 PM and 8 AM');
  assert.equal(r.dropped, 1);
  assert.deepEqual((await rows(env2)).map(x => [x.title, x.status]), [['Always Open lead: late', 'queued'], ['Storm Desk: old', 'dropped']]);
  // no number to text: nothing texted, nothing lost
  const env3 = envFor({ OPS_TEXT_TO: '' });
  await queueRow(env3, day - 20 * 60e3, 'Always Open lead: x', 'high');
  r = await P.pushCron(env3, day, { fetch: ntfyAnswering(429), text: async () => ({ ok: true }) });
  assert.equal(r.texted, 0); assert.equal(r.waiting, 1);
});

test('the hourly check: fine when nothing is stuck; not fine when pushes are stuck or the relay has gone quiet', async () => {
  const env = envFor(), now = Date.parse('2026-10-29T15:00:00Z');
  assert.deepEqual(await P.pushHealth(env, now), { ok: true, why: '' }, 'a fresh start is not a failure');
  await P.push(env, { title: 'x' }, { fetch: ntfyAnswering(429) });
  let h = await P.pushHealth(env, now);
  assert.equal(h.ok, false); assert.match(h.why, /ntfy is refusing this server and the Gates HQ agent on the Mac has not asked for pushes yet/);
  await P.relayTake(env, now - 5 * 60e3);
  await env.DB.prepare("UPDATE push_queue SET status = 'done'").run();
  assert.equal((await P.pushHealth(env, now)).ok, true, 'the relay is carrying them');
  await queueRow(env, now - 20 * 60e3, 'Stuck one', 'high');
  h = await P.pushHealth(env, now);
  assert.equal(h.ok, false); assert.match(h.why, /^1 push to your phone is stuck: ntfy is refusing this server \(ntfy answered 429\) and the Mac relay last checked in 5 minutes ago/);
  assert.equal((await P.pushHealth({ DB: env.DB }, now)).ok, false, 'no topic at all');
});

test('/ops/push-queue: only with the key; the Mac takes and reports', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  await P.ensurePush(env);
  await queueRow(env, Date.now() - 60e3, 'Always Open lead: Test', 'high');
  assert.equal((await site.call('/ops/push-queue')).status, 403);
  assert.equal((await site.call('/ops/push-queue', { headers: { 'x-key': 'nope' } })).status, 403);
  const t = (await site.call('/ops/push-queue', { headers: { 'x-key': env.LEADS_KEY } })).json();
  assert.deepEqual(t.items.map(i => [i.title, i.priority]), [['Always Open lead: Test', 'high']]);
  const d = (await site.call('/ops/push-queue', { headers: { 'x-key': env.LEADS_KEY }, json: { done: [t.items[0].id] } })).json();
  assert.equal(d.done, 1);
  assert.equal((await DB.prepare("SELECT via FROM push_queue").first()).via, 'mac');
});

test('a paid ntfy account: the token goes with every push; a token ntfy turns down is dropped at once and reported', async () => {
  const env = envFor({ NTFY_TOKEN: 'tk_example' }), seen = [];
  const answer = status => async (url, init) => { seen.push(init.headers.Authorization || ''); return new Response('', { status: init.headers.Authorization ? status : 200 }); };
  assert.equal(await P.push(env, { title: 'With the token' }, { fetch: answer(200), now: Date.parse('2026-10-29T15:00:00Z') }), 'sent');
  assert.deepEqual(seen, ['Bearer tk_example']);
  assert.equal((await P.pushHealth(env, Date.now())).ok, true);
  seen.length = 0;
  assert.equal(await P.push(env, { title: 'Token revoked' }, { fetch: answer(403), now: Date.parse('2026-10-29T15:00:00Z') }), 'sent', 'still delivered, without the token');
  assert.deepEqual(seen, ['Bearer tk_example', '']);
  const h = await P.pushHealth(env, Date.now());
  assert.equal(h.ok, false); assert.match(h.why, /ntfy turned down the account token \(refused 403\)/);
  assert.deepEqual(await P.push(envFor(), { title: 'No token' }, { fetch: async (u, i) => { seen.push(i.headers.Authorization || 'none'); return new Response(''); } }), 'sent');
  assert.equal(seen.pop(), 'none', 'no token set: exactly as before');
});
