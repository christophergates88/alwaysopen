// FINDING: every per-sender abuse limit and the client-app brute-force lockout key off the cf-connecting-ip request
// header, which the worker trusts verbatim. An outsider who can set/rotate that header (header smuggling, the open
// *.workers.dev origin, or any ingress not strictly behind Cloudflare) bypasses them all. The clearest harm: knowing
// only a client's PUBLIC ref (it is in every share / quote / booking / QR link), a stranger floods that owner's request
// inbox -- and in production (APNs on) fires a push to the owner for each one. The app_fail lockout is likewise defeated.
//
//   node --test stress/intruder/trusted_ip.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lab } from './_lab.mjs';

const quote = (L, ref, i, ip) => L.site.call('/q/' + ref, {
  form: { name: 'Sender ' + i, phone: '478555' + String(1000 + i), need: 'planted request number ' + i, t: String(Date.now() - 5000) },
  ip
});

test('rotating cf-connecting-ip floods a client’s request inbox past the 5/hour cap', async () => {
  const L = await lab();
  const biz = await L.signUp();           // biz.ref is public
  const before = (await L.all('SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1', biz.cid))[0].n;

  // Control: 12 from ONE ip -> the per-IP cap (5/hour) stops the rest.
  let acceptedSameIp = 0;
  for (let i = 0; i < 12; i++) { const r = await quote(L, biz.ref, i, '203.0.113.9'); if (/Request sent|Solicitud enviada/.test(r.text)) acceptedSameIp++; }
  assert.ok(acceptedSameIp <= 5, 'one IP is held at the cap (' + acceptedSameIp + ' got through)');

  // Attack: rotate the trusted header -> every one is accepted and lands in the owner's app.
  const L2 = await lab();
  const b2 = await L2.signUp();
  let accepted = 0;
  for (let i = 0; i < 20; i++) { const r = await quote(L2, b2.ref, i, '45.76.3.' + i); if (/Request sent/.test(r.text)) accepted++; }
  const inserted = (await L2.all('SELECT COUNT(*) AS n FROM app_leads WHERE client_id = ?1', b2.cid))[0].n;
  assert.equal(accepted, 20, 'all 20 spoofed-IP requests accepted');
  assert.equal(inserted, 20, 'all 20 landed in the owner’s request list (each fires an owner push when APNs is set)');
});

test('rotating cf-connecting-ip defeats the /app/<code> brute-force lockout', async () => {
  const L = await lab();
  await L.signUp();
  const wrong = 'z'.repeat(32);   // a well-formed but wrong code

  // One IP: locked out (429) after FAIL_LIMIT (20) wrong tries in an hour.
  let lockedSameIp = 0;
  for (let i = 0; i < 25; i++) { const r = await L.site.call('/app/' + wrong + '/api/state', { ip: '198.51.100.5' }); if (r.status === 429) lockedSameIp++; }
  assert.ok(lockedSameIp > 0, 'a single IP is eventually locked out');

  // Rotating the header: never locked, so guessing can continue indefinitely.
  let lockedRot = 0;
  for (let i = 0; i < 40; i++) { const r = await L.site.call('/app/' + wrong + '/api/state', { ip: '192.0.2.' + i }); if (r.status === 429) lockedRot++; }
  assert.equal(lockedRot, 0, 'rotating cf-connecting-ip is never rate-limited');
});
