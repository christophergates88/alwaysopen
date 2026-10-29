// Makes public/og3.jpg (the picture shown when the site is shared) from tools/og/share.html. Run: node tools/og/make.mjs
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright'); import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
await p.goto('file://' + path.join(here, 'share.html')); await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(here, '..', '..', 'public', 'og3.jpg'), type: 'jpeg', quality: 88 }); await b.close();
