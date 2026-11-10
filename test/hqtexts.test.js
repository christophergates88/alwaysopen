// Gates HQ answers Christopher's texts: everyday back-and-forth gets a reply in his voice; money, legal, health, "is
// this a bot", his tell-me list (Katie), strangers and too many replies always go to him with a suggested reply and a
// one-tap Send link that can only send that exact text, once. Off and shadow modes send nothing. Claude is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { makeDB } = await import('./rehearsal/harness.js');
const T = await import('../src/hqtexts.js');

let answers = [], seen = [];
function env() {
  const DB = makeDB();
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('anthropic.com')) { seen.push(JSON.parse(init.body)); const a = answers.shift(); return a == null ? new Response('x', { status: 500 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: typeof a === 'string' ? a : JSON.stringify(a) }] })); }
    return new Response('{}');
  };
  return { DB, ANTHROPIC_API_KEY: 'x' };
}
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
async function setMode(e, mode, extra) {
  await T.ensureHqTexts(e);
  await e.DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('textpilot', 'x', ?1)").bind(JSON.stringify(Object.assign({ mode }, extra || {}))).run();
}
async function family(e, people) { await e.DB.prepare("INSERT OR REPLACE INTO hq_kv (k, at, v) VALUES ('family', 'x', ?1)").bind(JSON.stringify({ people })).run(); }
const chat = (o) => Object.assign({ handle: '+14785550123', name: 'Mike Barnes', known: true, msgs: [{ at: 'Tue 11-10 09:01', me: true, text: 'yo you still good for thursday' }, { at: 'Tue 11-10 13:02', me: false, text: 'yep what time again' }], new: ['yep what time again'] }, o || {});
async function post(e, chats) { const r = await T.handleHqText(new Request('https://x/ops/hq-text', { method: 'POST', body: JSON.stringify({ chats }) }), e, json); return r.json(); }

test('code\'s own reading: money, legal, health and "is this a bot" are caught; "Bill" the name is not money', () => {
  assert.deepEqual(T.flagsOf(['can you venmo me 40 for the tickets']).force, ['money']);
  assert.deepEqual(T.flagsOf(['Bill said he is coming at 6']).force, []);
  assert.deepEqual(T.flagsOf(['the electric bill came']).force, ['money']);
  assert.deepEqual(T.flagsOf(['my lawyer wants you to sign the contract']).force, ['legal']);
  assert.deepEqual(T.flagsOf(['Cason has a fever, taking him to urgent care']).force, ['health']);
  assert.deepEqual(T.flagsOf(['is this a bot lol']).force, ['identity']);
  assert.equal(T.flagsOf(['car accident on 441, call me asap']).urgent, true);
  assert.deepEqual(T.flagsOf(['sounds good see you at 6']), { force: [], urgent: false });
});

test('a reply never mentions an assistant or AI, a link, or a dollar amount, and stays short', () => {
  assert.equal(T.replyOk('6:30 works 👍'), true);
  assert.equal(T.replyOk('As an AI assistant I can confirm 6:30'), false);
  assert.equal(T.replyOk('here https://x.co'), false);
  assert.equal(T.replyOk('it was $40'), false);
  assert.equal(T.replyOk('x'.repeat(400)), false);
  assert.equal(T.replyOk(''), false);
});

test('off sends nothing and asks nothing; shadow decides and logs but makes no Send link', async () => {
  const e = env(); seen = [];
  await setMode(e, 'off');
  assert.deepEqual((await post(e, [chat()])).decisions, []);
  assert.equal(seen.length, 0);
  await setMode(e, 'shadow');
  answers = [{ action: 'escalate', category: 'commitment', tell: 'Mike wants to know what time Thursday.', suggest: '6:30 at the course' }];
  const d = (await post(e, [chat()])).decisions[0];
  assert.equal(d.action, 'escalate'); assert.equal(d.approve, '');
  assert.equal((await e.DB.prepare('SELECT mode FROM hq_text_log').first()).mode, 'shadow');
});

test('everyday back-and-forth gets a reply in his voice, with his schedule and the chat in front of the model', async () => {
  const e = env(); seen = [];
  await setMode(e, 'on');
  await e.DB.prepare("INSERT INTO hq_kv (k, at, v) VALUES ('cal', '2026-11-10T18:00:00Z', ?1)").bind(JSON.stringify({ events: [{ d: '2099-11-12', s: '18:30', e: '20:00', t: 'Golf with Mike' }] })).run();
  answers = [{ action: 'reply', reply: '6:30 at the course', category: 'logistics', tell: 'Told Mike 6:30 Thursday.' }];
  const d = (await post(e, [chat()])).decisions[0];
  assert.equal(d.action, 'reply'); assert.equal(d.reply, '6:30 at the course'); assert.ok(d.log > 0);
  const u = seen[0].messages[0].content;
  assert.match(u, /FROM: Mike Barnes \(in his contacts\)/); assert.match(u, /Golf with Mike/); assert.match(u, /Me: yo you still good for thursday/);
  assert.match(seen[0].system[0].text, /Never say or hint that you're an assistant/);
});

test('money in their text: the model\'s reply becomes his suggested reply, with a one-tap Send link that sends only that, once', async () => {
  const e = env();
  await setMode(e, 'on');
  answers = [{ action: 'reply', reply: 'sure sending it now', category: 'money', tell: 'Mike asked for $40 for the tickets.' }];
  const d = (await post(e, [chat({ new: ['can you venmo me 40 for the tickets'] })])).decisions[0];
  assert.equal(d.action, 'escalate'); assert.equal(d.reply, ''); assert.equal(d.suggest, 'sure sending it now');
  assert.match(d.approve, /^https:\/\/alwaysopenoffice\.com\/hq\/t\/[0-9a-f]{32}$/);
  const tok = d.approve.split('/').pop();
  const g = await (await T.handleApprove(new Request('https://x/hq/t/' + tok), e, tok)).text();
  assert.match(g, /sure sending it now/); assert.doesNotMatch(g, /<textarea|<input/i, 'nothing can be typed on the public page');
  const p1 = await (await T.handleApprove(new Request('https://x/hq/t/' + tok, { method: 'POST' }), e, tok)).text();
  assert.match(p1, /On its way/);
  assert.match(await (await T.handleApprove(new Request('https://x/hq/t/' + tok, { method: 'POST' }), e, tok)).text(), /Already sent/);
  const q = await (await T.handleHqTextQueue(new Request('https://x/ops/hq-text-queue'), e, json)).json();
  assert.equal(q.out.length, 1); assert.equal(q.out[0].body, 'sure sending it now'); assert.equal(q.out[0].handle, '4785550123');
  assert.equal((await (await T.handleHqTextQueue(new Request('https://x/ops/hq-text-queue'), e, json)).json()).out.length, 0, 'handed out once');
  await T.handleHqTextQueue(new Request('https://x/ops/hq-text-queue', { method: 'POST', body: JSON.stringify({ sent: [q.out[0].id] }) }), e, json);
  assert.equal((await e.DB.prepare('SELECT status FROM hq_text_out').first()).status, 'sent');
  assert.match(await (await T.handleApprove(new Request('https://x/hq/t/' + 'f'.repeat(32)), e, 'f'.repeat(32))).text(), /Not found/);
});

test('Katie (his tell-me list), strangers, "is this a bot" and urgent texts never get an automatic reply', async () => {
  const e = env();
  await setMode(e, 'on');
  await family(e, [{ name: 'Katie', relation: 'wife', phones: ['+19125151023'], texts: 'tell' }, { name: 'Dad', relation: 'father', phones: ['+14785550111'] }]);
  answers = [{ action: 'reply', reply: 'on my way', category: 'logistics', tell: 'x' }];
  assert.equal((await post(e, [chat({ handle: '+19125151023', name: 'Katie Gates', new: ['where are you'] })])).decisions[0].action, 'escalate');
  answers = [{ action: 'reply', reply: 'yep its me', category: 'identity', tell: 'x' }];
  assert.equal((await post(e, [chat({ new: ['is this really chris?'] })])).decisions[0].action, 'escalate');
  answers = [{ action: 'reply', reply: 'hey who is this', category: 'social', tell: 'x' }];
  assert.equal((await post(e, [chat({ handle: '+14045550000', name: '', known: false, new: ['hey its jordan from the lake'] })])).decisions[0].action, 'escalate');
  answers = [{ action: 'none', category: 'none', tell: '' }];
  const u = (await post(e, [chat({ handle: '+14785550111', name: 'Dad', new: ['been in a wreck on 441 call me asap'] })])).decisions[0];
  assert.equal(u.action, 'escalate'); assert.equal(u.urgent, true);
  assert.match(seen.at(-1).messages[0].content, /FROM: Dad, his father/);
});

test('four replies to one person in an hour is the limit; the fifth goes to him', async () => {
  const e = env();
  await setMode(e, 'on');
  for (let i = 0; i < 5; i++) answers.push({ action: 'reply', reply: 'lol yeah', category: 'social', tell: 'x' });
  const got = [];
  for (let i = 0; i < 5; i++) got.push((await post(e, [chat({ new: ['haha ' + i] })])).decisions[0].action);
  assert.deepEqual(got, ['reply', 'reply', 'reply', 'reply', 'escalate']);
});

test('the model failing never sends anything: he is told instead; a "Text for me" job is carried and closed', async () => {
  const e = env();
  await setMode(e, 'on');
  answers = [];
  const d = (await post(e, [chat()])).decisions[0];
  assert.equal(d.action, 'escalate'); assert.equal(d.reply, '');
  await e.DB.prepare("INSERT INTO hq_text_out (at, kind, handle, name, body, goal, status, sent_at) VALUES (?1, 'job', '4045550000', 'Jordan', 'Hey Jordan, can we move Saturday to 10?', 'Move Saturday to 10, or find a time Sunday.', 'sent', ?1)").bind(new Date().toISOString()).run();
  answers = [{ action: 'reply', reply: 'perfect see you then', category: 'logistics', tell: 'Jordan can do Sunday at 10.', done: true }];
  const j = (await post(e, [chat({ handle: '+14045550000', name: 'Jordan', known: false, new: ['saturday no but sunday 10 works'] })])).decisions[0];
  assert.equal(j.action, 'reply', 'he started this one, so a number not in his contacts is fine'); assert.equal(j.done, true);
  assert.match(seen.at(-1).messages[0].content, /ACTIVE GOAL: Christopher asked you to text Jordan to: Move Saturday to 10/);
  const r = await e.DB.prepare("SELECT status, result FROM hq_text_out WHERE kind = 'job'").first();
  assert.equal(r.status, 'done'); assert.match(r.result, /Sunday at 10/);
});

test('the Mac can share the people he texts (name and number only), for "Text Mike" on his page', async () => {
  const e = env();
  await T.ensureHqTexts(e);
  await T.handleHqTextQueue(new Request('https://x/ops/hq-text-queue', { method: 'POST', body: JSON.stringify({ people: [{ n: 'Mike Barnes', p: '+1 (478) 555-0123', last: '2026-11-09', extra: 'dropped' }, { n: '', p: '1' }] }) }), e, json);
  const v = JSON.parse((await e.DB.prepare("SELECT v FROM hq_kv WHERE k = 'people'").first()).v);
  assert.deepEqual(v.list, [{ n: 'Mike Barnes', p: '4785550123', last: '2026-11-09' }]);
});

test('people he answers himself get no push of our own unless it\'s urgent; the heads-up stays neutral for the lock screen', async () => {
  const e = env(); seen = [];
  await setMode(e, 'on');
  await family(e, [{ name: 'Katie', relation: 'wife', phones: ['+19125151023'], texts: 'tell' }]);
  answers = [{ action: 'escalate', category: 'personal', tell: 'Katie asked you to grab a bath mat.', suggest: 'got it, grabbing one after work' }];
  const k = (await post(e, [chat({ handle: '+19125151023', name: 'Katie Gates', new: ['Bath mat!!'] })])).decisions[0];
  assert.equal(k.action, 'escalate'); assert.equal(k.quiet, true);
  answers = [{ action: 'escalate', category: 'urgent', urgent: true, tell: 'Katie needs you to call now.', suggest: '' }];
  const u = (await post(e, [chat({ handle: '+19125151023', name: 'Katie Gates', new: ['call me asap'] })])).decisions[0];
  assert.equal(u.quiet, false, 'urgent always reaches him');
  answers = [{ action: 'escalate', category: 'money', tell: 'Josh asked for $40.', suggest: '' }];
  assert.equal((await post(e, [chat({ new: ['venmo me 40'] })])).decisions[0].quiet, false, 'everyone else still gets the push');
  assert.match(seen[0].system[0].text, /lock screen/);
});
