// Speed to lead. The moment someone asks for the free audit on the website, the site looks their business up on Google
// (audit.js), and emails them the audit within a minute: their grade, the three things we would fix first, what we
// would do for a business like theirs, a sample monthly page, and how to start. Christopher still gets the push and the
// email about the lead; this just means nobody waits two days for the first answer.
//
// Then two short follow-ups if they don't sign up: day 2 and day 6, weekday business hours Eastern, and only to an
// address that has shown it is real: someone clicked a link in our email (a reply marks the lead from Gmail and ends the
// follow-ups anyway). Anyone can type any address into the form, so a stranger's address gets the one audit at most.
// They stop the moment the person signs up, replies (the Always Open check marks that from Gmail), taps the stop link, or
// Christopher marks the lead handled. Every email carries the stop link and the business's postal address.
//
// Guardrails on the audit email itself: one per address in 30 days (gmail dots and +tags count as the same address),
// three a day to requests from one network, 80 a day in all, never to an address that asked us to stop (mail_suppress,
// checked before every marketing email), and what they typed for their business stays out of the subject line.
//
// Google's terms: the audit is looked up fresh for each email and only our own grade and words are kept (leads.grade,
// leads.top, leads.fixes), plus Google's place ID, which may be stored.
import { runAudit } from './audit.js';
import { pitchFor, topThree } from './letter.js';

const SITE = 'https://alwaysopenoffice.com';
const MAX = '(706) 460-2226';
const FROM = { email: 'hello@alwaysopenoffice.com', name: 'Always Open' };
const REPLY_TO = 'hello@alwaysopenoffice.com';
const DAY = 864e5;
const PER_DAY = 80;                      // audit emails in any 24 hours, whatever happens
const SAME_ADDRESS_DAYS = 30;            // one audit email per address per 30 days
const NET_PER_DAY = 3;                   // audit emails a day for requests from one network (a /24, or a /48 for IPv6)
const POSTS_PER_HOUR = 6;                // posts to the audit pages from one sender
const ENGAGED_AFTER = 2 * 60e3;          // a click within two minutes of sending is a mail scanner, not a person
const FU1_AFTER = 44 * 3600e3, FU2_AFTER = 5.8 * 24 * 3600e3, FU_GAP = 3 * 24 * 3600e3, FU_STALE = 21 * 24 * 3600e3;
const SEND_HOURS = [9, 18];              // Eastern, Monday to Friday, for follow-ups

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const one = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const firstName = n => one(n).split(' ')[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30);
const PLANS = ['Starter', 'Growth', 'Pro'];
const planOf = p => PLANS.find(x => new RegExp('^' + x, 'i').test(String(p || ''))) || '';
const startLink = p => SITE + '/start' + (planOf(p) ? '?plan=' + planOf(p) : '');
const iso = t => new Date(t).toISOString();

// The one email check, for the website form, the audit page and every send: a name, an @, and a domain whose last part
// is two or more letters ("joe@gmail.c" fails here, so it never reaches the send queue).
const EMAIL_RE = /^[^\s@<>"(),;:\\\[\]]{1,64}@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,24}$/u;
export function validEmail(s) { const e = one(s); return e.length <= 120 && EMAIL_RE.test(e); }
// The same mailbox, however it is spelled: lowercase, no +tag, and no dots for Gmail.
export function emailKey(s) {
  const e = one(s).toLowerCase(), at = e.lastIndexOf('@');
  if (at < 1) return e;
  let user = e.slice(0, at).replace(/\+.*$/, ''), dom = e.slice(at + 1);
  if (dom === 'googlemail.com') dom = 'gmail.com';
  if (dom === 'gmail.com') user = user.replace(/\./g, '');
  return user + '@' + dom;
}
// The network a request came from: the first three parts of an IPv4 address, the first three groups of an IPv6 one.
export function netOf(ip) {
  const s = one(ip);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').slice(0, 3).join('.');
  if (s.includes(':')) return s.toLowerCase().split(':').slice(0, 3).join(':');
  return s;
}
// What someone typed for their business, shown as plain quoted text: one line, short, with no links and no phone numbers.
function plain(s) {
  return one(s).replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ').replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|info|biz|xyz|io|co|us|app|site|online|link|click|top|shop|store|me|ly|example)\b/gi, ' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, ' ').replace(/[<>"“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const ready = new WeakSet();
export async function ensureLeadMail(env) {
  if (ready.has(env.DB)) return;
  for (const col of ['audit', 'audit_at', 'grade', 'top', 'fu1_at', 'fu2_at', 'stop', 'stop_at', 'token', 'views', 'audit_tries', 'email_key', 'net_hash', 'engaged', 'fixes', 'copy_at', 'callme_at', 'stop_k', 'place_id']) {
    try { await env.DB.prepare('ALTER TABLE leads ADD COLUMN ' + col + ' TEXT').run(); } catch (e) { /* already there */ }
  }
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mail_suppress (key TEXT PRIMARY KEY, at TEXT, why TEXT DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS lead_keys (k TEXT PRIMARY KEY, v TEXT, at TEXT)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS audit_sends (key TEXT, net TEXT DEFAULT '', at TEXT, lead_id INTEGER, kind TEXT DEFAULT '')"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS audit_sends_key ON audit_sends (key, at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS audit_posts (ip TEXT, at TEXT, kind TEXT)')
  ]);
  ready.add(env.DB);
  try { await keepOldStopLinks(env); } catch (e) { /* tried again on the next start */ }
}

// ---------- signatures ----------
// Links in our emails (stop, click-through) and the form's start time are signed with a secret made once and kept in
// D1 (lead_keys), so rotating the ops key (LEADS_KEY) never breaks a link already sent.
const secrets = new WeakMap();
async function secret(env) {
  if (secrets.has(env.DB)) return secrets.get(env.DB);
  await ensureLeadMail(env);
  const get = async () => { const r = await env.DB.prepare("SELECT v FROM lead_keys WHERE k = 'mail'").first().catch(() => null); return r && r.v; };
  let v = await get();
  if (!v) {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    await env.DB.prepare("INSERT OR IGNORE INTO lead_keys (k, v, at) VALUES ('mail', ?1, ?2)").bind([...b].map(x => x.toString(16).padStart(2, '0')).join(''), iso(Date.now())).run();
    v = await get();
  }
  secrets.set(env.DB, v);
  return v;
}
const hmacKey = keyText => crypto.subtle.importKey('raw', new TextEncoder().encode(String(keyText)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
async function signWith(key, msg) {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  return [...mac.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const hmac = async (keyText, msg) => signWith(await hmacKey(keyText), msg);
const sig = async (env, msg) => hmac(await secret(env), msg);
// Stop links sent before the secret existed were signed with the ops key. They still work: checked against it, and
// each one written down once (leads.stop_k) so they keep working after the ops key changes.
const legacyKeyText = env => env.LEADS_KEY || env.IP_SALT || 'always-open';
const legacySig = (env, id) => hmac(legacyKeyText(env), 'stop:' + id);
async function keepOldStopLinks(env) {
  if (await env.DB.prepare("SELECT v FROM lead_keys WHERE k = 'old-stop-links'").first().catch(() => null)) return;
  const rows = ((await env.DB.prepare("SELECT id FROM leads WHERE email LIKE '%@%' AND (stop_k IS NULL OR stop_k = '')").all()).results) || [];
  const key = await hmacKey(legacyKeyText(env)), st = [];
  for (const r of rows) st.push(env.DB.prepare('UPDATE leads SET stop_k = ?1 WHERE id = ?2').bind(await signWith(key, 'stop:' + r.id), r.id));
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  await env.DB.prepare("INSERT OR REPLACE INTO lead_keys (k, v, at) VALUES ('old-stop-links', ?1, ?2)").bind(String(rows.length), iso(Date.now())).run();
}
export async function stopLink(env, id) { return SITE + '/lead/stop?i=' + encodeURIComponent(id) + '&k=' + (await sig(env, 'stop:' + id)); }
// A link in our email that counts the click (the address is real), then goes on: to=start, sample or audit.
export async function goLink(env, id, to) { return SITE + '/lead/go?i=' + encodeURIComponent(id) + '&to=' + to + '&k=' + (await sig(env, 'go:' + id)); }

// The website form's start time, signed when the page asks for it (GET /lead?t=1), so a visitor's clock never matters.
export async function formStamp(env, now) { const t = String(Math.floor(now || Date.now())); return t + '.' + (await sig(env, 'form:' + t)); }
// How long the form was open. '' when fine; otherwise why it looks automatic. A browser clock (the fallback when the
// signed time did not load) can be minutes off, so from it only a gap of 0 to 3 seconds counts; a negative or very
// long gap is a wrong clock, and the hidden field catches bots.
export async function formTiming(env, t, now, minMs, maxMs) {
  const s = String(t || '').trim();
  const m = /^(\d{10,14})\.([0-9a-f]{24})$/.exec(s);
  if (m) {
    if (m[2] !== await sig(env, 'form:' + m[1])) return 'form time not ours';
    const age = now - +m[1];
    return age < minMs ? 'sent too fast' : age > maxMs ? 'form too old' : '';
  }
  if (!/^\d{10,14}$/.test(s)) return 'no form time';
  const gap = now - +s;
  return gap >= 0 && gap < minMs ? 'sent too fast' : '';
}

// ---------- who may get an audit email ----------
export async function suppressed(env, email) {
  const k = emailKey(email);
  return !!(k && await env.DB.prepare('SELECT 1 AS x FROM mail_suppress WHERE key = ?1').bind(k).first().catch(() => null));
}
async function suppress(env, email, why) {
  const k = emailKey(email);
  if (!/@/.test(k)) return;
  await env.DB.prepare('INSERT OR IGNORE INTO mail_suppress (key, at, why) VALUES (?1, ?2, ?3)').bind(k, iso(Date.now()), why || '').run();
}
// Why an audit email should not go to this address now, or ''. Checked when the form is sent (so the page says the
// right thing) and again at the send.
export async function auditHold(env, email, netHash, id, now) {
  await ensureLeadMail(env);
  now = now || Date.now();
  const e = one(email).toLowerCase(), k = emailKey(e);
  if (await suppressed(env, e)) return 'stopped';
  const since = iso(now - SAME_ADDRESS_DAYS * DAY);
  const sent = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_sends WHERE key = ?1 AND at > ?2').bind(k, since).first().catch(() => null);
  const old = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE (lower(email) = ?1 OR email_key = ?2) AND id != ?3 AND audit IN ('sent', 'missed') AND audit_at > ?4").bind(e, k, id || 0, since).first().catch(() => null);
  if ((sent && +sent.n) || (old && +old.n)) return 'repeat';
  if (netHash) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_sends WHERE net = ?1 AND at > ?2').bind(netHash, iso(now - DAY)).first().catch(() => null);
    if (n && +n.n >= NET_PER_DAY) return 'held: network limit';
  }
  const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE audit IN ('sent', 'missed') AND audit_at > ?1").bind(iso(now - DAY)).first().catch(() => null);
  if (day && +day.n >= PER_DAY) return 'held: daily limit';
  return '';
}
// Every audit email sent, by address and network, for the caps above (kept 40 days).
async function noteSend(env, email, net, id, kind, now) {
  await env.DB.prepare('INSERT INTO audit_sends (key, net, at, lead_id, kind) VALUES (?1, ?2, ?3, ?4, ?5)').bind(emailKey(email), net || '', iso(now), id || null, kind).run().catch(() => {});
  await env.DB.prepare('DELETE FROM audit_sends WHERE at < ?1').bind(iso(now - 40 * DAY)).run().catch(() => {});
}

function footer(env, stop, es) {
  const addr = one(env.BUSINESS_ADDRESS || '');
  const why = es ? 'Recibe este correo porque pidió una auditoría gratis en alwaysopenoffice.com.' : 'You’re getting this because you asked for a free audit at alwaysopenoffice.com.';
  const who = 'Always Open, a service of Lake Country Foam Party, LLC' + (addr ? ', ' + addr : '') + '.';
  const out = es ? 'No quiero más correos' : 'Don’t email me again';
  return {
    html: '<p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#6B7280">' + esc(why) + ' ' + esc(who) + '<br><a href="' + esc(stop) + '" style="color:#6B7280">' + esc(out) + '</a></p>',
    text: '\n\n--\n' + why + ' ' + who + '\n' + out + ': ' + stop
  };
}
const shell = inner => '<!doctype html><html><body style="margin:0;padding:0;background:#F4F4F2"><div style="max-width:600px;margin:0 auto;padding:24px 18px;font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#171B26">' +
  '<p style="margin:0 0 18px;font-weight:800;font-size:15px;color:#D92D20;letter-spacing:.02em">Always Open</p>' + inner + '</div></body></html>';
const btn = (href, label) => '<p style="margin:22px 0"><a href="' + esc(href) + '" style="display:inline-block;background:#D92D20;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px">' + esc(label) + '</a></p>';
const GC = { A: '#1C6B54', B: '#1C6B54', C: '#B7791F', D: '#C4271B', F: '#C4271B' };

// Spanish for what the audit can find. The details in "saw" carry numbers in English, so the Spanish email uses titles and fixes.
const ES = {
  'Google may show this business as closed': ['Google podría mostrar su negocio como cerrado', 'Corregimos el estado del perfil y mantenemos el horario al día.'],
  'No Google reviews yet': ['Todavía no tiene reseñas en Google', 'Le pedimos una reseña a cada cliente después de cada trabajo.'],
  'Fewer reviews than nearby competitors': ['Menos reseñas que la competencia cercana', 'Le pedimos una reseña a cada cliente después de cada trabajo.'],
  'Rating below 4.5': ['Calificación por debajo de 4.5', 'Respondemos cada reseña y pedimos reseñas a cada cliente para subir la calificación.'],
  'No recent reviews': ['No hay reseñas recientes', 'Una solicitud de reseña después de cada trabajo trae reseñas nuevas cada mes.'],
  'Recent low-star reviews': ['Reseñas recientes de 1 o 2 estrellas', 'Le preparamos una respuesta calmada y profesional para su aprobación el mismo día.'],
  'No hours on Google': ['Sin horario en Google', 'Agregamos su horario, incluidos los días festivos, y lo mantenemos al día.'],
  'Few photos on Google': ['Pocas fotos en Google', 'Mande una foto de un trabajo terminado y la convertimos en publicación y en foto del perfil.'],
  'No website on Google': ['Sin sitio web en Google', 'Agregamos uno, o le hacemos una página sencilla.'],
  'Website did not load': ['El sitio web no cargó', 'Dirigimos Google a una página que funcione.'],
  'Website is hard to use on a phone': ['El sitio web es difícil de usar en el teléfono', 'Arreglamos la página o hacemos una que funcione en el teléfono.'],
  'No tap-to-call button on the website': ['El sitio web no tiene botón para llamar', 'Agregamos un botón para llamar con un toque.'],
  'Phone number does not match': ['El teléfono no coincide', 'Hacemos que su nombre, teléfono y horario coincidan en todas partes.'],
  'Website is not secure': ['El sitio web no es seguro', 'Activamos https.'],
  'Website is slow': ['El sitio web es lento', 'Aligeramos la página o la movemos a un hosting rápido.']
};
const AREA_ES = { 'Reviews': 'Reseñas', 'Google profile': 'Perfil de Google', 'Website': 'Sitio web' };

// The audit email. Pure: the words are tested without Google. lead: {name, business, town, plan, lang}; a: runAudit's answer.
// go: the click-counting links for the email's buttons ({start, sample}); the plain text keeps the plain links.
export function auditMail(lead, a, stop, env, via, go) {
  go = go || {};
  const es = lead.lang === 'es', b = a.business || {}, first = firstName(lead.name), name = one(b.name) || plain(lead.business) || (es ? 'su negocio' : 'your business');
  const fixes = topThree(a), pitch = pitchFor(b.name, b.type || lead.type);
  const ft = footer(env || {}, stop, es), gc = GC[a.grade] || '#C4271B', start = startLink(lead.plan);
  const own = b.reviews ? (es ? b.rating.toFixed(1) + ' estrellas de ' + b.reviews + ' reseñas en Google hoy' : b.rating.toFixed(1) + ' stars from ' + b.reviews + (b.reviews === 1 ? ' review' : ' reviews') + ' on Google today')
    : (es ? 'todavía sin reseñas en Google' : 'no Google reviews yet');
  const areas = (a.areas || []).map(x => ({ label: es ? (AREA_ES[x.label] || x.label) : x.label, grade: x.grade }));
  const items = fixes.map(f => es && ES[f.title] ? { title: ES[f.title][0], saw: '', fix: ES[f.title][1] } : f);
  // The subject names the business only as Google lists it, never as someone typed it into the form.
  const gname = one(b.name).slice(0, 80);
  const subject = es ? 'Su auditoría gratis: ' + (gname ? gname + ' saca una ' : 'una ') + a.grade : 'Your free audit: ' + (gname ? gname + ' gets a ' : 'a ') + a.grade;
  const T = es ? {
    hi: first ? 'Hola, ' + first + ':' : 'Hola:',
    intro: via === 'letter' ? 'Aquí está su auditoría completa. Buscamos ' + name + ' en Google ahora mismo y la comparamos con los negocios como el suyo con más movimiento cerca de usted.' : 'Aquí está la auditoría gratis que pidió. Buscamos ' + name + ' en Google hace un minuto y la comparamos con los negocios como el suyo con más movimiento cerca de usted.',
    gradeLab: 'cómo lo ven quienes buscan en Google', fixH: 'Lo primero que arreglaríamos', none: 'No hay nada importante que arreglar, y eso es raro.',
    fine: 'Ya está bien: ', doH: 'Lo que haríamos por ' + name, approve: ' Usted aprueba todo desde su teléfono; nada sale a su nombre sin su visto bueno.',
    page: 'El día 2 de cada mes recibe una página que muestra lo que hicimos y cuánto valió. Vea un ejemplo:', start: 'Empezar mi primer mes',
    promise: 'Pruébelo un mes. Si no vale la pena, no lo paga. Sin contrato y sin cargo de instalación.',
    max: '¿Quiere oír cómo se contestarían sus llamadas? Llame a Max, nuestra línea, al ' + MAX + ', a cualquier hora.',
    q: via === 'letter' ? '¿Preguntas? Llame al ' + MAX + ' a cualquier hora. Max contesta y Katie le devuelve la llamada.' : via === 'page' ? '¿Preguntas? Responda a nuestro mensaje de texto o escriba a hello@alwaysopenoffice.com. Katie contesta, normalmente el mismo día hábil.' : '¿Preguntas? Responda a este correo. Katie contesta, normalmente el mismo día hábil.', src: 'Calificaciones y número de reseñas de Google Maps, consultados hoy.'
  } : {
    hi: first ? 'Hi ' + first + ',' : 'Hi,',
    intro: via === 'letter' ? 'Here’s your full audit. We looked up ' + name + ' on Google just now and compared it with the busiest nearby businesses like yours.' : 'Here’s the free audit you asked for. We looked up ' + name + ' on Google a minute ago and compared it with the busiest nearby businesses like yours.',
    gradeLab: 'how you look to people searching Google', fixH: fixes.length === 1 ? 'The first thing we’d fix' : fixes.length === 2 ? 'The two things we’d fix first' : 'The three things we’d fix first', none: 'There’s nothing major to fix, which is rare.',
    fine: 'Already good: ', doH: 'What we’d do for ' + name, approve: ' You approve everything from your phone; nothing goes out in your name without your OK.',
    page: 'On the 2nd of every month you’d get one page showing what we did and what it was worth. Here’s a sample:', start: 'Start my first month',
    promise: 'Try it for a month. If it’s not worth it, you don’t pay for it. No contract and no setup fee.',
    max: 'Want to hear how your calls would be answered? Call Max, our phone line, at ' + MAX + ', any hour.',
    q: via === 'letter' ? 'Questions? Call ' + MAX + ' any hour. Max answers, and Katie calls you back.' : via === 'page' ? 'Questions? Reply to our text, or email hello@alwaysopenoffice.com. Katie answers, usually the same business day.' : 'Questions? Just reply to this email. Katie answers, usually the same business day.', src: 'Ratings and review counts are from Google Maps, looked up today.'
  };
  const pitchText = es ? 'Contestamos cada reseña con un borrador para su visto bueno, mantenemos su perfil de Google al día y contestamos cada llamada a su nombre, de día y de noche, con Max, nuestra línea telefónica. Después de cada trabajo llamamos para ver si todo quedó bien, damos seguimiento a cotizaciones y facturas, y llenamos los días libres con sus propios clientes.' : pitch.text;
  const inner = (
    '<p style="margin:0 0 12px">' + esc(T.hi) + '</p><p style="margin:0 0 18px">' + esc(T.intro) + '</p>' +
    '<div style="border:2px solid ' + gc + ';border-radius:14px;padding:14px 18px;margin:0 0 14px"><p style="margin:0;font-size:13px;color:#586075">' + esc(name) + ' · ' + esc(T.gradeLab) + '</p>' +
    '<p style="margin:4px 0 0;font-size:40px;line-height:1;font-weight:800;color:' + gc + '">' + esc(a.grade) + ' <span style="font-size:15px;font-weight:600;color:#586075">' + a.score + (es ? ' de 100' : ' of 100') + '</span></p>' +
    (areas.length ? '<p style="margin:10px 0 0;font-size:14px">' + areas.map(x => '<b style="color:' + (GC[x.grade] || '#C4271B') + '">' + esc(x.grade) + '</b> ' + esc(x.label)).join(' &nbsp;·&nbsp; ') + '</p>' : '') +
    '<p style="margin:6px 0 0;font-size:14px;color:#586075">' + esc(own) + '</p></div>' +
    '<h2 style="font-size:18px;margin:22px 0 8px">' + esc(T.fixH) + '</h2>' +
    (items.length ? '<ol style="margin:0;padding-left:22px">' + items.map(f => '<li style="margin:0 0 10px"><b>' + esc(f.title) + '.</b> ' + esc(f.saw) + '<br><span style="color:#1C6B54;font-weight:600">' + esc(f.fix) + '</span></li>').join('') + '</ol>' : '<p style="margin:0">' + esc(T.none) + '</p>') +
    ((a.fine || []).length && !es ? '<p style="margin:8px 0 0;color:#1C6B54;font-size:14px">' + esc(T.fine + a.fine.slice(0, 4).join('; ') + '.') + '</p>' : '') +
    '<h2 style="font-size:18px;margin:24px 0 8px">' + esc(T.doH) + '</h2><p style="margin:0">' + esc(pitchText + T.approve) + '</p>' +
    '<p style="margin:12px 0 0">' + esc(T.page) + ' <a href="' + esc(go.sample || SITE + '/sample-report') + '" style="color:#D92D20">' + SITE.replace('https://', '') + '/sample-report</a></p>' +
    btn(go.start || start, T.start) + '<p style="margin:0 0 14px;font-weight:600">' + esc(T.promise) + '</p>' +
    '<p style="margin:0 0 14px">' + esc(T.max) + '</p><p style="margin:0">' + esc(T.q) + '</p><p style="margin:16px 0 0">Always Open</p>' +
    '<p style="margin:18px 0 0;font-size:12px;color:#6B7280">' + esc(T.src) + '</p>');
  const html = shell(inner + ft.html);
  const text = [T.hi, '', T.intro, '', name + ': ' + a.grade + ' (' + a.score + (es ? ' de 100' : ' of 100') + '), ' + T.gradeLab + '.',
    areas.map(x => x.label + ' ' + x.grade).join(' · '), own, '', T.fixH + ':',
    ...(items.length ? items.map((f, i) => (i + 1) + '. ' + f.title + '. ' + (f.saw ? f.saw + ' ' : '') + f.fix) : [T.none]), '',
    T.doH + ': ' + pitchText + T.approve, '', T.page + ' ' + SITE + '/sample-report', '', T.start + ': ' + start, T.promise, '', T.max, '', T.q, '', 'Always Open', '', T.src].join('\n') + ft.text;
  return { subject, html, text, inner };
}

// When Google can't find the business from what they typed.
// What they typed is shown only as a plain quote, with any link taken out.
export function missMail(lead, stop, env, go) {
  go = go || {};
  const es = lead.lang === 'es', first = firstName(lead.name), q = plain(lead.business), town = plain(lead.town);
  const asked = q ? '“' + q + (town ? ', ' + town : '') + '”' : '';
  const ft = footer(env || {}, stop, es), start = startLink(lead.plan);
  const subject = es ? 'Su auditoría gratis: una pregunta rápida' : 'Your free audit: one quick question';
  const lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:',
    (asked ? 'Buscamos ' + asked + ' en Google' : 'Buscamos su negocio en Google') + ' y no encontramos una coincidencia exacta. Responda a este correo con el nombre como aparece en Google, o con el enlace a su perfil, y le mandamos la auditoría de inmediato. Si no, Katie la busca a mano y se la manda en un día hábil.',
    'Mientras tanto, así se ve la página que recibe cada mes: ' + SITE + '/sample-report',
    '¿Quiere oír cómo se contestarían sus llamadas? Llame a Max, nuestra línea, al ' + MAX + '.', 'Always Open']
    : [first ? 'Hi ' + first + ',' : 'Hi,',
    (asked ? 'We looked on Google for ' + asked : 'We looked for your business on Google') + ' and couldn’t find an exact match. Reply with the name as it shows on Google, or a link to your profile, and your audit comes right back. Otherwise Katie will look it up by hand and send it within one business day.',
    'In the meantime, here’s the one page you’d get every month: ' + SITE + '/sample-report',
    'Want to hear how your calls would be answered? Call Max, our phone line, at ' + MAX + '.', 'Always Open'];
  const html = shell(lines.slice(0, -1).map(l => '<p style="margin:0 0 14px">' + esc(l).replace(SITE + '/sample-report', '<a href="' + esc(go.sample || SITE + '/sample-report') + '" style="color:#D92D20">' + SITE.replace('https://', '') + '/sample-report</a>') + '</p>').join('') +
    btn(go.start || start, es ? 'Empezar mi primer mes' : 'Start my first month') + '<p style="margin:0">Always Open</p>' + ft.html);
  return { subject, html, text: lines.join('\n\n') + '\n\n' + (es ? 'Empezar' : 'Start') + ': ' + start + ft.text };
}

// The copy someone asked for on their audit page. Built from what we keep (our grade and our words for the fixes), with
// a link back to the live audit, so asking for a copy never looks anything up on Google.
export function copyMail(lead, link, stop, env, go) {
  go = go || {};
  const es = lead.lang === 'es', ft = footer(env || {}, stop, es), start = startLink(lead.plan);
  let fixes = []; try { fixes = JSON.parse(lead.fixes || '[]'); } catch (e) { fixes = []; }
  if (!fixes.length && lead.top) { try { fixes = [JSON.parse(lead.top)]; } catch (e) { fixes = []; } }
  fixes = fixes.filter(f => f && f.title).slice(0, 3).map(f => es && ES[f.title] ? { title: ES[f.title][0], fix: ES[f.title][1] } : f);
  const g = /^[A-F]$/.test(lead.grade || '') ? lead.grade : '';
  const subject = es ? 'La copia de su auditoría' + (g ? ': calificación ' + g : '') : 'Your audit copy' + (g ? ': grade ' + g : '');
  const lines = es ? ['Hola:', 'Aquí está la copia que pidió.' + (g ? ' Su negocio sacó una ' + g + ' en cómo lo ven quienes buscan en Google.' : ''),
    ...(fixes.length ? ['Lo primero que arreglaríamos:', ...fixes.map((f, i) => (i + 1) + '. ' + f.title + '. ' + f.fix)] : []),
    'La auditoría completa, consultada de nuevo cada vez que la abre: ' + link,
    'Pruébelo un mes. Si no vale la pena, no lo paga. Sin contrato y sin cargo de instalación: ' + start,
    '¿Preguntas? Responda a este correo, o llame a Max al ' + MAX + ' a cualquier hora. Katie contesta, normalmente el mismo día hábil.', 'Always Open']
    : ['Hi,', 'Here’s the copy you asked for.' + (g ? ' Your business got a ' + g + ' for how it looks to people searching Google.' : ''),
    ...(fixes.length ? [(fixes.length === 1 ? 'The first thing we’d fix:' : 'What we’d fix first:'), ...fixes.map((f, i) => (i + 1) + '. ' + f.title + '. ' + f.fix)] : []),
    'Your full audit, looked up fresh each time you open it: ' + link,
    'Try it for a month. If it’s not worth it, you don’t pay for it. No contract and no setup fee: ' + start,
    'Questions? Reply to this email, or call Max at ' + MAX + ' any hour. Katie answers, usually the same business day.', 'Always Open'];
  const linkify = l => esc(l).replace(esc(link), '<a href="' + esc(go.audit || link) + '" style="color:#D92D20">' + esc(link.replace('https://', '')) + '</a>').replace(esc(start), '<a href="' + esc(go.start || start) + '" style="color:#D92D20">' + esc(start.replace('https://', '')) + '</a>');
  const html = shell(lines.map(l => '<p style="margin:0 0 14px">' + linkify(l) + '</p>').join('') + ft.html);
  return { subject, html, text: lines.join('\n\n') + ft.text };
}

// The two follow-ups. n: 1 or 2. top: the first fix from the audit, when there was one. Nothing typed into the form is
// repeated in them, and the subject never pretends to be a reply.
export function followMail(lead, n, stop, env, top, go) {
  go = go || {};
  const es = lead.lang === 'es', first = firstName(lead.name);
  const ft = footer(env || {}, stop, es), start = startLink(lead.plan), g = /^[A-F]$/.test(lead.grade || '') ? ' ' + lead.grade : '';
  let subject, lines;
  if (n === 1) {
    subject = es ? 'Su auditoría gratis: lo más rápido de arreglar' : 'Your free audit: the quickest win';
    lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:', '¿Pudo ver la auditoría? Lo más rápido que mejoraría su negocio' + (top && ES[top.title] ? ': ' + ES[top.title][1].charAt(0).toLowerCase() + ES[top.title][1].slice(1) : ' es contestar cada reseña y cada llamada.') + ' Es lo que hacemos la primera semana.',
      'Empezar: ' + start, 'O responda con una pregunta; Katie contesta, normalmente el mismo día hábil.', 'Always Open']
      : [first ? 'Hi ' + first + ',' : 'Hi,', 'Did you get a chance to look at the audit? The quickest win for your business' + (top && top.fix ? ': ' + top.fix.charAt(0).toLowerCase() + top.fix.slice(1) : ' is a reply to every review and an answer to every call.') + ' That’s the kind of thing we start on in week one.',
      'Start your first month: ' + start, 'Or reply with a question. Katie answers, usually the same business day.', 'Always Open'];
  } else {
    subject = es ? 'Última nota sobre su auditoría' : 'Last note on your audit';
    lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:', 'Última nota de nuestra parte. Si las reseñas, las llamadas y los seguimientos se le acumulan, nosotros nos encargamos, y el día 2 de cada mes recibe una página con lo que hicimos y cuánto valió.',
      'Pruébelo un mes. Si no vale la pena, no lo paga: ' + start, 'O llame a Max al ' + MAX + ' para oír cómo se contestarían sus llamadas. De cualquier forma, la auditoría' + g + ' es suya.', 'Always Open']
      : [first ? 'Hi ' + first + ',' : 'Hi,', 'Last note from us. If reviews, calls and follow-ups are piling up, we take them off your plate, and on the 2nd of every month you get one page showing what we did and what it was worth.',
      'Try it for a month. If it’s not worth it, you don’t pay for it: ' + start, 'Or call Max at ' + MAX + ' to hear how your calls would be answered. Either way, the audit is yours to keep.', 'Always Open'];
  }
  const linkify = l => esc(l).replace(esc(start), '<a href="' + esc(go.start || start) + '" style="color:#D92D20">' + esc(start.replace('https://', '')) + '</a>');
  const html = shell(lines.map(l => '<p style="margin:0 0 14px">' + linkify(l) + '</p>').join('') + ft.html);
  return { subject, html, text: lines.join('\n\n') + ft.text };
}

// Send through the site's mail service. Returns 'sent' or why not.
async function send(env, to, m, h) {
  if (h && h.send) return h.send(to, m);
  if (!env.SEND_MAIL) return 'off';
  const msg = { to, from: FROM, replyTo: REPLY_TO, subject: one(m.subject).slice(0, 140), html: m.html, text: m.text };
  try { await env.SEND_MAIL.send(msg); return 'sent'; } catch (e) {
    try { const t = Object.assign({}, msg); delete t.html; delete t.replyTo; await env.SEND_MAIL.send(t); return 'sent'; } catch (e2) { return 'failed: ' + one((e2 && e2.message) || e2).slice(0, 120); }
  }
}

// Our own words for up to three fixes (titles and fixes are ours; Google's numbers stay out), for the copy and follow-ups.
const ourFixes = a => JSON.stringify(topThree(a).map(f => ({ title: f.title, fix: f.fix })));

// Right after a website request is saved. lead: the form fields (net_hash: the sender's network); id: the leads row.
// h: {run, send, ping, now} for tests. Every way out marks the row, so the retry queue never sticks on one.
export async function sendAudit(env, lead, id, h) {
  h = h || {};
  await ensureLeadMail(env);
  const email = one(lead.email).toLowerCase();
  const now = h.now || Date.now(), at = iso(now);
  // Kept: our own grade and our own words for the fixes (never Google's numbers), and Google's place ID.
  const mark = (state, grade, top, fixes, pid) => env.DB.prepare('UPDATE leads SET audit = ?1, audit_at = ?2, grade = ?3, top = ?4, fixes = ?5, place_id = ?6 WHERE id = ?7').bind(state, at, grade || '', top || '', fixes || '', pid || '', id).run().catch(() => {});
  if (!id) return 'no email';
  if (!validEmail(email)) { await mark('no email'); return 'no email'; }
  await env.DB.prepare('UPDATE leads SET email_key = ?1 WHERE id = ?2').bind(emailKey(email), id).run().catch(() => {});
  const hold = await auditHold(env, email, lead.net_hash || '', id, now);
  if (hold === 'stopped' || hold === 'repeat') { await mark(hold); return hold; }
  if (hold === 'held: network limit') {
    await mark(hold);
    if (h.ping) await h.ping('Audit held: ' + (plain(lead.business) || 'a request'), 'More than ' + NET_PER_DAY + ' audit requests from one network today, so this one was not emailed. If it is real, send the audit by hand.', 'low');
    return 'limited';
  }
  if (hold) { await mark(hold); if (h.ping) await h.ping('Audit emails paused for today', 'More than ' + PER_DAY + ' audit emails in 24 hours. ' + (plain(lead.business) || 'This request') + ' will need a hand-sent audit.'); return 'limited'; }
  const stop = await stopLink(env, id);
  const go = { start: await goLink(env, id, 'start'), sample: await goLink(env, id, 'sample') };
  let a = null, err = '';
  if (one(lead.business).length >= 2) {
    try { a = await (h.run || runAudit)(env, one(lead.business), one(lead.town)); } catch (e) { err = one((e && e.message) || e).slice(0, 120); }
  }
  const found = a && a.found;
  const m = found ? auditMail(lead, a, stop, env, '', go) : missMail(lead, stop, env, go);
  const r = await send(env, email, m, h);
  if (r !== 'sent') {
    // A send that fails is tried again by auditRetryCron, three times in all, before it becomes a job for Christopher.
    const t = await env.DB.prepare('SELECT audit_tries FROM leads WHERE id = ?1').bind(id).first().catch(() => null);
    const tries = (parseInt((t && t.audit_tries) || '0', 10) || 0) + 1;
    await env.DB.prepare('UPDATE leads SET audit_tries = ?1 WHERE id = ?2').bind(String(tries), id).run().catch(() => {});
    if (tries < AUDIT_TRIES) { await mark('retry'); return 'retry'; }
    await mark('failed'); if (h.ping) await h.ping('Audit email did not send', (plain(lead.business) || 'A request') + ': ' + r + ' (tried ' + tries + ' times). Send the audit by hand.'); return r;
  }
  const f0 = found && a.findings && a.findings[0];
  await mark(found ? 'sent' : 'missed', found ? a.grade : '', f0 ? JSON.stringify({ title: f0.title, fix: f0.fix }) : '', found ? ourFixes(a) : '', found ? String(a.business.id || '') : '');
  await noteSend(env, email, lead.net_hash || '', id, 'audit', now);
  if (!found && h.ping) await h.ping('Audit needs a hand: ' + (plain(lead.business) || 'a request'), (err ? 'Google lookup failed (' + err + '). ' : 'Google had no match for "' + plain(lead.business) + (lead.town ? ', ' + plain(lead.town) : '') + '". ') + 'They got an email saying Katie will send it within one business day.');
  return found ? 'sent' : 'missed';
}

// Every 10 minutes, any hour: audit emails that failed to send, and requests whose audit never started (the worker
// stopped before it ran). Each gets up to three tries in all; the third failure goes to Christopher by push.
const AUDIT_TRIES = 3;
export async function auditRetryCron(env, now, h) {
  now = now || Date.now(); h = h || {};
  await ensureLeadMail(env);
  const five = new Date(now - 5 * 60e3).toISOString(), day = new Date(now - 864e5).toISOString();
  const rows = ((await env.DB.prepare("SELECT * FROM leads WHERE status != 'spam' AND email LIKE '%@%' AND at > ?2 AND ((audit = 'retry' AND audit_at < ?1) OR ((audit IS NULL OR audit = '') AND at < ?1)) ORDER BY id LIMIT 5")
    .bind(five, day).all()).results) || [];
  const out = [];
  for (const r of rows) out.push(await sendAudit(env, r, r.id, h));
  return { tried: rows.length, results: out };
}

// /lead/stop?i=&k= : one tap, no questions. The address goes on the do-not-email list, so a new request typed with it
// later gets no audit email either. /lead/go?i=&to=&k= : a click in our email; the address is real, then on we go.
export async function handleStop(req, env, url) {
  await ensureLeadMail(env);
  const id = String(url.searchParams.get('i') || ''), k = String(url.searchParams.get('k') || '');
  if (url.pathname === '/lead/go') return handleGo(req, env, url, id, k);
  const page = (t, p) => new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(t) + '</title></head><body style="margin:0;background:#0F131B;color:#ECEEF3;font:17px/1.55 system-ui,sans-serif"><main style="max-width:520px;margin:0 auto;padding:48px 20px"><h1 style="font-size:1.6rem;margin:0 0 10px">' + esc(t) + '</h1><p style="color:#A3ACBF">' + esc(p) + '</p><p><a href="/" style="color:#FF8C82">Always Open</a></p></main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  const bad = () => page('That link didn’t work', 'Reply to any of our emails with “stop” and we won’t email you again.');
  if (!/^\d{1,12}$/.test(id) || !/^[0-9a-f]{24}$/.test(k)) return bad();
  const row = await env.DB.prepare('SELECT id, email, stop_k FROM leads WHERE id = ?1').bind(+id).first().catch(() => null);
  // Today's links carry the stored secret's signature; older ones the ops key's (checked now, and written down once).
  const ok = k === await sig(env, 'stop:' + id) || k === await legacySig(env, id) || !!(row && row.stop_k && k === row.stop_k);
  if (!ok) return bad();
  const now = iso(Date.now());
  await env.DB.prepare("UPDATE leads SET stop = 'unsubscribed', stop_at = ?1 WHERE id = ?2 AND (stop IS NULL OR stop = '')").bind(now, +id).run();
  if (row && validEmail(row.email)) {
    await suppress(env, row.email, 'stop link, lead ' + id);
    await env.DB.prepare("UPDATE leads SET stop = 'unsubscribed', stop_at = ?1 WHERE (email_key = ?2 OR lower(email) = ?3) AND (stop IS NULL OR stop = '')").bind(now, emailKey(row.email), one(row.email).toLowerCase()).run().catch(() => {});
  }
  return page('Done. No more emails.', 'We won’t email you again about the audit. If you ever want to talk, call (706) 460-2226.');
}
async function handleGo(req, env, url, id, k) {
  const to = String(url.searchParams.get('to') || '');
  const row = /^\d{1,12}$/.test(id) && /^[0-9a-f]{24}$/.test(k) ? await env.DB.prepare('SELECT id, plan, token, audit_at, engaged FROM leads WHERE id = ?1').bind(+id).first().catch(() => null) : null;
  const ok = !!row && k === await sig(env, 'go:' + id);
  const dest = !ok ? SITE + '/' : to === 'start' ? startLink(row.plan) : to === 'audit' && row.token ? SITE + '/your-audit/' + row.token : to === 'sample' ? SITE + '/sample-report' : SITE + '/';
  // Mail scanners open links the moment an email lands; a person takes longer. Only a later click counts.
  const now = Date.now(), sentAt = Date.parse((row && row.audit_at) || '') || 0;
  if (ok && req.method === 'GET' && !row.engaged && now - sentAt >= ENGAGED_AFTER) await env.DB.prepare("UPDATE leads SET engaged = ?1 WHERE id = ?2 AND (engaged IS NULL OR engaged = '')").bind(iso(now), row.id).run().catch(() => {});
  return new Response(null, { status: 302, headers: { location: dest, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

function eastern(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { wd: p.weekday, hour: +p.hour };
}

// Every 10 minutes: the follow-ups that are due. h: {send, run, now} for tests.
export async function followCron(env, now, h) {
  now = now || Date.now();
  h = h || {};
  await ensureLeadMail(env);
  const e = eastern(now);
  if (e.wd === 'Sat' || e.wd === 'Sun' || e.hour < SEND_HOURS[0] || e.hour >= SEND_HOURS[1]) return { quiet: true };
  if (!one(env.BUSINESS_ADDRESS)) return { held: 'no postal address set' };
  // Only addresses that clicked through our email: anyone can type a stranger's address into the form.
  const rows = ((await env.DB.prepare("SELECT * FROM leads WHERE status = 'new' AND audit IN ('sent', 'missed') AND (stop IS NULL OR stop = '') AND (fu2_at IS NULL OR fu2_at = '') AND engaged IS NOT NULL AND engaged != '' AND audit_at > ?1 ORDER BY id LIMIT 40")
    .bind(iso(now - FU_STALE)).all()).results) || [];
  let sent = 0, stopped = 0;
  for (const r of rows) {
    const auditAt = Date.parse(r.audit_at || r.at), fu1 = r.fu1_at ? Date.parse(r.fu1_at) : 0;
    const n = !fu1 ? (now - auditAt >= FU1_AFTER ? 1 : 0) : (now - auditAt >= FU2_AFTER && now - fu1 >= FU_GAP ? 2 : 0);
    if (!n) continue;
    if (!validEmail(r.email)) continue;
    if (await suppressed(env, r.email)) { await env.DB.prepare("UPDATE leads SET stop = 'unsubscribed', stop_at = ?1 WHERE id = ?2").bind(iso(now), r.id).run(); stopped++; continue; }
    // Signed up already (same email, or same business name)? Then they're a client, not a lead.
    const won = await env.DB.prepare("SELECT 1 AS x FROM billing WHERE lower(email) = ?1 OR (?2 != '' AND lower(business) = ?2) LIMIT 1").bind(one(r.email).toLowerCase(), one(r.business).toLowerCase()).first().catch(() => null);
    if (won) { await env.DB.prepare("UPDATE leads SET stop = 'signed up', stop_at = ?1 WHERE id = ?2").bind(iso(now), r.id).run(); stopped++; continue; }
    const stop = await stopLink(env, r.id);
    let top = null; try { top = r.top ? JSON.parse(r.top) : null; } catch (e) { top = null; }
    const m = followMail(r, n, stop, env, top, { start: await goLink(env, r.id, 'start') });
    const s = await send(env, one(r.email).toLowerCase(), m, h);
    if (s !== 'sent') continue;
    await env.DB.prepare('UPDATE leads SET ' + (n === 1 ? 'fu1_at' : 'fu2_at') + ' = ?1 WHERE id = ?2').bind(iso(now), r.id).run();
    sent++;
  }
  return { sent, stopped };
}

// ---------- callers: the audit by text ----------
// Max offers the free audit on Always Open's own line once a caller has given their business and town. Only on a yes
// (the call note's auditText), the caller gets one text with a private link to their audit, looked up fresh when they
// open it, with a box to email themselves a copy. The copy can start the same two follow-ups as a website request, once
// its address clicks through. A mailed letter's page has the same box; letter leads get no follow-ups (status 'letter').
const MAX_VIEWS = 8;
const tok = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 56]).join(''); };
export function auditText(lead, link) {
  const biz = one(lead.business) || (lead.lang === 'es' ? 'su negocio' : 'your business');
  return lead.lang === 'es'
    ? 'Always Open: aquí está la auditoría gratis de ' + biz + ' que pidió en la llamada: ' + link + ' Katie le da seguimiento. Responda STOP para no recibir más.'
    : 'Always Open: here’s the free audit for ' + biz + ' you asked for on the call: ' + link + ' Katie will follow up. Reply STOP to opt out.';
}
// Called after the call, from the call note. h: {sendText} for tests. Returns 'texted' or why not.
export async function textAudit(env, id, to, lead, h) {
  await ensureLeadMail(env);
  if (!id || !/^\+1\d{10}$/.test(to || '') || one(lead.business).length < 2) return 'not offered';
  const t = tok(), link = SITE + '/your-audit/' + t;
  await env.DB.prepare("UPDATE leads SET token = ?1, sms_ok = 'yes', audit = 'texted', audit_at = ?2, lang = ?3 WHERE id = ?4").bind(t, new Date().toISOString(), lead.lang === 'es' ? 'es' : '', id).run();
  const send = (h && h.sendText) || (async o => (await import('./sms.js')).sendText(env, o));
  const r = await send({ clientId: 'always-open', to, body: auditText(lead, link), kind: 'reply' });
  if (!r || !r.ok) { await env.DB.prepare("UPDATE leads SET audit = 'text failed' WHERE id = ?1").bind(id).run(); return 'failed: ' + ((r && r.why) || 'no answer'); }
  return 'texted';
}

const PAGE_CSS = 'body{margin:0;background:radial-gradient(800px 420px at 85% -10%,rgba(217,45,32,.28),transparent 60%),linear-gradient(170deg,#161C2A,#0D1017 60%) fixed #0D1017;color:#ECEEF3;font:16px/1.55 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}' +
  '.wrap{max-width:640px;margin:0 auto;padding:18px 16px 48px}.top{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;margin:4px 0 16px;color:#FF8C82;text-shadow:0 0 10px rgba(255,106,94,.5)}' +
  '.card{background:#FBFAF7;color:#171B26;border-radius:18px;padding:22px 20px;box-shadow:0 0 0 1px rgba(255,106,94,.3),0 0 34px rgba(255,90,77,.3),0 30px 60px -30px rgba(0,0,0,.9)}.card>div{max-width:none!important;padding:0!important}' +
  '.copy{margin:18px 0 0;padding:16px;border:1.5px solid rgba(255,106,94,.5);border-radius:14px;background:rgba(255,90,77,.06)}.copy b{display:block;margin-bottom:8px}' +
  '.copy form{display:flex;gap:8px;flex-wrap:wrap}.copy input{flex:1 1 220px;min-height:46px;padding:10px 12px;border-radius:10px;border:1.5px solid #3A4459;background:#0F131B;color:#ECEEF3;font:inherit}' +
  '.copy button{min-height:46px;padding:10px 18px;border:0;border-radius:10px;background:#FF5A4D;color:#1A0605;font-weight:700;font-size:16px;cursor:pointer}.note{color:#A3ACBF;font-size:14px;margin:14px 0 0}.ok{color:#7EE0BE}';
function pageShell(title, body, es) {
  return new Response('<!doctype html><html lang="' + (es ? 'es' : 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>' + esc(title) + '</title><style>' + PAGE_CSS + '</style></head><body><main class="wrap">' +
    '<div class="top"><svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#E5372B"/><path d="M44.7 19.3A18 18 0 1 0 50 32" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="32" r="5.5" fill="#fff"/></svg>Always Open</div>' +
    body + '</main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

// The sender of a post, hashed the way the website form does it.
async function senderHash(req, env) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((req.headers.get('cf-connecting-ip') || '') + '|' + (env.IP_SALT || 'salt')));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

// GET /your-audit/<token>: the audit, looked up now. POST /your-audit/<token> {email}: email a copy, or {phone}: call me.
export async function handleAuditPage(req, env, url, h) {
  h = h || {};
  await ensureLeadMail(env);
  const t = url.pathname.slice('/your-audit/'.length).replace(/\/$/, '');
  if (!/^[A-Za-z0-9]{16}$/.test(t)) return pageShell('Not found', '<p>That link isn’t right. Call (706) 460-2226 and Max will help.</p>');
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE token = ?1').bind(t).first().catch(() => null);
  if (!lead) return pageShell('Not found', '<p>That link has expired. Call (706) 460-2226 and Max will help.</p>');
  const es = lead.lang === 'es';
  const letter = /^letter /.test(lead.origin || '');
  if (req.method === 'POST') {
    // Limits: a few posts an hour from one sender, one emailed copy and one call-me push per link a day, and the copy
    // is built from what we keep, so a post never looks anything up on Google.
    const now = h.now || Date.now();
    const back = '<p><a style="color:#FF8C82" href="/your-audit/' + t + '">' + (es ? 'Volver a la auditoría' : 'Back to the audit') + '</a></p>';
    const say = (title, text, ok) => pageShell(title, '<p' + (ok ? ' class="ok"' : '') + '>' + esc(text) + '</p>' + back, es);
    let email = '', phone = '';
    try { const f = await req.formData(); email = one(f.get('email')).toLowerCase().slice(0, 120); phone = one(f.get('phone')); } catch (e) { email = ''; }
    const ip = await senderHash(req, env);
    const posts = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_posts WHERE ip = ?1 AND at > ?2').bind(ip, iso(now - 3600e3)).first().catch(() => null);
    if (posts && +posts.n >= POSTS_PER_HOUR) return say(es ? 'Un momento' : 'One moment', es ? 'Demasiados intentos desde aquí. Intente en una hora, o llame al (706) 460-2226.' : 'That’s a lot of tries from here. Try again in an hour, or call (706) 460-2226.');
    await env.DB.prepare('INSERT INTO audit_posts (ip, at, kind) VALUES (?1, ?2, ?3)').bind(ip, iso(now), phone && !email ? 'call' : 'copy').run();
    await env.DB.prepare('DELETE FROM audit_posts WHERE at < ?1').bind(iso(now - 2 * DAY)).run().catch(() => {});
    if (phone && !email) {
      // "Have Katie call me" (the mailed letter's page): the number goes to Christopher at once, at high priority, once a day.
      const d = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return pageShell(es ? 'Revise el número' : 'Check the number', '<p>' + (es ? 'Ese número no parece correcto. ' : 'That number doesn’t look right. ') + '<a style="color:#FF8C82" href="/your-audit/' + t + '">' + (es ? 'Volver' : 'Go back') + '</a></p>', es);
      const shown = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      if (one(lead.phone).replace(/\D/g, '').slice(-10) !== d) await env.DB.prepare('UPDATE leads SET phone = ?1 WHERE id = ?2').bind(shown, lead.id).run();
      const pushed = lead.callme_at && now - Date.parse(lead.callme_at) < DAY;
      if (!pushed) {
        await env.DB.prepare('UPDATE leads SET callme_at = ?1 WHERE id = ?2').bind(iso(now), lead.id).run();
        try { await (await import('./checks.js')).markCallMe(env, lead.id, now); } catch (e) { /* the push below still goes */ }
        if (h.ping) { try { await h.ping('Always Open: ' + one(lead.business) + ' wants a call', one(lead.business) + (lead.town ? ' in ' + one(lead.town) : '') + ' asked for a call at ' + shown + (letter ? ' from their mailed letter' : ' from their audit page') + (lead.grade ? ' (grade ' + lead.grade + ')' : '') + '. Call while it’s fresh.'); } catch (e) { /* the number is saved on the lead */ } }
      }
      return say(es ? 'Listo' : 'Done', es ? 'Listo. Katie le llama al ' + shown + ', normalmente el mismo día hábil.' : 'Done. Katie will call ' + shown + ', usually the same business day.', true);
    }
    if (!validEmail(email)) return pageShell(es ? 'Revise el correo' : 'Check the email', '<p>' + (es ? 'Ese correo no parece correcto. ' : 'That email doesn’t look right. ') + '<a style="color:#FF8C82" href="/your-audit/' + t + '">' + (es ? 'Volver' : 'Go back') + '</a></p>', es);
    if (lead.copy_at && now - Date.parse(lead.copy_at) < DAY) return say(es ? 'Ya se mandó' : 'Already sent', es ? 'Hoy ya mandamos una copia de esta auditoría. Si no le llegó, llame al (706) 460-2226 y Katie le ayuda.' : 'A copy of this audit already went out today. If it didn’t arrive, call (706) 460-2226 and Katie will help.');
    const hold = await auditHold(env, email, '', lead.id, now);
    if (hold === 'stopped') return say(es ? 'No enviado' : 'Not sent', es ? 'Ese correo nos pidió no escribirle, así que no lo haremos. Llame al (706) 460-2226 y Katie le ayuda.' : 'That address asked us not to email it, so we won’t. Call (706) 460-2226 and Katie will help.');
    if (hold === 'repeat') return say(es ? 'Ya se mandó' : 'Already sent', es ? 'Ese correo ya recibió esta auditoría hace poco. Revise su bandeja, o llame al (706) 460-2226 y Katie le ayuda.' : 'That address already got this audit recently. Check its inbox, or call (706) 460-2226 and Katie will help.');
    if (hold) {
      if (h.ping) await h.ping('Audit copy waiting: ' + one(lead.business), 'Someone asked for a copy at ' + email + ', and the day’s audit emails are used up. Send it by hand.');
      return say(es ? 'Enviado' : 'Sent', es ? 'No se pudo enviar ahora. Katie se la manda hoy.' : 'It didn’t send just now. Katie will send it today.');
    }
    // Marked first, so two quick taps never send two copies. The first address asked for becomes the lead's own.
    await env.DB.prepare('UPDATE leads SET copy_at = ?1 WHERE id = ?2').bind(iso(now), lead.id).run();
    if (!validEmail(lead.email)) await env.DB.prepare('UPDATE leads SET email = ?1, email_key = ?2 WHERE id = ?3').bind(email, emailKey(email), lead.id).run();
    const stop = await stopLink(env, lead.id), link = SITE + '/your-audit/' + t;
    const go = { audit: await goLink(env, lead.id, 'audit'), start: await goLink(env, lead.id, 'start'), sample: await goLink(env, lead.id, 'sample') };
    const m = lead.grade ? copyMail(lead, link, stop, env, go) : missMail(lead, stop, env, go);
    const r = await send(env, email, m, h);
    if (r !== 'sent') {
      if (h.ping) await h.ping('Audit copy did not send: ' + one(lead.business), 'Someone asked for a copy at ' + email + ' and it failed (' + r + '). Send it by hand.');
      return say(es ? 'Enviado' : 'Sent', es ? 'No se pudo enviar ahora. Katie se la manda hoy.' : 'It didn’t send just now. Katie will send it today.');
    }
    await noteSend(env, email, '', lead.id, 'copy', now);
    // For a caller's audit, the copy is the audit email: the follow-ups can start once its address clicks through.
    if (!letter && !['sent', 'missed'].includes(lead.audit)) await env.DB.prepare('UPDATE leads SET audit = ?1, audit_at = ?2 WHERE id = ?3').bind(lead.grade ? 'sent' : 'missed', iso(now), lead.id).run();
    return say(es ? 'Enviado' : 'Sent', es ? 'Listo. La copia va camino a ' + email + '.' : 'Done. A copy is on its way to ' + email + '.', true);
  }
  const views = +lead.views || 0;
  await env.DB.prepare('UPDATE leads SET views = ?1 WHERE id = ?2').bind(String(views + 1), lead.id).run();
  // A mailed letter's QR code, opened for the first time: Christopher hears at once (mail.js).
  if (!views && /^letter /.test(lead.origin || '')) { try { await (await import('./mail.js')).letterOpened(env, lead, h.letterPing ? { ping: h.letterPing } : null); } catch (e) { /* the page still shows */ } }
  const callBox = letter ? '<div class="copy"><b>' + (es ? '¿Quiere que Katie le llame?' : 'Want Katie to call you?') + '</b><form method="post"><input type="tel" name="phone" required autocomplete="tel" inputmode="tel" placeholder="(478) 555-0100" aria-label="' + (es ? 'Su número' : 'Your phone number') + '"><button type="submit">' + (es ? 'Llámenme' : 'Call me') + '</button></form><p class="note">' + (es ? 'O llame a Max a cualquier hora: ' : 'Or call Max any hour: ') + '<a style="color:#FF8C82" href="tel:+17064602226">(706) 460-2226</a></p></div>' : '';
  const copyBox = callBox + '<div class="copy"><b>' + (es ? '¿Se la mandamos por correo?' : 'Want a copy by email?') + '</b><form method="post"><input type="email" name="email" required autocomplete="email" placeholder="' + (es ? 'su@correo.com' : 'you@yourbusiness.com') + '" aria-label="Email"><button type="submit">' + (es ? 'Mandármela' : 'Email it to me') + '</button></form></div>';
  let a = null;
  if (views < MAX_VIEWS) { try { a = await (h.run || runAudit)(env, one(lead.business), one(lead.town)); } catch (e) { a = null; } }
  if (a && a.found) {
    // Kept for the emailed copy: our grade and our words for the fixes, and Google's place ID (never Google's details).
    const f0 = a.findings && a.findings[0];
    await env.DB.prepare('UPDATE leads SET grade = ?1, fixes = ?2, top = ?3, place_id = ?4 WHERE id = ?5').bind(lead.grade || a.grade, ourFixes(a), f0 ? JSON.stringify({ title: f0.title, fix: f0.fix }) : '', String((a.business && a.business.id) || lead.place_id || ''), lead.id).run().catch(() => {});
    const m = auditMail(lead, a, '', env, letter ? 'letter' : 'page');
    return pageShell((es ? 'Auditoría: ' : 'Audit: ') + one(a.business.name), '<div class="card">' + m.inner + '</div>' + copyBox, es);
  }
  if (views >= MAX_VIEWS && lead.grade) {
    return pageShell(es ? 'Su auditoría' : 'Your audit', '<div class="card"><p style="margin:0 0 10px">' + esc(one(lead.business)) + (es ? ' sacó una ' : ' got a ') + '<b>' + esc(lead.grade) + '</b>' + (es ? ' en su auditoría.' : ' on its audit.') + '</p><p style="margin:0">' + (es ? 'Pida una copia por correo y se la mandamos con todo el detalle.' : 'Ask for a copy by email and we’ll send it with every detail.') + '</p></div>' + copyBox, es);
  }
  if (h.ping && lead.audit === 'texted') { await h.ping('Audit needs a hand: ' + one(lead.business), 'A caller asked for their audit by text and Google had no match for "' + one(lead.business) + (lead.town ? ', ' + one(lead.town) : '') + '". Call them back.'); await env.DB.prepare("UPDATE leads SET audit = 'missed' WHERE id = ?1").bind(lead.id).run(); }
  return pageShell(es ? 'Su auditoría' : 'Your audit', '<div class="card"><p style="margin:0 0 10px">' + esc(es ? 'Buscamos ' + (one(lead.business) || 'su negocio') + ' en Google y no encontramos una coincidencia exacta. Responda a nuestro mensaje con el nombre como aparece en Google, y Katie le manda la auditoría hoy.' : 'We looked for ' + (one(lead.business) || 'your business') + ' on Google and couldn’t find an exact match. ' + (letter ? 'Call (706) 460-2226 and tell Max the name as it shows on Google, and Katie will send your audit today.' : 'Reply to our text with the name as it shows on Google, and Katie will send your audit today.')) + '</p><p style="margin:0">' + esc(es ? 'Mientras tanto, así se ve la página de cada mes: ' : 'Meanwhile, here’s the one page you’d get every month: ') + '<a style="color:#D92D20" href="/sample-report">alwaysopenoffice.com/sample-report</a></p></div>' + copyBox, es);
}
