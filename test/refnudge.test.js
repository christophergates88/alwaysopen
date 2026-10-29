// The referral line on Home: news first (earned, then applied in the last 30 days, then a sign-up waiting), else the
// invitation; the key changes with the news so a card put away comes back. Hidden for staff, regulated and the sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { nudgeOf } = await import('../src/referral.js');
const { appHtml } = await import('../src/apppage.js');
const now = Date.parse('2026-11-12T15:00:00Z');

test('news first, then the invitation', () => {
  assert.deepEqual(nudgeOf([], now), { kind: 'invite', key: 'invite', text: 'Know an owner who misses calls? Send them your link. When they’ve stayed three months, your next month is free.' });
  assert.equal(nudgeOf([{ status: 'pending', business: 'Dana’s Salon' }], now).text, 'Dana’s Salon signed up from your link. When they’ve stayed three months, your next month is free.');
  const rows = [{ status: 'pending', business: 'New Co' }, { status: 'earned', business: 'Lane Electric' }, { status: 'credited', business: 'Old Co', credited_at: '2026-11-01T00:00:00Z' }];
  assert.deepEqual(nudgeOf(rows, now), { kind: 'earned', key: 'earned:Lane Electric', text: 'Lane Electric stayed three months. Your free month is on its way.' });
  assert.equal(nudgeOf(rows.filter(r => r.status !== 'earned'), now).text, 'Your free month for sending Old Co is applied to your account.');
  assert.equal(nudgeOf([{ status: 'credited', business: 'Old Co', credited_at: '2026-09-01T00:00:00Z' }], now).kind, 'invite', 'an old free month is not news');
  assert.equal(nudgeOf([{ status: 'void', business: 'X' }], now).kind, 'invite');
});

test('the web app shows it only to owners of unregulated, real accounts, and the x puts it away until the news changes', () => {
  const js = appHtml({ base: '/app/x', business: 'X' }).split('<script>')[1].split('</script>')[0];
  const fn = new Function('S', 'isOwner', 'store', 'esc', js.match(/function homeRefer\(\)\{[\s\S]*?\n\}/)[0] + '; return homeRefer();');
  const esc = s => String(s);
  const owner = () => true, staff = () => false;
  const base = { referrals: { nudge: { kind: 'invite', key: 'invite', text: 'Know an owner?' } }, client: { regulated: false } };
  const none = () => null;
  assert.match(fn(base, owner, none, esc), /Know an owner\?/);
  assert.equal(fn(base, staff, none, esc), '');
  assert.equal(fn(Object.assign({}, base, { client: { regulated: true } }), owner, none, esc), '');
  assert.equal(fn(Object.assign({}, base, { sample: true }), owner, none, esc), '');
  const put = () => JSON.stringify({ k: 'invite', at: Date.now() - 864e5 });
  assert.equal(fn(base, owner, put, esc), '', 'put away yesterday');
  const news = Object.assign({}, base, { referrals: { nudge: { kind: 'waiting', key: 'waiting:Dana', text: 'Dana signed up.' } } });
  assert.match(fn(news, owner, put, esc), /Dana signed up\./, 'back when there is news');
  const old = () => JSON.stringify({ k: 'invite', at: Date.now() - 31 * 864e5 });
  assert.match(fn(base, owner, old, esc), /Know an owner\?/, 'back after 30 days');
});
