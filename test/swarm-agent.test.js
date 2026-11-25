// Nov 24, 2026: Google phones businesses for its users (Search's "Ask for Me", Gemini's "Call for Me"), opening with
// "an automated system calling from Google on behalf of a user", then a price or an opening. Max used to end those as
// robocalls on the first sentence, so the customer who asked Google to check never heard back. He answers them now;
// the scams that borrow Google's name still end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateKeyPairSync, createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const V = await import('../src/voice.js');
const CB = await import('../src/callbacks.js');
const { setBrand } = await import('../src/sms.js');
const { default: worker } = await import('../src/index.js');
const LINE = '+14785551001', CODE = 'q'.repeat(32);
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const sidOf = n => 'CA' + String(n).padStart(32, '0');

const GOOGLE = [
  'Hi, this is an automated call from Google on behalf of a customer.',
  'Hello, this is an automated system calling from Google on behalf of a user.',
  "Hi, I'm calling from Google on behalf of a customer. This is an automated call and it may be recorded.",
  "Hi, I'm Gemini, an AI assistant from Google calling on a recorded line on behalf of Kristine M.",
  'This is an automated call from Google. I am calling to check your price for brake pads and when you have availability.',
  'Hi, I am an AI assistant calling on behalf of Dana Reyes to ask whether you have an opening this week.'
];
const SCAMS = [
  'This is a recorded message about your Google business listing. Press one to speak to a specialist.',
  'This is an automated call from Google. Your business listing will be suspended. Press 1 to verify.',
  "Hi, I'm calling on behalf of Google about your business profile. Press one now to speak to a specialist.",
  'This is an automated call from Google on behalf of a user. Your listing will be removed unless you verify it today.',
  'This is an automated call on behalf of your vehicle manufacturer about your extended auto warranty.',
  'This is an automated message on behalf of the IRS. Press 1 to speak to an agent.'
];

test('Google and other AI assistants calling for a customer are customers; the scams that borrow Google\'s name are not', () => {
  for (const t of GOOGLE) { assert.equal(V.looksRobo(t), false, t); assert.equal(V.agentForCustomer(t), true, t); }
  for (const t of SCAMS) { assert.equal(V.agentForCustomer(t), false, t); assert.equal(V.looksRobo(t), true, t); }
  // ordinary customers are unchanged
  for (const t of ['Your Google listing is wrong, it says you close at five', 'Do you do warranty work on water heaters?', 'I found you on Google, how much is a service call?'])
    assert.equal(V.looksRobo(t), false, t);
});

test('Max\'s instructions say so, and so do the write-up\'s', () => {
  const L = V.lineView({ business: 'Acme Plumbing', town: 'Eatonton', facts: '{}', industry: 'plumbing', regulated: 0, client_id: 'x', transfer_to: '', transfer_when: 'never', spanish: 0 });
  assert.match(V.systemPrompt(L, '+14785550142', 'en-US', false), /An AI calling for a customer \(like Google\) is a customer: answer it\./);
  const short = V.systemPrompt(Object.assign({}, L, { features: ['prompt6'] }), '+14785550142', 'en-US', false);
  assert.match(short, /An AI assistant calling for a customer \(like Google's\) is a customer: answer it\./);
});

async function mk() {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB, { APNS_KEY: PEM, APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAM' });
  H.installFetch(world, env);
  env.CALLROOM = H.makeNamespace(V.CallRoom, env);
  await CB.ensureLineTz(env);
  await setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, review_link, tier) VALUES ('c1', ?1, 'Quillen Plumbing', 1, '', 'Pro')").bind(createHash('sha256').update(CODE).digest('hex')).run();
  await DB.prepare("INSERT INTO app_devices (token, client_id) VALUES ('tok1', 'c1')").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated, tz) VALUES (?1, 'c1', 'Quillen Plumbing', 1, 'plumbing', 'Eatonton, GA', '2026-10-01', 'America/New_York')").bind(LINE).run();
  const site = H.makeClient(worker, env);
  const hook = (kind, params) => {
    const href = 'https://alwaysopenoffice.com/voice/' + kind + '/' + env.VOICE_KEY;
    return site.call('/voice/' + kind + '/' + env.VOICE_KEY, { form: params, headers: { 'x-twilio-signature': H.twilioSign(env.TWILIO_AUTH_TOKEN, href, params) } });
  };
  const room = async (sid, from) => {
    const r = await hook('in', { CallSid: sid, To: LINE, From: from });
    assert.match(r.text, /<ConversationRelay/);
    env.CALLROOM.get(sid);
    const x = env.CALLROOM._rooms.get(sid);
    await x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'setup', callSid: sid, from }));
    return x;
  };
  const say = (x, words) => x.room.webSocketMessage(x.ws, JSON.stringify({ type: 'prompt', voicePrompt: words, last: true }));
  const said = x => x.ws.sent.filter(m => m.type === 'text').map(m => m.token).join('');
  const row = sid => DB.prepare('SELECT * FROM app_calls WHERE id = ?1').bind(sid).first();
  return { world, DB, env, site, hook, room, say, said, row };
}

test('on a live call, Google asking a price for a customer gets an answer, and the write-up is told it is not spam', async () => {
  const w = await mk();
  const x = await w.room(sidOf(51), '+16505550100');
  w.world.aiScript = ['A water heater flush is ninety-five dollars, and we have an opening Thursday morning.'];
  const seen = w.world.aiSeen.length;
  await w.say(x, 'Hi, this is an automated call from Google on behalf of a customer. How much do you charge to flush a water heater?');
  assert.equal(w.world.aiSeen.length, seen + 1, 'Max answered it');
  assert.doesNotMatch(w.said(x), /pass that along/);
  let asked = '';
  w.world.aiNote = b => { asked = JSON.stringify(b); return { name: '', callback: '', reason: 'Price for a water heater flush', details: 'Google asked for a customer', when: '', urgent: false, callback_wanted: false, booked: '', spam: false, summary: 'Google\'s assistant asked, for a customer, the price of a water heater flush.' }; };
  await w.hook('after', { CallSid: sidOf(51), SessionDuration: '40', SessionStatus: 'ended' }); await w.site.settle();
  assert.match(asked, /an AI assistant calling for a customer, such as Google asking a price or an opening, is not spam/);
  assert.notEqual((await w.row(sidOf(51))).outcome, 'spam');
});

test('a scam that borrows Google\'s name still ends on the first sentence', async () => {
  const w = await mk();
  const x = await w.room(sidOf(52), '+12025550188');
  const seen = w.world.aiSeen.length;
  await w.say(x, 'This is an automated call from Google. Your business listing will be suspended. Press 1 to verify.');
  assert.equal(w.world.aiSeen.length, seen, 'no AI turn');
  assert.match(w.said(x), /pass that along/);
});
