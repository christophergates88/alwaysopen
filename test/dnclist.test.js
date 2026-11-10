// Our own copy of the National Do Not Call Registry (src/dnclist.js) and the Mac's monthly loader (tools/dncload.mjs):
// Always Open is an exempt organization, so the FTC's list is free and the paid check isn't needed (Nov 10, 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { register } from 'node:module';
register('./rehearsal/hooks.mjs', import.meta.url);
const D = await import('../src/dnclist.js');
const L = await import('../tools/dncload.mjs');
const { makeDB } = await import('./rehearsal/harness.js');

const NOV16 = Date.parse('2026-11-16T15:00:00Z');   // Monday, 10 AM Eastern
const lines = list => Buffer.from(list.join('\n') + '\n');

// The loader's own steps, with fetch pointed straight at the Worker's handler
function wire(env, now) {
  const seen = [];
  const f = async (url, init) => {
    assert.equal(init.headers['x-key'], 'K');
    const body = JSON.parse(init.body); seen.push(body.op);
    const r = await D.loadStep(env, body, now);
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: { 'content-type': 'application/json' } });
  };
  f.seen = seen; return f;
}

test('the loader reads the FTC file: area code and number per line, lines split across reads, Windows endings, junk lines counted', () => {
  const st = L.newState();
  const text = 'AREA,PHONE\r\n478,5550101\r\n478,5550102\n478555';
  L.feed(st, Buffer.from(text));
  L.feed(st, Buffer.from('0103\n706-299-9999\n4782000000\n478,5550101\n478,1550199\n12,3\n'));
  L.finishFeed(st);
  assert.equal(st.numbers, 5, '478-555-0101, -0102, -0103, 706-299-9999, 478-200-0000');
  assert.equal(st.dupes, 1);
  assert.equal(st.bad, 3, 'the header, an exchange starting with 1, and a short line');
  assert.deepEqual(L.areaCodes(st), [478, 706]);
  const body = L.areaBody(st, 478);
  assert.deepEqual(body.slices.map(s => s.h), [2, 3, 4, 5, 6, 7, 8, 9], 'every exchange hundred, empty ones too');
  assert.deepEqual(body.slices.map(s => s.n), [1, 0, 0, 3, 0, 0, 0, 0]);
  const bits = zlib.inflateSync(Buffer.from(body.slices[3].z, 'base64'));
  assert.equal(bits.length, D.SLICE_BYTES);
  const at = D.place('4785550102');
  assert.deepEqual([at.ac, at.h], [478, 5]);
  assert.ok(bits[at.bit >> 3] & (1 << (at.bit & 7)));
});

test('what a download is: the full list, the XML kind, a change list, or something else', () => {
  assert.equal(L.looksLike('478,5550101\n478,5550102\n'), 'full');
  assert.equal(L.looksLike('4785550101\r\n4785550102\r\n'), 'full');
  assert.equal(L.looksLike('<list level="ac"><ac val="478"><ph>5550101</ph>'), 'xml');
  assert.equal(L.looksLike('4785550101,2026-11-15T08:00:00,A\n'), 'changes');
  assert.equal(L.looksLike('Dear customer,\nyour invoice\n'), 'other');
  assert.equal(L.looksLike(''), 'empty');
});

test('it finds the newest download in Downloads (and files downloaded with it), and dates the list the day before', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnc-'));
  const put = (name, body, ago) => { const p = path.join(dir, name); fs.writeFileSync(p, body); const t = (NOV16 - ago) / 1000; fs.utimesSync(p, t, t); return p; };
  put('old-list.txt', '478,5550101\n', 9 * 86400000);
  put('notes.txt', 'shopping list\n', 3600000);
  put('changes.txt', '4785550101,2026-11-15T08:00:00,A\n', 2 * 3600000);
  const ga = put('GA.txt', '478,5550101\n706,5550102\n', 3 * 3600000);
  const al = put('AL.txt', '205,5550103\n', 2 * 3600000);
  const sub = path.join(dir, 'unzipped'); fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'TN.txt'), '615,5550104\n');
  const t = (NOV16 - 3600000) / 1000; fs.utimesSync(path.join(sub, 'TN.txt'), t, t); fs.utimesSync(sub, t, t);
  const found = L.findDownloads(dir, NOV16);
  assert.deepEqual(found.files.map(f => path.basename(f.path)).sort(), ['AL.txt', 'GA.txt', 'TN.txt'], 'not the week-old one, not the notes, not the change list');
  assert.deepEqual(found.why, ['changes']);
  assert.equal(L.asOfFor(found.files), '2026-11-15', 'the day before the earliest of them was downloaded');
  const xml = fs.mkdtempSync(path.join(os.tmpdir(), 'dnc-'));
  fs.writeFileSync(path.join(xml, 'list.txt'), '<list level="all"><ac val="478"><ph>5550101</ph></ac></list>\n');
  assert.deepEqual(L.findDownloads(xml).why, ['xml']);
  assert.ok(ga && al);
});

test('loaded: a listed number is skipped, the rest pass; no copy, an old copy or a bad row means not checked', async () => {
  const DB = makeDB(), env = { DB };
  assert.equal((await D.registryCheck(env, ['4785550101'], NOV16)).get('4785550101').unknown, true, 'nothing loaded yet');
  assert.equal((await D.dncListStatus(env, NOV16)).ready, false);
  const st = L.newState();
  L.feed(st, lines(['478,5550101', '478,2000000', '478,9999999', '706,2999999']));
  const r = await L.send(st, '2026-11-15', { key: 'K', base: 'https://x', fetch: wire(env, NOV16) });
  assert.equal(r.ok, true);
  assert.deepEqual([r.status.ready, r.status.areaCodes, r.status.numbers, r.status.asOf, r.status.dueBy], [true, 2, 4, '2026-11-15', '2026-12-15']);
  const m = await D.registryCheck(env, ['+14785550101', '478-200-0000', '4789999999', '7062999999', '4785550102', '7063000000', '2055550101', '4781550101'], NOV16);
  const why = p => { const x = m.get(p); return x.ok ? 'ok' : x.listed ? 'listed' : 'unknown: ' + x.why; };
  assert.equal(why('4785550101'), 'listed');
  assert.equal(why('4782000000'), 'listed', 'the first number of an exchange hundred');
  assert.equal(why('4789999999'), 'listed', 'the last number there is');
  assert.equal(why('7062999999'), 'listed');
  assert.equal(why('4785550102'), 'ok');
  assert.equal(why('7063000000'), 'ok');
  assert.equal(why('2055550101'), 'unknown: no Do Not Call list loaded for area code 205');
  assert.equal(why('4781550101'), 'unknown: not a valid US number');
  // 31 days on, the same copy no longer counts
  const late = await D.registryCheck(env, ['4785550102'], NOV16 + 31 * 86400000);
  assert.match(late.get('4785550102').why, /more than 30 days old/);
  assert.equal((await D.dncListStatus(env, NOV16 + 31 * 86400000)).ready, false);
  // a row that can't be read is not a yes
  await DB.prepare('UPDATE dnc_slices SET z = ?1 WHERE ac = 478 AND h = 5').bind(new Uint8Array([0x78, 0x9c, 1, 2, 3, 4, 5, 6]).buffer).run();
  assert.match((await D.registryCheck(env, ['4785550102'], NOV16)).get('4785550102').why, /could not be read/);
});

test('a load is refused when it is old, in the future, incomplete or garbled, and a new month replaces the old', async () => {
  const DB = makeDB(), env = { DB };
  assert.match((await D.loadStep(env, { op: 'begin', asOf: 'Nov 15' }, NOV16)).error, /YYYY-MM-DD/);
  assert.match((await D.loadStep(env, { op: 'begin', asOf: '2026-10-01' }, NOV16)).error, /more than 30 days old/);
  assert.match((await D.loadStep(env, { op: 'begin', asOf: '2026-11-20' }, NOV16)).error, /future/);
  const b = await D.loadStep(env, { op: 'begin', asOf: '2026-11-15' }, NOV16);
  const st = L.newState(); L.feed(st, lines(['478,5550101']));
  const body = L.areaBody(st, 478);
  assert.match((await D.loadStep(env, { op: 'area', id: b.id, ac: 478, slices: body.slices.slice(1) }, NOV16)).error, /missing exchanges 2xx/);
  assert.match((await D.loadStep(env, { op: 'area', id: b.id, ac: 478, slices: body.slices.map(s => Object.assign({}, s, { z: Buffer.from('hello there').toString('base64') })) }, NOV16)).error, /bad slice data/);
  assert.match((await D.loadStep(env, { op: 'area', id: b.id, ac: 12, slices: body.slices }, NOV16)).error, /bad area code/);
  assert.match((await D.loadStep(env, { op: 'area', id: 'nope', ac: 478, slices: body.slices }, NOV16)).error, /unknown load/);
  assert.equal((await D.loadStep(env, Object.assign({ op: 'area', id: b.id }, body), NOV16)).ok, true);
  assert.match((await D.loadStep(env, { op: 'finish', id: b.id, areaCodes: 300 }, NOV16)).error, /only 1 of 300 area codes arrived/, 'a load that stopped halfway is not marked done');
  assert.equal((await D.dncListStatus(env, NOV16)).ready, false);
  assert.equal((await D.loadStep(env, { op: 'finish', id: b.id, areaCodes: 1 }, NOV16)).ok, true);
  assert.match((await D.loadStep(env, { op: 'finish', id: b.id, areaCodes: 1 }, NOV16)).error, /already finished/);
  assert.equal((await D.registryCheck(env, ['4785550101'], NOV16)).get('4785550101').listed, true);
  // next month: the number came off the registry, and the new copy says so
  const DEC14 = NOV16 + 28 * 86400000;
  const st2 = L.newState(); L.feed(st2, lines(['478,5550202']));
  assert.equal((await L.send(st2, '2026-12-13', { key: 'K', base: 'https://x', fetch: wire(env, DEC14) })).ok, true);
  const m = await D.registryCheck(env, ['4785550101', '4785550202'], DEC14);
  assert.deepEqual([m.get('4785550101').ok, m.get('4785550202').listed], [true, true]);
  assert.equal((await D.dncListStatus(env, DEC14)).asOf, '2026-12-13');
});

test('the Mac loader says what to do in plain words when there is no key, and the site answers only with the key', async () => {
  const out = [], real = process.stdout.write;
  process.stdout.write = s => { out.push(String(s)); return true; };
  try { assert.equal(await L.main([], {}), 1); } finally { process.stdout.write = real; }
  assert.match(out.join(''), /ops key is missing, so nothing was sent/);
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /path === '\/ops\/dnc-list'[\s\S]{0,400}sameKey\(k, env\.LEADS_KEY\)[\s\S]{0,600}loadStep/);
  // the list is never sent back out: the GET answers with the status only
  assert.doesNotMatch(index.slice(index.indexOf("path === '/ops/dnc-list'"), index.indexOf("path === '/ops/outreach-review'")), /dnc_slices|registryCheck/);
});
