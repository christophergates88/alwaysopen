// Build Brief 7, Part 3: one card list for both apps. The web app may only render cards that are on the list, every
// card on the list is rendered by the web app, and (when the iPhone project is next to this repo, or AO_IOS_DIR points at
// it) every card has its iPhone struct, saying the same words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CARDS, CARD_IDS } from '../src/cards.js';
import { iosGaps, readSwift } from '../tools/iosparity.mjs';

const WEB = ['src/apppage.js', 'src/rivalspage.js'].map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
const webIds = [...WEB.matchAll(/data-card=\\?"([a-z0-9-]+)\\?"/g)].map(m => m[1]);

test('every card the web app renders is on the list', () => {
  const extra = [...new Set(webIds.filter(id => !CARD_IDS.includes(id)))];
  assert.deepEqual(extra, [], 'add these to src/cards.js (and the iPhone app): ' + extra.join(', '));
});
test('every card on the list is rendered by the web app', () => {
  const missing = CARD_IDS.filter(id => !webIds.includes(id));
  assert.deepEqual(missing, [], 'the web app does not render: ' + missing.join(', '));
});
test('the card list is well formed', () => {
  assert.equal(new Set(CARD_IDS).size, CARD_IDS.length, 'ids are unique');
  for (const c of CARDS) { assert.match(c.id, /^[a-z0-9-]+$/); assert.match(c.ios, /^[A-Z][A-Za-z0-9]+$/); assert.ok(Array.isArray(c.state) && c.state.length, c.id + ' names its state'); }
});

const IOS = process.env.AO_IOS_DIR || ['../alwaysopen-ios/AlwaysOpen', '../GatesHQ/alwaysopen-ios/AlwaysOpen'].map(p => new URL('../' + p, import.meta.url).pathname).find(existsSync);
test('the iPhone app has every card, with the same words', { skip: IOS && existsSync(IOS) ? false : 'the iPhone project is not next to this repo (the iPhone build runs this check itself)' }, () => {
  const gaps = iosGaps(CARDS, readSwift(IOS));
  assert.deepEqual(gaps, []);
});
