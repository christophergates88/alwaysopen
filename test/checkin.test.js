import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinGather, scheduleCheckin } from '../src/checkin.js';

function db(rows) {
  const log = [];
  return { log, prepare(sql) { return { bind(...a) { return { async first() { for (const k in rows) if (sql.includes(k)) return rows[k]; return null; }, async run() { log.push(sql); return {}; }, async all() { return { results: [] }; } }; } }; }, async batch() {} };
}
test('no check-in is scheduled unless the owner turned it on', async () => {
  const env = { DB: db({}) };
  assert.equal(await scheduleCheckin(env, { client_id: 'c1', regulated: 0 }, 'Linda', '4783652533', 'water heater'), null);
  assert.ok(!env.DB.log.some(s => s.includes('INSERT INTO checkins')));
});
test('regulated clients never get one', async () => {
  const env = { DB: db({ 'checkin_prefs': { on_: 1 } }) };
  assert.equal(await scheduleCheckin(env, { client_id: 'c1', regulated: 1 }, 'Linda', '4783652533', 'x'), null);
});
test('a "no" creates an urgent call-back for the owner, a 9 opts them out', async () => {
  const mk = () => db({ 'FROM checkins k': { id: 5, client_id: 'c1', phone: '+14783652533', first: 'Linda', job: 'water heater', business: 'Sinclair Plumbing', review_link: '' } });
  let env = { DB: mk() };
  let res = await checkinGather(env, new URL('https://x/voice/cig/k?id=5'), new URLSearchParams({ Digits: '2' }));
  assert.ok((await res.text()).includes('He will call you himself'));
  assert.ok(env.DB.log.some(s => s.includes('INSERT INTO callbacks')));
  env = { DB: mk() };
  res = await checkinGather(env, new URL('https://x/voice/cig/k?id=5'), new URLSearchParams({ Digits: '9' }));
  assert.ok(env.DB.log.some(s => s.includes('call_optout')));
});
