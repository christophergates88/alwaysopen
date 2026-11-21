// Clients' Google refresh tokens and Facebook Page tokens are kept sealed (with the app's own secret), and Page calls carry
// appsecret_proof (Nov 21, 2026 audit: they sat in the shared database in plain text, where a Page token alone is
// enough to post as the client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const S = await import('../src/seal.js');
const G = await import('../src/gbp.js');
const X = await import('../src/extras.js');

function setup(extra) {
  const world = new H.World(), DB = H.makeDB(), env = Object.assign(H.makeEnv(world, DB), { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', META_APP_SECRET: 'appsecret' }, extra || {});
  H.installFetch(world, env);
  // Google's token endpoint and Facebook's Graph, which the harness doesn't fake: record what was sent
  const inner = globalThis.fetch, seen = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/oauth2\.googleapis\.com\/token/.test(url)) {
      const b = new URLSearchParams(String((init && init.body) || ''));
      seen.push({ google: b.get('refresh_token') });
      return b.get('refresh_token') === '1//good-refresh' ? new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 })) : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    if (/graph\.facebook\.com/.test(url)) { seen.push({ graph: url, body: String((init && init.body) || '') }); return new Response(JSON.stringify({ id: 'p_1', message_id: 'm_1' })); }
    return inner(input, init);
  };
  return { world, DB, env, seen, done: () => { globalThis.fetch = inner; } };
}
const one = (DB, sql, ...a) => DB.prepare(sql).bind(...a).first();

test('a token is sealed with its app\'s secret and opens again; without the secret nothing changes', async () => {
  const env = { GOOGLE_CLIENT_SECRET: 'gsecret', META_APP_SECRET: 'msecret' };
  const s = await S.sealToken(env, 'gbp_tokens.refresh', '1//abc');
  assert.match(s, S.SEALED);
  assert.ok(!s.includes('abc'));
  assert.equal(await S.openToken(env, 'gbp_tokens.refresh', s), '1//abc');
  assert.equal(await S.sealToken(env, 'gbp_tokens.refresh', s), s, 'already sealed: left as it is');
  assert.equal(await S.openToken(env, 'gbp_tokens.refresh', '1//plain'), '1//plain', 'plain text from before still reads');
  await assert.rejects(S.openToken({ GOOGLE_CLIENT_SECRET: 'another' }, 'gbp_tokens.refresh', s), 'another secret');
  await assert.rejects(S.openToken({}, 'gbp_tokens.refresh', s), 'no secret');
  await assert.rejects(S.openToken(env, 'gcal_tokens.refresh', s), 'sealed for one table, not another');
  const m = await S.sealToken(env, 'meta_pages.page_token', 'EAAx');
  await assert.rejects(S.openToken({ GOOGLE_CLIENT_SECRET: 'gsecret', META_APP_SECRET: 'gsecret' }, 'meta_pages.page_token', m), 'a Page token needs the Meta secret');
  assert.equal(await S.openToken(env, 'meta_pages.page_token', m), 'EAAx');
  assert.equal(await S.sealToken({}, 'gbp_tokens.refresh', '1//abc'), '1//abc', 'no app secret: kept as before');
});

test('a Google Business Profile sign-in is saved sealed and still works', async () => {
  const t = setup();
  try {
    await G.saveRefresh(t.env, 'c1', '1//good-refresh');
    const row = await one(t.DB, 'SELECT refresh FROM gbp_tokens WHERE client_id = ?1', 'c1');
    assert.match(row.refresh, S.SEALED);
    assert.equal(await G.accessToken(t.env, 'c1'), 'ya29.x');
    assert.deepEqual(t.seen.at(-1), { google: '1//good-refresh' }, 'Google got the real token, opened');
    assert.equal((await G.tryRefresh(t.env, 'c1')).ok, true);
    // the app secret replaced since: the saved sign-in can't be opened, so it reads as refused
    const t2 = Object.assign({}, t.env, { GOOGLE_CLIENT_SECRET: 'replaced' });
    assert.equal((await G.tryRefresh(t2, 'c1')).ok, false);
  } finally { t.done(); }
});

test('tokens kept in plain text before are sealed where they lie, and only those', async () => {
  const t = setup();
  try {
    await G.saveRefresh(t.env, 'sealed-one', '1//good-refresh');
    const before = (await one(t.DB, "SELECT refresh FROM gbp_tokens WHERE client_id = 'sealed-one'")).refresh;
    await t.DB.prepare("INSERT OR REPLACE INTO gbp_tokens (client_id, refresh, connected_at) VALUES ('old', '1//good-refresh', '2026-11-01')").run();
    await X.ensureMeta(t.env);
    await t.DB.prepare("INSERT OR REPLACE INTO meta_pages (client_id, page_id, page_name, page_token, ig_id, connected_at) VALUES ('old', 'pg1', 'Old Page', 'EAAplain', '', '2026-11-01')").run();
    assert.equal(await S.sealTokens(t.env), '2 sealed');
    assert.match((await one(t.DB, "SELECT refresh FROM gbp_tokens WHERE client_id = 'old'")).refresh, S.SEALED);
    assert.match((await one(t.DB, "SELECT page_token FROM meta_pages WHERE client_id = 'old'")).page_token, S.SEALED);
    assert.equal((await one(t.DB, "SELECT refresh FROM gbp_tokens WHERE client_id = 'sealed-one'")).refresh, before, 'a sealed one is left alone');
    assert.equal(await S.sealTokens(t.env), 'all sealed');
    assert.equal(await G.accessToken(t.env, 'old'), 'ya29.x', 'still works once sealed');
    assert.equal(await S.sealTokens(Object.assign({}, t.env, { GOOGLE_CLIENT_SECRET: '', META_APP_SECRET: '' })), 'all sealed', 'no app secrets: nothing to seal with, nothing touched');
  } finally { t.done(); }
});

test('a Facebook Page token is opened for each call and sent with its appsecret_proof', async () => {
  const t = setup();
  try {
    await X.ensureMeta(t.env);
    const sealed = await S.sealToken(t.env, 'meta_pages.page_token', 'EAApage');
    await t.DB.prepare("INSERT OR REPLACE INTO meta_pages (client_id, page_id, page_name, page_token, ig_id, connected_at) VALUES ('c1', 'pg1', 'Page', ?1, '', '2026-11-21')").bind(sealed).run();
    const pg = await X.metaPage(t.env, 'client_id', 'c1');
    assert.equal(pg.page_token, 'EAApage');
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('appsecret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('EAApage')))].map(b => b.toString(16).padStart(2, '0')).join('');
    assert.equal(pg.proof, want);
    assert.equal(X.metaAuth(pg), 'access_token=EAApage&appsecret_proof=' + want);
    assert.equal((await X.metaPage(t.env, 'page_id', 'pg1')).client_id, 'c1');
    assert.equal(await X.metaPage(Object.assign({}, t.env, { META_APP_SECRET: 'reset' }), 'client_id', 'c1'), null, 'can’t be opened: as if not connected');
    assert.equal(await X.metaPage(t.env, 'client_id', 'nobody'), null);
  } finally { t.done(); }
});
