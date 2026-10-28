import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, promptFor } from '../src/aicheck.js';

const ours = { business: 'Sinclair Plumbing LLC', phones: ['478-555-0101'], website: 'https://sinclairplumbing.com', town: 'Eatonton, GA' };
test('named and right: nothing to fix', () => {
  const r = compare({ recommended: ['Oconee Rooter', 'Sinclair Plumbing', 'Lake Plumbing'], about: { found: true, phone: '(478) 555-0101', website: 'http://www.sinclairplumbing.com/', address: '1 Main St, Eatonton, GA' } }, ours);
  assert.equal(r.mentioned, true); assert.equal(r.rank, 2); assert.equal(r.wrong.length, 0);
});
test('an old phone number or another site is flagged', () => {
  const r = compare({ recommended: ['Oconee Rooter'], about: { found: true, phone: '706-555-9999', website: 'https://oldsite.net', address: '9 Elm St, Madison, GA' } }, ours);
  assert.equal(r.mentioned, false);
  assert.deepEqual(r.wrong.map(w => w.field).sort(), ['address', 'phone', 'website']);
});
test('the question reads like a customer and asks for nothing invented', () => {
  const p = promptFor('Sinclair Plumbing', 'plumbing', 'Eatonton, GA');
  assert.match(p, /plumbing business in Eatonton, GA/);
  assert.match(p, /Never guess/);
});
