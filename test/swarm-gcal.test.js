// Nov 24, 2026: the Google Calendar connect is tied to the browser that started it (cookie + nonce in the signed state),
// and a callback without that cookie only connects after the person sees whose business it joins and presses the button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const { default: worker } = await import('../src/index.js');

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
  // start a connect the way the app does; returns the state and the cookie nonce
  const start = async () => {
    const r = await site.call('/google/connect?code=' + OWNER);
    const state = new URL(r.location).searchParams.get('state');
    const cookie = r.headers.get('set-cookie') || '';
    return { r, state, cookie, nonce: (cookie.match(/ao_gcal=([0-9a-f]+)/) || [])[1] };
  };
  return { env, DB, site, connected, start };
}

test('connect: sets a 10 minute host-only Secure HttpOnly Lax cookie on the callback path, and signs the nonce into the state', async () => {
  const { start } = await setup();
  const { r, state, cookie, nonce } = await start();
  assert.equal(r.status, 302);
  assert.match(r.location, /^https:\/\/accounts\.google\.com\//);
  assert.ok(nonce && nonce.length >= 32, 'a random nonce');
  assert.match(cookie, /Max-Age=600/); assert.match(cookie, /Path=\/google\/callback/);
  assert.match(cookie, /; Secure/); assert.match(cookie, /; HttpOnly/); assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.ok(state.split('.').includes(nonce), 'the nonce is inside the state');
});

test('same browser (cookie matches): connects with no extra page and clears the cookie', async () => {
  const { site, connected, start } = await setup();
  const { state, nonce } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: 'x=1; ao_gcal=' + nonce } });
  assert.match(r.text, /Calendar connected/);
  assert.equal(await connected(), 1);
  assert.match(r.headers.get('set-cookie') || '', /ao_gcal=;.*Max-Age=0/);
});

test('no cookie: a confirmation page names the business, connects nothing, and does not use the code', async () => {
  const { site, connected, start } = await setup('Sinclair Plumbing');
  const { state } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state);
  assert.equal(r.status, 200);
  assert.match(r.text, /Connect your calendar\?/);
  assert.match(r.text, /connect your Google Calendar to Sinclair Plumbing on Always Open\. Max will see when you are free and add visits to it\./);
  assert.match(r.text, /Only continue if Sinclair Plumbing is your business\./);
  assert.match(r.text, /Yes, connect it to Sinclair Plumbing/);
  assert.match(r.text, /No, this is not mine/);
  assert.match(r.text, /name="confirm" value="1"/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal(await connected(), 0);
  assert.equal(tokenCalls, 0, 'the code was not exchanged yet');
});

test('the confirm button connects, exchanging the code once; a second press or refresh says it was used', async () => {
  const { site, connected, start } = await setup();
  const { state } = await start();
  const form = { code: 'abc', state, confirm: '1' };
  const r = await site.call('/google/callback', { form });
  assert.match(r.text, /Calendar connected/);
  assert.equal(await connected(), 1); assert.equal(tokenCalls, 1);
  const again = await site.call('/google/callback', { form });
  assert.match(again.text, /That link was already used\. Start again from your app\./);
  assert.equal(tokenCalls, 1);
  // refreshing the same-browser callback is also a plain answer
  const s2 = await start();
  const hdr = { cookie: 'ao_gcal=' + s2.nonce };
  assert.match((await site.call('/google/callback?code=zzz&state=' + s2.state, { headers: hdr })).text, /Calendar connected/);
  assert.match((await site.call('/google/callback?code=zzz&state=' + s2.state, { headers: hdr })).text, /already used/);
  assert.equal(tokenCalls, 2);
});

test('a wrong nonce in the cookie gets the confirmation page, not a connect', async () => {
  const { site, connected, start } = await setup();
  const { state } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state, { headers: { cookie: 'ao_gcal=' + 'f'.repeat(32) } });
  assert.match(r.text, /Connect your calendar\?/);
  assert.equal(await connected(), 0);
});

test('a bad or old state is refused on GET and on POST; a POST without the confirm flag does nothing', async () => {
  const { site, connected, start, env } = await setup();
  const { state, nonce } = await start();
  const parts = state.split('.');
  const forged = [parts[0], parts[1], 'a'.repeat(32), parts[3]].join('.');
  for (const s of [forged, 'c1.123.deadbeef', 'garbage', '']) {
    const g = await site.call('/google/callback?code=abc&state=' + s, { headers: { cookie: 'ao_gcal=' + nonce } });
    assert.equal(g.status, 400); assert.match(g.text, /Link expired/);
    const p = await site.call('/google/callback', { form: { code: 'abc', state: s, confirm: '1' } });
    assert.equal(p.status, 400); assert.match(p.text, /Link expired/);
  }
  // an old one: properly signed two hours ago
  const old = String(Date.now() - 7200e3), n = 'b'.repeat(32);
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('sec'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('c1.' + old + '.' + n)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const oldState = 'c1.' + old + '.' + n + '.' + sig;
  assert.match((await site.call('/google/callback?code=abc&state=' + oldState, { headers: { cookie: 'ao_gcal=' + n } })).text, /Link expired/);
  assert.match((await site.call('/google/callback', { form: { code: 'abc', state: oldState, confirm: '1' } })).text, /Link expired/);
  const noflag = await site.call('/google/callback', { form: { code: 'abc', state } });
  assert.equal(noflag.status, 400);
  assert.equal(await connected(), 0); assert.equal(tokenCalls, 0); void env;
});

test('a business name with a script tag is escaped on the confirmation page', async () => {
  const { site, start } = await setup('<script>alert(1)</script> "Plumbing"');
  const { state } = await start();
  const r = await site.call('/google/callback?code=abc&state=' + state);
  assert.doesNotMatch(r.text, /<script>/);
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;Plumbing&quot;/);
});
