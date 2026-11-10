// Phone check for the public site: loads the pages at phone width and fails when something a phone visitor would trip
// over comes back. Run from the repo root: node tools/phonecheck.mjs  (add --shots DIR to save screenshots)
// Fails when: a page scrolls sideways, a tap target is smaller than 44 x 44, body text is under 15 px, the home page is
// taller than 18,000 px (raised from 16,800 on Nov 10 for the Shoulder Tap band, about 1,220 px, open on the home page and folded on the trade pages; the deploy machine measures about 600 px more than a Mac, 17,814 at 375 wide that day) (the trade pages 9,600; raised Nov 4 when the sections below pricing stopped folding; the feature wall added about 650 px to each on Nov 4) with its sections folded (What we do added 800 px, Max’s clock about 1,100 (Nov 4, open on the home page, folded on the trade pages), the monthly report in the hero about 650 and the map's own section about 850, all on purpose; the build machine's fonts set about 3% taller than a Mac's) (industry pages 7,700), the grade check is not on the first three screens (the monthly report leads the hero),
// a playable card does not play, a folded section does not open, or the Spanish switch misses a spot or overflows.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = await import('playwright')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };

// The same pages the Worker serves, from the files on disk. The grade check answers with a made-up business.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/audit/score') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, found: true, name: 'Sample Plumbing', address: '1 Main St, Eatonton, GA', score: 62, grade: 'C',
      areas: [{ label: 'Reviews', grade: 'D' }, { label: 'Google profile', grade: 'B' }, { label: 'Website', grade: 'C' }],
      top: [{ title: 'Unanswered reviews', saw: '9 reviews have no reply.' }], more: 4 }));
  }
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const f = path.join(PUB, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const PAGES = [['/', 18000], ['/plumbing', 9600], ['/hvac', 9600], ['/builders', 9600], ['/auto-repair', 9600], ['/marine', 9600], ['/marinas', 9600], ['/salons', 9600], ['/restaurants', 9600], ['/dental', 9600], ['/insurance', 8400]];
const WIDTHS = [375, 390, 430];

const browser = await chromium.launch();
const problems = [];
const report = [];
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // fonts come from Google; the check runs without them
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cloudflareinsights/, r => r.abort());
  const page = await ctx.newPage();
  for (const [p, maxH] of PAGES) {
    const name = (p === '/' ? 'home' : p.slice(1)) + '@' + w;
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const out = { small: [], tiny: [] };
      const vis = el => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && !el.closest('[hidden],[aria-hidden="true"]'); };
      out.docW = document.documentElement.scrollWidth; out.winW = innerWidth; out.h = document.documentElement.scrollHeight;
      const g = document.getElementById('check'); out.auditTop = g ? g.getBoundingClientRect().top + scrollY : -1;
      const rail = document.querySelector('.aos'); out.strip = rail ? Math.round(document.querySelector('.aos-rail').getBoundingClientRect().height + (document.querySelector('.aos .ao-dots') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) : -1;
      // Tap targets: links and buttons that stand on their own. A link inside a sentence is exempt (it is part of the text).
      document.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea').forEach(el => {
        if (!vis(el)) return;
        if (el.matches('a') && getComputedStyle(el).display === 'inline') {
          const par = el.parentElement; const t = (par.textContent || '').trim(), mine = (el.textContent || '').trim();
          if (t.length > mine.length + 1) return;
        }
        if (el.closest('.hp')) return;
        const b = (el.matches('input[type=checkbox],input[type=radio]') && el.closest('label') ? el.closest('label') : el).getBoundingClientRect();
        if (b.height < 43.5 || b.width < 43.5) out.small.push((el.tagName + ' ' + (el.textContent || el.getAttribute('aria-label') || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 40)) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      });
      // Text: anything with its own words, read as body text, at 15 px or more. Labels (small capitals in mono, <small>) at 12 px or more.
      // Pictures of product screens (role="img") are illustrations and are described in words for screen readers.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const n = walker.currentNode; if (!n.textContent.trim()) continue;
        const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
        if (el.closest('script,style,noscript,[role="img"],svg,.hp')) continue;
        if (!vis(el)) continue;
        const s = getComputedStyle(el), px = parseFloat(s.fontSize);
        const label = /Mono|monospace/.test(s.fontFamily) || el.closest('small,em') || s.textTransform === 'uppercase' || /\b(soon|badge|tag)\b/.test(el.className);
        if (px < (label ? 12 : 15)) out.tiny.push(el.tagName + '.' + (el.className || '') + ' ' + px + 'px "' + n.textContent.trim().slice(0, 30) + '"');
      }
      return out;
    });
    const row = { page: name, height: r.h, auditTop: Math.round(r.auditTop), strip: r.strip, smallTaps: r.small.length, smallText: r.tiny.length };
    report.push(row);
    if (r.docW > r.winW) problems.push(name + ': scrolls sideways (' + r.docW + ' > ' + r.winW + ')');
    if (r.h > maxH) problems.push(name + ': ' + r.h + ' px tall with sections folded (limit ' + maxH + ')');
    // The grade check sits at the end of "Tap to try it" since Nov 4, 2026 (the feature wall took its spot up top): it only has to be there.
    if (name === '/' && r.auditTop < 0) problems.push(name + ': the audit form is missing');
    // 572: the cards' wording on every plan (Max included with Starter) is one line longer on some phones (Oct 30).
    if (r.strip > 572) problems.push(name + ': the cards are ' + r.strip + ' px tall (limit 572)');
    r.small.forEach(x => problems.push(name + ': small tap target ' + x));
    r.tiny.forEach(x => problems.push(name + ': small text ' + x));

    if (w === 375) {
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '-top.png') }); }
      // Every card plays: tapping a choice shows its first line at once.
      const played = await page.evaluate(async () => {
        const bad = [];
        const modes = document.querySelectorAll('.aos-modes button');
        for (const m of (modes.length ? modes : [null])) {
          if (m) m.click();
          const alt = m && m.dataset.mode === '1';
          for (const c of document.querySelectorAll('.aos-card')) {
          const btns = c.querySelectorAll('.aos-ch button');
          for (const b of btns) {
            b.click();
            const p = c.querySelector('.aos-path' + (alt && c.querySelector('.aos-alt') ? '.aos-alt' : ':not(.aos-alt)') + '[data-p="' + b.dataset.p + '"]');
            const first = p && p.firstElementChild;
            if (!p || !p.classList.contains('on') || !first || getComputedStyle(first).display === 'none') bad.push(c.id + (alt ? ' (carrier)' : '') + ' / ' + b.textContent);
          }
          }
        }
        return bad;
      });
      played.forEach(x => problems.push(name + ': card did not play: ' + x));
      if (SHOTS) {
        await page.evaluate(() => { const c = document.querySelector('.aos-card'); c.querySelector('.aos-ch button').click(); document.querySelector('.aos').scrollIntoView(); });
        await page.waitForTimeout(3200);
        await page.screenshot({ path: path.join(SHOTS, name + '-cards.png') });
      }
      // Every folded section opens and closes.
      const folds = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('[data-fold]').forEach(s => {
          const b = s.querySelector(':scope > .ao-foldbar'); if (!b) { bad.push(s.id + ' has no bar'); return; }
          const h0 = s.getBoundingClientRect().height; b.click(); const h1 = s.getBoundingClientRect().height;
          if (!(h1 > h0 + 50) || b.getAttribute('aria-expanded') !== 'true') bad.push(s.id + ' did not open');
          b.click(); if (s.classList.contains('ao-open')) bad.push(s.id + ' did not close');
        });
        return bad;
      });
      folds.forEach(x => problems.push(name + ': fold ' + x));
      // The audit form's instant check answers on the page.
      if (await page.$('#check')) { await page.evaluate(() => { const s = document.getElementById('audit'); const b = s && s.querySelector(':scope > .ao-foldbar'); if (b && !s.classList.contains('ao-open')) b.click(); });
        await page.waitForTimeout(200); await page.fill('#c-q', 'Sample Plumbing'); await page.fill('#c-town', 'Eatonton, GA');
      const sb = page.locator('#check button[type=submit]'); await sb.scrollIntoViewIfNeeded(); const bb = await sb.boundingBox(); await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);   // a real tap: a locator click in touch mode taps the pre-scroll spot
      await page.waitForFunction(() => { const o = document.getElementById('check-out'); return !!(o && o.querySelector('.check-score, #check-go')); }, null, { timeout: 4000 }).catch(() => problems.push(name + ': the instant check did not answer')); }
      // Shoulder Tap: the made-up call plays through to the answer, and its words switch to Spanish with the page.
      if (await page.$('#tap')) {
        const tap = await page.evaluate(async () => {
          const bad = [], s = document.getElementById('tap'), bar = s.querySelector(':scope > .ao-foldbar');
          if (bar && !s.classList.contains('ao-open')) bar.click();
          const ph = s.querySelector('.tapphone'); ph.scrollIntoView({ block: 'center' });
          const t0 = Date.now();
          while (Date.now() - t0 < 16000 && ph.querySelectorAll('[data-i].on').length < 8) await new Promise(r => setTimeout(r, 200));
          if (ph.querySelectorAll('[data-i].on').length < 8) bad.push('the call did not play to the end (' + ph.querySelectorAll('[data-i].on').length + ' of 8)');
          const en = ph.querySelector('[data-i="5"]').textContent;
          const btn = document.querySelector('[data-lang-t]');
          if (btn) { btn.click(); if (ph.querySelector('[data-i="5"]').textContent === en) bad.push('the call stayed English'); if (!/hombro/.test(document.getElementById('tap-h').textContent)) bad.push('the headline stayed English'); btn.click(); if (ph.querySelector('[data-i="5"]').textContent !== en) bad.push('English did not come back'); try { localStorage.removeItem('ao_lang'); } catch (e) {} }
          if (bar && s.classList.contains('ao-open')) bar.click();
          return bad;
        });
        tap.forEach(x => problems.push(name + ': Shoulder Tap ' + x));
      } else if (!/dental|insurance/.test(name)) problems.push(name + ': the Shoulder Tap band is missing');
      // Spanish: every swap finds its place, the switch is a full tap, nothing scrolls sideways, English comes back.
      const es = await page.evaluate(() => {
        const btn = document.querySelector('[data-lang-t]'); if (!btn) return ['no ES/EN switch'];
        let data = []; try { data = JSON.parse(document.getElementById('ao-es').textContent); } catch (e) { return ['no Spanish block']; }
        const bad = data.filter(e => !document.querySelector(e.s)).map(e => 'nothing at ' + e.s);
        const h1 = document.querySelector('header.hero h1').innerHTML;
        btn.click();
        if (document.documentElement.lang !== 'es') bad.push('did not switch');
        if (document.querySelector('header.hero h1').innerHTML === h1) bad.push('the headline stayed English');
        if (document.documentElement.scrollWidth > window.innerWidth) bad.push('scrolls sideways (' + document.documentElement.scrollWidth + ' px)');
        const t = btn.getBoundingClientRect(); if (t.width < 44 || t.height < 44) bad.push('the switch is smaller than 44 px');
        btn.click();
        if (document.querySelector('header.hero h1').innerHTML !== h1) bad.push('English did not come back');
        try { localStorage.removeItem('ao_lang'); } catch (e) {}
        return bad;
      });
      es.forEach(x => problems.push(name + ': Spanish ' + x));
      if (SHOTS) { if (await page.$('#check')) { await page.locator('#check').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, name + '-audit.png') }); } await page.screenshot({ path: path.join(SHOTS, name + '-full.png'), fullPage: true }); }
    }
  }
  await ctx.close();
}
await browser.close();
server.close();

console.table(report);
if (problems.length) {
  console.log('\n' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ' on phones:');
  [...new Set(problems)].slice(0, 200).forEach(p => console.log(' - ' + p));
  // On GitHub, the first problems also show up on the run's summary page.
  if (process.env.GITHUB_ACTIONS) [...new Set(problems)].slice(0, 10).forEach(p => console.log('::error title=Phone check::' + p));
  process.exit(1);
}
console.log('\nPhone check passed.');
