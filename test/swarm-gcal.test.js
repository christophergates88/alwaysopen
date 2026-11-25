// Nov 24, 2026: the Google Calendar connect is a hard block. It finishes only in the browser that started it (a cookie
// holding the nonce that is signed into the state). Without that cookie nothing connects, the Google code is never used,
// and there is no button to press. The Google Business Profile connect is bound the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');
const PA = await import('../src/plainalerts.js');

const sha = s => createHash('sha256').update(s).digest('hex');
const OWNER = 'O'.repeat(30);
let tokenCalls = 0;
async function setup(business) {
  const world = new H.World(), DB = H.makeDB();
  const env = H.makeEnv(world, DB);
  H.installFetch(world, env);
  env.GOOGLE_CLIENT_ID = 'cid'; env.GOOGLE_CLIENT_SECRET = 'sec';
  const base = globalThis.fetch; tokenCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String((input && input.url) || input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) { tokenCalls++; return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } }); }
    if (url.startsWith('https://www.googleapis.com/calendar/')) return new Response(JSON.stringify({ timeZone: 'America/New_York', items: [] }), { headers: { 'content-type': 'application/json' } });
    return base(input, init);
  };
  await DB.prepare("INSERT INTO app_clients (client_id, code_hash, ref, business, tier, owner_first, active) VALUES ('c1', ?1, 'sinclair', ?2, 'Pro', 'Dana', 1)").bind(sha(OWNER), business || 'Sinclair Plumbing').run();
  const site = H.makeClient(worker, env);
  const connected = async () => (await DB.prepare("SELECT COUNT(*) AS n FROM gcal_tokens").first().catch(() => ({ n: 0 }))).n;
  // start a connect the way the app does; returns the state and the cookie the browser was given
  const start = async () => {
    const r = await site.call('/google/connect?code=' + OWNER);
    const state = new URL(r.location).searchParams.get('state');
    const cookie = r.headers.get('set-cookie') || '';
    const m = cookie.match(/^(ao_gcal_[0-9a-f]{12})=([0-9a-f]{32});/) || [];
    return { r, state, cookie, name: m[1], nonce: m[2], pair: m[1] + '=' + m[2] };
  };
  return { env, DB, site, connected, start };
}
const sign = async (body) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('sec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
};
const refused = (r) => {
  assert.equal(r.status, 403);
  assert.match(r.text, /Not connected/);
  assert.match(r.text, /finished in a different browser from the one where it was started, so we stopped it\. Nothing was connected and nothing was shared\./);
  assert.doesNotMatch(r.text, /<form|<button|type="submit"|name="confirm"|Yes, connect/i, 'nothing to press');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
};

test('connect: sets a one hour host-only Secure HttpOnly Lax cookie on the callback path, and signs the nonce into the state', async () => {
  const { start } = await setup();
  const { r, state, cookie, nonce, name } = await start();
  assert.equal(r.status, 302);
  assert.match(r.location, /^https:\/\/accounts\.google\.com\//);
  assert.ok(nonce && nonce.length === 32, 'a random nonce');
  assert.equal(name, 'ao_gcal_' + nonce.slice(0, 12), 'the cookie is named after its own nonce');
  assert.match(cookie, /Max-Age=3600/, 'it lasts as long as the state, so a slow sign-in is not refused');
  assert.match(cookie, /Path=\/google\/callback/);
  assert.match(cookie, /; Secure/); assert.match(cookie, /; HttpOnly/); assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.equal(state.split('.')[2], nonce, 'the nonce is inside the state');
});

test('same browser (cookie matches): connects with no extra page and clears the cookie', async () => {
  const { site, connected, start } = await setup();
  const { state, pair, name } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: 'x=1; ' + pair } });
  assert.match(r.text, /Calendar connected/);
  assert.equal(await connected(), 1);
  assert.match(r.headers.get('set-cookie') || '', new RegExp('^' + name + '=;.*Max-Age=0'));
});

test('no cookie: stopped. Nothing connects, the code is never used, the business is not named, and there is nothing to press', async () => {
  const { site, connected, start } = await setup('Sinclair Plumbing');
  const { state } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state);
  refused(r);
  assert.doesNotMatch(r.text, /Sinclair/, 'a stranger does not learn whose link it was');
  assert.equal(await connected(), 0);
  assert.equal(tokenCalls, 0, 'the Google code was not exchanged');
});

test('the old "Yes, connect it" button is gone: posting to the callback connects nothing, with or without the cookie', async () => {
  const { site, connected, start } = await setup();
  const { state, pair } = await start();
  for (const opt of [{ form: { code: 'abc', state, confirm: '1' } }, { form: { code: 'abc', state, confirm: '1' }, headers: { cookie: pair } }]) {
    const r = await site.call('/google/callback', opt);
    assert.equal(r.status, 405);
    const q = await site.call('/google/callback?code=abc&state=' + state, opt);
    assert.equal(q.status, 405);
  }
  assert.equal(await connected(), 0); assert.equal(tokenCalls, 0);
});

test('a wrong nonce in the cookie, or the right nonce under another name, is stopped', async () => {
  const { site, connected, start } = await setup();
  const { state, name, nonce } = await start();
  refused(await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: name + '=' + 'f'.repeat(32) } }));
  refused(await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: 'ao_gcal=' + nonce } }));
  refused(await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: name + '=' } }));
  assert.equal(await connected(), 0); assert.equal(tokenCalls, 0);
});

test('another owner\'s browser cannot finish this one: their own cookie does not match this state', async () => {
  const { site, connected, start } = await setup();
  const a = await start(), b = await start();   // two separate starts: think of b as the other person's browser
  refused(await site.call('/google/callback?code=abc&state=' + a.state, { headers: { cookie: b.pair } }));
  assert.equal(await connected(), 0);
});

test('two connects started in two tabs of one browser can both finish', async () => {
  const { site, connected, start } = await setup();
  const a = await start(), b = await start();
  assert.notEqual(a.name, b.name);
  const jar = a.pair + '; ' + b.pair;
  assert.match((await site.call('/google/callback?code=one&state=' + a.state, { headers: { cookie: jar } })).text, /Calendar connected/);
  assert.match((await site.call('/google/callback?code=two&state=' + b.state, { headers: { cookie: jar } })).text, /Calendar connected/);
  assert.equal(await connected(), 1); assert.equal(tokenCalls, 2);
});

test('a Google code works once: a refresh of the finished page says it was used', async () => {
  const { site, start } = await setup();
  const s = await start(), hdr = { cookie: s.pair };
  assert.match((await site.call('/google/callback?code=zzz&state=' + s.state, { headers: hdr })).text, /Calendar connected/);
  assert.match((await site.call('/google/callback?code=zzz&state=' + s.state, { headers: hdr })).text, /already used/);
  assert.equal(tokenCalls, 1);
});

test('a bad, forged, old or pre-nonce state is refused even with a cookie', async () => {
  const { site, connected, start } = await setup();
  const { state, pair, nonce } = await start();
  const parts = state.split('.');
  const forged = [parts[0], parts[1], 'a'.repeat(32), parts[3]].join('.');
  const noNonce = 'c1.' + Date.now(); const threePart = noNonce + '.' + await sign(noNonce);   // how states looked before the nonce
  for (const s of [forged, threePart, 'c1.123.deadbeef', 'garbage', '']) {
    const g = await site.call('/google/callback?code=abc&state=' + s, { headers: { cookie: pair + '; ao_gcal_aaaaaaaaaaaa=' + 'a'.repeat(32) } });
    assert.equal(g.status, 400); assert.match(g.text, /Link expired/);
  }
  const old = String(Date.now() - 7200e3), n = 'b'.repeat(32);
  const oldState = 'c1.' + old + '.' + n + '.' + await sign('c1.' + old + '.' + n);
  assert.match((await site.call('/google/callback?code=abc&state=' + oldState, { headers: { cookie: 'ao_gcal_bbbbbbbbbbbb=' + n } })).text, /Link expired/);
  assert.equal(await connected(), 0); assert.equal(tokenCalls, 0); void nonce;
});

test('a stopped connect tells Christopher, in plain words', async () => {
  const { site, DB, start } = await setup();
  const { state } = await start();
  await site.call('/google/callback?code=abc&state=' + state);
  const row = await DB.prepare("SELECT type FROM ops_alerts WHERE type LIKE 'gcal-blocked%'").first();
  assert.ok(row, 'an alert was recorded');
  const x = PA.explainAlert(row.type, 'detail');
  const title = Array.isArray(x) ? x[0] : (x && (x.title || x.what || x[0]));
  assert.match(String(title), /A Google connect was stopped/);
});

test('the Google Business Profile connect is bound to its browser too', async () => {
  const { site, env, DB } = await setup();
  const L = await import('../src/launch.js');
  let on = false; try { on = await L.isOn(env, 'google'); } catch (e) { on = false; }
  if (!on) {   // not launched: the connect page does not hand out a state at all
    const r = await site.call('/google/gbp?code=' + OWNER);
    assert.equal(r.status, 404);
  }
  // a state as gbpStart signs it (kind.who.ts.nonce.sig)
  const ts = String(Date.now()), nonce = 'c'.repeat(32), body = 'gbp.c1.' + ts + '.' + nonce, state = body + '.' + await sign(body);
  const before = tokenCalls;
  refused(await site.call('/google/callback?code=abc&state=' + state));
  refused(await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: 'ao_gcal_cccccccccccc=' + 'd'.repeat(32) } }));
  assert.equal(tokenCalls, before, 'no code was exchanged');
  // the old four-part profile state (no nonce) is no longer accepted
  const oldBody = 'gbp.c1.' + ts, oldState = oldBody + '.' + await sign(oldBody);
  const o = await site.call('/google/callback?code=abc&state=' + oldState);
  assert.equal(o.status, 400); assert.match(o.text, /Link expired/);
  assert.equal(tokenCalls, before); void DB;
});
