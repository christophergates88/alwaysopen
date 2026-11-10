// The ops board link (Nov 10, 2026): dated links last 30 days, the device that opens the board keeps a year-long signed
// cookie, and the old never-changing link opens it until Dec 10, 2026 so a bookmark can be opened once more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHmac } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const B = await import('../src/opsboard.js');
const env = { LEADS_KEY: 'k-for-tests' };
const legacy = createHmac('sha256', env.LEADS_KEY).update('ops-board-v1').digest('hex').slice(0, 40);
const req = cookie => ({ headers: new Headers(cookie ? { cookie } : {}) });

test('a dated link works for 30 days, then not; a forged one never', async () => {
  const t = await B.boardToken(env, Date.parse('2026-11-10T15:00:00Z'));
  assert.match(t, /^20261110[0-9a-f]{32}$/);
  const real = Date.now;
  try {
    Date.now = () => Date.parse('2026-12-09T12:00:00Z'); assert.equal(await B.boardOk(env, t), true, 'day 29');
    Date.now = () => Date.parse('2026-12-12T12:00:00Z'); assert.equal(await B.boardOk(env, t), false, 'day 32');
    Date.now = () => Date.parse('2026-11-11T12:00:00Z'); assert.equal(await B.boardOk(env, t.slice(0, 8) + '0'.repeat(32)), false);
  } finally { Date.now = real; }
});

test('the old link opens the board until Dec 10, and the device cookie keeps a bookmark working after that', async () => {
  const real = Date.now;
  try {
    Date.now = () => Date.parse('2026-11-20T12:00:00Z');
    assert.equal(await B.boardOk(env, legacy), true, 'the old link, inside the month');
    const set = await B.boardCookie(env);
    assert.match(set, /^aob=\d+\.[0-9a-f]{32}; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$/);
    const cookie = set.split(';')[0];
    Date.now = () => Date.parse('2027-02-01T12:00:00Z');
    assert.equal(await B.boardOk(env, legacy), false, 'the old link alone, after Dec 10');
    assert.equal(await B.boardOk(env, legacy, req(cookie)), true, 'the bookmark on the device that opened it');
    assert.equal(await B.boardOk(env, '', req('aob=' + cookie.split('=')[1].replace(/.$/, '0'))), false, 'an altered cookie');
    Date.now = () => Date.parse('2028-01-01T12:00:00Z');
    assert.equal(await B.boardOk(env, '', req(cookie)), false, 'the cookie runs out after a year');
  } finally { Date.now = real; }
});
