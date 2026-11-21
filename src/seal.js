// Sealing: a secret the worker has to keep in the database is stored encrypted (AES-GCM), with a key made from
// STRIPE_KEY, which lives only in the worker's own secrets and never in the database. So a copy of the database, a
// database tool, or other code that shares the database reads nothing it can use.
// Nov 21, 2026 audit: Stripe's webhook signing secrets sat in billing_config in plain text.
// The purpose names what the secret is for and is part of the key, so one sealed value can't be passed off as another.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u => btoa(String.fromCharCode(...u));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyFor(env, purpose) {
  if (!env.STRIPE_KEY) throw new Error('no key to seal with');
  const base = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_KEY), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('always-open-seal-v1'), info: enc.encode(purpose) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// 'v1.<iv>.<ciphertext>', both base64. A new random iv each time, so sealing the same secret twice gives two values.
export async function seal(env, purpose, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env, purpose), enc.encode(String(text)));
  return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(ct));
}

// Throws when the value isn't sealed, was changed, or was sealed with another key (STRIPE_KEY was replaced since).
export async function open(env, purpose, sealed) {
  const [v, iv, ct, extra] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !ct || extra !== undefined) throw new Error('not a sealed value');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(env, purpose), unb64(ct));
  return dec.decode(pt);
}
