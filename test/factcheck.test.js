// The fact check (Nov 22, 2026): a second model reads Max's replies against the facts his line was given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const G = await import('../src/grades.js');

const env = { ANTHROPIC_API_KEY: 'sk-ant-test' };
const L = { business: 'Always Open', prices: 'Starter is $149 a month.', notes: 'Every plan answers every Google review.', regulated: false };
const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'which plan answers reviews' }, { r: 'a', t: 'On the Growth plan, every Google review gets a reply.' }];
const fake = (body, seen) => async (url, o) => { if (seen) seen.push(JSON.parse(o.body)); return { json: async () => ({ content: [{ text: body }] }) }; };

test('factCheck sends the facts and the call, and returns what the checker found wrong', async () => {
  const seen = [];
  const r = await G.factCheck(env, msgs, L, fake('{"wrong":[{"turn":1,"quote":"On the Growth plan, every Google review gets a reply.","why":"Every plan answers reviews."}]}', seen));
  assert.deepEqual(r.wrong, [{ turn: 1, quote: 'On the Growth plan, every Google review gets a reply.', why: 'Every plan answers reviews.' }]);
  assert.match(seen[0].messages[0].content, /^FACTS\nBUSINESS: Always Open\nPRICES: Starter is \$149 a month\.\nNOTES: Every plan answers every Google review\.\nRULES MAX FOLLOWS[^\n]*\n\nCALL\nMax: Hi\.\nCaller: which plan/);
  assert.match(seen[0].system, /wrong plan IS wrong/);
});

test('factCheck: a clean call is an empty list; an answer it cannot read is "could not run", never "clean"', async () => {
  assert.deepEqual((await G.factCheck(env, msgs, L, fake('{"wrong":[]}'))).wrong, []);
  assert.equal((await G.factCheck(env, msgs, L, fake('I think it is fine.'))).wrong, null);
  assert.equal((await G.factCheck(env, msgs, L, async () => { throw new Error('down'); })).wrong, null);
  assert.equal((await G.factCheck({}, msgs, L)).wrong, null);
  assert.match(G.factsText({ business: 'Lane Dental', regulated: true }), /REGULATED OFFICE: messages only/);
});

test('one row queues the whole 100-call set as practice requests', async () => {
  const V = await import('../src/voice.js');
  const { makeDB } = await import('./rehearsal/harness.js');
  const db = makeDB();
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T05:00:00Z', 'rehearse-pack', ?1)").bind(JSON.stringify({ set: '100', tag: 'base', features: ['tap'], facts: true })).run();
  const n = await V.expandSets({ DB: db });
  const rows = (await db.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-request' ORDER BY at").all()).results.map(r => JSON.parse(r.detail));
  assert.equal(rows.length, n);
  assert.equal(rows.reduce((a, r) => a + r.calls.length, 0), 100);
  for (const r of rows) { assert.ok(r.calls.length <= 8); assert.ok(r.calls.reduce((a, c) => a + c.turns.length, 0) <= 80); assert.equal(r.facts, true); assert.deepEqual(r.features, ['tap']); assert.equal(r.number, '+17064602226'); assert.equal(r.set, undefined); }
  assert.equal(rows[0].tag, 'base-1');
  assert.equal(await V.expandSets({ DB: db }), 0, 'claimed once');
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T05:01:00Z', 'rehearse-pack', ?1)").bind(JSON.stringify({ set: '100', tag: 'few', only: ['golf-replay', 'a-4'] })).run();
  assert.equal(await V.expandSets({ DB: db }), 1);
});

test('queuing a pack never touches the saved list of real calls to replay (kind rehearse-set)', async () => {
  const V = await import('../src/voice.js');
  const { makeDB } = await import('./rehearsal/harness.js');
  const db = makeDB();
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-06T15:12:00Z', 'rehearse-set', '{\"number\":\"+17064602226\",\"calls\":[[\"hi\"]],\"auto\":true}')").run();
  assert.equal(await V.expandSets({ DB: db }), 0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM voice_log WHERE kind = 'rehearse-set'").first()).n, 1);
});

test('factCheck asks Sonnet with the lowest thinking it accepts, and says why when the API refuses', async () => {
  const seen = [];
  await G.factCheck(env, msgs, L, fake('{"wrong":[]}', seen));
  assert.deepEqual(seen[0].thinking, { type: 'between_tools' }, 'Sonnet 5.5 refuses "disabled"');
  assert.equal(seen[0].model, 'claude-sonnet-5-5');
  const r = await G.factCheck(env, msgs, L, async () => ({ json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message: 'thinking.type: disabled is not supported' } }) }));
  assert.equal(r.wrong, null); assert.match(r.why, /disabled is not supported/);
});

test('two packs queued together run side by side: their requests alternate', async () => {
  const V = await import('../src/voice.js');
  const { makeDB } = await import('./rehearsal/harness.js');
  const db = makeDB();
  for (const [at, tag] of [['2026-11-22T06:00:00Z', 'base'], ['2026-11-22T06:00:01Z', 'v3']]) await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES (?1, 'rehearse-pack', ?2)").bind(at, JSON.stringify({ set: '100', tag, features: tag === 'v3' ? ['tap', 'v3'] : ['tap'] })).run();
  await V.expandSets({ DB: db });
  const tags = (await db.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-request' ORDER BY at").all()).results.map(r => JSON.parse(r.detail).tag);
  assert.deepEqual(tags.slice(0, 4), ['base-1', 'v3-1', 'base-2', 'v3-2']);
  assert.equal(tags.length % 2, 0);
});

test('v3 (practice only): stock closers are cut after a real answer, stock reactions turn plain, replies are a little shorter', async () => {
  const V = await import('../src/voice.js');
  const G = await import('../src/guards.js');
  const L = f => ({ business: 'Always Open', own: true, features: f, prices: 'Starter is $149 a month.' });
  const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'i run a salon, can you put people in vagaro' }];
  const ctx = f => V.guardCtx(L(f), msgs, msgs[1].t, {});
  const raw = 'No, Vagaro does not connect to me. I take the time they want and text you to check it while they wait. Does that sound like your day?';
  assert.match(G.guardText(raw, ctx(['tap'])).text, /Does that sound like your day\?/, 'the live version is unchanged');
  assert.doesNotMatch(G.guardText(raw, ctx(['tap', 'v3', 'g-closer'])).text, /Does that sound/);
  for (const q of ['Make sense?', 'Want to hear how that works on a busy Saturday?', 'Which part do you want more on?', 'Anything else on your list?', 'Would that work for your front desk?'])
    assert.equal(G.guardText('I answer every call, day or night. ' + q, ctx(['tap', 'v3', 'g-closer'])).text.trim(), 'I answer every call, day or night.', q);
  for (const q of ['What kind of business do you run?', 'What\'s your name?', 'Is four zero four, five five five, zero one eight seven the best number?', 'Does your tee sheet run your bookings?'])
    assert.match(G.guardText('I answer every call, day or night. ' + q, ctx(['tap', 'v3', 'g-closer'])).text, new RegExp(q.replace(/[?.]/g, '\\$&')), q);
  assert.equal(G.guardText('Does that make sense?', ctx(['tap', 'v3', 'g-closer'])).text, 'Does that make sense?', 'a reply that is only the question stays');
  // reactions
  const lead = { kind: 'wh', text: 'Good question.' };
  const two = [{ r: 'u', t: 'hi' }, { r: 'a', t: 'Hi.' }, { r: 'u', t: 'so tell me what the deal is with the plans and everything because i read the site and it is a lot to take in honestly' }];
  assert.equal(V.trimLead(lead, L(['tap', 'v3']), two, []).text, 'Okay.');
  assert.equal(V.trimLead(lead, L(['tap']), two, []).text, 'Good question.', 'live unchanged');
});
