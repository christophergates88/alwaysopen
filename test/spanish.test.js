// Spanish on the site: a lead sent from the Spanish page is answered in Spanish, keeps its language, tells Christopher to
// answer in Spanish, and that owner's Max line starts out answering Spanish-speaking callers in Spanish. A Spanish yes
// books a Fill-my-week offer. (The page switch itself is checked in a real browser by tools/phonecheck.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const H = await import('./rehearsal/harness.js');
const world = new H.World();
const DB = H.makeDB();
const env = H.makeEnv(world, DB);
H.installFetch(world, env);
const { default: worker } = await import('../src/index.js');
const { provisionLine } = await import('../src/provision.js');
const { YES_RE } = await import('../src/fillweek.js');
const site = H.makeClient(worker, env);

const send = (form, lang) => site.call('/lead', { form: Object.assign({ name: 'Ana Ruiz', email: 'ana@salon.example', phone: '(478) 555-0131', business: 'Salón Ana', town: 'Eatonton, GA', type: 'Salon, spa or fitness', plan: 'Not sure yet', t: String(Date.now() - 20000) }, form, lang ? { lang } : {}), headers: { accept: 'application/json' } });

test('a lead from the Spanish page: answered in Spanish, kept as Spanish, flagged for Christopher', async () => {
  const r = await send({});
  assert.equal(r.status, 200); assert.equal(r.json().title, 'Got it, Ana.');
  const es = await send({ email: 'ana2@salon.example' }, 'es');
  assert.equal(es.status, 200);
  assert.equal(es.json().title, 'Recibido, Ana.'); assert.match(es.json().message, /^Su solicitud nos llegó\. Katie le responde en un día hábil/);
  const row = await DB.prepare("SELECT lang FROM leads WHERE email = 'ana2@salon.example'").first();
  assert.equal(row.lang, 'es');
  assert.ok(world.pushes.some(p => /Wrote in Spanish: answer in Spanish/.test(p.body)), 'the push tells Christopher');
  const missing = await send({ email: '', name: '' }, 'es');
  assert.equal(missing.status, 400); assert.match(missing.text, /Por favor agregue su nombre y un correo electrónico válido\./);
});

test('that owner’s Max line starts in Spanish; an English lead’s does not', async () => {
  for (const [cid, email] of [['salon-ana', 'ANA2@salon.example'], ['plain-co', 'ana@salon.example']]) {
    await DB.prepare("INSERT INTO app_clients (client_id, code_hash, business, phone, active) VALUES (?1, ?2, ?3, '+14785550131', 1)").bind(cid, 'h-' + cid, cid).run();
    await DB.prepare("INSERT INTO billing (client_id, session_id, business, email, phone, town, type, status, created) VALUES (?1, ?2, ?3, ?4, '(478) 555-0131', 'Eatonton, GA', 'Salon, spa or fitness', 'active', ?5)").bind(cid, 's-' + cid, cid, email, new Date().toISOString()).run();
    const r = await provisionLine(env, cid);
    assert.equal(r.status, 'live', cid);
  }
  const es = await DB.prepare("SELECT spanish FROM voice_lines WHERE client_id = 'salon-ana'").first();
  const en = await DB.prepare("SELECT spanish FROM voice_lines WHERE client_id = 'plain-co'").first();
  assert.equal(es.spanish, 1); assert.equal(en.spanish, 0);
});

test('a yes in Spanish books the offer; words that only start like one do not', () => {
  for (const y of ['YES', 'ok', 'Sí', 'SI', 'si gracias', 'Claro que sí', 'De acuerdo.', 'está bien', 'esta bien', 'Dale']) assert.ok(YES_RE.test(y), y);
  for (const n of ['No', 'sin', 'silla', 'yesterday', 'no gracias']) assert.equal(YES_RE.test(n), false, n);
});
