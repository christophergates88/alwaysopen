// "What you control" on the website (Nov 11, 2026): the list of switches an owner gets in the app, on the home page and
// every trade page. These hold the two promises it makes: every page carries it, and every line on it is a control the
// app still has. If the app drops or renames a switch, the matching check here fails until the site says the truth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { YOURS_PAGES, OFFICE_PAGES, YOURS_FOLD, copyFor, section } from '../tools/sitecontrols.mjs';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const { DUTIES } = await import('../src/duties.js');
const { KINDS } = await import('../src/outcalls.js');
const { appHtml } = await import('../src/apppage.js');
const { features } = await import('../src/app.js');

const page = k => fs.readFileSync('public/' + k + '.html', 'utf8');
const band = k => { const s = page(k), a = s.indexOf('<!-- yours:start -->'), b = s.indexOf('<!-- yours:end -->'); return a < 0 || b < 0 ? '' : s.slice(a, b); };
const words = (k, lang) => copyFor(k)[lang].groups.map(g => g[1].join(' ') + ' ' + (g[2] || '')).join(' ');
const app = appHtml({ base: '/app/x', business: 'Test' }) + fs.readFileSync('src/bizpage.js', 'utf8');

test('every page carries the list once, folded on phones, right before the plans, in both languages', () => {
  assert.equal(YOURS_PAGES.length, 11);
  for (const k of YOURS_PAGES) {
    const s = page(k);
    assert.equal(s.split('<!-- yours:start -->').length, 2, k + ' has the band once');
    assert.equal(band(k) + '<!-- yours:end -->\n', section(k), k + ' is what the tool draws today (run node tools/sitecontrols.mjs)');
    assert.ok(band(k).includes('data-fold="' + YOURS_FOLD + '"'), k + ' folds it on phones');
    assert.match(s.slice(s.indexOf('<!-- yours:end -->'), s.indexOf('<!-- yours:end -->') + 140), /<section\b[^>]*\bid="(pricing|plans)"/, k + ': the plans come next');
    const es = JSON.parse(s.match(/<script type="application\/json" id="ao-es">([\s\S]*?)<\/script>/)[1]).filter(e => /^#yours\b/.test(e.s));
    assert.equal(es.length, 6, k + ' has its Spanish');
    assert.ok(es.some(e => e.h.includes('Usted pone las reglas')), k);
    const en = copyFor(k).en.groups, sp = copyFor(k).es.groups;
    assert.deepEqual(sp.map(g => g[1].length), en.map(g => g[1].length), k + ': Spanish has every line English has');
  }
});

test('every switch in Max’s job description and every call Max makes is on the list', () => {
  const W = words('index', 'en');
  const duty = { allDay: 'Answer during business hours too', prices: 'standard prices', pastService: 'last had work done', plans: 'service plan', payments: 'how you take payment', areaOnly: 'outside your area' };
  for (const d of DUTIES) { assert.ok(duty[d.key], 'the site has no line for the new job-description switch "' + d.label + '"'); assert.ok(W.includes(duty[d.key]), d.key); }
  const call = { urgent: 'Ring your phone the moment a call is urgent', rundown: 'rundown call at 7 AM', confirm: 'Confirm appointments the day before', noshow: 'misses a visit', onway: 'On my way', quote: 'estimate after three days', due: 'six months after a job', summary: 'A text after every call' };
  const st = { list: Object.keys(KINDS).map(k => ({ key: k, label: KINDS[k].label })) };
  for (const x of st.list) { assert.ok(call[x.key], 'the site has no line for the new call "' + x.label + '"'); assert.ok(W.includes(call[x.key]), x.key); }
});

test('every other line is still a control the app has', () => {
  // what the site says -> the words the app uses for it
  const pairs = [
    ['Your hours', 'Your hours'], ['what to tell callers', 'tell callers?'], ['His name and his voice', 'Voice and greeting'], ['record up to 15 seconds', 'Record up to 15 seconds in your own voice'],
    ['Text UNDO', 'Text UNDO to take the last one back'], ['answers Spanish-speaking callers in Spanish', 'answers Spanish-speaking callers in Spanish'],
    ['only when it’s urgent, or whenever they ask', 'When they ask, or it'], ['daytime, any hour, or never', 'Daytime, 8 AM to 9 PM'],
    ['seven short questions', 'asks seven short questions'], ['Looks right', 'Looks right'], ['pencils one in', 'pencils in a time, we confirm by text'], ['time between visits', 'Time between visits'],
    ['Google Calendar', 'Connect Google Calendar'], ['booking link', 'Copy booking link'], ['request link', 'Copy request link'],
    ['Promise a call-back time', 'Promise a call-back time'], ['hangs up before leaving a message', 'Text after a missed call'], ['check-in call a few days after a job', 'Check in after a job'],
    ['Turn Max off and back on', 'data-a="line-toggle"'], ['Closed today', 'Closed today?'], ['Holiday or new hours', 'Holiday or new hours'], ['Send a photo', 'Photo for a post'],
    ['Finished a job', 'Finished a job'], ['Approve, edit or skip', 'data-a="approve"'], ['review QR code', 'Print a card'], ['who did what', 'See who did what'], ['Text Katie', 'Text Katie']
  ];
  const W = words('index', 'en');
  for (const [siteSays, appSays] of pairs) { assert.ok(W.includes(siteSays), 'the list says: ' + siteSays); assert.ok(app.includes(appSays), 'the app still has: ' + appSays); }
});

test('the plan tags match what the app gives each plan', () => {
  const f = t => features({ tier: t, regulated: 0, feats: '' });
  const tag = (re) => copyFor('index').en.groups.flatMap(g => g[1]).filter(l => re.test(l));
  assert.ok(tag(/hangs up before/)[0].startsWith('Pro: ') && f('Pro').textback && !f('Growth').textback);
  assert.ok(tag(/check-in call/)[0].startsWith('Pro: ') && f('Pro').checkins && !f('Growth').checkins);
  assert.ok(tag(/Send a photo/)[0].startsWith('Growth: ') && f('Growth').photos && !f('Starter').photos);
  assert.ok(tag(/Finished a job/)[0].startsWith('Growth: ') && f('Growth').jobs && !f('Starter').jobs);
});

test('insurance and dental offices are only shown what their line can do', () => {
  for (const k of OFFICE_PAGES) {
    const W = words(k, 'en') + ' ' + words(k, 'es');
    assert.doesNotMatch(W, /book|pencil|On my way|estimate|check-in|rundown|standard prices|Send a photo|Finished a job|seven short|agenda|presupuesto/i, k);
    assert.match(copyFor(k).en.lead, /Max takes the message and your office calls back/);
    assert.ok(features({ tier: 'Pro', regulated: 1, feats: '' }).jobs === false);
  }
});

test('plain words: no “AI”, no owner’s name', () => {
  for (const k of ['index', 'dental']) for (const lang of ['en', 'es']) {
    const c = copyFor(k)[lang], all = [c.eyebrow, c.h, c.lead, c.fold, c.foot, words(k, lang)].join(' ');
    assert.doesNotMatch(all, /\bAI\b|\bIA\b|artificial|Christopher|Gates/);
  }
});
