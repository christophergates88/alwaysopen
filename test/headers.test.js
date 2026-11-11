// Security headers on every answer (src/headers.js, Nov 11, 2026): https-only for a year, no type guessing, a content
// policy on every page, and the public pages' policy names exactly what they load.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const HD = await import('../src/headers.js');
const H = await import('./rehearsal/harness.js');

const world = new H.World(), DB = H.makeDB(), env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const site = H.makeClient(worker, env);

test('every answer says https only; pages always carry a content policy', async () => {
  for (const p of ['/', '/insurance', '/map', '/terms', '/stop-calls', '/sample-report', '/nope', '/health', '/leads', '/ops', '/app', '/start?plan=Growth', '/favicon.svg']) {
    const r = await site.call(p);
    assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains', p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    if (/^text\/html/.test(r.headers.get('content-type') || '')) assert.ok(r.headers.get('content-security-policy'), p + ' has a content policy');
  }
});

test('the public pages get the full policy; it names every place they load from and nothing else', async () => {
  for (const p of ['/', '/plumbing', '/map', '/privacy', '/do-not-call', '/stop-calls', '/sample-report']) {
    const r = await site.call(p);
    assert.equal(r.headers.get('content-security-policy'), HD.SITE_CSP, p);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\), microphone=\(\), geolocation=\(self\)/, p);
  }
  // every outside address a public page loads from is in the policy (links people click don't count)
  const hosts = new Set();
  for (const f of fs.readdirSync(new URL('../public/', import.meta.url)).filter(x => /\.(html|js)$/.test(x))) {
    const s = fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
    for (const m of s.matchAll(/<(?:script|img|source|audio|video|iframe)[^>]+src=["'](https?:\/\/[^/"']+)/g)) hosts.add(m[1]);
    for (const m of s.matchAll(/<link[^>]+rel=["'](?:stylesheet|preload|manifest)["'][^>]+href=["'](https?:\/\/[^/"']+)/g)) hosts.add(m[1]);
    for (const m of s.matchAll(/fetch\(\s*["'](https?:\/\/[^/"']+)/g)) hosts.add(m[1]);
  }
  for (const h of hosts) assert.ok(HD.SITE_CSP.includes(h), h + ' is loaded by a public page but is not in the policy');
  assert.ok(hosts.has('https://fonts.googleapis.com'), 'the scan still finds what the pages load');
  // nothing is allowed from everywhere
  assert.doesNotMatch(HD.SITE_CSP, /(^|[ ;])\*([ ;]|$)|https:(?!\/\/)|'unsafe-eval'/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"]) assert.ok(HD.SITE_CSP.includes(d), d);
});

test('the app keeps its own stricter policy, and a page that refuses every frame keeps refusing them', async () => {
  const app = await site.call('/app');
  assert.match(app.headers.get('x-frame-options'), /DENY/);
  assert.match(app.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const plain = HD.harden(new Response('<p>x</p>', { headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' } }));
  assert.equal(plain.headers.get('content-security-policy'), HD.BASE_CSP_NOFRAME);
  const own = HD.harden(new Response('<p>x</p>', { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'" } }));
  assert.equal(own.headers.get('content-security-policy'), "default-src 'none'", 'a page with its own policy keeps it');
  const data = HD.harden(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  assert.equal(data.headers.get('content-security-policy'), null);
  assert.ok(data.headers.get('strict-transport-security'));
  // an answer whose headers can't be changed (one passed straight through) is copied, not dropped
  const frozen = Response.redirect('https://checkout.stripe.com/c/pay/x', 303);
  assert.throws(() => frozen.headers.set('x', 'y'));
  const sent = HD.harden(frozen);
  assert.deepEqual([sent.status, sent.headers.get('location'), sent.headers.get('strict-transport-security')], [303, 'https://checkout.stripe.com/c/pay/x', HD.HSTS]);
  // a live-call handshake is left exactly as it is
  const ws = { status: 101, webSocket: {}, headers: new Headers() };
  assert.equal(HD.harden(ws), ws);
});

test('search engines get a sitemap of every public page, and each address on it answers', async () => {
  const xml = fs.readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const urls = [...xml.matchAll(/<loc>(https:\/\/alwaysopenoffice\.com\/[^<]*)<\/loc>/g)].map(m => m[1]);
  assert.ok(urls.length >= 17);
  for (const u of urls) assert.equal((await site.call(new URL(u).pathname)).status, 200, u);
  // every page file meant for the public is on it (the thank-you, share and not-found pages are not)
  for (const f of fs.readdirSync(new URL('../public/', import.meta.url)).filter(x => /\.html$/.test(x) && !/^(404|jobdone|og-share|index)\.html$/.test(x))) assert.ok(urls.includes('https://alwaysopenoffice.com/' + f.replace(/\.html$/, '')), f + ' is missing from sitemap.xml');
  assert.match(fs.readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8'), /^Sitemap: https:\/\/alwaysopenoffice\.com\/sitemap\.xml$/m);
});

test('a security contact is published, with a date that is always ahead', async () => {
  const r = await site.call('/.well-known/security.txt');
  assert.equal(r.status, 200);
  assert.match(r.text, /^Contact: mailto:hello@alwaysopenoffice\.com$/m);
  const exp = Date.parse(/^Expires: (.+)$/m.exec(r.text)[1]);
  assert.ok(exp > Date.now() + 250 * 86400000 && exp < Date.now() + 366 * 86400000);
});

test('the ops key is never accepted in an address, only in the x-key header', async () => {
  for (const p of ['/leads', '/storms', '/radar']) {
    assert.equal((await site.call(p + '?key=' + env.LEADS_KEY)).status, 403, p + ' with the key in the address');
    assert.equal((await site.call(p, { headers: { 'x-key': 'wrong' } })).status, 403, p);
  }
  const ok = await site.call('/leads', { headers: { 'x-key': env.LEADS_KEY } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json().ok, true);
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /searchParams\.get\('key'\)/);
});
