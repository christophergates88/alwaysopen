import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../src/upgrades.js';

const base = { calls: 20, missed: 4, minutes: 270, reviews: 2, low: 0, leads: 6, unpaidN: 2, unpaid: 1840, quotes: 3, hasLine: true, website: '', kind: 'plumbing', trades: true, food: false, health: false, insurance: false };
test('every upgrade has a fit from 5 to 95 in steps of 5 and at least one reason', () => {
  for (const u of score(base, { tier: 'Starter', regulated: 0 })) {
    assert.ok(u.fit >= 5 && u.fit <= 95 && u.fit % 5 === 0, u.id + ' ' + u.fit);
    assert.ok(u.why.length >= 1, u.id);
    assert.ok(!/!|\bAI\b|\blocal\b|Chris/.test(u.why.join(' ') + u.name + u.what), u.id);
  }
});
test('sorted best fit first; plans above the current one only', () => {
  const s = score(base, { tier: 'Growth', regulated: 0 });
  assert.ok(!s.find(u => u.id === 'plan-growth'));
  assert.ok(s.find(u => u.id === 'plan-pro'));
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].fit >= s[i].fit);
  assert.equal(score(base, { tier: 'Pro', regulated: 0 }).filter(u => u.kind === 'plan').length, 0);
});
test('the reasons use the business’s own numbers', () => {
  const pro = score(base, { tier: 'Growth', regulated: 0 }).find(u => u.id === 'plan-pro');
  assert.ok(pro.why.some(w => w.includes('$1,840')));
  assert.ok(pro.why.some(w => w.includes('4 callers hung up')));
  const min = score(base, { tier: 'Growth', regulated: 0 }).find(u => u.id === 'addon-minutes');
  assert.equal(min.fit, 90);
  assert.ok(min.why[0].includes('270 of your 300'));
});
test('regulated businesses never see Pro, and Growth says why it is worth less', () => {
  const s = score(base, { tier: 'Starter', regulated: 1 });
  assert.ok(!s.find(u => u.id === 'plan-pro'));
  assert.ok(s.find(u => u.id === 'plan-growth').why[0].includes('regulated'));
});
test('a website on file drops the website score', () => {
  assert.equal(score(Object.assign({}, base, { website: 'https://sinclairplumbing.com' }), { tier: 'Starter', regulated: 0 }).find(u => u.id === 'addon-website').fit, 15);
  assert.equal(score(base, { tier: 'Starter', regulated: 0 }).find(u => u.id === 'addon-website').fit, 80);
});
