// Sealing: a secret the worker has to keep in the database is stored encrypted (AES-GCM), with a key made from one of
// the worker's own secrets (STRIPE_KEY for Stripe's, the app's own secret for a client's tokens), which never touch
// the database. So a copy of the database, a database tool, or other code that shares it reads nothing it can use.
// Nov 21, 2026 audit: Stripe's webhook signing secrets sat in billing_config in plain text.
// The purpose names what the secret is for and is part of the key, so one sealed value can't be passed off as another.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u => btoa(String.fromCharCode(...u));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyFor(env, purpose, from) {
  const secret = from === undefined ? env.STRIPE_KEY : from;
  if (!secret) throw new Error('no key to seal with');
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('always-open-seal-v1'), info: enc.encode(purpose) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// 'v1.<iv>.<ciphertext>', both base64. A new random iv each time, so sealing the same secret twice gives two values.
export async function seal(env, purpose, text, from) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env, purpose, from), enc.encode(String(text)));
  return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(ct));
}

// Throws when the value isn't sealed, was changed, or was sealed with another key (STRIPE_KEY was replaced since).
export async function open(env, purpose, sealed, from) {
  const [v, iv, ct, extra] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !ct || extra !== undefined) throw new Error('not a sealed value');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(env, purpose, from), unb64(ct));
  return dec.decode(pt);
}

// ---------- clients' tokens ----------
// A client's Google refresh token and Facebook Page token are sealed with a key made from that app's own secret
// (GOOGLE_CLIENT_SECRET, META_APP_SECRET), which lives only in the worker's secrets. A Page token is a bearer token,
// usable as is by whoever holds it; sealed, a copy of the database is no help without the app secret. Replacing an
// app secret leaves its sealed tokens unreadable: each owner connects again (the daily connection check asks them).
// Without the app secret a token stays as it was.
export const SEALED = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/;
export const TOKENS = [['gbp_tokens', 'refresh'], ['gcal_tokens', 'refresh'], ['meta_pages', 'page_token']];
const baseFor = (env, purpose) => (/^meta_/.test(purpose) ? env.META_APP_SECRET : env.GOOGLE_CLIENT_SECRET) || '';
export async function sealToken(env, purpose, text) {
  const base = baseFor(env, purpose);
  if (!base || text == null || text === '' || SEALED.test(String(text))) return text;
  return seal(env, purpose, text, base);
}
// The token itself, from what the table holds: plain text from before is given back as it is (sealTokens seals it
// within 10 minutes). Throws when it can't be opened (the app secret missing or replaced): to the caller, no token.
export async function openToken(env, purpose, stored) {
  if (!SEALED.test(String(stored || ''))) return stored;
  const base = baseFor(env, purpose);
  if (!base) throw new Error('no app secret to open the token with');
  return open(env, purpose, stored, base);
}
// Every 10 minutes (index.js): any token still in plain text is sealed where it lies. The update only lands if the row
// still holds the same plain token, so a reconnect in the same moment is never overwritten.
export async function sealTokens(env) {
  let n = 0;
  for (const [table, col] of TOKENS) {
    if (!baseFor(env, table + '.' + col)) continue;
    const rows = ((await env.DB.prepare('SELECT client_id, ' + col + ' AS t FROM ' + table + ' WHERE ' + col + " NOT LIKE 'v1.%' AND COALESCE(" + col + ", '') != ''").all().catch(() => ({}))).results) || [];
    for (const r of rows) {
      const sealed = await sealToken(env, table + '.' + col, r.t);
      if (sealed === r.t) continue;
      const u = await env.DB.prepare('UPDATE ' + table + ' SET ' + col + ' = ?1 WHERE client_id = ?2 AND ' + col + ' = ?3').bind(sealed, r.client_id, r.t).run();
      n += (u && u.meta && u.meta.changes) || 0;
    }
  }
  return n ? n + ' sealed' : 'all sealed';
}
// Facebook's appsecret_proof (HMAC-SHA256 of the token with the app secret): sent with every Page call, so once "Require
// App Secret" is on in the Meta app's settings, a Page token is useless without the app secret too.
export async function metaProof(env, token) {
  if (!env.META_APP_SECRET || !token) return '';
  const k = await crypto.subtle.importKey('raw', enc.encode(env.META_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
