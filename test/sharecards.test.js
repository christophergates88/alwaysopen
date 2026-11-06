// What a shared link shows (iMessage, Facebook, LinkedIn): every trade page points at its own address, its own title and
// its own card, and the card file is there. A plumbing link that opened the builders page, or an insurance link that
// showed the plumbers' dare, is what this stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PAGES } from '../tools/og/cards.mjs';

const pub = f => new URL('../public/' + f, import.meta.url);
const tag = (html, prop) => ((html.match(new RegExp('<meta (?:property|name)="' + prop + '" content="([^"]*)"')) || [])[1] || '');

for (const p of PAGES) {
  test(p.slug + ': the shared link shows its own page, title and card', () => {
    const html = readFileSync(pub(p.slug + '.html'), 'utf8');
    assert.equal(tag(html, 'og:url'), 'https://alwaysopenoffice.com/' + p.slug);
    assert.equal(tag(html, 'og:title'), p.title);
    assert.equal(tag(html, 'og:image'), 'https://alwaysopenoffice.com/og-' + p.slug + '.jpg');
    assert.equal(tag(html, 'twitter:image'), 'https://alwaysopenoffice.com/og-' + p.slug + '.jpg');
    assert.ok(existsSync(pub('og-' + p.slug + '.jpg')), 'the card picture is in public/');
    assert.doesNotMatch(tag(html, 'og:title'), /your business, always open/i, 'not the home page’s title');
  });
}
test('regulated pages make no dare: insurance leads with Compliance Guard, dental just gives the number', () => {
  const ins = PAGES.find(p => p.slug === 'insurance'), den = PAGES.find(p => p.slug === 'dental');
  assert.ok(ins.guard && ins.guard.length === 3);
  assert.ok(!/dare/i.test(JSON.stringify(ins)) && !/dare/i.test(JSON.stringify(den)));
  assert.match(tag(readFileSync(pub('insurance.html'), 'utf8'), 'og:description'), /compliance contact/);
});
