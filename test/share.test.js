import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, attractiveness } from '../src/share.js';

const rows = [
  { name: 'You', own: true, rating: 4.6, reviews: 80 },
  { name: 'Lane Electric', own: false, rating: 4.9, reviews: 120 },
  { name: 'B', own: false, rating: 4.2, reviews: 40 },
  { name: 'C', own: false, rating: 3.9, reviews: 15 },
];
test('shares of everyone sum to 100', () => {
  const list = rows.map(r => Object.assign({}, r));
  let sum = 0;
  for (const r of list) { const e = estimate(list.map(x => Object.assign({}, x, { own: x === r }))); sum += e.pct; }
  assert.ok(Math.abs(sum - 100) <= 2, 'sum was ' + sum);
});
test('a better rating or more reviews raises the share', () => {
  const base = estimate(rows).pct;
  const better = estimate(rows.map(r => r.own ? Object.assign({}, r, { rating: 4.9 }) : r)).pct;
  const more = estimate(rows.map(r => r.own ? Object.assign({}, r, { reviews: 200 }) : r)).pct;
  assert.ok(better > base); assert.ok(more > base);
  assert.ok(attractiveness({ rating: 5, reviews: 10 }) > attractiveness({ rating: 4, reviews: 10 }));
});
test('it is a range, with facts as factors and no advice', () => {
  const e = estimate(rows);
  assert.match(e.range, /^\d+-\d+%$/);
  assert.ok(e.lo < e.pct && e.pct < e.hi);
  assert.equal(e.factors.length, 2);
  assert.ok(e.factors.every(f => !/should|try|improve/i.test(f)));
  assert.ok(e.factors.some(f => /below Lane Electric/.test(f)));
});
test('nothing to compare means no estimate', () => {
  assert.equal(estimate([{ name: 'You', own: true, rating: 4.5, reviews: 10 }]), null);
  assert.equal(estimate([]), null);
});
