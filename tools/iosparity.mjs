// The iPhone app carries every card the web app does (Build Brief 7, Part 3).
// node tools/iosparity.mjs <AlwaysOpen swift folder> [cards.json]
// Reads every .swift file and fails when a card's `struct <ios>: View` is missing, or the file that holds it does not
// say the card's words. Runs in test/cards.test.js (when the iPhone folder is there) and in the iPhone build (build.sh),
// which has its own copy of this file and a cards.json written from src/cards.js.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function iosGaps(cards, files) {
  const gaps = [];
  for (const c of cards) {
    const re = new RegExp('struct\\s+' + c.ios + '\\s*:\\s*View\\b');
    const f = files.find(x => re.test(x.text));
    if (!f) { gaps.push(c.id + ': no struct ' + c.ios + ' in the iPhone app'); continue; }
    // the struct's own body: from its line to the next top-level struct
    const at = f.text.search(re), next = f.text.slice(at + 10).search(/\n(struct|final class|class|enum|extension)\s/);
    const body = next < 0 ? f.text.slice(at) : f.text.slice(at, at + 10 + next);
    for (const w of c.words || []) if (!body.includes(w)) gaps.push(c.id + ': ' + c.ios + ' does not say "' + w + '"');
  }
  return gaps;
}
export function readSwift(dir) {
  const out = [];
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.swift')) out.push({ name: n, text: readFileSync(p, 'utf8') }); } };
  walk(dir);
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const dir = process.argv[2];
  const cards = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : (await import('../src/cards.js')).CARDS;
  const gaps = iosGaps(cards, readSwift(dir));
  if (gaps.length) { console.log('iPhone app is missing ' + gaps.length + ':\n' + gaps.join('\n')); process.exit(1); }
  console.log('iPhone app has all ' + cards.length + ' cards.');
}
