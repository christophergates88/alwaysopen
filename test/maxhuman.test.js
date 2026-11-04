// Max sounding human (Nov 4, 2026 brief): the prompt shows his manner with examples in the trade's own words, each turn
// tells him what the caller just named and what they heard before cutting him off, silences are read by what he just
// asked, a caller from earlier tonight is picked up where they left off, the voice settles on an urgent call, and every
// call gets a human grade (machine tells by code, a rubric read by Haiku).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const G = await import('../src/grades.js');

const line = (o) => Object.assign({ client_id: 'c1', business: 'Harbor Point Marina', industry: 'marina', town: 'Eatonton', spanish: 1, facts: '{}' }, o || {});

test('the prompt shows the manner with examples, in the trade’s words, and message-only examples for regulated offices', () => {
  const p = V.systemPrompt(V.lineView(line()), '+14785550142', 'en-US', false);
  assert.match(p, /How it sounds/);
  assert.match(p, /Which slip is it in\?/, 'a marina example');
  assert.match(p, /never into water or touch power or gas/);
  assert.ok(p.length <= 14000, p.length + ' characters');
  const reg = V.systemPrompt(V.lineView(line({ business: 'Haskell Insurance', industry: 'insurance', regulated: 1 })), '', 'en-US', false);
  assert.match(reg, /I can't speak to coverage/);
  assert.doesNotMatch(reg, /depends on the house|Which slip/);
  assert.match(V.systemPrompt(V.lineView(line({ industry: 'plumbing' })), '', 'en-US', false), /All over the garage\. Is it gas or electric/);
});

test('what the caller named this turn, and nothing for names, addresses, numbers or a plain yes', () => {
  assert.deepEqual(V.mentioned("hi yeah um there's water coming through my kitchen ceiling like a lot of it"), ['water', 'kitchen ceiling']);
  assert.deepEqual(V.mentioned("this is the third time I've called today and nobody calls me back"), ['third time']);
  assert.deepEqual(V.mentioned("hey do you have a pontoon for this saturday, there's eight of us"), ['pontoon', 'saturday']);
  assert.deepEqual(V.mentioned("it's Tom, Tom Becker, 88 Pine Hill Road"), []);
  assert.deepEqual(V.mentioned('four seven eight five five five zero one nine nine is my number'), []);
  assert.deepEqual(V.mentioned('yes'), []);
  const notes = V.callerNotes({ line: {}, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, "there's water coming through my kitchen ceiling like a lot of it");
  assert.match(notes, /They just mentioned: water, kitchen ceiling\. Let your first few words show you caught one/);
});

test('cut off mid-sentence: Max is told what they heard, and not to say it again', () => {
  const s = { line: {}, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'leak' }, { r: 'a', t: 'Okay, so Saturday at eight —' }, { r: 'u', t: 'wait my number changed' }] };
  assert.match(V.callerNotes(s, 'wait my number changed'), /They cut you off after "Okay, so Saturday at eight"\. Do not say that part again/);
  assert.doesNotMatch(V.callerNotes({ line: {}, msgs: [{ r: 'a', t: 'Saturday at eight work?' }, { r: 'u', t: 'yes' }] }, 'yes'), /cut you off/);
});

test('silence is read by what Max just did, and no line is said twice in a call', () => {
  const s = { lang: 'en-US', msgs: [{ r: 'a', t: 'What’s the best number to reach you?' }] };
  assert.equal(V.idleLine(s, 1), 'Take your time.');
  assert.equal(V.idleLine(s, 1), 'No rush.', 'never the same one twice');
  assert.equal(V.idleLine({ lang: 'en-US', msgs: [{ r: 'a', t: 'Is the water off?' }] }, 1), 'Still there?');
  assert.equal(V.idleLine({ lang: 'en-US', msgs: [{ r: 'a', t: 'He’ll call you first thing.' }] }, 1), 'Hello? Are you there?');
  assert.equal(V.idleLine({ lang: 'es-US', msgs: [{ r: 'a', t: '¿Cuál es su número?' }] }, 1), 'Con calma, tómese su tiempo.');
  assert.match(V.idleLine({ lang: 'en-US', msgs: [] }, 2), /not hearing anything/);
});

test('a caller from earlier tonight: one line from that call’s write-up', () => {
  const now = Date.parse('2026-11-04T23:00:00Z');
  const n = V.earlierCall({ at: '2026-11-04T22:20:00Z', caller_name: 'Dana Ruiz', reason: 'Leak through the kitchen ceiling from the upstairs toilet' }, now);
  assert.equal(n, 'This number called 40 minutes ago (Dana Ruiz) about: Leak through the kitchen ceiling from the upstairs toilet. The team already has that message.');
  assert.equal(V.earlierCall(null, now), '');
  assert.equal(V.earlierCall({ at: '2026-11-04T22:20:00Z', reason: '' }, now), '');
  const L = V.lineView(line()); L.earlier = n;
  assert.match(V.systemPrompt(L, '', 'en-US', false), /Earlier tonight[\s\S]*Hi again, about the leak\?/);
});

test('Flux and the urgent voice are switched per line; v4 voices are allowed', () => {
  assert.equal(V.fluxFor({}, { spanish: 0, facts: '{}' }), true);
  assert.equal(V.fluxFor({}, { spanish: 1, facts: '{}' }), false, 'a Spanish line keeps its recognizer until switched');
  assert.equal(V.fluxFor({}, { spanish: 1, facts: '{"flux":1}' }), true);
  assert.equal(V.fluxFor({ VOICE_FLUX: 'all' }, { spanish: 1, facts: '{}' }), true);
  assert.equal(V.urgentVoice({}, { facts: '{}' }), '', 'off unless switched on');
  assert.equal(V.urgentVoice({}, { facts: '{"delivery":1}' }), 'UgBBYS2sOqTuMpoF3BR0-flash_v2_5-0.95_0.7_0.8');
  assert.deepEqual(V.voiceFor({ facts: '{"voice":"UgBBYS2sOqTuMpoF3BR0-v4"}' }), { provider: 'ElevenLabs', voice: 'UgBBYS2sOqTuMpoF3BR0-v4' });
  assert.equal(V.urgentVoice({}, { facts: '{"delivery":1,"voice":"UgBBYS2sOqTuMpoF3BR0-v4"}' }), '', 'v4 takes no speed');
});

test('machine tells are counted by code', () => {
  const msgs = [{ r: 'a', t: 'Greeting.' }, { r: 'u', t: 'leak' }, { r: 'a', t: 'Got it. I can assist you with that. Is the water off? And where is it?' },
    { r: 'u', t: 'yes' }, { r: 'a', t: 'Got it. I can take your name.' }, { r: 'u', t: '4785550199' },
    { r: 'a', t: 'That is four seven eight, five five five, zero one nine nine.' }, { r: 'u', t: 'yes' }, { r: 'a', t: 'So four seven eight, five five five, zero one nine nine, right?' }];
  const t = G.machineTells(msgs);
  assert.ok(t.some(x => /two questions/.test(x)), t.join('; '));
  assert.ok(t.some(x => /corporate phrase: "assist you"/.test(x)));
  assert.ok(t.some(x => /same opening twice: "i can"/.test(x)));
  assert.ok(t.some(x => /read the phone number back 2 times/.test(x)));
  assert.deepEqual(G.machineTells([{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'leak' }, { r: 'a', t: 'Through the ceiling, okay. Is the water off?' }]), []);
});

test('the human grade reads a fixed rubric and keeps only the number', async () => {
  const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'leak in the ceiling' }, { r: 'a', t: 'Through the ceiling, okay. Is the water off?' }, { r: 'u', t: 'yes' }];
  let sent = null;
  const f = async (u, i) => { sent = JSON.parse(i.body); return new Response(JSON.stringify({ content: [{ text: '{"score": 8, "why": "Specific and calm."}' }] })); };
  assert.deepEqual(await G.humanScore({ ANTHROPIC_API_KEY: 'k' }, msgs, f), { score: 8, why: 'Specific and calm.' });
  assert.equal(sent.model, 'claude-haiku-5-5'); assert.equal(sent.system, G.HUMAN_RUBRIC); assert.match(sent.messages[0].content, /Caller: leak in the ceiling\nMax: Through the ceiling/);
  assert.equal((await G.humanScore({ ANTHROPIC_API_KEY: 'k' }, msgs, async () => new Response('{"content":[{"text":"eleven"}]}'))).score, -1);
  assert.equal((await G.humanScore({}, msgs)).score, -1);
});
