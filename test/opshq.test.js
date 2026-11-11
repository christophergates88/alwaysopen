// Always Open HQ on the site (Nov 11, 2026): the page reads the site's own tables, so a client's message, a new request,
// a client and a call each show the moment they exist, and an answer typed here lands in the client's app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const B = await import('../src/opsboard.js');
const Q = await import('../src/opshq.js');
const { AUTO_BY } = await import('../src/checks.js');
const { makeDB } = await import('./rehearsal/harness.js');

const NOW = Date.parse('2026-11-11T17:00:00Z');   // noon Eastern, a Wednesday
const iso = ms => new Date(ms).toISOString();
const H = 3600e3;
async function world() {
  const DB = makeDB(), env = { DB, LEADS_KEY: 'k-for-tests' };
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS app_clients (client_id TEXT PRIMARY KEY, code_hash TEXT, ref TEXT, business TEXT, owner_first TEXT DEFAULT '', regulated INTEGER DEFAULT 0, banned TEXT DEFAULT '', phone TEXT DEFAULT '', review_link TEXT DEFAULT '', tier TEXT DEFAULT '', active INTEGER DEFAULT 1, updated TEXT, pushed_at TEXT DEFAULT '', qr TEXT DEFAULT '', feats TEXT DEFAULT '')",
    "CREATE TABLE IF NOT EXISTS app_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT, by TEXT DEFAULT '', text TEXT, hq_synced INTEGER NOT NULL DEFAULT 0, dir TEXT DEFAULT 'in', notified INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS voice_lines (number TEXT PRIMARY KEY, client_id TEXT NOT NULL, on_air INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS billing (client_id TEXT PRIMARY KEY, plan TEXT, status TEXT, created TEXT, email TEXT, owner TEXT, phone TEXT, town TEXT, paused_until TEXT)",
    "CREATE TABLE IF NOT EXISTS app_calls (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, at TEXT, caller TEXT DEFAULT '', caller_name TEXT DEFAULT '', reason TEXT DEFAULT '', summary TEXT DEFAULT '', urgency TEXT DEFAULT '', outcome TEXT DEFAULT 'live', status TEXT DEFAULT 'new', seconds INTEGER DEFAULT 0, test INTEGER DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS app_items (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT, status TEXT DEFAULT 'pending', created TEXT)",
    "CREATE TABLE IF NOT EXISTS app_devices (token TEXT PRIMARY KEY, client_id TEXT NOT NULL, last_seen TEXT)",
    "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, business TEXT, town TEXT, type TEXT, plan TEXT, notes TEXT, origin TEXT, status TEXT NOT NULL DEFAULT 'new', reason TEXT, grade TEXT, callme_at TEXT)"
  ]) await DB.prepare(sql).run();
  const run = (sql, ...b) => DB.prepare(sql).bind(...b).run();
  await (await import('../src/leadmail.js')).ensureLeadMail(env);   // the lead-mail columns, as on the live site
  await run("INSERT INTO app_clients (client_id, business, owner_first, tier) VALUES ('sinclair', 'Sinclair Plumbing', 'Dana', 'Growth'), ('oak', 'Oak & Iron <Builders>', 'Lee', 'Pro'), ('demo-plumbing', 'Demo Plumbing', '', 'Pro'), ('always-open', 'Always Open', '', '')");
  await run("INSERT INTO voice_lines (number, client_id, on_air) VALUES ('+14785550101', 'sinclair', 1), ('+14785550102', 'oak', 0)");
  await run("INSERT INTO billing (client_id, plan, status, created, email, owner, phone, town) VALUES ('sinclair', 'Growth', 'active', '2026-10-20T15:00:00Z', 'dana@sinclairplumbing.example', 'Dana Sinclair', '4785550142', 'Eatonton, GA')");
  // Dana wrote yesterday; the automatic "got it" answered, a person has not. Lee wrote and was answered.
  await run("INSERT INTO app_messages (client_id, at, by, text, dir, notified) VALUES ('sinclair', ?1, 'Dana', 'Can Max say we do <b>tankless</b> installs?', 'in', 1)", iso(NOW - 20 * H));
  await run("INSERT INTO app_messages (client_id, at, by, text, dir, hq_synced) VALUES ('sinclair', ?1, ?2, 'Got it, Dana. Katie will reply by 10 AM tomorrow.', 'out', 1)", iso(NOW - 20 * H + 1000), AUTO_BY);
  await run("INSERT INTO app_messages (client_id, at, by, text, dir, notified) VALUES ('oak', ?1, 'Lee', 'Thanks for the setup', 'in', 1)", iso(NOW - 30 * H));
  await run("INSERT INTO app_messages (client_id, at, by, text, dir, hq_synced, notified) VALUES ('oak', ?1, 'Katie', 'Any time, Lee.', 'out', 1, 1)", iso(NOW - 29 * H));
  await run("INSERT INTO app_calls (id, client_id, at, caller, caller_name, summary, urgency, outcome, status, seconds, test) VALUES ('CA1', 'sinclair', ?1, '+14785550199', 'Tom Reyes', 'Water heater leaking onto the floor.', 'urgent', 'live', 'new', 95, 0), ('CA2', 'always-open', ?2, '+14785550100', '', '4 AM check', '', 'live', 'handled', 20, 1), ('CA3', 'always-open', ?3, '+14705550123', '', 'Asked what the Growth plan costs and wants a call back.', '', 'live', 'new', 120, 0)", iso(NOW - 3 * H), iso(NOW - 8 * H), iso(NOW - 26 * H));
  await run("INSERT INTO app_items (id, client_id, kind, status, created) VALUES ('i1', 'sinclair', 'reply', 'pending', ?1)", iso(NOW - 50 * H));
  await run("INSERT INTO leads (at, name, email, phone, business, town, type, plan, origin, status) VALUES (?1, 'Pat Moss', 'pat@mossroofing.example', '4785550177', 'Moss Roofing', 'Milledgeville, GA', 'Contractor or trade', 'Growth', 'https://alwaysopenoffice.com', 'new'), (?2, '', '', '+14705550123', '', '', 'insurance agency', 'Starter', 'phone CA3', 'new'), (?3, '', '', '+14785550100', '', '', '', '', 'phone CA2', 'new'), (?4, 'Bot', 'x@spam.example', '', 'Cheap SEO', '', '', '', 'https://alwaysopenoffice.com', 'spam'), (?5, '', '', '', 'Mailed Co', '', '', '', 'letter 12', 'letter')", iso(NOW - 2 * H), iso(NOW - 26 * H), iso(NOW - 8 * H), iso(NOW - 5 * H), iso(NOW - 40 * H));
  await run("INSERT INTO leads (at, business, phone, origin, status, callme_at, grade) VALUES (?1, 'Lakeside Dental', '4785550188', 'letter 14', 'letter', ?2, 'D')", iso(NOW - 90 * H), iso(NOW - 1 * H));
  return { DB, env };
}
const get = async (env, path, headers) => { const r = new Request('https://alwaysopenoffice.com' + path, { headers: headers || {} }); return B.handleOpsBoard(r, env, new URL(r.url)); };
const post = async (env, path, body) => { const r = new Request('https://alwaysopenoffice.com' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return B.handleOpsBoard(r, env, new URL(r.url)); };

test('the page opens only with the ops key, the board link or the board cookie', async () => {
  const { env } = await world();
  assert.equal((await get(env, '/ops/hq')).status, 404, 'no link: the page does not admit it exists');
  assert.equal((await get(env, '/ops/hq?t=20261111deadbeefdeadbeefdeadbeefdeadbeef')).status, 404);
  const t = await B.boardToken(env);
  const res = await get(env, '/ops/hq?t=' + t);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /^aob=/, 'the device that opened it is remembered, like the board');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await get(env, '/ops/hq', { 'x-key': 'k-for-tests' })).status, 200);
  assert.equal((await get(env, '/ops/hq', { cookie: (res.headers.get('set-cookie') || '').split(';')[0] })).status, 200);
  const index = (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const p of ['/ops/hq', '/ops/hq/reply', '/ops/hq/lead']) assert.ok(index.includes("path === '" + p + "'"), p + ' is routed to the board');
});

test('it shows who is waiting, open requests, clients and real calls, straight from the tables', async () => {
  const { env } = await world();
  const s = await Q.hqState(env, NOW);
  assert.deepEqual(s.waiting.map(w => w.client), ['sinclair'], 'the automatic "got it" is not an answer; Lee was answered by a person');
  assert.equal(s.waiting[0].thread.length, 2);
  assert.deepEqual(s.leads.map(l => l.business || l.origin), ['Lakeside Dental', 'phone CA2', 'phone CA3', 'Moss Roofing'], 'no spam, and a mailed letter only once they ask for a call');
  assert.equal(s.leads[1].test, true, 'a lead from a test call is marked');
  assert.deepEqual(s.calls.map(k => k.id), ['CA1', 'CA3'], 'test calls are left out');
  assert.equal(s.tests, 1);
  const c = s.clients.find(x => x.id === 'sinclair');
  assert.equal(c.calls7, 1); assert.equal(c.pending, 1); assert.equal(+c.line.on_air, 1); assert.equal(c.bill.status, 'active');
  const html = Q.hqHtml(s, 'TOK');
  assert.match(html, /<h2>Reply to clients \(1\)<\/h2>/);
  // the tally: always all five kinds, each with its count, and the total on top
  assert.deepEqual(Q.tally(s).map(x => x.id), ['reply', 'google', 'requests', 'todo', 'off']);
  const total = Q.tally(s).reduce((a, x) => a + x.n, 0);
  assert.ok(html.includes('<p class="big">' + total + ' things need you</p>') && html.includes('<title>(' + total + ') Always Open HQ</title>'));
  assert.match(html, /<a class="t" href="#reply"><span class="n">1<\/span><span>Clients waiting on your reply<\/span>/);
  assert.match(html, /Approved for Google, waiting to be posted: none/, 'a zero is shown as a checked zero, not left out');
  assert.match(html, /Everything that can need you is in this list, and nowhere else\./);
  assert.match(html, /Can Max say we do &lt;b&gt;tankless&lt;\/b&gt; installs\?/, 'what a client typed is shown as text, never as markup');
  assert.doesNotMatch(html, /<b>tankless<\/b>/);
  assert.match(html, /Waiting 20 hr/);
  assert.match(html, /data-send="sinclair">Send as Katie</);
  assert.match(html, /<h2>Requests to call back \(3\)<\/h2>/);
  assert.match(html, /<b>Lakeside Dental<\/b><span class="sub">Asked for a call from their letter/); assert.match(html, /grade D/);
  assert.match(html, /<b>Moss Roofing<\/b>/); assert.match(html, /Asked what the Growth plan costs/);
  assert.match(html, /<summary>Requests already closed \(1\)<\/summary>/);
  assert.match(html, /<summary>Clients \(2\)<\/summary>/);
  assert.match(html, /Oak &amp; Iron &lt;Builders&gt;/);
  assert.match(html, /1 waiting on their OK, oldest 2 days/);
  assert.match(html, /Max answering/); assert.match(html, /Max off/);
  assert.match(html, /Your own line and the demo/);
  assert.match(html, /Calls Max took this week \(2\)/); assert.match(html, /Tom Reyes/); assert.match(html, /Urgent/);
  assert.match(html, /1 test call is not shown/);
  assert.match(html, /href="\/ops\/numbers\?t=TOK"/);
  assert.doesNotMatch(html, /prompt\(|alert\(|confirm\(/, 'no pop-up boxes');
  assert.doesNotMatch(html, /\bAI\b/);
});

test('an answer typed here lands in the client app as Katie, once, and clears the wait', async () => {
  const { env, DB } = await world();
  const t = await B.boardToken(env);
  assert.equal((await post(env, '/ops/hq/reply', { t: 'forged', client: 'sinclair', text: 'hi' })).status, 403, 'no board link: nothing is sent');
  assert.equal((await post(env, '/ops/hq/reply', { t, client: 'sinclair', text: '   ' })).status, 400);
  assert.equal((await post(env, '/ops/hq/reply', { t, client: 'nobody', text: 'hi' })).status, 404);
  assert.equal((await post(env, '/ops/hq/reply', { t, client: 'sinclair', text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM app_messages WHERE dir = 'out' AND by = 'Katie' AND client_id = 'sinclair'").first()).n, 0);
  const ok = await post(env, '/ops/hq/reply', { t, client: 'sinclair', text: ' Yes. I added tankless installs to what Max knows. ' });
  assert.deepEqual(await ok.json(), { ok: true });
  const row = await DB.prepare("SELECT by, text, dir, notified FROM app_messages WHERE client_id = 'sinclair' ORDER BY id DESC LIMIT 1").first();
  assert.deepEqual({ ...row }, { by: 'Katie', text: 'Yes. I added tankless installs to what Max knows.', dir: 'out', notified: 0 }, 'not yet notified, so the ten-minute run buzzes their iPhone');
  assert.equal((await (await post(env, '/ops/hq/reply', { t, client: 'sinclair', text: 'Yes. I added tankless installs to what Max knows.' })).json()).again, true, 'a double tap is one message');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM app_messages WHERE dir = 'out' AND by = 'Katie' AND client_id = 'sinclair'").first()).n, 1);
  assert.equal((await Q.hqState(env)).waiting.length, 0, 'answered: nobody is waiting');
  // the client app shows it: the app reads this same table
  const seen = (await DB.prepare("SELECT text, dir FROM app_messages WHERE client_id = 'sinclair' ORDER BY id DESC LIMIT 40").all()).results;
  assert.equal(seen[0].dir, 'out');
});

test('a request moves between new, talking, won and lost, with a note', async () => {
  const { env, DB } = await world();
  const t = await B.boardToken(env);
  const id = (await DB.prepare("SELECT id FROM leads WHERE business = 'Moss Roofing'").first()).id;
  assert.equal((await post(env, '/ops/hq/lead', { t: 'forged', id, status: 'won' })).status, 403);
  assert.equal((await post(env, '/ops/hq/lead', { t, id, status: 'spam' })).status, 400, 'only the four statuses');
  assert.equal((await post(env, '/ops/hq/lead', { t, id: 9999, status: 'won' })).status, 404);
  assert.deepEqual(await (await post(env, '/ops/hq/lead', { t, id, status: 'talking' })).json(), { ok: true, status: 'talking' });
  assert.equal((await DB.prepare('SELECT status FROM leads WHERE id = ?1').bind(id).first()).status, 'talking');
  await post(env, '/ops/hq/lead', { t, id, status: 'lost', note: '  went with\n a cousin  ' });
  assert.deepEqual({ ...(await DB.prepare('SELECT status, reason FROM leads WHERE id = ?1').bind(id).first()) }, { status: 'lost', reason: 'went with a cousin' });
  const html = Q.hqHtml(await Q.hqState(env, NOW), t);
  assert.match(html, /<h2>Requests to call back \(2\)<\/h2>/);
  assert.match(html, /Note: went with a cousin/);
});

test('a site with nothing in it yet still opens the page, and so does one that has never sent a lead email', async () => {
  const env = { DB: makeDB(), LEADS_KEY: 'k-for-tests' };
  await env.DB.prepare("INSERT INTO leads (at, business, origin, status) VALUES (?1, 'Early Bird Bakery', 'https://alwaysopenoffice.com', 'new')").bind(iso(NOW - H)).run();
  assert.deepEqual((await Q.hqState(env, NOW)).leads.map(l => l.business), ['Early Bird Bakery'], 'read without the lead-mail columns');
  await env.DB.prepare('DELETE FROM leads').run();
  const res = await get(env, '/ops/hq', { 'x-key': 'k-for-tests' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Clients waiting on your reply: none/); assert.match(html, /Requests to call back: none/); assert.match(html, /No clients yet\./); assert.match(html, /No calls from real callers this week\./);
});

test('the board links to HQ, and the times read in Eastern', async () => {
  const { env } = await world();
  const t = await B.boardToken(env);
  const board = await (await get(env, '/ops?t=' + t)).text();
  assert.match(board, /<h1>Always Open HQ<\/h1>/, 'the old board address is the same one page');
  assert.equal(Q.when('2026-11-11T14:05:00Z', NOW), 'Today 9:05 AM');
  assert.equal(Q.when('2026-11-10T22:30:00Z', NOW), 'Yesterday 5:30 PM');
  assert.equal(Q.when('2026-11-08T15:00:00Z', NOW), 'Sun 10:00 AM');
  assert.equal(Q.when('2026-10-20T15:00:00Z', NOW), 'Oct 20');
  assert.equal(Q.ago(iso(NOW - 25 * 60000), NOW), '25 min'); assert.equal(Q.ago(iso(NOW - 5 * H), NOW), '5 hr'); assert.equal(Q.ago(iso(NOW - 72 * H), NOW), '3 days');
});

test('one page: Google replies with Copy and Posted, the week\'s to-dos with Done, and what is off, all in the one list', async () => {
  const { env, DB } = await world();
  await (await import('../src/gbp.js')).ensureGbp(env);
  await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, decided_text, decided_at, decided_by, created) VALUES ('g:r1', 'sinclair', 'reply', 'Pat L.', 'Fast and <b>fair</b>.', 5, 'Thank you, Pat.', 'approved', 'Thank you, Pat.', ?1, 'Dana', ?1)").bind(iso(NOW - 3 * H)).run();
  await DB.prepare("UPDATE billing SET status = 'past_due', updated = ?1 WHERE client_id = 'sinclair'").bind(iso(NOW - 5 * H)).run();
  const s = await Q.hqState(env, NOW), html = Q.hqHtml(s, 'TOK');
  assert.deepEqual(s.post.map(i => i.id), ['g:r1']);
  assert.match(html, /<section id="google"><h2>Post on Google \(1\)<\/h2>/);
  assert.match(html, /★★★★★ from Pat L\./); assert.match(html, /Fast and &lt;b&gt;fair&lt;\/b&gt;\./);
  assert.match(html, /data-copy="Thank you, Pat\.">Copy and open Google<\/a><button type="button" data-posted="g:r1">Posted<\/button>/);
  assert.ok(!s.todo.some(x => x.key.startsWith('google:')), 'not listed twice: the to-dos leave Google to its own part');
  assert.ok(s.todo.some(x => x.key.startsWith('pay:sinclair')), 'a failed payment is a to-do');
  assert.match(html, /<section id="todo"><h2>To do this week \(\d+\)<\/h2>/); assert.match(html, /data-done="pay:sinclair:[^"]+" data-at="todo">Done</);
  assert.ok(s.off.length >= 1 && s.off.every(x => x.title && x.what && x.doThis), 'each thing that is off says what happened and what to do');
  assert.match(html, /<section id="off"><h2>Things that are off \(\d+\)<\/h2>/); assert.match(html, /<b>Do this:<\/b>/);
  assert.ok(!s.info.some(x => /^(err:|google:)/.test(x.key)) && s.info.some(x => x.key.startsWith('sys:')), 'status lines sit under How things stand');
  assert.match(html, /<summary>How things stand<\/summary>/); assert.match(html, /<summary>Switches: Outreach calls and the map<\/summary>/); assert.match(html, /Max calling businesses: OFF/);
  // Posted takes it off the list; Done takes the to-do off
  const t = await B.boardToken(env), PQ = await import('../src/postqueue.js');
  const pu = new URL('https://alwaysopenoffice.com/ops/post?t=' + t);
  assert.deepEqual(await (await PQ.handlePostQueue(new Request(pu, { method: 'POST', body: JSON.stringify({ id: 'g:r1' }) }), env, pu)).json(), { ok: true });
  const key = s.todo.find(x => x.key.startsWith('pay:sinclair')).key;
  assert.equal((await post(env, '/ops/done', { t, k: key })).status, 200);
  const s2 = await Q.hqState(env, NOW);
  assert.equal(s2.post.length, 0); assert.ok(!s2.todo.some(x => x.key === key));
  assert.match(Q.hqHtml(s2, t), /Approved for Google, waiting to be posted: none/);
  // the page's own script stands alone and has no pop-up boxes
  const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(js)); assert.doesNotMatch(js, /\b(alert|confirm|prompt)\(/);
});
