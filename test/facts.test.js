// Prices and promises live in src/facts.js; everything that says a price says that one (Brief 2, Part 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const F = await import('../src/facts.js');
const V = await import('../src/voice.js');
const root = path.join(import.meta.dirname, '..');
const read = d => fs.readdirSync(path.join(root, d)).filter(f => /\.(html|js|mjs)$/.test(f)).map(f => [d + '/' + f, fs.readFileSync(path.join(root, d, f), 'utf8')]);
const files = read('public').concat(read('src'), read('tools'));
const want = { Starter: F.dollars(F.PLANS.Starter.cents), Growth: F.dollars(F.PLANS.Growth.cents), Pro: F.dollars(F.PLANS.Pro.cents) };

test('a plan named with a price, anywhere, is the price in facts.js', () => {
  const bad = [];
  for (const [name, txt] of files) {
    const t = txt.replace(/<[^>]+>/g, ' ');
    for (const m of t.matchAll(/\b(Starter|Growth|Pro)\b(?: plan)?(?: is| at| for|:|,)?\s{0,3}(\$\d[\d,]*)/g)) if (m[2] !== want[m[1]]) bad.push(name + ': ' + m[0]);
  }
  assert.deepEqual(bad, []);
});

test('more Max minutes are one price everywhere', () => {
  const bad = [], price = F.dollars(F.MAX.moreCents);
  for (const [name, txt] of files) {
    const t = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const m of t.matchAll(/(?:More Max minutes|300 more (?:minutes|Max minutes)[^.$]{0,30}?)[^$.]{0,40}(\$\d+)/gi)) if (m[1] !== price) bad.push(name + ': ' + m[0].slice(0, 90));
  }
  assert.deepEqual(bad, []);
});

test('Max’s own line is rewritten from facts.js when it drifts, and left alone when it matches', async () => {
  const db = makeDB();
  await db.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts, updated) VALUES ('+17064602226', 'always-open', 'Always Open', 1, ?1, '2026-10-29')").bind(JSON.stringify({ prices: 'Starter is $149. 300 more minutes are $149 a month.', notes: 'Growth adds booking and quote requests. Email: hello@alwaysopenoffice.com.' })).run();
  assert.equal(await V.syncOwnLine({ DB: db }), true);
  const f = JSON.parse((await db.prepare("SELECT facts FROM voice_lines WHERE number = '+17064602226'").first()).facts);
  assert.equal(f.prices, F.ownLineFacts().prices);
  assert.match(f.prices, /300 more minutes are \$59 a month, about 20 cents a minute/);
  assert.match(f.notes, /^Every plan, Starter included, has a booking and quote page/);
  assert.match(f.notes, /Email: hello@alwaysopenoffice\.com\.$/);
  assert.doesNotMatch(f.notes, /Growth adds booking/);
  assert.equal(await V.syncOwnLine({ DB: db }), false, 'nothing to change the second time');
});

test('Part 8b: the own line says who Always Open is, once, and a second sync changes nothing', async () => {
  const { makeDB } = await import('./rehearsal/harness.js');
  const V = await import('../src/voice.js');
  const F = await import('../src/facts.js');
  const DB = makeDB();
  await DB.prepare("CREATE TABLE IF NOT EXISTS voice_lines (client_id TEXT PRIMARY KEY, facts TEXT, updated TEXT)").run();
  await DB.prepare("INSERT INTO voice_lines (client_id, facts) VALUES ('always-open', ?1)").bind(JSON.stringify({ notes: 'The free audit is a one-page report. Email: hello@alwaysopenoffice.com.', services: 'old text' })).run();
  assert.equal(await V.syncOwnLine({ DB }), true);
  const f1 = JSON.parse((await DB.prepare("SELECT facts FROM voice_lines WHERE client_id = 'always-open'").first()).facts);
  assert.equal(f1.notes.split('Always Open is a small team').length, 2, 'once');
  assert.match(f1.notes, /Katie handles client support/);
  assert.match(f1.notes, /The free audit is a one-page report/, 'other notes kept');
  assert.equal(f1.services, F.SERVICES_DAY_FIRST_LIVE ? F.SERVICES_DAY_FIRST : F.SERVICES_REPORT_FIRST, 'the description comes from facts.js');
  assert.doesNotMatch(f1.services, /Facebook review|approves anything/, 'retired claims are gone from the live line');
  assert.equal(await V.syncOwnLine({ DB }), false, 'a second sync changes nothing');
  assert.doesNotMatch(F.ownLineFacts().about, /Christopher|Gates|\d{3}/, 'no name or number until Christopher says so');
});
