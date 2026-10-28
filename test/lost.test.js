import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReason, lostLine } from '../src/lost.js';

test('reasons normalize to the five buckets', () => {
  assert.equal(normalizeReason('price'), 'price');
  assert.equal(normalizeReason('too expensive'), 'price');
  assert.equal(normalizeReason('wanted it today'), 'timing');
  assert.equal(normalizeReason('distance'), 'distance');
  assert.equal(normalizeReason('too far to drive'), 'distance');
  assert.equal(normalizeReason('not what we do'), 'notus');
  assert.equal(normalizeReason('going with a cousin'), 'other');
  assert.equal(normalizeReason(''), '');
});

test('the line states counts, biggest first, no advice', () => {
  const l = lostLine({ price: 4, timing: 3, distance: 6, notus: 0, other: 0, total: 13 });
  assert.equal(l, 'Callers who did not book this month: 6 said too far, 4 said price, 3 wanted a different time.');
  assert.equal(lostLine({ total: 0 }), '');
});
