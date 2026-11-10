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
  const qid = (await DB.prepare('SELECT client_id FROM billing WHERE code = ?1').bind(code).first()).client_id, now = new Date().toISOString();
  await DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES ('itappcheck', ?1, 'reply', 'R. Patel left 5 stars', 'Fixed our water heater the same day.', 5, 'Thank you, R. Glad we could get the water heater going the same day. Call any time.', 'pending', 0, 1, ?2, ?2, 1, '')").bind(qid, now).run();
} catch (e) { /* the queue table may be shaped differently; the page still renders */ }
// a call Max took, with one line he held back (Brief 3): the owner sees it in plain words under the reply
try {
  const cid = (await DB.prepare('SELECT client_id FROM billing WHERE code = ?1').bind(code).first()).client_id;
  const tr = JSON.stringify([{ w: 'ai', t: 'Sinclair Plumbing, this is Max. I\'m S.I., and this call may be recorded. What can I do for you?' }, { w: 'caller', t: 'water is pouring out of my water heater onto the floor' },
    { w: 'ai', t: 'Oh no, okay. Shut the cold water valve on top of the tank, only if you can reach it dry. Can you get to it?' }, { w: 'held', t: 'asking for their details in the middle of a safety step' },
    { w: 'caller', t: 'yeah it\'s off now' }, { w: 'ai', t: 'Good. Dana gets an urgent alert now. What\'s your name?' }, { w: 'caller', t: 'Tom Reyes, this number' }, { w: 'ai', t: 'Thanks, Tom. Dana will call you back on this number. Take care.' }]);
  await DB.prepare("UPDATE app_clients SET feats = 'calls' WHERE client_id = ?1").bind(cid).run();
  await DB.prepare("INSERT INTO app_calls (id, client_id, at, caller, caller_name, reason, summary, transcript, outcome, status, urgency, test, turns) VALUES ('CAappcheck', ?1, ?2, '+14785550199', 'Tom Reyes', 'Water heater leaking', 'Water heater pouring onto the floor; cold valve shut. Call Tom back.', ?3, 'done', 'new', 'urgent', 0, 4)").bind(cid, new Date().toISOString(), tr).run();
} catch (e) { console.error('sample call not added: ' + String(e).slice(0, 120)); }
// the owner's pin on the map (Brief 4, Part 1): Eatonton, placed at town level the way the map's cron would place it
try {
  const { ensureMap } = await import('../src/map.js');
  await ensureMap(env);
  const cid = (await DB.prepare('SELECT client_id FROM billing WHERE code = ?1').bind(code).first()).client_id;
  await DB.prepare("INSERT INTO map_listing (client_id, show, phone, address, lat, lng, exact, geo_q, geo_at, updated) VALUES (?1, 1, '', '', 33.3268, -83.3885, 0, 'Eatonton, GA', '', '')").bind(cid).run();
} catch (e) { console.error('map pin not added: ' + String(e).slice(0, 120)); }

// the worker, reachable by a real browser
const srv = http.createServer(async (q, r) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const o = { method: q.method, headers: { 'content-type': q.headers['content-type'] || '' } };
  if (chunks.length) o.body = Buffer.concat(chunks).toString();
  try {
    const res = await site.call(q.url, o);
    const hd = { 'content-type': res.headers && res.headers.get ? (res.headers.get('content-type') || 'text/html') : 'text/html' };
    const csp = res.headers && res.headers.get && res.headers.get('content-security-policy'); if (csp) hd['content-security-policy'] = csp;   // the real page's rules, so a blocked map shows up here
    r.writeHead(res.status, hd);
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
let heldShot = false;
await page.goto('http://localhost:' + port + '/app/' + code, { waitUntil: 'load' });
await page.waitForTimeout(600);
for (const tab of ['today', 'customers', 'money', 'max']) {
  const btn = await page.$('[data-tab="' + tab + '"]');
  if (!btn) problems.push('no ' + tab + ' tab');
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
      const label = /Mono|monospace/.test(s.fontFamily) || el.closest('small,em,.kick,.fine,.note,.tab,.segn') || s.textTransform === 'uppercase';   // a tab-bar caption under its icon reads at 12 px, like iOS
      if (px < (label ? 12 : 15)) out.tiny.push(el.tagName + '.' + (el.className || '') + ' ' + px + 'px "' + n.textContent.trim().slice(0, 30) + '"');
    }
    // Brief 4: no doors, no segments, plain words, 17 px body, one column
    document.querySelectorAll('#view [data-go], #view [data-seg], #view [data-mseg], #view .seg, #view a[target=_blank], #view details.drawer, #view .drawer, #view .accordion').forEach(x => { if (!x.closest('.maplibregl-ctrl')) (out.doors = out.doors || []).push(x.outerHTML.slice(0, 70)); });
    const JARGON = /\b(configure|integration|sync|status|enable|dashboard|pending|queue|listing|segment|settings|feature)s?\b/i;
    document.querySelectorAll('#view h1, #view h2, #view h3, #view button, #view .lede, #view b').forEach(x => { if (!vis(x)) return; const t = x.textContent.trim(); const m = t.match(JARGON); if (m) (out.jargon = out.jargon || []).push('"' + m[0] + '" in "' + t.slice(0, 50) + '"'); });
    document.querySelectorAll('#view p').forEach(x => { if (!vis(x) || x.closest('.fine,.note,small,.maplibregl-ctrl,.sample') || x.matches('.fine,.note,.sample')) return; const px = parseFloat(getComputedStyle(x).fontSize); if (px < 16.9) (out.body = out.body || []).push(px + 'px "' + x.textContent.trim().slice(0, 30) + '"'); });
    out.ai = /\bAI\b|artificial intelligence/.test(document.body.innerText) ? (document.body.innerText.match(/[^.]*\bAI\b[^.]*/) || [''])[0] : '';
    return out;
  });
  if (r.docW > r.winW) problems.push(tab + ': scrolls sideways (' + r.docW + ' > ' + r.winW + ')');
  r.small.forEach(x => problems.push(tab + ': small tap target ' + x));
  r.tiny.forEach(x => problems.push(tab + ': small text ' + x));
  (r.doors || []).forEach(x => problems.push(tab + ': door or segment: ' + x));
  (r.jargon || []).forEach(x => problems.push(tab + ': jargon ' + x));
  (r.body || []).forEach(x => problems.push(tab + ': body text under 17 px ' + x));
  if (r.ai) problems.push(tab + ': says "AI": ' + r.ai.trim().slice(0, 80));
  if (!heldShot) { const d = await page.$('details:has(.said)'); if (d) { heldShot = true; await d.evaluate(x => { x.open = true; document.querySelectorAll('.seg').forEach(e => { e.style.position = 'static'; }); }); await page.waitForTimeout(200); const card = await d.evaluateHandle(x => x.closest('article,.card,li,section') || x); if (shots) await card.asElement().screenshot({ path: path.join(shots, 'app-held-back.png') }); if (!(await page.$('.said p.held'))) problems.push(tab + ': the held-back line did not render'); } }
  if (shots) await page.screenshot({ path: path.join(shots, 'app-' + tab + '.png'), fullPage: true });
}
// the After-the-call screen, where the outreach card lives (Brief 3, Part 8d): same size rules, and a screenshot
{ const mx = await page.$('[data-tab="max"]'); if (mx) { await mx.click(); await page.waitForTimeout(300); }
  {
    const card = await page.evaluateHandle(() => { const h = [...document.querySelectorAll('h2')].find(x => /Outreach calls/.test(x.textContent)); return h ? h.nextElementSibling : null; });
    const el = card && card.asElement();
    if (!el) problems.push('after: no outreach card');
    else {
      const bad = await el.evaluate(c => { const out = []; c.querySelectorAll('button,input,textarea,label').forEach(x => { const b = x.getBoundingClientRect(); if (b.width && b.height && (b.height < 43.5) && !x.matches('label') ) out.push(x.tagName + ' ' + Math.round(b.height)); }); c.querySelectorAll('p,label,span,b').forEach(x => { const px = parseFloat(getComputedStyle(x).fontSize); if (px < 15 && !x.closest('.fine,small')) out.push('text ' + px + 'px'); }); return out; });
      bad.forEach(x => problems.push('outreach card: ' + x));
      if (shots) { await page.evaluate(() => document.querySelectorAll('.seg').forEach(e => { e.style.position = 'static'; })); await el.evaluate(x => x.previousElementSibling.scrollIntoView()); await el.screenshot({ path: path.join(shots, 'app-outreach.png') }); }
    }
  }
}
// the same card on Pro once the terms are signed (Nov 10, 2026): the legal name, the call-back number, the sentence, and
// the call as the business will hear it, following what is typed
{
  const cid = (await DB.prepare('SELECT client_id FROM billing WHERE code = ?1').bind(code).first()).client_id;
  const O = await import('../src/outreach.js');
  await DB.prepare("UPDATE app_clients SET tier = 'Pro' WHERE client_id = ?1").bind(cid).run();
  const cl = await DB.prepare('SELECT * FROM app_clients WHERE client_id = ?1').bind(cid).first();
  const sg = await O.agree(env, cl, { version: O.TERMS_VERSION, name: 'Dana Sinclair', agree: true });
  if (!sg.ok) problems.push('outreach (Pro): could not sign the terms: ' + sg.error);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(600);
  const mx = await page.$('[data-tab="max"]'); if (mx) { await mx.click(); await page.waitForTimeout(300); }
  const card = await page.evaluateHandle(() => { const h = [...document.querySelectorAll('h2')].find(x => /Outreach calls/.test(x.textContent)); return h ? h.nextElementSibling : null; });
  const el = card && card.asElement();
  if (!el || !(await el.$('#or-legal')) || !(await el.$('#or-cb')) || !(await el.$('#or-hear'))) problems.push('outreach (Pro): the legal name, call-back number or preview is missing');
  else {
    await page.fill('#or-legal', 'Sinclair Plumbing LLC'); await page.fill('#or-cb', '(478) 555-0142'); await page.fill('#or-pitch', 'We service commercial water heaters and can come after hours.');
    const hear = await page.textContent('#or-hear');
    if (!/calling for Sinclair Plumbing LLC\. To stop these calls, say stop or press 9 at any time\. We service commercial water heaters/.test(hear) || !/\(478\) 555-0142/.test(hear)) problems.push('outreach (Pro): the preview did not follow what was typed: ' + hear.slice(0, 140));
    const bad = await el.evaluate(c => { const out = []; c.querySelectorAll('button,input,textarea,label').forEach(x => { const b = x.getBoundingClientRect(); if (b.width && b.height && (b.height < 43.5) && !x.matches('label') && !x.matches('input[type=checkbox]')) out.push(x.tagName + '#' + x.id + ' ' + Math.round(b.height)); }); c.querySelectorAll('p,label,span,b').forEach(x => { const px = parseFloat(getComputedStyle(x).fontSize); if (px < 15 && !x.closest('.fine,small')) out.push('text ' + px + 'px "' + x.textContent.trim().slice(0, 30) + '"'); });
      const J = /\b(configure|integration|sync|status|enable|dashboard|pending|queue|listing|segment|settings|feature)s?\b/i; c.querySelectorAll('b,h2,h3,button').forEach(x => { const m = x.textContent.match(J); if (m) out.push('jargon "' + m[0] + '"'); }); if (/\bAI\b/.test(c.innerText)) out.push('says AI'); return out; });
    bad.forEach(x => problems.push('outreach card (Pro): ' + x));
    if (shots) { await el.evaluate(x => x.previousElementSibling.scrollIntoView()); await el.screenshot({ path: path.join(shots, 'app-outreach-pro.png') }); }
  }
  await DB.prepare("UPDATE app_clients SET tier = 'Growth' WHERE client_id = ?1").bind(cid).run();
}
// the live map (Brief 4, Part 1): the map itself on Customers, examples when nobody is near, a full-screen sheet on tap
{ const cu = await page.$('[data-tab="customers"]'); if (cu) { await cu.click(); await page.waitForTimeout(300); }
  const box = await page.$('#map .mapbox');
  if (!box) problems.push('map: no live map on Customers');
  else {
    await page.waitForSelector('#map .maplibregl-canvas, #map .mapfb', { timeout: 20000 }).catch(() => {});
    const gl = await page.$('#map .maplibregl-canvas');
    if (!gl) { if (process.env.CI) problems.push('map: the map did not load (only the grey fallback showed)'); else console.log('map: MapLibre not reachable here, checked the fallback'); }
    if (gl) await page.waitForTimeout(2500);   // tiles
    const r = await page.evaluate(() => {
      const card = document.getElementById('map'), out = { ex: card.querySelectorAll('.mdot.ex').length, note: !document.getElementById('mapex').hidden, pin: !!card.querySelector('.mpin'), small: [], doors: [] };
      card.querySelectorAll('button,a,input').forEach(x => { if (x.closest('.maplibregl-ctrl,.mapbox')) return; const b = x.getBoundingClientRect(); if (b.width && (b.height < 47.5 || b.width < 47.5)) out.small.push((x.textContent || x.getAttribute('aria-label') || '').trim().slice(0, 30) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)); });
      document.querySelectorAll('#view a[target=_blank], #view [data-go="map"], #view a[href*="/map"]').forEach(x => x.closest('.maplibregl-ctrl') || out.doors.push(x.outerHTML.slice(0, 80)));
      out.line = card.querySelector('.mapline').textContent; out.h = card.querySelector('.mapbox').getBoundingClientRect().height;
      return out;
    });
    if (r.ex !== 6) problems.push('map: expected 6 example dots with nobody nearby, saw ' + r.ex);
    if (!r.note) problems.push('map: the "these are examples" line is missing');
    if (!r.pin) problems.push('map: the owner\'s pin is missing');
    if (Math.round(r.h) !== 260) problems.push('map: should be 260 px tall, is ' + r.h);
    if (!/plumb|business like yours/i.test(r.line) || !/Eatonton/.test(r.line)) problems.push('map: the line under it reads "' + r.line + '"');
    r.small.forEach(x => problems.push('map: tap target under 48 px: ' + x));
    r.doors.forEach(x => problems.push('map: still a link out: ' + x));
    if (shots) { await page.evaluate(() => document.querySelectorAll('.seg').forEach(e => { e.style.position = 'static'; })); await page.$eval('#map', x => x.scrollIntoView()); await (await page.$('#map')).screenshot({ path: path.join(shots, 'app-map.png') }); }
    // tap the map: one full-screen sheet with the map in it, and a 48 px close
    await box.click(); await page.waitForTimeout(400);
    await page.waitForSelector('.sheet.full .maplibregl-canvas, .sheet.full .mapfb', { timeout: 20000 }).catch(() => {});
    const full = await page.evaluate(() => { const sh = document.querySelector('.sheet.full'); if (!sh) return null; const c = sh.querySelector('[data-close]').getBoundingClientRect(), m = sh.querySelector('#mapfull').getBoundingClientRect(); return { close: Math.min(c.width, c.height), mapH: m.height, sheets: document.querySelectorAll('.sheet').length }; });
    if (!full) problems.push('map: tapping it did not open the full map');
    else {
      if (full.close < 48) problems.push('map sheet: close button under 48 px');
      if (full.mapH < 400) problems.push('map sheet: the map is only ' + full.mapH + ' px tall');
      if (full.sheets !== 1) problems.push('map sheet: ' + full.sheets + ' sheets open');
      if (await page.$('.sheet.full .maplibregl-canvas')) await page.waitForTimeout(2500);
      if (shots) await page.screenshot({ path: path.join(shots, 'app-map-full.png') });
      await page.click('.sheet.full [data-close]'); await page.waitForTimeout(200);
    }
    // once businesses join nearby: real dots, no examples
    await page.route(/\/api\/map\?/, rt => rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, enough: true, businesses: [[33.36, -83.41], [33.30, -83.35], [33.34, -83.30], [33.28, -83.44]].map((p, i) => ({ id: 'n' + i, name: 'Business ' + (i + 1), kind: '', lat: p[0], lng: p[1] })) }) }));
    await page.evaluate(() => window.aoMapReset());
    await page.waitForTimeout(1500);
    const live = await page.evaluate(() => ({ ex: document.querySelectorAll('#map .mdot.ex').length, real: document.querySelectorAll('#map .mdot:not(.ex)').length, note: !document.getElementById('mapex').hidden }));
    if (live.ex || live.real !== 4 || live.note) problems.push('map: with 4 businesses nearby it showed ' + live.real + ' dots, ' + live.ex + ' examples' + (live.note ? ', and the examples line' : ''));
    await page.unroute(/\/api\/map\?/);
  }
}
// Text Katie: one sheet from any screen
{ const k = await page.$('header [data-a="katie"]');
  if (!k) problems.push('no Text Katie button');
  else { await k.click(); await page.waitForTimeout(300);
    const ok = await page.evaluate(() => !!document.querySelector('.sheet #msg') && document.querySelectorAll('.sheet').length === 1);
    if (!ok) problems.push('Text Katie did not open the message box');
    if (shots) await page.screenshot({ path: path.join(shots, 'app-katie.png') });
    await page.click('.sheet [data-close]'); await page.waitForTimeout(200); }
}
// two taps or fewer for the tasks owners do most (Brief 4, Part 4): [task, tab, selector that must be on that screen]
for (const [task, tab, sel] of [['see a call', 'today', '.call'], ['call back', 'today', '.call a[href^="tel:"]'], ['post a review reply', 'today', '[data-a="approve"]'],
  ['see the map', 'customers', '#map .mapbox'], ['turn the map on', 'customers', '[data-a="map-show"]'], ['see the month\'s worth', 'money', 'h1'],
  ['hear Max', 'max', 'a[href^="tel:"]'], ['close for today', 'today', '[data-a="closed"]'], ['turn Max off', 'max', '[data-a="line-toggle"]'],
  ['text Katie', 'today', 'header [data-a="katie"]'], ['see what Max knows', 'max', '#lo']]) {
  await page.click('[data-tab="' + tab + '"]'); await page.waitForTimeout(250);
  if (!(await page.$(sel))) problems.push('two taps: "' + task + '" is not on ' + tab);
}
await browser.close(); srv.close();
errors.forEach(e => problems.push('page error: ' + e.slice(0, 120)));
if (!heldShot) problems.push('no call transcript was shown on any tab');
if (problems.length) { console.error('App check failed:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log('App check passed (4 tabs at 390 px).');
process.exit(0);
