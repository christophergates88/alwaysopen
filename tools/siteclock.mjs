// Draws Max's clock (src/clock.js, the website sample) into the site pages, between <!-- clock:start --> and
// <!-- clock:end -->. Run after changing clock.js or the copy below: node tools/siteclock.mjs
// The section is self-contained (its own <style>), lands right after the "What Always Open does" band, and the hand
// keeps the visitor's own time while the page is open.
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
register(new URL('../test/rehearsal/hooks.mjs', import.meta.url), import.meta.url);
const { sampleClock, clockSVG, clockLines, CLOCK_CSS, CLOCK_JS } = await import('../src/clock.js');

const m = sampleClock();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = clockLines(m);
const svg = clockSVG(m, { id: 'site', size: 340, live: true });
const css = CLOCK_CSS +
  '.clockband{padding-block:88px;background:var(--night);color:var(--night-ink);position:relative;border-top:1px solid var(--night-line)}' +
  '.clockband::before{content:"";position:absolute;inset:0;background:radial-gradient(55% 60% at 78% 20%,rgba(255,90,77,.16),transparent 70%);pointer-events:none}' +
  '.clockband .inner{position:relative}.clockband .eyebrow{color:var(--night-sign)}.clockband h2{font-size:clamp(2.2rem,6vw,3.6rem);line-height:1.02;max-width:12em}' +
  '.clockgrid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;margin-top:34px}' +
  '.clockstage{--clk-ink:#fff;--clk-mute:var(--night-mute);--clk-line:rgba(255,255,255,.07);--clk-night:rgba(255,90,77,.18);--clk-ok:#5CC9A4;--clk-sign:var(--night-sign);display:grid;place-items:center;gap:14px}' +
  '.clockstage .dial{position:relative;padding:22px;border-radius:30px;border:1.5px solid rgba(255,106,94,.5);background:radial-gradient(60% 40% at 50% 0%,rgba(255,90,77,.1),transparent 70%),var(--night-card);box-shadow:0 0 0 1px rgba(255,106,94,.14),0 0 34px rgba(255,90,77,.26),inset 0 0 24px rgba(255,90,77,.05)}' +
  '@media (prefers-reduced-motion:no-preference){.clockstage .dial{animation:clockBreath 3.4s ease-in-out infinite}}@keyframes clockBreath{0%,100%{box-shadow:0 0 0 1px rgba(255,106,94,.14),0 0 30px rgba(255,90,77,.22),inset 0 0 24px rgba(255,90,77,.05)}50%{box-shadow:0 0 0 1px rgba(255,106,94,.24),0 0 48px rgba(255,90,77,.4),inset 0 0 30px rgba(255,90,77,.08)}}' +
  '.clockstage .clk{width:min(340px,80vw);height:auto}.clockstage .clk .clk-big{font-family:var(--display);font-stretch:92%}' +
  '.clockstage .clockcap{margin:0;font:400 12px var(--mono);color:var(--night-mute);text-align:center;max-width:380px}' +
  '.clockcopy{display:grid;gap:16px;align-content:start}.clockcopy p.lead{color:var(--night-mute);font-size:1.12rem;max-width:30em;margin:0}' +
  '.clockfacts{list-style:none;margin:0;padding:0;display:grid;gap:10px}.clockfacts li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline;font-size:1.02rem}' +
  '.clockfacts li b{font-family:var(--display);font-stretch:92%;font-weight:850;font-size:1.6rem;line-height:1;color:#fff;text-shadow:0 0 12px rgba(255,255,255,.25);min-width:3.2em}.clockfacts li b.red{color:var(--night-sign);text-shadow:0 0 12px rgba(255,106,94,.7)}.clockfacts li b.ok{color:#7EE0BE;text-shadow:0 0 12px rgba(92,201,164,.6)}' +
  '.clockone{margin:0;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,106,94,.45);background:rgba(255,90,77,.08);box-shadow:0 0 18px rgba(255,90,77,.14);font-size:1rem;line-height:1.45}.clockone b{color:#FF8C82;text-shadow:0 0 8px rgba(255,106,94,.55)}' +
  '.clockwhere{margin:0;color:var(--night-mute);font-size:.98rem;max-width:32em}.clockwhere b{color:var(--night-ink)}' +
  '.clockcopy .ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}.clockcopy .btn.line{color:var(--night-ink);border-color:rgba(255,255,255,.35)}' +
  '@media (max-width:900px){.clockgrid{grid-template-columns:1fr;gap:30px}.clockband{padding-block:64px}}';

const section = `<!-- clock:start -->
<section class="clockband band" id="clock" data-label="On the clock" aria-labelledby="clock-h">
  <style>${css}</style>
  <div class="inner">
    <div class="head"><p class="eyebrow">On the clock</p><h2 id="clock-h">744 hours a month. Here’s what they look like.</h2></div>
    <div class="clockgrid">
      <div class="clockstage">
        <div class="dial">${svg}</div>
        <p class="clockcap">Mike’s Plumbing, October. A made-up business; the dial is drawn the same way from yours.</p>
      </div>
      <div class="clockcopy">
        <p class="lead">Every business gets its month on one dial. Every call, check-in, reply, post and text sits at the minute it happened. The shaded hours are 6 PM to 8 AM, when nobody is at a desk. The number in the middle is your time, back.</p>
        <ul class="clockfacts">
          <li><b>744 h</b><span>on the clock. Clocked in Oct 1 at midnight. Never clocked out.</span></li>
          <li><b class="ok">${m.alone}</b><span>of ${m.calls} calls handled without you. Teal ticks.</span></li>
          <li><b class="red">${m.toYou}</b><span>brought to you, because they were urgent. Red ticks.</span></li>
          <li><b>${esc(lines[2].replace(/^Back to you: /, '').replace(/\.$/, ''))}</b><span>back to you: the calls, write-ups, replies, follow-ups and posts you didn’t have to do. The arithmetic is on the page.</span></li>
        </ul>
        <p class="clockone"><b>The one call.</b> ${esc(m.one.text)} Booked for 8 AM.</p>
        <p class="clockwhere">The dial is on <b>Today</b> in your app, with the hand moving. Every Monday it comes as a timecard text. On the 2nd it opens your month on one page.</p>
        <div class="ctas"><a class="btn primary" href="/sample-report">See the whole page</a><a class="btn line" href="/#contact">Get yours</a></div>
      </div>
    </div>
  </div>
  <script>${CLOCK_JS}</script>
</section>
<!-- clock:end -->
`;

for (const f of ['public/index.html', 'public/plumbing.html', 'public/hvac.html', 'public/builders.html', 'public/auto-repair.html', 'public/marine.html', 'public/insurance.html']) {
  let s = readFileSync(f, 'utf8');
  if (s.includes('<!-- clock:start -->')) s = s.replace(/<!-- clock:start -->[\s\S]*?<!-- clock:end -->\n?/, section);
  else {
    // right after "Tap to try it" (its grade check has to stay on the first three phone screens, tools/phonecheck.mjs);
    // the trade pages fold it on phones to stay inside their height limit, the home page shows it open
    const i = s.indexOf('<section class="aos band" id="go"'), j = i > -1 ? s.indexOf('</section>', i) + 10 : -1;
    if (j < 9) { console.log('skip', f); continue; }
    s = s.slice(0, j) + '\n\n' + section + s.slice(j);
  }
  if (!f.endsWith('index.html')) s = s.replace('<section class="clockband band" id="clock" data-label="On the clock"', '<section class="clockband band" id="clock" data-label="On the clock" data-fold="Every call on one dial, and the hours that came back to you."');
  writeFileSync(f, s);
  console.log('clock drawn into', f);
}
