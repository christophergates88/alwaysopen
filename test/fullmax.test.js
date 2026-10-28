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
