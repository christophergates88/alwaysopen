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
  assert.match(seen[0].messages[0].content, /^FACTS\nBUSINESS: Always Open\nPRICES: Starter is \$149 a month\.\nNOTES: Every plan answers every Google review\.\n\nCALL\nMax: Hi\.\nCaller: which plan/);
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
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T05:00:00Z', 'rehearse-set', ?1)").bind(JSON.stringify({ set: '100', tag: 'base', features: ['tap'], facts: true })).run();
  const n = await V.expandSets({ DB: db });
  const rows = (await db.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-request' ORDER BY at").all()).results.map(r => JSON.parse(r.detail));
  assert.equal(rows.length, n);
  assert.equal(rows.reduce((a, r) => a + r.calls.length, 0), 100);
  for (const r of rows) { assert.ok(r.calls.length <= 8); assert.ok(r.calls.reduce((a, c) => a + c.turns.length, 0) <= 80); assert.equal(r.facts, true); assert.deepEqual(r.features, ['tap']); assert.equal(r.number, '+17064602226'); assert.equal(r.set, undefined); }
  assert.equal(rows[0].tag, 'base-1');
  assert.equal(await V.expandSets({ DB: db }), 0, 'claimed once');
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T05:01:00Z', 'rehearse-set', ?1)").bind(JSON.stringify({ set: '100', tag: 'few', only: ['golf-replay', 'a-4'] })).run();
  assert.equal(await V.expandSets({ DB: db }), 1);
});
