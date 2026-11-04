// Client emails and the radar/storm emails are neon, short and plain: a sign, numbers, a Do-this step, no "AI", no Christopher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { weeklyEmail, reportEmail, askEmail } = await import('../src/clientmail.js');
const { stormEmail } = await import('../src/stormdesk.js');
const { radarEmail } = await import('../src/index.js');

const clean = (m) => { for (const t of [m.text, m.html]) { assert.doesNotMatch(t, /\bAI\b/); assert.doesNotMatch(t, /Christopher|central Georgia/); } assert.match(m.html, /Tilt Neon/); assert.ok(m.subject); };

test('the weekly note leads with what to do, then the four numbers', () => {
  const m = weeklyEmail({ business: 'Sinclair Plumbing', owner_first: 'Sam' }, { calls: 3, bookings: 1, requests: 0, reviews: 2, unpaid: 500, paid: 0, lost: null, handoffs: {} }, {});
  clean(m);
  assert.match(m.text, /^\[ 1 THING \]/);
  assert.match(m.text, /DO THIS\n1\. \$500 in invoices is still open/);
  assert.match(m.text, /3 calls {3}\| {3}1 booking/);
  const q = weeklyEmail({ business: 'X' }, { calls: 0, bookings: 0, requests: 0, reviews: 0, unpaid: 0, paid: 0, handoffs: {} }, {});
  assert.match(q.text, /^\[ QUIET WEEK \]/);
});

test('report, review ask, storm and radar emails are neon and plain', () => {
  clean(reportEmail({ business: 'X' }, 'October 2026', { stats: { calls: 9, reviews: 2 }, note: 'Nine calls.' }));
  const a = askEmail({ first: 'Sam' }, 'Max has taken 9 calls for you', 'https://alwaysopenoffice.com/r/x', false); clean(a);
  assert.match(a.text, /Katie/);
  const s = stormEmail({ id: 'i', event: 'Flood Warning', grp: 'flood', counties: 'Putnam County, GA', businesses: 'A', drafted: 1, ends: '', headline: 'h', link: 'https://alerts.weather.gov' }); clean(s);
  assert.match(s.text, /^\[ FLOOD WARNING \]/);
  const r = radarEmail('2026-W45', [{ town: 'Eatonton, GA', wave: true, rate: 3, low: 1, recent: 9 }, { town: 'Madison, GA', wave: false, rate: 0, low: 0, recent: 2 }], []);
  clean(r);
  assert.match(r.text, /^\[ RATES RISING \]/); assert.match(r.subject, /Eatonton, GA/);
  assert.doesNotMatch(r.text, /\|.*\|.*\|.*\|/, 'no more pipe-separated rows');
  assert.match(radarEmail('w', [{ town: 'M', wave: false, rate: 0, low: 0, recent: 1 }], []).text, /^\[ ALL QUIET \]/);
});
