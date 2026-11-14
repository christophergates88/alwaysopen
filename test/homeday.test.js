// The home page and the app's Today since Nov 14, 2026 (Christopher looked at the drafts on Nov 13 and said "Make it all
// live"). The home page: the headline with Call Max and A day with Always Open beside it, then what it was worth (the month
// on one dial), what you control, the plans, the Start form, and everything else under one bar, Questions and details.
// The app: Needs you, then today as a timeline of what Always Open handled, then the month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { appHtml } = await import('../src/apppage.js');

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the home page: the day beside the headline, the month, what you control, the plans and Start, then one bar for the rest', () => {
  const s = read('public/index.html');
  assert.doesNotMatch(s, /name="robots"/);
  assert.match(s, /<iframe class="aday-f" src="\/day"/);
  assert.doesNotMatch(s, /\/draft|<!--ao:report-->/);
  const at = id => s.indexOf('id="' + id + '"');
  const order = ['aday', 'clock', 'yours', 'pricing', 'contact', 'more', 'faq', 'does', 'go', 'try', 'audit', 'only', 'what', 'tap', 'map-feature', 'industries', 'compare', 'rules', 'regulated'].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1] && order[i - 1] > 0, 'order at ' + i);
  assert.equal(at('day'), -1, '"One ordinary day" is the day piece now');
  // everything under Questions and details is folded, and the bar itself folds on a computer too
  const more = s.slice(at('more'), s.indexOf('</main>'));
  assert.match(more, /^id="more"[^>]*data-fold="/);
  for (const m of more.matchAll(/<section class="[^"]*\bband\b[^"]*" id="([^"]+)"[^>]*>/g)) assert.match(m[0], /data-fold="/, m[1] + ' is folded');
  assert.match(s, /@media \(min-width:761px\)\{\n\.js #more:not\(\.ao-open\)>:not\(\.ao-foldbar\),\.js #yours:not\(\.ao-open\)>:not\(\.ao-foldbar\)\{display:none!important\}/, 'on a computer too, Questions and details and What you control are one bar each');
  // a link into a topic opens Questions and details too (tools/phone.mjs draws the opener)
  assert.match(s, /for \(var f = el\.closest\('\[data-fold\]'\); f; f = f\.parentElement && f\.parentElement\.closest\('\[data-fold\]'\)\)/);
  // the month carries the example-report caption the hero's sample report used to
  assert.match(s, /<p class="eyebrow">What it was worth<\/p>/);
  assert.match(s, /<p class="clockcap">An example report\./);
  // the menu and its Spanish follow the new order
  assert.match(s, /<nav aria-label="Main"><a href="#aday">A day<\/a><a class="nav-call" href="#try">Call Max<\/a><a href="#clock">What it’s worth<\/a>/);
  const es = JSON.parse(s.match(/<script type="application\/json" id="ao-es">([\s\S]*?)<\/script>/)[1]);
  for (const sel of ['#aday-h', '#aday .aday-sub', '#clock .head .eyebrow', '#more > .ao-foldbar .ao-ft', '#more > .ao-foldbar .ao-fs']) assert.ok(es.some(e => e.s === sel), sel);
  assert.equal(es.find(e => e.s === 'header.hero nav a:nth-child(1)').h, 'Un día');
});

test('the day piece has its own page, on the sitemap, and its buttons open in the whole window', () => {
  const s = read('public/day.html');
  assert.doesNotMatch(s, /name="robots"|\/draft/);
  assert.match(s, /<link rel="canonical" href="https:\/\/alwaysopenoffice\.com\/day">/);
  assert.match(s, /href="tel:\+17064602226" target="_top"/);
  assert.match(s, /href="\/#contact" target="_top"/);
  assert.match(read('public/sitemap.xml'), /<loc>https:\/\/alwaysopenoffice\.com\/day<\/loc>/);
  assert.ok(!fs.existsSync(new URL('../public/draft', import.meta.url)), 'the draft folder is gone');
});

test('Today in the app: Needs you, then today as a timeline, then the month; the sample account shows the website’s day', () => {
  const h = appHtml({ base: '/app/x', business: 'Test' });
  assert.doesNotMatch(h, /PREVIEW|preview=day|pvbar|vTodayDay|todayNums/);
  const t = h.slice(h.indexOf('function vToday(){'), h.indexOf('\n}\n', h.indexOf('function vToday(){')));
  assert.ok(t.indexOf("'<h2>Needs you</h2>'") < t.indexOf('dayTimeline()') && t.indexOf('dayTimeline()') < t.indexOf("'<h2>Your month</h2>'"), 'the order');
  assert.match(h, /\['2:47 AM','you','Call answered','Water coming up through the basement floor drain\./);
  const js = h.slice(h.indexOf('<script>') + 8, h.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(js));
});

test('the app state carries the business’s own date and time zone, so the timeline picks out today', async () => {
  const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  const { default: worker } = await import('../src/index.js');
  const site = H.makeClient(worker, env);
  const OWNER = 'P'.repeat(30), q = (sql, ...b) => DB.prepare(sql).bind(...b).run();
  await site.call('/app/' + OWNER + '/api/state');
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('d1', ?1, 'd1', 'Day Plumbing', 'Pro', 'Ann', 1)", createHash('sha256').update(OWNER).digest('hex'));
  await q("INSERT INTO voice_lines (number, client_id, business, on_air, industry, facts, updated) VALUES ('+14785550199', 'd1', 'Day Plumbing', 1, 'plumbing', '{}', '2026-10-01')");
  const at = new Date(Date.now() - 60000).toISOString();
  await q("INSERT INTO app_calls (id, client_id, number, at, outcome, test, transcript, reason, transferred, seconds) VALUES ('CAd1', 'd1', '+14785550199', ?1, 'done', 0, '[]', 'Leak under the sink', 0, 90)", at);
  const st = (await site.call('/app/' + OWNER + '/api/state')).json();
  assert.equal(st.ok, true);
  assert.match(st.clock.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(st.clock.tz);
  assert.ok(st.clock.events.some(e => e.day === st.clock.today && e.kind === 'call'), 'the call a minute ago is on today');
  // the old draft addresses open the live pages
  for (const [p, to] of [['/draft/', '/'], ['/draft/day', '/day'], ['/draft', '/']]) {
    const r = await site.call(p);
    assert.equal(r.status, 301, p);
    assert.equal(r.headers.get('location'), to, p);
  }
});
