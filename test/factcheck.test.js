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

test('real calls (off until FACTCHECK_LIVE is "1"): price, plan, timing and "checking with Chris" slips are texted, the rest only kept', async () => {
  const V = await import('../src/voice.js');
  const offer = 'Want Chris to call you?';
  const call = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'what plans' }, { r: 'a', t: 'On the Growth plan, every Google review gets a reply. ' + offer }, { r: 'u', t: 'hm' }, { r: 'a', t: 'Sure. ' + offer }, { r: 'u', t: 'what else' }, { r: 'a', t: 'I\'d flag it urgent. ' + offer }];
  const f = async (url, o) => { const b = JSON.parse(o.body); return { json: async () => ({ content: [{ type: 'text', text: /strict second reader/.test(b.system) ? '{"verdicts":[{"i":1,"v":"error","why":"x"},{"i":2,"v":"error","why":"y"}]}' : '{"wrong":[{"turn":2,"quote":"On the Growth plan, every Google review gets a reply.","why":"Every plan answers reviews.","kind":"plan"},{"turn":4,"quote":"I\'d flag it urgent.","why":"not described","kind":"feature"}]}' }] }) }; };
  const r = await V.liveSlips({ ANTHROPIC_API_KEY: 'k' }, call, { business: 'Always Open', own: true }, f, 'You are Max.');
  assert.deepEqual(r.slips, ['"On the Growth plan, every Google review gets a reply." (Every plan answers reviews.)', 'offered the call back 3 times']);
  assert.equal(r.facts, 2, 'both kept in the grade');
  assert.deepEqual(r.all.map(w => w.kind), ['plan', 'feature']);
  const src = (await import('node:fs')).readFileSync(new URL('../src/voice.js', import.meta.url), 'utf8');
  assert.match(src, /env\.FACTCHECK_LIVE === '1' && call\.client_id === OWN_ID/, 'switched off unless set');
});

test('v3 loop 2: the same question is not asked two replies in a row, nor a third time', async () => {
  const V = await import('../src/voice.js');
  const G = await import('../src/guards.js');
  const L = { business: 'Always Open', own: true, features: ['v3', 'g-ask3'] };
  const run = (msgs, raw) => G.guardText(raw, V.guardCtx(L, msgs, msgs.filter(m => m.r === 'u').at(-1).t, {})).text.trim();
  const base = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'i run a dog grooming shop' }];
  const asked = base.concat({ r: 'a', t: 'A dog grooming shop, nice. What\'s the shop called?' }, { r: 'u', t: 'is fill my week the storm thing' });
  assert.equal(run(asked, 'Fill my week is the one for open days, on Pro. What\'s the shop called?'), 'Fill my week is the one for open days, on Pro.');
  const later = asked.concat({ r: 'a', t: 'Fill my week is the one for open days, on Pro.' }, { r: 'u', t: 'ok cool' });
  assert.match(run(later, 'Good. What\'s the shop called?'), /What's the shop called\?/, 'a reply later it may be asked again');
  const twice = later.concat({ r: 'a', t: 'Good. What\'s the shop called?' }, { r: 'u', t: 'whats the price' }, { r: 'a', t: 'Starter is $149 a month.' }, { r: 'u', t: 'ok' });
  assert.equal(run(twice, 'Sure. What\'s the shop called?'), 'Sure.', 'not a third time');
  const num = base.concat({ r: 'a', t: 'Got it. Is four zero four, five five five, zero one eight seven the best number?' }, { r: 'u', t: 'what' });
  assert.equal(run(num, 'Sorry. Is four zero four, five five five, zero one eight seven the best number?'), 'Sorry.');
  assert.match(run(num.concat({ r: 'a', t: 'Sorry.' }, { r: 'u', t: 'use 478 555 0101' }), 'Got it. Is four seven eight, five five five, zero one zero one right?'), /four seven eight/, 'a new number is read back');
  assert.match(G.guardText('What\'s the shop called?', V.guardCtx({ business: 'Always Open', own: true, features: [] }, asked, 'x', {})).text, /shop called/, 'live unchanged');
});

test('call-back offers worded as "put you down for the callback" or in Spanish are counted', async () => {
  const G = await import('../src/guards.js');
  const m = t => [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'hm' }, { r: 'a', t: t }];
  assert.equal(G.callbackOffers(m('Sure. Want me to put you down for the callback with Chris?')).offered, 1);
  assert.equal(G.callbackOffers(m('Claro. ¿Quieres que Chris te llame?')).offered, 1);
});

test('v3 loop 3: the own line\'s prompt says each thing once, no pitch, the call back once; the live prompt is unchanged', async () => {
  const V = await import('../src/voice.js');
  const L = f => ({ business: 'Always Open', own: true, goal: 'Help business owners see what Always Open would do for them.', features: f });
  const p3 = V.systemPrompt(L(['v3']), '+14045550187', 'en-US', false), p0 = V.systemPrompt(L([]), '+14045550187', 'en-US', false);
  assert.match(p3, /How you talk on this line \(most important\):\n- Say each thing once a call\./);
  assert.match(p3, /Offer Chris's call back once, when they sound interested/);
  assert.doesNotMatch(p0, /How you talk on this line/);
  assert.doesNotMatch(V.systemPrompt({ business: 'Lane Plumbing', features: ['v3'] }, '+14045550187', 'en-US', false), /How you talk on this line/, 'a business\'s own line is not this');
});

// ---------- fact check v2 ----------
test('v2: Sonnet finds, a skeptical Opus read keeps only real errors; the call is numbered by Max\'s replies', async () => {
  const seen = [];
  const f = async (url, o) => { const b = JSON.parse(o.body); seen.push(b);
    const text = /strict second reader/.test(b.system) ? '{"verdicts":[{"i":1,"v":"ok","why":"his rules allow it"},{"i":2,"v":"error","why":"replies are on every plan"}]}'
      : '{"wrong":[{"turn":1,"quote":"I never take card numbers.","why":"not in facts","kind":"policy"},{"turn":2,"quote":"On the Growth plan, every Google review gets a reply.","why":"every plan","kind":"plan"}]}';
    return { json: async () => ({ content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text }] }) }; };
  const call = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'can i pay now' }, { r: 'a', t: 'I never take card numbers.' }, { r: 'u', t: 'which plan answers reviews' }, { r: 'a', t: 'On the Growth plan, every Google review gets a reply.' }];
  const r = await G.factCheck2({ ANTHROPIC_API_KEY: 'k' }, call, 'You are Max. Never take card numbers. Every plan answers every Google review.', f);
  assert.deepEqual(r.wrong.map(w => w.quote), ['On the Growth plan, every Google review gets a reply.']);
  assert.equal(r.cand, 2);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].model, 'claude-sonnet-5-5'); assert.deepEqual(seen[0].thinking, { type: 'between_tools' });
  assert.equal(seen[1].model, 'claude-opus-5-5'); assert.equal(seen[1].thinking, undefined, 'Opus 5.5 takes no thinking setting here');
  assert.match(seen[0].messages[0].content, /^INSTRUCTIONS\nYou are Max\.[\s\S]*RULES MAX FOLLOWS[^\n]*\n\nCALL\nMax \[1\]: Always Open, this is Max\.\nCaller: can i pay now\nMax \[2\]: I never take card numbers\./);
  assert.match(seen[1].messages[0].content, /CLAIMS\n1\. Max \[1\]: "I never take card numbers\." \(flagged because: not in facts\)\n2\. Max \[2\]/);
  // nothing found: no second read
  seen.length = 0;
  const none = async (url, o) => { seen.push(1); return { json: async () => ({ content: [{ type: 'text', text: '{"wrong":[]}' }] }) }; };
  assert.deepEqual((await G.factCheck2({ ANTHROPIC_API_KEY: 'k' }, call, 'x', none)).wrong, []); assert.equal(seen.length, 1);
  // a refusal is "could not run", with the reason
  const bad = async () => ({ json: async () => ({ type: 'error', error: { message: 'overloaded' } }) });
  const e = await G.factCheck2({ ANTHROPIC_API_KEY: 'k' }, call, 'x', bad);
  assert.equal(e.wrong, null); assert.match(e.why, /overloaded/);
});

test('v2: saved practice calls are re-checked against the instructions they ran with, without running them again', async () => {
  const V = await import('../src/voice.js');
  const H = await import('./rehearsal/harness.js');
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, facts) VALUES ('+17064602226', 'always-open', 'Always Open', 1, 'answering service', 'Eatonton, GA', '2026-11-22', ?1)").bind(JSON.stringify({ notes: 'Every plan answers every Google review.', prices: 'Starter is $149 a month.' })).run();
  const out = [{ said: 'which plan answers reviews', lead: 'Okay.', reply: 'On the Growth plan, every Google review gets a reply.' }];
  const saved = await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T07:30:00Z', 'rehearse', ?1) RETURNING rowid").bind(JSON.stringify({ id: 'b-7', tag: 'L4v3-3', out, facts: [{ turn: 1, quote: 'old flag', why: 'x' }] })).first();
  const seen = [];
  world.aiNote = b => { seen.push(b); return /strict second reader/.test(b.system) ? { verdicts: [{ i: 1, v: 'error', why: 'every plan' }] } : { wrong: [{ turn: 2, quote: 'On the Growth plan, every Google review gets a reply.', why: 'replies are on every plan', kind: 'plan' }] }; };
  await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-22T17:00:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ recheck: [saved.rowid], tag: 'rc', features: ['v3'] })).run();
  await V.rehearse(env);
  const r = JSON.parse((await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-recheck'").first()).detail);
  assert.equal(r.id, 'b-7'); assert.equal(r.row, saved.rowid); assert.equal(r.tag, 'rc'); assert.equal(r.cand, 1);
  assert.deepEqual(r.old, [{ turn: 1, quote: 'old flag', why: 'x' }]);
  assert.deepEqual(r.wrong.map(w => w.kind), ['plan']);
  assert.match(seen[0].messages[0].content, /INSTRUCTIONS\n[\s\S]*Every plan answers every Google review[\s\S]*How you talk on this line[\s\S]*\n\nCALL\nMax \[1\]: [^\n]*\nCaller: which plan answers reviews\nMax \[2\]: Okay\. On the Growth plan/, 'the v3 instructions Max had, then the call');
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM voice_log WHERE kind = 'rehearse'").first()).n, 1, 'nothing was run again');
});

test('v4 (practice only): told each turn what it already said; asks only their name; one thing that fits, not a list', async () => {
  const V = await import('../src/voice.js');
  const F = await import('../src/facts.js');
  const f = F.ownLineFacts();
  const L = feat => Object.assign({ business: 'Always Open', own: true, features: feat, intake: 'their business name, what kind of business it is, the town' }, f);
  const msgs = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'what does it cost' }, { r: 'a', t: 'Starter is $149 a month, no contract, and the first month is refunded if it is not worth it.' }, { r: 'u', t: 'and if a customer asks a price i only know' }, { r: 'a', t: 'I text you the question while they are on the line. That is Shoulder Tap. Want Chris to call you?' }, { r: 'u', t: 'hm ok so what else' }];
  assert.deepEqual(V.saidAlready(msgs), ['the prices', 'the first-month refund', 'no contract', 'Shoulder Tap', 'that Chris can call them']);
  const note = V.callerNotes({ line: L(['v4']), msgs }, 'hm ok so what else');
  assert.match(note, /Already said this call: the prices, the first-month refund, no contract, Shoulder Tap, that Chris can call them\. Do not say any of it again/);
  assert.doesNotMatch(V.callerNotes({ line: L(['v3']), msgs }, 'x'), /Already said this call/, 'v3 unchanged');
  assert.doesNotMatch(V.callerNotes({ line: L([]), msgs }, 'x'), /Already said this call/, 'live unchanged');
  const p4 = V.systemPrompt(L(['v4']), '+14045550187', 'en-US', false), p3 = V.systemPrompt(L(['v3']), '+14045550187', 'en-US', false);
  assert.match(p4, /3\. Get their name, once, when they want the call back\. If they skip it, go on without it; never ask for their business name or town\./);
  assert.match(p3, /3\. Get the details the team needs: their business name, what kind of business it is, the town/);
  assert.match(p4, /say the one or two things that fit their business best, in a sentence or two; more only if they ask/); assert.doesNotMatch(p4, /example from their world/, 'v4 run 1 made answers longer'); assert.doesNotMatch(p4, /Never stop at taking messages/);
  assert.match(p3, /Never stop at taking messages/);
  assert.match(p4, /How you talk on this line \(most important\)/, 'v4 carries v3');
  assert.ok(p4.length <= 14200, 'within the prompt budget: ' + p4.length);
});

test('v2: an answer cut off mid-JSON keeps the items it finished', async () => {
  const cut = '{"wrong":[{"turn":2,"quote":"Fill my week is on Growth.","why":"Pro only","kind":"plan"},{"turn":4,"quote":"bo';
  const f = async (url, o) => { const b = JSON.parse(o.body); return { json: async () => ({ content: [{ type: 'text', text: /strict second reader/.test(b.system) ? '{"verdicts":[{"i":1,"v":"error","why":"Pro only"}' : cut }] }) }; };
  const call = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }, { r: 'a', t: 'Fill my week is on Growth.' }];
  const r = await G.factCheck2({ ANTHROPIC_API_KEY: 'k' }, call, 'Fill my week is on Pro.', f);
  assert.deepEqual(r.wrong.map(w => w.quote), ['Fill my week is on Growth.']); assert.equal(r.cand, 1);
});

test('Always Open\'s line runs v3 for every caller (Nov 23, 2026): the 10-minute sync sets it, Shoulder Tap off, no test-only extras', async () => {
  const V = await import('../src/voice.js');
  const H = await import('./rehearsal/harness.js');
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, facts) VALUES ('+17064602226', 'always-open', 'Always Open', 1, 'answering service', 'Eatonton, GA', '2026-11-22', ?1)").bind(JSON.stringify({ testFeatures: ['tap'], notes: 'x' })).run();
  await V.syncOwnLine(env);
  const f = JSON.parse((await DB.prepare("SELECT facts FROM voice_lines WHERE client_id = 'always-open'").first()).facts);
  assert.deepEqual(f.features, ['v3', 'g-closer', 'g-stock', 'g-ask3']); assert.deepEqual(f.off, ['tap']); assert.deepEqual(f.testFeatures, []);
  const L = V.lineView({ number: '+17064602226', client_id: 'always-open', business: 'Always Open', facts: JSON.stringify(f) });
  assert.ok(V.V3(L), 'v3 on'); assert.equal(V.V4(L), false);
  assert.equal(await V.syncOwnLine(env), false, 'a second sync changes nothing');
  assert.match((await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /\nFACTCHECK_LIVE = "1"\n/, 'real-call slips are sent to Christopher');
});

// ---------- callers that react (Nov 23, 2026) ----------
test('callerTurn: the caller speaks from their persona and agenda, reacting to the call so far', async () => {
  const V = await import('../src/voice.js');
  const seen = [];
  const f = async (url, o) => { seen.push(JSON.parse(o.body)); return { json: async () => ({ content: [{ type: 'thinking', thinking: '..' }, { type: 'text', text: '{"say":"ok but what does it cost me","hangup":false}' }] }) }; };
  const msgs = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'hi i run a bakery' }, { r: 'a', t: 'A bakery, nice. What can I do for you?' }];
  const r = await V.callerTurn({ ANTHROPIC_API_KEY: 'k' }, { persona: 'a bakery owner, busy, skeptical' }, ['hi i run a bakery', 'how much is it', 'is there a contract'], msgs, 2, f);
  assert.deepEqual(r, { say: 'ok but what does it cost me', hangup: false });
  assert.equal(seen[0].model, 'claude-sonnet-5-5'); assert.deepEqual(seen[0].thinking, { type: 'between_tools' });
  assert.match(seen[0].system, /You play a real person phoning the sales line of Always Open/);
  assert.match(seen[0].messages[0].content, /^PERSONA: a bakery owner, busy, skeptical\nAGENDA:\n1\. hi i run a bakery\n2\. how much is it\n3\. is there a contract\nThis is turn 2 of at most 10\.\n\nTHE CALL SO FAR\nMax: Always Open, this is Max\.\nYou: hi i run a bakery\nMax: A bakery, nice\./);
  const bad = async () => ({ json: async () => ({ content: [{ type: 'text', text: 'sure' }] }) });
  assert.equal(await V.callerTurn({ ANTHROPIC_API_KEY: 'k' }, {}, ['x'], msgs, 2, bad), null);
});

test('a reactive practice call: the first line is scripted, then the caller answers Max until they hang up', async () => {
  const V = await import('../src/voice.js');
  const H = await import('./rehearsal/harness.js');
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, facts) VALUES ('+17064602226', 'always-open', 'Always Open', 1, 'answering service', 'Eatonton, GA', '2026-11-22', ?1)").bind(JSON.stringify({ prices: 'Starter is $149 a month.' })).run();
  world.aiScript = ['A bakery, nice. Mornings must be busy. What made you call?', 'Starter is $149 a month, no contract.', 'Thanks for calling, take care.'];
  let n = 0;
  world.aiNote = b => /play a real person phoning/.test(b.system) ? (n++ === 0 ? { say: 'how much is it, roughly', hangup: false } : { say: 'ok thanks, bye', hangup: true }) : { score: 6, why: 'ok' };
  await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-23T12:00:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ number: '+17064602226', reactive: true, tag: 'rx', calls: [{ id: 'd-1', persona: 'a bakery owner', turns: ['hi i run a bakery', 'how much', 'contract?', 'what about reviews'] }] })).run();
  await V.rehearse(env);
  const r = JSON.parse((await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").first()).detail);
  assert.deepEqual(r.out.map(o => o.said), ['hi i run a bakery', 'how much is it, roughly', 'ok thanks, bye'], 'scripted first line, then the caller\'s own words, then goodbye');
  assert.equal(n, 2, 'no more caller turns after the goodbye');
  // a scripted call (no "reactive") is unchanged
  world.aiScript = ['One.', 'Two.']; n = 0;
  await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-23T12:01:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ number: '+17064602226', tag: 'sx', calls: [{ id: 'd-2', turns: ['first', 'second'] }] })).run();
  await V.rehearse(env);
  const s = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").all()).results.map(x => JSON.parse(x.detail)).find(x => x.tag === 'sx');
  assert.deepEqual(s.out.map(o => o.said), ['first', 'second']); assert.equal(n, 0);
});

test('v5 (practice only): the own line\'s prompt carries the example answers; v3 and the live line do not', async () => {
  const V = await import('../src/voice.js');
  const F = await import('../src/facts.js');
  const L = feat => Object.assign({ business: 'Always Open', own: true, features: feat }, F.ownLineFacts());
  const p5 = V.systemPrompt(L(['v5']), '+14045550187', 'en-US', false), p3 = V.systemPrompt(L(['v3']), '+14045550187', 'en-US', false);
  assert.match(p5, /This is how you sound on this line\. Match the length and the tone; the facts in them are true:\nCaller: so what is this, what do you guys do\nYou: We answer a business's calls/);
  assert.match(p5, /How you talk on this line \(most important\)/, 'v5 carries v3');
  assert.doesNotMatch(p3, /This is how you sound on this line/);
  assert.equal(V.V5_EXAMPLES.length, 15);
  // every price in the examples is a real price
  for (const [, m] of V.V5_EXAMPLES) for (const d of m.match(/\$\d+/g) || []) assert.ok(['$149', '$299', '$499'].includes(d), d);
  assert.doesNotMatch(V.systemPrompt({ business: 'Lane Plumbing', features: ['v5'] }, '+14045550187', 'en-US', false), /This is how you sound/, 'a business\'s line is not this');
});
