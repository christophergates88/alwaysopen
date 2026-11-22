// Which Twilio account holds a business's numbers (Nov 22, 2026). Twilio's own guide for resellers (ISVs) maps each
// customer to a sub-account of their own: its number, its texting registration (profile, brand, campaign, Messaging
// Service) and its usage live there, so one business's carrier trouble, spam flags or suspension never reaches the
// others or Always Open's own line, and its costs can be read on their own.
//
// With TWILIO_SUBACCOUNTS = "on" (wrangler.toml), a new client gets its sub-account when its line is first set up
// (provision.js). Businesses set up before stay in the main account, exactly as they are: nothing moves a live number.
// Off (the default), every business is in the main account, as before.
//
// How the sub-accounts are reached, from Twilio's documents: the main account's own key works on a sub-account's
// 2010-04-01 resources (/Accounts/<sub>/...); the newer APIs (Trust Hub, Messaging) take the sub-account's own SID and
// key, which is fetched from Twilio when needed and kept only in memory, never in the database. Webhooks for a
// sub-account's numbers are signed with the sub-account's key (voice.js sigTokens).
export const API = 'https://api.twilio.com/2010-04-01/Accounts/';
export const subaccountsOn = env => String((env && env.TWILIO_SUBACCOUNTS) || '').toLowerCase() === 'on';
export const parentAuth = env => 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
const SID = /^AC[0-9a-f]{32}$/;

const made = new WeakSet();
export async function ensureTw(env) {
  if (!env.DB || made.has(env.DB)) return;
  // If the database can't answer, the lookups below find nothing and every business uses the main account, as before.
  try { await env.DB.prepare("CREATE TABLE IF NOT EXISTS tw_accounts (client_id TEXT PRIMARY KEY, sid TEXT NOT NULL UNIQUE, created TEXT, closed TEXT DEFAULT '')").run(); made.add(env.DB); }
  catch (e) { /* the main account then */ }
}

// The account that holds this business's numbers: its own sub-account, or the main account.
export async function accountOf(env, cid) {
  if (!cid || !env.DB) return env.TWILIO_ACCOUNT_SID;
  await ensureTw(env);
  const r = await env.DB.prepare("SELECT sid FROM tw_accounts WHERE client_id = ?1 AND closed = ''").bind(cid).first().catch(() => null);
  return r && SID.test(r.sid) ? r.sid : env.TWILIO_ACCOUNT_SID;
}
// The account that holds a number (any of our lines).
export async function accountOfNumber(env, e164) {
  if (!env.DB) return env.TWILIO_ACCOUNT_SID;
  const l = await env.DB.prepare('SELECT client_id FROM voice_lines WHERE number = ?1 LIMIT 1').bind(String(e164 || '')).first().catch(() => null);
  return accountOf(env, l && l.client_id);
}
export async function baseOf(env, cid) { return API + await accountOf(env, cid); }
// Every account we use: the main one first, then each open sub-account (for the sweeps and checks that read all texts).
export async function allAccounts(env) {
  await ensureTw(env);
  const rs = ((await env.DB.prepare("SELECT sid FROM tw_accounts WHERE closed = ''").all().catch(() => ({ results: [] }))).results) || [];
  return [env.TWILIO_ACCOUNT_SID, ...rs.map(r => r.sid).filter(s => SID.test(s) && s !== env.TWILIO_ACCOUNT_SID)];
}
export async function isOurSub(env, sid) {
  if (!SID.test(sid || '') || sid === env.TWILIO_ACCOUNT_SID) return false;
  await ensureTw(env);
  return !!(await env.DB.prepare('SELECT 1 AS x FROM tw_accounts WHERE sid = ?1').bind(sid).first().catch(() => null));
}

// A sub-account's own key: asked of Twilio with the main account's key, kept in memory for 10 minutes.
const keys = new Map();
export async function subKey(env, sid, f) {
  const k = keys.get(sid);
  if (k && Date.now() - k.at < 600e3) return k.token;
  const r = await (f || fetch)(API + sid + '.json', { headers: { authorization: parentAuth(env) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.auth_token) throw new Error('Twilio would not give the sub-account’s key (' + r.status + ')');
  keys.set(sid, { token: j.auth_token, at: Date.now() });
  return j.auth_token;
}
export function forgetKeys() { keys.clear(); }
// The authorization for the newer APIs (Trust Hub, Messaging) for one account.
export async function authFor(env, sid, f) {
  if (!sid || sid === env.TWILIO_ACCOUNT_SID) return parentAuth(env);
  return 'Basic ' + btoa(sid + ':' + await subKey(env, sid, f));
}
// The keys a webhook may be signed with: the main account's, and the sub-account's when it names one of ours.
export async function sigTokens(env, accountSid) {
  const out = [env.TWILIO_AUTH_TOKEN];
  if (await isOurSub(env, accountSid)) { try { out.push(await subKey(env, accountSid)); } catch (e) { /* only the main key then */ } }
  return out;
}

// The business's own sub-account, made the first time it's needed (only with TWILIO_SUBACCOUNTS on). If Twilio can't
// make one right then, the line is set up in the main account as before: a sub-account is never a reason a new client
// waits for Max.
export async function subaccountFor(env, cid, business, f) {
  const have = await accountOf(env, cid);
  if (have !== env.TWILIO_ACCOUNT_SID || !subaccountsOn(env) || !cid) return have;
  const name = ('Always Open client ' + cid + ': ' + String(business || '')).replace(/[\u0000-\u001f]/g, ' ').slice(0, 64);
  try {
    const r = await (f || fetch)(API.replace(/\/$/, '') + '.json', { method: 'POST', headers: { authorization: parentAuth(env), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ FriendlyName: name }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !SID.test(j.sid || '')) throw new Error(String(j.message || ('Twilio answered ' + r.status)).slice(0, 160));
    await env.DB.prepare('INSERT OR IGNORE INTO tw_accounts (client_id, sid, created) VALUES (?1, ?2, ?3)').bind(cid, j.sid, new Date().toISOString()).run();
    if (j.auth_token) keys.set(j.sid, { token: j.auth_token, at: Date.now() });
    return await accountOf(env, cid);
  } catch (e) {
    try { await (await import('./app.js')).opsPing(env, 'Always Open: no sub-account for a new client', 'For ' + (business || cid) + ': ' + String(e.message || e).slice(0, 160) + '. Their line is set up in the main account instead, which works the same.', 'default', 'warning'); } catch (x) { /* only a note */ }
    return env.TWILIO_ACCOUNT_SID;
  }
}

// For the tools that start from a call's id alone (voicemail, the ops board): the account that has the call.
// Tries the main account first, then the sub-accounts, and remembers the answer.
const calls = new Map();
export function noteCall(callSid, acct) { if (callSid && SID.test(acct || '')) { calls.set(callSid, acct); if (calls.size > 5000) calls.delete(calls.keys().next().value); } }
export async function accountOfCall(env, callSid, f) {
  if (calls.has(callSid)) return calls.get(callSid);
  const all = await allAccounts(env);
  if (all.length === 1) return all[0];
  for (const a of all) {
    const r = await (f || fetch)(API + a + '/Calls/' + callSid + '.json', { headers: { authorization: parentAuth(env) } }).catch(() => null);
    if (r && r.ok) { noteCall(callSid, a); return a; }
  }
  return env.TWILIO_ACCOUNT_SID;
}
