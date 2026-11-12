// Draws "What you control" into the site pages, between <!-- yours:start --> and <!-- yours:end -->, right before the
// plans. Run after changing the copy below, and after tools/phone.mjs (which rewrites each page's Spanish block and
// keeps this band's fold line): node tools/sitecontrols.mjs
// Why it exists (Nov 11, 2026): the site showed what Max does, but not the switches an owner gets. Every line here is a
// real control in the client app (src/apppage.js, src/bizpage.js, src/duties.js, src/outcalls.js), in the app's own
// words. test/sitecontrols.test.js fails when the app drops or renames one, so the site can't promise a switch that
// is gone. Insurance and dental get the shorter list: on those lines Max takes a message, and booking, calls out and
// customer texts are off (app.js features()). "Try the sample app" opens the sample account (/demo, src/demo.js):
// a made-up plumber's app where nothing can be sent or changed. Not on the office pages: the sample shows booking.
import { readFileSync, writeFileSync } from 'node:fs';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// [heading, [lines]]. A line is plain text; a leading "Pro: " or "Growth: " becomes the plan tag.
const FULL = {
  en: {
    eyebrow: 'You’re in charge', h: 'You set the rules. Max follows them on the next call.',
    lead: 'Everything here is a switch or a box in your app. Change one and it applies to the very next call. You don’t file a request and you don’t wait on us.',
    fold: 'Every switch you get in the app, in one list.',
    groups: [
      ['What Max says', [
        'Your hours, and what to tell callers: specials, how you book, where you work, what to steer clear of.',
        'His name and his voice. Call him something else and pick the voice you like.',
        'Your own greeting. Write the words, or record up to 15 seconds in your own voice.',
        'Tell Max something. Type it, or text it to your business number: “Closed Friday. No jobs in Macon this week.” Text UNDO to take it back.',
        'Spanish. Max answers Spanish-speaking callers in Spanish.'
      ]],
      ['What Max may do on a call', [
        'Answer during business hours too, when you can’t get to the phone.',
        'Give your standard prices, and only the ones you list.',
        'Ask when they last had work done, and who did it.',
        'Mention your service plan once, when it fits.',
        'Tell callers how you take payment.',
        'Turn away work outside your area, or take the message and let you decide.',
        'Put a caller through to your cell: never, only when it’s urgent, or whenever they ask.',
        'Text you a caller’s question while they wait: daytime, any hour, or never.'
      ]],
      ['Teach Max your business', [
        'Have Max call you. He asks seven short questions, about three minutes, and shows you what he heard.',
        'Nothing changes until you tap Looks right. Or skip the call and type it in.',
        'He uses it to answer price, area and urgent questions, instead of only taking a message.'
      ]],
      ['Booking', [
        'Pick one: Max books an open time, pencils one in and we confirm by text, or takes a message.',
        'How long a visit takes, the time between visits, and the days and hours you take them.',
        'Connect your Google Calendar so he never books over your own plans.',
        'A booking link and a request link to send customers or put on your website.'
      ]],
      ['After the call', [
        'A text after every call: who called, what they need, how urgent, and their number to tap.',
        'Pro: Promise a call-back time. If it passes, Max calls them to set a new one.',
        'Pro: A text to anyone who hangs up before leaving a message.',
        'Pro: A check-in call a few days after a job, to ask if the work held up.'
      ]],
      ['Calls Max makes for you', [
        'Ring your phone the moment a call is urgent.',
        'A one-minute rundown call at 7 AM with the day’s visits and call-backs.',
        'Confirm appointments the day before.',
        'Offer a new time when a customer misses a visit.',
        'Call the customer when you tap On my way.',
        'Follow up on an estimate after three days.',
        'Offer the next visit six months after a job.'
      ], 'Each one has its own switch. Only customers who said calls are OK, never between 9 PM and 8 AM, and anyone who says stop is never called again.'],
      ['From your phone, any time', [
        'Turn Max off and back on with one switch.',
        'Closed today. Max tells callers, and we mark you closed on Google.',
        'Holiday or new hours, sent in two lines.',
        'Growth: Send a photo. We write the post and send it back for your OK.',
        'Growth: Finished a job. The customer gets one note asking for a Google review.',
        'Approve, edit or skip every reply and post before it goes out.',
        'Your review QR code, with a card to print for the counter or the truck.',
        'A link for each person on your team, and a list of who did what.',
        'Text Katie. A person on our team answers.'
      ]]
    ],
    foot: 'The plans below show what comes with each one.', go: 'Get started', demo: 'Try the sample app'
  },
  es: {
    eyebrow: 'Usted manda', h: 'Usted pone las reglas. Max las sigue en la siguiente llamada.',
    lead: 'Todo lo de esta lista es un interruptor o una casilla en su aplicación. Cambie uno y se aplica en la siguiente llamada. No tiene que pedirlo ni esperarnos.',
    fold: 'Todos los interruptores que tiene en la aplicación, en una lista.',
    groups: [
      ['Lo que dice Max', [
        'Su horario, y qué decirles a los clientes: ofertas, cómo agenda, dónde trabaja, qué evitar.',
        'Su nombre y su voz. Póngale otro nombre y elija la voz que le guste.',
        'Su propio saludo. Escriba las palabras, o grabe hasta 15 segundos con su propia voz.',
        'Dígale algo a Max. Escríbalo, o mándelo por mensaje al número de su negocio: “Cerrado el viernes. Esta semana no hay trabajos en Macon.” Mande UNDO para deshacerlo.',
        'Español. Max atiende en español a quienes hablan español.'
      ]],
      ['Lo que Max puede hacer en una llamada', [
        'Contestar también en horario de trabajo, cuando usted no alcanza el teléfono.',
        'Dar sus precios fijos, y solo los que usted anote.',
        'Preguntar cuándo fue el último trabajo, y quién lo hizo.',
        'Mencionar su plan de servicio una vez, cuando venga al caso.',
        'Decir cómo acepta pagos.',
        'Rechazar trabajos fuera de su zona, o tomar el mensaje y que usted decida.',
        'Pasarle la llamada a su celular: nunca, solo si es urgente, o cuando lo pidan.',
        'Mandarle por mensaje la pregunta de un cliente mientras espera: de día, a cualquier hora o nunca.'
      ]],
      ['Enséñele su negocio a Max', [
        'Pida que Max lo llame. Hace siete preguntas cortas, unos tres minutos, y le muestra lo que entendió.',
        'Nada cambia hasta que usted toca Looks right. O sáltese la llamada y escríbalo.',
        'Lo usa para contestar preguntas de precio, zona y urgencias, en vez de solo tomar el mensaje.'
      ]],
      ['Citas', [
        'Elija una: Max agenda una hora libre, aparta una y nosotros confirmamos por mensaje, o toma el mensaje.',
        'Cuánto dura una visita, el tiempo entre visitas, y los días y horas en que las recibe.',
        'Conecte su Google Calendar para que nunca agende encima de sus planes.',
        'Un enlace para citas y otro para solicitudes, para mandar a clientes o poner en su sitio web.'
      ]],
      ['Después de la llamada', [
        'Un mensaje después de cada llamada: quién llamó, qué necesita, qué tan urgente es, y su número para tocar.',
        'Pro: Prometer una hora para devolver la llamada. Si pasa, Max los llama para fijar otra.',
        'Pro: Un mensaje a quien cuelga antes de dejar recado.',
        'Pro: Una llamada unos días después del trabajo, para saber si quedó bien.'
      ]],
      ['Llamadas que Max hace por usted', [
        'Llamarle a usted en cuanto una llamada es urgente.',
        'Una llamada de un minuto a las 7 AM con las visitas y llamadas pendientes del día.',
        'Confirmar citas el día anterior.',
        'Ofrecer otra hora cuando un cliente falta a una visita.',
        'Llamar al cliente cuando usted toca On my way.',
        'Dar seguimiento a un presupuesto a los tres días.',
        'Ofrecer la siguiente visita seis meses después de un trabajo.'
      ], 'Cada una tiene su interruptor. Solo a clientes que aceptaron llamadas, nunca entre las 9 PM y las 8 AM, y a quien dice que pare no se le vuelve a llamar.'],
      ['Desde su teléfono, a cualquier hora', [
        'Apagar y encender a Max con un interruptor.',
        'Cerrado hoy. Max se lo dice a quien llama, y nosotros lo marcamos cerrado en Google.',
        'Horario de días festivos o nuevo horario, en dos líneas.',
        'Growth: Mande una foto. Escribimos la publicación y se la devolvemos para su aprobación.',
        'Growth: Trabajo terminado. El cliente recibe una nota pidiendo una reseña en Google.',
        'Aprobar, editar o saltar cada respuesta y publicación antes de que salga.',
        'Su código QR para reseñas, con una tarjeta para imprimir y poner en el mostrador o la camioneta.',
        'Un enlace para cada persona de su equipo, y una lista de quién hizo qué.',
        'Escríbale a Katie. Le contesta una persona de nuestro equipo.'
      ]]
    ],
    foot: 'Los planes de abajo muestran qué incluye cada uno.', go: 'Empezar', demo: 'Pruebe la aplicación de muestra'
  }
};

// Insurance and dental offices: Max takes a message and the office calls back, so the list is what they can still set.
const OFFICE = {
  en: {
    eyebrow: 'You’re in charge', h: 'You set the rules. Max follows them on the next call.',
    lead: 'Everything here is a switch or a box in your app. Change one and it applies to the very next call. On your line Max takes the message and your office calls back, so there is nothing here about booking or calling customers.',
    fold: 'Every switch you get in the app, in one list.',
    groups: [
      ['What Max says', [
        'Your hours, and what to tell callers.',
        'His name and his voice. Call him something else and pick the voice you like.',
        'Your own greeting. Write the words, or record up to 15 seconds in your own voice.',
        'Tell Max something. Type it, or text it to your business number: “Closed Friday.” Text UNDO to take it back.',
        'Spanish. Max answers Spanish-speaking callers in Spanish.'
      ]],
      ['What Max may do on a call', [
        'Answer during business hours too, when the front desk can’t get to the phone.',
        'Put a caller through to a number you choose: never, only when it’s urgent, or whenever they ask.',
        'Tell callers how you take payment.'
      ]],
      ['From your phone, any time', [
        'Turn Max off and back on with one switch.',
        'Closed today. Max tells callers, and we mark you closed on Google.',
        'Holiday or new hours, sent in two lines.',
        'Approve, edit or skip every reply and post before it goes out.',
        'Your review QR code, with a card to print for the counter or the truck.',
        'A link for each person on your team, and a list of who did what.',
        'Text Katie. A person on our team answers.'
      ]]
    ],
    foot: 'The plans below show what comes with each one.', go: 'Get started', demo: 'Try the sample app'
  },
  es: {
    eyebrow: 'Usted manda', h: 'Usted pone las reglas. Max las sigue en la siguiente llamada.',
    lead: 'Todo lo de esta lista es un interruptor o una casilla en su aplicación. Cambie uno y se aplica en la siguiente llamada. En su línea Max toma el mensaje y su oficina devuelve la llamada, así que aquí no hay nada sobre citas ni llamadas a clientes.',
    fold: 'Todos los interruptores que tiene en la aplicación, en una lista.',
    groups: [
      ['Lo que dice Max', [
        'Su horario, y qué decirles a quienes llaman.',
        'Su nombre y su voz. Póngale otro nombre y elija la voz que le guste.',
        'Su propio saludo. Escriba las palabras, o grabe hasta 15 segundos con su propia voz.',
        'Dígale algo a Max. Escríbalo, o mándelo por mensaje al número de su negocio: “Cerrado el viernes.” Mande UNDO para deshacerlo.',
        'Español. Max atiende en español a quienes hablan español.'
      ]],
      ['Lo que Max puede hacer en una llamada', [
        'Contestar también en horario de trabajo, cuando la recepción no alcanza el teléfono.',
        'Pasar la llamada a un número que usted elija: nunca, solo si es urgente, o cuando lo pidan.',
        'Decir cómo acepta pagos.'
      ]],
      ['Desde su teléfono, a cualquier hora', [
        'Apagar y encender a Max con un interruptor.',
        'Cerrado hoy. Max se lo dice a quien llama, y nosotros lo marcamos cerrado en Google.',
        'Horario de días festivos o nuevo horario, en dos líneas.',
        'Aprobar, editar o saltar cada respuesta y publicación antes de que salga.',
        'Su código QR para reseñas, con una tarjeta para imprimir y poner en el mostrador o la camioneta.',
        'Un enlace para cada persona de su equipo, y una lista de quién hizo qué.',
        'Escríbale a Katie. Le contesta una persona de nuestro equipo.'
      ]]
    ],
    foot: 'Los planes de abajo muestran qué incluye cada uno.', go: 'Empezar', demo: 'Pruebe la aplicación de muestra'
  }
};

export const YOURS_PAGES = ['index', 'plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas', 'salons', 'restaurants', 'dental', 'insurance'];
export const OFFICE_PAGES = ['dental', 'insurance'];
export const YOURS_FOLD = FULL.en.fold;
export const copyFor = key => OFFICE_PAGES.includes(key) ? OFFICE : FULL;

const css =
  '.yours{padding-block:84px;border-top:1px solid var(--line)}.yours .head{max-width:760px}.yours .head p.lead{color:var(--slate);font-size:1.08rem;margin:12px 0 0}' +
  '.yg{columns:3;column-gap:16px;margin-top:30px}' +
  '.yg section{break-inside:avoid;margin:0 0 16px;border:1px solid var(--line);border-radius:16px;background:var(--card);padding:18px 18px 16px}' +
  '.yg h3{margin:0 0 10px;font-family:var(--display);font-stretch:92%;font-weight:800;font-size:1.18rem;line-height:1.2}' +
  '.yg ul{list-style:none;margin:0;padding:0;display:grid;gap:9px}.yg li{position:relative;padding-left:18px;font-size:1rem;line-height:1.42}' +
  '.yg li::before{content:"";position:absolute;left:0;top:.58em;width:8px;height:8px;border-radius:50%;background:var(--ok)}' +
  '.yg li i{font:500 12px var(--mono);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:var(--sign);margin-right:6px;white-space:nowrap}' +
  '.yg p.yn{margin:12px 0 0;color:var(--slate);font-size:.95rem;line-height:1.42}' +
  '.yfoot{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;margin-top:26px}.yfoot p{margin:0;color:var(--slate);font-size:1rem}' +
  '@media (max-width:1000px){.yg{columns:2}}' +
  '@media (max-width:760px){.yours{padding-block:52px}.yg{columns:1;margin-top:20px}.yg section{margin-bottom:12px}.yg li,.yg p.yn,.yfoot p{font-size:16px}.yfoot .btn{flex:1 1 auto}}';

const li = t => { const m = /^(Pro|Growth): (.*)$/.exec(t); return '<li>' + (m ? '<i>' + m[1] + '</i>' + esc(m[2]) : esc(t)) + '</li>'; };
const groupHtml = g => '<section><h3>' + esc(g[0]) + '</h3><ul>' + g[1].map(li).join('') + '</ul>' + (g[2] ? '<p class="yn">' + esc(g[2]) + '</p>' : '') + '</section>';

export function section(key) {
  const c = copyFor(key).en;
  const go = key === 'index' ? '/#contact' : '/?from=' + key + '#contact';
  return `<!-- yours:start -->
<section class="yours band" id="yours" data-label="You’re in charge" data-fold-title="What you control" data-fold="${esc(c.fold)}" aria-labelledby="yours-h">
  <style>${css}</style>
  <div class="inner">
    <div class="head"><p class="eyebrow">${esc(c.eyebrow)}</p><h2 id="yours-h">${esc(c.h)}</h2><p class="lead">${esc(c.lead)}</p></div>
    <div class="yg">${c.groups.map(groupHtml).join('')}</div>
    <div class="yfoot"><p>${esc(c.foot)}</p><a class="btn primary" href="${go}">${esc(c.go)}</a>${OFFICE_PAGES.includes(key) ? '' : '<a class="btn line ydemo" href="/demo" rel="nofollow">' + esc(c.demo) + '</a>'}</div>
  </div>
</section>
<!-- yours:end -->
`;
}
// The band's words in Spanish, for the page's ES/EN switch (entries that start with #yours are ours).
export function spanish(key) {
  const c = copyFor(key).es;
  return [
    { s: '#yours .eyebrow', h: esc(c.eyebrow) }, { s: '#yours-h', h: esc(c.h) }, { s: '#yours .lead', h: esc(c.lead) },
    { s: '#yours .yg', h: c.groups.map(groupHtml).join('') }, { s: '#yours .yfoot p', h: esc(c.foot) }, { s: '#yours .yfoot a.primary', h: esc(c.go) }
  ].concat(OFFICE_PAGES.includes(key) ? [] : [{ s: '#yours .ydemo', h: esc(c.demo) }]);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  for (const key of YOURS_PAGES) {
    const f = 'public/' + key + '.html';
    let s = readFileSync(f, 'utf8');
    const sec = section(key);
    if (s.includes('<!-- yours:start -->')) s = s.replace(/<!-- yours:start -->[\s\S]*?<!-- yours:end -->\n?/, () => sec);
    else {
      // right before the plans
      const m = /<section\b[^>]*\bid="(?:pricing|plans)"/.exec(s);
      if (!m) { console.log('skip (no plans section):', f); process.exitCode = 1; continue; }
      s = s.slice(0, m.index) + sec + s.slice(m.index);
    }
    const m = s.match(/(<script type="application\/json" id="ao-es">)([\s\S]*?)(<\/script>)/);
    if (!m) { console.log('no Spanish block in', f, '(run tools/phone.mjs first)'); process.exitCode = 1; }
    else {
      const list = JSON.parse(m[2]).filter(e => !/^#yours\b/.test(e.s)).concat(spanish(key));
      s = s.replace(m[0], () => m[1] + JSON.stringify(list).replace(/</g, '\\u003c') + m[3]);
    }
    writeFileSync(f, s);
    console.log('What you control drawn into', f);
  }
}
