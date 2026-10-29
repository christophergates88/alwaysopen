// Texts that arrive while the site is down are picked up from Twilio afterwards and handled as if they had just come
// in; every text is handled once, however it reaches us.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const S = await import('../src/sms.js');

const LINE = '+14785551001';
const sm = n => 'SM' + String(n).padStart(32, '0');
const msg = (n, o) => Object.assign({ sid: sm(n), direction: 'inbound', to: LINE, from: '+1478555' + String(n).padStart(4, '0'), body: 'Hi' }, o);

test('texts that missed the site are delivered to the owner afterwards, once; nothing from before this existed', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Quillen Plumbing', 1)").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, updated) VALUES (?1, 'c1', 'Quillen Plumbing', 1, '2026-10-01')").bind(LINE).run();
  const NOW = Date.now(), T0 = NOW - 20 * 60e3, at = m => new Date(NOW - m * 60e3).toUTCString();
  world.twMsgs = [msg(9, { body: 'from before', date_sent: at(25) })];
  assert.deepEqual(await S.smsSweep(env, T0), { started: true }, 'the first run only marks where to start');
  // While the site was down:
  world.twMsgs.push(
    msg(1, { body: 'Can you come Thursday instead?', date_sent: at(6) }),
    msg(2, { body: 'STOP', date_sent: at(5) }),
    msg(3, { direction: 'outbound-api', body: 'Booked: Thursday', date_sent: at(5) }),
    msg(4, { to: '+14785559999', body: 'not ours', date_sent: at(5) }),
    msg(6, { body: 'just now', date_sent: at(0.5) }),
    msg(5, { body: 'Already here', date_sent: at(4) }));
  // One of them did reach us:
  await S.handleSms(null, env, new URLSearchParams({ MessageSid: sm(5), From: '+14785550005', To: LINE, Body: 'Already here' }), true);
  const pings = [];
  const r = await S.smsSweep(env, NOW, { ping: async (t, b) => pings.push(t + ' | ' + b) });
  assert.deepEqual(r, { checked: 3, delivered: 2 }, 'two missed, one we had; the outbound, the other number and the one still settling are left out');
  const inbox = ((await DB.prepare("SELECT thread, text FROM biz_msgs WHERE client_id = 'c1' AND dir = 'in' ORDER BY at").all()).results).map(x => x.text);
  assert.deepEqual(inbox.sort(), ['Already here', 'Can you come Thursday instead?'], 'the missed one is in the inbox, the one we had is not doubled, the old one is untouched');
  assert.ok(await DB.prepare("SELECT 1 AS x FROM sms_optout WHERE client_id = 'c1' AND phone10 = '4785550002'").first(), 'a STOP sent while we were down is honored');
  assert.match(pings[0], /^Always Open: 2 texts picked up late \| Customer texts arrived while the site could not take them\./);
  const again = await S.smsSweep(env, NOW + 10 * 60e3, { ping: false });
  assert.equal(again.delivered, 1, 'only the one that was still settling');
  assert.equal((await S.smsSweep(env, NOW + 20 * 60e3, { ping: false })).delivered, 0);
  // Twilio retrying a webhook we already handled changes nothing.
  await S.handleSms(null, env, new URLSearchParams({ MessageSid: sm(1), From: '+14785550001', To: LINE, Body: 'Can you come Thursday instead?' }), true);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM biz_msgs WHERE text = 'Can you come Thursday instead?'").first()).n, 1);
});
