// BUG (low): bad input that should be a 400 comes back as a 500 "Something went wrong on our side".
//  1. A JSON body of null. 23 routes do `let b = {}; try { b = await req.json(); } catch (e) {}` and then read b.action,
//     b.id and so on; JSON null parses fine, so b is null and the next line throws (src/app.js:264, 271, 328 and the
//     handlers in biz.js, extras.js, past.js, reviews.js, rivals.js, firstlook.js, fillweek.js, fullmax.js, answerrate.js,
//     checkin.js, outcalls.js, handoff.js, callbacks.js, map.js).
//  2. An appointment follow-up with a time and a date that passes the YYYY-MM-DD check but is not a day ("2026-13-45"):
//     new Date(NaN).toISOString() throws (src/app.js:789-795).
// Run: node --test stress/owner/bad-input-500s.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './_setup.mjs';

const T = await boot();
let A;
before(async () => { A = await T.signup({ plan: 'Pro', business: 'Sinclair Plumbing' }); });

const ROUTES = ['decide', 'message', 'job', 'device', 'call', 'line', 'results', 'lead', 'invoice', 'followup', 'work', 'quote', 'stripe', 'inbox', 'insights', 'team', 'prefs', 'import', 'revive',
  'versions', 'rivals', 'firstlook', 'fillweek', 'fullmax', 'answer', 'checkins', 'outcalls', 'outreach', 'handoff', 'callbacks', 'map'];

test('a body of JSON null is refused politely on every POST route', async () => {
  const crashed = [];
  for (const r of ROUTES) {
    const res = await T.site.call(A.base + '/api/' + r, { method: 'POST', body: 'null', headers: { 'content-type': 'application/json' } });
    if (res.status >= 500) crashed.push('/api/' + r);
  }
  assert.deepEqual(crashed, [], crashed.length + ' of ' + ROUTES.length + ' routes answered 500');
});

test('other odd bodies are fine (so it is only null)', async () => {
  const crashed = [];
  for (const r of ROUTES) for (const body of ['', '[]', '123', '"x"', '{', '[[[[[[[[[[[[]]]]]]]]]]]]', '{"id":{"a":[1]},"action":["x"]}']) {
    const res = await T.site.call(A.base + '/api/' + r, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    if (res.status >= 500) crashed.push('/api/' + r + ' ' + body);
  }
  assert.deepEqual(crashed, []);
});

test('an appointment follow-up for the 45th day of the 13th month is refused, not a crash', async () => {
  const a = T.as(A.base);
  const r = await a.post('/api/followup', { kind: 'appointment', name: 'Sam', phone: '478-555-0188', due: '2026-13-45', time: '10:30', by: 'Dana' });
  assert.equal(r.status, 400, 'answered ' + r.status + ' ' + r.text);
});
