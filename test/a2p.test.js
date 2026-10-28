import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForm, industryFor, campaignText, advance } from '../src/a2p.js';

const good = { legal: 'Sinclair Plumbing LLC', btype: 'Limited Liability Corporation', ein: '12-3456789', industry: 'CONSTRUCTION', website: 'https://sinclairplumbing.com', street: '1 Main St', city: 'Eatonton', state: 'ga', zip: '31024', first: 'Sam', last: 'Lee', title: 'Owner', position: 'CEO', email: 'sam@sinclairplumbing.com', phone: '(478) 555-0101', agree: 'on' };

test('the form is checked before anything is sent', () => {
  assert.equal(checkForm(good).ok, true);
  assert.equal(checkForm(good).form.state, 'GA');
  assert.equal(checkForm(Object.assign({}, good, { agree: '' })).ok, false);
  assert.equal(checkForm(Object.assign({}, good, { ein: '123' })).ok, false);
  assert.equal(checkForm(Object.assign({}, good, { ein: '', noEin: 'on' })).ok, true);
  assert.equal(checkForm(Object.assign({}, good, { website: 'sinclair' })).ok, false);
  assert.equal(checkForm(Object.assign({}, good, { btype: 'LLC' })).ok, false);
});
test('industry follows the kind of business', () => {
  assert.equal(industryFor('plumbing'), 'CONSTRUCTION');
  assert.equal(industryFor('auto repair'), 'AUTOMOTIVE');
  assert.equal(industryFor('dental'), 'HEALTHCARE');
  assert.equal(industryFor('foam party rentals'), 'HOSPITALITY');
});
test('every sample names the business and says how to stop', () => {
  const t = campaignText('Sinclair Plumbing', 'sinc1');
  assert.equal(t.MessageSamples.length, 3);
  for (const m of t.MessageSamples) { assert.match(m, /Sinclair Plumbing/); assert.match(m, /Reply STOP/); }
  assert.match(t.MessageFlow, /\/q\/sinc1/);
  assert.ok(!/\bAI\b|!/.test(t.Description + t.MessageFlow + t.MessageSamples.join(' ')));
});

// A fake database and a fake Twilio that approves everything, to walk the whole registration.
function fakeEnv() {
  const rows = { a2p: { client_id: 'c1', status: 'submitted', step: 'profile', form: JSON.stringify(checkForm(good).form), sids: '{}', error: '', tries: 0 } };
  const brands = {};
  const DB = { prepare(sql) { let args = []; const q = { bind(...a) { args = a; return q; },
    async first() { if (/FROM a2p_reg/.test(sql)) return Object.assign({}, rows.a2p); if (/FROM app_clients/.test(sql)) return { business: 'Sinclair Plumbing', ref: 'sinc1' }; if (/FROM voice_lines/.test(sql)) return { number: '+14785550100' }; return null; },
    async run() { if (/^UPDATE a2p_reg SET status = \?1, step = \?2/.test(sql)) Object.assign(rows.a2p, { status: args[0], step: args[1], sids: args[2], error: args[3], form: args[4] });
      if (/UPDATE a2p_reg SET status = 'failed'/.test(sql)) rows.a2p.status = 'failed';
      if (/INSERT INTO sms_brands/.test(sql)) brands[args[0]] = { mg: args[1], status: args[2] }; return {}; },
    async all() { return { results: [] }; } }; return q; } };
  return { env: { DB, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PRIMARY_PROFILE_SID: 'BUprimary', VOICE_KEY: 'k', MAIL_TO: 'ops@example.com' }, rows, brands };
}
test('a registration walks every step to approved, wipes the EIN, and turns texting on for that business only', async () => {
  const { env, rows, brands } = fakeEnv();
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    calls.push((init && init.method || 'GET') + ' ' + url);
    const u = String(url), sid = p => p + String(++n).padStart(32, '0');
    const body = u.includes('/Evaluations') ? { status: 'compliant' }
      : /CustomerProfiles\/BU[^/]+$/.test(u) && (!init || init.method === 'GET') ? { status: 'twilio-approved' }
      : /BrandRegistrations\/BN/.test(u) ? { status: 'APPROVED' }
      : /Compliance\/Usa2p\/Usecases/.test(u) ? { us_app_to_person_usecases: [{ code: 'LOW_VOLUME' }, { code: 'MIXED' }] }
      : /Compliance\/Usa2p$/.test(u) && init.method === 'GET' ? { compliance: [{ campaign_status: 'VERIFIED' }] }
      : /Compliance\/Usa2p$/.test(u) ? { sid: sid('QE') }
      : /IncomingPhoneNumbers\.json\?/.test(u) ? { incoming_phone_numbers: [{ sid: 'PN1' }] }
      : /CustomerProfiles$|TrustProducts$/.test(u) ? { sid: sid('BU') }
      : /EndUsers$/.test(u) ? { sid: sid('IT') }
      : /Addresses\.json$/.test(u) ? { sid: sid('AD') }
      : /SupportingDocuments$/.test(u) ? { sid: sid('RD') }
      : /BrandRegistrations$/.test(u) ? { sid: sid('BN') }
      : /v1\/Services$/.test(u) ? { sid: 'MG' + 'a'.repeat(32) }
      : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  let st;
  for (let i = 0; i < 12 && st !== 'approved'; i++) st = await advance(env, 'c1');
  assert.equal(st, 'approved');
  assert.equal(JSON.parse(rows.a2p.form).ein, '', 'the EIN is wiped once sent');
  assert.deepEqual(brands.c1, { mg: 'MG' + 'a'.repeat(32), status: 'approved' });
  assert.ok(calls.some(c => /EntityAssignments/.test(c)));
  assert.ok(calls.some(c => /BrandRegistrations$/.test(c.split(' ')[1])));
  assert.equal(calls.filter(c => /^POST .*BrandRegistrations$/.test(c)).length, 1, 'one brand, never two');
});
