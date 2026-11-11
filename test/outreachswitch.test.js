// The Outreach master switch on the ops board (Christopher, Nov 11, 2026: "Where is my button to turn the business to
// business auto dialer off?"): off in one tap, on in two, only with the board's link, and every Outreach call obeys it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const B = await import('../src/opsboard.js');
const O = await import('../src/outreach.js');
const { makeDB } = await import('./rehearsal/harness.js');

const post = (body, t) => new Request('https://alwaysopenoffice.com/ops/outreach-switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ t }, body)) });
const url = r => new URL(r.url);

test('the switch turns every Outreach call off and back on, with the board link only', async () => {
  const DB = makeDB(), env = { DB, LEADS_KEY: 'k-for-tests' };
  await DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run();
  await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('outreach_enabled', '1')").run();
  const t = await B.boardToken(env);
  let r = post({ on: false }, 'forged');
  assert.equal((await B.handleOpsBoard(r, env, url(r))).status, 403, 'no board link: nothing changes');
  assert.equal(await O.killSwitchOn(env), true);
  r = post({ on: 'off' }, t);
  assert.equal((await B.handleOpsBoard(r, env, url(r))).status, 400);
  r = post({ on: false }, t);
  assert.deepEqual(await (await B.handleOpsBoard(r, env, url(r))).json(), { ok: true, on: false });
  assert.equal(await O.killSwitchOn(env), false, 'off: the first gate every Outreach call checks says no');
  assert.ok(O.blockedBy({ status: 'ready', phone: '+14785550101' }, { killSwitchOn: false }).includes('kill switch off'));
  assert.match((await DB.prepare("SELECT v FROM billing_config WHERE k = 'outreach_switched'").first()).v, /^off 20/);
  r = post({ on: true }, t);
  assert.equal((await (await B.handleOpsBoard(r, env, url(r))).json()).on, true);
  assert.equal(await O.killSwitchOn(env), true);
});

test('the board shows the switch with what it controls, and the page asks twice before turning it on', async () => {
  const on = B.switchSection({ on: true, signed: 2, waiting: 14, list: { loaded: true, ready: true, dueBy: '2026-12-15' } });
  assert.match(on, /Max calling businesses: ON/);
  assert.match(on, /2 clients have signed up · 14 numbers waiting · Do Not Call list good until Dec 15/);
  assert.match(on, /data-osw="0">Turn off</);
  const off = B.switchSection({ on: false, signed: 1, waiting: 1, list: { loaded: false } });
  assert.match(off, /Max calling businesses: OFF/);
  assert.match(off, /1 client has signed up · 1 number waiting · Do Not Call list not loaded yet/);
  assert.match(off, /data-osw="1">Turn on</);
  const DB = makeDB(), env = { DB, LEADS_KEY: 'k-for-tests' };
  const t = await B.boardToken(env);
  const req = new Request('https://alwaysopenoffice.com/ops?t=' + t);
  const html = await (await B.handleOpsBoard(req, env, new URL(req.url))).text();
  assert.match(html, /<h2>Outreach calls<\/h2>/);
  assert.match(html, /Max calling businesses: OFF/, 'no setting saved yet reads as off');
  assert.match(html, /Tap again to turn on/);
  assert.match(html, /send\('\/ops\/outreach-switch'/);
  const index = (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /path === '\/ops\/outreach-switch'\) return handleOpsBoard/);
});
