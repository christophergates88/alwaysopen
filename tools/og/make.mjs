// Needs the three font files (Archivo, Instrument Sans, DM Mono Medium TTFs from github.com/google/fonts) in tools/og/fonts or $OG_FONTS.
// Makes public/og3.jpg (the picture shown when the site is shared) from tools/og/share.html. Run: node tools/og/make.mjs
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright'); import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
const html = fs.readFileSync(path.join(here, 'share.html'), 'utf8').split('FONTS').join('file://' + (process.env.OG_FONTS || path.join(here, 'fonts')));
const tmp = path.join(os.tmpdir(), 'ao-share.html'); fs.writeFileSync(tmp, html); await p.goto('file://' + tmp); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(here, '..', '..', 'public', 'og3.jpg'), type: 'jpeg', quality: 88 }); await b.close();
