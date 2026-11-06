// One share card per trade page (what iMessage, Facebook and LinkedIn show when a page is shared), and the page's share
// tags pointed at it. Each card says who it is for; the insurance card leads with Compliance Guard and has no dare.
// Needs the three fonts in tools/og/fonts (see make.mjs). Run: node tools/og/cards.mjs   (writes public/og-<page>.jpg and
// updates the og:/twitter: tags in public/<page>.html; the home page keeps og3.jpg from make.mjs)
import { createRequire } from 'node:module'; import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(here, '..', '..', 'public');
const SITE = 'https://alwaysopenoffice.com';
const ASK = '<b>You approve it all from your phone.</b>';
const CALL = { label: 'CALL MAX. WE DARE YOU.', number: '(706) 460-2226' };
export const PAGES = [
  { slug: 'insurance', kick: 'For insurance agencies', who: 'Your agency,', line: 'Calls after hours answered, messages only.<br>Every reply checked by Compliance Guard.<br><b>Nothing goes out until you approve it.</b>',
    guard: ['No claim details mentioned', 'No rates, discounts or promises', 'Approved wording only'],
    title: 'Always Open for insurance agencies', desc: 'Every review answered in wording your compliance contact approved, Compliance Guard on every reply, Rate-Shock Radar, and an after-hours line that only takes messages. Nothing goes out until you approve it.' },
  { slug: 'dental', kick: 'For dental practices', who: 'Your practice,', line: 'Calls the front desk misses, answered.<br>No treatment details, ever. Replies checked.<br>' + ASK, call: { label: 'CALL MAX ANY TIME', number: CALL.number }, title: 'Always Open for dental practices' },
  { slug: 'plumbing', kick: 'For plumbers', who: 'Your business,', line: 'Every call answered, day and night.<br>Estimates followed up. Slow days filled.<br>' + ASK, title: 'Always Open for plumbers' },
  { slug: 'hvac', kick: 'For heating and air', who: 'Your business,', line: 'Every call answered, day and night.<br>Maintenance and estimates followed up.<br>' + ASK, title: 'Always Open for heating and air companies' },
  { slug: 'auto-repair', kick: 'For auto repair shops', who: 'Your shop,', line: 'Every call answered, day and night.<br>Estimates followed up. Open bays filled.<br>' + ASK, title: 'Always Open for auto repair shops' },
  { slug: 'builders', kick: 'For builders and remodelers', who: 'Your business,', line: 'Every call answered. Quotes followed up.<br>Job photos turned into posts.<br>' + ASK, title: 'Always Open for builders and remodelers',
    desc: 'Always Open runs the back side of builders, remodelers and contractors: every call answered, every review replied to, quotes followed up on the day you pick, and job photos turned into posts. You approve it all from your phone.' },
  { slug: 'salons', kick: 'For salons, spas and gyms', who: 'Your business,', line: 'Every call answered. Appointments confirmed.<br>Open chairs filled from your own clients.<br>' + ASK, title: 'Always Open for salons, spas and gyms' },
  { slug: 'marine', kick: 'For dock builders and boat shops', who: 'Your business,', line: 'Every call answered. Quotes followed up.<br>Slow weeks filled from your own customers.<br>' + ASK, title: 'Always Open for dock builders and boat shops' },
  { slug: 'marinas', kick: 'For marinas', who: 'Your marina,', line: 'Every call answered. Slip renewals followed up.<br>Open rental days filled.<br>' + ASK, title: 'Always Open for marinas' },
  { slug: 'restaurants', kick: 'For restaurants and cafes', who: 'Your business,', line: 'Every call answered. Catering quotes followed up.<br>Slow nights filled from your regulars.<br>' + ASK, title: 'Always Open for restaurants and cafes' }
];
const plain = s => s.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
export function cardHtml(p, fonts) {
  const tpl = fs.readFileSync(path.join(here, 'share.html'), 'utf8').split('FONTS').join(fonts);
  const css = '.kick{font:500 32px "DM Mono";letter-spacing:.22em;text-transform:uppercase;color:#FFB3AC;margin:0 0 -18px}' +
    '.guard{display:grid;gap:10px;padding:24px 44px 22px;border:6px solid #5CC9A4;border-radius:30px;box-shadow:0 0 0 2px rgba(92,201,164,.25),0 0 50px rgba(92,201,164,.4),inset 0 0 30px rgba(92,201,164,.16)}' +
    '.guard span{font:500 28px "DM Mono";letter-spacing:.28em;color:#9BE3CA;text-align:center}.guard p{margin:0;font:600 40px/1.25 "Instrument Sans";color:#ECEEF3}.guard p i{font-style:normal;color:#5CC9A4;margin-right:16px}' +
    'h1{font-size:100px}.line{font-size:35px}.neon{padding:24px 64px 20px}.neon b{font-size:100px}.neon span{font-size:26px}' + (p.guard ? '.guard p{font-size:36px}.call b{font-size:88px}' : '');
  const bottom = p.guard ? '<div class="guard"><span>COMPLIANCE GUARD · EVERY REPLY</span>' + p.guard.map(g => '<p><i>✓</i>' + g + '</p>').join('') + '</div>'
    : '<div class="call"><span>' + (p.call || CALL).label + '</span><b>' + (p.call || CALL).number + '</b></div>';
  const body = '<div class="wm"><i><b></b></i>Always Open</div>\n<div class="neon"><b>OPEN</b><span>24 HOURS</span></div>\n<div class="kick">' + p.kick + '</div>\n<h1>' + p.who + '<br><em>always</em> open.</h1>\n<p class="line">' + p.line + '</p>\n' + bottom + '\n<div class="foot">alwaysopenoffice.com &nbsp;·&nbsp; Anywhere in the U.S.</div>\n';
  return tpl.replace('</style>', css + '</style>').replace(/<body>[\s\S]*<\/body>/, '<body>\n' + body + '</body>');
}
export function cardAlt(p) {
  return 'Always Open, ' + p.kick.toLowerCase() + ': ' + p.who.replace(/,$/, '') + ', always open. ' + plain(p.line) + (p.guard ? ' Compliance Guard on every reply: ' + p.guard.join(', ') + '.' : ' ' + (p.call || CALL).label.charAt(0) + (p.call || CALL).label.slice(1).toLowerCase() + ' ' + (p.call || CALL).number + '.');
}
// Points one page's share tags at its own address, title and card.
export function retag(html, p) {
  const set = (re, val) => { if (!re.test(html)) throw new Error(p.slug + ': no ' + re); html = html.replace(re, (m, a) => a + attr(val) + '"'); };
  set(/(<meta property="og:title" content=")[^"]*"/, p.title);
  if (p.desc) set(/(<meta property="og:description" content=")[^"]*"/, p.desc);
  set(/(<meta property="og:url" content=")[^"]*"/, SITE + '/' + p.slug);
  set(/(<meta property="og:image" content=")[^"]*"/, SITE + '/og-' + p.slug + '.jpg');
  set(/(<meta property="og:image:alt" content=")[^"]*"/, cardAlt(p));
  set(/(<meta name="twitter:image" content=")[^"]*"/, SITE + '/og-' + p.slug + '.jpg');
  if (/<meta name="twitter:title" content="/.test(html)) set(/(<meta name="twitter:title" content=")[^"]*"/, p.title);
  return html;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const fonts = 'file://' + (process.env.OG_FONTS || path.join(here, 'fonts'));
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1200, height: 1200 } });
  for (const p of PAGES) {
    const tmp = path.join(os.tmpdir(), 'ao-card-' + p.slug + '.html'); fs.writeFileSync(tmp, cardHtml(p, fonts));
    await pg.goto('file://' + tmp); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
    const over = await pg.evaluate(() => document.body.scrollHeight > 1200 || document.body.scrollWidth > 1200);
    if (over) throw new Error(p.slug + ': the card runs past 1200 px');
    await pg.screenshot({ path: path.join(pub, 'og-' + p.slug + '.jpg'), type: 'jpeg', quality: 88 });
    const f = path.join(pub, p.slug + '.html'); fs.writeFileSync(f, retag(fs.readFileSync(f, 'utf8'), p));
    console.log('card', p.slug);
  }
  await b.close();
}
