// Nov 21, 2026, 5:37 PM: Christopher's test call to Always Open's own line, as a golf pro shop owner in Atlanta. Max pitched
// messages and Google reviews three times, called himself "just the phone line", agreed message-taking was "the core of
// it", said "it may not fit", and told him he could not book a tee time or fill his calendar (the site sells both). The
// caller hung up four seconds into that answer. The call's own transcript also lost sentences Max had said in full.
// One test or more per cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const F = await import('../src/facts.js');
const CB = await import('../src/callbacks.js');
const { default: worker } = await import('../src/index.js');

// ---------- what Max knows about Always Open ----------
test('Max is told what the site sells: booking on the call, the three-day check-in, Fill my week, and never to say it can\'t', () => {
  const f = F.ownLineFacts();
  assert.match(f.plans, /^Every plan, Starter included, has a booking and quote page customers can use any hour, and Max books visits right on the call/);
  assert.match(f.plans, /Pro adds the three-day check-in: three days after a job, Max calls the customer/);
  assert.match(f.plans, /Pro adds Fill my week: when the owner's Google Calendar has an open day coming up/);
  assert.match(f.plans, /Booking software other than Google Calendar \(a tee sheet/, 'what he cannot book into is said plainly, with what he does instead');
  assert.match(f.plans, /Growth adds [^.]*Storm Desk/);
  assert.match(f.plans, /Every plan, Starter included, has Shoulder Tap, except at insurance, medical and legal offices\./, 'every plan: a practice call put it on Growth and Pro');
  assert.match(f.services, /^Day to day:/);
  assert.match(f.services, /books the visit on the owner's calendar right on the call/);
  assert.match(f.services, /never say it can't; say Chris can go over it on the callback/);
  assert.match(f.services, /Never stop at taking messages/);
  // the site sells each of these, so Max saying them is not a new promise
  const site = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const t of ['Fill my week', 'The three-day check-in', 'Books the visit on your Google calendar', 'Storm Desk']) assert.ok(site.includes(t), t);
});
test('every sentence of the plans is one the own-line sync replaces, so two syncs never stack copies', async () => {
  const DB = H.makeDB();
  // the row as it stood on the live line on Nov 21, 2026 (plans and team from before this change, plus other notes)
  const oldPlans = 'Every plan, Starter included, has a booking and quote page customers can use any hour. Growth adds review requests after every job, posts from their photos, matching listings, every lead logged, and competitor watch. Pro adds their own business number with missed-call text-back and reminders for quotes, appointments and invoices; texting starts once carriers approve the number, about two weeks. Pro adds Outreach too: Max calls a list of businesses the owner gives him. A client cancels from the app, any month, with no fee; Chris from our team can help with that too.';
  const rest = 'The free audit is a one-page report on how they look online, within two business days. Access: they connect Google (and Facebook) with a sign-in button in the app, so no passwords are shared.';
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts, updated) VALUES ('+17064602226', 'always-open', 'Always Open', 1, ?1, '2026-11-16')").bind(JSON.stringify({ notes: oldPlans + ' ' + rest })).run();
  assert.equal(await V.syncOwnLine({ DB }), true);
  assert.equal(await V.syncOwnLine({ DB }), false, 'the second sync changes nothing');
  assert.equal(await V.syncOwnLine({ DB }), false, 'nor the third');
  const f = JSON.parse((await DB.prepare("SELECT facts FROM voice_lines WHERE client_id = 'always-open'").first()).facts);
  for (const k of ['Every plan, Starter included, has a booking', 'Every plan, Starter included, has Shoulder Tap', 'Booking software other than', 'Pro adds the three-day check-in', 'Pro adds Fill my week', 'Pro adds Outreach', 'Always Open is a small team', 'The free audit is a one-page report'])
    assert.equal(f.notes.split(k).length - 1, 1, k + ' once');
  assert.doesNotMatch(f.notes, /and competitor watch\. Pro/, 'the old Growth sentence is gone');
});

test('Max sees all of his notes: the own line\'s run past 3,000 characters and used to be cut mid-word', () => {
  const notes = 'Every plan, Starter included, has a booking page. ' + 'x'.repeat(3200) + ' Access: they connect Google with a sign-in button.';
  const L = V.lineView({ business: 'Always Open', client_id: 'always-open', facts: JSON.stringify({ notes, services: 's'.repeat(4500), hours: 'h'.repeat(3500) }) });
  assert.match(L.notes, /Access: they connect Google with a sign-in button\.$/);
  assert.equal(L.services.length, 4000, 'what we do gets room too (the own line\'s ran to 2,838 on Nov 21, 2026)');
  assert.equal(L.hours.length, 3000, 'other fields keep their cap');
});

// ---------- the trial prompt (prompt6) on Always Open's own line ----------
const OWN_GOAL = 'Callers are usually business owners. You are also the live demo, so be confident, warm and quick, never modest or self-deprecating. Order matters: once they say what kind of business they have, first tell them in a sentence or two how Always Open would help a business like theirs, with a concrete example.';
const own = () => {
  const L = V.lineView({ business: 'Always Open', client_id: 'always-open', facts: JSON.stringify({ goal: OWN_GOAL, services: F.SERVICES_DAY_FIRST, notes: F.ownLineFacts().plans, next: 'Chris will call them back within one business day.', intake: 'their business name, what kind of business it is, the town' }) });
  L.features = ['prompt6'];
  return L;
};

test('prompt6 on the own line carries the line\'s sales brief, which it used to drop', () => {
  const p = V.systemPrompt(own(), '+14783652533', 'en-US', false);
  assert.match(p, /On this line:\nCallers are usually business owners\. You are also the live demo/);
  assert.match(p, /you are also the live demo: how you handle this call is what their customers would get/);
  assert.doesNotMatch(p, /front-desk person/, 'not framed as a receptionist');
  assert.doesNotMatch(p.replace(/no "just the phone line"/, ''), /just the phone line/, 'never told to call himself "just the phone line"');
  assert.match(p, /Never put yourself down/);
});

test('prompt6 on the own line: value before the audit, no wrap-up on a no, never "that is all we do", never "we can\'t"', () => {
  const p = V.systemPrompt(own(), '+14783652533', 'en-US', false);
  assert.match(p, /Only after you have told them how Always Open would help a business like theirs, and they sound interested, you may offer once: "Want a free audit/);
  assert.doesNotMatch(p, /Once an owner is interested and you know their business and town, you may offer once/);
  assert.match(p, /3\. Once they want the audit or a call back, and not before, get what Chris needs/);
  assert.match(p, /A no to one offer is not a goodbye/);
  assert.doesNotMatch(p, /Ask once if there is anything else; on a no, say goodbye/);
  assert.match(p, /never agree that taking messages is all you do/);
  assert.match(p, /give them something bigger they have not heard yet \(booking the visit on the call, Shoulder Tap, the three-day check-in, Fill my week, Outreach\)/);
  assert.match(p, /- Say Always Open can't do something unless what you know says so\./);
  assert.match(p, /\n4\. When they want a call back[^\n]*\n5\. Only after/, 'numbered in order');
  // the harm rules are all still there
  for (const must of [/automated assistant/, /Make up a price/, /legal, medical, insurance/, /911/, /Social Security/, /\[END\]/, /first words answer it/, /15 words or fewer/]) assert.match(p, must);
  assert.equal(V.systemPrompt(own(), '', 'en-US', false), V.systemPrompt(own(), '', 'en-US', false), 'the same every turn, so the cache holds');
});

test('prompt6 on a business\'s line is unchanged except that side talk is not answered', () => {
  const L = { business: 'Lane Plumbing', town: 'Eatonton, GA', name: 'Max', services: 'Drains', features: ['prompt6'] };
  const p = V.systemPrompt(L, '+14785550142', 'en-US', false);
  assert.match(p, /You talk the way a good front-desk person does/);
  assert.match(p, /say you are just the phone line here, and ask what else you can do\. If they are talking to someone with them, do not answer that part\./);
  assert.match(p, /Ask once if there is anything else; on a no, say goodbye\./);
  assert.match(p, /4\. For a visit, ask what day and time work and say the team will confirm\./);
  assert.match(p, /6\. If they decide not to go ahead/);
  assert.doesNotMatch(p, /On this line:|live demo|can't do something unless/);
});

// ---------- what the caller heard, when they talked over Max ----------
test('heardOf: the sentences before the one Twilio was playing were heard in full', () => {
  const parts = ['Sorry about that.', 'Shoulder Tap means when a caller asks something only you know, I text you the question mid-call.', 'Outreach is on our top plan, where I call a list of businesses you give me.'];
  assert.equal(V.heardOf(parts, 'Outreach is on our top plan, where I cal'), 'Sorry about that. Shoulder Tap means when a caller asks something only you know, I text you the question mid-call. Outreach is on our top plan, where I cal');
  assert.equal(V.heardOf(parts, 'Sorry about'), 'Sorry about', 'cut in the first sentence: only that');
  assert.equal(V.heardOf(parts, ''), '', 'nothing heard');
  assert.equal(V.heardOf(parts, 'Something else entirely'), 'Something else entirely', 'no sentence it fits: as Twilio said it');
  assert.equal(V.heardOf(['One sentence only.'], 'One sen'), 'One sen');
  assert.equal(V.heardOf(null, 'x'), 'x');
  assert.equal(V.heardOf(['First part.', 'Okay, so Saturday at eight.'], 'Okay', 'Okay.'), 'Okay', 'still in the reaction: nothing of the answer counts as heard');
  assert.equal(V.heardOf(['I can\'t book the tee time myself, but I\'d take their name.', 'You\'d get that by text.'], 'You’d get'), 'I can\'t book the tee time myself, but I\'d take their name. You’d get', 'curly and straight quotes match');
});

const LINE = '+14785551001', CODE = 'q'.repeat(32);
const sidOf = n => 'CA' + String(n).padStart(32, '0');
async function mk() {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, {});
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier) VALUES ('c1', ?1, 'Quillen Plumbing', 1, 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, transfer_to, transfer_when, updated, owner_set) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', '', 'never', '2026-10-01', '{}')").bind(LINE).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    await hook('in', { CallSid: sid, To: LINE, From: from });
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return x;
  };
  const send = (x, m) => x.room.webSocketMessage(x.ws, JSON.stringify(m));
  const say = (x, words) => send(x, { type: 'prompt', voicePrompt: words, last: true });
  return { world, env, DB, room, send, say };
}

test('talked over in his second sentence: the transcript and Max\'s memory keep the one he finished', async () => {
  const w = await mk();
  const x = await w.room(sidOf(2101), '+14785552101');
  w.world.aiScript = ['Sure thing.', 'We fix drains and water heaters. We also put in new faucets and toilets, any brand you have.'];
  await w.say(x, 'hello');
  const before = x.ws.sent.filter(m => m.type === 'text').length;
  await w.say(x, 'what do you all do');
  // each sentence went out as its own utterance
  const sent = x.ws.sent.filter(m => m.type === 'text').slice(before).map(m => m.token.trim()).filter(Boolean);
  assert.equal(sent.length, 2, 'two utterances: ' + JSON.stringify(sent));
  // Twilio reports only the sentence it was playing: "We also put in new"
  await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: 'We also put in new', durationUntilInterruptMs: 3600 });
  const s = await x.room.load();
  const cut = s.msgs.filter(m => m.r === 'a').at(-1).t;
  assert.match(cut, /^We fix drains and water heaters\. We also put in new —$/, cut);
  assert.doesNotMatch(cut, /any brand/, 'what they never heard is not kept as said');
});

test('an empty talk-over just after a new reaction leaves the reply before it alone when that reply had finished playing', async () => {
  const w = await mk();
  const x = await w.room(sidOf(2102), '+14785552102');
  w.world.aiScript = ['Sure, ask away. What would you like to know about us?', 'We fix drains and water heaters.'];
  const real = Date.now;
  let t = real();
  try {
    Date.now = () => t;
    await w.say(x, 'I just have a few questions');
    // the answer plays in full, and the line goes quiet
    await w.send(x, { type: 'info', name: 'agentSpeaking', value: 'on' });
    t += 3000; await w.send(x, { type: 'info', name: 'agentSpeaking', value: 'off' });
    // two seconds later they ask their next question; the reaction goes out while they are still talking, and Twilio
    // cuts it before a word plays: an interrupt with nothing heard
    t += 2000; await w.say(x, 'what is it');
    t += 5; await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: '', durationUntilInterruptMs: 0 });
  } finally { Date.now = real; }
  const s = await x.room.load();
  const a = s.msgs.filter(m => m.r === 'a');
  assert.ok(a.some(m => /What would you like to know about us\?/.test(m.t)), 'the reply they heard is kept: ' + JSON.stringify(a.map(m => m.t)));
  assert.ok(!a.some(m => /^(Sure|Okay|Got it|Right)\.? —$/.test(m.t)), 'and not rewritten to a reaction and a dash');
});

test('an empty talk-over right after a reply that was still playing still marks that reply as cut (unchanged)', async () => {
  const w = await mk();
  const x = await w.room(sidOf(2103), '+14785552103');
  w.world.aiScript = ['Sure, ask away. What would you like to know about us?', 'We fix drains and water heaters.'];
  const real = Date.now;
  let t = real();
  try {
    Date.now = () => t;
    await w.say(x, 'I just have a few questions');
    await w.send(x, { type: 'info', name: 'agentSpeaking', value: 'on' });
    // they talk over it at once; the new turn starts before Twilio's interrupt for the old reply arrives
    t += 300; await w.say(x, 'wait');
    t += 5; await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: '', durationUntilInterruptMs: 0 });
  } finally { Date.now = real; }
  const s = await x.room.load();
  const a = s.msgs.filter(m => m.r === 'a');
  assert.ok(!a.some(m => /What would you like to know about us\?$/.test(m.t)), 'a reply still playing when they cut in is not kept as heard: ' + JSON.stringify(a.map(m => m.t)));
});

// ---------- found by the tester agents' practice calls, Nov 21, 2026 (52 calls, 4 versions of Max) ----------
test('"Is this a real person or a robot?" gets a plain answer, not "Yep." (which sounded like "yes, a real person")', () => {
  for (const q of ['hey uh yeah is this a real person or is this a robot', 'and are you a real person or a computer', 'are you a robot or a person?']) {
    const lead = V.leadIn(q, 'en-US', []);
    assert.equal(lead.kind, 'aieither', q);
    assert.equal(lead.text, 'Automated assistant, not a person.');
    const L = { aiJoke: 'I could sing for you, but you wouldn\'t like it.' };
    assert.equal(V.fixedReply(L, lead, []), L.aiJoke, 'the joke still follows, after the plain answer');
  }
  assert.equal(V.leadIn('are you a real person', 'en-US', []).kind, 'ishuman', 'one question, one answer');
  assert.equal(V.leadIn('are you a real person', 'en-US', []).text, 'Nope, automated assistant.', 'and it says what he is');
  assert.equal(V.leadIn('is this a robot?', 'en-US', []).kind, 'isai');
  assert.equal(V.leadIn('is this a robot?', 'en-US', []).text, 'Yep, automated assistant.');
  assert.notEqual(V.leadIn('do i need a person or a computer to set this up', 'en-US', []).kind, 'aieither', 'a question about setup is not about Max');
  // the old prompt keeps reactions only on the first answer; this one is always said
  const lead = V.leadIn('is this a real person or a robot', 'en-US', []);
  const msgs = [{ r: 'a', t: 'hi' }, { r: 'u', t: 'one' }, { r: 'a', t: 'two' }, { r: 'u', t: 'is this a real person or a robot' }];
  assert.equal(V.trimLead(lead, { business: 'Always Open' }, msgs, []).text, 'Automated assistant, not a person.');
});

test('an English sentence that mentions español does not switch the call to Spanish; asking for Spanish still does', () => {
  assert.equal(V.looksSpanish('my crew speaks mostly espanol, can you talk to the customers in spanish'), false);
  assert.equal(V.spanishOpener('my crew speaks mostly espanol, can you talk to the customers in spanish'), false);
  assert.equal(V.looksSpanish('can my customers hear it in español too'), false);
  for (const q of ['español', 'en español por favor', 'hablo español', 'español, necesito un plomero']) assert.equal(V.looksSpanish(q), true, q);
  assert.equal(V.spanishOpener('hola necesito ayuda con mi baño'), true);
});

test('a question inside quotes is an example, not Max asking: the rest of the reply is still said', () => {
  const say = chunks => { const sp = new V.Speaker(() => {}, 'en-US'); for (const c of chunks) sp.push(c); return sp.end(); };
  assert.equal(say(['That\'s what Shoulder Tap is for: I text you "can you come ', 'today?" and pass your answer back on the same call.']),
    'That\'s what Shoulder Tap is for: I text you "can you come today?" and pass your answer back on the same call.');
  assert.equal(say(['I text you “Saturday at ten?” while they hold. You answer, I pass it on.']), 'I text you “Saturday at ten?” while they hold. You answer, I pass it on.');
  assert.equal(say(['Is the water off? The valve is usually under the sink.']), 'Is the water off?', 'after a real question he still stops');
  assert.equal(say(['He said "no thanks" and hung up. Want me to try again? I can.']), 'He said "no thanks" and hung up. Want me to try again?');
});

test('a wife or kids named while talking business is not "their own life": no "I\'m just the phone line here"', () => {
  const own = { msgs: [], line: { own: true, business: 'Always Open' } }, biz = { msgs: [], line: { own: false, business: 'Lane Plumbing' } };
  for (const q of ['yeah hi uh my wife answers our phone and we got voicemail already so i dont really see why id pay for this', 'my wife keeps the schedule on a paper calendar on the fridge', 'my son does the books for us'])
    for (const s of [own, biz]) assert.doesNotMatch(V.callerNotes(s, q), /own life/, q);
  // a real aside still gets its note; on the own line it never says "just the phone line"
  assert.match(V.callerNotes(biz, 'my kids keep fighting and i dont know what to do'), /just the phone line here/);
  const n = V.callerNotes(own, 'my kids keep fighting and i dont know what to do');
  assert.match(n, /They mentioned their own life/);
  assert.match(n, /Never say you are "just the phone line"/);
});

test('Max knows reviews are never removed, Spanish costs nothing extra, which plan a feature is on, and not to text Chris product questions', () => {
  const f = F.ownLineFacts();
  assert.match(f.services, /Reviews are never removed or hidden by us/);
  assert.match(f.services, /Every plan answers callers in English and Spanish at no extra cost/);
  assert.match(f.services, /say which plan it is on/);
  assert.match(f.services, /checking with Chris mid-call is only for what just Chris can answer for this caller/);
  assert.match(f.services, /every call is still answered day or night, the message is on their phone right away \(an 8 p\.m\. call about a fender bender is on the agent's phone before bed, not in voicemail\), and every review reply is checked by Compliance Guard/);
  assert.match(f.services, /Once they give a name and number for a call back, say in that same reply that Chris will call them within one business day/);
  assert.match(f.plans, /Storm Desk \(when the National Weather Service issues a warning for their county, a storm-day post is drafted for them to approve\)/);
  assert.match(f.services, /On Pro, nothing goes quiet after the call: quotes and invoices that went quiet get a follow-up/, 'follow-ups are Pro, as the app and the pricing card have them');
  assert.doesNotMatch(f.services, /After the call, nothing goes quiet: quotes/);
  assert.match(f.about, /nobody guesses how long Always Open has been around or how many businesses use it/);
  assert.ok(f.services.length <= 4000, 'services fit the room lineView gives them: ' + f.services.length);
  const site = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(/English and Spanish/.test(site), 'the site says Spanish is on every plan');
});

test('asked whether he is a person, at any point in the call and on either version, Max says "automated assistant" first', () => {
  const qs = { 'is this a real person or is this a robot': 'Automated assistant, not a person.', 'are you a robot?': 'Yep, automated assistant.', 'are you a real person?': 'Nope, automated assistant.', 'am I talking to a real person?': 'Nope, automated assistant.' };
  const later = [{ r: 'a', t: 'hi' }, { r: 'u', t: 'one' }, { r: 'a', t: 'two' }, { r: 'u', t: 'three' }, { r: 'a', t: 'four' }];
  for (const [q, want] of Object.entries(qs)) {
    const raw = V.leadIn(q, 'en-US', []);
    // the prospects' version keeps reactions only on the first answer; this one is kept all call
    assert.equal(V.trimLead(raw, { features: [] }, later.concat([{ r: 'u', t: q }]), []).text, want, 'later in the call: ' + q);
    // the trial version uses each reaction once a call; this one is said every time
    assert.equal(V.trimLead(raw, { features: ['prompt6'] }, later.concat([{ r: 'u', t: q }]), [want, 'Okay.']).text, want, 'asked again: ' + q);
  }
});

test('the two numbers with nothing behind them leave the owner\'s notes on the next sync; the selling points stay', () => {
  const owner = "Lead with the after-hours value: most missed calls come after five, at lunch and on weekends, and you pick up at 2 a.m. If they ask why not hire a person: a part-time receptionist costs well over $1,000 a month, goes home at five and takes one call at a time; you answer every call, any hour, from $149 a month.";
  const once = V.sweepRetired(owner, 'Chris');
  assert.doesNotMatch(once, /most missed calls|\$1,000/);
  assert.match(once, /calls keep coming after five, at lunch and on weekends, and you pick up at 2 a\.m\./);
  assert.match(once, /a part-time hire costs several times as much, goes home at five and takes one call at a time/);
  assert.equal(V.sweepRetired(once, 'Chris'), once, 'a second sweep changes nothing');
});

test('after a question, the quick reaction is one that fits a no; a long turn always gets one', () => {
  const L = { features: ['prompt6'] };
  const asked = q => V.trimLead(V.leadIn(q, 'en-US', []), L, [{ r: 'u', t: q }], []);
  for (const q of ['can it quote my customers or talk coverage like what a policy covers', 'right but can you put people in vagaro or not. yes or no', 'is there a contract or a setup fee or something', 'what about the facebook and google posts do those just go out on their own'])
    assert.ok(!asked(q) || ['Hm.', 'Okay.'].includes(asked(q).text), q + ' -> ' + JSON.stringify(asked(q)));
  // every plain one already used this call, then a long turn: it still gets one
  const long = 'ok so i have been doing this twenty years and my wife handles the phones and honestly i just do not see how a computer is going to know what my customers need when they call';
  const lead = V.trimLead(V.leadIn(long, 'en-US', []), L, [{ r: 'u', t: long }], ['Okay.', 'Sure.', 'Right.', 'Got it.', 'Hm.', 'Mm-hm.', 'Oh, man.', 'Okay.']);
  assert.ok(lead && lead.text === 'Hm.', 'a long turn gets a plain reaction: ' + JSON.stringify(lead));
  // the prospects' version: past the first answer, a long turn keeps its reaction; a short one does not
  const msgs = q => [{ r: 'a', t: 'hi' }, { r: 'u', t: 'one' }, { r: 'a', t: 'two' }, { r: 'u', t: q }];
  assert.ok(V.trimLead(V.leadIn(long, 'en-US', []), { features: [] }, msgs(long), []), 'long turn keeps it');
  assert.equal(V.trimLead(V.leadIn('ok what else', 'en-US', []), { features: [] }, msgs('ok what else'), []), null, 'short turn does not');
});

test('restOf: what the caller never heard starts at the sentence that was cut', () => {
  const parts = ['You\'re right, I undersold it.', 'If a caller asks something only you know, I text you the question mid-call.', 'On Pro, I call a list of businesses you give me.'];
  assert.equal(V.restOf(parts, 'You\'re right, I undersold', ''), parts.join(' '));
  assert.equal(V.restOf(parts, 'If a caller asks', ''), parts.slice(1).join(' '));
  assert.equal(V.restOf(parts, '', ''), parts.join(' '), 'cut before a word: all of it');
  assert.equal(V.restOf(parts, 'Ye', 'Yep, I\'m here.'), parts.join(' '), 'cut in the reaction: all of it');
  assert.equal(V.restOf(parts, 'something else', ''), '', 'nothing it fits: nothing to pick up');
});

test('"Hello?" just after the caller cut Max off picks his reply up where it was cut, instead of an apology and a new answer', async () => {
  const w = await mk();
  const x = await w.room(sidOf(2104), '+14785552104');
  w.world.aiScript = ['Sure thing.', 'We fix drains and water heaters. We also put in new faucets and toilets, any brand you have.', 'This should not be needed.'];
  await w.say(x, 'hello');
  await w.say(x, 'what do you all do');
  await w.send(x, { type: 'interrupt', utteranceUntilInterrupt: 'We also put in new', durationUntilInterruptMs: 3600 });
  let s = await x.room.load();
  assert.equal(s.msgs.filter(m => m.r === 'a').at(-1).rest, 'We also put in new faucets and toilets, any brand you have.');
  const seen = w.world.aiSeen.length;
  await w.say(x, 'hello?');
  s = await x.room.load();
  const last = s.msgs.filter(m => m.r === 'a').at(-1).t;
  assert.match(last, /I'm here\. We also put in new faucets and toilets, any brand you have\.$/, last);
  assert.equal(w.world.aiSeen.length, seen, 'no new answer was written for it');
});

test('the call back is offered twice a call at most, and not again once they took it', async () => {
  const G = await import('../src/guards.js');
  const offer = 'Want Chris to call you and walk you through it?';
  const msgs = [{ r: 'a', t: 'Hi.' }, { r: 'u', t: 'what do you do' }, { r: 'a', t: 'We answer every call. ' + offer }, { r: 'u', t: 'maybe later' }, { r: 'a', t: 'Sure. I can have Chris give you a call, want that?' }, { r: 'u', t: 'what does it cost' }];
  assert.equal(G.callbackOffers(msgs).offered, 2);
  const L = { business: 'Always Open', own: true, features: [], prices: 'Starter is $149 a month, Growth is $299 a month, and Pro is $499 a month.' };
  const ctx = V.guardCtx(L, msgs, 'what does it cost', {});
  assert.ok(ctx.on.has('g-callback'), 'on for the prospects\' version');
  const out = G.guardText('Starter is $149 a month. ' + offer, ctx).text;
  assert.doesNotMatch(out, /Want Chris to call/, 'a third offer is held back: ' + out);
  assert.match(out, /Starter is \$149 a month\./);
  // taken: "yes" right after the offer, then no more offers
  const took = [{ r: 'a', t: offer }, { r: 'u', t: 'yeah sure' }, { r: 'a', t: 'Great.' }, { r: 'u', t: 'one more thing' }];
  assert.equal(G.callbackOffers(took).taken, true);
  // a first and second offer still go out
  const first = G.guardText('We answer every call. ' + offer, V.guardCtx(L, [{ r: 'u', t: 'what do you do' }], 'what do you do', {})).text;
  assert.match(first, /Want Chris to call you/);
  // a business's own line: the call back is the job there, never held back
  const biz = { business: 'Lane Plumbing', own: false, features: [] };
  assert.match(G.guardText('Got it. Want someone to call you back today?', V.guardCtx(biz, msgs, 'what does it cost', {})).text, /Want someone to call you back/);
});
