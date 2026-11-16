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
  assert.match(f1.notes, /He handles client support himself \(callers and clients know him as Chris\)/);
  assert.doesNotMatch(f1.notes, /Katie/, 'Nov 15, 2026: Christopher is the support contact; nobody else is named');
  assert.match(f1.notes, /The free audit is a one-page report/, 'other notes kept');
  assert.equal(f1.services, F.SERVICES_DAY_FIRST_LIVE ? F.SERVICES_DAY_FIRST : F.SERVICES_REPORT_FIRST, 'the description comes from facts.js');
  assert.doesNotMatch(f1.services, /Facebook review|approves anything/, 'retired claims are gone from the live line');
  assert.equal(await V.syncOwnLine({ DB }), false, 'a second sync changes nothing');
  assert.match(F.ownLineFacts().about, /run by Christopher Gates\./, 'Christopher said on Nov 5 to name him');
  assert.doesNotMatch(F.ownLineFacts().about, /\d{3}|@/, 'no phone numbers or email addresses for people');
});

// Nov 15, 2026 (evening): that morning Katie came out of the site, the app and Max's rules, and Max's greeting went to
// "automated assistant". The own line's row was not touched: its hours, booking, next step, goal and owner's notes are
// hand-written text that lives only in the database, and Max was still being told "Katie, from our team, will call
// them back" (he said it on the Nov 14 test call). These are those fields as they stood on the live line.
test('the own line\'s row: Chris calls back, nobody else is named, and "S.I." is gone, down to the hand-written parts', async () => {
  const { makeDB } = await import('./rehearsal/harness.js');
  const V = await import('../src/voice.js');
  const F = await import('../src/facts.js');
  const live = {
    hours: 'This phone line is answered any time, day or night. Katie, from our team, returns calls within one business day.',
    booking: 'Katie, from our team, calls back to set things up, or they can request a free audit at alwaysopenoffice.com. Setup takes about a week. Nobody is signed up or charged on this call.',
    next: 'Katie, from our team, will call them back within one business day.',
    notes: 'If a carrier or compliance contact must sign off, that happens before anything is turned on, and Katie can walk them through it. Never say it is compliant or approved by any carrier; say it is built to follow their rules.',
    greeting: 'Always Open, this is Max. I\'m an S.I., and calls are recorded.',
    goal: 'for who built you, "The Always Open team put me together." The greeting already said you\'re an S.I.; never bring up S.I. or AI again yourself, and never say what S.I. stands for. If they ask again whether you\'re a person, say in a few words that you\'re an S.I., not a person. If they ask what you run on, that\'s a trade secret. When you offer the call back, say who will call and why, like "I can have Katie from our team give you a call and walk you through it." Never call yourself a receptionist.',
    owner: 'If someone asks for Chris or Christopher, or says they know him, say you\'ll pass it straight to Chris and he\'ll call them himself; don\'t steer them to Katie. Lead with the after-hours value. When they ask how something works, explain it in two or three sentences instead of offering a call; offer Katie or the audit at most twice a call.',
    testers: '+14783652533, +14783393489', flux: 1, voice: 'UgBBYS2sOqTuMpoF3BR0'
  };
  const DB = makeDB();
  await DB.prepare("INSERT INTO voice_lines (number, client_id, business, on_air, facts, updated) VALUES ('+17064602226', 'always-open', 'Always Open', 1, ?1, '2026-11-15')").bind(JSON.stringify(live)).run();
  assert.equal(await V.syncOwnLine({ DB }), true);
  const row = await DB.prepare("SELECT * FROM voice_lines WHERE client_id = 'always-open'").first(), f = JSON.parse(row.facts);
  assert.doesNotMatch(row.facts, /Katie/, 'nobody but Chris is named anywhere in the row');
  assert.doesNotMatch(row.facts, /S\.I\./, 'and Max is never told he is an S.I.');
  assert.equal(f.next, 'Chris will call them back within one business day.');
  assert.equal(f.hours, 'This phone line is answered any time, day or night. Chris returns calls within one business day.');
  assert.match(f.booking, /^Chris calls back to set things up, or they can request a free audit at alwaysopenoffice\.com\. Setup takes about a week\./);
  assert.equal(f.greeting, 'Always Open, this is Max. I\'m an automated assistant, and calls are recorded.');
  assert.match(f.goal, /The greeting already said you're an automated assistant; never bring it up again yourself\. If they ask again whether you're a person, say in a few words that you're an automated assistant, not a person\. If they ask what you run on/);
  assert.match(f.goal, /like "I can have Chris give you a call and walk you through it\."/);
  assert.match(f.notes, /and Chris can walk them through it\. Never say it is compliant/);
  assert.match(f.owner, /he'll call them himself\. Lead with the after-hours value\./, 'the clause about Katie is gone, the sentence still ends');
  assert.match(f.owner, /offer the call back or the audit at most twice a call\.$/);
  assert.equal(f.testers, live.testers); assert.equal(f.flux, 1); assert.equal(f.voice, live.voice);
  assert.equal(await V.syncOwnLine({ DB }), false, 'a second sync changes nothing');
  // and it is what Max is told on a call: the instructions for this line name Chris and no one else
  const L = V.lineView(row);
  for (const prompt of [V.systemPrompt(L, '+14705550123', 'en-US'), V.systemPrompt6(L, '+14705550123', 'en-US')]) {
    assert.doesNotMatch(prompt, /Katie/); assert.doesNotMatch(prompt.replace(/Never call yourself "S\.I\."\./, ''), /S\.I\./);
    assert.match(prompt, /Chris will call them back within one business day\./);
  }
  // the sweep on its own: a sentence that ended in "S.I." keeps its full stop, and plain text passes through
  assert.equal(V.sweepRetired('You are an S.I. Say so.'), 'You are an automated assistant. Say so.');
  assert.equal(V.sweepRetired('Starter is $149 a month.'), 'Starter is $149 a month.');
});
