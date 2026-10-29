// Page checks at phone width (390px): no sideways scroll, a headline, the example report captioned as one, no banned words outside the home hero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PAGES = ['hvac', 'plumbing', 'dental', 'auto-repair', 'marine', 'salons', 'restaurants', 'builders', 'insurance', 'index'];
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch (e) { chromium = null; }

test('industry pages: words and samples', () => {
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join('public', p + '.html'), 'utf8');
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const text = body.replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, '');
    if (p !== 'index') assert.ok(!/\bAI\b/.test(text), p + ' says AI');
    assert.ok(!/\bChris\b/.test(text), p + ' says Chris');
    assert.ok(!/\blocal\b/.test(text.replace(/https?:\/\/\S+/g, '')), p + ' says local');
    // The pictures use made-up businesses with believable names; a caption still calls them examples (Oct 29, 2026: no more "Sample" tags).
    assert.ok(/An example report\./.test(text), p + ' does not call its report an example');
    assert.ok(!/[^!]![^=]/.test(text.replace(/!important/g, '')), p + ' has an exclamation mark');
  }
});

test('industry pages render at 390px without sideways scroll', { skip: !chromium && 'playwright not installed' }, async () => {
  const browser = await chromium.launch();
  try {
    for (const p of ['hvac', 'plumbing', 'dental', 'auto-repair', 'marine', 'salons', 'restaurants', 'index']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto('file://' + path.resolve('public', p + '.html'));
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 392, p + ' scrolls sideways: ' + w);
      assert.ok(await page.locator('h1').count() === 1, p + ' h1');
      await page.close();
    }
  } finally { await browser.close(); }
});
