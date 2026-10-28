import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAfterHours, publicLine, rateLine } from '../src/answerrate.js';

test('after hours is evenings, nights and weekends', () => {
  assert.equal(isAfterHours({ wd: 'Mon', hour: 9 }), false);
  assert.equal(isAfterHours({ wd: 'Mon', hour: 18 }), true);
  assert.equal(isAfterHours({ wd: 'Mon', hour: 7 }), true);
  assert.equal(isAfterHours({ wd: 'Sat', hour: 12 }), true);
});
test('nothing public under ten calls; a plain line above it', () => {
  assert.equal(publicLine({ month: '2026-09', after: 9, answered: 9 }), '');
  assert.equal(publicLine({ month: '2026-09', after: 23, answered: 23 }), 'Answered 100% of after-hours calls in September (23 calls)');
  assert.equal(publicLine({ month: '2026-09', after: 20, answered: 19 }), 'Answered 95% of after-hours calls in September (20 calls)');
});
test('the owner line states the count', () => {
  assert.equal(rateLine({ month: '2026-10', after: 3, answered: 3 }), 'After hours October: 3 calls. 3 answered.');
  assert.equal(rateLine({ month: '2026-10', after: 0, answered: 0 }), '');
});
