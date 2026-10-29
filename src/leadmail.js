// Speed to lead. The moment someone asks for the free audit on the website, the site looks their business up on Google
// (audit.js), and emails them the audit within a minute: their grade, the three things we would fix first, what we
// would do for a business like theirs, a sample monthly page, and how to start. Christopher still gets the push and the
// email about the lead; this just means nobody waits two days for the first answer.
//
// Then two short follow-ups if they don't sign up: day 2 and day 6, weekday business hours Eastern. They stop the moment
// the person signs up, replies (the Always Open check marks that from Gmail), taps the stop link, or Christopher marks
// the lead handled. Every email carries the stop link and the business's postal address.
//
// Google's terms: the audit is looked up fresh for each email and only our own grade is kept (leads.grade).
import { runAudit } from './audit.js';
import { pitchFor, topThree } from './letter.js';

const SITE = 'https://alwaysopenoffice.com';
const MAX = '(706) 460-2226';
const FROM = { email: 'hello@alwaysopenoffice.com', name: 'Always Open' };
const REPLY_TO = 'hello@alwaysopenoffice.com';
const PER_DAY = 80;                      // audit emails in any 24 hours, whatever happens
const SAME_ADDRESS_DAYS = 7;             // one audit email per address per week
const FU1_AFTER = 44 * 3600e3, FU2_AFTER = 5.8 * 24 * 3600e3, FU_GAP = 3 * 24 * 3600e3, FU_STALE = 21 * 24 * 3600e3;
const SEND_HOURS = [9, 18];              // Eastern, Monday to Friday, for follow-ups

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const one = s => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const firstName = n => one(n).split(' ')[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30);
const PLANS = ['Starter', 'Growth', 'Pro'];
const planOf = p => PLANS.find(x => new RegExp('^' + x, 'i').test(String(p || ''))) || '';
const startLink = p => SITE + '/start' + (planOf(p) ? '?plan=' + planOf(p) : '');

const ready = new WeakSet();
export async function ensureLeadMail(env) {
  if (ready.has(env.DB)) return;
  for (const col of ['audit', 'audit_at', 'grade', 'top', 'fu1_at', 'fu2_at', 'stop', 'stop_at']) {
    try { await env.DB.prepare('ALTER TABLE leads ADD COLUMN ' + col + ' TEXT').run(); } catch (e) { /* already there */ }
  }
  ready.add(env.DB);
}

// The stop link: a short signature of the lead id, so nobody can stop someone else's emails by guessing numbers.
async function sig(env, id) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.LEADS_KEY || env.IP_SALT || 'always-open')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('stop:' + id)));
  return [...mac.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function stopLink(env, id) { return SITE + '/lead/stop?i=' + encodeURIComponent(id) + '&k=' + (await sig(env, id)); }

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
export function auditMail(lead, a, stop, env) {
  const es = lead.lang === 'es', b = a.business || {}, first = firstName(lead.name), name = one(b.name || lead.business);
  const fixes = topThree(a), pitch = pitchFor(b.name, b.type || lead.type);
  const ft = footer(env || {}, stop, es), gc = GC[a.grade] || '#C4271B', start = startLink(lead.plan);
  const own = b.reviews ? (es ? b.rating.toFixed(1) + ' estrellas de ' + b.reviews + ' reseñas en Google hoy' : b.rating.toFixed(1) + ' stars from ' + b.reviews + (b.reviews === 1 ? ' review' : ' reviews') + ' on Google today')
    : (es ? 'todavía sin reseñas en Google' : 'no Google reviews yet');
  const areas = (a.areas || []).map(x => ({ label: es ? (AREA_ES[x.label] || x.label) : x.label, grade: x.grade }));
  const items = fixes.map(f => es && ES[f.title] ? { title: ES[f.title][0], saw: '', fix: ES[f.title][1] } : f);
  const subject = es ? 'Su auditoría gratis: ' + name + ' saca una ' + a.grade : 'Your free audit: ' + name + ' gets a ' + a.grade;
  const T = es ? {
    hi: first ? 'Hola, ' + first + ':' : 'Hola:',
    intro: 'Aquí está la auditoría gratis que pidió. Buscamos ' + name + ' en Google hace un minuto y la comparamos con los negocios como el suyo con más movimiento cerca de usted.',
    gradeLab: 'cómo lo ven quienes buscan en Google', fixH: 'Lo primero que arreglaríamos', none: 'No hay nada importante que arreglar, y eso es raro.',
    fine: 'Ya está bien: ', doH: 'Lo que haríamos por ' + name, approve: ' Usted aprueba todo desde su teléfono; nada sale a su nombre sin su visto bueno.',
    page: 'El día 2 de cada mes recibe una página que muestra lo que hicimos y cuánto valió. Vea un ejemplo:', start: 'Empezar mi primer mes',
    promise: 'Pruébelo un mes. Si no vale la pena, no lo paga. Sin contrato y sin cargo de instalación.',
    max: '¿Quiere oír cómo se contestarían sus llamadas? Llame a Max, nuestra línea, al ' + MAX + ', a cualquier hora.',
    q: '¿Preguntas? Responda a este correo. Katie contesta, normalmente el mismo día hábil.', src: 'Calificaciones y número de reseñas de Google Maps, consultados hoy.'
  } : {
    hi: first ? 'Hi ' + first + ',' : 'Hi,',
    intro: 'Here’s the free audit you asked for. We looked up ' + name + ' on Google a minute ago and compared it with the busiest nearby businesses like yours.',
    gradeLab: 'how you look to people searching Google', fixH: 'The three things we’d fix first', none: 'There’s nothing major to fix, which is rare.',
    fine: 'Already good: ', doH: 'What we’d do for ' + name, approve: ' You approve everything from your phone; nothing goes out in your name without your OK.',
    page: 'On the 2nd of every month you’d get one page showing what we did and what it was worth. Here’s a sample:', start: 'Start my first month',
    promise: 'Try it for a month. If it’s not worth it, you don’t pay for it. No contract and no setup fee.',
    max: 'Want to hear how your calls would be answered? Call Max, our phone line, at ' + MAX + ', any hour.',
    q: 'Questions? Just reply to this email. Katie answers, usually the same business day.', src: 'Ratings and review counts are from Google Maps, looked up today.'
  };
  const pitchText = es ? 'Contestamos cada reseña con un borrador para su visto bueno, mantenemos su perfil de Google al día y contestamos cada llamada a su nombre, de día y de noche, con Max, nuestra línea telefónica. Después de cada trabajo llamamos para ver si todo quedó bien, damos seguimiento a cotizaciones y facturas, y llenamos los días libres con sus propios clientes.' : pitch.text;
  const html = shell(
    '<p style="margin:0 0 12px">' + esc(T.hi) + '</p><p style="margin:0 0 18px">' + esc(T.intro) + '</p>' +
    '<div style="border:2px solid ' + gc + ';border-radius:14px;padding:14px 18px;margin:0 0 14px"><p style="margin:0;font-size:13px;color:#586075">' + esc(name) + ' · ' + esc(T.gradeLab) + '</p>' +
    '<p style="margin:4px 0 0;font-size:40px;line-height:1;font-weight:800;color:' + gc + '">' + esc(a.grade) + ' <span style="font-size:15px;font-weight:600;color:#586075">' + a.score + (es ? ' de 100' : ' of 100') + '</span></p>' +
    (areas.length ? '<p style="margin:10px 0 0;font-size:14px">' + areas.map(x => '<b style="color:' + (GC[x.grade] || '#C4271B') + '">' + esc(x.grade) + '</b> ' + esc(x.label)).join(' &nbsp;·&nbsp; ') + '</p>' : '') +
    '<p style="margin:6px 0 0;font-size:14px;color:#586075">' + esc(own) + '</p></div>' +
    '<h2 style="font-size:18px;margin:22px 0 8px">' + esc(T.fixH) + '</h2>' +
    (items.length ? '<ol style="margin:0;padding-left:22px">' + items.map(f => '<li style="margin:0 0 10px"><b>' + esc(f.title) + '.</b> ' + esc(f.saw) + '<br><span style="color:#1C6B54;font-weight:600">' + esc(f.fix) + '</span></li>').join('') + '</ol>' : '<p style="margin:0">' + esc(T.none) + '</p>') +
    ((a.fine || []).length && !es ? '<p style="margin:8px 0 0;color:#1C6B54;font-size:14px">' + esc(T.fine + a.fine.slice(0, 4).join('; ') + '.') + '</p>' : '') +
    '<h2 style="font-size:18px;margin:24px 0 8px">' + esc(T.doH) + '</h2><p style="margin:0">' + esc(pitchText + T.approve) + '</p>' +
    '<p style="margin:12px 0 0">' + esc(T.page) + ' <a href="' + SITE + '/sample-report" style="color:#D92D20">' + SITE.replace('https://', '') + '/sample-report</a></p>' +
    btn(start, T.start) + '<p style="margin:0 0 14px;font-weight:600">' + esc(T.promise) + '</p>' +
    '<p style="margin:0 0 14px">' + esc(T.max) + '</p><p style="margin:0">' + esc(T.q) + '</p><p style="margin:16px 0 0">Always Open</p>' +
    '<p style="margin:18px 0 0;font-size:12px;color:#6B7280">' + esc(T.src) + '</p>' + ft.html);
  const text = [T.hi, '', T.intro, '', name + ': ' + a.grade + ' (' + a.score + (es ? ' de 100' : ' of 100') + '), ' + T.gradeLab + '.',
    areas.map(x => x.label + ' ' + x.grade).join(' · '), own, '', T.fixH + ':',
    ...(items.length ? items.map((f, i) => (i + 1) + '. ' + f.title + '. ' + (f.saw ? f.saw + ' ' : '') + f.fix) : [T.none]), '',
    T.doH + ': ' + pitchText + T.approve, '', T.page + ' ' + SITE + '/sample-report', '', T.start + ': ' + start, T.promise, '', T.max, '', T.q, '', 'Always Open', '', T.src].join('\n') + ft.text;
  return { subject, html, text };
}

// When Google can't find the business from what they typed.
export function missMail(lead, stop, env) {
  const es = lead.lang === 'es', first = firstName(lead.name), biz = one(lead.business) || (es ? 'su negocio' : 'your business');
  const ft = footer(env || {}, stop, es), start = startLink(lead.plan);
  const subject = es ? 'Su auditoría gratis: una pregunta rápida' : 'Your free audit: one quick question';
  const lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:',
    'Buscamos ' + biz + (lead.town ? ' en ' + one(lead.town) : '') + ' en Google y no encontramos una coincidencia exacta. Responda a este correo con el nombre como aparece en Google, o con el enlace a su perfil, y le mandamos la auditoría de inmediato. Si no, Katie la busca a mano y se la manda en un día hábil.',
    'Mientras tanto, así se ve la página que recibe cada mes: ' + SITE + '/sample-report',
    '¿Quiere oír cómo se contestarían sus llamadas? Llame a Max, nuestra línea, al ' + MAX + '.', 'Always Open']
    : [first ? 'Hi ' + first + ',' : 'Hi,',
    'We looked for ' + biz + (lead.town ? ' in ' + one(lead.town) : '') + ' on Google and couldn’t find an exact match. Reply with the name as it shows on Google, or a link to your profile, and your audit comes right back. Otherwise Katie will look it up by hand and send it within one business day.',
    'In the meantime, here’s the one page you’d get every month: ' + SITE + '/sample-report',
    'Want to hear how your calls would be answered? Call Max, our phone line, at ' + MAX + '.', 'Always Open'];
  const html = shell(lines.slice(0, -1).map(l => '<p style="margin:0 0 14px">' + esc(l).replace(SITE + '/sample-report', '<a href="' + SITE + '/sample-report" style="color:#D92D20">' + SITE.replace('https://', '') + '/sample-report</a>') + '</p>').join('') +
    btn(start, es ? 'Empezar mi primer mes' : 'Start my first month') + '<p style="margin:0">Always Open</p>' + ft.html);
  return { subject, html, text: lines.join('\n\n') + '\n\n' + (es ? 'Empezar' : 'Start') + ': ' + start + ft.text };
}

// The two follow-ups. n: 1 or 2. top: the first fix from the audit, when there was one.
export function followMail(lead, n, stop, env, top) {
  const es = lead.lang === 'es', first = firstName(lead.name), biz = one(lead.business) || (es ? 'su negocio' : 'your business');
  const ft = footer(env || {}, stop, es), start = startLink(lead.plan), g = lead.grade ? ' ' + lead.grade : '';
  let subject, lines;
  if (n === 1) {
    subject = es ? 'Re: Su auditoría gratis de ' + biz : 'Re: Your free audit for ' + biz;
    lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:', '¿Pudo ver la auditoría? Lo más rápido que mejoraría ' + biz + (top && ES[top.title] ? ': ' + ES[top.title][1].charAt(0).toLowerCase() + ES[top.title][1].slice(1) : ' es contestar cada reseña y cada llamada.') + ' Es lo que hacemos la primera semana.',
      'Empezar: ' + start, 'O responda con una pregunta; Katie contesta, normalmente el mismo día hábil.', 'Always Open']
      : [first ? 'Hi ' + first + ',' : 'Hi,', 'Did you get a chance to look at the audit? The quickest win for ' + biz + (top && top.fix ? ': ' + top.fix.charAt(0).toLowerCase() + top.fix.slice(1) : ' is a reply to every review and an answer to every call.') + ' That’s the kind of thing we start on in week one.',
      'Start your first month: ' + start, 'Or reply with a question. Katie answers, usually the same business day.', 'Always Open'];
  } else {
    subject = es ? 'Última nota sobre la auditoría de ' + biz : 'Last note on ' + biz + '’s audit';
    lines = es ? [first ? 'Hola, ' + first + ':' : 'Hola:', 'Última nota de nuestra parte. Si las reseñas, las llamadas y los seguimientos se le acumulan, nosotros nos encargamos, y el día 2 de cada mes recibe una página con lo que hicimos y cuánto valió.',
      'Pruébelo un mes. Si no vale la pena, no lo paga: ' + start, 'O llame a Max al ' + MAX + ' para oír cómo se contestarían sus llamadas. De cualquier forma, la auditoría' + g + ' es suya.', 'Always Open']
      : [first ? 'Hi ' + first + ',' : 'Hi,', 'Last note from us. If reviews, calls and follow-ups are piling up, we take them off your plate, and on the 2nd of every month you get one page showing what we did and what it was worth.',
      'Try it for a month. If it’s not worth it, you don’t pay for it: ' + start, 'Or call Max at ' + MAX + ' to hear how your calls would be answered. Either way, the audit is yours to keep.', 'Always Open'];
  }
  const linkify = l => esc(l).replace(esc(start), '<a href="' + esc(start) + '" style="color:#D92D20">' + esc(start.replace('https://', '')) + '</a>');
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

// Right after a website request is saved. lead: the form fields; id: the leads row. h: {run, send, ping} for tests.
export async function sendAudit(env, lead, id, h) {
  h = h || {};
  await ensureLeadMail(env);
  const email = one(lead.email).toLowerCase();
  if (!id || !/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(email)) return 'no email';
  const now = Date.now(), iso = new Date(now).toISOString();
  // Kept: our own grade and our own words for the first fix (never Google's numbers), for the day-2 follow-up.
  const mark = (state, grade, top) => env.DB.prepare('UPDATE leads SET audit = ?1, audit_at = ?2, grade = ?3, top = ?4 WHERE id = ?5').bind(state, iso, grade || '', top || '', id).run().catch(() => {});
  const dup = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE lower(email) = ?1 AND id != ?2 AND audit IN ('sent', 'missed') AND audit_at > ?3").bind(email, id, new Date(now - SAME_ADDRESS_DAYS * 864e5).toISOString()).first().catch(() => null);
  if (dup && dup.n) { await mark('repeat'); return 'repeat'; }
  const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE audit IN ('sent', 'missed') AND audit_at > ?1").bind(new Date(now - 864e5).toISOString()).first().catch(() => null);
  if (day && day.n >= PER_DAY) { await mark('held: daily limit'); if (h.ping) await h.ping('Audit emails paused for today', 'More than ' + PER_DAY + ' audit emails in 24 hours. ' + one(lead.business) + ' will need a hand-sent audit.'); return 'limited'; }
  const stop = await stopLink(env, id);
  let a = null, err = '';
  if (one(lead.business).length >= 2) {
    try { a = await (h.run || runAudit)(env, one(lead.business), one(lead.town)); } catch (e) { err = one((e && e.message) || e).slice(0, 120); }
  }
  const found = a && a.found;
  const m = found ? auditMail(lead, a, stop, env) : missMail(lead, stop, env);
  const r = await send(env, email, m, h);
  if (r !== 'sent') { await mark('failed'); if (h.ping) await h.ping('Audit email did not send', one(lead.business) + ': ' + r + '. Send the audit by hand.'); return r; }
  const f0 = found && a.findings && a.findings[0];
  await mark(found ? 'sent' : 'missed', found ? a.grade : '', f0 ? JSON.stringify({ title: f0.title, fix: f0.fix }) : '');
  if (!found && h.ping) await h.ping('Audit needs a hand: ' + one(lead.business), (err ? 'Google lookup failed (' + err + '). ' : 'Google had no match for "' + one(lead.business) + (lead.town ? ', ' + one(lead.town) : '') + '". ') + 'They got an email saying Katie will send it within one business day.');
  return found ? 'sent' : 'missed';
}

// /lead/stop?i=&k= : one tap, no questions.
export async function handleStop(req, env, url) {
  await ensureLeadMail(env);
  const id = String(url.searchParams.get('i') || ''), k = String(url.searchParams.get('k') || '');
  const page = (t, p) => new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(t) + '</title></head><body style="margin:0;background:#0F131B;color:#ECEEF3;font:17px/1.55 system-ui,sans-serif"><main style="max-width:520px;margin:0 auto;padding:48px 20px"><h1 style="font-size:1.6rem;margin:0 0 10px">' + esc(t) + '</h1><p style="color:#A3ACBF">' + esc(p) + '</p><p><a href="/" style="color:#FF8C82">Always Open</a></p></main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (!/^\d{1,12}$/.test(id) || k !== await sig(env, id)) return page('That link didn’t work', 'Reply to any of our emails with “stop” and we won’t email you again.');
  await env.DB.prepare("UPDATE leads SET stop = 'unsubscribed', stop_at = ?1 WHERE id = ?2 AND (stop IS NULL OR stop = '')").bind(new Date().toISOString(), id).run();
  return page('Done. No more emails.', 'We won’t email you again about the audit. If you ever want to talk, call (706) 460-2226.');
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
  const iso = t => new Date(t).toISOString();
  const rows = ((await env.DB.prepare("SELECT * FROM leads WHERE status = 'new' AND audit IN ('sent', 'missed') AND (stop IS NULL OR stop = '') AND (fu2_at IS NULL OR fu2_at = '') AND audit_at > ?1 ORDER BY id LIMIT 40")
    .bind(iso(now - FU_STALE)).all()).results) || [];
  let sent = 0, stopped = 0;
  for (const r of rows) {
    const auditAt = Date.parse(r.audit_at || r.at), fu1 = r.fu1_at ? Date.parse(r.fu1_at) : 0;
    const n = !fu1 ? (now - auditAt >= FU1_AFTER ? 1 : 0) : (now - auditAt >= FU2_AFTER && now - fu1 >= FU_GAP ? 2 : 0);
    if (!n) continue;
    // Signed up already (same email, or same business name)? Then they're a client, not a lead.
    const won = await env.DB.prepare("SELECT 1 AS x FROM billing WHERE lower(email) = ?1 OR (?2 != '' AND lower(business) = ?2) LIMIT 1").bind(one(r.email).toLowerCase(), one(r.business).toLowerCase()).first().catch(() => null);
    if (won) { await env.DB.prepare("UPDATE leads SET stop = 'signed up', stop_at = ?1 WHERE id = ?2").bind(iso(now), r.id).run(); stopped++; continue; }
    const stop = await stopLink(env, r.id);
    let top = null; try { top = r.top ? JSON.parse(r.top) : null; } catch (e) { top = null; }
    const m = followMail(r, n, stop, env, top);
    const s = await send(env, one(r.email).toLowerCase(), m, h);
    if (s !== 'sent') continue;
    await env.DB.prepare('UPDATE leads SET ' + (n === 1 ? 'fu1_at' : 'fu2_at') + ' = ?1 WHERE id = ?2').bind(iso(now), r.id).run();
    sent++;
  }
  return { sent, stopped };
}
