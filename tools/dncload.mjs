#!/usr/bin/env node
// Loads this month's National Do Not Call Registry into Always Open (src/dnclist.js). Copied to GatesHQ/tools on the Mac
// and run by "Load Do Not Call list.command":  node dncload.mjs [file or folder ...]   (the ops key comes in AO_KEY)
//
// With no file named it takes the newest FTC download in ~/Downloads: the .zip, the .txt Safari unzipped from it, or a
// folder of them (several files downloaded together, say one per state, are all taken). Every line is one registered
// number, "478,5551234" (area code, then the 7-digit number). It builds one bitmap per area code and exchange hundred
// and sends each area code to /ops/dnc-list. The list's date is the day before the file was downloaded (the FTC posts
// each day's list after 8 AM), so the list never claims to be newer than it is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SLICE_BYTES = 125000;
const SITE = 'https://alwaysopenoffice.com';
const WEEK = 7 * 86400000;

// ---------- reading the FTC's file ----------
export function newState() { return { slices: new Map(), numbers: 0, dupes: 0, bad: 0, nd: 0, v: 0, other: false, lastKey: -1, last: null }; }
function endLine(st) {
  if (st.nd === 10) {
    const v = st.v, ac = Math.floor(v / 1e7), rest = v % 1e7, nxx = Math.floor(rest / 1e4), h = Math.floor(nxx / 100);
    if (ac >= 200 && h >= 2) {
      const key = ac * 10 + h;
      if (key !== st.lastKey) {
        st.lastKey = key; st.last = st.slices.get(key);
        if (!st.last) { st.last = { bits: new Uint8Array(SLICE_BYTES), n: 0 }; st.slices.set(key, st.last); }
      }
      const bit = (nxx % 100) * 10000 + rest % 1e4, m = 1 << (bit & 7), i = bit >> 3, bits = st.last.bits;
      if (bits[i] & m) st.dupes++;
      else { bits[i] |= m; st.numbers++; st.last.n++; }
    } else st.bad++;
  } else if (st.nd || st.other) st.bad++;
  st.nd = 0; st.v = 0; st.other = false;
}
// Bytes in any amount; a line can end in one buffer and go on in the next.
export function feed(st, buf) {
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 10) endLine(st);
    else if (c >= 48 && c <= 57) { if (st.nd < 10) st.v = st.v * 10 + (c - 48); st.nd++; }
    else if (c !== 13 && c !== 44 && c !== 32 && c !== 9 && c !== 45) st.other = true;
  }
}
export function finishFeed(st) { if (st.nd || st.other) endLine(st); }

// What a file looks like from its first few KB: the full list (flat text), or something else said in plain words.
export function looksLike(sample) {
  const lines = String(sample || '').split(/\r?\n/).slice(0, 40).filter(x => x.trim());
  if (!lines.length) return 'empty';
  if (lines.some(x => /<\w+/.test(x))) return 'xml';
  if (lines.some(x => /\d{4}-\d{2}-\d{2}T\d{2}/.test(x))) return 'changes';
  const good = lines.filter(x => /^\s*\d{3}\s*[,-]?\s*\d{7}\s*$/.test(x) || /^\s*\d{10}\s*$/.test(x)).length;
  return good >= Math.max(1, Math.floor(lines.length * 0.8)) ? 'full' : 'other';
}

// The bitmaps of one area code, ready to send: exchanges 2xx to 9xx, empty ones too, each deflated and checked by
// inflating it back.
const EMPTY = new Uint8Array(SLICE_BYTES);
export function areaBody(st, ac) {
  const slices = [];
  for (let h = 2; h <= 9; h++) {
    const key = ac * 10 + h, sl = st.slices.get(key), bits = sl ? sl.bits : EMPTY;
    const z = zlib.deflateSync(bits, { level: 6 });
    const back = zlib.inflateSync(z);
    if (back.length !== SLICE_BYTES || Buffer.compare(back, Buffer.from(bits.buffer, bits.byteOffset, bits.byteLength)) !== 0) throw new Error('area code ' + ac + ' did not pack correctly');
    slices.push({ h, n: sl ? sl.n : 0, z: z.toString('base64') });
  }
  return { ac, slices };
}
export function areaCodes(st) { return [...new Set([...st.slices.keys()].map(k => Math.floor(k / 10)))].sort((a, b) => a - b); }

// ---------- finding the download ----------
function kindOf(p) {
  try {
    const s = fs.statSync(p);
    if (s.isDirectory()) return 'dir';
    if (/\.zip$/i.test(p)) return 'zip';
    if (/\.(txt|csv|dat)$/i.test(p)) return 'txt';
  } catch (e) { /* gone */ }
  return '';
}
function headOf(p, kind) {
  try {
    if (kind === 'txt') { const fd = fs.openSync(p, 'r'), b = Buffer.alloc(4096), n = fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd); return b.subarray(0, n).toString('latin1'); }
    if (kind === 'zip') return execFileSync('/bin/sh', ['-c', 'unzip -p "$1" 2>/dev/null | head -c 4096', 'sh', p], { encoding: 'latin1', maxBuffer: 1 << 20 });
  } catch (e) { /* not readable */ }
  return '';
}
// Every registry file in a folder (one level down too), as [path, kind].
function filesIn(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), k = kindOf(p);
    if (k === 'txt' || k === 'zip') out.push([p, k]);
    else if (k === 'dir') for (const m of fs.readdirSync(p)) { const q = path.join(p, m), kk = kindOf(q); if (kk === 'txt' || kk === 'zip') out.push([q, kk]); }
  }
  return out;
}
// The newest full-list download in a folder (Downloads), plus anything else downloaded within 12 hours of it.
export function findDownloads(dir, now) {
  now = now || Date.now();
  const seen = [], why = new Set();
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), k = kindOf(p);
    if (!k) continue;
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (now - st.mtimeMs > WEEK) continue;
    const parts = k === 'dir' ? filesIn(p) : [[p, k]];
    for (const [q, kk] of parts) {
      const look = looksLike(headOf(q, kk));
      if (look === 'full') seen.push({ path: q, kind: kk, at: fs.statSync(q).mtimeMs, downloaded: st.mtimeMs });
      else if (look === 'xml' || look === 'changes') why.add(look);
    }
  }
  seen.sort((a, b) => b.downloaded - a.downloaded);
  if (!seen.length) return { files: [], why: [...why] };
  const top = seen[0].downloaded;
  return { files: seen.filter(x => top - x.downloaded <= 12 * 3600000), why: [...why] };
}

// The list's date: New York's date the day before the earliest of these files was downloaded.
export function asOfFor(files) {
  const t = Math.min(...files.map(f => Math.min(f.at, f.downloaded))) - 86400000;
  const o = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t))) o[x.type] = x.value;
  return o.year + '-' + o.month + '-' + o.day;
}

// Read one file into the state: a .txt directly, a .zip through macOS's unzip.
export function readInto(st, file) {
  return new Promise((resolve, reject) => {
    const src = file.kind === 'zip' ? spawn('unzip', ['-p', file.path], { stdio: ['ignore', 'pipe', 'ignore'] }) : null;
    const s = src ? src.stdout : fs.createReadStream(file.path, { highWaterMark: 1 << 20 });
    s.on('data', b => feed(st, b));
    s.on('error', reject);
    s.on('end', () => { finishFeed(st); resolve(); });
    if (src) src.on('error', reject);
  });
}

// ---------- sending it ----------
async function post(f, base, key, body, tries) {
  let last = '';
  for (let t = 0; t < (tries || 4); t++) {
    try {
      const r = await f(base + '/ops/dnc-list', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': key }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) return j;
      last = (j && j.error) || ('answer ' + r.status);
      if (r.status === 403 || r.status === 400) break;   // the key or the data is wrong: trying again won't help
    } catch (e) { last = String((e && e.message) || e); }
    await new Promise(r => setTimeout(r, 1500 * (t + 1)));
  }
  throw new Error(last || 'no answer');
}
export async function send(st, asOf, opts) {
  const f = opts.fetch || fetch, base = opts.base || SITE, key = opts.key, say = opts.say || (() => {});
  const acs = areaCodes(st);
  if (!acs.length) throw new Error('no numbers to send');
  const { id } = await post(f, base, key, { op: 'begin', asOf });
  let done = 0, at = 0;
  const worker = async () => {
    while (at < acs.length) {
      const ac = acs[at++];
      await post(f, base, key, Object.assign({ op: 'area', id }, areaBody(st, ac)));
      if (++done % 25 === 0 || done === acs.length) say('  sent ' + done + ' of ' + acs.length + ' area codes');
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, acs.length) }, worker));
  return post(f, base, key, { op: 'finish', id, areaCodes: acs.length });
}

function nice(ymd) { return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }

export async function main(argv, env) {
  const say = s => process.stdout.write(s + '\n');
  const key = env.AO_KEY || '';
  if (!key) { say('The ops key is missing, so nothing was sent. Run this from "Load Do Not Call list.command".'); return 1; }
  let files;
  if (argv.length) files = argv.flatMap(p => kindOf(p) === 'dir' ? filesIn(p) : [[p, kindOf(p)]]).filter(([, k]) => k).map(([p, k]) => { const s = fs.statSync(p); return { path: p, kind: k, at: s.mtimeMs, downloaded: s.mtimeMs }; });
  else {
    const found = findDownloads(path.join(os.homedir(), 'Downloads'));
    files = found.files;
    if (!files.length) {
      if (found.why.includes('xml')) say('The Do Not Call file in Downloads is the XML kind. Download it again and pick the flat text format.');
      else if (found.why.includes('changes')) say('The Do Not Call file in Downloads is a change list. Download the full list (all area codes) instead.');
      else say('No Do Not Call list in your Downloads folder from the last week.\n\n1. Log in at telemarketing.donotcall.gov.\n2. Download the full list (all area codes, flat text).\n3. Double-click Load Do Not Call list again.');
      return 1;
    }
  }
  const asOf = asOfFor(files);
  say('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' (list dated ' + nice(asOf) + '). This takes a few minutes...');
  const st = newState();
  for (const f of files) await readInto(st, f);
  if (!st.numbers) { say('That file had no phone numbers in it, so nothing was sent.'); return 1; }
  say('Read ' + st.numbers.toLocaleString('en-US') + ' numbers in ' + areaCodes(st).length + ' area codes' + (st.bad ? ' (' + st.bad.toLocaleString('en-US') + ' lines skipped)' : '') + '. Sending to Always Open...');
  try {
    const r = await send(st, asOf, { key, say });
    const s = r.status || {};
    say('\nDone. Outreach is using the Do Not Call list dated ' + nice(asOf) + ' (' + (s.areaCodes || 0) + ' area codes, ' + (+s.numbers || 0).toLocaleString('en-US') + ' numbers).');
    if (s.dueBy) say('Load the next one before ' + nice(s.dueBy) + '. Outreach pauses itself after that.');
    return 0;
  } catch (e) {
    say('\nIt did not finish: ' + String((e && e.message) || e) + '\nDouble-click Load Do Not Call list again. If it fails twice, tell Claude.');
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2), process.env).then(code => process.exit(code), e => { process.stdout.write('It stopped: ' + String((e && e.message) || e) + '\n'); process.exit(1); });
}
