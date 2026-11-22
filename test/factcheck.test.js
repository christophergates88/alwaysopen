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
