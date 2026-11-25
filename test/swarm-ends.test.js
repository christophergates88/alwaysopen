// Nov 24, 2026 swarm fixes (ends): (1) the "turn off call forwarding" push reaches an owner whose plan has ended,
// (2) tax, accounting, bookkeeping and mortgage offices are regulated by name, as the terms say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const B = await import('../src/billing.js');
const P = await import('../src/provision.js');
const APP = await import('../src/app.js');
const F = await import('../src/facts.js');

const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = 'O'.repeat(30), LINE = '+14785550100';
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, { APNS_KEY: PEM, APNS_KEY_ID: 'KEY1234567' });
H.installFetch(world, env);
const site = H.makeClient(worker, env);
const q = (sql, ...a) => DB.prepare(sql).bind(...a).run();
const get = (sql, ...a) => DB.prepare(sql).bind(...a).first();
const alive = async fn => { const keep = setInterval(() => {}, 20); try { return await fn(); } finally { clearInterval(keep); } };
const pushes = () => world.calls.filter(c => /push\.apple\.com\/3\/device\//.test(c.url)).map(c => ({ url: c.url, body: JSON.parse(c.body) }));

// ---------- Fix 1 ----------
test('forwarding-off push reaches a device of an ended client; ordinary pushes still do not; a mismatched link gets nothing', async () => {
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('c1', ?1, 'sinclair', 'Sinclair Plumbing', 'Pro', 'Dana', 1)", sha(OWNER));
  await q("INSERT INTO voice_lines (number, client_id, business, on_air, updated) VALUES (?1, 'c1', 'Sinclair Plumbing', 1, '2026-10-01')", LINE);
  const reg = await alive(() => site.call('/app/' + OWNER + '/api/device', { json: { token: 'a'.repeat(64) } }));
  assert.equal(reg.status, 200);
  const note = { aps: { alert: { title: 'x', body: 'y' } } };
  const gone = Date.now() + 60 * 864e5;
  // active: both kinds of push go
  let n = pushes().length;
  assert.equal(await APP.pushClient(env, 'c1', note), 1);
  assert.equal(pushes().length, n + 1);
  // the plan has ended
  await q("UPDATE app_clients SET active = 0 WHERE client_id = 'c1'");
  n = pushes().length;
  assert.equal(await APP.pushClient(env, 'c1', note), 0, 'ordinary push to an ended client goes nowhere');
  assert.equal(pushes().length, n);
  for (const stage of ['ended', 'week']) {
    n = pushes().length;
    await alive(() => P.forwardingOff(env, 'c1', stage, gone));
    const got = pushes().slice(n);
    assert.equal(got.length, 1, stage + ': the forwarding-off push reached the ended client\'s phone');
    assert.equal(got[0].body.aps.alert.title, 'Turn off call forwarding');
  }
  // the link code no longer matches: nothing, even for the forwarding notice
  await q("UPDATE app_devices SET code_hash = ?1 WHERE client_id = 'c1'", sha('somebody else'));
  n = pushes().length;
  await alive(() => P.forwardingOff(env, 'c1', 'week', gone));
  assert.equal(pushes().length, n, 'a device whose code no longer matches gets nothing');
  assert.equal(await APP.pushClient(env, 'c1', note, { evenIfEnded: true }), 0);
  assert.equal(await APP.pushClient(env, 'c1', note), 0);
});

// ---------- Fix 2 ----------
let nForm = 0;
async function signup(business, type) {
  const f = { plan: 'Growth', max: '0', owner: 'Dana Sinclair', town: 'Eatonton, GA', type: type || 'Other', agree: '1', business, email: 'e' + (++nForm) + '@buyer.example', phone: '(478) 555-' + String(2000 + nForm) };
  const r = await alive(() => site.call('/billing/checkout', { form: f }));
  assert.equal(r.status, 303, business + ': ' + r.text.slice(0, 200));
  const s = world.sessions.get(r.location.split('/').pop());
  const body = JSON.stringify({ id: 'evt_' + s.id, type: 'checkout.session.completed', data: { object: s } });
  const sec = await B.webhookSecret(env, 'billing');
  const w = await alive(() => site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(sec, body), 'content-type': 'application/json' } }));
  assert.equal(w.status, 200, w.text);
  const b = await get('SELECT * FROM billing WHERE session_id = ?1', s.id);
  await alive(() => site.call('/app/' + b.code));
  await alive(() => site.settle());
  return { client: await get('SELECT regulated FROM app_clients WHERE client_id = ?1', b.client_id), line: await get('SELECT regulated FROM voice_lines WHERE client_id = ?1', b.client_id) };
}
await site.call('/start?plan=Growth');

test('tax, accounting, bookkeeping and mortgage offices sign up regulated, app client and line', async () => {
  for (const name of ['Lakeside Tax Service', 'Smith & Co CPAs', 'Oconee Mortgage', 'Peach State Bookkeeping']) {
    const r = await signup(name, 'Other');
    assert.equal(+r.client.regulated, 1, name + ': app client');
    assert.ok(r.line, name + ': has a line');
    assert.equal(+r.line.regulated, 1, name + ': line');
  }
  // regardless of the kind picked from the list
  assert.equal(+(await signup('Lakeside Tax Service', 'Contractor or trade')).client.regulated, 1);
});

test('names that only look like them stay ordinary', async () => {
  for (const name of ['Taxidermy by Joe', 'Accountable Plumbing', 'Lake Country Veterinary Clinic']) {
    const r = await signup(name, 'Other');
    assert.equal(+r.client.regulated, 0, name);
    if (r.line) assert.equal(+r.line.regulated, 0, name);
  }
  for (const name of ['Syntax Signs', 'Loan-a-Tool Rentals', 'Taxi Express']) assert.equal(B.isRegulated('Other', name), false, name);
  for (const name of ['H&R Tax Service', 'Smith Tax & Accounting', 'Jones Accountants', 'Lake CPA', 'Taxes R Us', 'Georgia Lending Group', 'First Loan Officer Inc', 'Quick Loans', 'Payroll Services of Eatonton', 'A+ Bookkeepers', 'Tax Prep Plus', 'Putnam Mortgages']) assert.equal(B.isRegulated('Other', name), true, name);
});

test('facts.js tells the truth about who gets booking and Shoulder Tap', () => {
  const t = F.SERVICES_DAY_FIRST;
  assert.doesNotMatch(t, /an accounting or tax office, a mortgage broker or a vet included, gets booking/);
  assert.match(t, /accounting or tax office/);
  assert.match(t, /a vet[^.]*gets booking/);
  assert.match(t, /(insurance|law)[^.]*(accounting|tax)[^.]*(careful message|call(s)? back)|(accounting|tax)[^.]*(careful message|call(s)? back)/);
});
