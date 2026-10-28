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

test('robocall openers are caught; real customers mentioning Google or a warranty are not', async () => {
  const { register } = await import('node:module');
  register('./rehearsal/hooks.mjs', import.meta.url);
  const { looksRobo } = await import('../src/voice.js');
  for (const t of ['This is a recorded message about your Google business listing. Press one to speak to a specialist.', 'We are calling about your extended car warranty', 'Your Google listing is about to be suspended', 'Congratulations, you qualify for a business line of credit']) assert.equal(looksRobo(t), true, t);
  for (const t of ['Your Google listing is wrong, it says you close at five', 'Do you do warranty work on water heaters?', 'I found you on Google', 'Is this still under warranty?', 'Press the reset button?']) assert.equal(looksRobo(t), false, t);
});

test('caller memory: a shared number tells Max nothing, a wrong number is forgotten, opted-out callers are never offered a text', async () => {
  const { makeDB } = await import('./rehearsal/harness.js');
  const { callerMemory } = await import('../src/past.js');
  const DB = makeDB(), env = { DB };
  const call = (id, name, outcome, reason) => DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, reason, test) VALUES (?1,'c1','+14785550100',?2,'+14785550142',?3,?4,?5,0)").bind(id, new Date(Date.now() - 864e5).toISOString(), name, outcome, reason || '').run();
  await call('CA1', 'Dana Sinclair', 'done', 'Water heater');
  assert.match(await callerMemory(env, 'c1', '+14785550142'), /^- Name on file: Dana\./);
  await DB.prepare("INSERT INTO sms_optout (client_id, phone10, at) VALUES ('c1', '4785550142', ?1)").bind(new Date().toISOString()).run();
  assert.match(await callerMemory(env, 'c1', '+14785550142'), /never offer to text them/);
  await call('CA2', 'Mike Hall', 'done', 'Drain');
  assert.equal(await callerMemory(env, 'c1', '+14785550142'), '', 'two names on one number: nothing');
  const DB2 = makeDB();
  await DB2.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, reason, test) VALUES ('CA9','c1','+14785550100',?1,'+14785550177','Al','spam','Wrong number',0)").bind(new Date().toISOString()).run();
  assert.equal(await callerMemory({ DB: DB2 }, 'c1', '+14785550177'), '');
});
