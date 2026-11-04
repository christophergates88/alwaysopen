// Takes the duplicate blocks off every page: the "Is it worth it?" math, the "Everything we handle" list,
// the "Also only here" box and the add-on strip inside Tap to try it, and the grade check at its end.
// What stays says the same things: the feature wall, the plans with their add-ons, and the free audit form.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// cut one element: from its opening tag to its matching close, counting nested tags of the same name
function cutElement(s, openIdx, tag) {
  const openRe = new RegExp('<' + tag + '(\\s|>)', 'g'), closeRe = new RegExp('</' + tag + '>', 'g');
  let depth = 0, i = openIdx;
  while (true) {
    openRe.lastIndex = i; closeRe.lastIndex = i;
    const o = openRe.exec(s), c = closeRe.exec(s);
    if (!c) throw new Error('unbalanced ' + tag);
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; i = c.index + c[0].length; if (depth === 0) return s.slice(0, openIdx) + s.slice(i).replace(/^\n/, ''); }
  }
}
function cutAll(s, marker, tag) {
  let n = 0;
  for (let at = s.indexOf(marker); at > -1; at = s.indexOf(marker)) { s = cutElement(s, at, tag); n++; }
  return [s, n];
}

const DROP_ES = ['#all', '#worth', '#math', '#only .alsoonly', '#only .addstrip', '.aog', '#go-grade', '.ph-only'];
let changed = 0;
for (const f of readdirSync('public').filter(x => x.endsWith('.html'))) {
  const p = 'public/' + f;
  let s = readFileSync(p, 'utf8'), before = s, n;
  s = s.replace(/<!-- grade:start -->[\s\S]*?<!-- grade:end -->\n?/g, '');
  [s, n] = cutAll(s, '<section class="sec band alt" id="worth"', 'section');
  [s, n] = cutAll(s, '<section class="sec band" id="all"', 'section');
  [s, n] = cutAll(s, '<section class="sec band dark" id="math"', 'section');   // the trade pages' copy of the math
  [s, n] = cutAll(s, '<div class="alsoonly">', 'div');
  [s, n] = cutAll(s, '<div class="addstrip">', 'div');
  s = s.replace(/<a class="btn primary ph-only" href="#go-grade">Check my grade<\/a>/g, '');
  s = s.replace(/ <a href="#worth"[^>]*>Is it worth it\? Do the math\.<\/a>/g, '');
  // Spanish swaps for what is gone
  s = s.replace(/<script type="application\/json" id="ao-es">([\s\S]*?)<\/script>/, (m, j) => {
    const list = JSON.parse(j).filter(e => !DROP_ES.some(sel => e.s === sel || e.s.startsWith(sel + ' ') || e.s.startsWith(sel + ':')));
    return '<script type="application/json" id="ao-es">' + JSON.stringify(list) + '</script>';
  });
  if (s !== before) { writeFileSync(p, s); changed++; console.log('trimmed', p); }
}
console.log(changed, 'pages trimmed');
