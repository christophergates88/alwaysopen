// Duels and the side-by-side judge (Nov 23, 2026): two versions of Max answer the same moment of a call, and a judge
// picks the better reply twice, with the replies swapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const G = await import('../src/grades.js');
const V = await import('../src/voice.js');
const H = await import('./rehearsal/harness.js');

const msgs = [{ r: 'a', t: 'Always Open, this is Max.' }, { r: 'u', t: 'how much is it' }];
// a fake judge: says A or B (or same) by what it is shown
const judgeFake = (pickFor, seen) => async (url, o) => {
  const b = JSON.parse(o.body); if (seen) seen.push(b);
  const t = b.messages[0].content, A = /REPLY A\n([^\n]*)/.exec(t)[1], B = /REPLY B\n([^\n]*)/.exec(t)[1];
  return { json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ better: pickFor(A, B), why: 'because' }) }] }) };
};

test('judgePair asks twice with the replies swapped, and keeps a pick only when it holds both ways', async () => {
  const env = { ANTHROPIC_API_KEY: 'k' }, seen = [];
  // always prefers the short one: the same pick both ways
  const short = (A, B) => A.length < B.length ? 'A' : 'B';
  let r = await G.judgePair(env, msgs, 'Starter is $149 a month.', 'Great question! So our pricing has three tiers, starting with Starter at $149.', 'PRICES: Starter is $149 a month.', {}, judgeFake(short, seen));
  assert.equal(r.pick, 'a'); assert.equal(r.firm, true); assert.equal(r.ab, 'a'); assert.equal(r.ba, 'a');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].model, 'claude-opus-5-5'); assert.equal(seen[0].thinking, undefined, 'Opus takes no thinking setting');
  assert.match(seen[0].messages[0].content, /^FACTS\nPRICES: Starter is \$149 a month\.\n\nTHE CALL SO FAR\nMax: Always Open, this is Max\.\nCaller: how much is it\n\nREPLY A\nStarter is \$149 a month\.\n\nREPLY B\nGreat question!/);
  assert.match(seen[1].messages[0].content, /REPLY A\nGreat question![^\n]*\n\nREPLY B\nStarter is \$149 a month\./, 'swapped the second time');
  // always says A: flips with the order, so it is a split, not a pick
  r = await G.judgePair(env, msgs, 'one', 'two', '', {}, judgeFake(() => 'A'));
  assert.equal(r.pick, 'split'); assert.equal(r.firm, false);
  // "same" one way and a side the other way leans to that side
  r = await G.judgePair(env, msgs, 'one', 'two', '', {}, judgeFake((A) => A === 'one' ? 'A' : 'same'));
  assert.equal(r.pick, 'a'); assert.equal(r.firm, false);
  r = await G.judgePair(env, msgs, 'one', 'two', '', {}, judgeFake(() => 'same'));
  assert.equal(r.pick, 'same'); assert.equal(r.firm, true);
  // an unreadable answer is no pick, never a guess
  r = await G.judgePair(env, msgs, 'one', 'two', '', {}, async () => ({ json: async () => ({ content: [{ type: 'text', text: 'hmm' }] }) }));
  assert.equal(r.pick, null);
  assert.equal((await G.judgePair({}, msgs, 'one', 'two', '')).pick, null);
});

test('judgePair: the owner\'s notes ride along, and another judge model can be named', async () => {
  const seen = [];
  await G.judgePair({ ANTHROPIC_API_KEY: 'k' }, msgs, 'one', 'two', '', { model: 'claude-sonnet-5-5', guide: 'Shorter wins when both are true.' }, judgeFake(() => 'same', seen));
  assert.equal(seen[0].model, 'claude-sonnet-5-5'); assert.deepEqual(seen[0].thinking, { type: 'between_tools' });
  assert.match(seen[0].system, /\n\nWHAT THE OWNER OF ALWAYS OPEN WANTS[^\n]*\nShorter wins when both are true\.$/);
  assert.match(seen[0].system, /^You compare two possible next replies from Max/);
});

async function ownLine() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, facts) VALUES ('+17064602226', 'always-open', 'Always Open', 1, 'answering service', 'Eatonton, GA', '2026-11-22', ?1)").bind(JSON.stringify({ prices: 'Starter is $149 a month.' })).run();
  return { world, DB, env };
}

test('a duel: two versions answer exactly the same call so far, and the judge reads both replies', async () => {
  const { world, DB, env } = await ownLine();
  const seenMax = [];
  // v5's prompt carries the example answers; the fake Max answers by which version it is
  world.aiScript = [b => { seenMax.push(b); return /This is how you sound on this line/.test(JSON.stringify(b.system)) ? 'Starter is $149 a month, no contract.' : 'Great question! We have three plans, and Starter is $149 a month.'; }];
  world.aiNote = b => /You compare two possible next replies/.test(b.system) ? (() => { const t = b.messages[0].content, A = /REPLY A\n([^\n]*)/.exec(t)[1]; return { better: /^Starter/.test(A) ? 'A' : 'B', why: 'shorter, answers first' }; })() : { score: 6, why: 'ok' };
  const prefix = [{ r: 'u', t: 'hi i run a bakery' }, { r: 'a', t: 'A bakery, nice. What can I do for you?' }, { r: 'u', t: 'how much is it' }];
  await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-23T13:00:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ number: '+17064602226', tag: 'D1', a: { features: ['v3'] }, b: { features: ['v5'] }, judge: true, duel: [{ id: 'm-1', open: true, msgs: prefix }, { id: 'bad', msgs: [{ r: 'a', t: 'ends on Max' }] }] })).run();
  await V.rehearse(env);
  const rows = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-duel'").all()).results.map(r => JSON.parse(r.detail));
  assert.equal(rows.length, 1, 'a moment that does not end on the caller is skipped');
  const d = rows[0];
  assert.equal(d.tag, 'D1'); assert.equal(d.id, 'm-1');
  assert.match(d.a.reply, /Great question\W+We have three plans/); assert.match(d.b.reply, /^(\S+ )*Starter is \$149 a month, no contract\.$/);
  assert.equal(seenMax.length, 2, 'Max was asked once per version');
  // both saw the same words: the greeting, then the call so far, ending on "how much is it"
  for (const b of seenMax) assert.equal(b.messages.at(-1).role, 'user');
  assert.deepEqual(seenMax[0].messages.map(m => JSON.stringify(m.content)), seenMax[1].messages.map(m => JSON.stringify(m.content)));
  assert.equal(d.msgs[0].r, 'a'); assert.match(d.msgs[0].t, /Always Open/); assert.deepEqual(d.msgs.at(-1), { r: 'u', t: 'how much is it' });
  assert.equal(d.judge.pick, 'b'); assert.equal(d.judge.firm, true);
  // the judge again on the saved duel, with notes, no new replies from Max
  const rid = (await DB.prepare("SELECT rowid AS id FROM voice_log WHERE kind = 'rehearse-duel'").first()).id;
  world.aiNote = b => /You compare two possible next replies/.test(b.system) ? { better: 'same', why: /WHAT THE OWNER/.test(b.system) ? 'noted' : 'x' } : {};
  await DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-23T13:05:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ tag: 'J1', rejudge: [rid, 999999], guide: 'Shorter wins.', judgeModel: 'claude-sonnet-5-5' })).run();
  await V.rehearse(env);
  const js = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse-judge'").all()).results.map(r => JSON.parse(r.detail));
  assert.equal(js.length, 1);
  assert.equal(js[0].row, rid); assert.equal(js[0].id, 'm-1'); assert.equal(js[0].pick, 'same'); assert.equal(js[0].model, 'claude-sonnet-5-5'); assert.deepEqual(js[0].why, ['noted', 'noted']);
  assert.equal(seenMax.length, 2, 'Max was not asked again');
});
