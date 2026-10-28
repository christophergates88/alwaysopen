import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteNow, purgeGoogle, ATTRIBUTION } from '../src/rivals.js';

test('the note states current facts only', () => {
  const rows = [{ own: true, name: 'You', rating: 4.6, reviews: 80 }, { name: 'Lane Electric', rating: 4.9, reviews: 120 }, { name: 'B', rating: 4.2, reviews: 40 }];
  const n = noteNow(rows);
  assert.match(n, /Lane Electric has the most reviews on your list \(120\)\. You have 80\./);
  assert.match(n, /highest rating on your list is 4\.9 \(Lane Electric\)\. Yours is 4\.6\./);
  assert.ok(!/should|try|gained|lost|this week/i.test(n));
});
test('credit reads Google Maps', () => assert.equal(ATTRIBUTION, 'Google Maps'));
test('the purge removes Google content and keeps place IDs', async () => {
  const sql = [];
  const env = { DB: { prepare: (s) => ({ bind: () => ({ s }), run: async () => { sql.push(s); return {}; }, s }), batch: async (st) => { for (const x of st) sql.push(x.s || ''); } } };
  await purgeGoogle(env);
  const all = sql.join('\n');
  assert.match(all, /DELETE FROM rival_snap WHERE client_id != \?1/);
  assert.match(all, /UPDATE rival_list SET name = ''/);
  assert.match(all, /lat = NULL, lng = NULL/);
  assert.ok(!/DELETE FROM rival_list/.test(all), 'place IDs stay');
});
