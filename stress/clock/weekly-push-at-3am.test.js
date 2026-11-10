// BUG: the Monday "Your week at <business>" push (with sound) wakes an owner in Hawaii at 3 AM and one in California at
// 5 AM, unless they happen to have connected a Google Calendar.
// What goes wrong for a real person: the weekly summary is meant for 8 AM Monday in the business's own time. For any
// business without Google Calendar connected, the job decides "is it 8 AM Monday?" on the East Coast. Kai, a plumber in
// Hilo, gets his phone buzzing at 3:00 AM every Monday (and the email at the same moment).
// Cause: src/biz.js:737-738. bizCron takes the zone only from gcal_tokens and otherwise uses 'America/New_York'. Every
// other job uses tzFor (callbacks.js:86-93), which falls back to the line's own zone (voice_lines.tz, set from the
// business's state when the number is bought), and the line here says Pacific/Honolulu.
// The same `lp` drives the 6 AM insights build on the next line (biz.js:754), which is quiet, so only the push matters.
// Severity: low (the owner, not a customer; once a week), but it is every Monday for every business west of Eastern
// time, and a 3 AM push is a reason to switch notifications off.
// Smallest fix: tz = await tzFor(env, c.client_id) (from callbacks.js) instead of the gcal-only lookup.
// Run: node --test stress/clock/weekly-push-at-3am.test.js   (1 control passes, 1 fails)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, clock, at, wallOf, ownerPushes, MIN } from './_kit.mjs';

const ck = clock(at('2026-11-12 12:00', 'America/New_York'));
after(() => ck.restore());
const T = await boot();
const GA = await T.signup({ plan: 'Growth', business: 'Sinclair Plumbing' });
const HI = await T.signup({ plan: 'Growth', business: 'Hilo Plumbing', owner: 'Kai Akana', email: 'kai@hiloplumbing.example', town: 'Hilo, HI', phone: '(808) 555-0101' });
const TOKEN = { [GA.cid]: 'a'.repeat(64), [HI.cid]: 'b'.repeat(64) };
for (const c of [GA, HI]) assert.equal((await T.site.call(c.base + '/api/device', { json: { token: TOKEN[c.cid] } })).status, 200);
// When (wall clock in the owner's zone) the first "Your week at" push reached each phone, Monday Nov 16.
const firstWeekly = {};
async function runMondayMorning() {
  for (let t = at('2026-11-16 00:00', 'America/New_York'); t <= at('2026-11-16 15:00', 'America/New_York'); t += 10 * MIN) {
    ck.set(t); await T.cron();
    for (const p of ownerPushes(T.world)) if (/^Your week at/.test(p.title) && !firstWeekly[p.token]) firstWeekly[p.token] = t;
  }
}

test('control: the Georgia owner gets "Your week" at 8 AM Monday, Eastern', async () => {
  assert.equal(HI.tz, 'Pacific/Honolulu', 'Kai’s line is on Hawaii time');
  await runMondayMorning();
  const t = firstWeekly[TOKEN[GA.cid]];
  assert.ok(t, 'pushed');
  assert.equal(wallOf(t, 'America/New_York').hour, 8);
});

test('the Hawaii owner gets "Your week" at 3 AM Monday, his time', async () => {
  const t = firstWeekly[TOKEN[HI.cid]];
  assert.ok(t, 'pushed');
  const w = wallOf(t, 'Pacific/Honolulu');
  assert.ok(w.hour >= 7, 'Kai’s phone got the weekly push at ' + w.text + ' Hawaii time');
});
