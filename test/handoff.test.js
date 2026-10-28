import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighborsText, startHandoff } from '../src/handoff.js';

test('neighbors read plainly, nearest first as given', () => {
  assert.equal(neighborsText([{ business: 'Lane Electric', industry: 'electrical', miles: 1 }, { business: 'Oconee Roofing', industry: 'roofing', miles: 6 }]),
    'Lane Electric (electrical, 1 mile); Oconee Roofing (roofing, 6 miles)');
});
test('a hand-off only goes to a business on the list', async () => {
  const log = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { log.push(sql); } }), run: async () => { log.push(sql); } }), batch: async () => {} } };
  const list = [{ id: 'c2', business: 'Lane Electric', industry: 'electrical', number: '+14785550101', miles: 2 }];
  assert.equal(await startHandoff(env, 'c1', 'CA1', '+14783652533', 'Some Other Shop', list, 'electrical'), null);
  const n = await startHandoff(env, 'c1', 'CA1', '+14783652533', 'lane electric', list, 'electrical');
  assert.equal(n && n.id, 'c2');
  assert.ok(log.some(s => s.includes('INSERT INTO handoffs')));
});
