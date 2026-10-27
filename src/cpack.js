// One-page PDF of every Compliance Guard rule for regulated clients, with sample replies that pass and are flagged,
// so a compliance reviewer can sign off. Built from the live rules, so it cannot drift. No client data.
import { guard, CG_RULES, CG_ALL } from './app.js';

const FAKE = { regulated: 1, banned: '' };
const PASS = [
  ['reply', 'Thank you for the kind words. We are glad our team could help, and we appreciate you taking the time to write.'],
  ['reply', 'Thanks for your feedback. We have shared it with the team and we are always glad to hear from you.'],
  ['post', 'Cold weather is a good time to check the batteries in your smoke alarms. Stop by the office any time with questions.']
];
const FLAG = [
  ['reply', 'We guarantee you will never be denied a claim.'],
  ['reply', 'Thanks for being a valued client! Your policy renewal is coming up and we have the lowest rates.'],
  ['post', 'Save up to 20% on car insurance this month. Get a quote today.'],
  ['reply', 'Leave us a review and get a $10 gift card.']
];
const RULE_EXAMPLE = {
  'Promises an outcome': 'We guarantee you will be covered.',
  'Talks about rates or prices': 'Call us for the lowest rates.',
  'Confirms they are a client': 'Your policy renewal is coming up.',
  'Mentions claim details': 'Your claim was paid in full.',
  'Sounds like advice': 'You should buy more coverage.',
  'Testimonial about an outcome': 'They saved me hundreds on my bill.'
};

const pdfEsc = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
function wrap(text, size, width) {
  const per = Math.floor(width / (size * 0.5)), out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > per) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export function packData() {
  const rules = CG_RULES.map(r => ({ why: r.why, where: r.kinds === 'all' ? 'replies and posts' : (r.kinds === 'reply' ? 'replies' : 'posts'), example: RULE_EXAMPLE[r.why] || '' }));
  const run = ([k, t]) => ({ kind: k, text: t, hits: guard(t, FAKE, k).map(h => h.why) });
  return { rules, passed: PASS.map(run), flagged: FLAG.map(run) };
}

export function buildPack(date) {
  const d = packData(), L = []; // { size, bold, text, indent }
  const add = (text, size, bold, indent, gap) => { wrap(text, size, 612 - 90 - (indent || 0)).forEach((ln, i) => L.push({ t: ln, s: size, b: !!bold, x: 45 + (indent || 0), g: i ? 0 : (gap || 0) })); };
  add('Always Open: Compliance Guard rule review', 16, true, 0, 0);
  add('For a compliance reviewer to read and sign. Generated ' + date + ' from the live rules. No client data is included.', 8.5, false, 0, 3);
  add('What it is. Before any reply or post for a regulated client (insurance, medical, legal and similar) reaches the owner for approval, Compliance Guard checks the text against the rules below. Anything flagged is held with the reason shown; the owner can edit it. Nothing is posted without the owner approving it. The guard is a safeguard, not legal advice.', 9, false, 0, 6);
  add('The rules (regulated clients)', 11, true, 0, 6);
  d.rules.forEach((r, i) => { add((i + 1) + '. ' + r.why + ' (' + r.where + '). Example it catches: "' + r.example + '"', 9, false, 8, 2); });
  add('Baseline for every client (regulated or not): ' + CG_ALL.map(r => r.why.toLowerCase()).join('; ') + '; no offer of anything in return for a review, because Google does not allow it (example: "' + FLAG[3][1] + '"); and the owner\'s own do-not-use word list.', 9, false, 8, 2);
  add('Samples that pass', 11, true, 0, 8);
  d.passed.forEach(s => add('PASSED (' + s.kind + '): "' + s.text + '"' + (s.hits.length ? '  [UNEXPECTED FLAG: ' + s.hits.join(', ') + ']' : ''), 9, false, 8, 2));
  add('Samples that are flagged', 11, true, 0, 8);
  d.flagged.forEach(s => add('FLAGGED (' + s.kind + '): "' + s.text + '"  Held because: ' + (s.hits.join('; ') || 'NOT FLAGGED (check)'), 9, false, 8, 2));
  add('Always disallowed for the phone assistant (Max) and automated drafts: giving insurance, legal, medical or financial advice, naming prices or promising outcomes, confirming whether someone is a client, and discussing claims.', 9, false, 0, 8);
  add('Reviewer sign-off:   Name ______________________   Title ______________________   Date ______________', 9, false, 0, 14);

  let y = 792 - 48, ops = '';
  for (const l of L) {
    y -= l.g + l.s * 1.32;
    ops += 'BT /' + (l.b ? 'F2' : 'F1') + ' ' + l.s + ' Tf ' + l.x + ' ' + y.toFixed(1) + ' Td (' + pdfEsc(l.t) + ') Tj ET\n';
  }
  if (y < 36) throw new Error('compliance pack no longer fits one page');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    '<< /Length ' + ops.length + ' >>\nstream\n' + ops + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xr = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF\n';
  return new TextEncoder().encode(out);
}
