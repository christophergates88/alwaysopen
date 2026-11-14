"""Builds the draft home page (public/draft/index.html) from the live one (public/index.html).

Christopher asked (Nov 13, 2026) how the website should show the whole ecosystem. The plan he OK'd ("Do all"):
  1. top: "Your business, always open." with Call Max, and A day with Always Open (public/draft/day.html) next to it
  2. what it was worth: the month on one dial (the #clock section) with the sample report link
  3. the price and the try-it-for-a-month promise, then the Start form (#contact, the free audit)
  4. everything else folded under "Questions and details"
The live home page doesn't change until he says so. The draft is noindex, on no sitemap and linked from nowhere.

Run:  python3 tools/draft_home.py      (again after any change to public/index.html, so the draft keeps up)
Going live later means writing this result over public/index.html; the tools that rebuild the home page's front
(tools/phone.mjs, sitetap.mjs) still expect the old order and the <!--ao:front--> marker, so they change then too.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'index.html'
OUT = ROOT / 'public' / 'draft' / 'index.html'
DAY = '/draft/day'


def must(cond, what):
    if not cond:
        sys.exit('draft_home: ' + what + ' (the live page changed; update tools/draft_home.py)')


def top_sections(s, start):
    """Top-level <section> spans after `start`, with the text that sits between them."""
    spans, depth, open_at = [], 0, None
    for m in re.finditer(r'<section\b[^>]*>|</section>', s[start:]):
        a = start + m.start()
        if m.group(0).startswith('</'):
            depth -= 1
            if depth == 0:
                spans.append((open_at, start + m.end()))
        else:
            if depth == 0:
                open_at = a
            depth += 1
    return spans


def set_attr(tag, name, value):
    """Sets one attribute on an opening tag (adds it, or replaces what is there)."""
    if re.search(r'\s' + name + r'="[^"]*"', tag):
        return re.sub(r'(\s' + name + r')="[^"]*"', lambda m: m.group(1) + '="' + value + '"', tag, count=1)
    return tag[:-1] + ' ' + name + '="' + value + '">'


def build():
    s = SRC.read_text()

    # ---- head: never indexed (the live home page keeps the canonical address)
    must('<meta charset="utf-8">' in s, 'charset tag')
    s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">', 1)

    # ---- hero: the menu follows the new order
    nav_re = re.compile(r'<nav aria-label="Main">.*?</nav>', re.S)
    must(nav_re.search(s), 'main menu')
    s = nav_re.sub('<nav aria-label="Main"><a href="#aday">A day</a><a class="nav-call" href="#try">Call Max</a>'
                   '<a href="#clock">What it’s worth</a><a href="/map">Map</a><a href="#pricing">Pricing</a>'
                   '<a href="#more">Questions</a><a class="btn primary small" href="#contact">Free audit</a></nav>', s, count=1)
    # the arrow down to "what we do" goes: the day sits right there
    only_re = re.compile(r'\s*<a class="onlylink" href="#does">.*?</a>', re.S)
    must(only_re.search(s), 'hero link to what we do')
    s = only_re.sub('', s, count=1)
    # the sample report in the hero gives its place to the day (the month comes right after the hero, on the dial)
    rep_re = re.compile(r'<!--ao:report-->.*?<!--/ao:report-->', re.S)
    must(rep_re.search(s), 'hero report markers')
    s = rep_re.sub(DAY_BLOCK, s, count=1)

    # ---- sections in the new order
    hdr_end = s.find('</header>')
    must(hdr_end > 0, 'hero end')
    hdr_end += len('</header>')
    spans = top_sections(s, hdr_end)
    must(len(spans) >= 15, 'sections')
    sec = {}
    for a, b in spans:
        m = re.search(r'\sid="([^"]+)"', s[a:a + 400])
        must(m, 'section id')
        sec[m.group(1)] = s[a:b]
    foot = s.find('<footer', spans[-1][1])
    must(foot > 0, 'footer')
    head_part, tail_part = s[:hdr_end], s[foot:]
    need = ['does', 'go', 'clock', 'tap', 'map-feature', 'try', 'industries', 'day', 'only', 'what', 'audit',
            'yours', 'pricing', 'compare', 'rules', 'regulated', 'faq', 'contact']
    for k in need:
        must(k in sec, 'section #' + k)
    extra = [k for k in sec if k not in need]
    must(not extra, 'new sections ' + ', '.join(extra))

    def opening(html):
        return html[:html.index('>') + 1]

    def retag(k, **attrs):
        html = sec[k]
        tag = opening(html)
        new = tag
        for name, value in attrs.items():
            new = set_attr(new, name.replace('_', '-'), value)
        sec[k] = new + html[len(tag):]

    # what it was worth: the dial already carries the month; it now follows the day
    retag('clock', data_label='What it was worth')
    must('<p class="eyebrow">On the clock</p>' in sec['clock'], 'clock eyebrow')
    sec['clock'] = sec['clock'].replace('<p class="eyebrow">On the clock</p>', '<p class="eyebrow">What it was worth</p>', 1)
    cap = '<p class="clockcap">Mike’s Plumbing, October. A made-up business; the dial is drawn the same way from yours.</p>'
    must(cap in sec['clock'], 'clock caption')
    sec['clock'] = sec['clock'].replace(cap, '<p class="clockcap">An example report. Mike’s Plumbing in October, a made-up '
                                        'business; the dial is drawn the same way from yours.</p>', 1)

    # everything under "Questions and details" opens one topic at a time
    folds = {
        'faq': ('', 'Contracts, the app, what we need to start, and what if it doesn’t bring in business.'),
        'does': ('What we do', 'Everything Always Open runs for you, on one screen.'),
        'go': ('Try each part', 'Real screens. Tap a card and watch it work.'),
        'tap': (None, 'Max taps your shoulder. You answer with your thumb.'),
        'map-feature': ('The map', 'Every member on one map, nearest first. Nobody pays to be on it.'),
        'industries': ('Your business', 'A page for your kind of business.'),
        'compare': ('', 'Software you run, or a team that runs it.'),
        'rules': ('', 'Three rules we don’t bend.'),
        'regulated': ('', 'Insurance agencies and other businesses that can’t share a client list.'),
    }
    for k, (title, line) in folds.items():
        attrs = {'data_fold': line}
        if title:
            attrs['data_fold_title'] = title
        retag(k, **attrs)

    marks = {'clock': ('<!-- clock:start -->\n', '\n<!-- clock:end -->'), 'tap': ('<!-- tap:start -->\n', '\n<!-- tap:end -->'),
             'yours': ('<!-- yours:start -->\n', '\n<!-- yours:end -->')}

    def chunk(k):
        a, b = marks.get(k, ('', ''))
        return a + sec[k] + b

    main_order = ['clock', 'pricing', 'contact']
    more_order = ['faq', 'does', 'go', 'try', 'audit', 'only', 'what', 'tap', 'map-feature', 'yours', 'industries',
                  'compare', 'rules', 'regulated']
    # "One ordinary day" is the day piece now, so it goes
    body = ('\n<main>\n' + '\n\n'.join(chunk(k) for k in main_order) + '\n\n'
            '<div class="qd band" id="more" data-label="Questions and details" data-fold-title="Questions and details" '
            'data-fold="Each part in detail, how we work, and answers to what owners ask first.">\n'
            + '\n\n'.join(chunk(k) for k in more_order) + '\n</div>\n</main>\n\n')
    s = head_part + body + tail_part

    # the draft's own anchors stay on the draft (the live page's "/#contact" would leave it)
    s = s.replace('href="/#', 'href="#')

    # a link into a topic opens "Questions and details" too
    old_open = ("var f = el.closest('[data-fold]'); if (f && !f.classList.contains('ao-open')) setFold(f, true);\n"
                "    return el;")
    must(old_open in s, 'fold opener')
    s = s.replace(old_open, "for (var f = el.closest('[data-fold]'); f; f = f.parentElement && f.parentElement.closest('[data-fold]')) "
                  "if (!f.classList.contains('ao-open')) setFold(f, true);\n    return el;", 1)

    # styles and the frame sizing, before the page's other scripts
    must('</style>\n</head>' in s or '</head>' in s, 'head end')
    s = s.replace('</head>', DAY_CSS + '\n</head>', 1)
    s = s.replace('<!--/ao:es-->', DAY_JS + '\n<!--/ao:es-->', 1)

    # Spanish: the new menu and the new lines
    es_re = re.compile(r'(<script type="application/json" id="ao-es">)(.*?)(</script>)', re.S)
    m = es_re.search(s)
    must(m, 'Spanish words')
    data = json.loads(m.group(2))
    data = [e for e in data if not e['s'].startswith('header.hero nav a:nth-child') and e['s'] != 'header.hero .onlylink']
    data += [{'s': 'header.hero nav a:nth-child(%d)' % (i + 1), 'h': h} for i, h in enumerate(
        ['Un día', 'Llame a Max', 'Lo que vale', 'Mapa', 'Precios', 'Preguntas', 'Auditoría gratis'])]
    data += [
        {'s': '#aday-h', 'h': 'Un día con Always Open'},
        {'s': '#aday .aday-sub', 'h': 'Todo lo que trabaja detrás de su negocio, en un día (la animación está en inglés). <a href="' + DAY + '">Verlo en pantalla completa</a>'},
        {'s': '#clock .head .eyebrow', 'h': 'Lo que valió'},
        {'s': '#more > .ao-foldbar .ao-ft', 'h': 'Preguntas y detalles'},
        {'s': '#more > .ao-foldbar .ao-fs', 'h': 'Cada parte en detalle, cómo trabajamos y respuestas a lo que los dueños preguntan primero.'},
    ]
    s = s[:m.start(2)] + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + s[m.end(2):]

    # the draft lives one folder down, so the page's few relative addresses point at the site's root
    for a, b in [('href="terms.html"', 'href="/terms"'), ('href="privacy.html"', 'href="/privacy"'),
                 ('href=\\"terms.html\\"', 'href=\\"/terms\\"'), ('href=\\"privacy.html\\"', 'href=\\"/privacy\\"'),
                 ("'insurance.html'", "'/insurance'"), ('href=\\"/#', 'href=\\"#')]:
        s = s.replace(a, b)
    left = re.findall(r'(?:src|href|action)=\\?"(?![/#]|https?:|tel:|mailto:|data:|javascript:|\'|\\)[^"\\]*', s)
    must(not left, 'relative addresses left: ' + ', '.join(sorted(set(left))))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(s)
    return s


DAY_BLOCK = '''<div class="aday" id="aday" data-label="A day with Always Open" aria-labelledby="aday-h">
        <h2 class="aday-h" id="aday-h">A day with Always Open</h2>
        <div class="aday-box"><iframe class="aday-f" src="''' + DAY + '''" title="A day with Always Open: a 2:47 AM call, a storm warning, a review, follow-ups, open days filled and the month on one page" loading="lazy"></iframe></div>
        <p class="aday-sub">Everything that runs behind your business, in one day. <a href="''' + DAY + '''">Open it full screen</a></p>
      </div>'''

DAY_CSS = '''<style id="draft-css">
/* A day with Always Open: the day piece sits where the sample report was (beside the headline; under it on a phone). */
.aday{display:grid;justify-items:center;text-align:center;gap:10px;min-width:0}
.aday-h{margin:0;font:400 clamp(1.5rem,2.6vw,2rem)/1.1 "Tilt Neon",var(--display);color:#fff;text-shadow:0 0 2px #fff,0 0 10px var(--night-sign),0 0 22px rgba(255,90,77,.7)}
.aday-sub{margin:2px 0 0;max-width:30em;color:var(--night-mute);font-size:15px;line-height:1.45;text-wrap:balance}
.aday-box{width:100%;display:flex;justify-content:center}
.aday-f{display:block;border:0;border-radius:20px;background:#050608;width:min(100%,420px);height:min(calc(100svh - 24px),830px);
  box-shadow:0 0 0 1.5px rgba(255,106,94,.55),0 0 18px rgba(255,90,77,.32),0 18px 50px rgba(0,0,0,.45)}
.aday-sub a{color:var(--night-ink);text-decoration:none;border-bottom:1.5px solid rgba(255,106,94,.55);white-space:nowrap}
.aday-sub a:hover{border-color:var(--night-sign)}
.aday-sub a:focus-visible,.aday-f:focus-visible{outline:3px solid #FF6A5E;outline-offset:3px}
@media (max-width:760px){.aday{margin-top:30px}}
/* Questions and details: one bar; inside it, one bar per topic */
.js #more.ao-open{padding-left:0!important;padding-right:0!important;padding-bottom:0!important;background:var(--paper)}
.js #more.ao-open>.ao-foldbar{margin-inline:0!important;padding-inline:max(16px,env(safe-area-inset-left,0px))!important}
.js #more>.ao-foldbar .ao-ft{font-size:1.3rem}
#more>section{margin:0}
.js #more [data-fold]:not(.ao-open){padding-top:0!important;padding-bottom:0!important}
.js #more [data-fold].ao-open{padding-top:0!important}
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tilt+Neon&display=swap" media="print" onload="this.media='all'">'''

DAY_JS = '''<script>(function aday() {
  // Size the frame to the day piece: its stage is 1080x1620 scaled to fit, with a 184px panel under it (day.html layout()).
  var f = document.querySelector('.aday-f'); if (!f) return;
  var lastW = -1;
  function size(force) {
    var box = f.parentElement.getBoundingClientRect().width; if (!box) return;
    if (!force && Math.abs(box - lastW) < 2) return; lastW = box;
    var wide = window.matchMedia('(min-width:981px)').matches, vh = window.innerHeight || 800;
    // beside the headline the whole piece fits in the first screen (its Watch button is at the bottom); on a phone, one screen
    var top = f.getBoundingClientRect().top + (window.scrollY || 0);
    var maxH = wide ? Math.max(560, Math.min(830, vh - top - 64)) : Math.min(900, vh - 16);
    var s = Math.max(0.15, Math.min(Math.min(box, 720) / 1080, (maxH - 184) / 1620));
    f.style.width = Math.min(box, Math.max(Math.ceil(1080 * s), 300)) + 'px';
    f.style.height = Math.ceil(1620 * s + 184) + 'px';
  }
  size(true);
  // a phone's toolbar coming and going changes only the height: leave the frame alone then
  window.addEventListener('resize', function () { size(window.matchMedia('(min-width:981px)').matches); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { size(true); }, 250); });
})();</script>'''

if __name__ == '__main__':
    out = build()
    print('wrote', OUT.relative_to(ROOT), len(out), 'bytes')
