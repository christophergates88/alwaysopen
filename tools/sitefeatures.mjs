// The feature wall: real screens, not words. Each frame is what a CLIENT gets (Nov 4: the operator emails are gone):
// the Storm Desk post waiting for their OK (stormdesk.js templates), the Rate-Shock push and post (index.js), the
// Competitor Watch card, Max's clock, Max's Monday timecard, and a Compliance Guard check using the approved library
// wording (mailin.js), scaled down into a phone-shaped frame. Each page gets the frames that fit its kind of business. Drawn into the site pages between
// <!-- wall:start --> and <!-- wall:end -->, at the top of the "Tap to try it" band, where the grade check used to sit
// (the grade check lives in the free-audit section). Run: node tools/sitefeatures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
register(new URL('../test/rehearsal/hooks.mjs', import.meta.url), import.meta.url);
const { TEMPLATES } = await import('../src/stormdesk.js');
const { radarNotes, RADAR_POST } = await import('../src/index.js');
const { libraryText } = await import('../src/mailin.js');
const { sampleClock, clockSVG, CLOCK_CSS } = await import('../src/clock.js');
const { timecardNumbers, timecardText } = await import('../src/timecard.js');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// An email's body, as it lands in the inbox, without the document shell.
function emailBody(html) {
  const a = html.indexOf('<body'), b = html.indexOf('>', a) + 1, c = html.lastIndexOf('</body>');
  // a picture of the email: its links are not links here
  return html.slice(b, c).replace(/<div style="display:none[^>]*>[^<]*<\/div>/, '').replace(/<a\s[^>]*>/g, '<span>').replace(/<\/a>/g, '</span>');
}

const clock = clockSVG(sampleClock(), { id: 'wall', size: 300, live: true });
const tc = timecardNumbers({ calls: 41, booked: 9, kept: 6, due: 6, after: 10, leads: 8, avgJob: 400, winRate: 50, monthlyCents: 29900, back: 155 });
const tcText = timecardText(tc, 'Max', 'Oct 26–Nov 1');

const NEON = '"Tilt Neon","Archivo",system-ui,sans-serif';
const glow = (c) => 'text-shadow:0 0 2px #fff,0 0 10px ' + c + ',0 0 24px ' + c;
// The Competitor Watch card, as the app draws it (rivalspage.js): the sign, the two numbers, the nearby list.
// Who is on the Competitor Watch list, in each page's own trade. Every business here is made up.
const WHO = { plumbing: ['plumbers', 'Lane Plumbing', 'Oconee Plumbing', 'Lake Drain Co.'], hvac: ['heating and air companies', 'Lane Heating & Air', 'Oconee Comfort', 'Lake Air Co.'],
  builders: ['builders', 'Lane Builders', 'Oconee Homes', 'Lake Country Construction'], 'auto-repair': ['auto shops', 'Lane Auto', 'Oconee Tire & Service', 'Lake Garage'],
  marine: ['marine businesses', 'Lane Marine', 'Oconee Docks', 'Lake Boat Works'], marinas: ['marinas', 'Lane Harbor Marina', 'Oconee Point Marina', 'Lake Landing'],
  salons: ['salons', 'Lane Salon', 'Oconee Hair Studio', 'Lake Beauty Bar'], restaurants: ['restaurants', 'Lane Street Grill', 'Oconee Kitchen', 'Lake Diner'],
  dental: ['dental offices', 'Lane Family Dental', 'Oconee Smiles', 'Lake Dental Care'], insurance: ['agencies', 'Lane Insurance', 'Oconee Insurance Group', 'Lake Country Agency'] };
const rivalsFor = p => { const [plural, a, b, c] = WHO[p] || WHO.plumbing; return '<div style="font-family:Instrument Sans,system-ui,sans-serif;color:#ECEEF3;padding:18px 16px;background:#0F131B;min-height:560px">' +
  '<div style="font:600 13px/1.2 DM Mono,ui-monospace,monospace;letter-spacing:.08em;color:#A3ACBF;text-transform:uppercase">Competitor watch · checked just now</div>' +
  '<div style="margin:14px 0;padding:26px 14px 22px;text-align:center;border:2px solid #FF6A5E;border-radius:18px;background:#0A0D13;box-shadow:0 0 10px #FF6A5E,0 0 30px rgba(255,90,77,.5)">' +
  '<div style="font:400 44px/1.05 ' + NEON + ';color:#fff;' + glow('#FF6A5E') + '">YOU’RE #2</div><div style="margin-top:8px;font:600 16px/1.3 Instrument Sans,system-ui,sans-serif">of 6 ' + plural + ' near Eatonton, on rating</div></div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
  '<div style="background:#171C27;border:1px solid #262E40;border-radius:14px;padding:14px"><div style="font:400 34px/1 ' + NEON + ';color:#fff;' + glow('#5CC9A4') + '">4.7★</div><div style="color:#A3ACBF;font-size:13px;margin-top:4px">you · 30 reviews</div></div>' +
  '<div style="background:#171C27;border:1px solid #262E40;border-radius:14px;padding:14px"><div style="font:400 34px/1 ' + NEON + ';color:#fff;' + glow('#FF6A5E') + '">4.8★</div><div style="color:#A3ACBF;font-size:13px;margin-top:4px">the leader · 36 reviews</div></div></div>' +
  '<div style="margin-top:14px;font:600 14px Instrument Sans,system-ui,sans-serif">To be #1</div><div style="color:#A3ACBF;font-size:14px;line-height:1.4;margin-top:4px">7 more 5-star reviews. At your pace, about 6 weeks. Every finished job already gets the ask.</div>' +
  '<div style="margin-top:14px;display:grid;gap:8px;font-size:14px">' + [[a, '4.8★ · 36'], ['You', '4.7★ · 30'], [b, '4.5★ · 44'], [c, '4.3★ · 102']].map((r, i) =>
    '<div style="display:flex;justify-content:space-between;padding:10px 12px;border-radius:12px;background:' + (r[0] === 'You' ? 'rgba(255,90,77,.1);border:1px solid rgba(255,106,94,.5)' : '#171C27;border:1px solid #262E40') + '"><span>' + (i + 1) + '. ' + r[0] + '</span><span style="color:#A3ACBF">' + r[1] + '</span></div>').join('') + '</div>' +
  '<div style="margin-top:12px;color:#6F7A90;font-size:11px">Numbers from Google Maps, looked up when you tap Check now, and not kept.</div></div>'; };

// Max's Monday text, as an iMessage thread.
const bubble = (t, mine) => '<div style="max-width:88%;margin:' + (mine ? '6px 0 6px auto' : '6px 0') + ';padding:10px 14px;border-radius:18px;background:' + (mine ? '#2F7CF6' : '#26262B') + ';color:#fff;font:15px/1.35 -apple-system,Instrument Sans,system-ui,sans-serif;white-space:pre-line">' + esc(t) + '</div>';
const timecard = '<div style="background:#000;min-height:560px;padding:14px 12px;font-family:-apple-system,system-ui,sans-serif">' +
  '<div style="text-align:center;color:#8E8E93;font-size:12px;margin:4px 0 10px">Monday 8:04 AM</div>' + bubble(tcText) +
  bubble('What did the after hours calls come from', true) +
  bubble('6 water heaters, 2 clogs, 1 leak under a sink, 1 asked for a quote. 4 of the 10 booked on the call. The leak was urgent; you took it at 11:12 PM.') + '</div>';

// Compliance Guard: a reply being checked before it can be approved.
const guard = '<div style="font-family:Instrument Sans,system-ui,sans-serif;color:#ECEEF3;padding:18px 16px;background:#0F131B;min-height:560px">' +
  '<div style="font:600 13px/1.2 DM Mono,ui-monospace,monospace;letter-spacing:.08em;color:#A3ACBF;text-transform:uppercase">Reply to approve · Google review</div>' +
  '<div style="margin-top:12px;background:#171C27;border:1px solid #262E40;border-radius:14px;padding:14px"><div style="color:#F2C46B">★★☆☆☆</div><div style="margin-top:6px;font-size:14px;line-height:1.4;color:#C9D0DC">“Called about my claim three times and nobody called back. Rates went up again too.”</div><div style="margin-top:6px;color:#6F7A90;font-size:12px">R. Patel · 2 days ago</div></div>' +
  '<div style="margin:12px 0 0;padding:14px;border-radius:14px;background:#0A0D13;border:2px solid #5CC9A4;box-shadow:0 0 10px rgba(92,201,164,.6)"><div style="font:400 26px/1.05 ' + NEON + ';color:#fff;' + glow('#5CC9A4') + '">COMPLIANCE GUARD</div>' +
  '<div style="margin-top:8px;font-size:14px;line-height:1.45">Draft reply, checked against your approved wording:</div>' +
  '<div style="margin-top:8px;padding:12px;border-radius:10px;background:#171C27;font-size:14px;line-height:1.45;color:#ECEEF3">' + esc(libraryText('claim', 'en', 'R.', '(478) 555-0142')) + '</div>' +
  '<div style="margin-top:10px;display:grid;gap:6px;font-size:13px;color:#A3ACBF"><div><span style="color:#5CC9A4">✓</span> No claim details mentioned</div><div><span style="color:#5CC9A4">✓</span> No rates, discounts or promises</div><div><span style="color:#5CC9A4">✓</span> Approved wording only</div></div></div>' +
  '<div style="margin-top:12px;display:flex;gap:8px"><div style="flex:1;text-align:center;padding:12px;border-radius:12px;background:#5CC9A4;color:#06231A;font-weight:700;font-size:14px">Approve</div><div style="flex:1;text-align:center;padding:12px;border-radius:12px;border:1.5px solid #3A4357;font-weight:600;font-size:14px">Change the words</div></div></div>';

const clockFrame = '<div style="background:#0F131B;min-height:560px;padding:18px 16px;font-family:Instrument Sans,system-ui,sans-serif;color:#ECEEF3">' +
  '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font:800 19px Archivo,system-ui,sans-serif">Max’s clock</b><span style="font:12px DM Mono,ui-monospace,monospace;color:#FF6A5E">● on a call now</span></div>' +
  '<div class="wallclk" style="display:grid;place-items:center;margin-top:8px">' + clock + '</div>' +
  '<div style="display:flex;gap:14px;margin-top:6px;font-size:13px;color:#A3ACBF"><span><b style="color:#FF6A5E;font-size:18px">$6,400</b><br>caught closed</span><span><b style="color:#fff;font-size:18px">744h</b><br>on the clock</span><span><b style="color:#fff;font-size:18px">60</b><br>calls</span><span><b style="color:#FF6A5E;font-size:18px">3</b><br>to you</span></div></div>';

// An app card the client approves, as the app draws it: a sign, what it is about, the words, Approve / Edit first.
const card = (sign, color, about, label, words, extra) => '<div style="font-family:Instrument Sans,system-ui,sans-serif;color:#ECEEF3;padding:18px 16px;background:#0F131B;min-height:560px">' + (extra || '') +
  '<div style="margin-top:12px;padding:14px;border-radius:14px;background:#0A0D13;border:2px solid ' + color + ';box-shadow:0 0 10px ' + color + '"><div style="font:400 26px/1.05 ' + NEON + ';color:#fff;' + glow(color) + '">' + sign + '</div>' +
  '<div style="margin-top:8px;font-size:14px;line-height:1.45;color:#C9D0DC">' + esc(about) + '</div></div>' +
  '<div style="margin-top:12px;font:600 13px/1.2 DM Mono,ui-monospace,monospace;letter-spacing:.06em;color:#A3ACBF">' + esc(label) + '</div>' +
  '<div style="margin-top:8px;padding:12px;border-radius:12px;background:#171C27;border:1px solid #262E40;font-size:14px;line-height:1.45">' + esc(words) + '</div>' +
  '<div style="margin-top:12px;display:flex;gap:8px"><div style="flex:1;text-align:center;padding:12px;border-radius:12px;background:#5CC9A4;color:#06231A;font-weight:700;font-size:14px">Approve</div><div style="flex:1;text-align:center;padding:12px;border-radius:12px;border:1.5px solid #3A4357;color:#ECEEF3;font-weight:600;font-size:14px">Edit first</div></div></div>';
const phone = '(478) 555-0142';
const stormFor = kind => card('FLOOD WARNING', '#FF6A5E', 'Flash Flood Warning for Putnam County, GA, until 9:30 AM. Your post is written and waiting.', 'YOUR GOOGLE POST · READY FOR YOUR OK', TEMPLATES[kind].flood.replace('{phone}', phone));
const note = radarNotes([{ cid: 'c', town: 'Eatonton, GA' }], [{ town: 'Eatonton, GA', wave: true, why: 'rate', rate: 4, low: 3 }])[0].note.aps.alert;
const push = '<div style="padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.08);border:1px solid #262E40"><div style="display:flex;justify-content:space-between;color:#A3ACBF;font-size:12px"><b style="color:#ECEEF3">Always Open</b><span>Mon 8:17 AM</span></div>' +
  '<div style="margin-top:4px;font-weight:700;font-size:14px">' + esc(note.title) + '</div><div style="margin-top:2px;font-size:13px;line-height:1.4;color:#C9D0DC">' + esc(note.body) + '</div></div>';
const radar = card('RATES RISING', '#FF6A5E', 'Unhappy reviews about rate increases are piling up at agencies in your town this month.', 'YOUR GOOGLE POST · READY FOR YOUR OK', RADAR_POST.text, push);

const F = {
  storm: k => ({ k: 'storm', name: 'Storm Desk', cap: 'A weather warning hits your county. Your post is written before the rain, waiting for your OK.', body: stormFor(k), scale: 0.78, w: 372 }),
  radar: { k: 'radar', name: 'Rate-Shock Radar', cap: 'For insurance agencies: when rate complaints pile up in your town, a heads-up and a post, that Monday.', body: radar, scale: 0.78, w: 372 },
  rivals: p => ({ k: 'rivals', name: 'Competitor Watch', cap: 'Where you stand against the businesses nearby, and what it takes to be #1.', body: rivalsFor(p), scale: 0.78, w: 372 }),
  clock: { k: 'clock', name: 'Max’s clock', cap: 'Every call on one dial, and what the closed hours were worth.', body: clockFrame, scale: 0.78, w: 372 },
  timecard: { k: 'timecard', name: 'Max’s timecard', cap: 'Every Monday morning, one text: what he did last week and what he cost.', body: timecard, scale: 0.78, w: 372 },
  guard: { k: 'guard', name: 'Compliance Guard', cap: 'Every reply checked against the wording your compliance contact approved.', body: guard, scale: 0.78, w: 372 }
};
// Which screens each page shows: only what that kind of business gets. Regulated pages get no booking numbers.
const framesFor = p => p === 'index' ? [F.storm('trades'), F.rivals('plumbing'), F.clock, F.timecard, F.radar, F.guard]
  : p === 'insurance' ? [F.radar, F.guard, F.storm('insurance'), F.rivals(p)]
  : p === 'dental' ? [F.guard, F.storm('general'), F.rivals(p)]
  : [F.storm(p === 'restaurants' || p === 'salons' ? 'general' : 'trades'), F.rivals(p), F.clock, F.timecard];
const H = 560;
const css = CLOCK_CSS + '.wallclk{--clk-ink:#fff;--clk-mute:#A3ACBF;--clk-line:rgba(255,255,255,.07);--clk-night:rgba(255,90,77,.18);--clk-ok:#5CC9A4;--clk-sign:#FF6A5E}.wallclk .clk{width:230px;height:auto}.wallclk .clk .clk-big{font-family:Archivo,system-ui,sans-serif}' +
  '.wall{margin:0 0 34px}.wall .head{max-width:760px}.wall h2{color:#fff}.wall .head p{color:#A3ACBF;font-size:1.12rem;margin-top:10px}' +
  '.wall-rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:26px}' +
  '.wall-item{display:grid;gap:10px;min-width:0}.wall-item h3{font-size:1.15rem;color:#fff}.wall-item p{margin:0;color:#A3ACBF;font-size:.95rem;line-height:1.4}' +
  '.wall-frame{position:relative;height:440px;overflow:hidden;border-radius:22px;border:1.5px solid rgba(255,106,94,.5);background:#0A0D13;box-shadow:0 0 0 1px rgba(255,106,94,.12),0 0 28px rgba(255,90,77,.22),inset 0 0 20px rgba(255,90,77,.05)}' +
  '.wall-frame>div{position:absolute;left:0;top:0;transform-origin:top left;pointer-events:none}.wall-frame::after{content:"";position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(transparent,#0A0D13)}' +
  '.wall-frame table{border-collapse:separate}.wall-frame td{padding:0}' +
  '.wall-rail.n4{grid-template-columns:repeat(2,minmax(0,1fr));max-width:760px}' +
  '@media (max-width:900px){.wall-rail{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
  '@media (max-width:760px){.wall-rail{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px 12px;scrollbar-width:none}.wall-rail::-webkit-scrollbar{display:none}.wall-item{flex:0 0 78vw;max-width:320px;scroll-snap-align:start}}';

const sectionFor = p => { const frames = framesFor(p); return '<!-- wall:start -->\n<div class="wall" id="wall"><style>' + css + '</style>' +
  '<div class="head"><p class="eyebrow">What it looks like</p><h2 id="wall-h">Real screens. Each one is what you get.</h2><p>Not a feature list. These are the actual texts and app screens Always Open sends, filled in for made-up businesses.</p></div>' +
  '<div class="wall-rail' + (frames.length === 4 ? ' n4' : '') + '" role="list">' + frames.map(f => {
    const w = f.w, s = f.scale, fw = Math.round(w * s);
    return '<div class="wall-item" role="listitem"><div class="wall-frame" style="max-width:' + fw + 'px" role="img" aria-label="' + esc(f.name + ': ' + f.cap) + '"><div style="width:' + w + 'px;transform:scale(' + s + ')">' + f.body + '</div></div><h3>' + esc(f.name) + '</h3><p>' + esc(f.cap) + '</p></div>';
  }).join('') + '</div></div>\n<!-- wall:end -->\n'; };

const PAGES = ['index', 'plumbing', 'hvac', 'builders', 'auto-repair', 'marine', 'marinas', 'insurance', 'dental', 'salons', 'restaurants'];
for (const p of PAGES) {
  const f = 'public/' + p + '.html';
  let s = readFileSync(f, 'utf8');
  // the grade-check deck moves from the top of "Tap to try it" to its bottom; the wall takes its spot
  const a = s.indexOf('<div class="aos-deck">');
  if (a > -1) {
    const b = s.indexOf('<div></div></div>', a) + '<div></div></div>'.length, deck = s.slice(a, b);
    s = s.slice(0, a) + '<!-- wall:here -->' + s.slice(b);
    const go = s.indexOf('<section class="aos band" id="go"'), end = s.indexOf('</section>', go);
    s = s.slice(0, end) + '<!-- grade:start -->\n' + deck + '\n<!-- grade:end -->\n' + s.slice(end);
  }
  if (s.includes('<!-- wall:start -->')) s = s.replace(/<!-- wall:start -->[\s\S]*?<!-- wall:end -->\n?/, sectionFor(p));
  else if (s.includes('<!-- wall:here -->')) s = s.replace('<!-- wall:here -->', sectionFor(p));
  else { console.log('skip', f); continue; }
  writeFileSync(f, s);
  console.log('wall drawn into', f);
}
