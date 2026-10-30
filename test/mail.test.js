// Mailed grade letters: queued by the Prospector, mailed within Christopher's caps, only to businesses with something
// to fix and never to anyone we already know; a QR code opens their live audit, and the first scan pings Christopher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const M = await import('../src/mail.js');
const { qrMatrix } = await import('../src/qr.js');

const TUE_11 = Date.parse('2026-11-03T16:00:00Z');   // Tuesday 11 AM Eastern
const audit = (name, grade, extra) => Object.assign({ found: true, at: new Date(TUE_11).toISOString(), grade, score: { A: 92, B: 80, C: 66, D: 48, F: 30 }[grade],
  business: { name, address: '201 N Jefferson Ave, Eatonton, GA 31024, USA', type: 'Plumber', rating: 4.1, reviews: 23, status: 'OPERATIONAL' },
  areas: [{ label: 'Reviews', grade: 'D' }], findings: [{ title: 'Fewer reviews than nearby competitors', saw: '23 reviews, while the busiest nearby average 140.', fix: 'We ask every customer for a review after each job.' }], fine: [] }, extra || {});

async function setup() {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB, { LOB_KEY: 'live_abc123', BUSINESS_ADDRESS: '103 W Sumter St, Eatonton, GA 31024' });
  H.installFetch(world, env);
  await (await import('../src/leadmail.js')).ensureLeadMail(env);
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active) VALUES ('c1', 'h1', 'Pickard Auto', 1)").run();
  const lob = [];
  const h = {
    ping: false,
    run: async (e, q) => ({ 'Quillen Plumbing': audit('Quillen Plumbing', 'D'), 'Tolliver Heating and Air': audit('Tolliver Heating and Air', 'B'), 'Pickard Auto': audit('Pickard Auto', 'F'), 'Brannock Builders': audit('Brannock Builders', 'C', { business: { name: 'Brannock Builders', address: 'Eatonton, GA', status: 'OPERATIONAL', rating: 4, reviews: 3 } }) }[q] || { found: false }),
    fetch: async (url, init) => {
      const b = JSON.parse(init.body || '{}');
      // Lob fetches the letter's page while it makes the letter.
      const tk = String(b.file).split('/').pop();
      lob.push({ url, b, key: init.headers['idempotency-key'], auth: init.headers.authorization, page: await M.serveLetter(env, tk) });
      return new Response(JSON.stringify({ id: 'ltr_' + lob.length, expected_delivery_date: '2026-11-06' }), { status: 200 });
    }
  };
  return { world, DB, env, lob, h };
}

test('addresses split the way the mail service wants them', () => {
  assert.deepEqual(M.splitAddress('201 N Jefferson Ave, Eatonton, GA 31024, USA'), { address_line1: '201 N Jefferson Ave', address_city: 'Eatonton', address_state: 'GA', address_zip: '31024' });
  assert.deepEqual(M.splitAddress('1180 Lake Oconee Pkwy Suite 4, Greensboro, GA 30642-1234'), { address_line1: '1180 Lake Oconee Pkwy Suite 4', address_city: 'Greensboro', address_state: 'GA', address_zip: '30642' });
  assert.equal(M.splitAddress('Eatonton, GA'), null, 'no street, no letter');
});

test('the QR code: the right size for a link, with its three corner squares', () => {
  const m = qrMatrix('https://alwaysopenoffice.com/your-audit/AbCdEfGhJkLmNpQr');
  assert.equal(m.length, 33, 'version 4');
  for (const [x, y] of [[0, 0], [26, 0], [0, 26]]) {
    assert.equal(m[y][x] && m[y][x + 6] && m[y + 6][x] && m[y + 3][x + 3], true);
    assert.equal(m[y + 1][x + 1], false);
  }
  assert.throws(() => qrMatrix('x'.repeat(200)), /too long/);
});

test('nothing is mailed before Christopher turns it on, or outside weekday mailing hours', async () => {
  const { env, lob, h } = await setup();
  await M.queueLetters(env, [{ q: 'Quillen Plumbing', town: 'Eatonton, GA' }]);
  assert.deepEqual(await M.mailCron(env, TUE_11, h), { off: 'not turned on' });
  assert.deepEqual(await M.turnOn(env, 5, 60), { on: true, daily: 5, monthly: '$60', lob: 'live key', returnAddress: 'set' });
  assert.deepEqual(await M.mailCron(env, Date.parse('2026-11-01T16:00:00Z'), h), { waiting: 'outside mailing hours' }, 'Sunday');
  assert.deepEqual(await M.mailCron(env, Date.parse('2026-11-03T21:00:00Z'), h), { waiting: 'outside mailing hours' }, '4 PM');
  assert.equal(lob.length, 0);
  assert.deepEqual(await M.mailCron({ DB: env.DB }, TUE_11, h), { off: 'no Lob key' });
  assert.deepEqual(await M.mailCron({ DB: env.DB, LOB_KEY: 'live_x' }, TUE_11, h), { off: 'no return address' }, 'never a made-up return address');
});

test('mailed: a D gets a letter with its QR code; a B, a client, a business without a street and one not found are skipped', async () => {
  const { DB, env, lob, h } = await setup();
  await M.turnOn(env, 5, 60);
  assert.deepEqual(await M.queueLetters(env, [
    { q: 'Quillen Plumbing', town: 'Eatonton, GA' }, { q: 'Tolliver Heating and Air', town: 'Eatonton, GA' }, { q: 'Pickard Auto', town: 'Eatonton, GA' },
    { q: 'Brannock Builders', town: 'Eatonton, GA' }, { q: 'Nobody Here', town: 'Gray, GA' }, { q: 'Quillen Plumbing', town: 'Eatonton, GA' }]), { added: 5 }, 'the same business once');
  let r = await M.mailCron(env, TUE_11, h);
  assert.deepEqual(r.results.map(x => [x.q, x.result]), [['Quillen Plumbing', 'sent'], ['Tolliver Heating and Air', 'skipped: already in good shape (B)'], ['Pickard Auto', 'skipped: already a client']]);
  r = await M.mailCron(env, TUE_11 + 10 * 60e3, h);
  assert.deepEqual(r.results.map(x => x.result), ['skipped: no mailing address on Google', 'skipped: not found on Google']);
  assert.equal(lob.length, 1);
  const L = lob[0];
  assert.equal(L.url, 'https://api.lob.com/v1/letters');
  assert.equal(L.auth, 'Basic ' + btoa('live_abc123:'));
  assert.equal(L.key, 'ao-letter-1', 'one letter per queue row, however often it is retried');
  assert.deepEqual(L.b.to, { name: 'Quillen Plumbing', address_line1: '201 N Jefferson Ave', address_city: 'Eatonton', address_state: 'GA', address_zip: '31024' });
  assert.deepEqual(L.b.from, { name: 'Always Open', address_line1: '103 W Sumter St', address_city: 'Eatonton', address_state: 'GA', address_zip: '31024' });
  assert.deepEqual([L.b.color, L.b.mail_type, L.b.use_type, L.b.address_placement], [true, 'usps_first_class', 'marketing', 'insert_blank_page']);
  assert.match(L.page, /Quillen Plumbing, graded/);
  assert.match(L.page, /<svg[^>]*aria-label="QR code to your live audit"/);
  assert.match(L.page, /alwaysopenoffice\.com\/your-audit\/[A-Za-z0-9]{16}/);
  assert.match(L.page, /The Always Open team, Eatonton, Georgia/);
  assert.doesNotMatch(L.page, /Christopher/, 'signed by the team');
  assert.match(L.page, /Try it for a month\. If it isn’t worth it, you don’t pay\./);
  const row = await DB.prepare("SELECT status, html, letter_id, expected, cost, token, lead_id, note FROM mail_queue WHERE q = 'Quillen Plumbing'").first();
  assert.deepEqual([row.status, row.html, row.letter_id, row.expected, row.cost, row.note], ['sent', '', 'ltr_1', '2026-11-06', 142, '']);
  assert.equal(await M.serveLetter(env, row.token), null, 'the page is gone once the letter is made');
  const lead = await DB.prepare('SELECT business, status, origin, token, audit, grade FROM leads WHERE id = ?1').bind(row.lead_id).first();
  assert.deepEqual([lead.business, lead.status, lead.origin, lead.token, lead.audit, lead.grade], ['Quillen Plumbing', 'letter', 'letter 1', row.token, 'letter', 'D']);
  // Six months on, the same business is not mailed again.
  await M.queueLetters(env, [{ q: 'Quillen Plumbing LLC', town: 'Eatonton' }]);
  r = await M.mailCron(env, TUE_11 + 20 * 60e3, h);
  assert.match(r.results[0].result, /^skipped: (mailed in the last 6 months|already in the pipeline)$/);
});

test('the caps hold: a day’s letters and the month’s dollars', async () => {
  const { env, lob, h } = await setup();
  const plain = h.run;
  h.run = async (e, q) => /^Shop /.test(q) ? audit(q, 'D') : plain(e, q);
  await M.turnOn(env, 2, 60);
  const many = []; for (let i = 0; i < 12; i++) many.push({ q: 'Shop ' + i, town: 'Eatonton, GA' });
  await M.queueLetters(env, many);
  await M.mailCron(env, TUE_11, h);
  assert.equal(lob.length, 2, 'two a day');
  assert.deepEqual(await M.mailCron(env, TUE_11 + 10 * 60e3, h), { waiting: 'cap reached', today: 2, month: '$2.84' });
  await M.turnOn(env, 25, 10);                       // $10 a month buys 7 letters at $1.42
  for (let t = 0; t < 4; t++) await M.mailCron(env, TUE_11 + 864e5 + t * 10 * 60e3, h);   // three a run at most
  assert.equal(lob.length, 7, 'stops at the month’s dollars');
  assert.deepEqual(await M.mailCron(env, TUE_11 + 864e5 + 50 * 60e3, h), { waiting: 'cap reached', today: 5, month: '$9.94' });
  assert.deepEqual(new Set(lob.map(x => x.key)).size, 7, 'each letter its own key');
});

test('the first scan of a letter’s code pings Christopher, once; the 7 AM push lists landings and scans', async () => {
  const { DB, env, h } = await setup();
  await M.turnOn(env, 5, 60);
  await M.queueLetters(env, [{ q: 'Quillen Plumbing', town: 'Eatonton, GA' }]);
  await M.mailCron(env, TUE_11, h);
  const row = await DB.prepare("SELECT token FROM mail_queue WHERE q = 'Quillen Plumbing'").first();
  const L = await import('../src/leadmail.js');
  const pings = [];
  const page = async () => L.handleAuditPage(new Request('https://alwaysopenoffice.com/your-audit/' + row.token), env, new URL('https://alwaysopenoffice.com/your-audit/' + row.token), { run: h.run, letterPing: async (t, b) => pings.push(t + ' | ' + b) });
  const r1 = await page();
  assert.match(await r1.text(), /Quillen Plumbing/);
  await page();
  assert.equal(pings.length, 1);
  assert.match(pings[0], /^Always Open: Quillen Plumbing just scanned their letter \| Quillen Plumbing in Eatonton, GA is looking at their audit right now \(grade D\)/);
  assert.match(await M.mailMorning(env, Date.parse('2026-11-06T11:00:00Z')), /^Letters landing today: Quillen Plumbing\./);
  assert.match(await M.mailMorning(env, Date.now()), /Letters scanned: Quillen Plumbing\./);
});

test('a test key makes three proofs and mails nothing; the live key puts them back in line', async () => {
  const { DB, env, lob, h } = await setup();
  env.LOB_KEY = 'test_abc123';
  const plain = h.run; h.run = async (e, q) => /^Shop /.test(q) ? audit(q, 'F') : plain(e, q);
  const pings = []; h.ping = async (t, b) => pings.push(t + ' | ' + b);
  assert.match((await M.turnOn(env, 5, 60)).lob, /^test key/);
  await M.queueLetters(env, [0, 1, 2, 3, 4].map(i => ({ q: 'Shop ' + i, town: 'Eatonton, GA' })));
  let r = await M.mailCron(env, TUE_11, h);
  assert.deepEqual([r.mailed, r.proofs], [0, 3]);
  assert.deepEqual(await M.mailCron(env, TUE_11 + 10 * 60e3, h), { waiting: '3 proofs made; the live key mails' });
  assert.match(pings[0], /^Always Open: 3 proof letters are ready in Lob \| Shop 0 \(F\)\nShop 1 \(F\)\nShop 2 \(F\)\nNot mailed/);
  const proof = await DB.prepare("SELECT status, cost, note, lead_id FROM mail_queue WHERE q = 'Shop 0'").first();
  assert.deepEqual([proof.status, proof.cost, proof.note], ['proof', 0, 'proof: made in Lob, not mailed']);
  assert.ok(await DB.prepare('SELECT id FROM leads WHERE id = ?1').bind(proof.lead_id).first(), 'the proof’s code opens a real audit page');
  env.LOB_KEY = 'live_abc123';
  r = await M.mailCron(env, TUE_11 + 864e5, h);
  assert.deepEqual(r.results.map(x => [x.q, x.result]), [['Shop 0', 'sent'], ['Shop 1', 'sent'], ['Shop 2', 'sent']], 'the proofs’ businesses get the real letter');
  assert.equal(await DB.prepare('SELECT id FROM leads WHERE id = ?1').bind(proof.lead_id).first(), null, 'the proof’s page is retired');
  assert.equal(lob.length, 6);
  assert.equal(lob[3].auth, 'Basic ' + btoa('live_abc123:'));
});
