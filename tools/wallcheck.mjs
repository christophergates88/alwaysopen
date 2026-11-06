// The wall check (Build Brief 7, Part 4): every frame on the website's "Real screens" wall (public/index.html, data-w)
// has a card in the app (src/cards.js), the frame and the card both say the frame's headline words, and the demo account
// renders it. A frame with no card fails the build. Pictures of each frame and its app card land in APP_SHOTS.
//   node tools/wallcheck.mjs            (CI, after appcheck)
//   APP_SHOTS=out/dir node tools/wallcheck.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'node:module';
register('../test/rehearsal/hooks.mjs', import.meta.url);
const { chromium } = createRequire(import.meta.url)('playwright');
const H = await import('../test/rehearsal/harness.js');
const { CARDS, WALL } = await import('../src/cards.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const { CallRoom } = await import('../src/voice.js');
env.CALLROOM = H.makeNamespace(CallRoom, env);
const site = H.makeClient(worker, env);
const { sha256hex } = await import('../src/app.js');
const problems = [];

// The demo account, seeded the way the nightly refresh seeds it, with a call in progress (the frame's "on a call now").
const { seedDemo, DEMO_ID } = await import('../src/demo.js');
const mods = { ensureBiz: (await import('../src/biz.js')).ensureBiz, ensureInvoices: (await import('../src/extras.js')).ensureInvoices, ensureRivals: (await import('../src/rivals.js')).ensureRivals,
  ensureReviews: (await import('../src/reviews.js')).ensureReviews, isoWeek: (await import('../src/rivals.js')).isoWeek };
const DEMO_CODE = 'WallCheckDemoAccount0000000000';
await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, phone, feats) VALUES (?1, ?2, 'Demo Plumbing Co.', 1, 'Pro', '4785550142', 'calls,followups,textback')").bind(DEMO_ID, await sha256hex(DEMO_CODE)).run();
const seeded = await seedDemo(env, mods, Date.now());
if (!seeded.ok) problems.push('the demo did not seed: ' + JSON.stringify(seeded).slice(0, 200));
await DB.prepare("INSERT INTO app_calls (id, client_id, number, at, caller, caller_name, outcome, status, test, turns, transcript) VALUES ('CAwalllive', ?1, '+14785550100', ?2, '+14045550188', '', 'live', 'new', 0, 2, '[]')").bind(DEMO_ID, new Date(Date.now() - 50e3).toISOString()).run();
await DB.prepare("UPDATE voice_lines SET on_air = 1 WHERE client_id = ?1").bind(DEMO_ID).run().catch(() => {});

// Rate-Shock Radar and the regulated Compliance Guard are for insurance agencies, so a sample agency shows those two:
// a wave in its town this week with the post waiting, and the frame's review with its reply waiting.
const INS = 'wall-insurance', INS_CODE = 'WallCheckInsuranceAgency00000';
await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, active, tier, regulated, phone) VALUES (?1, ?2, 'Oconee Insurance (sample)', 1, 'Growth', 1, '4785550142')").bind(INS, await sha256hex(INS_CODE)).run();
await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, regulated, industry, town, facts, updated) VALUES ('+14785550177', ?1, 'Oconee Insurance', 1, 1, 'insurance', 'Eatonton, GA', '{}', ?2)").bind(INS, new Date().toISOString()).run();
const wk = mods.isoWeek(Date.now());
const { noteSeen } = await import('../src/radar.js');
await noteSeen(env, INS, wk, { town: 'Eatonton, GA', wave: true, rate: 4, low: 3, why: 'rate' }, new Date(Date.now() - 2 * 3600e3).toISOString());
const RADAR = (await import('../src/index.js')).RADAR_POST;
const now = new Date().toISOString();
await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES (?1, ?2, 'post', ?3, 'Rate-Shock Radar: rate complaints rising in Eatonton, GA', 0, ?4, 'pending', 1, 1, ?5, ?5, 1, '')").bind('radar:' + INS + ':' + wk, INS, RADAR.title, RADAR.text, now).run();
await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES ('itwallguard', ?1, 'reply', 'R. Patel', 'Called about my claim three times and nobody called back. Rates went up again too.', 2, ?2, 'pending', 1, 1, ?3, ?3, 1, '')")
  .bind(INS, 'Thank you for reaching out. To protect everyone\'s privacy we don\'t discuss details here, but we would like to hear from you. Please contact our office directly at 478-555-0142.', new Date(Date.now() - 2 * 864e5).toISOString()).run();

// the worker and the website, reachable by a real browser
const srv = http.createServer(async (q, r) => {
  if (q.url === '/' || /^\/[\w-]+\.(html|css|js|svg|png|jpg|webp|woff2?)$/.test(q.url)) {
    const f = path.join(ROOT, 'public', q.url === '/' ? 'index.html' : q.url.slice(1));
    if (fs.existsSync(f)) { r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' }); r.end(fs.readFileSync(f)); return; }
  }
  const chunks = []; for await (const c of q) chunks.push(c);
  const o = { method: q.method, headers: { 'content-type': q.headers['content-type'] || '' } };
  if (chunks.length) o.body = Buffer.concat(chunks).toString();
  try {
    const res = await site.call(q.url, o);
    const hd = { 'content-type': res.headers && res.headers.get ? (res.headers.get('content-type') || 'text/html') : 'text/html' };
    r.writeHead(res.status, hd); r.end(res.text);
  } catch (e) { r.writeHead(500); r.end(String(e)); }
}).listen(0);
const BASE = 'http://localhost:' + srv.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cloudflareinsights|openfreemap|cdnjs/, r => r.abort());
const shots = process.env.APP_SHOTS; if (shots) fs.mkdirSync(shots, { recursive: true });
const errors = [];

// 1. the website's frames
const sitePage = await ctx.newPage(); sitePage.on('pageerror', e => errors.push('site: ' + e));
await sitePage.goto(BASE + '/', { waitUntil: 'load' });
await sitePage.waitForTimeout(800);
const frames = await sitePage.$$eval('#wall [data-w]', els => els.map(e => ({ id: e.getAttribute('data-w'), text: e.innerText })));
if (frames.length !== 6) problems.push('the wall has ' + frames.length + ' frames, not 6');
for (const f of frames) {
  const c = WALL[f.id];
  if (!c) { problems.push('website frame "' + f.id + '" has no card in the app (src/cards.js)'); continue; }
  if (c.head && !f.text.includes(c.head)) problems.push('website frame "' + f.id + '" no longer says "' + c.head + '": update the card and src/cards.js together');
  if (shots) { const el = await sitePage.$('#wall [data-w="' + f.id + '"]'); await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(shots, 'wall-' + f.id + '-site.png') }); }
}

// 2. the same cards in the app, on the demo account (the insurance agency for the two insurance cards)
const TAB = { today: 'today', money: 'money', max: 'max', customers: 'customers' };
const appPage = await ctx.newPage(); appPage.on('pageerror', e => errors.push('app: ' + e));
for (const [code, list] of [[DEMO_CODE, ['storm', 'rivals', 'clock', 'timecard']], [INS_CODE, ['radar', 'guard']]]) {
  await appPage.goto(BASE + '/app/' + code, { waitUntil: 'load' });
  await appPage.waitForTimeout(700);
  for (const w of list) {
    const c = WALL[w];
    const btn = await appPage.$('[data-tab="' + TAB[c.screen] + '"]'); if (btn) { await btn.click(); await appPage.waitForTimeout(400); }
    const el = await appPage.$('#view [data-card="' + c.id + '"]');
    if (!el) { problems.push(w + ': the ' + (code === DEMO_CODE ? 'demo' : 'sample agency') + ' does not render [data-card="' + c.id + '"] on ' + c.screen); continue; }
    const t = await el.innerText();
    if (c.head && !t.toUpperCase().includes(c.head.toUpperCase())) problems.push(w + ': the app card does not say "' + c.head + '": ' + t.slice(0, 80).replace(/\s+/g, ' '));
    if (shots) {
      // the whole card as the owner sees it (Compliance Guard sits inside a reply card), without the tab bar over it
      const shot = (await el.evaluateHandle(x => x.closest('[data-card="item"]') || x)).asElement();
      await appPage.evaluate(() => document.querySelectorAll('[data-tab]').forEach(t => { if (t.parentElement) t.parentElement.style.visibility = 'hidden'; }));
      await shot.scrollIntoViewIfNeeded(); await appPage.waitForTimeout(150); await shot.screenshot({ path: path.join(shots, 'wall-' + w + '-app.png') });
      await appPage.evaluate(() => document.querySelectorAll('[data-tab]').forEach(t => { if (t.parentElement) t.parentElement.style.visibility = ''; }));
    }
  }
}
await browser.close(); srv.close();
errors.forEach(e => problems.push(e));
if (problems.length) { console.error('Wall check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('Wall check passed: ' + frames.length + ' frames, each with its card in the app, on the demo.');
process.exit(0);
