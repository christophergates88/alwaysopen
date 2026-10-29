// Makes the six branded cards Always Open's own Facebook and Instagram posts use (public/social/<theme>.jpg, 1080 square,
// one per theme in src/social.js) from tools/social/card.html. Needs the font files in tools/og/fonts or $OG_FONTS
// (Archivo, Instrument Sans, DM Mono Medium from github.com/google/fonts). Run: node tools/social/make.mjs
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright'); import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const CARDS = {
  missed: { h: 'The call you <em>missed</em> just rang your competitor.', s: 'Most callers who get voicemail call the next name on Google. <b>Max answers every call, day or night.</b>' },
  caught: { h: 'What Max <em>caught</em> this week.', s: 'Real calls, real numbers, for the businesses we work for. <b>Every caller heard an answer, not voicemail.</b>' },
  grade: { h: 'How does your business <em>look</em> on Google right now?', s: 'Type your business name and town. <b>Your grade shows in a few seconds.</b> Free, no sign-up.' },
  tip: { h: 'One thing worth doing <em>this week.</em>', s: 'A plain tip for small business owners, from the people who answer their phones.' },
  local: { h: 'Lake Country, Georgia. <em>Anywhere</em> in the U.S.', s: 'Calls answered. Reviews handled. Jobs followed up. <b>You approve it all from your phone.</b>' },
  max: { h: 'Want to hear what your callers <em>would get?</em>', s: '', x: '<div class="neon"><span>CALL MAX. WE DARE YOU.</span><b>(706) 460-2226</b></div>' }
};
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1080 } });
const base = fs.readFileSync(path.join(here, 'card.html'), 'utf8').split('FONTS').join('file://' + (process.env.OG_FONTS || path.join(here, '..', 'og', 'fonts')));
fs.mkdirSync(path.join(here, '..', '..', 'public', 'social'), { recursive: true });
for (const [name, c] of Object.entries(CARDS)) {
  const html = base.replace('HEADLINE', '<h1>' + c.h + '</h1>').replace('SUB', c.s ? '<p class="sub">' + c.s + '</p>' : '').replace('EXTRA', c.x || '');
  const tmp = path.join(os.tmpdir(), 'ao-card-' + name + '.html'); fs.writeFileSync(tmp, html);
  await p.goto('file://' + tmp); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(here, '..', '..', 'public', 'social', name + '.jpg'), type: 'jpeg', quality: 86 });
  console.log('public/social/' + name + '.jpg');
}
await b.close();
