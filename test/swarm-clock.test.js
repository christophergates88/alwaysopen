// Nov 24, 2026 out-of-state audit, the clock fixes: owner nudges and follow-up reminders on the client's own clock, a
// client's zone read from the town as people type it, a number bought near the town and not the owner's old cell,
// storm wording for heat and fire weather, whole calendar days around daylight saving, and a reply deadline in the
// client's own zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const CB = await import('../src/callbacks.js');
const PV = await import('../src/provision.js');

const AZ = 'America/Phoenix', HI = 'Pacific/Honolulu', AK = 'America/Anchorage', ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles';

// ---------- T2: the zone from the town as typed ----------
test('T2: the state is found in the ways people type a town', () => {
  const z = t => CB.lineZone({ town: t, phone: '', number: '' });
  assert.equal(z('Honolulu Hawaii'), HI);
  assert.equal(z('Honolulu, Hawaii'), HI);
  assert.equal(z('Phoenix AZ'), AZ);
  assert.equal(z('Phoenix, AZ 85001'), AZ);
  assert.equal(z('Phoenix AZ 85001'), AZ);
  assert.equal(z('Phoenix, az'), AZ);
  assert.equal(z('Anchorage, Alaska'), AK);
  assert.equal(z('Eatonton, GA'), ET);
  assert.equal(z('Dallas Texas'), CT);
  assert.equal(z('Denver, Colorado 80202'), MT);
  assert.equal(z('San Juan, PR'), 'America/Puerto_Rico');
  assert.equal(z('Hagatna, GU'), 'Pacific/Guam');
  assert.equal(z('Hagatna Guam'), 'Pacific/Guam');
  assert.equal(z('Charlotte Amalie, VI'), 'America/Puerto_Rico');
  assert.equal(CB.zoneOfState('Seattle Washington'), PT);
});
test('T2: no false state from a town that only ends in two letters', () => {
  for (const t of ['Eatonton', 'Orlando', 'Washington', 'Peru in', 'Chicago', 'El Paso', 'Mesa', 'Kansas City', 'Georgia', '', null]) assert.equal(CB.stateOfTown(t), '', String(t));
  assert.equal(CB.stateOfTown('Peru, IN'), 'IN');
  assert.equal(CB.stateOfTown('Peru IN'), 'IN');
  assert.equal(CB.stateOfTown('Washington, Georgia'), 'GA');
  assert.equal(CB.stateOfTown('Washington DC'), 'DC');
  assert.equal(CB.zoneOfState('Orlando'), '');
});
test('T2: zoneGuess says when no state was found', () => {
  assert.deepEqual(CB.zoneGuess({ town: 'Phoenix AZ', phone: '7065550100' }), { tz: AZ, guessed: false });
  assert.deepEqual(CB.zoneGuess({ town: 'El Paso', phone: '9155550100' }), { tz: MT, guessed: true });
  assert.deepEqual(CB.zoneGuess({ town: 'Phoenix', phone: '' }), { tz: ET, guessed: true });
  assert.deepEqual(CB.zoneGuess({ town: 'El Paso, TX', phone: '9155550100' }), { tz: MT, guessed: false });
});
test('T2: territories and the newer overlay area codes have zones', () => {
  const zn = a => CB.zonesOfNumber(a + '5550100')[0];
  assert.equal(zn('340'), 'America/Puerto_Rico');
  assert.equal(zn('671'), 'Pacific/Guam');
  for (const a of ['357', '738', '837']) assert.equal(zn(a), PT, a);
  assert.equal(zn('457'), CT);
  assert.equal(zn('748'), MT);
});

// ---------- T3: the business line is bought near the town ----------
test('T3: a Phoenix shop with a Georgia cell searches Arizona first', () => {
  assert.deepEqual(PV.searches('(706) 555-0100', 'Phoenix, AZ'), ['InRegion=AZ', 'AreaCode=706', 'NearNumber=%2B17065550100&Distance=60', '']);
  assert.deepEqual(PV.searches('(706) 555-0100', 'Phoenix AZ 85001'), ['InRegion=AZ', 'AreaCode=706', 'NearNumber=%2B17065550100&Distance=60', '']);
  // same zone as the town: today's order
  assert.deepEqual(PV.searches('(706) 555-0142', 'Eatonton, GA'), ['AreaCode=706', 'NearNumber=%2B17065550142&Distance=60', 'InRegion=GA', '']);
  assert.deepEqual(PV.searches('(480) 555-0100', 'Phoenix, AZ'), ['AreaCode=480', 'NearNumber=%2B14805550100&Distance=60', 'InRegion=AZ', '']);
  // state unknown: today's order
  assert.deepEqual(PV.searches('(706) 555-0100', 'Phoenix'), ['AreaCode=706', 'NearNumber=%2B17065550100&Distance=60', '']);
});

// ---------- T1 and T6: the owner's own clock ----------
const H = await import('./rehearsal/harness.js');
const C = await import('../src/checks.js');
const iso = t => new Date(t).toISOString();
const HR = 3600e3, DAY = 864e5;
const utc = s => Date.parse(s);
async function world() {
  const DB = H.makeDB(), env = { DB };
  await C.ensureChecks(env); await CB.ensureLineTz(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, owner_first, active) VALUES ('ga', 'h1', 'Georgia Plumbing', 'Sam', 1), ('hi', 'h2', 'Hilo Plumbing', 'Kai', 1)").run();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, town, tz, on_air, updated) VALUES ('+14785550100','ga','Eatonton, GA','America/New_York',1,'x'), ('+18085550100','hi','Hilo, HI','Pacific/Honolulu',1,'x')").run();
  for (const cid of ['ga', 'hi']) await DB.prepare("INSERT INTO app_items (id, client_id, kind, status, created, stars, title, text) VALUES (?1, ?2, 'reply', 'pending', ?3, 5, 'x', 'Thanks')").bind('r:' + cid, cid, iso(utc('2026-11-23T00:00:00Z'))).run();
  return { DB, env };
}
test('T1: an approval reminder waits for daytime where the owner is', async () => {
  const { env } = await world();
  const got = [];
  const h = { pushClient: async (cid, n) => { got.push(cid); return 1; } };
  // 14:30 UTC Nov 24 = 9:30 AM Eastern but 4:30 AM in Honolulu
  const r = await C.approvalNudges(env, utc('2026-11-24T14:30:00Z'), h);
  assert.deepEqual(got, ['ga']);
  assert.deepEqual(r.nudged.map(x => x.client), ['ga']);
  // 19:30 UTC = 2:30 PM Eastern and 9:30 AM Honolulu: now Kai hears
  const r2 = await C.approvalNudges(env, utc('2026-11-24T19:30:00Z'), h);
  assert.deepEqual(got, ['ga', 'hi']);
  assert.deepEqual(r2.nudged.map(x => x.client), ['hi']);
  // 3 AM Eastern, nobody: unchanged answer
  const { env: e2 } = await world();
  assert.deepEqual(await C.approvalNudges(e2, utc('2026-11-24T08:00:00Z'), h), { skipped: 'night' });
});
test('T1: a new-client setup reminder waits for daytime where the owner is; the day-7 note to Christopher keeps Eastern', async () => {
  const { DB, env } = await world();
  await DB.prepare("CREATE TABLE IF NOT EXISTS provision (client_id TEXT PRIMARY KEY, status TEXT DEFAULT 'queued', number TEXT DEFAULT '', number_sid TEXT DEFAULT '', tries INTEGER DEFAULT 0, error TEXT DEFAULT '', created TEXT, updated TEXT)").run().catch(() => {});
  const t0 = utc('2026-11-24T14:30:00Z');
  await DB.prepare("INSERT INTO provision (client_id, status, number, created) VALUES ('ga','live','+14785550100',?1), ('hi','live','+18085550100',?1)").bind(iso(t0 - 2.2 * DAY)).run();
  const pushes = [], pings = [];
  const h = { pushClient: async cid => { pushes.push(cid); return 1; }, mail: async () => 'off', ping: async (t) => pings.push(t) };
  await C.setupNudges(env, t0, h);
  assert.deepEqual(pushes, ['ga'], '4:30 AM in Hawaii: not yet');
  await C.setupNudges(env, t0 + 5 * HR, h);
  assert.deepEqual(pushes, ['ga', 'hi'], '9:30 AM in Hawaii');
  // day 7 for Hawaii at 4:30 AM Hawaii = 9:30 AM Eastern: the ping is for Christopher, so it goes
  await DB.prepare("DELETE FROM checks_meta WHERE k LIKE 'setup:%'").run();
  const t7 = t0 + 5 * DAY;
  await DB.prepare("UPDATE provision SET created = ?1").bind(iso(t7 - 7.1 * DAY)).run();
  await C.setupNudges(env, t7, h);
  assert.equal(pings.length, 2);
});
test('T6: the reply deadline reads on the client\'s own clock and day', () => {
  const thu11am = utc('2026-10-29T15:00:00Z');
  assert.equal(C.replyBy(thu11am), 'Chris will reply by 6 PM today.');
  assert.equal(C.replyBy(thu11am, 'America/New_York'), 'Chris will reply by 6 PM today.');
  assert.equal(C.replyBy(thu11am, 'Pacific/Honolulu'), 'Chris will reply by 12 PM today.');
  assert.equal(C.replyBy(thu11am, 'America/Los_Angeles'), 'Chris will reply by 3 PM today.');
  assert.equal(C.replyBy(utc('2026-11-12T15:00:00Z'), 'Pacific/Honolulu'), 'Chris will reply by 1 PM today.');
  assert.equal(C.replyBy(utc('2026-10-29T20:30:00Z'), 'America/Chicago'), 'Chris will reply by 5 PM tomorrow.');
  // Thursday 10 PM Honolulu (Friday 3 AM Eastern, past the cutoff) is Friday 6 PM Eastern = 1 PM Friday in Hawaii: tomorrow there
  assert.equal(C.replyBy(utc('2026-11-13T08:00:00Z'), 'Pacific/Honolulu'), 'Chris will reply by 1 PM today.'.replace('today', 'tomorrow'));
  assert.equal(C.replyBy(utc('2026-10-31T16:00:00Z'), 'Pacific/Honolulu'), 'Chris will reply by 1 PM Monday.');
});

test('T1: "Follow up today" waits for 8 AM where the owner is, and "today" is their day', async () => {
  const K = await import('../stress/clock/_kit.mjs');
  const ck = K.clock(K.at('2026-11-24 09:30', 'America/New_York'));
  try {
    const T = await K.boot();
    const GA = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' });
    const HIC = await T.signup({ plan: 'Pro', business: 'Hilo Plumbing', owner: 'Kai Akana', email: 'kai@hiloplumbing.example', town: 'Hilo, HI', phone: '(808) 555-0101' });
    const TOKEN = { [GA.cid]: 'a'.repeat(64), [HIC.cid]: 'b'.repeat(64) };
    for (const c of [GA, HIC]) {
      assert.equal((await T.site.call(c.base + '/api/device', { json: { token: TOKEN[c.cid] } })).status, 200);
      const r = await T.as(c.base).post('/api/followup', { kind: 'quote', name: 'Pat Lee', due: '2026-11-24' });
      assert.equal(r.status, 200, JSON.stringify(r.text));
    }
    const got = () => K.ownerPushes(T.world).filter(p => p.title === 'Follow up today').map(p => p.token);
    await T.cron();
    assert.deepEqual(got(), [TOKEN[GA.cid]], '9:30 AM Eastern is 4:30 AM in Hilo: only Georgia hears');
    ck.set(K.at('2026-11-24 08:10', 'Pacific/Honolulu')); await T.cron();
    assert.deepEqual(got(), [TOKEN[GA.cid], TOKEN[HIC.cid]], '8:10 AM in Hilo: now Kai hears');
  } finally { ck.restore(); }
});

// ---------- T4: heat and fire weather are not storm damage ----------
test('T4: heat and Red Flag warnings get their own groups and wording, with no storm or damage words', async () => {
  const S = await import('../src/stormdesk.js');
  assert.equal(S.stormGroup('Extreme Heat Warning'), 'heat');
  assert.equal(S.stormGroup('Excessive Heat Warning'), 'heat');
  assert.equal(S.stormGroup('Red Flag Warning'), 'fire');
  for (const [ev, g] of [['Tornado Warning', 'severe'], ['Flash Flood Warning', 'flood'], ['Hard Freeze Warning', 'freeze'], ['Extreme Cold Warning', 'freeze'], ['Storm Surge Warning', 'flood'], ['Winter Storm Warning', 'freeze']]) assert.equal(S.stormGroup(ev), g, ev);
  for (const g of ['heat', 'fire']) {
    assert.ok(S.LABELS[g] && S.SIGN[g], g);
    for (const kind of ['general', 'insurance', 'trades']) {
      const t = S.fill(S.TEMPLATES[kind][g], '6025550100');
      assert.ok(t.includes('(602) 555-0100') || t.includes('6025550100'), kind + ' ' + g + ' keeps the phone');
      assert.doesNotMatch(t, /storm|damage|power line|downed|photos|\bAI\b|!/i, kind + ' ' + g + ': ' + t);
      assert.doesNotMatch(t, /cover|claim|policy/i, kind + ' ' + g + ' makes no coverage statement');
      assert.ok(t.length < 260, kind + ' ' + g + ' stays short');
      assert.doesNotMatch(S.fill(S.TEMPLATES[kind][g], ''), /\{phone\}/);
    }
  }
  assert.match(S.SIGN.heat, /HEAT/); assert.match(S.SIGN.fire, /FIRE/);
});

// ---------- T5: open times by calendar day around a clock change ----------
test('T5: the next days are whole calendar days across daylight saving (availability.js and gcal.js)', async () => {
  const AV = await import('../src/availability.js'), GC = await import('../src/gcal.js');
  const db = H.makeDB(), env = { DB: db };
  await GC.ensureGcal(env);
  await AV.ensureBookings(env);
  const line = tz => ({ client_id: 'c1', number: '+14785550100', tz, regulated: 0, facts: '{}', owner_set: JSON.stringify({ book: { mode: 'book', slotMin: 60, bufferMin: 0, days: { Sun: [540, 1020], Mon: [540, 1020], Tue: [540, 1020], Wed: [540, 1020], Thu: [540, 1020], Fri: [540, 1020], Sat: [540, 1020] } } }) });
  const dayOf = (tz, t) => CB.local(tz, t).day;
  const uniq = (tz, slots) => [...new Set(slots.map(s => dayOf(tz, s.start)))];
  const next = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const realFetch = globalThis.fetch;
  await db.prepare("INSERT INTO gcal_tokens (client_id, refresh, tz, connected_at) VALUES ('c1', 'r', 'America/New_York', 'x')").run();
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/oauth2\.googleapis\.com\/token/.test(url)) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
    if (/googleapis\.com\/calendar\/v3/.test(url)) return new Response(JSON.stringify({ items: [], timeZone: 'America/New_York' }), { headers: { 'content-type': 'application/json' } });
    return realFetch(input, init);
  };
  try {
    // 11:30 PM Saturday Mar 13, 2027 in New York: tomorrow is the day clocks go forward, and it must not be skipped
    const spring = utc('2027-03-14T04:30:00Z');
    const a = await AV.slotsFor(env, line('America/New_York'), spring, 400, true);
    const ad = uniq('America/New_York', a.slots);
    assert.deepEqual(ad, [0, 1, 2, 3, 4, 5, 6].map(n => next('2027-03-14', n)), 'Sunday Mar 14 is there: ' + ad);
    // 12:30 AM Sunday Nov 1, 2026 in New York (the clocks go back later that night): no day repeats, none is missed
    const fall = utc('2026-11-01T04:30:00Z');
    const f = await AV.slotsFor(env, line('America/New_York'), fall, 400, true);
    const fd = uniq('America/New_York', f.slots);
    assert.deepEqual(fd, [0, 1, 2, 3, 4, 5, 6, 7].map(n => next('2026-11-01', n)));
        // Arizona has no clock change: unchanged
    const p = await AV.slotsFor(env, line('America/Phoenix'), spring, 400, true);
    assert.deepEqual(uniq('America/Phoenix', p.slots), [0, 1, 2, 3, 4, 5, 6].map(n => next('2027-03-14', n)));
    // The same on the calendar path (weekdays 9 to 5): Friday night before the change, Monday must not vanish
    const g = await GC.openSlots(env, 'c1', utc('2027-03-13T04:30:00Z'), 400, true);   // Fri Mar 12 11:30 PM EST
    assert.deepEqual(uniq('America/New_York', g.slots), ['2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19']);
    const g2 = await GC.openSlots(env, 'c1', utc('2027-03-12T04:30:00Z'), 400, true);   // Thu Mar 11 11:30 PM EST
    assert.deepEqual(uniq('America/New_York', g2.slots), ['2027-03-12', '2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18']);
  } finally { globalThis.fetch = realFetch; }
});
