// Hear Max as your business (Nov 25, 2026): an owner who got the free audit calls (706) 460-2226 and Max answers as their
// business, built from the audit and Google's details read during the call. Readied from /hear: straight in. By caller
// ID: "press 1" first, and anything else is Max as Always Open. Three calls an audit, 25 a day; the owner gets the note
// Max would have sent, Christopher gets a push, and Google's details are dropped once the call is written up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const T = await import('../src/trial.js');
const L = await import('../src/leadmail.js');
const { parseHours } = await import('../src/availability.js');
const { default: worker } = await import('../src/index.js');

const OWN = '+17064602226';
const sidOf = n => 'CA' + String(n).padStart(32, '0');
const PLACE = {
  displayName: { text: 'Sinclair Plumbing, LLC' }, formattedAddress: '112 Oak St, Eatonton, GA 31024, USA', primaryType: 'plumber', primaryTypeDisplayName: { text: 'Plumber' },
  regularOpeningHours: { weekdayDescriptions: ['Monday: 8:00 AM – 5:00 PM', 'Tuesday: 8:00 AM – 5:00 PM', 'Wednesday: 8:00 AM – 5:00 PM',
    'Thursday: 8:00 AM – 5:00 PM', 'Friday: 8:00 AM – 5:00 PM', 'Saturday: 9:00 AM – 12:00 PM', 'Sunday: Closed'] },
  websiteUri: 'https://www.sinclairplumbing.com/', businessStatus: 'OPERATIONAL'
};

test('Google\'s hours said the way a person would, and still read by the booking', () => {
  const h = T.spokenHours(PLACE.regularOpeningHours.weekdayDescriptions);
  assert.equal(h, 'Monday to Friday 8 AM to 5 PM, Saturday 9 AM to noon, closed Sunday.');
  assert.deepEqual(parseHours(h), { Mon: [480, 1020], Tue: [480, 1020], Wed: [480, 1020], Thu: [480, 1020], Fri: [480, 1020], Sat: [540, 720] });
  assert.equal(T.spokenHours(['Monday: Open 24 hours', 'Tuesday: Open 24 hours']), 'Monday to Tuesday open 24 hours.');
  assert.equal(T.spokenHours([]), '');
  // the name as the business would answer its phone
  assert.equal(T.spokenName('Sinclair Plumbing, LLC', 'sinclair plumbing'), 'Sinclair Plumbing');
  assert.equal(T.spokenName('Sinclair Plumbing - Water Heater Repair & Drain Cleaning Eatonton GA', 'sinclair plumbing'), 'Sinclair Plumbing', 'a stuffed Google name: the one they typed');
  assert.equal(T.spokenName('', "MIKE'S HVAC"), "Mike's Hvac");
  // what the website says about itself, tidied
  assert.equal(T.aboutOf({ ok: true, title: 'Home', desc: 'Water heaters &amp; drain cleaning | Eatonton, GA' }), 'Water heaters & drain cleaning, Eatonton, GA');
  assert.equal(T.aboutOf({ ok: true, title: 'Home', desc: '' }), '', 'a generic title says nothing');
  assert.equal(T.aboutOf({ ok: false, desc: 'x'.repeat(40) }), '');
});

async function mk() {
  const world = new H.World(), DB = H.makeDB();
  const mail = [];
  const env = H.makeEnv(world, DB, { BUSINESS_ADDRESS: '100 Main St, Springfield, GA 30000', SEND_MAIL: { send: async m => { mail.push(m); } } });
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  world.places = PLACE;
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('always-open', ?1, 'Always Open', 1)").bind(createHash('sha256').update('x').digest('hex')).run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, updated) VALUES (?1, 'always-open', 'Always Open', 1, '', '2026-10-01')").bind(OWN).run();
  await L.ensureLeadMail(env);
  const lead = async (phone, extra) => {
    const r = await DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, type, plan, status, grade) VALUES (?1, 'Dana Whitfield', 'dana@example.com', ?2, 'Sinclair Plumbing', 'Eatonton, GA', 'Contractor or trade', 'Growth', 'new', 'C') RETURNING id")
      .bind(new Date().toISOString(), phone).first();
    return T.trialForLead(env, Object.assign({ id: r.id, phone, business: 'Sinclair Plumbing', town: 'Eatonton, GA', type: 'Contractor or trade' }, extra || {}), { placeId: 'ChIJsinclair', about: 'Water heaters, drain cleaning and repiping in Eatonton.' });
  };
  const site = H.makeClient(worker, env);
  const hook = (kind, params, q) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY + (q || '');
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY + (q || ''), { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return x;
  };
  const say = (x, words) => x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, site, hook, room, say, row, mail, lead };
}

test('readied from /hear: the call is answered as their business, with Google\'s hours, and written up for the owner and Christopher', async () => {
  const w = await mk();
  const t = await w.lead('(478) 555-0142');
  assert.match(t.id, /^[A-Za-z0-9]{16}$/);
  // the page: their phone filled in, then readied
  const page = await w.site.call('/hear/' + t.id);
  assert.equal(page.status, 200);
  assert.match(page.text, /Hear Max answer as Sinclair Plumbing/);
  assert.match(page.text, /value="\(478\) 555-0142"/);
  assert.match(page.text, /3 trial calls left/);
  const ready = await w.site.call('/hear/' + t.id, { form: { phone: '478-555-0142' } });
  assert.match(ready.text, /Max is ready/);
  assert.match(ready.text, /href="tel:\+17064602226"/);
  assert.match(ready.text, /from <span style="white-space:nowrap">\(478\) 555-0142<\/span> in the next 30 minutes/);

  // someone else calling meanwhile gets Always Open, untouched
  const other = await w.hook('in', { CallSid: sidOf(9), To: OWN, From: '+14785550999' });
  assert.match(other.text, /Always Open/); assert.doesNotMatch(other.text, /Sinclair/);
  assert.equal((await w.row(sidOf(9))).client_id, 'always-open');

  const sid = sidOf(1);
  const r = await w.hook('in', { CallSid: sid, To: OWN, From: '+14785550142' });
  assert.doesNotMatch(r.text, /<Gather/, 'readied: no menu');
  assert.match(r.text, /welcomeGreeting="Hi, thanks for calling Sinclair Plumbing\. I&apos;m an automated assistant, and this call may be recorded\. What can I do for you\?"/);
  assert.doesNotMatch(r.text, /<Recording/, 'never recorded');
  const c = await w.row(sid);
  assert.deepEqual({ client_id: c.client_id, number: c.number, test: c.test }, { client_id: 'trial-' + t.id, number: 'trial:' + sid, test: 1 });
  assert.ok(w.world.calls.some(x => /places\.googleapis\.com\/v1\/places\/ChIJsinclair/.test(x.url)), 'Google read during the call');

  const x = await w.room(sid, '+14785550142');
  w.world.aiScript = ['Leaking in the garage, got it. Is it gas or electric?'];
  await w.say(x, 'Hi, my water heater is leaking all over the garage. Are you open Saturday?');
  const last = w.world.aiSeen[w.world.aiSeen.length - 1].system;
  const sys = Array.isArray(last) ? last.map(b => b.text || '').join('\n') : String(last || '');
  assert.match(sys, /Sinclair Plumbing/);
  assert.match(sys, /Monday to Friday 8 AM to 5 PM, Saturday 9 AM to noon, closed Sunday\./);
  assert.match(sys, /Listed on Google as: Plumber\. Its website says: Water heaters, drain cleaning and repiping in Eatonton\./);
  assert.match(sys, /112 Oak St, Eatonton, GA 31024/);
  assert.match(sys, /This is a trial call/);
  assert.doesNotMatch(sys, /Always Open's own line|free audit by text/, 'Max is theirs on this call, not ours');

  w.world.aiNote = { name: 'Dana', callback: '+14785550142', reason: 'Water heater leaking in the garage', details: 'Gas water heater', when: 'Saturday morning', urgent: false, callback_wanted: true, booked: '', spam: false,
    summary: 'Dana says the gas water heater is leaking in the garage and wants someone Saturday morning.' };
  const before = w.world.pushes.length;
  await w.hook('after', { CallSid: sid, SessionDuration: '95', SessionStatus: 'ended' }); await w.site.settle();
  const done = await w.row(sid);
  assert.equal(done.outcome, 'done');
  // the owner: the note Max would have sent
  assert.equal(w.mail.length, 1);
  assert.equal(w.mail[0].to, 'dana@example.com');
  assert.equal(w.mail[0].subject, 'The note Max would have sent you');
  assert.match(w.mail[0].text, /Thanks for calling Max as Sinclair Plumbing/);
  assert.match(w.mail[0].text, /Urgent: Dana, Water heater leaking in the garage\nDana says the gas water heater is leaking/, 'heard live as an active problem: urgent, as a real line would mark it');
  assert.match(w.mail[0].text, /\nWhen: Saturday morning\n/);
  assert.match(w.mail[0].text, /Call back: \(478\) 555-0142/);
  assert.match(w.mail[0].text, /You have 2 trial calls left/);
  assert.match(w.mail[0].text, /100 Main St, Springfield, GA 30000/, 'the postal address');
  assert.ok(w.mail[0].headers && /lead\/stop/.test(w.mail[0].headers['List-Unsubscribe']), 'the stop link');
  // Christopher: a hot lead
  const p = w.world.pushes.slice(before).find(x => /Sinclair Plumbing just heard Max as their business/.test(x.title));
  assert.ok(p, JSON.stringify(w.world.pushes.slice(before)));
  assert.equal(p.priority, 'high');
  // nothing went to the caller, and nothing counts as a real call
  assert.ok(!w.world.calls.some(x => /Messages\.json$/.test(x.url) && x.method === 'POST'), 'no texts');
  // Google's details are gone once written up; the call's line still reads
  const tc = await w.DB.prepare('SELECT line, done, emailed FROM trial_calls WHERE sid = ?1').bind(sid).first();
  assert.ok(tc.done); assert.equal(tc.emailed, 'sent');
  assert.doesNotMatch(tc.line, /Oak St|8 AM|Plumber|sinclairplumbing/);
  assert.match(tc.line, /Sinclair Plumbing/);
  assert.equal((await T.trialLine(w.env, sid)).business, 'Sinclair Plumbing');
  // the page counts it
  assert.match((await w.site.call('/hear/' + t.id)).text, /2 trial calls left/);
});

test('by caller ID: press 1 for their business; nothing or another key is Max as Always Open', async () => {
  const w = await mk();
  const t = await w.lead('4785550177');
  const r = await w.hook('in', { CallSid: sidOf(21), To: OWN, From: '+14785550177' });
  assert.match(r.text, /<Gather input="dtmf" numDigits="1" timeout="4" action="https:\/\/alwaysopenoffice\.com\/voice\/trial\/voice-key-rehearsal\?t=[A-Za-z0-9]{16}" method="POST">/);
  assert.match(r.text, /To hear Max answer as Sinclair Plumbing, the way your customers would, press 1\./);
  assert.match(r.text, /<\/Gather>.*<ConversationRelay[^>]*welcomeGreeting="[^"]*Always Open/s, 'no key: Max as Always Open, as always');
  assert.equal((await w.row(sidOf(21))).client_id, 'always-open');
  const q = '?t=' + t.id;
  const one = await w.hook('trial', { CallSid: sidOf(21), From: '+14785550177', Digits: '1' }, q);
  assert.match(one.text, /welcomeGreeting="Hi, thanks for calling Sinclair Plumbing\./);
  const c = await w.row(sidOf(21));
  assert.deepEqual({ client_id: c.client_id, number: c.number, test: c.test }, { client_id: 'trial-' + t.id, number: 'trial:' + sidOf(21), test: 1 });

  await w.hook('in', { CallSid: sidOf(22), To: OWN, From: '+14785550177' });
  const two = await w.hook('trial', { CallSid: sidOf(22), From: '+14785550177', Digits: '2' }, q);
  assert.match(two.text, /welcomeGreeting="[^"]*Always Open/);
  assert.equal((await w.row(sidOf(22))).client_id, 'always-open', 'another key: our line, untouched');

  // a 1 from a number that is not the audit's phone does nothing
  await w.hook('in', { CallSid: sidOf(23), To: OWN, From: '+14785550999' });
  const stranger = await w.hook('trial', { CallSid: sidOf(23), From: '+14785550999', Digits: '1' }, q);
  assert.match(stranger.text, /Always Open/);

  // three calls an audit: two more, then the offer stops
  for (const n of [24, 25]) {
    const m = await w.hook('in', { CallSid: sidOf(n), To: OWN, From: '+14785550177' });
    assert.match(m.text, /<Gather/);
    await w.hook('trial', { CallSid: sidOf(n), From: '+14785550177', Digits: '1' }, q);
  }
  const after = await w.hook('in', { CallSid: sidOf(26), To: OWN, From: '+14785550177' });
  assert.doesNotMatch(after.text, /<Gather/, 'all three used');
  assert.match((await w.site.call('/hear/' + t.id)).text, /You’ve heard Max as Sinclair Plumbing/);
});

test('the offer by caller ID lasts 14 days; the day\'s limit holds for everyone; a hang-up at the greeting still reaches Christopher', async () => {
  const w = await mk();
  const t = await w.lead('4785550188');
  await w.DB.prepare('UPDATE trials SET menu_until = ?1 WHERE id = ?2').bind(new Date(Date.now() - 1000).toISOString(), t.id).run();
  assert.doesNotMatch((await w.hook('in', { CallSid: sidOf(31), To: OWN, From: '+14785550188' })).text, /<Gather/, 'past 14 days');
  // readied from the page, it works again
  await w.site.call('/hear/' + t.id, { form: { phone: '4785550188' } });
  const sid = sidOf(32);
  assert.match((await w.hook('in', { CallSid: sid, To: OWN, From: '+14785550188' })).text, /calling Sinclair Plumbing/);
  const before = w.world.pushes.length;
  await w.hook('after', { CallSid: sid, SessionDuration: '4', SessionStatus: 'ended' }); await w.site.settle();
  assert.equal(w.mail.length, 0, 'nothing said, no email');
  assert.ok(w.world.pushes.slice(before).some(p => /just heard Max as their business/.test(p.title) && /hung up at the greeting/.test(p.body)), JSON.stringify(w.world.pushes.slice(before)));

  // 25 a day, all audits together
  const t2 = await w.lead('4785550199');
  for (let i = 0; i < T.PER_DAY; i++) await w.DB.prepare("INSERT INTO trial_calls (sid, trial_id, at, line) VALUES (?1, 'x', ?2, '')").bind('CAfill' + i, new Date().toISOString()).run();
  const full = await w.hook('in', { CallSid: sidOf(33), To: OWN, From: '+14785550199' });
  assert.doesNotMatch(full.text, /<Gather/);
  assert.match(full.text, /Always Open/);
  assert.ok(t2);
});

test('the audit email offers it, by link and by "press 1"; a robocall-style trial gets no email; the tidy-up drops Google\'s details', async () => {
  const w = await mk();
  const sent = [];
  const AUDIT = { found: true, at: new Date().toISOString(), score: 58, grade: 'D', business: { id: 'ChIJsinclair', name: 'Sinclair Plumbing', type: 'Plumber', rating: 4.3, reviews: 31 },
    areas: [], findings: [{ weight: 12, title: 'No hours on Google', saw: 'x', fix: 'y' }], fine: [], rivals: [], site: { ok: true, title: 'Sinclair Plumbing', desc: 'Water heaters and drains in Eatonton.' } };
  const r = await w.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, plan, status) VALUES (?1, 'Dana Whitfield', 'dana2@example.com', '478-555-0166', 'Sinclair Plumbing', 'Eatonton, GA', 'Growth', 'new') RETURNING id").bind(new Date().toISOString()).first();
  const out = await L.sendAudit(w.env, { name: 'Dana Whitfield', email: 'dana2@example.com', phone: '478-555-0166', business: 'Sinclair Plumbing', town: 'Eatonton, GA', type: 'Contractor or trade' }, r.id,
    { run: async () => AUDIT, send: async (to, m) => { sent.push(m); return 'sent'; } });
  assert.equal(out, 'sent');
  const m = sent[0];
  for (const x of [m.text, m.html]) {
    assert.match(x, /Hear Max answer as Sinclair Plumbing/);
    assert.match(x, /call \(706\) 460-2226 from \(478\) 555-0166 and press 1/);
    assert.match(x, /lead\/go\?i=\d+&(amp;)?to=hear/);
  }
  const tr = await w.DB.prepare('SELECT * FROM trials WHERE lead_id = ?1').bind(String(r.id)).first();
  assert.equal(tr.phone, '+14785550166'); assert.equal(tr.place_id, 'ChIJsinclair'); assert.equal(tr.about, 'Water heaters and drains in Eatonton.');
  // the tracked link goes to the page
  const link = /(https:\/\/alwaysopenoffice\.com\/lead\/go\?[^\s"]+to=hear[^\s"]*)/.exec(m.text)[1];
  const go = await w.site.call(link.replace('https://alwaysopenoffice.com', ''));
  assert.equal(go.status, 302); assert.equal(go.headers.get('location'), 'https://alwaysopenoffice.com/hear/' + tr.id);

  // a robocall-style trial call: no email
  await w.site.call('/hear/' + tr.id, { form: { phone: '4785550166' } });
  const sid = sidOf(41);
  await w.hook('in', { CallSid: sid, To: OWN, From: '+14785550166' });
  const x = await w.room(sid, '+14785550166');
  w.world.aiScript = ['Okay.'];
  await w.say(x, 'Hello, I would like to know your hours please.');
  w.world.aiNote = { name: '', callback: '', reason: 'Sales call', details: '', when: '', urgent: false, callback_wanted: false, booked: '', spam: true, summary: 'A sales call.' };
  await w.hook('after', { CallSid: sid, SessionDuration: '20', SessionStatus: 'ended' }); await w.site.settle();
  assert.equal(w.mail.length, 0);

  // a call whose write-up never came: its Google details are dropped after two hours
  await w.DB.prepare("INSERT INTO trial_calls (sid, trial_id, at, line) VALUES (?1, ?2, ?3, ?4)").bind(sidOf(42), tr.id, new Date(Date.now() - 3 * 3600e3).toISOString(),
    JSON.stringify({ business: 'Sinclair Plumbing', facts: JSON.stringify({ hours: 'Monday to Friday 8 AM to 5 PM.', address: '112 Oak St' }) })).run();
  assert.deepEqual(await T.trialCron(w.env, Date.now()), { tidied: 1 });
  const left = await w.DB.prepare('SELECT line, done FROM trial_calls WHERE sid = ?1').bind(sidOf(42)).first();
  assert.ok(left.done); assert.doesNotMatch(left.line, /Oak St|8 AM/);
});

test('the audit page shows it too, and a bad phone on /hear is turned back', async () => {
  const w = await mk();
  const t = await w.lead('');
  const bad = await w.site.call('/hear/' + t.id, { form: { phone: '555' } });
  assert.match(bad.text, /That number doesn’t look right/);
  assert.equal((await w.site.call('/hear/nope')).status, 200);
  assert.match((await w.site.call('/hear/AAAAAAAAAAAAAAAA')).text, /That link has expired/);
  // the page a texted audit links to
  await w.DB.prepare("UPDATE leads SET token = 'Tok0Tok0Tok0Tok0' WHERE id = ?1").bind(t.lead_id).run();
  w.world.places = { places: [] };
  const page = await w.site.call('/your-audit/Tok0Tok0Tok0Tok0');
  assert.match(page.text, /Hear Max answer as Sinclair Plumbing/);
  assert.match(page.text, /href="https:\/\/alwaysopenoffice\.com\/hear\/[A-Za-z0-9]{16}"/);
});

test('a trial caller can pencil in a time from the business\'s own Google hours, and the owner\'s note says so', async () => {
  const w = await mk();
  const t = await w.lead('4785550155');
  await w.site.call('/hear/' + t.id, { form: { phone: '4785550155' } });
  const sid = sidOf(51);
  await w.hook('in', { CallSid: sid, To: OWN, From: '+14785550155' });
  const x = await w.room(sid, '+14785550155');
  w.world.aiScript = ['Sure. Which works better for you?'];
  await w.say(x, 'My kitchen sink is backed up, can someone come out?');
  const last = w.world.aiSeen[w.world.aiSeen.length - 1].system;
  const sys = Array.isArray(last) ? last.map(b => b.text || '').join('\n') : String(last || '');
  assert.match(sys, /these times are open \(numbered\): 1\) /, 'open times from their hours');
  assert.match(sys, /penciled in/);
  w.world.aiScript = ['Got you down, Dana. [BOOK 1 | Dana | backed up kitchen sink]'];
  await w.say(x, 'The first one works. It\'s Dana.');
  const b = await w.DB.prepare('SELECT client_id, status FROM line_bookings WHERE client_id = ?1').bind('trial-' + t.id).first();
  assert.ok(b, 'penciled in on the trial\'s own book, never a client\'s');
  w.world.aiNote = { name: 'Dana', callback: '+14785550155', reason: 'Backed up kitchen sink', details: '', when: '', urgent: false, callback_wanted: false, booked: 'yes', spam: false, summary: 'Dana\'s kitchen sink is backed up.' };
  await w.hook('after', { CallSid: sid, SessionDuration: '70', SessionStatus: 'ended' }); await w.site.settle();
  assert.equal(w.mail.length, 1);
  assert.match(w.mail[0].text, /\nPenciled in, please confirm with them: /);
  // a day after the visit, the tidy-up takes the pencilled visit off the trial's book
  await T.trialCron(w.env, Date.now() + 10 * 864e5);
  assert.equal(await w.DB.prepare('SELECT client_id FROM line_bookings WHERE client_id = ?1').bind('trial-' + t.id).first(), null);
});

test('an audit sent by text has no place yet: Google is searched once during the call, and only a match is used', async () => {
  const w = await mk();
  const t = await w.lead('4785550133');
  await w.DB.prepare("UPDATE trials SET place_id = '' WHERE id = ?1").bind(t.id).run();
  w.world.places = { places: [Object.assign({ id: 'ChIJfound' }, PLACE)] };
  await w.site.call('/hear/' + t.id, { form: { phone: '4785550133' } });
  const r = await w.hook('in', { CallSid: sidOf(61), To: OWN, From: '+14785550133' });
  assert.match(r.text, /calling Sinclair Plumbing/);
  assert.ok(w.world.calls.some(x => /places:searchText/.test(x.url) && /Sinclair Plumbing in Eatonton, GA/.test(x.body)));
  assert.equal((await w.DB.prepare('SELECT place_id FROM trials WHERE id = ?1').bind(t.id).first()).place_id, 'ChIJfound', 'the place ID is kept');
  assert.match((await T.trialLine(w.env, sidOf(61))).facts, /Monday to Friday 8 AM to 5 PM/);
  // someone else's business on top: not used, and Max answers by the name they typed, without hours
  const t2 = await w.lead('4785550134');
  await w.DB.prepare("UPDATE trials SET place_id = '' WHERE id = ?1").bind(t2.id).run();
  w.world.places = { places: [Object.assign({}, PLACE, { id: 'ChIJother', displayName: { text: 'Riverbend Drain Co.' } })] };
  await w.site.call('/hear/' + t2.id, { form: { phone: '4785550134' } });
  assert.match((await w.hook('in', { CallSid: sidOf(62), To: OWN, From: '+14785550134' })).text, /calling Sinclair Plumbing/);
  const f = JSON.parse((await T.trialLine(w.env, sidOf(62))).facts);
  assert.equal(f.hours, ''); assert.equal(f.address, '');
  assert.equal((await w.DB.prepare('SELECT place_id FROM trials WHERE id = ?1').bind(t2.id).first()).place_id, '');
});
