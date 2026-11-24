// Nov 24, 2026 site audit fixes (fix-site). Each test reads the pages as they are served and fails on the old wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = f => readFileSync(new URL('../public/' + f + '.html', import.meta.url), 'utf8');
// the Spanish layer is a JSON blob of its own; these checks are about the English a visitor reads
const en = f => raw(f).replace(/<script type="application\/json" id="ao-es">[\s\S]*?<\/script>/, '');
const TRADES = ['plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas', 'salons', 'restaurants', 'dental', 'insurance'];
const ALL = ['index', ...TRADES];
const tools = f => readFileSync(new URL('../tools/' + f, import.meta.url), 'utf8');

test('W1: the home page makes no privacy promise Max breaks, and no longer courts medical offices', () => {
  const h = en('index');
  assert.doesNotMatch(h, /We have never needed one/);
  assert.doesNotMatch(h, /never ask for, receive or store/i);
  assert.doesNotMatch(h, /a chart or a case file/);
  assert.doesNotMatch(h, /Private by design/);
  assert.doesNotMatch(h, /Medical, dental and legal/);
  assert.match(h, /<summary>[^<]*insurance agency or law office[^<]*can’t share client information[^<]*<\/summary>/i);
  assert.doesNotMatch(h.match(/<summary>[^<]*can’t share client[^<]*<\/summary>/)[0], /patient/);
  assert.match(h, /Nothing is pulled from your own client files, policy systems or records/);
  assert.match(h, /When Max answers your phone he takes down what the caller tells him, a name, a number, a message/);
  assert.match(h, /<b>Insurance and legal<\/b>/);
});
test('W1: no page offers "Medical, dental or vet"; the form lists what signup offers', () => {
  for (const f of ALL) assert.ok(!en(f).includes('Medical, dental or vet'), f);
  const h = en('index');
  const sel = h.match(/<select id="f-type"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(sel, /<option>Medical or dental office<\/option>/);
  for (const f of ALL) {   // the kind each page preselects must be a real option
    const map = en(f).match(/var TYPES = (\{[^}]*\})/);
    if (!map) continue;
    for (const v of Object.values(JSON.parse(map[1]))) assert.ok(sel.includes('<option>' + v + '</option>'), f + ' preselects ' + v);
  }
});
test('W1: the insurance page says what is true about client information, and its sample is consistent', () => {
  const h = en('insurance');
  assert.doesNotMatch(h, /never ask for, receive or store/i);
  assert.doesNotMatch(h, /none about policies/);
  assert.match(h, /takes down what the caller tells him/);
  assert.doesNotMatch(tools('report_mock.py'), /none about policies/);
});

test('W2: the insurance page claims no approval step the product lacks', () => {
  for (const f of ['insurance', 'index', 'dental']) {
    const h = en(f);
    assert.doesNotMatch(h, /signed off/, f);
    assert.doesNotMatch(h, /wording your compliance contact approved/, f);
    assert.doesNotMatch(h, /Sent to your company for approval|Approved by your company|sent to your company for approval/, f);
    assert.doesNotMatch(h, /Your compliance contact gets it/, f);
  }
  const h = en('insurance');
  assert.match(h, /<small>Waiting for your OK<\/small>/);
  assert.match(h, /You approved it · posted 4:40 PM/);
  assert.match(h, /can review before you start/);
  assert.doesNotMatch(h, /approves our reply (library|wording) once/);
  const d = tools('phone-data.mjs');
  assert.doesNotMatch(d, /Sent to your company for approval|Approved by your company/);
  assert.match(d, /You approved it · posted 4:40 PM/);
  assert.doesNotMatch(tools('sitefeatures.mjs'), /wording your compliance contact approved/);
});

test('W3: the insurance hero sentence is whole', () => {
  const h = en('insurance');
  assert.doesNotMatch(h, /ready\.\s+for your agency/);
  assert.match(h, /with a reply and a post ready\. Replies are written from a cautious, pre-written wording library/);
});
test('W3: the insurance nav "Free audit" link is the one the home page answers (its script handles #start-insurance)', () => {
  const h = en('index');
  assert.match(h, /location\.hash==='#start-insurance'/);   // the anchor is a script hash, not an element id: the links are right
  assert.match(en('insurance'), /<a class="btn primary small" href="index\.html#start-insurance">Free audit<\/a>/);
});
test('W3: day.html carries Open Graph and Twitter tags of its own', () => {
  const h = en('day');
  for (const t of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:url', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:image']) assert.ok(h.includes('"' + t + '"'), t);
  assert.match(h, /<meta property="og:url" content="https:\/\/alwaysopenoffice\.com\/day">/);
  assert.match(h, /<meta property="og:title" content="A Day with Always Open"/);
});
test('W3: support says only reviews and posts wait for approval', () => {
  const h = en('support');
  assert.doesNotMatch(h, /Nothing goes out in your name until you approve it/);
  assert.match(h, /No review reply or post goes out in your name until you approve it, unless you turn that on yourself\./);
});
test('W3: how to cancel is said one way on the home page, support and terms', () => {
  const s = 'Cancel any time from Your plan and card in the app, or text or email Chris.';
  for (const f of ['index', 'support', 'terms']) assert.ok(en(f).includes(s), f);
  assert.doesNotMatch(en('index'), /Cancel from the app/);
  assert.doesNotMatch(en('support'), /cancel, tap <b>Ask us<\/b>/);
  assert.doesNotMatch(en('terms'), /cancel any time by text or email/);
});

test('W4: no trade page carries another trade’s sample', () => {
  const plumb = ['index', 'plumbing'];
  for (const f of ALL.filter(x => !plumb.includes(x))) {
    const h = en(f);
    assert.ok(!h.includes('6 water heaters'), f + ' timecard');
    assert.ok(!h.includes('Mike’s Plumbing'), f + ' clock caption');
    assert.ok(!h.includes('water coming up through'), f + ' the one call');
  }
  for (const f of ['dental', 'marine', 'marinas', 'insurance', 'salons', 'restaurants']) assert.ok(!en(f).includes('on the tailgate'), f + ' tailgate');
  for (const f of ['builders', 'auto-repair', 'insurance', 'dental']) assert.ok(!en(f).includes('under a house'), f + ' under a house');
  for (const f of ['insurance', 'salons', 'restaurants', 'dental']) assert.ok(!en(f).includes('the counter or the truck'), f + ' counter or truck');
  assert.doesNotMatch(en('salons'), /quotes followed up/);
  assert.doesNotMatch(en('salons'), /the job held up/);
  assert.doesNotMatch(en('restaurants'), /the job held up/);
  for (const f of ['plumbing', 'hvac', 'builders', 'auto-repair']) assert.ok(en(f).includes('on the tailgate'), f + ' keeps its tailgate');
});

test('W5: Google-dependent claims carry a google label, and the combined bullet is split', () => {
  const LABEL = '<span class="soon" data-launch="google">Coming soon</span>';
  for (const f of ['plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas', 'salons', 'restaurants']) {
    const h = en(f);
    assert.doesNotMatch(h, /for Google, Facebook and Instagram/, f + ' combined bullet');
    const photos = f === 'salons' || f === 'restaurants' ? 'your photos' : 'your job photos';
    assert.ok(h.includes('Posts for Google from ' + photos + LABEL), f + ' google photo posts');
    assert.ok(h.includes('Posts for Facebook and Instagram from ' + photos + '<span class="soon" data-launch="meta">Coming soon</span>'), f + ' meta photo posts');
    assert.ok(h.includes('Google profile kept current, the same details on every listing' + LABEL), f + ' profile line');
    assert.match(h, /it comes back as a Google post[^<]*, ready for your OK\. <span class="soon" data-launch="google">Coming soon<\/span>/, f + ' photo to post');
  }
  assert.ok(en('dental').includes('Google profile kept current, the same details on every listing' + LABEL), 'dental profile line');
  for (const f of ALL) {
    const h = en(f);
    if (h.includes('id="aos-storm"')) assert.ok(h.includes('<h3>Storm Desk</h3><span class="aos-tag g">Growth</span>' + LABEL), f + ' storm card');
    if (h.includes('we mark you closed on Google')) assert.ok(h.includes('we mark you closed on Google.' + LABEL), f + ' closed today');
  }
  assert.match(tools('sitecontrols.mjs'), /closed on Google[^\n]*\n?[^\n]*data-launch="google"/);
  assert.match(tools('phone.mjs'), /data-launch="google"/);
  assert.match(tools('sitefeatures.mjs'), /soon: 'google'/);
});
