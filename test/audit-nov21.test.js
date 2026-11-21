// Fixes from the Nov 21, 2026 flaw audit: no online signup for medical or dental offices (HIPAA), consent that comes
// from the customer one person at a time (never a whole file or one tap for everyone), and past-customer texts only
// inside the existing-customer window. Sales calls (estimates, due-for-service) are covered in outcalls.test.js and
// Washington in outreach.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const B = await import('../src/billing.js');
const P = await import('../src/past.js');

function setup(extra) {
  const world = new H.World(), DB = H.makeDB(), env = Object.assign(H.makeEnv(world, DB), extra || {});
  H.installFetch(world, env);
  return { world, DB, env, h: { notify: async () => {} } };
}
const form = o => { const f = new URLSearchParams(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const BASE = { plan: 'Growth', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@example.com', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' };
async function checkout(env, h, o) {
  const req = new Request('https://alwaysopenoffice.com/billing/checkout', { method: 'POST', body: form(Object.assign({}, BASE, o)), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const r = await B.handleBilling(req, env, new URL(req.url), h);
  return { status: r.status, text: await r.text() };
}

test('medical and dental offices cannot sign up online, by the kind picked or by the name', async () => {
  const { env, h } = setup({ STRIPE_KEY: '' });
  for (const o of [{ type: 'Medical or dental office', business: 'Oconee Smiles' }, { type: 'Medical, dental or legal', business: 'Lakeside Dental' },
    { type: 'Other', business: 'Lake Oconee Family Dentistry' }, { type: 'Salon, spa or fitness', business: 'Putnam Chiropractic' }, { type: 'Other', business: 'Eatonton Urgent Care' }]) {
    const r = await checkout(env, h, o);
    assert.match(r.text, /<p class="err">We aren’t set up to handle patient health information/, o.business);
  }
  // a law office still goes on to payment (here: Stripe isn't set up in the test, so it stops at that message instead)
  for (const o of [{ type: 'Law office', business: 'Reid Law Firm' }, { type: 'Medical, dental or legal', business: 'Reid Law Firm' }, { type: 'Contractor or trade', business: 'Lawn Doctor of Eatonton' }, { type: 'Contractor or trade', business: 'The Car Clinic' }]) {
    const r = await checkout(env, h, o);
    assert.ok(!/<p class="err">We aren’t set up/.test(r.text), o.business + ' was refused as a health office');
    assert.match(r.text, /Online signup is not open yet/, o.business);
  }
  assert.equal(B.isHealthOffice('Medical or dental office', 'Anything'), true);
  assert.equal(B.isHealthOffice('Law office', 'Reid Law Firm'), false);
});

test('the signup page offers law offices on their own and explains the medical and dental answer before anyone pays', async () => {
  const { env, h } = setup({ STRIPE_KEY: '' });
  const page = async q => (await (await B.handleBilling(new Request('https://alwaysopenoffice.com/start' + q), env, new URL('https://alwaysopenoffice.com/start' + q), h)).text());
  const t = await page('');
  assert.match(t, /<option>Law office<\/option>/);
  assert.match(t, /<option>Medical or dental office<\/option>/);
  assert.ok(!/Medical, dental or legal/.test(t));
  assert.match(t, /<p class="err" id="hnote" hidden>/);
  assert.match(await page('?from=dental'), /<p class="err" id="hnote">/, 'from the dental link the note shows at once');
});

test('a client added by hand cannot be a medical or dental office either', async () => {
  const { env } = setup();
  const r = await B.createByHand(env, { business: 'Oak Dental', owner: 'Ann Oak', plan: 'Growth', type: 'Other' });
  assert.equal(r.ok, false); assert.match(r.error, /HIPAA/);
  assert.equal((await B.createByHand(env, { business: 'Reid Law Firm', owner: 'Sam Reid', plan: 'Growth', type: 'Law office' })).regulated, true);
});

async function pastClient(DB) {
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, phone, regulated, owner_first) VALUES ('c1', 'h1', 'Quillen Plumbing', 1, 'Pro', '4785550100', 0, 'Pat')").run();
  return { client_id: 'c1', regulated: 0, business: 'Quillen Plumbing' };
}
const post = b => new Request('https://x/api/import', { method: 'POST', body: JSON.stringify(b) });

test('nobody comes in from a file as OK to contact, and nobody is marked OK in bulk', async () => {
  const { DB, env } = setup();
  const c = await pastClient(DB);
  const csv = 'name,phone,date,amount,work\nOld Cust,4785550144,2026-03-15,400,drain cleaning\nNew Cust,4785550145,2026-05-01,300,faucet';
  const r = await (await P.apiImport(post({ action: 'save', csv, agreed: true }), env, c)).json();
  assert.equal(r.ok, true); assert.equal(r.agreed, false);
  assert.equal((await DB.prepare('SELECT SUM(agreed) AS a FROM biz_customers').first()).a, 0, 'the file’s "they all agreed" is ignored');
  const all = await (await P.apiImport(post({ action: 'agree', all: true, agreed: true }), env, c)).json();
  assert.equal(all.ok, false); assert.match(all.error, /one at a time/);
  const ids = ((await DB.prepare('SELECT id FROM biz_customers ORDER BY id').all()).results || []).map(x => x.id);
  const many = await (await P.apiImport(post({ action: 'agree', ids, agreed: true }), env, c)).json();
  assert.equal(many.ok, false);
  const one = await (await P.apiImport(post({ action: 'agree', id: ids[0], agreed: true }), env, c)).json();
  assert.equal(one.ok, true); assert.equal(one.changed, 1);
  // taking the OK away in bulk is still fine
  const off = await (await P.apiImport(post({ action: 'agree', all: true, agreed: false }), env, c)).json();
  assert.equal(off.ok, true);
  assert.equal((await DB.prepare('SELECT SUM(agreed) AS a FROM biz_customers').first()).a, 0);
});

test('a past-customer note goes by text only within 18 months of the last job, 3 months of an estimate', () => {
  const now = Date.parse('2026-11-21T15:00:00Z'), ago = d => new Date(now - d * 864e5).toISOString();
  assert.equal(P.reviveTextOk({ reason: 'Over a year since the last visit', last_at: ago(400) }, now), true);
  assert.equal(P.reviveTextOk({ reason: 'Over a year since the last visit', last_at: ago(600) }, now), false);
  assert.equal(P.reviveTextOk({ reason: 'Equipment getting older', last_at: ago(2000) }, now), false);
  assert.equal(P.reviveTextOk({ reason: 'Estimate went quiet', last_at: ago(60) }, now), true);
  assert.equal(P.reviveTextOk({ reason: 'Estimate went quiet', last_at: ago(120) }, now), false);
  assert.equal(P.reviveTextOk({ reason: 'Over a year since the last visit', last_at: '' }, now), false, 'no date, no text');
});
