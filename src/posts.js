// Posts from job photos, drafted on their own. An owner sends a photo from the app (with a note or without); within ten
// minutes Claude looks at the photo and writes the post, and it lands on the owner's approval list like every other draft:
// "A post is ready for your OK". Approved, it goes to Google (gbp.js) and to Facebook and Instagram (extras.js) once
// those are on; with Full Max's "Posts from your photos" category on, it goes without the tap (fullmax.js).
// A photo that cannot be read gets two more tries on later passes, then is left alone with a note on the ops board.
// Never for regulated businesses (their posts come from approved wording in HQ) and never for the demo client.
const SITE = 'https://alwaysopenoffice.com';
const TRIES = 3;
const ready = new WeakSet();
async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS photo_drafts (photo_id TEXT PRIMARY KEY, tries INTEGER DEFAULT 0, last TEXT DEFAULT '', note TEXT DEFAULT '')").run();
  ready.add(env.DB);
}
function tok(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map(x => a[x % a.length]).join(''); }
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
const PHONE = p => /^\+1\d{10}$/.test(p || '') ? '(' + p.slice(2, 5) + ') ' + p.slice(5, 8) + '-' + p.slice(8) : '';

const SYS = 'You write the short post a small business puts on its own Google profile, Facebook Page and Instagram with a photo of its work. Return only the post text. ' +
  'Two or three plain sentences, warm, specific to what is in the photo, written as the business ("we"). Say what the work was and one thing that mattered to the customer. ' +
  'If the owner wrote a note, it is the truth of the job: build on it and never contradict it. Never name the customer, the street or the price unless the note gives them. No emoji, no hashtags, no exclamation marks, no links, and never mention AI or Always Open. ' +
  'End with one short invitation to call, using the phone number if one is given (otherwise "Give us a call."). Nothing about the photo being a photo.';

// What Claude says about one photo. Returns '' when it cannot answer.
export async function writePost(env, c, photo) {
  if (!env.ANTHROPIC_API_KEY) return '';
  const bytes = photo.data instanceof ArrayBuffer ? new Uint8Array(photo.data) : new Uint8Array(photo.data || []);
  if (!bytes.length) return '';
  const notes = 'Business: ' + (c.business || 'the business') + (c.industry ? ' (' + c.industry + ')' : '') + (c.town ? ', ' + c.town : '') + '\nPhone: ' + (PHONE(c.phone) || '(none)') + '\nOwner’s note: ' + (photo.note ? String(photo.note).slice(0, 300) : '(none)') + (photo.by && photo.by !== 'Owner' ? '\nSent by: ' + photo.by : '');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: Object.assign({ authorization: 'Bearer ' + env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, env.ANTHROPIC_WORKSPACE ? { 'anthropic-workspace': env.ANTHROPIC_WORKSPACE } : {}),
    body: JSON.stringify({ model: env.SOCIAL_MODEL || 'claude-sonnet-5-5', max_tokens: 300, system: SYS,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|webp)$/.test(photo.mime || '') ? photo.mime : 'image/jpeg', data: b64(bytes) } }, { type: 'text', text: notes }] }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { try { await (await import('./funding.js')).claudeProblem(env, (j.error && j.error.message) || ''); } catch (e) {} throw new Error('Claude answered ' + r.status + ': ' + String((j.error && j.error.message) || '').slice(0, 120)); }
  const t = (j.content || []).map(x => x.text || '').join('').trim().replace(/^"|"$/g, '');
  return t.length >= 30 && t.length <= 700 && !/#|https?:\/\/|[\u{1F300}-\u{1FAFF}]/u.test(t) ? t : '';
}

// Every ten minutes: new photos older than a minute (so the app's own note has arrived), five per pass.
export async function photoPostCron(env, now, h) {
  now = now || Date.now();
  await ensure(env);
  const rows = ((await env.DB.prepare("SELECT p.id, p.client_id, p.at, p.note, p.by, p.mime, c.business, c.phone, c.regulated, c.active FROM app_photos p JOIN app_clients c ON c.client_id = p.client_id LEFT JOIN photo_drafts d ON d.photo_id = p.id WHERE p.status = 'new' AND p.at < ?1 AND p.client_id != 'demo-plumbing' AND COALESCE(d.tries, 0) < ?2 ORDER BY p.at LIMIT 5")
    .bind(new Date(now - 60e3).toISOString(), TRIES).all()).results) || [];
  let made = 0, held = 0, failed = 0;
  for (const p of rows) {
    if (+p.regulated || !+p.active) { await env.DB.prepare("UPDATE app_photos SET status = 'held' WHERE id = ?1").bind(p.id).run(); held++; continue; }
    const line = await env.DB.prepare('SELECT industry, town FROM voice_lines WHERE client_id = ?1 ORDER BY updated DESC LIMIT 1').bind(p.client_id).first().catch(() => null);
    const full = await env.DB.prepare('SELECT data FROM app_photos WHERE id = ?1').bind(p.id).first();
    const c = { client_id: p.client_id, business: p.business, phone: p.phone, industry: (line && line.industry) || '', town: (line && line.town) || '' };
    let text = '';
    try { text = await (h && h.write ? h.write(env, c, Object.assign({}, p, { data: full && full.data })) : writePost(env, c, Object.assign({}, p, { data: full && full.data }))); } catch (e) { text = ''; await noteTry(env, p.id, now, String((e && e.message) || e)); failed++; continue; }
    if (!text) { await noteTry(env, p.id, now, 'no usable text'); failed++; continue; }
    const ts = new Date(now).toISOString(), id = 'ph' + tok(14);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO app_items (id, client_id, kind, title, context, stars, text, status, hq_synced, checked, created, updated, notified, photo) VALUES (?1, ?2, 'post', ?3, ?4, 0, ?5, 'pending', 0, 0, ?6, ?6, 0, ?7)")
        .bind(id, p.client_id, 'From ' + (p.by && p.by !== 'Owner' ? p.by + '’s' : 'your') + ' photo', p.note ? 'Your note: ' + String(p.note).slice(0, 300) : 'Posted with the photo you sent', text, ts, SITE + '/p/' + p.id),
      env.DB.prepare("UPDATE app_photos SET status = 'drafted' WHERE id = ?1").bind(p.id)
    ]);
    made++;
  }
  // A photo that has used up its tries gets one note to the ops board, once.
  const stuck = ((await env.DB.prepare("SELECT d.photo_id, d.note, p.client_id FROM photo_drafts d JOIN app_photos p ON p.id = d.photo_id WHERE d.tries >= ?1 AND p.status = 'new'").bind(TRIES).all()).results) || [];
  for (const s of stuck) { await env.DB.prepare("UPDATE app_photos SET status = 'failed' WHERE id = ?1").bind(s.photo_id).run(); if (h && h.alert) await h.alert('photo-post', s.client_id, 'A photo from ' + s.client_id + ' could not be turned into a post after ' + TRIES + ' tries (' + s.note + '). Write it by hand from ' + SITE + '/p/' + s.photo_id + '.'); }
  return { made, held, failed, stuck: stuck.length };
}
async function noteTry(env, id, now, why) {
  await env.DB.prepare("INSERT INTO photo_drafts (photo_id, tries, last, note) VALUES (?1, 1, ?2, ?3) ON CONFLICT(photo_id) DO UPDATE SET tries = photo_drafts.tries + 1, last = excluded.last, note = excluded.note").bind(id, new Date(now).toISOString(), String(why).slice(0, 200)).run();
}
