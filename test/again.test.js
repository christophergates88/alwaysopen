// Nov 23, 2026: Max telling a caller again what he already told them (g-again), and the quick reaction ("Okay.",
// "Got it.") said only when his answer is slow to start (lead-late).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const G = await import('../src/guards.js');
const H = await import('./rehearsal/harness.js');

const own = f => ({ business: 'Always Open', own: true, features: f, prices: 'Starter is $149 a month.' });
const call = [
  { r: 'a', t: 'Always Open, this is Max. I\'m an automated assistant, and calls are recorded.' },
  { r: 'u', t: 'hi i run a bakery, what is this' },
  { r: 'a', t: 'We answer your calls when you can\'t, day or night, and you get the caller\'s name and number on your phone right away.' },
  { r: 'u', t: 'how much' },
  { r: 'a', t: 'Starter is $149 a month, no contract, and the first month\'s refunded if it isn\'t worth it.' },
];
const ctx = (f, said, msgs) => { const m = (msgs || call).concat({ r: 'u', t: said }); return V.guardCtx(own(f), m, said, {}); };

test('g-again cuts a point Max already made on this call when the caller did not ask about it', () => {
  const raw = 'Every Google review gets a reply, and nothing posts until you approve it. Starter is $149 a month, no contract.';
  const g = G.guardText(raw, ctx(['g-again'], 'what about my google reviews, we get a lot of bad ones'));
  assert.equal(g.text.trim(), 'Every Google review gets a reply, and nothing posts until you approve it.');
  assert.deepEqual(g.cuts.map(c => c.guard), ['g-again']);
  // the same restated pitch
  const p = G.guardText('Nothing goes out without your OK. I answer every call, day or night, so nothing slips.', ctx(['g-again'], 'is there a way to approve stuff first'));
  assert.equal(p.text.trim(), 'Nothing goes out without your OK.');
  // off: unchanged
  assert.equal(G.guardText(raw, ctx([], 'what about my google reviews, we get a lot of bad ones')).text, raw);
});

test('g-again keeps a point the caller asked about, asked to hear again, or that is about what they just said', () => {
  const price = 'Starter is $149 a month, no contract.';
  assert.equal(G.guardText(price, ctx(['g-again'], 'wait so how much was it')).text, price, 'they asked about the price');
  assert.equal(G.guardText(price, ctx(['g-again'], 'sorry can you say that again')).text, price, 'they asked to hear it again');
  assert.equal(G.guardText('Anything else on your mind? Starter is $149 a month.', ctx(['g-again'], 'ok cool')).text.trim(), 'Anything else on your mind?');
  // a sentence about what they just said is the answer, not a repeat
  const bake = 'For a bakery, I answer the calls that come in while your hands are in dough.';
  assert.equal(G.guardText(bake, ctx(['g-again'], 'my hands are always in dough in the morning')).text, bake);
  // a point not made yet stays
  const tap = 'If they ask something only you know, I text you the question while they wait.';
  assert.equal(G.guardText(tap, ctx(['g-again'], 'what if they ask about custom cakes')).text, tap);
  // a question never goes
  assert.equal(G.guardText('Want Chris to call you about it?', ctx(['g-again'], 'ok')).text, 'Want Chris to call you about it?');
  // only Always Open's own line
  const biz = V.guardCtx({ business: 'Lane Plumbing', features: ['g-again'] }, call.concat({ r: 'u', t: 'ok' }), 'ok', {});
  assert.ok(!G.guardText('We fix drains. We answer every call, day or night.', biz).cuts.some(c => c.guard === 'g-again'));
  assert.ok(G.guardText('We fix drains. We answer every call, day or night.', ctx(['g-again'], 'ok')).cuts.some(c => c.guard === 'g-again'), 'the same words on the own line are cut');
  // a reply that would lose everything keeps what it had
  assert.equal(G.guardText(price, ctx(['g-again'], 'ok')).text, price);
});

test('lead-late: a stock reaction turns into a plain one that was not said in the last three turns', () => {
  const L = f => ({ business: 'Always Open', own: true, features: f });
  const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one' }];
  const lead = { kind: 'q', text: 'Good question.' };
  assert.equal(V.trimLead(lead, L(['v3']), msgs, ['Okay.']).text, 'Okay.', 'v3 alone: always "Okay."');
  assert.equal(V.trimLead(lead, L(['v3', 'lead-late']), msgs, ['Okay.']).text, 'Sure.');
  assert.equal(V.trimLead(lead, L(['v3', 'lead-late']), msgs, ['Okay.', 'Sure.', 'Right.']).text, 'Alright.');
  assert.equal(V.trimLead(lead, L(['v3', 'lead-late']), msgs, ['Sure.', 'Right.', 'Alright.']).text, 'Okay.', 'never "Mm-hm."');
  assert.equal(V.leadWait({}), 700); assert.equal(V.leadWait({ VOICE_LEAD_WAIT: '0' }), 0); assert.equal(V.leadWait({ VOICE_LEAD_WAIT: 'x' }), 700);
});

async function ownLine() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, facts) VALUES ('+17064602226', 'always-open', 'Always Open', 1, 'answering service', 'Eatonton, GA', '2026-11-22', ?1)").bind(JSON.stringify({ prices: 'Starter is $149 a month.' })).run();
  return { world, DB, env };
}
const longTurn = 'yeah so i run a bakery and we get a ton of calls in the morning when my hands are in dough and i honestly cannot pick up most of them';

test('lead-late on a practice call: the plain reaction is left out when the answer started in time, kept when it was slow', async () => {
  const { world, DB, env } = await ownLine();
  world.aiScript = ['A bakery, nice. What made you call?', 'That is exactly the call I pick up.'];
  world.aiNote = () => ({ score: 6, why: 'ok' });
  const req = (tag, f) => DB.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-23T14:00:00Z', 'rehearse-request', ?1)").bind(JSON.stringify({ number: '+17064602226', tag, features: f, calls: [{ id: 'x', turns: ['hi', longTurn] }] })).run();
  await req('fast', ['v3', 'lead-late']);
  await V.rehearse(env);
  let r = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").all()).results.map(x => JSON.parse(x.detail)).find(x => x.tag === 'fast');
  assert.equal(r.out[1].late, 'held', 'the answer was in at once, so no "Okay."');
  assert.equal(r.out[1].lead, '');
  assert.ok(r.out[1].first >= 0);
  // the wait set to nothing: every reaction is late enough to be said
  env.VOICE_LEAD_WAIT = '0';
  world.aiScript = ['A bakery, nice. What made you call?', 'That is exactly the call I pick up.'];
  await req('slow', ['v3', 'lead-late']);
  await V.rehearse(env);
  r = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").all()).results.map(x => JSON.parse(x.detail)).find(x => x.tag === 'slow');
  assert.equal(r.out[1].late, 'said');
  assert.ok(r.out[1].lead.length > 0);
  // switched off: the reaction is said as before, and no late marker
  delete env.VOICE_LEAD_WAIT;
  world.aiScript = ['A bakery, nice. What made you call?', 'That is exactly the call I pick up.'];
  await req('off', ['v3']);
  await V.rehearse(env);
  r = (await DB.prepare("SELECT detail FROM voice_log WHERE kind = 'rehearse'").all()).results.map(x => JSON.parse(x.detail)).find(x => x.tag === 'off');
  assert.equal(r.out[1].late, undefined);
  assert.ok(r.out[1].lead.length > 0, 'a long turn gets its quick reaction, as before');
});

// ---------- lead-late on a live call ----------
test('lead-late on a live call: no "Okay," before an answer that is ready in time; the reaction still covers a slow one', async () => {
  const { createHash } = await import('node:crypto');
  const CB = await import('../src/callbacks.js');
  const { default: worker } = await import('../src/index.js');
  const LINE = '+14785551077', CODE = 'r'.repeat(32);
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, {});
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c7', ?1, 'Quillen Plumbing', 1, 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, transfer_to, transfer_when, updated, owner_set, facts) VALUES (?1, 'c7', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', '', 'never', '2026-10-01', '{}', ?2)").bind(LINE, JSON.stringify({ features: ['v3', 'lead-late'] })).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => { const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY; return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } }); };
  const room = async (sid, from) => { await hook('in', { CallSid: sid, To: LINE, From: from }); env.CALLROOM.get(sid); const x = env.CALLROOM._rooms.get(sid); await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from })); return x; };
  const say = (x, words) => x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  const texts = (x, from) => x.ws.sent.filter(m => m.type === 'text').slice(from).map(m => String(m.token || '').trim()).filter(Boolean);
  const isLead = t => /^(okay|sure|right|alright|mm-hm|got it|gotcha|you bet|of course|yeah|nice|hmm|perfect|great|absolutely)[,.]?$/i.test(t);

  // fast: the answer is in at once, so nothing goes out before it
  const x = await room('CA' + '7'.repeat(32), '+14785557001');
  world.aiScript = ['Sure, what can I help with?', 'We fix drains and water heaters, and we can come out today.'];
  await say(x, 'hello');
  let from = texts(x, 0).length;
  await say(x, longTurn);
  let t = texts(x, from);
  assert.ok(t.length && !isLead(t[0]), 'the first thing said is the answer: ' + JSON.stringify(t));
  let s = await x.room.load();
  assert.doesNotMatch(s.msgs.filter(m => m.r === 'a').at(-1).t, /^(Okay|Sure|Right|Alright|Mm-hm|Got it|Gotcha)\b[.,]/, 'and the transcript has no reaction either');

  // slow: the model takes longer than the wait, so the reaction goes out first, and the transcript keeps it
  env.VOICE_LEAD_WAIT = '15'; world.aiDelayMs = 150;
  world.aiScript = ['We can usually come the same day.'];
  from = texts(x, 0).length;
  await say(x, longTurn + ' and also how soon could somebody come out to look at it');
  t = texts(x, from);
  assert.ok(t.length >= 2 && isLead(t[0]), 'a quick reaction covered the wait: ' + JSON.stringify(t));
  s = await x.room.load();
  const last = s.msgs.filter(m => m.r === 'a').at(-1);
  assert.ok(last.lead && last.t.startsWith(last.lead), JSON.stringify(last));
  assert.ok(s.leads.includes(last.lead), 'it counts toward the recent reactions');
  world.aiDelayMs = 0; delete env.VOICE_LEAD_WAIT;
});
