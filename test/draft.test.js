// The drafts Christopher asked for on Nov 13, 2026 ("Do all"): a new home page and a new Today in the app, to look at
// before anything changes. The live home page and the live Today stay exactly as they are until he says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { appHtml } = await import('../src/apppage.js');

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the draft home page: the day piece beside the headline, the month, the price and Start, then everything else folded', () => {
  const s = read('public/draft/index.html'), live = read('public/index.html');
  assert.match(s, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(s, /<iframe class="aday-f" src="\/draft\/day"/);
  assert.doesNotMatch(s, /<!--ao:report-->/, 'the hero report gives its place to the day');
  // the order: hero (with the day), the month on the dial, pricing, the Start form, then Questions and details
  const at = id => s.indexOf('id="' + id + '"');
  const order = ['aday', 'clock', 'pricing', 'contact', 'more', 'faq', 'does', 'go', 'try', 'audit', 'only', 'what', 'tap', 'map-feature', 'yours', 'industries', 'compare', 'rules', 'regulated'].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1] && order[i - 1] > 0, 'order at ' + i);
  assert.equal(at('day'), -1, '"One ordinary day" is the day piece now');
  // everything under Questions and details is folded, and a link into it opens it
  const more = s.slice(at('more'), s.indexOf('</main>'));
  for (const m of more.matchAll(/<section class="[^"]*\bband\b[^"]*" id="([^"]+)"[^>]*>/g)) assert.match(m[0], /data-fold="/, m[1] + ' is folded');
  assert.match(s, /for \(var f = el\.closest\('\[data-fold\]'\); f; f = f\.parentElement && f\.parentElement\.closest\('\[data-fold\]'\)\)/);
  // its own links stay on the draft, and nothing on it points at a page one folder down
  assert.doesNotMatch(s, /href="\/#/);
  assert.doesNotMatch(s, /href="(terms|privacy)\.html"/);
  // the live page is the one it was built from, untouched
  assert.match(live, /<!--ao:report-->/);
  assert.doesNotMatch(live, /aday|\/draft/);
});

test('the day piece: noindex, and its Call Max and Free audit buttons open in the whole window', () => {
  const s = read('public/draft/day.html');
  assert.match(s, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(s, /href="tel:\+17064602226" target="_top"/);
  assert.match(s, /href="\/draft\/#contact" target="_top"/);
  assert.doesNotMatch(s, /window\.claude/);
});

test('the new Today is only a preview: the app shows it with ?preview=day and nowhere else', () => {
  const h = appHtml({ base: '/app/x', business: 'Test' });
  assert.match(h, /var PREVIEW=\/\[\?&\]preview=day\(&\|\$\)\/\.test\(location\.search\);/);
  assert.match(h, /function vToday\(\)\{\n  if\(PREVIEW\)return vTodayDay\(\);/);
  // the sample account shows the website's day, starting with the 2:47 AM call
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
  await q("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('d1', ?1, 'd1', 'Draft Plumbing', 'Pro', 'Ann', 1)", createHash('sha256').update(OWNER).digest('hex'));
  await q("INSERT INTO voice_lines (number, client_id, business, on_air, industry, facts, updated) VALUES ('+14785550199', 'd1', 'Draft Plumbing', 1, 'plumbing', '{}', '2026-10-01')");
  const at = new Date(Date.now() - 60000).toISOString();
  await q("INSERT INTO app_calls (id, client_id, number, at, outcome, test, transcript, reason, transferred, seconds) VALUES ('CAd1', 'd1', '+14785550199', ?1, 'done', 0, '[]', 'Leak under the sink', 0, 90)", at);
  const st = (await site.call('/app/' + OWNER + '/api/state')).json();
  assert.equal(st.ok, true);
  assert.match(st.clock.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(st.clock.tz);
  assert.ok(st.clock.events.some(e => e.day === st.clock.today && e.kind === 'call'), 'the call a minute ago is on today');
});
