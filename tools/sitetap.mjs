// Draws the Shoulder Tap band into the site pages, between <!-- tap:start --> and <!-- tap:end -->, right after the
// "Tap to try it" front (and Max's clock, where a page has it). Run after changing the copy below, and after
// tools/phone.mjs (which rewrites each page's Spanish block): node tools/sitetap.mjs
// The band is self-contained (its own <style> and <script>): a made-up call plays out next to the owner's own phone, so
// a visitor watches the question go out and the answer come back. Each trade page gets a question its callers ask.
// It is open on the home page and folded on the trade pages (tools/phone.mjs keeps the fold line; the phone check holds
// the heights). Not on the insurance and dental pages: on those lines Max takes a message and the office calls back.
import { readFileSync, writeFileSync } from 'node:fs';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One call per page: what the caller asks, what the owner texts back, and how Max passes it on.
const SCENES = {
  index: {
    en: { q: 'Can you fit me in today?', reply: 'Yes, 4:30', relay: 'I just heard back from Dana: she can see you at four thirty today.', close: 'Perfect. See you then.' },
    es: { q: '¿Me pueden atender hoy?', reply: 'Sí, 4:30', relay: 'Ya me respondió Dana: puede atenderle hoy a las cuatro y media.', close: 'Perfecto. Ahí estaré.' } },
  plumbing: {
    en: { q: 'Can somebody come out tonight?', reply: 'Yes, 7', relay: 'I just heard back from Dana: she can be there at seven tonight.', close: 'Thank goodness. Seven works.' },
    es: { q: '¿Puede venir alguien esta noche?', reply: 'Sí, a las 7', relay: 'Ya me respondió Dana: puede estar ahí a las siete de la noche.', close: 'Qué alivio. A las siete está bien.' } },
  hvac: {
    en: { q: 'Can you get someone here today? It’s 88 in the house.', reply: 'Yes, by 5', relay: 'I just heard back from Dana: someone will be there by five today.', close: 'Great. We’ll be here.' },
    es: { q: '¿Puede venir alguien hoy? Hay 88 grados en la casa.', reply: 'Sí, antes de las 5', relay: 'Ya me respondió Dana: alguien estará ahí hoy antes de las cinco.', close: 'Muy bien. Aquí estaremos.' } },
  builders: {
    en: { q: 'Can somebody come look at it this week?', reply: 'Thursday 9', relay: 'I just heard back from Dana: she can come look Thursday at nine.', close: 'Thursday at nine works.' },
    es: { q: '¿Puede venir alguien a verlo esta semana?', reply: 'Jueves 9', relay: 'Ya me respondió Dana: puede ir a verlo el jueves a las nueve.', close: 'El jueves a las nueve está bien.' } },
  'auto-repair': {
    en: { q: 'If I tow it in, can you look at it today?', reply: 'Yes, if it’s here by 2', relay: 'I just heard back from Dana: yes, if it’s here by two, they’ll look at it today.', close: 'Calling the tow truck now.' },
    es: { q: 'Si lo mando en grúa, ¿lo pueden revisar hoy?', reply: 'Sí, si llega antes de las 2', relay: 'Ya me respondió Dana: sí, si llega antes de las dos, lo revisan hoy.', close: 'Ya estoy llamando a la grúa.' } },
  marine: {
    en: { q: 'Can you fix my boat lift before Saturday?', reply: 'Friday morning', relay: 'I just heard back from Dana: she can be there Friday morning.', close: 'Friday morning is perfect.' },
    es: { q: '¿Pueden arreglar mi elevador de lancha antes del sábado?', reply: 'Viernes en la mañana', relay: 'Ya me respondió Dana: puede ir el viernes por la mañana.', close: 'El viernes por la mañana es perfecto.' } },
  marinas: {
    en: { q: 'Is there a slip open this weekend for a 24-foot pontoon?', reply: 'Yes, B-12', relay: 'I just heard back from Dana: yes, slip B twelve is open this weekend.', close: 'We’ll take it.' },
    es: { q: '¿Hay un muelle libre este fin de semana para un pontón de 24 pies?', reply: 'Sí, el B-12', relay: 'Ya me respondió Dana: sí, el muelle B doce está libre este fin de semana.', close: 'Lo tomamos.' } },
  salons: {
    en: { q: 'Can you squeeze me in today for a cut?', reply: '3:15 with Jo', relay: 'I just heard back from Dana: Jo can take you at three fifteen.', close: 'I’ll be there.' },
    es: { q: '¿Me pueden hacer un espacio hoy para un corte?', reply: '3:15 con Jo', relay: 'Ya me respondió Dana: Jo puede atenderle a las tres y cuarto.', close: 'Ahí estaré.' } },
  restaurants: {
    en: { q: 'Can you seat twelve tonight at seven?', reply: 'Yes, the back room', relay: 'I just heard back from Dana: yes, twelve at seven, in the back room.', close: 'Wonderful. See you at seven.' },
    es: { q: '¿Tienen mesa para doce esta noche a las siete?', reply: 'Sí, el salón del fondo', relay: 'Ya me respondió Dana: sí, doce a las siete, en el salón del fondo.', close: 'Maravilloso. Nos vemos a las siete.' } }
};
// The eight things that appear, in order: [where it shows, who says it, the clock on the call when it does].
// call = the caller's line with Max; you = the owner's own phone.
const STEPS = [['call', 'c', '0:06'], ['call', 'm', '0:11'], ['you', 't', '0:13'], ['call', 'c', '0:19'], ['you', 'o', '0:31'], ['call', 'k', '0:34'], ['call', 'c', '0:41'], ['res', 'r', '0:41']];
function lines(key, lang) {
  const s = SCENES[key][lang];
  return lang === 'es'
    ? [s.q, 'Déjeme consultarlo con Dana ahora mismo. ¿Y su nombre?', 'Max: Llamada en vivo del (478) 555-0142.\nPregunta: “' + s.q + '”\nResponda a este mensaje ahora y Max se lo dice.', 'Priya Shah.', s.reply, s.relay, s.close, 'Resuelto en 41 segundos. Nadie tuvo que devolver ninguna llamada.']
    : [s.q, 'Let me check with Dana right now. And your name?', 'Max: Live call from (478) 555-0142.\nThey ask: “' + s.q + '”\nReply to this text now and Max tells them.', 'Priya Shah.', s.reply, s.relay, s.close, 'Settled in 41 seconds. Nobody had to call anybody back.'];
}
const COPY = {
  en: {
    eyebrow: 'Shoulder Tap', h: 'Max taps your shoulder. You answer with your thumb.',
    lead: 'Some questions only you can answer. Can you come today. What will it cost. Do you even do that. Every answering service says someone will call back, and the caller dials the next name on the list. Max keeps them on the line and texts you the question. You reply. He tells them, in the same call.',
    leadPh: 'A caller asks something only you know. Max keeps them on the line and texts you the question. You reply, and he tells them. No reply in a minute, and he promises a call back, same as always.',
    facts: [['1 text', 'to answer. No app to open and nothing to learn. Reply the way you would to anyone.'], ['1 minute', 'is how long Max waits, taking their name and number while he does. No reply, and he promises a call back, same as always.'], ['0 guesses', 'Max never makes up a price or a time. He says what you said.']],
    one: '<b>The same ninth inning.</b> Your phone buzzes once. You type two words and look back up. The caller has an answer before the next pitch.',
    oneTrade: '<b>You stay on the job.</b> Your phone buzzes once. You type a few words and get back to it. The caller has an answer before your phone is back in your pocket.',
    where: 'You choose when he may ask: daytime, any hour, or never. In your app the same question shows on the live call with one-tap answers, and <b>Take the call</b> puts them through to you. On every plan.',
    cap: 'A made-up call. For insurance, medical and legal offices, Max takes the message and you call back.',
    go: 'Get yours', lcall: 'On the line with Max', lyou: 'Your phone', fold: 'Max asks you mid-call. You answer by text.',
    aria: l => 'Example: a caller asks Max, “' + l[0] + '” Max says he is checking with the owner and keeps taking details. The owner gets the question as a text and replies “' + l[4] + '”. Max tells the caller: ' + l[5]
  },
  es: {
    eyebrow: 'Shoulder Tap', h: 'Max le toca el hombro. Usted contesta con el pulgar.',
    lead: 'Hay preguntas que solo usted puede contestar. Si puede ir hoy. Cuánto va a costar. Si hace ese trabajo. Cualquier servicio de contestación dice que alguien devolverá la llamada, y el cliente marca el siguiente nombre de la lista. Max lo mantiene en la línea y le manda la pregunta a usted por mensaje. Usted responde. Él se lo dice, en la misma llamada.',
    leadPh: 'Un cliente pregunta algo que solo usted sabe. Max lo mantiene en la línea y le manda la pregunta por mensaje. Usted responde y él se lo dice. Si no hay respuesta en un minuto, promete que usted devolverá la llamada, como siempre.',
    facts: [['1 mensaje', 'para contestar. Sin abrir ninguna aplicación ni aprender nada. Responda como le respondería a cualquiera.'], ['1 minuto', 'es lo que Max espera, mientras toma el nombre y el número. Si no hay respuesta, promete que usted devolverá la llamada, como siempre.'], ['0 inventos', 'Max nunca inventa un precio ni una hora. Dice lo que usted dijo.']],
    one: '<b>La misma novena entrada.</b> Su teléfono vibra una vez. Usted escribe dos palabras y vuelve a mirar el juego. El cliente tiene su respuesta antes del siguiente lanzamiento.',
    oneTrade: '<b>Usted sigue en lo suyo.</b> Su teléfono vibra una vez. Escribe unas palabras y vuelve al trabajo. El cliente tiene su respuesta antes de que usted guarde el teléfono.',
    where: 'Usted decide cuándo puede preguntarle: de día, a cualquier hora o nunca. En su aplicación, la misma pregunta aparece sobre la llamada en vivo con respuestas de un toque, y <b>Tomar la llamada</b> se la pasa a usted. En todos los planes.',
    cap: 'Una llamada de ejemplo. En oficinas de seguros, médicas y legales, Max toma el mensaje y usted devuelve la llamada.',
    go: 'Quiero el mío', lcall: 'En la línea con Max', lyou: 'Su teléfono', fold: 'Max le pregunta durante la llamada. Usted contesta por mensaje.',
    aria: l => 'Ejemplo: un cliente le pregunta a Max: “' + l[0] + '” Max dice que lo consulta con la dueña y sigue tomando los datos. La dueña recibe la pregunta por mensaje y responde “' + l[4] + '”. Max le dice al cliente: ' + l[5]
  }
};

const css =
  '.tapband{padding-block:88px;background:linear-gradient(180deg,var(--night) 0%,var(--night-2) 100%);color:var(--night-ink);position:relative;border-top:1px solid var(--night-line)}' +
  '.tapband::before{content:"";position:absolute;inset:0;background:radial-gradient(48% 52% at 14% 18%,rgba(92,201,164,.11),transparent 70%);pointer-events:none}' +
  '.tapband .inner{position:relative}.tapband .eyebrow{color:var(--night-sign)}.tapband h2{font-size:clamp(2.2rem,6vw,3.6rem);line-height:1.02;max-width:11em}' +
  '.tapgrid{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;margin-top:34px}' +
  '.tapcopy{display:grid;gap:16px;align-content:start}.tapcopy p.lead{color:var(--night-mute);font-size:1.12rem;max-width:31em;margin:0}' +
  '.tapfacts{list-style:none;margin:0;padding:0;display:grid;gap:10px}.tapfacts li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline;font-size:1.02rem}' +
  '.tapfacts li b{font-family:var(--display);font-stretch:92%;font-weight:850;font-size:1.6rem;line-height:1;color:#fff;text-shadow:0 0 12px rgba(255,255,255,.25);min-width:5.4em}.tapfacts li:first-child b{color:#7EE0BE;text-shadow:0 0 12px rgba(92,201,164,.6)}.tapfacts li:last-child b{color:var(--night-sign);text-shadow:0 0 12px rgba(255,106,94,.7)}' +
  '.tapone{margin:0;padding:14px 16px;border-radius:14px;border:1px solid rgba(92,201,164,.45);background:rgba(92,201,164,.07);box-shadow:0 0 18px rgba(92,201,164,.12);font-size:1rem;line-height:1.45}.tapone b{color:#7EE0BE;text-shadow:0 0 8px rgba(92,201,164,.5)}' +
  '.tapwhere{margin:0;color:var(--night-mute);font-size:.98rem;max-width:32em}.tapwhere b{color:var(--night-ink)}' +
  '.tapcopy .ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}' +
  '.tapstage{display:grid;gap:14px;justify-items:center}' +
  '.tapphone{width:min(410px,100%);padding:14px;border-radius:30px;display:grid;gap:10px;border:1.5px solid rgba(255,106,94,.5);background:radial-gradient(60% 30% at 50% 0%,rgba(255,90,77,.1),transparent 70%),var(--night-card);box-shadow:0 0 0 1px rgba(255,106,94,.14),0 0 34px rgba(255,90,77,.26),inset 0 0 24px rgba(255,90,77,.05)}' +
  '.tappane{display:flex;flex-direction:column;gap:7px;padding:12px;border-radius:18px;background:#0B0F16;border:1px solid #1F2636}' +
  '.tappane .ph{display:flex;justify-content:space-between;gap:10px;margin-bottom:2px;font:500 12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--night-mute)}.tappane .ph i{font-style:normal;color:var(--night-sign)}.tappane.you .ph i{color:#7EE0BE}' +
  '.tb{max-width:88%;margin:0;padding:9px 12px;border-radius:16px;font-size:15px;line-height:1.38;white-space:pre-line;overflow-wrap:anywhere}' +
  '.tb.c,.tb.t{align-self:flex-start;background:#1F2533;color:#ECEEF3;border-bottom-left-radius:5px}.tb.m,.tb.k{align-self:flex-end;background:#ECEEF3;color:#171B26;border-bottom-right-radius:5px}' +
  '.tb.k{background:var(--night-sign);color:#1A0605;font-weight:600;box-shadow:0 0 18px rgba(255,90,77,.5)}.tb.o{align-self:flex-end;background:#5CC9A4;color:#06231A;font-weight:600;border-bottom-right-radius:5px}' +
  '.tapres{margin:0;padding:10px 12px;border-radius:12px;border:1px dashed rgba(92,201,164,.55);color:#7EE0BE;font:500 13px var(--mono);text-align:center}' +
  '.tapstage .tapcap{margin:0;font:400 12px var(--mono);color:var(--night-mute);text-align:center;max-width:400px}' +
  // the play-through: each piece is in place from the start (no jumping), and shows when its moment comes
  '.tapphone.play [data-i]{opacity:0;transform:translateY(6px)}.tapphone.play [data-i].on{opacity:1;transform:none;transition:opacity .35s ease,transform .35s ease}' +
  '.tapphone.play .tappane.you.buzz{animation:tapBuzz .45s linear}@keyframes tapBuzz{0%,100%{transform:none}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}' +
  '.tapcopy p.lead-ph{display:none}' +
  '@media (max-width:900px){.tapgrid{grid-template-columns:1fr;gap:28px}.tapband{padding-block:64px}.tapstage{order:-1}.tapfacts li b{min-width:4.6em;font-size:1.4rem}}' +
  // phones: the call itself, one short paragraph and the button; the rest is on the wider page and in the app
  '@media (max-width:760px){.tapband{padding-block:52px}.tapband h2{font-size:2.05rem}.tapgrid{margin-top:22px;gap:22px}.tapcopy p.lead,.tapfacts,.tapone,.tapwhere{display:none}.tapcopy p.lead-ph{display:block;margin:0;color:var(--night-mute);font-size:1.06rem}.tapphone{padding:11px;border-radius:26px}.tapcopy .ctas .btn{flex:1 1 auto}}';

// The play-through, as it runs in the page: only while the band is on screen, never for a visitor who asked for less
// motion (they see the whole exchange at once), and in Spanish when the page is switched to Spanish.
function play() {
  var root = document.getElementById('tap'); if (!root) return;
  var ph = root.querySelector('.tapphone'), data; if (!ph) return;
  try { data = JSON.parse(root.querySelector('script[type="application/json"]').textContent); } catch (e) { return; }
  var els = [].slice.call(ph.querySelectorAll('[data-i]')).sort(function (a, b) { return a.getAttribute('data-i') - b.getAttribute('data-i'); });
  var clock = ph.querySelector('[data-t]'), you = ph.querySelector('.tappane.you'), stage = root.querySelector('.tapstage');
  var lang = function () { return document.documentElement.lang === 'es' ? 'es' : 'en'; };
  function words() { var L = data[lang()]; els.forEach(function (el, i) { el.textContent = L.lines[i]; }); if (stage) stage.setAttribute('aria-label', L.aria); var a = ph.querySelector('[data-l="call"]'), b = ph.querySelector('[data-l="you"]'); if (a) a.textContent = L.lcall; if (b) b.textContent = L.lyou; }
  words();
  try { window.addEventListener('ao:lang', words); } catch (e) { /* older browsers keep English */ }
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;
  var WAIT = [700, 1400, 1500, 1300, 1700, 1300, 1500, 1200], HOLD = 5200, at = -1, timer = 0, seen = false;
  function step() {
    timer = 0; if (!seen) return;
    at++;
    if (at >= els.length) { timer = setTimeout(function () { els.forEach(function (el) { el.classList.remove('on'); }); if (clock) clock.textContent = '0:00'; at = -1; timer = setTimeout(step, 700); }, HOLD); return; }
    var el = els[at]; el.classList.add('on');
    if (clock) clock.textContent = data.t[at];
    if (el.classList.contains('t') && you) { you.classList.remove('buzz'); void you.offsetWidth; you.classList.add('buzz'); }
    timer = setTimeout(step, WAIT[at + 1] || 1200);
  }
  ph.classList.add('play');
  new IntersectionObserver(function (es) { es.forEach(function (x) { seen = x.isIntersecting; if (seen && !timer) timer = setTimeout(step, at < 0 ? WAIT[0] : 400); }); }, { threshold: 0.35 }).observe(ph);
}

function section(key) {
  const c = COPY.en, L = lines(key, 'en'), Les = lines(key, 'es');
  const piece = i => { const [, who] = STEPS[i]; return who === 'r' ? '<p class="tapres" data-i="' + i + '">' + esc(L[i]) + '</p>' : '<p class="tb ' + who + '" data-i="' + i + '">' + esc(L[i]) + '</p>'; };
  const pane = where => STEPS.map((s, i) => s[0] === where ? piece(i) : '').join('');
  const data = { t: STEPS.map(s => s[2]), en: { lines: L, aria: c.aria(L), lcall: c.lcall, lyou: c.lyou }, es: { lines: Les, aria: COPY.es.aria(Les), lcall: COPY.es.lcall, lyou: COPY.es.lyou } };
  const go = key === 'index' ? '/#contact' : '/?from=' + key + '#contact';
  return `<!-- tap:start -->
<section class="tapband band" id="tap" data-label="Shoulder Tap" data-fold-title="Shoulder Tap"${key === 'index' ? '' : ' data-fold="' + esc(c.fold) + '"'} aria-labelledby="tap-h">
  <style>${css}</style>
  <div class="inner">
    <div class="head"><p class="eyebrow">${esc(c.eyebrow)}</p><h2 id="tap-h">${esc(c.h)}</h2></div>
    <div class="tapgrid">
      <div class="tapcopy">
        <p class="lead">${esc(c.lead)}</p>
        <p class="lead-ph">${esc(c.leadPh)}</p>
        <ul class="tapfacts">${c.facts.map(f => '<li><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span></li>').join('')}</ul>
        <p class="tapone">${key === 'index' ? c.one : c.oneTrade}</p>
        <p class="tapwhere">${c.where}</p>
        <div class="ctas"><a class="btn primary" href="${go}">${esc(c.go)}</a></div>
      </div>
      <div class="tapstage" role="img" aria-label="${esc(c.aria(L))}">
        <div class="tapphone">
          <div class="tappane call"><div class="ph"><span data-l="call">${esc(c.lcall)}</span><i data-t>0:41</i></div>${pane('call')}</div>
          <div class="tappane you"><div class="ph"><span data-l="you">${esc(c.lyou)}</span><i>1 text</i></div>${pane('you')}</div>
          ${pane('res')}
        </div>
        <p class="tapcap">${esc(c.cap)}</p>
      </div>
    </div>
  </div>
  <script type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
  <script>(${play.toString()})();</script>
</section>
<!-- tap:end -->
`;
}
// The band's own words in Spanish, for the page's ES/EN switch (the block tools/phone.mjs writes; entries that start
// with #tap are ours and are replaced on every run). The call itself changes language inside the band's script.
function spanish(key) {
  const c = COPY.es;
  return [
    { s: '#tap-h', h: esc(c.h) }, { s: '#tap .lead', h: esc(c.lead) }, { s: '#tap .lead-ph', h: esc(c.leadPh) },
    { s: '#tap .tapfacts', h: c.facts.map(f => '<li><b>' + esc(f[0]) + '</b><span>' + esc(f[1]) + '</span></li>').join('') },
    { s: '#tap .tapone', h: key === 'index' ? c.one : c.oneTrade }, { s: '#tap .tapwhere', h: c.where }, { s: '#tap .tapcap', h: esc(c.cap) }, { s: '#tap .ctas a', h: esc(c.go) }
  ];
}

export const TAP_PAGES = ['index', 'plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas', 'salons', 'restaurants'];
export const TAP_FOLD = COPY.en.fold;

if (import.meta.url === 'file://' + process.argv[1]) {
  for (const key of TAP_PAGES) {
    const f = 'public/' + key + '.html';
    let s = readFileSync(f, 'utf8');
    const sec = section(key);
    if (s.includes('<!-- tap:start -->')) s = s.replace(/<!-- tap:start -->[\s\S]*?<!-- tap:end -->\n?/, () => sec);
    else {
      const at = s.indexOf('<!--/ao:front-->');
      if (at < 0) { console.log('skip (no front band):', f); continue; }
      const j = at + '<!--/ao:front-->'.length;
      s = s.slice(0, j) + '\n' + sec + s.slice(j).replace(/^\n/, '');
    }
    // Spanish: our entries in the page's swap list
    const m = s.match(/(<script type="application\/json" id="ao-es">)([\s\S]*?)(<\/script>)/);
    if (!m) { console.log('no Spanish block in', f, '(run tools/phone.mjs first)'); process.exitCode = 1; }
    else {
      const list = JSON.parse(m[2]).filter(e => !/^#tap\b/.test(e.s)).concat(spanish(key));
      s = s.replace(m[0], () => m[1] + JSON.stringify(list).replace(/</g, '\\u003c') + m[3]);
    }
    writeFileSync(f, s);
    console.log('Shoulder Tap drawn into', f);
  }
}
