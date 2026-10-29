"""The sample monthly report that leads every page's hero: one page, the way a client gets it on the 2nd of the month.
Every business and number here is made up; the caption calls it an example report. Used by tools/industry.py (trade pages) and by
tools/report_put.py (home, builders, insurance). The markup sits between <!--ao:report--> markers so it can be rebuilt."""
import html

CSS = """/* ao:report css: the sample monthly report in the hero, lit like the OPEN sign */
.rp-wrap{position:relative;display:grid;justify-items:center;gap:12px;padding-top:26px}
.report{position:relative;width:min(460px,100%);background:radial-gradient(420px 220px at 18% 0%,rgba(255,90,77,.13),transparent 70%),linear-gradient(165deg,#1B2232 0%,#121722 100%);color:#ECEEF3;border:1.5px solid rgba(255,106,94,.6);border-radius:18px;padding:20px 22px 16px;box-shadow:0 0 0 1px rgba(255,106,94,.16),0 0 34px rgba(255,90,77,.34),inset 0 0 26px rgba(255,90,77,.07),0 40px 70px -34px rgba(0,0,0,.95);text-align:left}
.rp-top{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.09)}
.rp-top svg{width:30px;height:30px;flex:none;filter:drop-shadow(0 0 8px rgba(255,106,94,.55))}
.rp-top div{display:grid;line-height:1.2;min-width:0}
.rp-top b{font:800 1.05rem var(--display);font-stretch:94%;color:#fff}
.rp-top span{font-size:13px;color:#A3ACBF}
.rp-top time{margin-left:auto;font:500 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#A3ACBF;white-space:nowrap}
.rp-hero{display:grid;gap:2px;padding:18px 0 14px;border-bottom:1px solid rgba(255,255,255,.09)}
.rp-lab{font:500 11px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:#A3ACBF}
.rp-hero b{font:850 clamp(3rem,9vw,3.9rem)/1 var(--display);font-stretch:88%;letter-spacing:-.01em;color:#FF6A5E;text-shadow:0 0 12px rgba(255,106,94,.8),0 0 36px rgba(255,90,77,.5)}
.rp-hero small{font:400 13px/1.35 var(--body);color:#A3ACBF}
.rp-hero.calm b{color:#fff;text-shadow:0 0 16px rgba(255,255,255,.25)}
.rp-line{display:flex;align-items:baseline;gap:10px;padding:12px 0 10px}
.rp-line b{font:850 2rem/1 var(--display);font-stretch:90%;color:#fff;text-shadow:0 0 14px rgba(255,255,255,.22)}
.rp-line span{font:700 1rem/1.2 var(--display);font-stretch:94%;color:#fff}
.rp-line small{display:block;font:400 12.5px/1.3 var(--body);color:#A3ACBF;margin-top:2px}
.rp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.rp-grid div{padding:9px 10px;display:grid;gap:1px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);min-width:0}
.rp-grid b{font:850 1.3rem/1 var(--display);font-stretch:90%;color:#ECEEF3}
.rp-grid span{font-size:12px;font-weight:600;color:#C9CFDB;line-height:1.2}
.rp-grid small{font-size:11px;color:#8C95A8;line-height:1.25}
.rp-check{margin:10px 0 0;padding:8px 12px;border-radius:12px;background:rgba(92,201,164,.07);border:1px solid rgba(92,201,164,.45);box-shadow:0 0 16px rgba(92,201,164,.14);color:#C5EBDD;font-size:13px;line-height:1.4}
.rp-check b{font-weight:700;color:#7EE0BE;text-shadow:0 0 10px rgba(92,201,164,.55)}
@media (max-width:540px){.rp-grid{grid-template-columns:1fr 1fr}}
/* In the dark hero, red is light: the OPEN sign, the dare and the report glow. Solid buttons there are paper-white so they don't compete. */
.hero .btn.primary{background:#ECEEF3;color:#12151C;border-color:#ECEEF3}.hero .btn.primary:hover{background:#fff;border-color:#fff}
.hero .top .btn.primary{background:transparent;color:#ECEEF3;border-color:rgba(236,238,243,.4)}.hero .top .btn.primary:hover{border-color:#ECEEF3;background:rgba(255,255,255,.06)}
.rp-ping{position:absolute;top:0;right:max(0px,calc(50% - 250px));z-index:2;display:flex;gap:8px;align-items:center;background:rgba(23,28,39,.94);color:#ECEEF3;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:8px 12px;font-size:13px;box-shadow:0 18px 34px -18px rgba(0,0,0,.8),0 0 18px rgba(255,90,77,.2);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.rp-ping svg{width:20px;height:20px;flex:none}
.rp-ping b{font-weight:700}
.rp-ping time{font:500 11px var(--mono);color:#A3ACBF}
.rp-cap{margin:0;font:400 12px var(--mono);color:var(--night-mute,#A3ACBF);text-align:center;max-width:420px}
.rp-cap a{color:#FF8C82;text-underline-offset:3px;white-space:nowrap}
@keyframes rpGlow{0%,100%{box-shadow:0 0 0 1px rgba(255,106,94,.14),0 0 28px rgba(255,90,77,.28),inset 0 0 22px rgba(255,90,77,.06),0 40px 70px -34px rgba(0,0,0,.95)}50%{box-shadow:0 0 0 1px rgba(255,106,94,.24),0 0 42px rgba(255,90,77,.44),inset 0 0 30px rgba(255,90,77,.1),0 40px 70px -34px rgba(0,0,0,.95)}}
@media (prefers-reduced-motion:no-preference){.rp-ping{animation:rpIn .6s .5s cubic-bezier(.2,.8,.2,1) both}@keyframes rpIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}.report{animation:rpGlow 3.2s ease-in-out infinite}}
/* /ao:report css */"""

# Each page's sample month. hero: (number, label, note); cells: four (number, label, note); worth: (label, amount, note) or None.
PAGES = {
  'index': dict(check=(8, 1), biz='Mike’s Plumbing', who='a plumber', hero=('14', 'calls answered', '6 after hours or on a weekend'),
                cells=[('5', 'jobs booked', '2 from Fill my week'), ('3', 'reviews replied to', 'Rating 4.4 to 4.6'),
                       ('4', 'quotes followed up', '2 said yes'), ('2', 'posts on Google', '1 storm-day post')],
                worth=('What it was worth', 'about $4,900', 'booked work, at your average job')),
  'builders': dict(check=(5, 1), biz='Brannock Builders', who='a builder', hero=('12', 'calls answered', '5 while you were on a roof'),
                   cells=[('4', 'site visits booked', 'all on your calendar'), ('2', 'reviews replied to', 'Rating 4.6 to 4.8'),
                          ('6', 'quotes followed up', '2 said yes'), ('4', 'posts on Google', 'from your job photos')],
                   worth=('What it was worth', 'about $41,000', 'in quotes that said yes')),
  'plumbing': dict(check=(11, 1), biz='Quillen Plumbing', who='a plumber', hero=('22', 'calls answered', '9 after hours or on a weekend'),
                   cells=[('7', 'jobs booked', '3 from Fill my week'), ('5', 'reviews replied to', 'Rating 4.5 to 4.7'),
                          ('6', 'estimates followed up', '3 said yes'), ('3', 'posts on Google', '1 storm-day post')],
                   worth=('What it was worth', 'about $6,200', 'booked work, at your average job')),
  'hvac': dict(check=(14, 2), biz='Tolliver Heating and Air', who='a heating and air company', hero=('31', 'calls answered', '11 after hours, 4 with no heat'),
               cells=[('9', 'jobs booked', '4 tune-ups from Fill my week'), ('6', 'reviews replied to', 'Rating 4.3 to 4.6'),
                      ('5', 'estimates followed up', '2 new systems said yes'), ('3', 'posts on Google', '1 storm-day post')],
               worth=('What it was worth', 'about $11,800', 'booked work, at your average job')),
  'auto-repair': dict(check=(12, 1), biz='Pickard Auto', who='an auto repair shop', hero=('26', 'calls answered', '8 while you were under a car'),
                      cells=[('11', 'bays booked', '3 from Fill my week'), ('7', 'reviews replied to', 'Rating 4.2 to 4.5'),
                             ('5', 'estimates followed up', '3 said yes'), ('2', 'posts on Google', 'from your shop photos')],
                      worth=('What it was worth', 'about $5,400', 'booked work, at your average repair')),
  'marine': dict(check=(4, 1), biz='Kessler Marine', who='a marine business', hero=('17', 'calls answered', '7 on the weekend'),
                 cells=[('4', 'jobs booked', '1 lift repair the same day'), ('3', 'reviews replied to', 'Rating 4.5 to 4.7'),
                        ('3', 'quotes followed up', '1 new dock said yes'), ('2', 'posts on Google', '1 storm-day post')],
                 worth=('What it was worth', 'about $24,800', 'in quotes that said yes')),
  'salons': dict(check=(9, 1), biz='Larkspur Salon', who='a salon', hero=('38', 'calls answered', '15 while your hands were busy'),
                 cells=[('16', 'appointments booked', '6 from open chairs filled'), ('9', 'reviews replied to', 'Rating 4.6 to 4.8'),
                        ('5', 'clients back', 'due for a visit, and came'), ('4', 'posts on Google', 'from your photos')],
                 worth=('What it was worth', 'about $2,700', 'in booked visits')),
  'restaurants': dict(check=(3, 0), biz='Brickyard Kitchen', who='a restaurant', hero=('64', 'calls answered', '41 during the dinner rush'),
                      cells=[('6', 'catering requests', '2 booked'), ('11', 'reviews replied to', 'Rating 4.3 to 4.5'),
                             ('4', 'quotes followed up', 'lunch for 40 said yes'), ('5', 'posts on Google', 'specials and holiday hours')],
                      worth=('What it was worth', 'about $3,100', 'in catering and large orders')),
  'dental': dict(biz='Elm Street Family Dental', who='a dental practice', hero=('18', 'calls answered', 'after hours, messages to your phone'),
                 cells=[('7', 'visit requests', 'taken any hour'), ('6', 'reviews replied to', 'Rating 4.5 to 4.7'),
                        ('6', 'replies checked', 'by Compliance Guard, 1 rewritten'), ('2', 'posts on Google', 'holiday hours, a weather closure')],
                 worth=None, foot='No patient names, visits or treatment anywhere on this page. Every reply and post is on file with it.'),
  'insurance': dict(biz='Haskell Insurance', who='an agency', hero=('8', 'reviews replied to', 'all from your approved wording'),
                    cells=[('8', 'replies checked', 'by Compliance Guard, 2 rewritten'), ('1', 'rate wave flagged', 'by Rate-Shock Radar, a week early'),
                           ('22', 'after-hours messages', 'taken by Max, none about policies'), ('3', 'posts on Google', 'that teach, never sell')],
                    worth=None, foot='Every public word, on file with this page, for your compliance contact.'),
}
MONTH, SENT = 'October', 'Nov 2'

def e(s):
    return html.escape(s, quote=True)

def render(key):
    r = PAGES[key]
    n, lab, note = r['hero']
    aria = 'Example monthly report for ' + r['biz'] + ', ' + MONTH + ': ' + \
        (r['worth'][0].lower() + ' ' + r['worth'][1] + '; ' if r['worth'] else '') + n + ' ' + lab + ' (' + note + '); ' + \
        '; '.join(c[0] + ' ' + c[1] + ' (' + c[2] + ')' for c in r['cells']) + \
        ('; three-day check-ins: ' + str(r['check'][0]) + ' held up, ' + str(r['check'][1]) + ' told the owner first' if r.get('check') else '') + '.'
    cells = ''.join('<div><b>' + e(c[0]) + '</b><span>' + e(c[1]) + '</span><small>' + e(c[2]) + '</small></div>' for c in r['cells'])
    ck = r.get('check')
    check = ('<p class="rp-check"><b>' + str(ck[0]) + '</b> customers said the job held up on the three-day check-in' + (', and <b>' + str(ck[1]) + '</b> told you about a problem first.' if ck[1] else '.') + '</p>') if ck else ''
    if r['worth']:
        # money leads; the calls are the supporting line
        hero = ('<p class="rp-hero"><span class="rp-lab">' + e(r['worth'][0]).replace('What it was worth', 'What ' + MONTH + ' was worth') + '</span><b>' + e(r['worth'][1]) + '</b><small>' + e(r['worth'][2]) + '</small></p>\n'
                '          <p class="rp-line"><b>' + e(n) + '</b><span>' + e(lab) + '<small>' + e(note) + '</small></span></p>\n')
    else:
        hero = '<p class="rp-hero calm"><span class="rp-lab">' + MONTH + '</span><b>' + e(n) + '</b><small>' + e(lab) + '. ' + e(note) + '</small></p>\n'
    return ('<!--ao:report-->\n      <div class="rp-wrap">\n'
            '        <div class="rp-ping" aria-hidden="true"><svg viewBox="0 0 64 64"><use href="#logo"/></svg><span><b>Your ' + MONTH + ' page is ready</b><br><time>' + SENT + ', 7:00 AM</time></span></div>\n'
            '        <div class="report" role="img" aria-label="' + e(aria) + '">\n'
            '          <div class="rp-top"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg><div><b>' + e(r['biz']) + '</b><span>' + MONTH + ', on one page</span></div><time>' + SENT + '</time></div>\n'
            '          ' + hero +
            '          <div class="rp-grid">' + cells + '</div>\n'
            '          ' + check + '\n'
            '        </div>\n'
            '        <p class="rp-cap">An example report. Yours comes on the 2nd of every month.' + ('' if key in ('dental', 'insurance') else ' <a href="/sample-report">See the whole page</a>') + '</p>\n'
            '      </div>\n      <!--/ao:report-->')

def put_css(s):
    """Add the report styles to a page's first <style> block once (replacing an older copy)."""
    import re
    s = re.sub(r'/\* ao:report css.*?/\* /ao:report css \*/\n?', '', s, flags=re.S)
    i = s.index('</style>')
    return s[:i] + CSS + '\n' + s[i:]

def put(s, key):
    import re
    block = render(key)
    if '<!--ao:report-->' in s:
        return re.sub(r'<!--ao:report-->.*?<!--/ao:report-->', lambda m: block, s, count=1, flags=re.S)
    raise ValueError('no report slot')
