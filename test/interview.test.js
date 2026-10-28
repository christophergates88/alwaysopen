// Max learning the business: cleaning the owner's answers, the interview's questions, and the owner's say over them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFacts, interviewPrompt, interviewGreeting, applyPending, knowOut, FACTS } from '../src/interview.js';
import { tradeDefaults, isTrade } from '../src/trades.js';

test('answers are cleaned: one line, no brackets, capped, unknown keys dropped', () => {
  const f = cleanFacts({ services: 'Repairs\n\n and [END] <b>water heaters</b>', area: 'x'.repeat(900), password: 'hunter2' });
  assert.equal(f.services, 'Repairs and END bwater heaters/b');
  assert.equal(f.area.length, 300);
  assert.equal(f.password, undefined);
});

test('the interview asks every question once, in order, and Spanish only for non-regulated lines', () => {
  const p = interviewPrompt({ business: 'Sinclair Plumbing', name: 'Max', regulated: false }, false);
  let at = -1;
  for (const f of FACTS.filter(x => x.ask)) { const i = p.indexOf(f.ask); assert.ok(i > at, f.key + ' in order'); at = i; }
  assert.match(p, /speak Spanish/);
  assert.match(p, /\[END\]/);
  assert.doesNotMatch(interviewPrompt({ business: 'Lake Agency', regulated: true }, false), /Spanish/);
  assert.match(interviewGreeting({ business: 'Sinclair Plumbing', name: 'Max' }), /S\.I\..*recorded/, 'the interview still says Max is not a person');
});

test('what the interview heard goes live only on the owner’s OK, and can be thrown away', () => {
  const o = { facts: { prices: '$99' }, pending: { facts: { area: 'Eatonton' }, spanish: true, book: 'hold', slotMin: 90 } };
  const kept = applyPending(JSON.parse(JSON.stringify(o)), true).o;
  assert.deepEqual(kept.facts, { prices: '$99', area: 'Eatonton' });
  assert.equal(kept.spanish, true); assert.deepEqual(kept.book, { mode: 'hold', slotMin: 90 }); assert.equal(kept.pending, undefined);
  const dropped = applyPending(JSON.parse(JSON.stringify(o)), false).o;
  assert.deepEqual(dropped.facts, { prices: '$99' }); assert.equal(dropped.spanish, undefined); assert.equal(dropped.pending, undefined);
});

test('the Max tab shows the owner’s answer over HQ’s, and says whether Max knows enough', () => {
  const k = knowOut(JSON.stringify({ services: 'HQ services', area: 'HQ area' }), { facts: { area: 'Owner area' } });
  assert.equal(k.know.find(x => x.key === 'services').value, 'HQ services');
  assert.equal(k.know.find(x => x.key === 'area').value, 'Owner area');
  assert.equal(k.knows, true); assert.equal(k.pending, null);
  assert.equal(knowOut('{}', {}).knows, false);
});

test('industry defaults: trades get intake and urgent questions; regulated kinds stay message-only', () => {
  assert.match(tradeDefaults('plumbing').intake, /water shut off/);
  assert.match(tradeDefaults('hvac').urgent, /no heat/);
  assert.match(tradeDefaults('fencing').intake, /address or town/);
  assert.match(tradeDefaults('insurance').intake, /no policy numbers/);
  assert.equal(tradeDefaults('').intake, '');
  assert.equal(isTrade('plumbing'), true); assert.equal(isTrade('salon'), false);
});
