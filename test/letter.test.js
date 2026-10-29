// The grade letter: the grade, the three worst findings in plain words, the trade's own paragraph, the offer, no
// competitor names; up to ten letters as one printable set; the routes refuse without the key or the board token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeDB } from './rehearsal/harness.js';
register('./rehearsal/hooks.mjs', import.meta.url);
const L = await import('../src/letter.js');
const { handleAudit } = await import('../src/audit.js');
const { boardToken } = await import('../src/opsboard.js');

const audit = (name, over) => Object.assign({
  found: true, at: '2026-10-29T13:00:00Z', score: 58, grade: 'D',
  business: { name, address: '101 Jefferson Ave, Eatonton, GA', type: 'Plumber', rating: 4.2, reviews: 12, phone: '(478) 555-1234' },
  rivals: [{ name: 'Rival Rooter', rating: 4.9, reviews: 210 }, { name: 'Oconee Pipes', rating: 4.7, reviews: 95 }],
  findings: [
    { weight: 18, title: 'Fewer reviews than nearby competitors', saw: '12 reviews, while the top nearby competitors average 152.', fix: 'We ask every customer for a review after each job, so the count keeps climbing.' },
    { weight: 12, title: 'Rating below 4.5', saw: 'A 4.2 rating (nearby competitors average 4.8). Many customers filter out anything under 4.5.', fix: 'More reviews from happy customers lift it.' },
    { weight: 12, title: 'No hours on Google', saw: 'Google does not list opening hours.', fix: 'We add hours, holiday hours and closures, and keep them current.' },
    { weight: 6, title: 'No tap-to-call button on the website', saw: 'Phone visitors have to copy your number by hand.', fix: 'We add a tap-to-call button.' }
  ],
  fine: ['Website works on phones'], areas: [{ label: 'Reviews', grade: 'D' }, { label: 'Google profile', grade: 'C' }, { label: 'Website', grade: 'B' }]
}, over || {});

test('a letter: the grade, the three worst findings, the trade paragraph, the default offer, no competitor names', () => {
  const l = L.letterFor(audit('Sinclair Plumbing'));
  assert.equal(l.name, 'Sinclair Plumbing'); assert.equal(l.grade, 'D'); assert.equal(l.score, 58);
  assert.equal(l.date, 'October 29, 2026');
  assert.equal(l.own, '4.2 stars from 12 reviews on Google today');
  assert.deepEqual(l.fixes.map(f => f.title), ['Fewer reviews than nearby competitors', 'Rating below 4.5', 'No hours on Google']);
  assert.equal(l.kind, 'trade'); assert.match(l.pitch, /^Max answers your calls in your company’s name/);
  assert.equal(l.offer, L.DEFAULT_OFFER);
  assert.match(l.contact, /email hello@alwaysopenoffice\.com/);
  const html = L.letterPage([l], []);
  assert.ok(!/Rival Rooter|Oconee Pipes|210|\b95\b/.test(html), 'no competitor by name or with their numbers');
  assert.match(html, /Sinclair Plumbing, graded/); assert.match(html, /@page\{size:letter;margin:0\.75in\}/);
  assert.ok(!/optimi[sz]e|!/i.test(html.replace(/<!doctype/i, '')), 'plain words, no exclamation marks');
});

test('the offer and the phone are the ones typed; the regulated paragraph for an agency; the text version fits', () => {
  const l = L.letterFor(audit('Gates Insurance Agency', { business: Object.assign({}, audit('x').business, { name: 'Gates Insurance Agency', type: 'Insurance agency' }) }), { offer: 'First month free, then $149.', phone: '478 555 0199' });
  assert.equal(l.kind, 'regulated'); assert.match(l.pitch, /never quotes, advises/);
  assert.equal(l.offer, 'First month free, then $149.');
  assert.equal(l.contact, 'Call or text me at (478) 555-0199. To hear Max answer a call, dial (706) 460-2226.');
  assert.equal(L.pitchFor('Lake Country Foam Party', '').kind, 'events');
  assert.equal(L.pitchFor('Twin Lakes Salon', 'Hair salon').kind, 'salon');
  const t = L.letterText(audit('Sinclair Plumbing'));
  assert.ok(t.length <= 600, 'text version is ' + t.length + ' characters');
  assert.match(t, /^Sinclair Plumbing: grade D \(58 of 100\)/);
  assert.match(t, /1\) fewer reviews than nearby competitors, 2\) rating below 4\.5, 3\) no hours on google\./);
  const clean = L.letterFor(audit('Clean Co', { findings: [], score: 96, grade: 'A' }));
  assert.match(L.letterPage([clean]), /nothing major to fix/);
});

test('the batch box: name, town per line, ten at most; letters in order; one not found is named, not fatal', async () => {
  assert.deepEqual(L.parseLines('Sinclair Plumbing, Eatonton\nLane Electric, Eatonton, GA\n\nJust A Name'), [{ q: 'Sinclair Plumbing', town: 'Eatonton' }, { q: 'Lane Electric', town: 'Eatonton, GA' }, { q: 'Just A Name', town: '' }]);
  assert.equal(L.parseLines(Array.from({ length: 14 }, (_, i) => 'Biz ' + i + ', Eatonton').join('\n')).length, 10);
  const env = { DB: makeDB() };
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, q TEXT, town TEXT, kind TEXT, ip_hash TEXT, score INTEGER, data TEXT)').run();
  const run = async (env, q) => q === 'Ghost Co' ? { found: false } : audit(q);
  const r = await L.buildLetters(env, [{ q: 'A Plumbing', town: 'Eatonton' }, { q: 'Ghost Co', town: 'Eatonton' }, { q: 'B Electric', town: 'Eatonton' }, { q: 'C Roofing', town: '' }], {}, run);
  assert.deepEqual(r.letters.map(l => l.name), ['A Plumbing', 'B Electric', 'C Roofing']);
  assert.deepEqual(r.missed, ['Ghost Co (Eatonton)']);
  const html = L.letterPage(r.letters, r.missed);
  assert.equal((html.match(/<article class="page">/g) || []).length, 3);
  assert.match(html, /break-after:page/); assert.match(html, /Not found on Google: Ghost Co \(Eatonton\)/);
  const kept = (await env.DB.prepare("SELECT kind, score, data FROM audits").all()).results;
  assert.equal(kept.length, 3); assert.equal(kept[0].kind, 'letter'); assert.equal(kept[0].data, '{"score":58,"grade":"D"}', 'only our own score is kept');
});

test('the routes: POST needs the key, GET needs the board token', async () => {
  const env = { DB: makeDB(), LEADS_KEY: 'the-ops-key' };
  const h = { json: (o, s) => new Response(JSON.stringify(o), { status: s }), sameKey: async (a, b) => a === b };
  const post = await handleAudit(new Request('https://x/audit/letter', { method: 'POST', headers: { 'x-key': 'nope' }, body: '{"lines":"A, B"}' }), env, new URL('https://x/audit/letter'), h);
  assert.equal(post.status, 403);
  const get = await handleAudit(new Request('https://x/audit/letter?t=nope&q=A'), env, new URL('https://x/audit/letter?t=nope&q=A'), h);
  assert.equal(get.status, 403);
  const tok = await boardToken(env);
  const noq = await handleAudit(new Request('https://x/audit/letter?t=' + tok), env, new URL('https://x/audit/letter?t=' + tok), h);
  assert.equal(noq.status, 400, 'right token, no business named');
  const nokey = await handleAudit(new Request('https://x/audit/letter', { method: 'POST', headers: { 'x-key': 'the-ops-key' }, body: '{"lines":"Sinclair Plumbing, Eatonton"}' }), env, new URL('https://x/audit/letter'), h);
  assert.equal(nokey.status, 503, 'no Google key set: says so instead of failing quietly');
});
