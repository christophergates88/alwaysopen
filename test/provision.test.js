import { test } from 'node:test';
import assert from 'node:assert/strict';
import { industryOf, searches, stateOf, provisionLine, pretty } from '../src/provision.js';

test('the kind of work comes from the name first', () => {
  assert.equal(industryOf('Sinclair Plumbing LLC', 'Contractor or trade'), 'plumbing');
  assert.equal(industryOf('Cool Breeze Heating & Air', 'Contractor or trade'), 'hvac');
  assert.equal(industryOf('Oconee Smiles', 'Medical, dental or legal'), 'medical');
  assert.equal(industryOf('Lakeside Dental', 'Medical, dental or legal'), 'dental');
  assert.equal(industryOf('Jones Agency', 'Insurance agency'), 'insurance');
  assert.equal(industryOf('Main Street Co', 'Contractor or trade'), 'contractor');
  assert.equal(industryOf('Lake Country Foam Party', 'Other'), 'party rentals');
});

test('numbers are looked for near the owner first', () => {
  assert.deepEqual(searches('(706) 555-0142', 'Eatonton, GA'), ['AreaCode=706', 'NearNumber=%2B17065550142&Distance=60', 'InRegion=GA', '']);
  assert.deepEqual(searches('', 'Somewhere'), ['']);
  assert.equal(stateOf('Madison, ga'), 'GA');
  assert.equal(pretty('+17064602226'), '(706) 460-2226');
});

// A fake database and Twilio: the line is bought once, connected to Max, and put on the air.
function fake() {
  const t = { provision: null, lines: [], bought: 0 };
  const DB = { prepare(sql) { let a = []; const q = { bind(...x) { a = x; return q; },
    async run() {
      if (/INSERT OR IGNORE INTO provision/.test(sql) && !t.provision) t.provision = { client_id: a[0], status: 'queued', tries: 0, number: '', updated: a[1] };
      if (/SET status = 'working'/.test(sql)) { const p = t.provision; if (p && ['queued', 'failed'].includes(p.status) && p.tries < a[3]) { p.status = 'working'; p.tries++; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      if (/SET status = 'failed'/.test(sql)) { t.provision.status = 'failed'; t.provision.error = a[0]; }
      return { meta: { changes: 0 } };
    },
    async first() {
      if (/FROM voice_lines/.test(sql)) return t.lines.find(l => l.client_id === a[0]) || null;
      if (/FROM billing/.test(sql)) return { business: 'Sinclair Plumbing', phone: '478-555-0101', town: 'Eatonton, GA', type: 'Contractor or trade' };
      if (/FROM app_clients/.test(sql)) return { business: 'Sinclair Plumbing', phone: '', regulated: 0 };
      if (/FROM provision/.test(sql)) return t.provision;
      return null;
    } }; return q; },
    async batch(list) { for (const x of list) await x.run(); t.lines.push({ client_id: 'c1', number: '+14785550199' }); t.provision.status = 'live'; t.provision.number = '+14785550199'; return []; } };
  return { env: { DB, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'x', VOICE_KEY: 'k' }, t };
}
test('a paid signup gets a number near them, wired to Max, and only one', async () => {
  const { env, t } = fake();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push((init && init.method || 'GET') + ' ' + url + (init && init.body ? ' ' + init.body : ''));
    if (/AvailablePhoneNumbers/.test(url)) return new Response(JSON.stringify({ available_phone_numbers: [{ phone_number: '+14785550199' }] }));
    if (/IncomingPhoneNumbers\.json/.test(url)) { t.bought++; return new Response(JSON.stringify({ sid: 'PN1', phone_number: '+14785550199' })); }
    return new Response('{}');
  };
  const r = await provisionLine(env, 'c1');
  assert.equal(r.status, 'live');
  assert.equal(r.numberText, '(478) 555-0199');
  assert.equal(t.bought, 1);
  assert.ok(calls[0].includes('AreaCode=478'));
  const buy = calls.find(c => c.startsWith('POST'));
  assert.match(buy, /VoiceUrl=https%3A%2F%2Falwaysopenoffice.com%2Fvoice%2Fin%2Fk/);
  assert.match(buy, /SmsUrl=https%3A%2F%2Falwaysopenoffice.com%2Fvoice%2Fsms%2Fk/);
  const again = await provisionLine(env, 'c1');
  assert.equal(again.status, 'live');
  assert.equal(t.bought, 1);
});
