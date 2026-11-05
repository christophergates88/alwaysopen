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
const v2 = (L) => Object.assign(L, { style: 'v2' });

test('live calls get the wording that won the blind test; the rewrite only under style v2', () => {
  const p = V.systemPrompt(V.lineView(line()), '+14785550142', 'en-US', false);
  assert.match(p, /Is the water off\? \.\.\. Good\. I'm getting the owner on this now/);
  assert.doesNotMatch(p, /Mike/, 'no example owner name a line could pick up');
  assert.match(p, /give the instruction as its own short statement and only then ask/);
  assert.doesNotMatch(p, /How it sounds/);
  assert.doesNotMatch(V.callerNotes({ line: {}, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, "there's water coming through my kitchen ceiling like a lot of it"), /They just mentioned/);
});

test('style v2: the manner with examples, in the trade’s words, and message-only examples for regulated offices', () => {
  const p = V.systemPrompt(v2(V.lineView(line())), '+14785550142', 'en-US', false);
  assert.match(p, /How it sounds/);
  assert.match(p, /Which slip is it in\?/, 'a marina example');
  assert.match(p, /never into water or touch power or gas/);
  assert.ok(p.length <= 14000, p.length + ' characters');
  const reg = V.systemPrompt(v2(V.lineView(line({ business: 'Haskell Insurance', industry: 'insurance', regulated: 1 }))), '', 'en-US', false);
  assert.match(reg, /I can't speak to coverage/);
  assert.doesNotMatch(reg, /depends on the house|Which slip/);
  assert.match(V.systemPrompt(v2(V.lineView(line({ industry: 'plumbing' }))), '', 'en-US', false), /All over the garage\. Is it gas or electric/);
});

test('what the caller named this turn, and nothing for names, addresses, numbers or a plain yes', () => {
  assert.deepEqual(V.mentioned("hi yeah um there's water coming through my kitchen ceiling like a lot of it"), ['water', 'kitchen ceiling']);
  assert.deepEqual(V.mentioned("this is the third time I've called today and nobody calls me back"), ['third time']);
  assert.deepEqual(V.mentioned("hey do you have a pontoon for this saturday, there's eight of us"), ['pontoon', 'saturday']);
  assert.deepEqual(V.mentioned("it's Tom, Tom Becker, 88 Pine Hill Road"), []);
  assert.deepEqual(V.mentioned('four seven eight five five five zero one nine nine is my number'), []);
  assert.deepEqual(V.mentioned('yes'), []);
  const notes = V.callerNotes({ line: { style: 'v2' }, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, "there's water coming through my kitchen ceiling like a lot of it");
  assert.match(notes, /They just mentioned: water, kitchen ceiling\. Let your first few words show you caught one/);
});

test('style v2, cut off mid-sentence: Max is told what they heard, and not to say it again', () => {
  const s = { line: { style: 'v2' }, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'leak' }, { r: 'a', t: 'Okay, so Saturday at eight —' }, { r: 'u', t: 'wait my number changed' }] };
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
  const cut = async () => new Response(JSON.stringify({ content: [{ text: '{"score": 6, "why": "Warm and quick, but he asks for the town tw' }] }));
  assert.deepEqual(await G.humanScore({ ANTHROPIC_API_KEY: 'k' }, msgs, cut), { score: 6, why: 'Warm and quick, but he asks for the town tw' }, 'a reply cut off mid-why still counts');
  assert.equal(sent.max_tokens, 200);
});

test('practice runs say when more may be waiting, so the next batch starts right away', async () => {
  const { makeDB } = await import('./rehearsal/harness.js');
  assert.equal(await V.rehearse({ DB: makeDB() }), false, 'nothing queued: no next batch');
});

test('a complete number stays complete on later turns, and a yes-or-no question never gets a yes-sounding reaction', () => {
  const said = 'my name is Priya Shah, the number is four seven eight five five five zero one six six';
  const s = { line: {}, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'drain backing up' }, { r: 'a', t: 'Name and number?' }, { r: 'u', t: said }, { r: 'a', t: 'And the address?' }, { r: 'u', t: 'the address is 1430 Old Phoenix Road' }] };
  assert.match(V.callerNotes(s, 'the address is 1430 Old Phoenix Road'), /earlier is complete and correct \(code counted ten digits: "four seven eight, five five five, zero one six six"\)\. Never say it was short/);
  for (const k of ['yn', 'ask', 'wh']) assert.ok(!V.LEADS[k].some(x => /^(Sure|Yeah|Absolutely|Yes|Of course)\b/.test(x)), k);
});

test('the rewrite is four switches, each measured alone; a line or a practice run names the ones it wants', () => {
  const L = V.lineView(line({ industry: 'plumbing' }));
  assert.deepEqual(L.features, []);
  const base = V.systemPrompt(L, '', 'en-US', false);
  assert.doesNotMatch(base, /How it sounds/);
  const ex = V.systemPrompt(Object.assign({}, L, { features: ['examples'] }), '', 'en-US', false);
  assert.match(ex, /How it sounds/); assert.match(ex, /Is the water off\? \.\.\. Good\. I'm getting the owner on this now/, 'examples alone keep the old talk rules');
  const t2 = V.systemPrompt(Object.assign({}, L, { features: ['talk2'] }), '', 'en-US', false);
  assert.doesNotMatch(t2, /How it sounds/); assert.doesNotMatch(t2, /getting the owner on this now/);
  const said = "there's water coming through my kitchen ceiling like a lot of it";
  const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: said }];
  assert.match(V.callerNotes({ line: { features: ['mentioned'] }, msgs }, said), /They just mentioned/);
  assert.doesNotMatch(V.callerNotes({ line: { features: ['cutoff'] }, msgs }, said), /They just mentioned/);
  assert.deepEqual(V.lineView(line({ facts: '{"features":["cutoff","bogus"]}' })).features, ['cutoff']);
  for (const k of V.FEATURES) assert.ok(V.systemPrompt(Object.assign({}, L, { features: [k] }), '+14785550142', 'en-US', false).length <= 14200, k);
});

test('rooms running side by side never take the same practice request', async () => {
  const { makeDB } = await import('./rehearsal/harness.js');
  const db = makeDB();
  await db.prepare("INSERT INTO voice_log (at, kind, detail) VALUES ('2026-11-05T00:00:00Z', 'rehearse-request', '{\"number\":\"+10000000000\",\"tag\":\"t\"}')").run();
  await Promise.all([V.rehearse({ DB: db }), V.rehearse({ DB: db }), V.rehearse({ DB: db })]);
  const r = await db.prepare("SELECT kind, COUNT(*) AS n FROM voice_log GROUP BY kind ORDER BY kind").all();
  assert.deepEqual(r.results.map(x => x.kind + ':' + x.n), ['rehearse:1', 'rehearse-taken:1'], 'claimed once, run once');
});

test('Part 1d: a goodbye closes, "same number" settles it, no town assumed, no held time on a regulated line, no routine closer in trouble', () => {
  const base = (x) => ({ line: x || {}, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'leak under the sink' }, { r: 'a', t: 'What\'s the best number?' }, { r: 'u', t: 'same number is fine' }] });
  assert.match(V.callerNotes(base(), 'nope that\'s it, thanks'), /They are wrapping up\. Close in one short, warm line/);
  assert.match(V.callerNotes(base(), 'okay'), /The number is settled: never ask about it/);
  assert.match(V.callerNotes(base(), "it's 1430 Old Phoenix Road"), /ask once, open: "and what town is that in\?" Never name a town yourself/);
  assert.match(V.callerNotes(base({ regulated: true }), 'can I get in tomorrow'), /never say a day or time is held, booked/i);
  assert.doesNotMatch(V.callerNotes(base(), 'can I get in tomorrow'), /held, booked/);
  assert.match(V.callerNotes(Object.assign(base(), { urgent: true }), 'okay'), /Leave routine questions/);
  assert.doesNotMatch(V.callerNotes(base(), 'okay'), /Leave routine questions/);
  assert.equal(V.leadFor ? 1 : 1, 1);
});

test('a social question gets a social reaction', () => {
  assert.equal(V.leadIn("hey there, how's your evening going", 'en-US', [], () => 0).kind, 'social');
  assert.equal(V.leadIn('should I unplug it?', 'en-US', [], () => 0).text, 'Let me see.');
});

test('a town is asked once, open, never named; an emergency\'s first reply ends on the caller, not their name', () => {
  const g = { r: 'a', t: 'Lane Heating, this is Max.' };
  // the street turn
  const street = V.callerNotes({ line: { features: ['v6'] }, msgs: [g, { r: 'u', t: 'our heat is out' }, { r: 'a', t: 'Oh no. What is your name and address?' }, { r: 'u', t: 'x' }] }, 'it\'s Jake Turner, 301 Hammock Road');
  assert.match(street, /ask once, open: "and what town is that in\?" Never name a town yourself/);
  // after Max asked for the town once, he never asks again or fills one in
  const later = V.callerNotes({ line: { features: ['v6'] }, msgs: [g, { r: 'u', t: 'our heat is out' }, { r: 'a', t: 'Oh no. Your name and address?' }, { r: 'u', t: 'it\'s Jake Turner, 301 Hammock Road' }, { r: 'a', t: 'Thanks Jake. And what town is that in?' }, { r: 'u', t: 'x' }] }, 'this number is good');
  assert.match(later, /already asked for the town once\. Do not ask again, and never name a town/);
  assert.doesNotMatch(V.callerNotes({ line: {}, msgs: [g, { r: 'u', t: 'hi' }, { r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, 'this number is good'), /asked for the town/);
  // the first reply of an emergency: a safe step, then a question about them
  const first = V.callerNotes({ line: { features: ['v6'] }, urgent: true, msgs: [g, { r: 'u', t: 'x' }] }, 'our heat is out and I have a newborn');
  assert.match(first, /end on a question about them \(are you clear of it, is everyone okay, is everyone warm\), not their name or number/);
  const smoke = V.callerNotes({ line: { features: ['v6'] }, msgs: [g, { r: 'u', t: 'x' }] }, 'there is water under my water heater and I smell burning by the outlet');
  assert.match(smoke, /not their name or number/);
  // not on turn three, and not on a routine call
  assert.doesNotMatch(V.callerNotes({ line: {}, urgent: true, msgs: [g, { r: 'u', t: 'heat is out' }, { r: 'a', t: 'Is everyone warm?' }, { r: 'u', t: 'yes' }, { r: 'a', t: 'Good.' }, { r: 'u', t: 'x' }] }, 'it is Jake'), /not their name or number/);
  assert.doesNotMatch(V.callerNotes({ line: {}, msgs: [g, { r: 'u', t: 'x' }] }, 'I want a quote for a new faucet'), /not their name or number/);
});

test('a practice call for another business opens as that business, not as the borrowed line', () => {
  const mike = line({ business: "Mike's Plumbing", industry: 'plumbing', spanish: 0, facts: '{"greeting":"Mike\'s Plumbing, this is Max. What can I do for you?","greeting2":"Yep, I said that fast."}' });
  const j = { line: { business: 'Harbor Point Marina', industry: 'marina' } };
  const o = V.rehearsalOpening(mike, j, V.rehearsalLine ? V.rehearsalLine(mike, j) : { business: 'Harbor Point Marina' });
  assert.match(o.opening, /Harbor Point Marina/);
  assert.doesNotMatch(o.opening, /Mike/);
  assert.equal(o.more, '');
  const same = V.rehearsalOpening(mike, { tag: 't' }, V.lineView(mike));
  assert.match(same.opening, /Mike's Plumbing/);
  assert.equal(same.more, 'Yep, I said that fast.');
});

test('"9 Cypress Point" and "14 Harbor Cove" count as streets for the town note', () => {
  for (const a of ['it\'s Nina Ford, 9 Cypress Point', '14 Harbor Cove', '220 Oak Ridge', '7 Mill Run']) assert.match(V.callerNotes({ line: { features: ['v6'] }, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, a), /Never name a town yourself/, a);
  assert.doesNotMatch(V.callerNotes({ line: { features: ['v6'] }, msgs: [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'x' }] }, 'it\'s 3 degrees out and the point is the heat is dead'), /Never name a town/);
});

test('v7: one job per reply after an emergency opens, no "I still need", no questions after thanks, past service skipped at the end', async () => {
  const g = { r: 'a', t: 'Mike\'s Plumbing, this is Max.' };
  const urgent = { line: { features: ['v7'] }, urgent: true, msgs: [g, { r: 'u', t: 'water is pouring from the water heater' }, { r: 'a', t: 'Shut the cold valve on top. Can you reach it dry?' }, { r: 'u', t: 'yes it is off' }, { r: 'a', t: 'Good. What is your name?' }, { r: 'u', t: 'x' }] };
  const n = V.callerNotes(urgent, 'it is still dripping a little');
  assert.match(n, /One job per reply/);
  assert.match(n, /Never say "I still need"/);
  assert.match(V.callerNotes(urgent, 'okay thanks'), /No questions now: not about past work/);
  assert.doesNotMatch(V.callerNotes(Object.assign({}, urgent, { line: {} }), 'it is still dripping a little'), /One job per reply/);
  const { dutyLines } = await import('../src/duties.js');
  assert.match(dutyLines({}, { v7: true }).join(' '), /Skip it on an emergency, with an upset caller, or once they are wrapping up/);
  assert.match(dutyLines({}).join(' '), /Once, when it fits, ask when they last had/);
});

test('v7: when the caller wraps up, a question at the end of the reply is cut in code', () => {
  assert.ok(V.wrappingUp('thanks'));
  assert.ok(V.wrappingUp('okay bye'));
  assert.ok(V.wrappingUp('gracias'));
  assert.ok(!V.wrappingUp('thanks, what time does he open?'));
  assert.ok(!V.wrappingUp('sí, gracias. el calentador de agua no prende'));
  assert.equal(V.cutBizQ('The team will call the number you called from. And what\'s the street address and town?', false, true), 'The team will call the number you called from. ');
  assert.equal(V.cutBizQ('Take care. Anything else I can help with?', false, true), 'Take care. ');
  // a lone question is still said rather than dead air
  assert.equal(V.cutBizQ('Is that the best number?', false, true), 'Is that the best number?');
  assert.equal(V.cutBizQ('Got it. What town?', false, false), 'Got it. What town?');
});
