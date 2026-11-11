// When the Always Open check (a scheduled task outside the site) stops, Christopher is told once a day in plain words,
// never as an urgent push: leads, signups, calls and messages still reach him; only the filing into HQ waits (Nov 11, 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const F = await import('../src/funding.js');
const H = await import('./rehearsal/harness.js');

test('a stopped check: one calm alert a day that says what still works and what to do', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await F.ensureHeartbeats(env);
  assert.equal((await F.checkHeartbeat(env)).check, 'no heartbeat yet');
  await DB.prepare("INSERT INTO heartbeats (task, at) VALUES ('check', ?1)").bind(new Date(Date.now() - 116 * 3600e3).toISOString()).run();
  const first = await F.checkHeartbeat(env);
  assert.deepEqual([first.check, first.alert], ['urgent', 'sent']);
  const keys = (await DB.prepare("SELECT k FROM funding_alerts WHERE k LIKE 'check-run:%'").all()).results.map(r => r.k);
  assert.deepEqual(keys, ['check-run:warn'], 'filed as a once-a-day alert, not an every-four-hours one');
  const p = world.pushes[world.pushes.length - 1];
  assert.ok(p, 'the alert goes to his phone');
  assert.equal(p.title, 'Always Open: HQ has stopped updating itself');
  assert.match(p.body, /\(4 days ago\)/);
  assert.match(p.body, /still reach you right away/);
  assert.match(p.body, /turn the Always Open check back on/);
  assert.doesNotMatch(p.body, /reviews aren.t drafted/);
  assert.notEqual(p.priority, 'urgent');
  // an hour later: nothing more; a day later: once more
  assert.equal((await F.checkHeartbeat(env)).alert, 'limited');
  await DB.prepare("UPDATE funding_alerts SET at = at - 25 * 3600000 WHERE k = 'check-run:warn'").run();
  assert.equal((await F.checkHeartbeat(env)).alert, 'sent');
  // it runs again: the alert clears
  await DB.prepare("UPDATE heartbeats SET at = ?1 WHERE task = 'check'").bind(new Date().toISOString()).run();
  assert.equal((await F.checkHeartbeat(env)).check, 'ok');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM funding_alerts WHERE k LIKE 'check-run:%'").first()).n, 0);
});
