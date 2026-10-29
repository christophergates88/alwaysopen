// The Spanish version of the public pages, next to the English they replace. tools/phone.mjs writes these into each page
// as one JSON block that the ES/EN switch in the header swaps in place (no second page, no duplicate URLs).
// Usted throughout, plain Latin American Spanish, the same promises as the English and nothing more.
// Each entry: s = CSS selector (first match), and one of
//   h: the element's HTML (a leading icon is kept)   t: its first line of text (for labels around an input)
//   p: an input's placeholder                        o: an option's words (the value sent stays English)
//   a: attributes, e.g. { 'aria-label': '...' }
const PROMISE = 'Pruébelo un mes. Si no vale la pena, no lo paga.';
export const ES_LINE = { en: 'Max answers in English and Spanish. Your callers pick.', es: 'Max contesta en inglés y en español. Quien llama elige.' };

const NAV = { 'What we do': 'Qué hacemos', 'Call Max': 'Llame a Max', 'Your business': 'Su negocio', 'A day with us': 'Un día con nosotros', 'Only here': 'Solo aquí', 'Pricing': 'Precios', 'Add-ons': 'Extras',
  'Questions': 'Preguntas', 'Free audit': 'Auditoría gratis', 'Calls': 'Llamadas', 'Estimates': 'Presupuestos', 'Quotes': 'Cotizaciones', 'Finished jobs': 'Trabajos terminados',
  'Finished repairs': 'Reparaciones terminadas', 'Appointments': 'Citas', 'After a visit': 'Después de la visita', 'Catering': 'Banquetes', 'Reviews and posts': 'Reseñas y publicaciones',
  'After hours': 'Fuera de horario', 'Reviews': 'Reseñas', 'The math': 'Las cuentas', 'Plans': 'Planes', 'Compliance Guard': 'Compliance Guard', 'Rate-Shock Radar': 'Rate-Shock Radar' };
export const NAV_ES = NAV;

const bub = (k, t) => '<div class="bub ' + k + '">' + t + '</div>';
const card = (small, b, span, acts) => '<div class="card"><small>' + small + '</small><b>' + b + '</b><span>' + span + '</span>' + (acts ? '<div class="acts"><span>' + acts[0] + '</span><span class="alt">' + acts[1] + '</span></div>' : '') + '</div>';
const scene = (n, h3, aria, scn, why) => [
  { s: '#only .onlygrid > .scene:nth-child(' + n + ') h3', h: h3 },
  { s: '#only .onlygrid > .scene:nth-child(' + n + ') .scn', h: scn, a: { 'aria-label': aria } },
  { s: '#only .onlygrid > .scene:nth-child(' + n + ') .why', h: why }
];
const PLANS = [
  { name: 'Starter', price: '$149', per: 'Unos $5 al día', for: 'Cada reseña contestada. Hasta la del martes.', btn: ['line', 'Empezar con Starter'], items: [
    'Max, su asistente telefónico, contesta sus llamadas de día y de noche (300 minutos al mes)', 'Todas las reseñas en un solo lugar, cada una con respuesta', 'Aviso de reseñas malas el mismo día',
    'Perfil de Google al día, una publicación por semana', 'Informe mensual de una página', 'Un registro mensual de cada respuesta y publicación', 'Respuestas en español',
    'Su propia app: apruebe respuestas y publicaciones con un toque, vea su mes y escríbanos'] },
  { name: 'Growth', price: '$299', per: 'Unos $10 al día', for: 'A cada cliente se le pide reseña. Cada publicación, escrita. Usted toca OK.', btn: ['primary', 'Empezar con Growth'], items: [
    '<li class="plus">Todo lo de Starter, más:</li>', 'Solicitudes de reseña después de cada trabajo', 'Publicaciones en Facebook e Instagram con sus fotos<span class="soon" data-launch="meta">Próximamente</span>',
    'Los mismos datos en cada directorio<span class="soon">Próximamente</span>', 'Reservas en línea y solicitudes de cotización', 'Cada cliente potencial registrado', 'Vigilancia de la competencia',
    'Storm Desk: una publicación lista cuando llega un aviso del clima a su condado', 'Respuestas a reseñas escritas con su estilo',
    'Lo que dicen de usted los asistentes: una revisión mensual de lo que los asistentes les dicen a los clientes, y corregimos lo que esté mal'] },
  { name: 'Pro', price: '$499', per: 'Unos $16 al día', for: 'Su propio número, y nada se queda sin respuesta.', btn: ['line', 'Empezar con Pro'], note: 'Lo marcado como próximamente se activa en cuanto sale. Los mensajes de texto también necesitan que las compañías telefónicas aprueben el número de su negocio, normalmente unas dos semanas.', items: [
    '<li class="plus">Todo lo de Growth, más:</li>', 'Su propio número de negocio', 'Mensaje automático por llamada perdida', 'Seguimiento de cotizaciones y clientes potenciales',
    'Llamadas de vuelta con hora fija. Si a usted se le pasa, Max llama para poner otra', 'La llamada de los tres días: Max llama al cliente, y un no le llega a usted antes de que se convierta en reseña',
    'Pases: si alguien necesita otro oficio, Max lo comunica con un negocio cercano en Always Open, y ese negocio le puede mandar trabajo a usted', 'Confirmaciones y recordatorios de citas',
    'Recordatorios de facturas y pagos', 'Recordatorios de temporada y a clientes anteriores, pedidos de referidos',
    'Llene mi semana: un día libre en su calendario se les ofrece a clientes anteriores que aceptaron mensajes, y el primer sí queda reservado'] }
];
const planHtml = p => '<h3>' + p.name + '</h3><div class="price"><b>' + p.price + '</b><span>/ mes</span></div><p class="perday">' + p.per + '</p><p class="for">' + p.for + '</p><ul>' +
  p.items.map(i => /^<li/.test(i) ? i : '<li>' + i + '</li>').join('') + '</ul>' + (p.note ? '<p class="plan-note">' + p.note + '</p>' : '') + '<a class="btn ' + p.btn[0] + '" href="/start?plan=' + p.name + '">' + p.btn[1] + '</a>';

export const ES_HOME = [
  { s: 'header.hero h1', h: 'Su negocio, <em>siempre</em> abierto.' },
  { s: 'header.hero .hero-scene', h: 'Parte baja de la novena. Su hijo va al bate. Un cliente está llamando, acaba de llegar una reseña y una cotización se quedó en silencio. Nos encargamos de las tres. Usted no se pierda la jugada.' },
  { s: 'header.hero .lede', h: 'Always Open lleva la parte de atrás de su negocio, la que nunca cierra: cada llamada contestada, cada reseña respondida, cotizaciones y facturas con seguimiento, días vacíos llenados con su propia lista de clientes, su perfil de Google al día y un mapa que le manda a quienes llaman cerca de usted. Max es la voz al teléfono. El resto es un equipo que trabaja mientras usted trabaja. <b>Usted lo aprueba todo desde su teléfono.</b>' },
  { s: 'header.hero .lede-ph', h: 'Llamadas, reseñas, seguimientos, su calendario y su perfil de Google, resueltos. Usted lo aprueba desde su teléfono.' },
  { s: 'header.hero .ctas a.ph-only', h: 'Ver mi calificación' },
  { s: 'header.hero .ctas a[href="#contact"]', h: 'Quiero mi auditoría gratis' },
  { s: '#heroCall span', h: 'Llame a Max. Lo retamos.' },
  { s: 'header.hero .promise > span', h: PROMISE },
  { s: 'header.hero p.fine', h: 'Sin cargo de instalación · Mes a mes · Inglés y español' },
  { s: 'header.hero .onlylink', h: 'Todo lo que hacemos, en una pantalla <span aria-hidden="true">&darr;</span>' },
  { s: '#only .head .eyebrow', h: 'Solo aquí' },
  { s: '#only .head h2', h: 'Seis cosas que nadie más hace.' },
  { s: '#only .head > p:not(.eyebrow)', h: 'Contestar reseñas y llamadas es lo mínimo. Estas son las partes que construimos porque los negocios pequeños seguían perdiendo los mismos trabajos de la misma manera.' },
  ...scene(1, 'Pases entre negocios', 'Ejemplo: Max le dice a quien llama que el negocio no hace trabajos eléctricos y lo comunica con Lane Electric, un negocio cercano en Always Open.',
    bub('in', '¿Ustedes hacen trabajos eléctricos? Se me sigue botando el breaker.') + bub('out', 'Nosotros no hacemos electricidad, pero Lane Electric, a dos millas de aquí, también está en Always Open. ¿Quiere que lo comunique?') + bub('in', 'Sí, por favor.') + bub('sys', 'Comunicado con Lane Electric · 2:14 PM'),
    'Alguien necesita un trabajo que usted no hace. Max lo comunica con un negocio cercano en Always Open, y ese negocio le puede mandar trabajo a usted. Los dos tienen que activarlo.'),
  ...scene(2, 'La llamada de los tres días', 'Ejemplo: Max llama a una clienta tres días después de instalar un calentador de agua, ella marca 1 porque todo sigue bien, y se envía una solicitud de reseña.',
    bub('sys', 'Max llamó a Dana · jueves 11:20 AM') + bub('out', 'Una pregunta rápida: ¿el calentador de agua sigue funcionando bien? Marque 1 si sí, 2 si algo no está bien.') + bub('sys', 'Marcó 1') + card('Siguiente', 'Solicitud de reseña enviada a Dana', 'Un solo mensaje, porque ella aceptó recibir mensajes.'),
    'Tres días después del trabajo, Max llama al cliente: ¿todo sigue bien? Un sí se convierte en la solicitud de reseña. Un no le llega primero a usted, antes de que se convierta en una reseña.'),
  ...scene(3, 'Llamadas de vuelta con hora fija', 'Ejemplo: Max le ofrece a quien llama que el dueño le devuelva la llamada a las 4:15 PM, la persona acepta y el dueño recibe una tarjeta para llamar.',
    bub('in', '¿Me puede llamar el dueño?') + bub('out', 'Sam está en un trabajo en Greensboro. Lo llama a las 4:15. ¿Le queda bien?') + bub('in', 'A las 4:15 está bien.') + card('En su teléfono', 'Llamar a Priya a las 4:15 PM', 'Se bota el breaker · 478-555-0142', ['Llamar ahora', 'Cambiar hora']),
    'Se acabó el “alguien le va a llamar”. Max da una hora según su calendario. Si a usted se le pasa, él llama para poner otra.'),
  ...scene(4, 'Llene mi semana', 'Ejemplo: un mensaje le ofrece a una clienta anterior un espacio libre el jueves, ella contesta SÍ y queda reservado en el calendario.',
    bub('out', 'Hola Dana, le escribe Sinclair Plumbing. Sam tiene libre el jueves a las 9 AM y pensó en usted por la instalación de su calentador de agua en enero pasado. ¿Lo quiere? Conteste SÍ u otra hora que le convenga.') + bub('in', 'SÍ') + bub('sys', 'Reservado · jueves 9:00 AM · en su Google Calendar'),
    'El jueves está libre en su calendario. Se lo ofrecemos a clientes anteriores a los que ya les toca y que aceptaron recibir mensajes. El primer sí queda reservado.'),
  ...scene(5, 'Storm Desk', 'Ejemplo: un aviso de tormenta para el condado de Putnam genera una publicación lista que espera su aprobación.',
    bub('sys', 'Aviso de tormenta eléctrica severa · condado de Putnam · 3:12 PM') + card('Publicación · esperando su OK', 'Tormenta esta noche en el condado de Putnam', 'Si una rama tumba un cable o se cae un árbol, contestamos el teléfono toda la noche. Cuídense y llámenos en la mañana.', ['Aprobar', 'Editar']),
    'Cuando hay un aviso del clima en su condado, en ese mismo minuto se redacta una publicación para el día de tormenta. Usted la aprueba desde donde esté.'),
  ...scene(6, 'Lo que dicen de usted los asistentes', 'Ejemplo: un asistente le da a un cliente un número viejo sacado de Yelp, y la revisión mensual lo detecta y lo corrige.',
    bub('in', '¿Cuál es el número de Sinclair Plumbing en Eatonton?') + bub('out', '478-555-0100, según Yelp.') + card('La revisión de este mes', 'Teléfono equivocado en Yelp', 'Ese es el número viejo. Lo corregimos en Yelp, y ahora el asistente lo nombra a usted primero entre los plomeros de Eatonton.'),
    'Los clientes les preguntan a los asistentes a quién llamar. Una vez al mes les preguntamos por usted y corregimos lo que digan mal, desde donde se origine.'),
  { s: '#only p.sample', h: 'Ejemplo: negocio, clientes y llamadas inventados.' },
  { s: '#only .alsoonly', h: '<b>También solo aquí</b><p><a href="#regulated">Compliance Guard</a> revisa cada palabra antes de que salga a su nombre, así que agencias de seguros y consultorios también pueden usarnos. <a href="/map">El mapa de Always Open</a> muestra cada negocio de Always Open, el más cercano primero. <a href="#rules">Full Max</a> deja que lo rutinario salga sin que usted toque nada, cuando usted lo diga. Todos los planes contestan en español, sin costo extra.</p>' },
  { s: '#pricing .head .eyebrow', h: 'Precios' },
  { s: '#pricing .head h2', h: 'Pruébelo un mes. Si no vale la pena, no lo paga.' },
  { s: '#pricing .head > p:not(.eyebrow)', h: 'Sin contrato y sin cargo de instalación. Starter cuesta unos $5 al día. Cancele desde la app y cambie de plan cualquier mes. <a href="#worth" style="color:inherit;text-underline-offset:3px">¿Vale la pena? Haga las cuentas.</a>' },
  ...PLANS.map((p, i) => ({ s: '#pricing .plans > .plan:nth-child(' + (i + 1) + ')', h: planHtml(p) })),
  { s: '#pricing .setup', h: '<b>Sin cargo de instalación</b><span>Su auditoría, su enlace de solicitudes, su enlace de reservas y su app funcionan desde el primer día. En cuanto nos invite a su perfil de Google, lo dejamos en orden. Incluido en todos los planes.</span>' },
  { s: '#pricing .guarantee', h: '<b>30 días, sin riesgo.</b><p>Si el primer mes no vale la pena, avísenos y se lo reembolsamos. Sin formularios ni discusiones. Y no hay cargo de instalación.</p>' },
  { s: '#contact .who .eyebrow', h: 'Empecemos' },
  { s: '#contact .who h2', h: 'Cuéntenos de su negocio.' },
  { s: '#contact .who > p:not(.eyebrow):not(.callus):not(.addr)', h: 'Mande el formulario corto. Le respondemos en un día hábil, y su auditoría gratis llega en dos. Sin presión y sin tarjeta.' },
  { s: '#contact .callus', h: '¿Prefiere hablar? Llame al <a href="tel:+17064602226">(706) 460-2226</a>. Max, nuestro asistente telefónico, contesta a cualquier hora y toma sus datos, y alguien de nuestro equipo le devuelve la llamada en un día hábil.' },
  { s: '#contact .founding', h: '<b>Pruébelo un mes. Si no vale la pena, no lo paga.</b><p style="margin-top:4px">Sin contrato y sin cargo de instalación. Cancele desde la app.</p>' },
  { s: 'label[for="f-name"]', t: 'Su nombre' }, { s: 'label[for="f-phone"]', t: 'Teléfono' }, { s: 'label[for="f-email"]', t: 'Correo electrónico' },
  { s: 'label[for="f-biz"]', t: 'Nombre del negocio' }, { s: 'label[for="f-town"]', t: 'Ciudad' }, { s: 'label[for="f-type"]', t: '¿Qué tipo de negocio?' },
  { s: 'label[for="f-plan"]', t: 'Plan' }, { s: 'label[for="f-link"]', t: 'Perfil de Google o sitio web (opcional)' }, { s: 'label[for="f-note"]', t: '¿Algo más?' },
  { s: '#f-link', p: 'Pegue un enlace si tiene uno' }, { s: '#f-note', p: 'Llamadas fuera de horario, Google Ads, un problema que quiera resolver primero' },
  ...['Contratista u oficio', 'Muelles, marina o exteriores', 'Salón, spa o gimnasio', 'Restaurante o tienda', 'Consultorio médico, dental o veterinario', 'Agencia de seguros', 'Bienes raíces o alquileres', 'Otro']
    .map((o, i) => ({ s: '#f-type option:nth-child(' + (i + 1) + ')', o })),
  { s: '#f-plan option:nth-child(1)', o: 'Todavía no sé' },
  { s: '#lead .optin > span', h: 'Envíenme mensajes de texto de Always Open sobre mi solicitud. Pueden aplicar tarifas de mensajes y datos. La frecuencia de los mensajes varía. Responda STOP para no recibir más y HELP para ayuda. No hace falta aceptar para recibir su auditoría. <a href="privacy.html" target="_blank" rel="noopener">Política de privacidad</a> y <a href="terms.html" target="_blank" rel="noopener">Términos</a>.' },
  { s: '#lead .fineprint', h: 'Al enviar esto acepta nuestros <a href="terms.html">Términos</a> y nuestra <a href="privacy.html">Política de privacidad</a>. Solo usamos sus datos para responderle.' },
  { s: '#lead button[type="submit"]', h: 'Pedir mi auditoría gratis' }
];

// The trade pages: the hero, in each trade's own words.
const TRADE = {
  plumbing: { plural: 'plomeros y empresas de drenaje', for: 'Para plomeros y empresas de drenaje',
    h1: 'Usted está debajo de un lavabo. Una llamada nueva, una reseña nueva, una cotización sin respuesta. Nos encargamos de las tres.',
    lede: 'Llevamos la parte de atrás de una empresa de plomería mientras usted está en el trabajo: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su empresa, les dice a quienes llaman su horario y su zona de servicio, toma la dirección y lo que está pasando, y lo llama a usted si es una emergencia. Los presupuestos reciben seguimiento el día que usted elija, y cada trabajo terminado se convierte en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas, cotizaciones con seguimiento y días flojos llenados, mientras usted está debajo de un lavabo.' },
  hvac: { plural: 'empresas de calefacción y aire acondicionado', for: 'Para empresas de calefacción y aire acondicionado',
    h1: 'Julio, 98 grados, y usted está en un ático. ¿Las llamadas, las reseñas, las cotizaciones? Nos encargamos.',
    lede: 'Llevamos la parte de atrás de una empresa de calefacción y aire mientras usted está en el trabajo: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su empresa, les dice a quienes llaman su horario y su zona de servicio, toma la dirección y lo que está haciendo el sistema, y lo llama a usted si es una emergencia. Los presupuestos reciben seguimiento el día que usted elija, y cada trabajo terminado se convierte en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas, cotizaciones con seguimiento y días flojos llenados, mientras usted está en un ático.' },
  builders: { plural: 'constructores, remodeladores y contratistas', for: 'Para constructores, remodeladores y contratistas',
    h1: 'El próximo trabajo, una reseña nueva y un presupuesto sin respuesta, atendidos mientras usted construye este.',
    lede: 'Llevamos la parte de atrás de una empresa constructora mientras usted está en el trabajo: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su empresa, responde preguntas sobre sus servicios y su zona, toma los detalles del trabajo y lo llama a usted si es urgente. Las cotizaciones reciben seguimiento el día que usted elija, y cada trabajo terminado se convierte en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono</b>, entre corte y corte.',
    ph: 'Llamadas contestadas, reseñas respondidas, presupuestos con seguimiento y visitas a la obra agendadas, mientras usted está en el trabajo.' },
  'auto-repair': { plural: 'talleres mecánicos', for: 'Para talleres mecánicos',
    h1: 'Usted está debajo de un carro. Una llamada nueva, una reseña nueva, un presupuesto sin respuesta. Nos encargamos de los tres.',
    lede: 'Llevamos la parte de atrás de un taller mientras usted está en el trabajo: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su taller, da su horario y ubicación, toma el año, la marca y lo que está haciendo el carro, y lo llama a usted si alguien se quedó varado. Los presupuestos reciben seguimiento el día que usted elija, y cada reparación terminada se convierte en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas, presupuestos con seguimiento y espacios del taller llenados, mientras usted está debajo de un carro.' },
  marine: { plural: 'constructores de muelles, talleres de botes y marinas', for: 'Para constructores de muelles, talleres de botes y marinas',
    h1: 'Fin de semana de Memorial Day, en el agua. ¿Las llamadas, las reseñas, las cotizaciones en el muelle? Atendidas.',
    lede: 'Llevamos la parte de atrás de un negocio de muelles y marina mientras usted está en el trabajo: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su empresa, da su horario y su zona de servicio, toma los datos del bote, del muelle y de lo que pasa, y lo llama a usted si no puede esperar. Las cotizaciones de muelles y reparaciones reciben seguimiento el día que usted elija, y cada trabajo terminado se convierte en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas, cotizaciones con seguimiento y semanas flojas llenadas, mientras usted está en el agua.' },
  salons: { plural: 'salones, spas, gimnasios y estéticas de mascotas', for: 'Para salones, spas, gimnasios y estéticas de mascotas',
    h1: 'Tiene las manos ocupadas. Suena el teléfono, llega una reseña, el jueves tiene sillas vacías. Nos encargamos.',
    lede: 'Llevamos la parte de atrás de un salón o estudio mientras tiene las manos ocupadas: cada llamada contestada, cada reseña respondida, cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su negocio, da su horario y los precios que usted fija, toma el nombre de quien llama, el servicio y el día que quiere, y se lo manda a su teléfono en segundos. Las citas reciben confirmación el día que usted elija, y cada visita puede convertirse en una solicitud de reseña y una publicación. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas y sillas vacías llenadas con sus propios clientes, mientras usted está a mitad de un corte.' },
  restaurants: { plural: 'restaurantes, cafés y tiendas', for: 'Para restaurantes, cafés y tiendas',
    h1: 'Viernes, 7 PM, todas las mesas llenas. ¿El teléfono, las reseñas, el martes flojo de la semana que viene? Nos encargamos.',
    lede: 'Llevamos la parte de atrás de un restaurante o tienda mientras el salón está lleno: cada llamada contestada, cada reseña respondida, cotizaciones de banquetes con seguimiento y noches flojas llenadas con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su negocio, da su horario, el de los días festivos y cómo llegar, según lo que usted le diga, toma pedidos de grupos grandes y de banquetes, y se los manda a su teléfono en segundos. Las cotizaciones de banquetes reciben seguimiento el día que usted elija, cada reseña recibe respuesta y sus especiales se publican en Google. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas, reseñas respondidas, cotizaciones de banquetes con seguimiento y noches flojas llenadas, en plena hora pico.' },
  dental: { plural: 'consultorios dentales', for: 'Para consultorios dentales',
    h1: '7:50 AM. Llama un diente roto, una reseña espera respuesta, el martes no está confirmado. Atendido.',
    lede: 'Llevamos la parte de atrás de un consultorio dental mientras usted está con un paciente: cada llamada contestada, cada reseña respondida, y citas confirmadas. Al teléfono, Max contesta con el nombre de su consultorio, da su horario y ubicación, y toma un recado con el nombre, el número y lo que necesita quien llama, nada más. Nunca habla de tarifas, tratamientos ni seguros. Cada reseña recibe una respuesta cuidadosa que Compliance Guard revisa antes de que usted la vea. <b>Usted lo aprueba todo desde su teléfono.</b>',
    ph: 'Llamadas contestadas cuando la recepción no puede, reseñas respondidas y citas confirmadas. Nada dice nunca quién es paciente.' },
  insurance: { plural: 'agencias de seguros', for: 'Para agencias de seguros', h1: 'Subieron las tarifas. <span>Las reseñas vinieron después.</span>',
    lede: 'Always Open contesta cada reseña de su agencia con la redacción que aprobó su encargado de cumplimiento. Compliance Guard revisa cada respuesta antes de que usted la vea, y <b>nada se publica hasta que usted toque Aprobar</b>. Nunca vemos su lista de clientes.',
    ph: 'Llamadas fuera de horario contestadas, reseñas respondidas y su perfil de Google al día. Compliance Guard revisa cada palabra que escribimos por usted.',
    ctas: ['Ver mi calificación', 'Pedir mi auditoría gratis', 'Probar Compliance Guard'], small: 'Sin cargo de instalación y sin contrato. Respuestas en inglés y en español.' }
};
export function esTrade(key) {
  const t = TRADE[key];
  if (!t) return [];
  return [
    { s: 'header.hero .everyone', h: 'Always Open trabaja para todo tipo de negocio, en cualquier parte de EE. UU. Esta página cubre lo que más les importa a ' + t.plural + '. <a href="index.html">Vea todo lo que hacemos</a>' },
    { s: 'header.hero p.for', h: t.for }, { s: 'header.hero h1', h: t.h1 }, { s: 'header.hero .lede', h: t.lede }, { s: 'header.hero .lede-ph', h: t.ph },
    ...(t.ctas || ['Ver mi calificación', 'Quiero mi auditoría gratis', 'Llame a Max: (706) 460-2226']).map((c, i) => ({ s: 'header.hero .ctas a:nth-child(' + (i + 1) + ')', h: c })),
    { s: 'header.hero .promise > span', h: PROMISE + '<small>' + (t.small || 'Sin cargo de instalación ni contrato. Max también habla español.') + '</small>' }
  ];
}

// The playable cards and the grade check under the hero, on every page. The sample conversations inside the cards stay
// in English for now; everything around them, and the grade form, switches.
const PICK = { plumbing: 'Plomero', hvac: 'Calefacción y aire', builders: 'Constructor', 'auto-repair': 'Taller mecánico', marine: 'Muelles y marina', salons: 'Salón o gimnasio', restaurants: 'Restaurante o tienda', dental: 'Dental', insurance: 'Seguros' };
export function esFront(key) {
  const t = TRADE[key];
  const out = [
    { s: '#aos-h', h: key === 'index' || !t ? 'Lo que nadie más hace. Toque y pruébelo.' : 'Lo que nadie más hace para ' + t.plural + '. Toque y pruébelo.' },
    { s: '#go .aos-head > p', h: 'Cada tarjeta muestra una llamada, un mensaje o una publicación de un negocio inventado. Toque una opción y vea lo que pasa.' },
    { s: '#go .aos-sample', h: 'Ejemplo: negocios, clientes y llamadas inventados.' },
    { s: '#go-grade h3', h: '¿Cómo se ve su negocio en internet?' },
    { s: '#go-grade > p', h: 'Escriba el nombre de su negocio y su ciudad. Su calificación aparece aquí mismo en unos segundos.' },
    { s: 'label[for="g-q"]', t: 'Nombre del negocio' }, { s: '#g-q', p: 'Como aparece en Google' }, { s: 'label[for="g-town"]', t: 'Ciudad' },
    { s: '#go .aog-go', h: 'Ver mi calificación' },
    { s: '#go .aos-also > p', h: 'También solo aquí' },
    { s: '#go .aos-also details:nth-of-type(2) summary', h: 'El mapa de Always Open' },
    { s: '#go .aos-also details:nth-of-type(1) p', h: 'Cada palabra se revisa antes de salir a su nombre, así que agencias de seguros y consultorios también pueden usarnos.' },
    { s: '#go .aos-also details:nth-of-type(2) p', h: 'Todos los negocios de Always Open en un mapa, el más cercano primero. Nadie paga por aparecer.' },
    { s: '#go .aos-also details:nth-of-type(3) summary', h: 'Español en todos los planes' },
    { s: '#go .aos-also details:nth-of-type(3) p', h: 'Max y cada respuesta contestan en español, sin costo extra.' },
    { s: '#go .aos-modes button[data-mode="0"]', h: 'Independiente' }, { s: '#go .aos-modes button[data-mode="1"]', h: 'Con una aseguradora' }
  ];
  if (key === 'index') {
    out.push({ s: '#go .aos-pick > span', h: 'Verlo para' });
    for (const k in PICK) out.push({ s: '#go .aos-pick button[data-pick="' + k + '"]', h: PICK[k] });
  }
  return out;
}

// What Always Open does: the six pillars under the hero, on every page.
export const ES_DOES = [
  { s: '#does .eyebrow', h: 'Lo que hace Always Open' },
  { s: '#does h2', h: 'La parte de atrás de su negocio, llevada por nosotros.' },
  { s: '#does .head p:not(.eyebrow)', h: 'Max es la voz al teléfono. Detrás de él está todo lo demás que un negocio necesita y nunca tiene tiempo de hacer. Usted lo aprueba todo desde su teléfono.' },
  { s: '#does .pillar:nth-child(1) h3', h: 'Llamadas, de día y de noche' },
  { s: '#does .pillar:nth-child(1) ul', h: '<li><b>Max contesta, de día y de noche</b><span>: a su nombre, con los datos que usted aprueba, y lo llama a usted si es urgente</span></li><li><b>Devoluciones a tiempo</b><span>: una hora fija de su calendario, no “alguien lo llamará”</span></li><li><b>Inglés y español</b><span>: en todos los planes, sin costo extra</span></li>' },
  { s: '#does .pillar:nth-child(1) a', h: 'Escúchelo <span aria-hidden="true">&rarr;</span>' },
  { s: '#does .pillar:nth-child(2) h3', h: 'Reseñas y su nombre en internet' },
  { s: '#does .pillar:nth-child(2) ul', h: '<li><b>Cada reseña respondida</b><span>: con su voz, también las buenas</span></li><li><b>Perfil de Google al día</b><span>: y los mismos datos en cada directorio</span></li><li><b>Vigilancia de la competencia</b><span>: cómo se compara con los negocios cercanos, cada mes</span></li><li><b>Lo que dicen los asistentes de usted</b><span>: revisado cada mes y corregido donde esté mal</span></li>' },
  { s: '#does .pillar:nth-child(2) a', h: 'Cómo funciona <span aria-hidden="true">&rarr;</span>' },
  { s: '#does .pillar:nth-child(3) h3', h: 'Seguimientos que no se quedan callados' },
  { s: '#does .pillar:nth-child(3) ul', h: '<li><b>Cotizaciones y facturas</b><span>: con seguimiento el día que usted elija</span></li><li><b>La llamada a los tres días</b><span>: después de cada trabajo; un no le llega a usted antes de volverse reseña</span></li><li><b>Solicitudes de reseña</b><span>: más confirmaciones de citas y recordatorios de temporada</span></li>' },
  { s: '#does .pillar:nth-child(3) a', h: 'Vea la llamada a los tres días <span aria-hidden="true">&rarr;</span>' },
  { s: '#does .pillar:nth-child(4) h3', h: 'Su calendario, lleno' },
  { s: '#does .pillar:nth-child(4) ul', h: '<li><b>Llene mi semana</b><span>: un día vacío se ofrece a clientes anteriores a los que ya les toca; el primer sí queda agendado</span></li><li><b>Reservas en línea</b><span>: y cotizaciones, a cualquier hora</span></li><li><b>Recordatorios a clientes anteriores</b><span>: y pedidos de referidos</span></li>' },
  { s: '#does .pillar:nth-child(4) a', h: 'Vea Llene mi semana <span aria-hidden="true">&rarr;</span>' },
  { s: '#does .pillar:nth-child(5) h3', h: 'La red de Always Open' },
  { s: '#does .pillar:nth-child(5) ul', h: '<li><b>El mapa</b><span>: todos los negocios de Always Open, el más cercano primero; nadie paga por aparecer</span></li><li><b>Pases</b><span>: quien necesita otro oficio va al miembro más cercano, y ese le manda trabajo a usted</span></li><li><b>Storm Desk</b><span>: una publicación lista en el minuto en que una alerta de clima llega a su condado</span></li>' },
  { s: '#does .pillar:nth-child(5) a', h: 'Abrir el mapa <span aria-hidden="true">&rarr;</span>' },
  { s: '#does .pillar:nth-child(6) h3', h: 'Usted decide, en todo' },
  { s: '#does .pillar:nth-child(6) ul', h: '<li><b>Su OK primero</b><span>: nada sale a su nombre hasta que usted lo toque en la app</span></li><li><b>Compliance Guard</b><span>: revisa cada palabra, así que agencias de seguros y consultorios pueden usarnos</span></li><li><b>Full Max</b><span>: si quiere que lo rutinario salga solo</span></li><li><b>Una página al mes</b><span>: lo que cambió, con un registro de cada respuesta y publicación</span></li>' },
  { s: '#does .pillar:nth-child(6) a', h: 'Qué incluye cada plan <span aria-hidden="true">&rarr;</span>' }
];
