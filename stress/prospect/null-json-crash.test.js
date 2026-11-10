// BUG (small): anyone can make the site tell Christopher "Part of the website crashed". POST /audit/score (the public
// score box) and POST /audit/run (key-protected, but the body is read before the key is checked) parse the body as
// JSON and then read `b.q` (audit.js lines 133-135). The four characters `null` are valid JSON, so `b` is null, the
// read throws, the visitor gets a 500, and the crash catcher pushes and emails "Part of the website crashed" (once a
// day for each of the two routes).
//
// SEVERITY: low.
// SMALLEST FIX: right after the parse: if (!b || typeof b !== 'object') return h.json({ ok: false, error: 'Bad request' }, 400);
//
// Run: node --test stress/prospect/null-json-crash.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { site } from './_kit.mjs';

const post = (s, path, body) => s.client.call(path, { method: 'POST', body, headers: { 'content-type': 'application/json' } });

test('control: other bad bodies get a plain "bad request"', async () => {
  const s = site();
  for (const body of ['', '{', '[]', '"x"', '{"q":null}']) assert.equal((await post(s, '/audit/score', body)).status, 400, body);
  assert.equal(s.world.pushes.length, 0);
});

test('the body `null` on the public score box is a bad request, not a crash alert', async () => {
  const s = site();
  const r = await post(s, '/audit/score', 'null');
  await s.client.settle();
  assert.deepEqual({ status: r.status, alerts: s.world.pushes.map(p => p.title), emails: s.world.mail.length }, { status: 400, alerts: [], emails: 0 });
});

test('the body `null` on /audit/run without a key is refused, not a crash alert', async () => {
  const s = site();
  const r = await post(s, '/audit/run', 'null');
  await s.client.settle();
  assert.ok(r.status === 400 || r.status === 403, 'status ' + r.status);
  assert.deepEqual(s.world.pushes.map(p => p.title), []);
});
