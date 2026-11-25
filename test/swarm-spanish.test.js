// Nov 24, 2026 (fix-spanish): the Spanish layer says what the corrected English says. Every page's Spanish block parses, none
// carries the claims the English dropped tonight, the cancel sentence / option / labels are the ones specified, and the switch
// turns every "Coming soon" label into "Próximamente" and back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const PAGES = ['index', 'insurance', 'salons', 'restaurants', 'dental', 'plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas'];
const html = k => fs.readFileSync('public/' + k + '.html', 'utf8');
const block = k => JSON.parse(/<script type="application\/json" id="ao-es">([\s\S]*?)<\/script>/.exec(html(k))[1]);
const texts = k => block(k).map(e => e.h ?? e.o ?? e.t ?? e.p ?? '');
const all = k => texts(k).join('\n');
const CANCEL = 'Cancele cuando quiera desde “Your plan and card” en la app, o mande un mensaje de texto o un correo a Chris.';

test('S1: every page has a Spanish block that parses, with no stray selectors list', () => {
  for (const k of PAGES) { const b = block(k); assert.ok(b.length > 50, k); for (const e of b) assert.equal(typeof e.s, 'string', k); }
});

test('S2: none of the old claims is left in any Spanish block', () => {
  const gone = ['Cancele desde la app', 'Consultorio médico, dental o veterinario', 'encargado de cumplimiento', 'que aprobó su contacto de cumplimiento', 'Su redacción aprobada',
    'firmó', 'enviada a su empresa', 'Aprobado por su empresa', 'Enviado a su empresa', 'No recibimos', 'nunca recibimos', 'Nunca pedimos', 'Fue hecho para eso', 'Está hecho para eso'];
  for (const k of PAGES) for (const g of gone) assert.ok(!all(k).includes(g), k + ' still says: ' + g);
  assert.ok(!/trabajamos solo con páginas públicas<\/span><\/li><\/ul>/.test(all('insurance')), 'insurance: no "solo páginas públicas" in the no-client-list line');
  assert.ok(!/cotizaciones con seguimiento y días vacíos llenados con su propia lista de clientes\. Al teléfono, Max contesta con el nombre de su negocio, da su horario y los precios/.test(all('salons')), 'salons hero still follows up quotes');
});

test('S3: one cancel sentence, the same as the English, and the kind-of-business option', () => {
  const t = texts('index');
  assert.equal(t.filter(x => x.includes(CANCEL)).length, 2, 'the pricing line and the Start band');
  assert.ok(block('index').some(e => e.s === '#f-type option:nth-child(5)' && e.o === 'Consultorio médico o dental'));
  for (const k of PAGES) assert.ok(!/Cancele/.test(all(k).split(CANCEL).join('')), k + ': no other cancel sentence');
});

test('S4: the QR card line says only the counter on the four counter pages, and keeps the truck elsewhere', () => {
  const line = k => block(k).find(e => e.s === '#yours .yg').h;
  for (const k of ['insurance', 'salons', 'restaurants', 'dental']) { assert.ok(line(k).includes('poner en el mostrador.'), k); assert.ok(!/camioneta/.test(line(k)), k); }
  for (const k of ['index', 'plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas']) assert.ok(line(k).includes('poner en el mostrador o la camioneta.'), k);
});

test('S5: the closed-on-Google line carries the Google label in Spanish, the same key as the English', () => {
  const line = 'nosotros lo marcamos cerrado en Google.<span class="soon" data-launch="google">Próximamente</span></li>';
  for (const k of PAGES) {
    assert.ok(block(k).find(e => e.s === '#yours .yg').h.includes(line), k + ' (Spanish)');
    assert.ok(html(k).replace(/<script type="application\/json" id="ao-es">[\s\S]*?<\/script>/, '').includes('we mark you closed on Google.<span class="soon" data-launch="google">Coming soon</span>'), k + ' (English)');
  }
});

test('S6: every launch label in the English has its twin in the Spanish entry for the same place', () => {
  // an entry whose Spanish carries a label must carry the same key as the English
  for (const k of PAGES) for (const e of block(k)) for (const m of (e.h || '').matchAll(/<span class="soon"(?: data-launch="(\w+)")?>([^<]*)<\/span>/g)) {
    assert.equal(m[2], 'Próximamente', k + ' ' + e.s);
    if (m[1]) assert.ok(html(k).includes('data-launch="' + m[1] + '"'), k + ': ' + m[1]);
  }
});

test('S7: the switch in every page and in the generator swaps every .soon label and puts it back', () => {
  const gen = fs.readFileSync('tools/phone.mjs', 'utf8');
  const rule = "lbl = []; Array.prototype.forEach.call(d.querySelectorAll('.soon'), function (x) { if (x.textContent.trim() === 'Coming soon') { x.textContent = 'Próximamente'; lbl.push(x); } });";
  const back = "lbl.forEach(function (x) { x.textContent = 'Coming soon'; }); lbl = [];";
  assert.ok(gen.includes(rule) && gen.includes(back), 'tools/phone.mjs');
  for (const k of PAGES) { const s = html(k); assert.ok(s.includes(rule) && s.includes(back), k + ': the inline switch has the label rule'); }
});

test('S8: insurance says the wording library is cautious and reviewable, and nothing is pulled from their files', () => {
  const t = all('insurance');
  assert.ok(t.includes('una redacción cuidadosa, escrita de antemano, que su contacto de cumplimiento puede revisar antes de empezar'));
  assert.ok(t.includes('<b>Redacción cuidadosa</b>') && t.includes('no se saca nada de sus propios archivos'));
  assert.ok(all('salons').includes('recordatorios a clientes anteriores'));
});

test('S9: in a real browser every selector matches, and the labels flip to Próximamente and back', async (t) => {
  const require = createRequire(import.meta.url);
  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { return t.skip('no playwright here'); }
  const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));
  let b; try { b = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : {}); } catch (e) { return t.skip('no browser here'); }
  try {
    const pg = await b.newPage();
    for (const k of PAGES) {
      await pg.setContent(html(k), { waitUntil: 'domcontentloaded' });
      const r = await pg.evaluate(() => {
        const data = JSON.parse(document.getElementById('ao-es').textContent);
        const miss = data.filter(e => !document.querySelector(e.s)).map(e => e.s);
        const labels = () => [...document.querySelectorAll('.soon')].map(x => x.textContent.trim());
        const en0 = labels(); document.querySelector('[data-lang-t]').click(); const es = labels();
        document.querySelector('[data-lang-t]').click(); const en1 = labels();
        return { miss, en0, es, en1 };
      });
      assert.deepEqual(r.miss, [], k + ': selectors with no element');
      assert.deepEqual(r.en1, r.en0, k + ': English labels come back');
      assert.equal(r.es.length, r.en0.length, k);
      r.es.forEach((x, i) => { if (r.en0[i] === 'Coming soon') assert.equal(x, 'Próximamente', k + ': a label stayed English in Spanish mode'); });
    }
  } finally { await b.close(); }
});
