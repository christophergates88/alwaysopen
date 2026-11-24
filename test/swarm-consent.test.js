// Nov 24, 2026 fix wave (consent): what Always Open does to a client's customers, held to the usual US rules for texts,
// automated calls and marketing email. K1 a stop in one channel stops the other; K2 marketing texts wait for the
// customer's own clock; K3 automatic texts stay in plain GSM-7 (one segment); K4 every call to a customer says a number
// to call back, and never calls the owner "he"; K5 past-customer emails carry the business's postal address or wait;
// K6 HELP gives a number, and voicemail recordings with no clear words are deleted from Twilio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const sms = await import('../src/sms.js');
const cb = await import('../src/callbacks.js');
const oc = await import('../src/outcalls.js');
const ci = await import('../src/checkin.js');
const past = await import('../src/past.js');
const AT = await import('../src/autotext.js');

const LINE = '+14785550100', CUST = '+14785550142', C10 = '4785550142';
async function world(o) {
  o = o || {};
  const w = new H.World(), DB = H.makeDB(), env = H.makeEnv(w, DB, o.env);
  H.installFetch(w, env);
  const ex = (s, ...a) => DB.prepare(s).bind(...a).run();
  await ex("INSERT INTO app_clients (client_id, code_hash, ref, business, owner_first, phone, active, tier) VALUES ('c1', 'h1', 'r1', 'Lane Plumbing', 'Sam', '4785550199', 1, 'Pro')");
  await ex("INSERT INTO voice_lines (number, client_id, business, on_air, industry, town, updated) VALUES (?1, 'c1', 'Lane Plumbing', 1, 'plumbing', 'Eatonton, GA', '2026-10-01')", LINE);
  await sms.setBrand(env, 'c1', 'MG' + 'c'.repeat(32), 'approved');
  await cb.ensureCallbacks(env);
  if (o.map) await ex("INSERT INTO map_listing (client_id, show, phone, address) VALUES ('c1', 1, ?1, ?2)", o.map.phone || '', o.map.address || '');
  return { w, DB, env, ex };
}
const form = o => { const f = new URLSearchParams(); for (const k in o) f.set(k, o[k]); return f; };
const textIn = (env, body, n) => sms.handleSms(null, env, form({ From: CUST, To: LINE, Body: body, MessageSid: 'SM' + String(n || 1).padStart(32, '0') }), true);
const said = async res => (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const withNow = async (t, fn) => { const real = Date.now; Date.now = () => t; try { return await fn(); } finally { Date.now = real; } };
const daytime = Date.parse('2026-11-30T17:00:00Z');   // Monday noon Eastern, 9 AM Pacific

// ---------- K1 ----------
test('K1: a STOP text stops Max\'s calls too, closes the open follow-ups, and START brings back texts only', async () => {
  const { w, DB, env, ex } = await world();
  await ex("INSERT INTO app_followups (client_id, kind, name, phone, consent, status, created, appt_at) VALUES ('c1', 'appointment', 'Dana', ?1, 1, 'open', '2026-11-24', '2026-11-25T15:00:00Z')", C10);
  const res = await textIn(env, 'STOP', 1);
  assert.ok(!(await res.text()).includes('<Message>'), 'the reply to STOP is unchanged: nothing sent back');
  assert.equal(await cb.callOptedOut(env, 'c1', CUST), true, 'no confirm call after a STOP text');
  assert.equal((await DB.prepare('SELECT consent FROM app_followups').first()).consent, 0, 'the queued confirm is closed');
  // START: texts back on, calls stay off
  const st = await textIn(env, 'START', 2);
  assert.match(await st.text(), /back on the list/);
  assert.equal(await cb.callOptedOut(env, 'c1', CUST), true, 'a START text never re-opens calls');
  const t = await withNow(daytime, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'confirm', body: 'Lane Plumbing: see you at 10.' }));
  assert.equal(t.ok, true, 'texts are back after START');
  assert.equal(w.texts.length, 1);
});

test('K1: "stop" said on a call stops the texts too (Max\'s customer calls and the check-in), and START still re-opens texts', async () => {
  for (const kind of ['outcall', 'checkin', 'callback']) {
    const { w, DB, env, ex } = await world();
    await ex("INSERT INTO app_followups (client_id, kind, name, phone, consent, status, created, appt_at) VALUES ('c1', 'appointment', 'Dana', ?1, 1, 'open', '2026-11-24', '2026-11-25T15:00:00Z')", C10);
    if (kind === 'outcall') {
      await oc.ensureOutcalls(env);
      await ex("INSERT INTO outcalls (id, client_id, kind, phone, name, topic, ref, due_at, created) VALUES (1, 'c1', 'confirm', ?1, 'Dana', 'Your appointment', 'confirm:1', '2026-11-24', '2026-11-24')", CUST);
      await oc.outcallGather(env, new URL('https://x/voice/ocg/k?id=1'), form({ Digits: '9' }));
    } else if (kind === 'checkin') {
      await ci.ensureCheckins(env);
      await ex("INSERT INTO checkins (id, client_id, phone, first, job, due_at, status, created) VALUES (1, 'c1', ?1, 'Dana', 'water heater', '2026-11-24', 'pending', '2026-11-21')", CUST);
      await ci.checkinGather(env, new URL('https://x/voice/cig/k?id=1'), form({ Digits: '9' }));
    } else {
      await ex("INSERT INTO callbacks (id, client_id, phone, name, due_at, status, created) VALUES (1, 'c1', ?1, 'Dana', '2026-11-24', 'missed', '2026-11-24')", CUST);
      await cb.outboundGather(env, new URL('https://x/voice/outg/k?id=1&k=reset'), form({ Digits: '9' }));
    }
    const t = await withNow(daytime, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'reminder', tz: 'America/New_York', body: 'Lane Plumbing: see you tomorrow at 10.' }));
    assert.equal(t.why, 'opted out', kind + ': no reminder text after "stop" on the call');
    assert.equal(w.texts.length, 0);
    assert.equal((await DB.prepare('SELECT consent FROM app_followups').first()).consent, 0, kind + ': the queued follow-up is closed');
    const st = await textIn(env, 'START', 3);
    assert.match(await st.text(), /back on the list/, kind + ': START is understood after a call stop');
    const t2 = await withNow(daytime, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'reminder', tz: 'America/New_York', body: 'Lane Plumbing: see you tomorrow at 10.' }));
    assert.equal(t2.ok, true, kind + ': texts are back after START');
    assert.equal(await cb.callOptedOut(env, 'c1', CUST), true, kind + ': calls stay off');
  }
});

// ---------- K2 ----------
test('K2: a marketing text waits for the customer\'s own clock, not only the business\'s', async () => {
  const { w, env } = await world();
  const early = Date.parse('2026-11-30T13:10:00Z');   // 8:10 AM in Georgia, 5:10 AM in California
  const r = await withNow(early, () => sms.sendText(env, { clientId: 'c1', to: '+14155550100', kind: 'revive', tz: 'America/New_York', body: 'Hi Dana, due for a flush? Reply STOP to end texts.' }));
  assert.equal(r.ok, false); assert.equal(r.why, 'after hours'); assert.equal(r.retry, true, 'held, the same way as the business\'s own quiet hours');
  assert.equal(w.texts.length, 0);
  const g = await withNow(early, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'revive', tz: 'America/New_York', body: 'Hi Dana, due for a flush? Reply STOP to end texts.' }));
  assert.equal(g.ok, true, 'a Georgia number at 8:10 AM Georgia time goes');
  const a = await withNow(early, () => sms.sendText(env, { clientId: 'c1', to: '+14155550100', kind: 'confirm', body: 'Lane Plumbing: you are set for Friday at 10.' }));
  assert.equal(a.ok, true, 'an answer to something the customer just did still goes at any hour');
});

// ---------- K3 ----------
const GSM = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€".split(''));
const segments = s => { const n = [...s].length; return [...s].some(c => !GSM.has(c)) ? (n <= 70 ? 1 : Math.ceil(n / 67)) : (n <= 160 ? 1 : Math.ceil(n / 153)); };
test('K3: curly quotes, dashes and the ellipsis go out as plain characters, so the confirm and reminder are one segment', async () => {
  const { w, env } = await world();
  const x = { name: 'Sam', appt_at: '2026-11-27T15:00:00Z', service: 'drain' };
  const bodies = [AT.confirmText('Sinclair Plumbing', x, 'America/New_York'), AT.reminderText('Sinclair Plumbing', x, 'America/New_York')];
  assert.ok(bodies.every(b => /’/.test(b)), 'the bodies as written carry a curly apostrophe');
  for (const b of bodies) await withNow(daytime, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'confirm', body: b }));
  assert.equal(w.texts.length, 2);
  for (const t of w.texts) assert.equal(segments(t.Body), 1, 'one segment: ' + t.Body);
  await withNow(daytime, () => sms.sendText(env, { clientId: 'c1', to: CUST, kind: 'confirm', body: '“Señor” – it’s set… — done.' }));
  assert.equal(w.texts[2].Body, '"Señor" - it\'s set... - done.', 'Spanish letters stay; the rest is plain');
});

// ---------- K4 ----------
const NUM_LINE = '4 7 8, 5 5 5, 0 1 0 0', NUM_BIZ = '7 0 6, 5 5 5, 0 1 2 3';
test('K4: every customer call Max makes says once where to reach the business, to a person and to a machine', async () => {
  for (const map of [null, { phone: '7065550123' }]) {
    const { env, ex } = await world({ map });
    const want = 'You can reach Lane Plumbing at ' + (map ? NUM_BIZ : NUM_LINE);
    await oc.ensureOutcalls(env);
    let id = 0;
    for (const [kind, topic] of [['confirm', 'Your appointment with Lane Plumbing is tomorrow at 9 AM'], ['noshow', 'your visit at 9 AM'], ['onway', 'Sam is on the way, about 20 minutes out']]) {
      id++; await ex("INSERT INTO outcalls (id, client_id, kind, phone, name, topic, ref, due_at, created) VALUES (?1, 'c1', ?2, ?3, 'Dana', ?4, ?5, '2026-11-24', '2026-11-24')", id, kind, CUST, topic, kind + ':' + id);
      for (const ab of ['human', 'machine_end_beep']) {
        const s = await said(await oc.outcallTwiml(env, new URL('https://x/voice/oc/k?id=' + id), form({ AnsweredBy: ab })));
        assert.equal(s.split(want).length - 1, 1, kind + ' ' + ab + ': ' + s);
      }
    }
    await ci.ensureCheckins(env);
    await ex("INSERT INTO checkins (id, client_id, phone, first, job, due_at, status, created, attempts) VALUES (1, 'c1', ?1, 'Dana', 'water heater', '2026-11-24', 'pending', '2026-11-21', 1)", CUST);
    for (const ab of ['human', 'machine_end_beep']) {
      const s = await said(await ci.checkinTwiml(env, new URL('https://x/voice/ci/k?id=1'), form({ AnsweredBy: ab })));
      assert.equal(s.split(want).length - 1, 1, 'check-in ' + ab + ': ' + s);
    }
    await ex("INSERT INTO callbacks (id, client_id, phone, name, due_at, status, created) VALUES (1, 'c1', ?1, 'Dana', '2026-11-24', 'missed', '2026-11-24')", CUST);
    for (const [k, ab] of [['reset', 'human'], ['reset', 'machine_end_beep'], ['later', 'human']]) {
      const s = await said(await cb.outboundTwiml(env, new URL('https://x/voice/out/k?id=1&k=' + k + '&n=3%20PM'), form({ AnsweredBy: ab })));
      assert.equal(s.split(want).length - 1, 1, 'call-back ' + k + ' ' + ab + ': ' + s);
      assert.doesNotMatch(s, /\b(he|him|his|himself)\b/i, 'the owner is never "he": ' + s);
    }
  }
});

test('K4: the call-back answers and the check-in never call the owner "he"', async () => {
  const { env, ex } = await world();
  for (const [d, k] of [['1', 'reset'], ['2', 'reset'], ['', 'reset'], ['2', 'later']]) {
    await ex("INSERT OR REPLACE INTO callbacks (id, client_id, phone, name, due_at, status, created) VALUES (1, 'c1', ?1, 'Dana', '2026-11-25T20:00:00Z', 'missed', '2026-11-24')", CUST);
    const s = await said(await cb.outboundGather(env, new URL('https://x/voice/outg/k?id=1&k=' + k + (d === '' ? '&a=1' : '')), form(d ? { Digits: d } : { SpeechResult: 'maybe' })));
    assert.doesNotMatch(s, /\b(he|him|his|himself)\b/i, s);
  }
  await ci.ensureCheckins(env);
  await ex("INSERT INTO checkins (id, client_id, phone, first, job, due_at, status, created) VALUES (1, 'c1', ?1, 'Dana', 'water heater', '2026-11-24', 'pending', '2026-11-21')", CUST);
  const s = await said(await ci.checkinGather(env, new URL('https://x/voice/cig/k?id=1'), form({ Digits: '2' })));
  assert.doesNotMatch(s, /\b(he|him|his|himself)\b/i, s);
});

// ---------- K5 ----------
async function reviveWorld(map) {
  const o = await world({ map });
  await past.ensurePast(o.env);
  await o.ex("INSERT INTO biz_customers (client_id, ckey, name, email, agreed, agreed_at, opt_token, source, created, updated) VALUES ('c1', 'e:dana@example.com', 'Dana', 'dana@example.com', 1, 'x', 'ABCDEFGHJKLMNPQR', 'manual', 'x', 'x')");
  await o.ex("INSERT INTO biz_revive (client_id, ckey, name, phone, email, reason, draft, status, created, updated) VALUES ('c1', 'e:dana@example.com', 'Dana', '', 'dana@example.com', 'Due', 'Hi Dana, it has been a year since your water heater flush.', 'pending', 'x', 'x')");
  o.row = await o.DB.prepare('SELECT * FROM biz_revive').first();
  return o;
}
const bodyOf = m => String(m.raw || '').split('\r\n\r\n').slice(1).join('\n');
test('K5: a past-customer email carries the business\'s postal address', async () => {
  const { w, env, row } = await reviveWorld({ address: '103 W Sumter St, Eatonton, GA 31024' });
  const r = await past.approveRevive(env, { client_id: 'c1', business: 'Lane Plumbing' }, row, '');
  assert.equal(r.body.status, 'sent');
  assert.equal(w.mail.length, 1);
  assert.match(bodyOf(w.mail[0]), /Lane Plumbing, 103 W Sumter St, Eatonton, GA 31024/);
});
test('K5: with no postal address on file the email waits, and the owner is told what to add', async () => {
  for (const map of [null, { address: '103 W Sumter St' }]) {   // nothing at all, or a street with no town and ZIP
    const { w, DB, env, row } = await reviveWorld(map);
    const r = await past.approveRevive(env, { client_id: 'c1', business: 'Lane Plumbing' }, row, '');
    assert.equal(w.mail.length, 0, 'no email without a postal address');
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /Add your business address/);
    const st = await DB.prepare('SELECT status, result FROM biz_revive').first();
    assert.equal(st.status, 'queued', 'held, not lost: it goes once the address is added');
    assert.match(st.result, /no business address/);
    // the address added: the timer sends it
    await DB.prepare("INSERT OR REPLACE INTO map_listing (client_id, show, phone, address) VALUES ('c1', 1, '', '103 W Sumter St, Eatonton, GA 31024')").run();
    await past.sendHeldRevive(env);
    assert.equal(w.mail.length, 1);
    assert.match(bodyOf(w.mail[0]), /Lane Plumbing, 103 W Sumter St, Eatonton, GA 31024/);
  }
});
test('K5: only a whole address counts: a street number or box, a town, and a ZIP', async () => {
  const { env, DB } = await reviveWorld({ address: '103 W Sumter St, Eatonton, GA 31024' });
  assert.equal(await past.bizAddress(env, 'c1'), '103 W Sumter St, Eatonton, GA 31024');
  assert.equal(await past.bizAddress(env, 'nobody'), '');
  for (const [a, ok] of [['PO Box 12, Eatonton, GA 31024-0012', true], ['103 W Sumter St', false], ['Eatonton, GA 31024', false], ['103 W Sumter St, Eatonton, GA', false]]) {
    await DB.prepare("UPDATE map_listing SET address = ?1 WHERE client_id = 'c1'").bind(a).run();
    assert.equal(await past.bizAddress(env, 'c1'), ok ? a : '', a);
  }
});
test('K5: a review request email carries the address when there is one, and still goes without it', async () => {
  const rv = await import('../src/reviews.js');
  for (const map of [{ address: '103 W Sumter St, Eatonton, GA 31024' }, null]) {
    const { w, env, ex } = await world({ map });
    await rv.ensureReviews(env); await past.ensurePast(env);
    await ex("INSERT INTO biz_customers (client_id, ckey, name, email, agreed, agreed_at, opt_token, source, created, updated) VALUES ('c1', 'e:dana@example.com', 'Dana', 'dana@example.com', 1, 'x', 'ABCDEFGHJKLMNPQR', 'manual', 'x', 'x')");
    await ex("INSERT INTO biz_reviewreq (item_id, client_id, ckey, first, email, job, status, created) VALUES ('rq1', 'c1', 'e:dana@example.com', 'Dana', 'dana@example.com', 'drain', 'pending', 'x')");
    const r = await rv.sendReviewRequest(env, { client_id: 'c1', business: 'Lane Plumbing' }, { id: 'rq1', text: 'Hi Dana, would you leave a review?' }, 'Hi Dana, would you leave a review?');
    assert.equal(r, 'sent');
    if (map) assert.match(bodyOf(w.mail[0]), /Lane Plumbing, 103 W Sumter St, Eatonton, GA 31024/);
    else assert.doesNotMatch(bodyOf(w.mail[0]), /Lane Plumbing, \d/);
  }
});

// ---------- K6 ----------
test('K6: HELP gives a number to call, in one segment', async () => {
  for (const [map, num] of [[{ phone: '7065550123' }, '(706) 555-0123'], [null, '(706) 460-2226']]) {
    const { env } = await world({ map });
    const m = /<Message>([\s\S]*?)<\/Message>/.exec(await (await textIn(env, 'HELP', 5)).text());
    assert.ok(m, 'HELP is answered');
    assert.ok(m[1].includes(num), m[1]);
    assert.equal(segments(m[1]), 1, m[1]);
  }
});
test('K6: a voicemail with no clear words is deleted from Twilio once the owner has been told', async () => {
  const VM = await import('../src/voicemail.js');
  const { w, env } = await world({ env: { AI: { run: async () => ({ text: '' }) } } });
  const NOW = Date.now(), sid = 'CA' + '1'.padStart(32, '0'), rec = 'RE' + '1'.padStart(32, '0');
  w.twCalls = [{ sid, direction: 'inbound', to: LINE, from: CUST, status: 'completed', caller_name: '', start_time: new Date(NOW - 20 * 60e3).toUTCString(), end_time: new Date(NOW - 19 * 60e3).toUTCString() }];
  w.twRecs = { [sid]: [{ sid: rec, status: 'completed', duration: '12' }] };
  w.aiNote = { name: '', callback: '', reason: 'Voicemail', details: '', when: '', urgent: false, callback_wanted: true, booked: '', spam: false, summary: 'They left a voicemail with no clear words.' };
  await VM.vmSweep(env, NOW, { ping: async () => {} });
  assert.deepEqual(w.twDeleted, [rec]);
});
test('K6: a voicemail after a failed call with no clear words says so to the owner and is deleted too', async () => {
  const VM = await import('../src/voicemail.js');
  const { w, DB, env } = await world({ env: { AI: { run: async () => ({ text: '' }) } } });
  const sid = 'CA' + '2'.padStart(32, '0'), rec = 'RE' + '2'.padStart(32, '0');
  await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, outcome, status, test) VALUES (?1, 'c1', ?2, ?3, ?4, 'failed', 'new', 0)").bind(sid, LINE, new Date().toISOString(), CUST).run();
  w.twRecs = { [sid]: [{ sid: rec, status: 'completed', duration: '9' }] };
  await VM.voicemailHook(env, form({ CallSid: sid, RecordingStatus: 'completed' }), {});
  assert.match((await DB.prepare('SELECT summary FROM app_calls WHERE id = ?1').bind(sid).first()).summary, /no words we could make out/);
  assert.deepEqual(w.twDeleted, [rec]);
});
