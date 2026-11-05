// The client app on a phone (Brief 2, Part 6b): the real app pages, rendered by the real worker code against the test
// harness (a signed-up Growth client with Max's line), opened in a 390-px browser. Fails when a page scrolls sideways,
// a tap target is under 44 px, or body text is under 15 px: the same bar the site is held to in phonecheck.mjs.
// Screenshots of every tab land in the folder named by APP_SHOTS (used for Christopher's report).
//   node tools/appcheck.mjs            (CI, after the phone check)
//   APP_SHOTS=out/dir node tools/appcheck.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'node:module';
register('../test/rehearsal/hooks.mjs', import.meta.url);
const { chromium } = createRequire(import.meta.url)('playwright');
const H = await import('../test/rehearsal/harness.js');

const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const { CallRoom } = await import('../src/voice.js');
env.CALLROOM = H.makeNamespace(CallRoom, env);
const site = H.makeClient(worker, env);

// a client, the way one really arrives: checkout, then Stripe's webhook
const CUSTOMER = { plan: 'Growth', max: '1', business: 'Sinclair Plumbing', owner: 'Dana Sinclair', phone: '(478) 555-0101', email: 'dana@sinclairplumbing.example', town: 'Eatonton, GA', type: 'Contractor or trade', agree: '1' };
await site.call('/start?plan=Growth');   // sets Stripe up the first time
const co = await site.call('/billing/checkout', { form: CUSTOMER });
const sessionId = co.location.split('/').pop();
const s = world.sessions.get(sessionId);
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
const secret = (await DB.prepare("SELECT v FROM billing_config WHERE k = 'webhook_secret'").first()).v;
const wh = await site.call('/billing/webhook', { body, headers: { 'stripe-signature': H.stripeSign(secret, body), 'content-type': 'application/json' } });
if (wh.status !== 200) { console.error('webhook failed: ' + wh.text); process.exit(1); }
await site.settle();
const b = await DB.prepare('SELECT code FROM billing WHERE session_id = ?1').bind(sessionId).first();
const code = b.code;
// something to look at: one reply waiting for approval and one call taken by Max
try {
  await DB.prepare("INSERT INTO app_queue (client_id, kind, title, body, status, created) VALUES (?1, 'reply', 'Reply to a 5-star review from R. Patel', 'Thank you, R. It was a pleasure helping with the water heater. Call any time.', 'open', ?2)").bind((await DB.prepare('SELECT client_id FROM billing WHERE code = ?1').bind(code).first()).client_id, new Date().toISOString()).run();
} catch (e) { /* the queue table may be shaped differently; the page still renders */ }

// the worker, reachable by a real browser
const srv = http.createServer(async (q, r) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const o = { method: q.method, headers: { 'content-type': q.headers['content-type'] || '' } };
  if (chunks.length) o.body = Buffer.concat(chunks).toString();
  try {
    const res = await site.call(q.url, o);
    r.writeHead(res.status, { 'content-type': res.headers && res.headers.get ? (res.headers.get('content-type') || 'text/html') : 'text/html' });
    r.end(res.text);
  } catch (e) { r.writeHead(500); r.end(String(e)); }
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cloudflareinsights/, r => r.abort());
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const shots = process.env.APP_SHOTS; if (shots) fs.mkdirSync(shots, { recursive: true });
const problems = [];
await page.goto('http://localhost:' + port + '/app/' + code, { waitUntil: 'load' });
await page.waitForTimeout(600);
for (const tab of ['home', 'approve', 'max', 'ask']) {
  const btn = await page.$('[data-tab="' + tab + '"], nav.tabs a[href*="' + tab + '"], nav.tabs button:has-text("' + ({ home: 'Home', approve: 'Approve', max: 'Calls', ask: 'Ask us' })[tab] + '")');
  if (btn) { await btn.click(); await page.waitForTimeout(400); }
  const r = await page.evaluate(() => {
    const out = { small: [], tiny: [] };
    const vis = el => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0; };
    out.docW = document.documentElement.scrollWidth; out.winW = innerWidth;
    document.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea').forEach(el => {
      if (!vis(el)) return;
      if (el.matches('a') && getComputedStyle(el).display === 'inline') { const par = el.parentElement; const t = (par.textContent || '').trim(), mine = (el.textContent || '').trim(); if (t.length > mine.length + 1) return; }
      const b = (el.matches('input[type=checkbox],input[type=radio]') && el.closest('label') ? el.closest('label') : el).getBoundingClientRect();
      if (b.height < 43.5 || b.width < 43.5) out.small.push(el.tagName + '#' + el.id + '[' + el.type + '] ' + (el.textContent || el.getAttribute('aria-label') || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (el.closest('script,style,noscript,[role="img"],svg')) continue; if (!vis(el)) continue;
      const s = getComputedStyle(el), px = parseFloat(s.fontSize);
      const label = /Mono|monospace/.test(s.fontFamily) || el.closest('small,em,.kick,.fine,.note,.tab') || s.textTransform === 'uppercase';   // a tab-bar caption under its icon reads at 12 px, like iOS
      if (px < (label ? 12 : 15)) out.tiny.push(el.tagName + '.' + (el.className || '') + ' ' + px + 'px "' + n.textContent.trim().slice(0, 30) + '"');
    }
    out.ai = /\bAI\b|artificial intelligence/.test(document.body.innerText) ? (document.body.innerText.match(/[^.]*\bAI\b[^.]*/) || [''])[0] : '';
    return out;
  });
  if (r.docW > r.winW) problems.push(tab + ': scrolls sideways (' + r.docW + ' > ' + r.winW + ')');
  r.small.forEach(x => problems.push(tab + ': small tap target ' + x));
  r.tiny.forEach(x => problems.push(tab + ': small text ' + x));
  if (r.ai) problems.push(tab + ': says "AI": ' + r.ai.trim().slice(0, 80));
  if (shots) await page.screenshot({ path: path.join(shots, 'app-' + tab + '.png'), fullPage: true });
}
await browser.close(); srv.close();
errors.forEach(e => problems.push('page error: ' + e.slice(0, 120)));
if (problems.length) { console.error('App check failed:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('App check passed (4 tabs at 390 px).');
process.exit(0);
