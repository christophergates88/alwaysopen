import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayFor, shareMessage } from '../src/firstlook.js';

test('the one thing today is always something that works now', () => {
  assert.equal(todayFor({ findingTitle: 'No recent reviews', qr: true, line: true, forwarded: false }).key, 'qr');
  assert.equal(todayFor({ findingTitle: 'No hours on Google', qr: true, line: true, forwarded: false, lineText: '(478) 555-0100' }).key, 'forward');
  assert.equal(todayFor({ findingTitle: '', line: true, forwarded: true, quoteLink: 'https://alwaysopenoffice.com/q/x' }).key, 'share');
  assert.equal(todayFor({}).key, 'app');
  assert.ok(!/tomorrow|soon|will be/i.test(JSON.stringify(todayFor({ line: true, forwarded: false, lineText: 'x' }))));
});
test('the share note uses real wins only and says who gets the free month', () => {
  const m = shareMessage({ calls: 23, bookings: 6, paid: 1840 }, 'https://alwaysopenoffice.com/?ref=sinc#contact');
  assert.match(m, /Max picked up 23 calls I couldn’t, 6 jobs got booked/);
  assert.match(m, /\$1,840 in invoices got paid/);
  assert.match(m, /I get a month free/);
  assert.ok(!/undefined|NaN|\b0 calls/.test(shareMessage({ calls: 0, bookings: 1, paid: 0 }, 'x')));
  assert.ok(!/!/.test(m));
});
