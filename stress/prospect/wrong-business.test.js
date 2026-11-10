// BUG: the instant audit is about whatever business Google lists first, even when that is not the business the lead
// typed. A lead whose own business has no Google listing (or a differently spelled one) gets a competitor's audit,
// with the competitor's name in the subject line and the competitor's stars and problems presented as their own.
//
// Mailed letters already refuse this ("skipped: Google's top match has a different name", mail.js nameMatch); the
// audit email (leadmail.js sendAudit), the audit page (handleAuditPage) and a new client's "Your first look"
// (firstlook.js, on the welcome page right after they pay) do not check the name at all.
//
// SEVERITY: high.
// CAUSE: runAudit asks Google for one result and takes it (src/audit.js:66-68). sendAudit (src/leadmail.js:380-383),
//   handleAuditPage (src/leadmail.js:595-596) and firstLook (src/firstlook.js:49) use it without comparing names.
// SMALLEST FIX: in those three places count the audit as found only when
//   nameMatch(what they typed, a.business.name, town) is true (src/mail.js:49); otherwise take the path that already
//   exists for "Google had no match" (the one-question email and the "Audit needs a hand" push).
//
// Run: node --test stress/prospect/wrong-business.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, H, PLACE } from './_kit.mjs';

// Google's best match for "Whitfield Heating & Air in Gray, GA" when Whitfield has no listing: the plumber down the road.
const RIVAL = { id: 'ChIJrival', displayName: { text: 'Riverbend Plumbing' }, formattedAddress: '9 Main St, Gray, GA 31032, USA', rating: 3.1, userRatingCount: 12, primaryTypeDisplayName: { text: 'Plumber' }, businessStatus: 'CLOSED_TEMPORARILY', photos: [] };

test('control: when Google lists the business they typed, the audit goes out about that business', async () => {
  const s = site();
  s.world.places = { places: [PLACE] };
  await ask(s, { email: 'dana@sinclairplumbing.example', business: 'Sinclair Plumbing', town: 'Eatonton, GA' });
  assert.equal(s.out.length, 1);
  assert.match(s.out[0].subject, /^Your free audit: Sinclair Plumbing gets a [A-F]$/);
});

test('a lead never gets another business’s audit by email', async () => {
  const s = site();
  s.world.places = { places: [RIVAL] };
  await ask(s, { name: 'Dana Whitfield', email: 'dana@whitfieldhvac.example', business: 'Whitfield Heating & Air', town: 'Gray, GA' });
  assert.equal(s.out.length, 1, 'the lead still gets one email');
  const m = s.out[0];
  // What happens today: subject "Your free audit: Riverbend Plumbing gets a D", "Google may show this business as closed",
  // "3.1 stars from 12 reviews", all about a business Dana does not own.
  assert.doesNotMatch(m.subject, /Riverbend/, 'the subject names a business the lead did not ask about');
  const claims = (m.text.match(/Riverbend Plumbing: [A-F] \(\d+ of 100\)|3\.1 stars from 12 reviews|closed temporarily/g) || []);
  assert.deepEqual(claims, [], 'the body grades somebody else’s business as theirs');
  // And Christopher should hear that this one needs a hand, as he does when Google finds nothing.
  assert.ok(s.world.pushes.some(p => /Audit needs a hand/.test(p.title)), 'the operator is told only "their free audit already went to their inbox"');
});

test('a new paying client’s welcome page ("Your first look") never shows another business’s score', async () => {
  const s = site();
  await s.client.call('/start?plan=Growth');
  const r = await s.client.call('/billing/checkout', { form: { plan: 'Growth', max: '1', business: 'Whitfield Heating & Air', owner: 'Dana Whitfield', phone: '(478) 555-0111', email: 'dana@whitfieldhvac.example', town: 'Gray, GA', type: 'Contractor or trade', agree: '1' } });
  const id = r.location.split('/').pop();
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s.world.sessions.get(id) } });
  const secret = (await s.one("SELECT v FROM billing_config WHERE k = 'webhook_secret'")).v;
  assert.equal((await s.client.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } })).status, 200);
  s.world.places = { places: [RIVAL] };
  const w = await s.client.call('/welcome?s=' + id);
  assert.equal(w.status, 200);
  const look = w.text.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(look, /Welcome to Always Open, Dana/, 'control: it is Whitfield’s welcome page');
  const claims = look.match(/Your score: \d+ \([A-F]\)|Google lists its status as closed temporarily/g) || [];
  assert.deepEqual(claims, [], 'Whitfield Heating & Air, one minute after paying, is shown Riverbend Plumbing’s score and told Google may show them as closed');
});

test('a caller’s texted audit page never shows another business’s audit', async () => {
  const s = site();
  s.world.places = { places: [RIVAL] };
  await L.ensureLeadMail(s.env);
  const tok = 'AbCdEfGhJkMnPqRs';
  await s.DB.prepare("INSERT INTO leads (at, name, email, phone, business, town, origin, ip_hash, status, token, audit, audit_at) VALUES (?1, 'Dana', '', '+14785550101', 'Whitfield Heating & Air', 'Gray, GA', 'phone CAx', '', 'new', ?2, 'texted', ?1)").bind(new Date().toISOString(), tok).run();
  const r = await s.client.call('/your-audit/' + tok);
  assert.equal(r.status, 200);
  const title = (/<title>([^<]*)<\/title>/.exec(r.text) || [])[1];
  assert.doesNotMatch(title, /Riverbend/, 'the private audit page grades Riverbend Plumbing for a caller from Whitfield Heating & Air');
});
