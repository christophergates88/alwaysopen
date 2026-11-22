// The deploy waits for calls to end (Nov 21, 2026). Until then its check read the databases with wrangler, which the
// deploy's Cloudflare token could not do, so it said "unknown" on every deploy and never waited. Now the site answers
// /ops/busy from its own bindings, and these tests run the deploy step itself against the answers it can get.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const worker = (await import('../src/index.js')).default;

const ago = m => new Date(Date.now() - m * 60e3).toISOString();
async function setup(hq) {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_calls (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, at TEXT, outcome TEXT, test INTEGER DEFAULT 0)").run().catch(() => {});
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_log (at TEXT, kind TEXT, detail TEXT)").run().catch(() => {});
  if (hq) {
    env.HQDB = H.makeDB();
    await env.HQDB.prepare("CREATE TABLE IF NOT EXISTS hq_calls_out (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, status TEXT, approved_at TEXT)").run();
  }
  return { env, DB, site: H.makeClient(worker, env) };
}
const busy = (site, key) => site.call('/ops/busy', { method: 'POST', headers: key ? { 'x-key': key } : {} });

test('/ops/busy needs the ops key and a POST', async () => {
  const { env, site } = await setup();
  assert.equal((await busy(site)).status, 403);
  assert.equal((await busy(site, 'wrong')).status, 403);
  assert.equal((await site.call('/ops/busy', { headers: { 'x-key': env.LEADS_KEY } })).status, 403, 'GET');
  const r = await busy(site, env.LEADS_KEY);
  assert.equal(r.status, 200); assert.deepEqual(r.json(), { ok: true, calls: 0, drills: 0 });
});

test('/ops/busy counts a caller on the line and a practice run in progress, not ones long over', async () => {
  const { env, DB, site } = await setup();
  const add = (id, at, outcome) => DB.prepare("INSERT INTO app_calls (id, client_id, at, outcome) VALUES (?1, 'always-open', ?2, ?3)").bind(id, at, outcome).run();
  await add('CA-old-stuck', ago(30), 'live');   // never written up: the 20-minute sweep's, not a caller
  await add('CA-done', ago(3), 'done');
  assert.equal((await busy(site, env.LEADS_KEY)).json().calls, 0);
  await add('CA-now', ago(4), 'live');
  assert.equal((await busy(site, env.LEADS_KEY)).json().calls, 1);
  const log = (at, kind) => DB.prepare('INSERT INTO voice_log (at, kind, detail) VALUES (?1, ?2, ?3)').bind(at, kind, '{}').run();
  await log(ago(12), 'rehearse-taken');   // finished long ago
  await log(ago(1), 'rehearse-request');  // waiting: nothing is running yet
  assert.equal((await busy(site, env.LEADS_KEY)).json().drills, 0);
  await log(ago(2), 'rehearse-taken');
  assert.deepEqual((await busy(site, env.LEADS_KEY)).json(), { ok: true, calls: 1, drills: 1 });
});

test('/ops/busy counts a call Max is making for Christopher (Gates HQ), and a site without those tables still answers', async () => {
  const { env, site } = await setup(true);
  const add = (status, at) => env.HQDB.prepare('INSERT INTO hq_calls_out (at, status, approved_at) VALUES (?1, ?2, ?1)').bind(at, status).run();
  await add('done', ago(2)); await add('draft', ago(2)); await add('talking', ago(40));
  assert.equal((await busy(site, env.LEADS_KEY)).json().calls, 0);
  await add('talking', ago(3));
  assert.equal((await busy(site, env.LEADS_KEY)).json().calls, 1);
  await add('dialing', ago(1));
  assert.equal((await busy(site, env.LEADS_KEY)).json().calls, 2);
  const bare = await setup(false);   // no Gates HQ table at all
  assert.deepEqual((await busy(bare.site, bare.env.LEADS_KEY)).json(), { ok: true, calls: 0, drills: 0 });
});

// The deploy step, run as written in the workflow, against a fake site (curl) and a clock that does not wait (sleep).
function waitStep() {
  const y = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8').split('\n');
  const at = y.findIndex(l => /- name: Wait until no call is live/.test(l));
  assert.ok(at > 0, 'the step is there');
  const end = y.findIndex((l, i) => i > at && /^\s+- name: /.test(l));
  const lines = y.slice(at, end), r = lines.findIndex(l => /^\s+run: \|\s*$/.test(l));
  const body = lines.slice(r + 1), pad = Math.min(...body.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return body.map(l => l.slice(pad)).join('\n');
}
function runStep(answers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploywait-'));
  fs.writeFileSync(path.join(dir, 'answers.txt'), answers.join('\n') + '\n');
  // the n-th check gets the n-th answer; the last one repeats
  fs.writeFileSync(path.join(dir, 'curl'), '#!/bin/bash\nd=$(dirname "$0"); n=$(cat "$d/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/n"\nfor a in "$@"; do [ "$a" = "x-key: test-ops-key" ] && ok=1; done\n[ -z "$ok" ] && { echo "{\\"ok\\":false,\\"error\\":\\"not allowed\\"}"; exit 0; }\nt=$(wc -l < "$d/answers.txt"); [ $n -gt $t ] && n=$t\nsed -n "${n}p" "$d/answers.txt"\n');
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'curl'), 0o755); fs.chmodSync(path.join(dir, 'sleep'), 0o755);
  const r = spawnSync('bash', ['-e', '-c', waitStep()], { env: Object.assign({}, process.env, { PATH: dir + ':' + process.env.PATH, OPS_KEY: 'test-ops-key' }), encoding: 'utf8', timeout: 60e3 });
  const checks = +fs.readFileSync(path.join(dir, 'n'), 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr, checks };
}
const clear = '{"ok":true,"calls":0,"drills":0}';

test('deploy step: goes at once when nothing is live, and waits out a call', () => {
  let r = runStep([clear]);
  assert.equal(r.code, 0); assert.equal(r.checks, 1); assert.doesNotMatch(r.out, /warning|error/);
  r = runStep(['{"ok":true,"calls":1,"drills":0}', '{"ok":true,"calls":1,"drills":1}', clear]);
  assert.equal(r.code, 0); assert.equal(r.checks, 3, 'waited through two checks with a call live'); assert.match(r.out, /calls 1/);
});

test('deploy step: a call live for 40 minutes stops the deploy; a practice run is waited for 10 minutes, then cut', () => {
  let r = runStep(['{"ok":true,"calls":1,"drills":0}']);
  assert.equal(r.code, 1); assert.equal(r.checks, 120); assert.match(r.out, /A call stayed live for 40 minutes/);
  r = runStep(['{"ok":true,"calls":0,"drills":1}']);
  assert.equal(r.code, 0); assert.equal(r.checks, 30); assert.match(r.out, /practice run was still going after 10 minutes/);
  // a call that starts while a practice run is going is still waited for
  r = runStep(Array(29).fill('{"ok":true,"calls":0,"drills":1}').concat(['{"ok":true,"calls":1,"drills":1}', '{"ok":true,"calls":1,"drills":1}', clear]));
  assert.equal(r.code, 0); assert.equal(r.checks, 32);
});

test('deploy step: an answer it cannot read three times deploys with a warning (the old site, before /ops/busy exists)', () => {
  for (const bad of ['<!doctype html><title>Not found</title>', '{"ok":false,"error":"not allowed"}', '', '{"ok":true}']) {
    const r = runStep([bad]);
    assert.equal(r.code, 0, bad); assert.equal(r.checks, 3, bad); assert.match(r.out, /::warning::Could not check for live calls; deploying anyway/);
  }
  // one bad answer, then a real one: no warning
  const r = runStep(['', clear]);
  assert.equal(r.code, 0); assert.equal(r.checks, 2); assert.doesNotMatch(r.out, /warning/);
});
