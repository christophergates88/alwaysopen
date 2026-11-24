// Nov 24, 2026 (fix-outreach): Outreach is advertised as working but cannot place a call while the operator's switch is
// off and no Do Not Call copy is loaded. The site says "Coming soon" until it can really call, and lifts by itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const L = await import('../src/launch.js');
const { makeDB } = await import('./rehearsal/harness.js');

async function world({ kill, list }) {
  const DB = makeDB(), env = { DB };
  await DB.prepare('CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT)').run();
  if (kill != null) await DB.prepare("INSERT INTO billing_config (k, v) VALUES ('outreach_enabled', ?1)").bind(kill).run();
  if (list) {
    await (await import('../src/dnclist.js')).ensureDncList(env);
    const asOf = new Date(Date.now() - list * 864e5).toISOString().slice(0, 10);
    await DB.prepare("INSERT INTO dnc_loads (id, as_of, started, finished, area_codes, numbers) VALUES ('d1', ?1, ?2, ?2, 300, 1000)").bind(asOf, new Date().toISOString()).run();
  }
  L.forget();
  return env;
}

test('O1: the outreach launch key is off with the switch off, off with no list, on only with both', async () => {
  assert.ok(L.FEATURES.includes('outreach'));
  let st = (await L.launchState(await world({ kill: '0', list: 2 }))).outreach;
  assert.equal(st.on, false); assert.equal(st.detail, 'Outreach is switched off on our side.');
  st = (await L.launchState(await world({ kill: '1' }))).outreach;
  assert.equal(st.on, false, 'switch on, list not loaded'); assert.equal(st.detail, 'The Do Not Call list is not loaded yet.');
  st = (await L.launchState(await world({ kill: '1', list: 45 }))).outreach;
  assert.equal(st.on, false, 'a list too old to call with does not count'); assert.equal(st.detail, 'The Do Not Call list is not loaded yet.');
  st = (await L.launchState(await world({}))).outreach;
  assert.equal(st.on, false, 'no config row at all: off');
  st = (await L.launchState(await world({ kill: '1', list: 2 }))).outreach;
  assert.equal(st.on, true);
  assert.equal(await L.isOn(await world({ kill: '1', list: 2 }), 'outreach'), true);
  assert.equal(await L.isOn(await world({ kill: '0', list: 2 }), 'outreach'), false);
});

test('O1: turning on tells nobody and stores nothing, and the cron reports it without a push or an email', async () => {
  const env = await world({ kill: '1', list: 2 });
  const sent = [];
  env.NTFY = 'x'; const realFetch = globalThis.fetch; globalThis.fetch = async (...a) => { sent.push(String(a[0])); return new Response('{}', { status: 200 }); };
  try {
    const out = await L.launchCron(env, { force: false });
    assert.equal(out.outreach, 'on');
    assert.equal(sent.filter(u => !/googleapis|facebook/.test(u)).length, 0, 'no notice goes anywhere for outreach');
    const row = await env.DB.prepare("SELECT k FROM launch WHERE k = 'outreach'").first();
    assert.equal(row, null, 'nothing stored: it is read fresh, so it drops back off if the switch or the list goes away');
  } finally { globalThis.fetch = realFetch; }
});

// A tiny HTMLRewriter for node: handles the [data-launch] rule on whole elements, which is all rewritePage needs here.
class FakeRewriter {
  constructor() { this.rules = []; }
  on(sel, h) { this.rules.push([sel, h]); return this; }
  transform(res) {
    const rules = this.rules;
    return { async text() {
      let t = await res.text();
      for (const [sel, h] of rules) {
        const attr = /\[(data-launch(?:-on)?)\]/.exec(sel)[1];
        t = t.replace(new RegExp('<(\\w+)([^>]*\\s' + attr + '="([^"]*)"[^>]*)>[\\s\\S]*?</\\1>', 'g'), (m, tag, rest, val) => {
          let gone = false; h.element({ getAttribute: () => val, remove: () => { gone = true; }, removeAttribute() {} }); return gone ? '' : m;
        });
      }
      return t;
    } };
  }
}
test('O1: rewritePage removes a data-launch="outreach" element only when outreach is on', async () => {
  globalThis.HTMLRewriter = FakeRewriter;
  const page = () => new Response('<p>Pro<span class="soon" data-launch="outreach">Coming soon</span></p>', { headers: { 'content-type': 'text/html' } });
  const off = await L.rewritePage(page(), { outreach: { on: false }, google: { on: true } }).text();
  assert.match(off, /Coming soon/);
  const on = await L.rewritePage(page(), { outreach: { on: true }, google: { on: false } }).text();
  assert.doesNotMatch(on, /Coming soon/);
  delete globalThis.HTMLRewriter;
});

// ---------------- the public pages ----------------
const PUB = new URL('../public/', import.meta.url);
const LEGAL = ['do-not-call.html', 'terms.html', 'privacy.html'];   // the rules for Outreach: they stay as they are
const visible = f => readFileSync(new URL(f, PUB), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const labels = h => [...h.matchAll(/<(\w+)[^>]*data-launch="outreach"[^>]*>([\s\S]*?)<\/\1>/g)].map(m => m[2].trim());

test('O2: every public page that says "Outreach calls" carries a "Coming soon" label keyed to outreach', () => {
  const pages = readdirSync(PUB).filter(f => f.endsWith('.html') && !LEGAL.includes(f));
  let seen = 0;
  for (const f of pages) {
    // day.html says it only inside its script (the film's feature list); the caption there is checked below
    const raw = readFileSync(new URL(f, PUB), 'utf8');
    if (!/Outreach calls/.test(visible(f)) && !(f === 'day.html' && /Outreach calls/.test(raw))) continue;
    seen++;
    const got = labels(visible(f));
    assert.ok(got.length > 0, f + ': says Outreach calls but has no data-launch="outreach" label');
    for (const t of got) assert.equal(t, 'Coming soon', f + ': the label text');
  }
  assert.ok(seen >= 10, 'the home page, the trade pages and the day page were all looked at');
});

test('O2: each claim on the home page and a trade page has its own label', () => {
  const home = visible('index.html'), trade = visible('plumbing.html');
  const soon = '<span class="soon" data-launch="outreach">Coming soon</span>';
  assert.match(home, /<summary>Can Max call businesses for us\?<span class="soon" data-launch="outreach">Coming soon<\/span><\/summary><p>On Pro, yes\./);
  assert.match(home, new RegExp('Outreach calls: Max calls a list of businesses[^<]*' + soon));
  assert.match(trade, new RegExp('<span>Outreach calls: Max calls[^<]*' + soon + '</span></li>'));
  for (const h of [home, trade]) {
    assert.match(h, new RegExp('<li><b>Outreach calls</b><span>: on Pro, [^<]*' + soon + '</span></li>'));
    assert.match(h, new RegExp('<h3>Outreach calls to businesses' + soon + '</h3>'));
    for (const card of h.match(/<article class="aos-card" id="aos-outreach"[\s\S]*?<div class="aos-scn"/g)) assert.ok(card.includes(soon), 'every Outreach card title carries the label');
  }
  assert.equal((home.match(/id="aos-outreach"/g) || []).length, 7);
  assert.match(readFileSync(new URL('day.html', PUB), 'utf8'), /Outreach<\/span><span class="tagx">Pro<\/span><span class="tagx" data-launch="outreach">Coming soon<\/span>/);
});

test('O2: the Spanish layer says "Próximamente" in the same three places, and the generator sources agree', () => {
  const blob = f => JSON.parse(/<script type="application\/json" id="ao-es">([\s\S]*?)<\/script>/.exec(readFileSync(new URL(f, PUB), 'utf8'))[1]);
  const es = '<span class="soon" data-launch="outreach">Próximamente</span>';
  const home = blob('index.html').filter(e => (e.h || '').includes(es));
  assert.equal(home.length, 3, 'the scene title, the Pro plan and the list of what Max does');
  for (const f of ['plumbing.html', 'hvac.html', 'marinas.html']) assert.equal(blob(f).filter(e => (e.h || '').includes(es)).length, 1, f);
  assert.match(readFileSync(new URL('../tools/phone.mjs', import.meta.url), 'utf8'), /c\.key === 'outreach' \? '<span class="soon" data-launch="outreach">Coming soon<\/span>'/);
});

// ---------------- signup and Max's own sales talk ----------------
test('O3: the Pro blurb on /start and Max\'s knowledge of the plans say Outreach is coming soon', async () => {
  const F = await import('../src/facts.js');
  assert.match(F.PLANS.Pro.blurb, /and Outreach calls to businesses \(coming soon\)\.$/);
  const line = F.ownLineFacts().plans;
  const sentence = line.split(/(?<=\.)\s+/).find(x => /^Pro adds Outreach/.test(x));
  assert.match(sentence, /coming soon and not switched on yet/);
  assert.match(sentence, /never say it works today and never give a date/);
  const B = await import('../src/billing.js');
  assert.equal(B.PLANS.Pro.blurb, F.PLANS.Pro.blurb, 'the signup page prints the same blurb');
  assert.match(readFileSync(new URL('../docs/runbook.md', import.meta.url), 'utf8'), /"\(coming soon\)" in src\/facts\.js|words "\(coming soon\)" in src\/facts\.js/);
});

test('O3: the signup page itself prints the Pro line with "(coming soon)"', async () => {
  const B = await import('../src/billing.js');
  const u = 'https://alwaysopenoffice.com/start?plan=Pro';
  const html = await (await B.handleBilling(new Request(u), { DB: makeDB() }, new URL(u), { notify: async () => {} })).text();
  assert.match(html, /and Outreach calls to businesses \(coming soon\)\./);
});

// ---------------- the owner's app ----------------
test('O4: the app is told when the operator\'s switch is off, and says so at the top of the Outreach section', async () => {
  const O = await import('../src/outreach.js');
  const C = { client_id: 'c9', business: 'Smith Plumbing', tier: 'Pro', regulated: 0, phone: '4785550123' };
  const env = await world({ kill: '0' });
  assert.equal((await O.outreachState(env, C)).switchOn, false);
  await env.DB.prepare("UPDATE billing_config SET v = '1' WHERE k = 'outreach_enabled'").run();
  assert.equal((await O.outreachState(env, C)).switchOn, true);
  const src = readFileSync(new URL('../src/apppage.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function outreachBody()'), src.indexOf('function orHear()'));
  const top = body.indexOf('R.switchOn===false');
  assert.ok(top > 0 && top < body.indexOf('R.attested'), 'the line comes before the terms and everything else in the card');
  assert.ok(body.includes('Outreach is not switched on yet on our side.</b> You can get your list ready now. Calls start when it is on.'));
});
