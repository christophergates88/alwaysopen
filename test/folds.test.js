// Folds on the Max and Money screens (Nov 11, 2026). Each group of switches sits behind one row that says where the
// group stands and opens in place. These run the app's own fold code (lifted out of the page) so the rules hold:
// a showcase card is never folded away, a fold remembers how the owner left it, and a block that is not a section
// passes through untouched. tools/appcheck.mjs checks the same thing in a real browser at phone size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appHtml } from '../src/apppage.js';

const html = appHtml({ base: '/app/x', business: 'Test' });
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const grab = name => { const a = js.indexOf('function ' + name + '('); assert.ok(a >= 0, name + ' is in the page'); let d = 0, i = js.indexOf('{', a); for (; i < js.length; i++) { if (js[i] === '{') d++; else if (js[i] === '}' && --d === 0) break; } return js.slice(a, i + 1); };
const lib = new Function('var FOLD={},ICON={chev:"<svg></svg>"};' + grab('fold') + grab('foldH') + grab('nOf') + 'return {fold:fold,foldH:foldH,nOf:nOf,FOLD:FOLD};')();

test('a fold is one row with its title and where it stands, closed until tapped', () => {
  const h = lib.fold('job', 'Job description', '7 of 9 on.', '<div class="card">inside</div>');
  assert.match(h, /^<details class="fold" data-fold="job"><summary>/);
  assert.match(h, /<b>Job description<\/b><span class="fine">7 of 9 on\.<\/span>/);
  assert.match(h, /<div class="foldin"><div class="card">inside<\/div><\/div><\/details>$/);
  assert.doesNotMatch(h, / open/);
});
test('it opens by itself only when asked to, and how the owner left it wins after that', () => {
  assert.match(lib.fold('knows', 'What Max knows', 'Hours not filled in yet.', '<i></i>', true), /data-fold="knows" open>/);
  lib.FOLD.knows = false;
  assert.doesNotMatch(lib.fold('knows', 'What Max knows', 'x', '<i></i>', true), / open>/, 'closed by the owner stays closed');
  lib.FOLD.job = true;
  assert.match(lib.fold('job', 'Job description', 'x', '<i></i>'), /data-fold="job" open>/, 'opened by the owner stays open through a Save');
});
test('a section that starts with its heading folds under that heading; anything else passes through', () => {
  const h = lib.foldH('book', '<h2>Booking</h2><div class="card form">x</div>', 'Max books an open time.');
  assert.match(h, /<b>Booking<\/b>/); assert.doesNotMatch(h, /<h2>/); assert.match(h, /<div class="foldin"><div class="card form">x<\/div>/);
  assert.equal(lib.foldH('x', '<div class="feature">no heading</div>', 's'), '<div class="feature">no heading</div>');
  assert.equal(lib.foldH('x', '', 's'), '');
  assert.equal(lib.fold('x', 'T', 's', ''), '', 'nothing inside, no row');
});
test('the counts read as a sentence', () => { assert.equal(lib.nOf(7, 9, 'on'), '7 of 9 on.'); });
test('the cards the website shows off are never inside a fold', () => {
  // every data-card in the app is written outside the functions that build folds
  for (const name of ['voiceCard', 'jobCard', 'teachCard', 'bookCard', 'afterCard', 'outCard', 'outreachBody', 'setBlock', 'teamBlock']) {
    assert.doesNotMatch(grab(name), /data-card=/, name + ' builds a fold, so it must not hold a showcase card');
  }
});
test('the leftover tabs-inside-Max code is gone', () => { assert.doesNotMatch(js, /MSEG|data-mseg|mSegBar/); });
