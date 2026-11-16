// Always Open HQ, the analytical half (Nov 15, 2026): he said the one-list page was "NOT like I want. I need it more
// analytical so I can see everything". These hold the numbers to the tables they come from (Eastern days, test calls
// and the sample business kept apart), the charts to their rules, and the page to having every part open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const D = await import('../src/hqdash.js');
const Q = await import('../src/opshq.js');
const { makeDB } = await import('./rehearsal/harness.js');

const NOW = Date.parse('2026-11-15T23:25:00Z');   // 6:25 PM Eastern, a Sunday
const DAY = 864e5, H = 36e5, iso = ms => new Date(ms).toISOString();

test('days are Eastern days, and the week the clocks change neither repeats nor skips one', () => {
  assert.deepEqual(D.etOf(Date.parse('2026-11-16T03:30:00Z')), { day: '2026-11-15', hour: 22, wd: 'Sun' }, '3:30 AM UTC is still Sunday night in Georgia');
  assert.equal(D.etOf(Date.parse('2026-11-15T05:00:00Z')).hour, 0, 'midnight reads as hour 0, not 24');
  const k = D.dayKeys(Date.parse('2026-11-03T04:30:00Z'), 5);   // 11:30 PM on Nov 2, the day after the clocks went back
  assert.deepEqual(k, ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  const spring = D.dayKeys(Date.parse('2027-03-15T03:30:00Z'), 3);   // 11:30 PM on Mar 14, the day they go forward
  assert.deepEqual(spring, ['2027-03-12', '2027-03-13', '2027-03-14']);
  assert.equal(D.dayKeys(NOW, 60).length, 60); assert.equal(new Set(D.dayKeys(NOW, 60)).size, 60);
});

test('hourly counts land on the right Eastern day, the last 30 apart from the 30 before, and the grid by time of day', () => {
  const s = D.shape({
    callsH: [{ h: '2026-11-16T02', real: 2, test: 1, secs: 120 },     // 9 PM Sunday Nov 15 Eastern: today, the Night band
      { h: '2026-11-13T14', real: 1, test: 0, secs: 60 },              // 9 AM Friday
      { h: '2026-10-10T15', real: 4, test: 2, secs: 10 },              // 36 days back: the 30 before
      { h: '2026-08-01T15', real: 9, test: 9, secs: 9 }],              // older than 60 days: nowhere
    auditsH: [{ h: '2026-11-15T16', n: 3 }], leadsH: [{ h: '2026-11-14T16', n: 2 }], textsH: [{ h: '2026-10-01T16', n: 5 }], errorsH: []
  }, NOW);
  assert.equal(s.days.length, 30); assert.equal(s.days[29].d, '2026-11-15'); assert.equal(s.days[29].label, 'Nov 15'); assert.equal(s.days[29].wd, 'Sun');
  assert.equal(s.days[29].real, 2); assert.equal(s.days[29].test, 1); assert.equal(s.days[27].real, 1); assert.equal(s.days[29].audits, 3); assert.equal(s.days[28].leads, 2);
  assert.deepEqual([s.tot.real, s.tot.test, s.prev.real, s.prev.test], [3, 1, 4, 2]);
  assert.deepEqual([s.tot.texts, s.prev.texts], [0, 5]);
  assert.deepEqual(s.week, { real: 3, test: 1, prevReal: 0 });
  assert.equal(s.heat[6][5], 2, 'Sunday, night'); assert.equal(s.heat[4][1], 1, 'Friday, 9 to noon');
  assert.equal(s.heat.flat().reduce((a, b) => a + b, 0), 3, 'only real calls, only the last 30 days');
});

test('renewals read from the setting, soonest first, and a scale whose middle line is a whole number', () => {
  const r = D.renewals('alwaysopenoffice.com domain:2027-10-24|Apple Developer Program (Always Open app on the App Store):2027-10-07|junk', NOW);
  assert.deepEqual(r.map(x => x.name), ['Apple Developer Program (Always Open app on the App Store)', 'alwaysopenoffice.com domain']);
  assert.equal(r[0].days, 326); assert.deepEqual(D.renewals('', NOW), []);
  for (const m of [1, 3, 5, 7, 9, 11, 25, 37, 51, 99, 130, 999]) { const top = D.niceMax(m); assert.ok(top >= m && Number.isInteger(top / 2), m + ' -> ' + top); }
  assert.equal(D.usd(94.617), '$94.62'); assert.equal(D.usd(1446), '$1,446'); assert.equal(D.usd(-6.5), '−$6.50'); assert.equal(D.usd(0), '$0'); assert.equal(D.pct(1, 0), '–');
});

test('charts: a legend only when there are two series, one readout per day, and words that never ride the stretch', () => {
  const days = D.shape({ callsH: [{ h: '2026-11-15T16', real: 2, test: 3, secs: 0 }] }, NOW).days;
  const two = D.columns(days, [{ name: 'real calls', key: 'real' }, { name: 'test calls', key: 'test' }], { label: 'Calls a day' });
  assert.match(two, /<div class="lg"><span><i class="key s1"><\/i>real calls<\/span><span><i class="key s2"><\/i>test calls<\/span><\/div>/);
  assert.equal((two.match(/class="hit"/g) || []).length, 30, 'every day is its own hit area, so a thumb can find it');
  assert.match(two, /data-tip="Sun Nov 15: 2 real calls, 3 test calls"/);
  assert.equal((two.match(/<path class="s2"/g) || []).length, 1, 'the top of the stack is the rounded one'); assert.equal((two.match(/<rect class="s1"/g) || []).length, 1);
  assert.match(two, /preserveAspectRatio="none"/); assert.doesNotMatch(two, /<text/, 'no words inside the stretched plot: they would blur on a phone');
  assert.doesNotMatch(D.DASH_CSS, /\.sw\b/, 'the Outreach switch on this page is class "sw" (opsboard.js); a chart style of that name squashed it');
  const one = D.columns(days, [{ name: 'audits', key: 'audits' }]);
  assert.doesNotMatch(one, /class="lg"/, 'one series needs no legend: the panel title names it');
  assert.match(D.line([{ label: 'Nov 1', v: 60 }, { label: 'Nov 2', v: 94.62 }], { fmt: v => D.usd(Math.round(v)) }), /<b class="endl" style="bottom:94\.6%">\$95<\/b>/, 'the last value is named at the end of the line');
  assert.match(D.line([{ label: 'x', v: 1 }]), /Not enough readings yet/);
  const g = D.heatGrid([[0, 0, 0, 0, 0, 0], [0, 4, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
  assert.match(g, /<td class="h5" tabindex="0" data-tip="Tue 9a–12: 4 calls">4<\/td>/); assert.match(g, /<td class="h2" tabindex="0" data-tip="Tue Night: 1 call">1<\/td>/); assert.match(g, /<td class="h0"[^>]*>·<\/td>/);
  assert.equal(D.alarmName('health:ntfy'), 'Check failing: Phone alerts'); assert.equal(D.alarmName('cron:voicemail'), 'Job failing: voicemail'); assert.equal(D.alarmName('deploy'), 'A deploy did not go through'); assert.equal(D.alarmName('odd'), 'odd');
  assert.equal(D.st('bad', 'Failing <now>'), '<span class="st bad"><i aria-hidden="true">✕</i>Failing &lt;now&gt;</span>', 'a state is an icon and a word, and the word is text');
});

// A site like the live one on Nov 15, 2026: no paying client yet, the sales line with a nightly test call, the sample
// business with made-up calls, a few audits and requests.
async function world() {
  const DB = makeDB(), env = { DB, LEADS_KEY: 'k-for-tests', RENEWALS: 'alwaysopenoffice.com domain:2027-10-24' };
  const run = (sql, ...b) => DB.prepare(sql).bind(...b).run();
  await (await import('../src/leadmail.js')).ensureLeadMail(env);
  await (await import('../src/ops.js')).ensureRuns(env);
  await run("INSERT INTO app_clients (client_id, business, tier) VALUES ('demo-plumbing', 'Demo Plumbing Co.', 'Pro'), ('oak', 'Oak & Iron <Builders>', 'Pro')");
  await run("INSERT INTO voice_lines (number, client_id, business, on_air) VALUES ('+14785550100', 'demo-plumbing', 'Demo Plumbing Co.', 1), ('+14785550102', 'oak', 'Oak', 1)");
  const call = (id, cid, at, test, outcome, secs) => run("INSERT INTO app_calls (id, client_id, at, caller, outcome, status, seconds, test) VALUES (?1, ?2, ?3, '+14705550123', ?4, 'new', ?5, ?6)", id, cid, iso(at), outcome || 'done', secs || 60, test);
  await call('r1', 'always-open', NOW - 2 * H, 0); await call('r2', 'oak', NOW - 3 * DAY, 0, 'hangup', 30); await call('r3', 'oak', NOW - 40 * DAY, 0);
  await call('t1', 'always-open', NOW - 14 * H, 1); await call('t2', 'always-open', NOW - 38 * H, 1);
  await call('d1', 'demo-plumbing', NOW - 5 * H, 0); await call('d2', 'demo-plumbing', NOW - 6 * H, 0);
  await call('sp', 'always-open', NOW - 7 * H, 0, 'spam');
  await run("INSERT INTO audits (at, q, town, kind, score) VALUES (?1, 'a', 't', 'full', 95), (?2, 'b', 't', 'full', 50), (?3, 'c', 't', 'full', 30)", iso(NOW - H), iso(NOW - 2 * DAY), iso(NOW - 45 * DAY));
  await run("INSERT INTO leads (at, business, email, origin, status, audit, views) VALUES (?1, 'Moss Roofing', 'pat@moss.example', 'https://alwaysopenoffice.com', 'new', 'sent', '2'), (?2, '', '', 'phone t1', 'new', '', ''), (?3, 'Junk', 'x@y.example', 'https://alwaysopenoffice.com', 'spam', '', ''), (?4, 'Lakeside Dental', '', 'letter 14', 'letter', '', '')", iso(NOW - 3 * H), iso(NOW - 14 * H), iso(NOW - 5 * H), iso(NOW - 4 * DAY));
  await run("INSERT INTO sms_log (client_id, to10, at, kind, status) VALUES ('oak', '4785550123', ?1, 'textback', 'delivered'), ('oak', '4785550123', ?1, 'review', 'failed'), ('oak', '4785550123', ?1, 'review', 'skipped')", iso(NOW - DAY));
  await run("INSERT INTO cron_runs (name, at, ms, ok, note) VALUES ('tick', ?1, 0, 1, ''), ('voicemail', ?1, 1200, 0, 'Twilio answered 503'), ('board', ?2, 9000, 1, '')", iso(NOW - 4 * 60000), iso(NOW - 11 * H));
  for (let h = 48; h >= 0; h--) await run("INSERT INTO funding_log (at, service, value) VALUES (?1, 'twilio', ?2)", iso(NOW - h * H), 100 - (48 - h) * 0.05);
  return { DB, env };
}

test('the numbers come straight from the tables: test calls, spam and the sample business are each kept apart', async () => {
  const { env } = await world();
  const d = await D.dashState(env, NOW);
  assert.deepEqual([d.tot.real, d.tot.test], [2, 2], 'two real calls in 30 days (the sales line and Oak), two test calls; not the spam call, not the sample business');
  assert.equal(d.prev.real, 1, 'the one 40 days back is in the 30 before');
  assert.deepEqual(d.callWho.map(r => r.client_id + ':' + r.n).sort(), ['always-open:1', 'demo-plumbing:2', 'oak:1'], 'by line, the sample business named so it can be marked');
  assert.equal(d.callWho.find(r => r.client_id === 'oak').n, 1);
  assert.deepEqual([d.tot.audits, d.prev.audits], [2, 1]); assert.equal(d.audits90[0].n, 3);
  assert.equal((await (await import('../src/numbers.js')).numbersState(env, NOW)).funnel.now.requests, 2, 'the numbers page leaves the test call out too (a letter still counts there)');
  assert.equal(d.tot.leads, 1, 'one request: not the spam, not the test call, and not a letter nobody has answered');
  assert.deepEqual(d.auditG.map(r => r.g + r.n).sort(), ['A1', 'D1']);
  assert.equal(d.tot.texts, 2, 'a text a rule held back was never sent');
  assert.equal(d.leadMail[0].sent, 1); assert.equal(d.leadMail[0].viewed, 1);
  assert.equal(d.twilio.balance, 100 - 48 * 0.05); assert.ok(Math.abs(d.twilio.perDay - 1.2) < 0.01, 'a nickel an hour is $1.20 a day'); assert.equal(Math.round(d.twilio.daysLeft), 81);
  assert.ok(d.twilio.series.length >= 2 && d.twilio.series[d.twilio.series.length - 1].d === '2026-11-15', 'one closing balance per Eastern day');
  assert.equal(d.cron.length, 3); assert.equal(d.cron.filter(r => !+r.ok)[0].name, 'voicemail');
  assert.deepEqual(d.renewals.map(r => r.days), [343]);
  // a database with none of these tables yet still gives a page, with gaps where the numbers would be
  const bare = await D.dashState({ DB: { prepare() { throw new Error('no such table'); } } }, NOW);
  assert.equal(bare.tot.real, 0); assert.equal(bare.twilio, null); assert.deepEqual(bare.callsH, []);
});

test('the page: every part is on it and open, each tile leads somewhere real, and nothing is left unsaid', async () => {
  const { env } = await world();
  const s = await Q.hqState(env, NOW), html = Q.hqHtml(s, 'TOK');
  assert.ok(s.dash && s.dash.tot, 'the page reads the dashboard beside the list');
  for (const id of ['needs', 'system', 'money', 'sales', 'calls', 'clients', 'texts', 'work', 'look']) {
    assert.match(html, new RegExp('<h2 id="' + id + '">'), 'the ' + id + ' part is on the page');
    assert.match(html, new RegExp('<nav class="jump"[^>]*>.*<a href="#' + id + '">'), 'and the bar at the top goes to it');
  }
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
  const tiles = [...html.matchAll(/<a class="kp" href="#([^"]+)">/g)].map(m => m[1]);
  assert.ok(tiles.length >= 9, 'a row of figures on top: ' + tiles.length); for (const t of tiles) assert.ok(ids.has(t), 'tile goes to #' + t);
  for (const title of ['Checks', 'Background jobs', 'The 4 AM test call', 'Safety nets', 'Crashes, 7 days', 'Phone lines', 'Approvals and renewals', 'Twilio balance, 30 days', 'Revenue and cost, a month',
    'From first touch to client, 90 days', 'Free audits a day', 'Requests a day', 'Every request', 'Calls a day', 'When real calls come in', 'How calls ended, 30 days', 'Real calls by line, 30 days', 'Calls Max took this week',
    'Clients', 'This month for each client', 'Who is drifting', 'Texts a day', 'Texts by kind, 30 days', 'Work in the pipes']) assert.ok(html.includes('<h3>' + title), title + ' is on the page');
  // only forms and reference fold now: the wording rules and the add-a-client form (and "Write to them" in a client's row)
  const folds = [...html.matchAll(/<details class="look" id="look-([a-z]+)">/g)].map(m => m[1]);
  assert.deepEqual(folds, ['wording', 'add']);
  // what it says is what the tables hold
  assert.match(html, /<span class="kl">Real calls, 7 days<\/span><b>2<\/b>/); assert.match(html, /<span class="kl">Paying clients<\/span><b>0<\/b>/);
  assert.match(html, /<span class="kl">Twilio balance<\/span><b>\$97\.60<\/b><span class="st ok"><i aria-hidden="true">✓<\/i>81 days left<\/span>/);
  // the tile goes by the money watch's own rule (funding.js): under $25 is low however slowly it is falling, as on Nov 15, 2026 ($20.12, "63 days left", shown as fine)
  const low = Q.hqHtml(Object.assign({}, s, { dash: Object.assign({}, s.dash, { twilio: Object.assign({}, s.dash.twilio, { balance: 20.12, perDay: 0.32, daysLeft: 63, level: 'warn' }) }) }), 'TOK');
  assert.match(low, /<span class="kl">Twilio balance<\/span><b>\$20\.12<\/b><span class="st warn"><i aria-hidden="true">!<\/i>Low, 63 days left<\/span>/);
  assert.equal(s.dash.twilio.level, 'ok');
  assert.match(html, /<span class="kl">Checks passing<\/span><b>\d+ of \d+<\/b><span class="st bad">/, 'a failing job turns the tile, with a word beside the mark');
  assert.match(html, /<li class="bad" tabindex="0" data-tip="voicemail: last ran Today 6:21 PM, took 1\.2 s\. Twilio answered 503">/);
  assert.match(html, /<h3>Calls a day <span class="ct">2 real, 2 test<\/span><\/h3>/);
  assert.match(html, /Oak &amp; Iron &lt;Builders&gt;/); assert.doesNotMatch(html, /<Builders>/);
  assert.match(html, /<td>Always Open sales line<\/td><td class="r">1<\/td>/, 'the sales line by name in calls by line');
  assert.match(html, /No paying clients yet\. Each one gets a row here/);
  assert.match(html, /2 calls made up for the sample business are not shown either\./);
  assert.doesNotMatch(html, /undefined|NaN|\[object|Invalid Date/); assert.doesNotMatch(html, /prompt\(|alert\(|confirm\(/, 'no pop-up boxes'); assert.doesNotMatch(html, /\bAI\b/);
  const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(js)); assert.doesNotMatch(js, /innerHTML/, 'the chart readout writes plain text only');
  // without the dashboard (a number could not be read) the page still opens, with the list and its buttons
  const plain = Q.hqHtml(Object.assign({}, s, { dash: null }), 'TOK');
  assert.match(plain, /<h2 id="needs">Needs you<\/h2>/); assert.match(plain, /<h3>Every request/); assert.doesNotMatch(plain, /<h2 id="system">/);
});

// Nov 15, 2026: on the live site every button on HQ was dead, and had been since the page was built. The page sends
// two functions to the browser as their own text; the deploy's bundler adds __name(...) calls inside that text, and
// nothing in the page defined __name, so the script threw on its first line. The tests never saw it because they run
// the code as written. This runs the page's script the way a browser does, after doing to it what the bundler does.
test('the page script runs to the end in a browser, even after the bundler has put its __name calls in it', async () => {
  const { env } = await world();
  const html = Q.hqHtml(await Q.hqState(env, NOW), 'TOK');
  const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(js.startsWith(Q.NAME_SHIM), 'the helper comes first');
  // what the bundler does: after each named function declared inside another, a call to __name(thatFunction, "its name")
  const bundled = js.replace(/^(\s+)function (send|again|show|hide)\(([^)]*)\) \{(.*)\}$/gm, (m, sp, name) => m + '\n' + sp + '__name(' + name + ', "' + name + '");');
  assert.ok((bundled.match(/__name\(/g) || []).length >= 3, 'the rehearsal really did add the calls');
  const vm = await import('node:vm');
  const run = code => {
    const heard = [], made = [];
    const el = () => ({ setAttribute() {}, style: {}, hidden: false });
    const sandbox = {
      document: { addEventListener: (k) => heard.push(k), createElement: () => { const e = el(); made.push(e); return e; }, body: { appendChild() {} }, querySelectorAll: () => [], visibilityState: 'visible' },
      window: { addEventListener: (k) => heard.push('window:' + k), innerWidth: 390 }, sessionStorage: { getItem: () => '[]', setItem() {} }, location: { reload() {} }, history: {}, navigator: {}, fetch() {}, setInterval() {}, setTimeout() {}, JSON
    };
    vm.runInNewContext(code, sandbox);
    return heard;
  };
  assert.throws(() => run(bundled.slice(Q.NAME_SHIM.length)), /__name is not defined/, 'without the helper, this is the live failure');
  const heard = run(bundled);
  assert.ok(heard.includes('click'), 'the buttons are listened for');
  assert.ok(heard.includes('pointermove') && heard.includes('focusin'), 'and the chart readout is on');
});
