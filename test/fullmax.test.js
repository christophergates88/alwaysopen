import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensitive, CATS } from '../src/fullmax.js';

test('review replies and low stars are never automatic', () => {
  assert.equal(sensitive({ kind: 'review', text: 'Thanks' }), true);
  assert.equal(sensitive({ kind: 'reviewreq', stars: 1, text: 'Thanks' }), true);
  assert.equal(sensitive({ kind: 'invoice', text: 'Your invoice is due Friday.' }), false);
});
test('money disputes and upset customers wait for the owner', () => {
  assert.equal(sensitive({ kind: 'invoice', text: 'About the refund you asked for' }), true);
  assert.equal(sensitive({ kind: 'reviewreq', context: 'Email to x@y.com', text: 'Sorry you were unhappy' }), true);
});
test('posts are not a category', () => { assert.ok(!CATS.includes('post')); assert.ok(!CATS.includes('review')); });

import { apiFullMax, fullMaxState, fullMaxCron } from '../src/fullmax.js';
function fakeDB(rows) {
  const sql = [];
  return { sql, prepare(s) { sql.push(s); const q = { bind: () => q, first: async () => { for (const k in (rows || {})) if (s.includes(k)) return rows[k]; return null; }, all: async () => ({ results: [] }), run: async () => ({}) }; return q; }, batch: async () => {} };
}
const req = (b) => ({ json: async () => b });

test('off by default', async () => {
  const st = await fullMaxState({ DB: fakeDB() }, { client_id: 'c1', regulated: 0 });
  assert.equal(st.on, false); assert.equal(st.paused, false);
  assert.ok(Object.values(st.cats).every(v => v === false));
});
test('regulated clients cannot turn it on', async () => {
  const r = await apiFullMax(req({ action: 'agree', agree: true }), { DB: fakeDB() }, { client_id: 'c1', regulated: 1 });
  assert.equal(r.ok, false); assert.match(r.error, /regulated/);
  const st = await fullMaxState({ DB: fakeDB() }, { client_id: 'c1', regulated: 1 });
  assert.equal(st.allowed, false);
});
test('turning it on needs the agreement ticked; staff cannot', async () => {
  assert.equal((await apiFullMax(req({ action: 'agree' }), { DB: fakeDB() }, { client_id: 'c1', regulated: 0 })).ok, false);
  assert.equal((await apiFullMax(req({ action: 'agree', agree: true }), { DB: fakeDB() }, { client_id: 'c1', regulated: 0, staff: 'Sam' })).ok, false);
  assert.equal((await apiFullMax(req({ action: 'agree', agree: true }), { DB: fakeDB() }, { client_id: 'c1', regulated: 0 })).ok, true);
});
test('the sender only looks at clients that are on and not paused', async () => {
  const db = fakeDB();
  await fullMaxCron({ DB: db });
  assert.ok(db.sql.some(s => /WHERE f\.on_ = 1 AND f\.paused = 0/.test(s)));
});
