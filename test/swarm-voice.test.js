// Nov 24, 2026 fix wave (fix-voice): emergencies, robocalls, line limits and Max's prompt rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const V = await import('../src/voice.js');
const { callerNotes, leadIn, lineView, activeProblem } = V;

const PLUMB = lineView({ business: 'Acme Plumbing', town: 'Eatonton', facts: '{}', industry: 'plumbing', regulated: 0, client_id: 'x', transfer_to: '', transfer_when: 'never', spanish: 0 });
const OWN = lineView({ business: 'Always Open', town: 'Eatonton', facts: '{}', industry: '', regulated: 0, client_id: V.OWN_ID, transfer_to: '', transfer_when: 'never', spanish: 0 });
const LINES = [['plumbing', PLUMB], ['own', OWN]];
const notes = (L, t) => callerNotes({ line: L, msgs: [{ r: 'a', t: 'Hi' }, { r: 'u', t }], lang: 'en-US', urgent: activeProblem(t) }, t);
const PERSONAL_NOTE = /own life/;

// V1
const MEDICAL = ["my husband collapsed and he's not breathing", "my wife fell down the stairs and she's bleeding", "my baby swallowed something and she's choking", 'my kid got shocked by the outlet'];
const JOBS = ['my son flushed a toy and now the toilet is overflowing', "my baby's room is freezing, the heat isn't coming on", 'my daughter knocked out her front tooth', 'my son was in a car accident, is he covered'];
test('V1: a family member in an emergency is never small talk, and gets told to call 911', () => {
  for (const [nm, L] of LINES) for (const t of MEDICAL) {
    const lead = leadIn(t, 'en-US', []);
    assert.notEqual(lead && lead.kind, 'personal', nm + ': ' + t);
    const n = notes(L, t);
    assert.doesNotMatch(n, PERSONAL_NOTE, nm + ': ' + t);
    assert.doesNotMatch(n, /just the phone line here/, nm + ': ' + t);
    assert.match(n, /hang up and call 911 now/, nm + ': ' + t);
  }
});
test('V1: a family member in a real job is the job, not small talk', () => {
  for (const [nm, L] of LINES) for (const t of JOBS) {
    const lead = leadIn(t, 'en-US', []);
    assert.notEqual(lead && lead.kind, 'personal', nm + ': ' + t);
    assert.doesNotMatch(notes(L, t), PERSONAL_NOTE, nm + ': ' + t);
  }
});
test('V1: a true aside about the caller\'s life still gets the warm line', () => {
  for (const [nm, L] of LINES) for (const t of ['my kid is driving me nuts today', 'my wife thinks I work too much']) {
    assert.equal(leadIn(t, 'en-US', []).kind, 'personal', nm + ': ' + t);
    const n = notes(L, t);
    assert.match(n, PERSONAL_NOTE, nm + ': ' + t);
    assert.doesNotMatch(n, /911/, nm + ': ' + t);
  }
});
test('V1: shop talk that sounds medical is not a 911 call; the same words about a person are', () => {
  for (const t of ['I need my brakes bled, they feel spongy', 'the radiator needs bleeding', 'can you bleed the lines', "it's a two-stroke outboard", "four stroke engine won't start",
    'I was shocked by the price', 'I got shocked when I saw the bill', 'that quote nearly gave me a heart attack', 'the thermostat is unresponsive', 'my website is unresponsive',
    'the engine keeps choking out', 'the choke is stuck', 'the motor seized']) {
    assert.notEqual((leadIn(t, 'en-US', []) || {}).kind, 'danger', t);
    for (const [nm, L] of LINES) assert.doesNotMatch(notes(L, t), /911/, nm + ': ' + t);
  }
  for (const t of ["he's bleeding", "she's bleeding badly", 'my kid got shocked by the outlet', "he's unresponsive", "I think I'm having a stroke", "she's having a seizure", "he's choking"]) {
    assert.equal((leadIn(t, 'en-US', []) || {}).kind, 'danger', t);
    for (const [nm, L] of LINES) assert.match(notes(L, t), /hang up and call 911 now/, nm + ': ' + t);
  }
});

// V4
const notesEs = (L, t) => callerNotes({ line: L, msgs: [{ r: 'a', t: 'Hola' }, { r: 'u', t }], lang: 'en-US', urgent: activeProblem(t) }, t);
test('V4: common ways of saying gas, CO, chest pain, a break-in or a gun are urgent and get 911', () => {
  for (const t of ['I think I smell rotten eggs', 'sulfur smell by the water heater', 'my CO detector keeps going off', 'I smell guess in the house', "I'm having chest pains",
    'someone is trying to break in right now', "there's a guy with a gun outside", 'huele a huevo podrido', 'la alarma de monóxido de carbono está sonando', 'hay olor a gas']) {
    assert.ok(activeProblem(t), 'urgent: ' + t);
    assert.match(notesEs(PLUMB, t), /911/, '911: ' + t);
  }
});
test('V4: water near the furnace, a light fixture, a ceiling fan or the panel gets the water-and-electricity note', () => {
  for (const t of ['basement is flooded and the water is up to the furnace', 'water dripping into the light fixture', "water's coming out of the ceiling fan", 'hay agua cerca del panel eléctrico'])
    assert.match(notesEs(PLUMB, t), /Water may be near electricity/, t);
});
test('V4: fireplace, gas station, nail gun, a water heater quote are not emergencies', () => {
  for (const t of ['can you look at my fireplace', 'we got fired up about the new deck', 'I am at the gas station', 'I need a gas grill hookup quote', 'my nail gun', 'I need a new caulk gun',
    'I need a quote on a new water heater', 'my well water smells like rotten eggs', 'quote on a new light fixture and a ceiling fan', 'I want a new furnace installed next month']) {
    assert.ok(!activeProblem(t), 'urgent: ' + t);
    const n = notesEs(PLUMB, t);
    assert.doesNotMatch(n, /911/, '911: ' + t);
    assert.doesNotMatch(n, /Water may be near electricity/, 'water: ' + t);
  }
});
test('V4: "I\'m getting the owner on this now" only on a line that can put a call through', () => {
  const no = V.systemPrompt(PLUMB, '+14785550142', 'en-US', false);
  assert.doesNotMatch(no, /getting the owner on this now/);
  assert.match(no, /Is the water off\? \.\.\. Good\."/);
  const yes = V.systemPrompt(lineView({ business: 'Acme Plumbing', facts: '{}', industry: 'plumbing', client_id: 'x', transfer_to: '+14785550199', transfer_when: 'urgent' }), '+14785550142', 'en-US', false);
  assert.match(yes, /getting the owner on this now/);
});

// ---------- a live line on the rehearsal harness (as in voicefixes.test.js) ----------
import { generateKeyPairSync, createHash } from 'node:crypto';
const H = await import('./rehearsal/harness.js');
const CB = await import('../src/callbacks.js');
const { setBrand } = await import('../src/sms.js');
const { default: worker } = await import('../src/index.js');
const LINE = '+14785551001', CELL = '+14785557777', CODE = 'q'.repeat(32);
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const sidOf = n => 'CA' + String(n).padStart(32, '0');
async function mk(o) {
  o = o || {};
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, Object.assign({ APNS_KEY: PEM, APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAM' }, o.env || {}));
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, review_link, tier) VALUES ('c1', ?1, 'Quillen Plumbing', 1, '', 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO app_devices (token, client_id) VALUES ('tok1', 'c1')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, transfer_to, transfer_when, updated, owner_set, tz) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', ?2, ?3, '2026-10-01', '{}', 'America/New_York')")
    .bind(LINE, o.transferTo === undefined ? CELL : o.transferTo, o.when || 'asked').run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params, query) => {
    const q = query ? '?' + query : '', href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + q;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + q, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    const r = await hook('in', { CallSid: sid, To: LINE, From: from });
    if (!/<ConversationRelay/.test(r.text)) return { twiml: r.text };
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return Object.assign(x, { twiml: r.text });
  };
  const say = (x, words) => x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  const said = x => x.ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
  const pushes = () => world.calls.filter(c => /push\.apple\.com\/3\/device\/tok1$/.test(c.url)).map(c => JSON.parse(c.body)).filter(p => !/Urgent call happening now/.test((p.aps && p.aps.alert && p.aps.alert.title) || ''));
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, site, hook, room, say, said, pushes, row };
}

// V2
test('V2: a customer quoting "press 1" is a customer; a real robocall is still ended', () => {
  for (const t of ['Hi, I got a text from you guys that said press 1 to confirm, but I need to reschedule', 'Hi, the message said press 2 for Spanish, anyway my sink is leaking'])
    assert.equal(V.looksRobo(t), false, t);
  for (const t of ['This is an automated call from your utility. Press 1 to speak to an agent now.', 'This is a recorded message. Press one to speak to an agent.', 'Press 1 now to be connected.'])
    assert.equal(V.looksRobo(t), true, t);
});
test('V2: a robocall Max ends still reaches the owner as a quiet push, and an urgent one is never spam', async () => {
  const w = await mk();
  const x = await w.room(sidOf(21), '+18005550199');
  await w.say(x, 'This is an automated call from your utility. Press 1 to speak to an agent now.');
  assert.match(w.said(x), /pass that along\. Goodbye/);
  await w.hook('after', { CallSid: sidOf(21), SessionDuration: '8', SessionStatus: 'ended' }); await w.site.settle();
  assert.equal((await w.row(sidOf(21))).outcome, 'spam');
  const p = w.pushes();
  assert.equal(p.length, 1, 'one push');
  assert.equal(p[0].aps.sound, undefined, 'no sound');
  assert.equal(p[0].aps['interruption-level'], 'passive');
  // a customer who quotes the text Max sent goes to Max as usual
  const y = await w.room(sidOf(22), '+14785550142');
  const seen = w.world.aiSeen.length;
  w.world.aiScript = ['Sure, what day works better?'];
  await w.say(y, 'Hi, I got a text from you guys that said press 1 to confirm, but I need to reschedule');
  assert.equal(w.world.aiSeen.length, seen + 1, 'Max answered them');
  assert.doesNotMatch(w.said(y), /pass that along/);
  // an urgent caller is never filed as spam, whatever the write-up says
  const z = await w.room(sidOf(23), '+14785550143');
  w.world.aiScript = ['Okay. Is the water off?'];
  await w.say(z, 'my basement is flooding right now');
  w.world.aiNote = { name: '', callback: '', reason: 'Sales call', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: true, summary: 'A sales call.' };
  await w.hook('after', { CallSid: sidOf(23), SessionDuration: '30', SessionStatus: 'ended' }); await w.site.settle();
  assert.notEqual((await w.row(sidOf(23))).outcome, 'spam');
  assert.ok(w.pushes().some(p => /Urgent call/.test(p.aps.alert.title)), 'the owner hears about it');
});

// V9
async function fillLine(w, n, secs, from) {
  const at = new Date(Date.now() - 1800e3).toISOString();
  for (let i = 0; i < n; i++) await w.DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, notified, hq_synced, test, relay_seconds, seconds) VALUES (?1, 'c1', ?2, ?3, ?4, 'hangup', 'new', 1, 0, 0, ?5, ?5)")
    .bind('CAfill' + i + 'x' + secs + (from ? from(i) : ''), LINE, at, from ? from(i) : '+1478555' + String(2000 + i), secs).run();
}
test('V9: 80 three-second calls from faked numbers do not shut the line', async () => {
  const w = await mk();
  await fillLine(w, 80, 3);
  const r = await w.hook('in', { CallSid: sidOf(31), To: LINE, From: '+14785559999' });
  assert.match(r.text, /<ConversationRelay/, 'a real caller still reaches Max');
});
test('V9: a full day of real calls sends the next caller to voicemail and tells Chris', async () => {
  const w = await mk();
  await fillLine(w, 80, 60);
  const r = await w.hook('in', { CallSid: sidOf(32), To: LINE, From: '+14785559999' });
  assert.match(r.text, /<Record\b/, 'voicemail, so a message is still taken');
  assert.doesNotMatch(r.text, /We have your number/);
  assert.ok(await w.DB.prepare("SELECT type FROM ops_alerts WHERE type LIKE 'line-cap:c1%'").first(), 'Chris is told');
});
test('V9: blocked caller ID is not one caller, and is never told "we have your number"', async () => {
  const w = await mk();
  await fillLine(w, 6, 60, () => 'Anonymous');
  const r = await w.hook('in', { CallSid: sidOf(33), To: LINE, From: 'Anonymous' });
  assert.match(r.text, /<ConversationRelay/, 'the sixth anonymous caller in an hour is someone else');
  // one real number calling over and over is still limited, and gets the voicemail
  await fillLine(w, 6, 60, () => '+14785550123');
  const r2 = await w.hook('in', { CallSid: sidOf(34), To: LINE, From: '+14785550123' });
  assert.match(r2.text, /<Record\b/);
});

// V10
test('V10: Max brings up a booked visit only after the caller confirms the name on file', () => {
  const L = Object.assign({}, PLUMB, { memory: 'Name on file: Dana. Last job: water heater, in October. A visit booked for Tuesday at 1 PM.' });
  const p = V.systemPrompt(L, '+14785550142', 'en-US', false);
  assert.match(p, /Am I speaking with Dana\?/, 'the name question is unchanged');
  const line = p.split('\n').find(x => /visit coming up/.test(x));
  assert.match(line, /Until they confirm the name on file, do not even hint at it\./);
  assert.ok(line.indexOf('Until they confirm') < line.indexOf('weekday and time'));
});

// V11
test('V11: after a client cancels, a forwarded caller does not hear that the business closed', async () => {
  const w = await mk();
  await w.DB.prepare("UPDATE app_clients SET active = 0 WHERE client_id = 'c1'").run();
  await w.DB.prepare('UPDATE voice_lines SET on_air = 0 WHERE number = ?1').bind(LINE).run();
  const r = await w.hook('in', { CallSid: sidOf(41), To: LINE, From: '+14785550142' });
  assert.doesNotMatch(r.text, /not taking calls/);
  assert.match(r.text, /Thanks for calling Quillen Plumbing\. Nobody can take your call right now\. Please try again a little later\./);
  assert.match(r.text, /<Hangup\/>/);
});

// V5
test('V5: the never-troubleshoot rule is in the rules Max never breaks, and the safety steps stay', () => {
  const rule = /Never troubleshoot over the phone or walk them through a fix or reset: say it is hard to tell without seeing it and, for liability, someone needs to come out and take a look\./;
  const p = V.systemPrompt(PLUMB, '+14785550142', 'en-US', false);
  const rules = p.slice(p.indexOf('Rules you never break:'));
  assert.match(rules.split('\n\n')[0], rule);
  assert.match(p, /get out and call 911/);
  const p6 = V.systemPrompt(Object.assign({}, PLUMB, { features: ['prompt6'] }), '+14785550142', 'en-US', false);
  const never = p6.slice(p6.indexOf('Never:'));
  assert.match(never.split('\n\n')[0], /- Troubleshoot or walk them through a fix or reset\. Say it is hard to tell without seeing it and, for liability, someone needs to come out\./);
  // DIY notes still come from the regex as before
  assert.match(notes(PLUMB, 'can I fix it myself'), /can't troubleshoot it over the phone/);
});

// V7
test('V7: more ways of saying "I hate talking to a machine" get the dry joke; "are you a real person" is unchanged', () => {
  for (const t of ['I hate these robot things', "I'd rather talk to a real person than a machine", 'great, another bot', "I can't stand automated systems"]) {
    assert.match(notes(PLUMB, t), /don't like talking to AI\. Start with one short, dry, confident joke/, t);
    assert.ok(['hateai', 'aimad'].includes(leadIn(t, 'en-US', []).kind), t);   // wanting a person keeps its "I hear you."
  }
  assert.equal(leadIn('are you a real person?', 'en-US', []).kind, 'ishuman');
  const p = V.systemPrompt(PLUMB, '+14785550142', 'en-US', false);
  assert.ok(p.includes('- If they say they do not like talking to AI, agree in a few dry words, say you are good at this, and go straight to what they asked.'));
  assert.ok(p.includes('say plainly "I\'m an automated assistant, not a person"'));
});

// V8
test('V8: Max does not call the owner "he" or "him" to their customers', () => {
  const L = Object.assign({}, PLUMB, { cbSlot: 'three fifteen this afternoon', cbBusy: 'out on a job right now' });
  const p = V.systemPrompt(L, '+14785550142', 'en-US', false);
  assert.doesNotMatch(p, /It helps him|"He is out on a job|He will call you at/);
  assert.match(p, /"The owner is out on a job right now\. They will call you at three fifteen this afternoon\./);
  assert.match(p, /It helps the owner\./);
  const s = { line: PLUMB, msgs: [{ r: 'a', t: 'Hi' }, { r: 'u', t: 'my basement is flooding, I need someone right now' }], lang: 'en-US', urgent: true };
  const n = callerNotes(s, 'my basement is flooding, I need someone right now');
  assert.doesNotMatch(n, /\b(he|him) (is|can)\b|as soon as he|moment he/);
  assert.match(n, /as soon as they can to see if they can get there sooner/);
});

// From the transfer-screen change (kept on its own branch until one live test call): only this half ships now.
test('the owner cannot set Max\'s own number as the number to put calls through to', async () => {
  const w = await mk();
  const r = await w.site.call('/app/' + CODE + '/api/line', { json: { transferTo: LINE.slice(2), transferWhen: 'urgent', by: 'Dana' } });
  assert.equal(r.status, 422);
  assert.match(r.text, /That is Max's own number\. Use the phone you answer yourself\./);
  const ok = await w.site.call('/app/' + CODE + '/api/line', { json: { transferTo: '478 555 0109', transferWhen: 'urgent', by: 'Dana' } });
  assert.equal(ok.status, 200, ok.text);
});
