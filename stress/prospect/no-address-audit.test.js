// BUG (small, needs a configuration slip): the follow-ups refuse to go out when the postal address is not set
// (leadmail.js followCron: "held: no postal address set"), because every marketing email must carry it. The first
// email, the audit itself, has no such check: sendAudit and the audit-page copy send with the address line simply
// missing (leadmail.js footer()). BUSINESS_ADDRESS is a plain [vars] entry in wrangler.toml today, so this only bites
// if that line is ever lost or the Worker is deployed to another environment without it. When it does, every audit
// email goes out without the address the law asks for, and nothing says so.
//
// SEVERITY: low (it needs the setting to go missing).
// CAUSE: followCron checks (src/leadmail.js:458); sendAudit and the copy do not (footer(), src/leadmail.js:179-188).
// SMALLEST FIX: in sendAudit, when the address is empty, mark the lead held and push once, as for the daily cap.
//
// Run: node --test stress/prospect/no-address-audit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site, ask, L, ADDRESS } from './_kit.mjs';

test('control: with the address set, the audit email carries it', async () => {
  const s = site();
  await ask(s, { email: 'dana@example.com' });
  assert.ok(s.out[0].text.includes(ADDRESS) && s.out[0].html.includes(ADDRESS));
});

test('control: with no address set, the follow-ups are held', async () => {
  const s = site({ BUSINESS_ADDRESS: '' });
  assert.deepEqual(await L.followCron(s.env, Date.parse('2026-10-28T14:00:00Z')), { held: 'no postal address set' });
});

test('with no address set, the audit email is held too (or Christopher is told)', async () => {
  const s = site({ BUSINESS_ADDRESS: '' });
  await ask(s, { email: 'dana@example.com' });
  // The footer line reads "... Lake Country Foam Party, LLC, <street, town, state zip>." With no address it ends at "LLC."
  const sentWithoutAddress = s.out.filter(m => !/Lake Country Foam Party, LLC, [^\n]*\b\d{5}\b/.test(m.text)).length;
  const told = s.world.pushes.some(p => /address/i.test(p.title + p.body));
  assert.ok(sentWithoutAddress === 0 || told, sentWithoutAddress + ' audit email went out with no postal address in its footer, and nobody was told');
});
