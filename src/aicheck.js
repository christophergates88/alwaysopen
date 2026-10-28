// What assistants say about you (Growth and Pro): once a month the worker asks an assistant with live web search the two
// things a customer would ask: who it recommends for this kind of work in this town, and what it knows about the business
// (phone, hours, address, website). The answer is compared with what the business told us. Anything wrong (most often an
// old phone number or hours on some listing) goes on Christopher's HQ board to fix where it comes from, and the owner sees
// the month's result in the app. The check itself changes nothing anywhere.
const PER_RUN = 3;

let ready = false;
export async function ensureAiCheck(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_checks (client_id TEXT NOT NULL, month TEXT NOT NULL, at TEXT, data TEXT DEFAULT '{}', PRIMARY KEY (client_id, month))").run();
  ready = true;
}

const ph10 = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : ''; };
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(llc|inc|co|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();

export function promptFor(biz, kind, town) {
  return 'Answer the way you would answer a customer, using web search.\n' +
    '1. I need ' + (kind ? 'a ' + kind + ' business' : 'a business like ' + biz) + ' in ' + town + '. Which ones would you recommend? Name up to five, best first.\n' +
    '2. What can you tell me about "' + biz + '" in ' + town + '? Its phone number, hours, address and website, as you find them.\n' +
    'Reply with only this JSON: {"recommended": ["name", ...], "about": {"found": true|false, "phone": "", "hours": "", "address": "", "website": ""}, "sources": ["url", ...]}. Use "" for anything you could not find. Never guess.';
}

// Compare the answer with what we know. Returns { mentioned, rank, found, wrong: [{field, said, ours}], ok: [...] }.
export function compare(ans, ours) {
  const rec = (ans.recommended || []).map(x => String(x || '').slice(0, 80)).filter(Boolean).slice(0, 5);
  const me = norm(ours.business);
  const rank = rec.findIndex(n => { const a = norm(n); return a && me && (a === me || a.includes(me) || me.includes(a)); });
  const about = ans.about || {}, wrong = [], ok = [];
  const said = ph10(about.phone), known = (ours.phones || []).map(ph10).filter(Boolean);
  if (said && known.length) (known.includes(said) ? ok : wrong).push({ field: 'phone', said: about.phone, ours: known[0] });
  if (about.website && ours.website) {
    const host = u => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    (host(about.website) === host(ours.website) ? ok : wrong).push({ field: 'website', said: about.website, ours: ours.website });
  }
  if (about.address && ours.town) {
    const t = norm(String(ours.town).split(',')[0]);
    if (t && !norm(about.address).includes(t)) wrong.push({ field: 'address', said: about.address, ours: ours.town });
    else ok.push({ field: 'address', said: about.address });
  }
  if (about.hours) ok.push({ field: 'hours', said: String(about.hours).slice(0, 160) });
  return { mentioned: rank > -1, rank: rank + 1, recommended: rec, found: !!about.found, wrong, ok };
}

async function ask(env, biz, kind, town) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const st = (/,\s*([A-Za-z]{2})\s*$/.exec(town || '') || [])[1];
  const body = { model: env.INSIGHT_MODEL || 'claude-haiku-5-5', max_tokens: 1200,
    messages: [{ role: 'user', content: promptFor(biz, kind, town) }],
    tools: [Object.assign({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }, town ? { user_location: Object.assign({ type: 'approximate', city: String(town).split(',')[0].trim(), country: 'US', timezone: 'America/New_York' }, st ? { region: st.toUpperCase() } : {}) } : {})] };
  const headers = Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace': env.ANTHROPIC_WORKSPACE } : {});
  let r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  let j = await r.json().catch(() => ({}));
  let live = true;
  if (!r.ok && /web search/i.test(String((j.error || {}).message || ''))) {   // search turned off for the account: ask without it
    delete body.tools; live = false;
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) { try { await (await import('./funding.js')).claudeProblem(env, (j.error && j.error.message) || ''); } catch (e) {} return null; }
  const text = (j.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  let ans = null; try { ans = m ? JSON.parse(m[0]) : null; } catch (e) { ans = null; }
  if (!ans) return null;
  ans.live = live;
  return ans;
}

async function hasTown(env, cid) {
  try {
    const r = await env.DB.prepare("SELECT (SELECT b.town FROM billing b WHERE b.client_id = ?1) AS b, (SELECT v.town FROM voice_lines v WHERE v.client_id = ?1 LIMIT 1) AS v, (SELECT r.form FROM a2p_reg r WHERE r.client_id = ?1) AS f").bind(cid).first();
    let f = {}; try { f = JSON.parse((r && r.f) || '{}'); } catch (e) {}
    return !!(r && (r.b || r.v || f.city));
  } catch (e) { return false; }
}

export async function checkOne(env, cid, month) {
  await ensureAiCheck(env);
  const c = await env.DB.prepare("SELECT c.client_id, c.business, c.phone, b.phone AS bphone, b.town AS btown, (SELECT v.town FROM voice_lines v WHERE v.client_id = c.client_id LIMIT 1) AS vtown, (SELECT v.industry FROM voice_lines v WHERE v.client_id = c.client_id LIMIT 1) AS kind, (SELECT r.form FROM a2p_reg r WHERE r.client_id = c.client_id) AS reg FROM app_clients c LEFT JOIN billing b ON b.client_id = c.client_id WHERE c.client_id = ?1").bind(cid).first().catch(() => null);
  if (!c || !c.business) return null;
  let reg = {}; try { reg = JSON.parse(c.reg || '{}'); } catch (e) {}
  const town = c.btown || c.vtown || (reg.city ? reg.city + ', ' + (reg.state || '') : '');
  if (!town) return null;
  const ans = await ask(env, c.business, c.kind || '', town);
  if (!ans) return null;
  const res = compare(ans, { business: c.business, phones: [c.phone, c.bphone], website: reg.website || '', town });
  res.live = ans.live; res.sources = (ans.sources || []).filter(u => /^https:\/\//.test(u)).slice(0, 5);
  await env.DB.prepare('INSERT OR REPLACE INTO ai_checks (client_id, month, at, data) VALUES (?1, ?2, ?3, ?4)').bind(cid, month, new Date().toISOString(), JSON.stringify(res)).run();
  return res;
}

// From the 10-minute cron: a few clients at a time, once per calendar month each.
export async function aiCheckCron(env, at) {
  if (!env.ANTHROPIC_API_KEY) return { skipped: true };
  await ensureAiCheck(env);
  const month = new Date(at || Date.now()).toISOString().slice(0, 7);
  const { DEMO_ID } = await import('./demo.js');
  // Due: not checked this month, or a failed try more than a day old (at most 3 tries a month).
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const due = ((await env.DB.prepare("SELECT c.client_id, a.data FROM app_clients c LEFT JOIN ai_checks a ON a.client_id = c.client_id AND a.month = ?1 WHERE c.active = 1 AND c.tier IN ('Growth', 'Pro') AND c.client_id != ?2 AND (a.client_id IS NULL OR (a.data LIKE '{\"error\"%' AND a.at < ?4 AND COALESCE(json_extract(a.data, '$.tries'), 1) < 3)) LIMIT ?3").bind(month, DEMO_ID, PER_RUN, dayAgo).all()).results) || [];
  let n = 0;
  for (const r of due) {
    const res = await checkOne(env, r.client_id, month).catch(() => null);
    if (!res) {
      let prev = {}; try { prev = JSON.parse(r.data || '{}'); } catch (e) {}
      const why = (await hasTown(env, r.client_id)) ? 'the assistant did not answer' : 'no town on file';
      await env.DB.prepare('INSERT OR REPLACE INTO ai_checks (client_id, month, at, data) VALUES (?1, ?2, ?3, ?4)').bind(r.client_id, month, new Date().toISOString(), JSON.stringify({ error: why, tries: (+prev.tries || 0) + 1 })).run();
    }
    else n++;
  }
  return { checked: n };
}

// For the app.
export async function aiCheckState(env, cid) {
  await ensureAiCheck(env);
  const r = await env.DB.prepare('SELECT month, at, data FROM ai_checks WHERE client_id = ?1 ORDER BY month DESC LIMIT 1').bind(cid).first().catch(() => null);
  if (!r) return null;
  let d = {}; try { d = JSON.parse(r.data || '{}'); } catch (e) {}
  if (d.error) return null;
  const line = d.mentioned ? 'An assistant asked for your kind of business named you ' + (d.rank === 1 ? 'first.' : 'number ' + d.rank + '.') : 'An assistant asked for your kind of business did not name you yet.';
  return { month: r.month, at: r.at, mentioned: !!d.mentioned, rank: d.rank || 0, line, wrong: (d.wrong || []).map(w => ({ field: w.field, said: String(w.said || '').slice(0, 120) })), fixing: (d.wrong || []).length > 0 };
}

// For the HQ board: wrong details to fix on the listings they come from.
export async function aiCheckBoard(env) {
  try {
    await ensureAiCheck(env);
    const month = new Date().toISOString().slice(0, 7);
    const rows = ((await env.DB.prepare("SELECT a.client_id, a.data, COALESCE(c.business, a.client_id) AS biz FROM ai_checks a LEFT JOIN app_clients c ON c.client_id = a.client_id WHERE a.month = ?1 AND a.data LIKE '%\"wrong\":[{%'").bind(month).all()).results) || [];
    return rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch (e) {} const w = d.wrong || [];
      return { key: 'aicheck:' + r.client_id + ':' + month, group: 'What assistants say: details to fix', title: r.biz, detail: w.map(x => x.field + ' shows "' + String(x.said).slice(0, 60) + '"' + (x.ours ? ' (ours: ' + x.ours + ')' : '')).join('; ') + '. Fix it on the listing it comes from' + ((d.sources || []).length ? ': ' + d.sources[0] : '') }; });
  } catch (e) { return []; }
}
