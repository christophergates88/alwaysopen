// Promises we retired because the product cannot keep them. If one comes back anywhere a customer can read it, the deploy fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['public', 'src', 'tools'];
const SKIP = /\.(png|jpe?g|gif|webp|ico|woff2?|pdf|mp3|wav|svg)$/i;
const RETIRED = [
  [/nothing goes out in your name until you tap it in the app/i, 'replies and posts wait for your tap; routine texts and calls start when turned on'],
  [/and rings you if it(?:'|’|&#39;|\\u2019)s urgent/i, 'say "alerts you" instead'],
  [/tries your phone if/i, 'say "alerts you right away if"'],
  [/a set time from your calendar/i, 'times come from inside your hours'],
  [/weekly (?:google )?post/i, 'the weekly Google post is not built'],
  [/Max[^.<]{0,40}\bAdd-on\b|\bAdd-on\b[^.<]{0,40}Max/, 'Max is on every plan, not an add-on'],
  [/Google and Facebook review/i, 'only Google review replies are offered'],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (!SKIP.test(e.name)) out.push(p);
  }
  return out;
}

test('retired promises do not come back', () => {
  const bad = [];
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const f of walk(root)) {
      const text = fs.readFileSync(f, 'utf8');
      for (const [re, why] of RETIRED) {
        const m = text.match(re);
        if (m) bad.push(f + ': "' + m[0] + '" (' + why + ')');
      }
    }
  }
  assert.deepEqual(bad, []);
});
