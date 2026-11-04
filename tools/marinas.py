#!/usr/bin/env python3
"""Builds public/marinas.html from public/marine.html: the same page, rewritten for marinas (slips, rentals, the fuel
dock, storage and the service bay). Run from the repo root after the marine page changes: python3 tools/marinas.py
Every business here is made up; captions call them examples. The marine page itself stays for dock builders and boat
repair, and the two hand callers to each other."""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
s = (ROOT / 'public' / 'marine.html').read_text()


def rep(old, new, count=1):
    global s
    if old not in s:
        sys.exit('missing: ' + old[:90])
    s = s.replace(old, new, count if count else -1)


# ---- who it's for, and the page's own address
rep('<title>Docks and marine · Always Open</title>', '<title>Marinas · Always Open</title>')
rep('href="https://alwaysopenoffice.com/marine"', 'href="https://alwaysopenoffice.com/marinas"')
META = ('Always Open runs the back side of a marina: every call answered, every review replied to, slip renewals and '
        'service quotes followed up on the day you pick, and open rental days filled from your own customers. You approve it all from your phone.')
s = re.sub(r'(<meta (?:name|property)="(?:og:)?description" content=")[^"]*(">)', lambda m: m.group(1) + META + m.group(2), s)
rep('?from=marine#', '?from=marinas#', 0)
rep('&amp;from=marine"', '&amp;from=marinas"', 0)
rep('This page covers what matters most to dock builders and boat repair shops. Run a marina? <a href="/marinas">See the marinas page</a>.', 'This page covers what matters most to marinas. Build docks or fix boats? <a href="marine.html">See the page for docks and boat repair</a>.')
rep('<p class="for">For dock builders, boat repair shops and marinas</p>', '<p class="for">For marinas: slips, rentals, fuel and service</p>')
rep('<h1>Out on the water all weekend. The calls, the reviews, the quotes back at the dock? Handled.</h1>',
    '<h1>Slips, rentals, the fuel dock and the service bay. The phone that rings all weekend? Handled.</h1>')
s = re.sub(r'<p class="lede">.*?</p>', lambda m: '<p class="lede">We run the back side of a marina while your crew is on the docks: every call answered, every review replied to, slip renewals and service quotes followed up, and open rental days filled from your own customer list. On the phone, Max answers in your marina’s name, gives your hours, fuel-dock times and the rental prices you set, takes the boat and what they need, and alerts you right away if it can’t wait. Every rental, slip and service job turns into a review request and a post. You approve it all from your phone. <b>One page shows what it did and what it was worth, live in your app all month and sent to you on the 2nd.</b></p>', s, count=1, flags=re.S)
rep('<p class="lede-ph">Calls answered, reviews replied to, quotes followed up and slow weeks filled, while you’re out on the water.</p>',
    '<p class="lede-ph">Calls answered, reviews replied to, renewals followed up and rental days filled, while your crew is on the docks.</p>')
rep('<a href="#quotes">Quotes</a>', '<a href="#quotes">Renewals</a>')

# ---- the example report in the hero
a = s.index('<!--ao:report-->'); b = s.index('<!--/ao:report-->')
r = s[a:b]
for old, new in [
    ('Kessler Marine', 'Harbor Point Marina'),
    ('what it was worth about $24,800; 17 calls answered (7 on the weekend); 4 jobs booked (1 lift repair the same day); 3 reviews replied to (Rating 4.5 to 4.7); 3 quotes followed up (1 new dock said yes)',
     'what it was worth about $18,600; 41 calls answered (19 on the weekend); 12 rentals booked (3 the same day); 6 reviews replied to (Rating 4.4 to 4.6); 5 slip renewals followed up (4 renewed)'),
    ('<b>about $24,800</b><small>in quotes that said yes</small>', '<b>about $18,600</b><small>in rentals, slips and service</small>'),
    ('<b>17</b><span>calls answered<small>7 on the weekend</small>', '<b>41</b><span>calls answered<small>19 on the weekend</small>'),
    ('<b>4</b><span>jobs booked</span><small>1 lift repair the same day</small>', '<b>12</b><span>rentals booked</span><small>3 the same day</small>'),
    ('<b>3</b><span>reviews replied to</span><small>Rating 4.5 to 4.7</small>', '<b>6</b><span>reviews replied to</span><small>Rating 4.4 to 4.6</small>'),
    ('<b>3</b><span>quotes followed up</span><small>1 new dock said yes</small>', '<b>5</b><span>slip renewals followed up</span><small>4 renewed</small>'),
    ('customers said the job held up on the three-day check-in', 'customers said the service held up on the three-day check-in'),
]:
    if old not in r:
        sys.exit('missing in report: ' + old[:80])
    r = r.replace(old, new)
s = s[:a] + r + s[b:]

# ---- the marina is Harbor Point; Kessler Marine is now the dock builder it hands callers to
rep('Kessler Marine', 'Harbor Point Marina', 0)
rep('Oconee Shoreline', 'Kessler Marine', 0)
rep('Do y’all do seawalls? Mine’s washing out.', 'Do y’all build docks? Ours is falling apart.', 0)
rep('We don’t do seawalls, but Kessler Marine, two miles from here, is on Always Open too.', 'We don’t build docks, but Kessler Marine, two miles from here, is on Always Open too.', 0)
rep('A dock repair on the north end. They sent the caller to you.', 'A boater looking for a slip for the season. They sent the caller to you.')
rep('Seawall washing out', 'Slip for next season', 0)
rep('Sam’s out on the water.', 'Sam’s on the fuel dock.', 0)

# ---- Tap to try it
rep('Thursday is wide open on Sam’s calendar', 'Thursday is wide open in the service bay')
rep('your lift is due for its spring service', 'your boat is due for its spring service')
rep('did the lift repair hold up?', 'did the engine service hold up?', 0)
rep('the lift is sticking again', 'the engine is running rough again')
rep('three days after a lift repair job', 'three days after an engine service', 0)
rep('Our boat lift jammed with the boat on it.', 'Looking at renting a pontoon this weekend.')
rep('Can someone come this weekend?', 'Do you have one for Saturday? There are eight of us.')
rep('Sam’s crew can be there at 8 tomorrow. The service call is $125. Want that time?', 'A 24-foot pontoon is open Saturday at 9. A full day is $375, plus fuel. Want it?')
rep('Yes, 8 is great.', 'Yes, book it.')
rep('The Kellers · lift jammed', 'The Kellers · pontoon rental', 0)
rep('Tomorrow 8:00 AM · boat on the lift', 'Saturday 9:00 AM · 24 ft pontoon, 8 people')
# the call comes in on a weekday, so the Saturday rental Max offers is still ahead
rep('Sat 5:48 PM · call to Harbor Point Marina', 'Thu 5:48 PM · call to Harbor Point Marina', 0)
rep('Boat stuck on the lift. Wants a person.', 'Asking about a Saturday rental. Wants a person.')
rep('If your dock or lift takes a hit tonight, call us.', 'Boats in our slips: we’re checking lines and fenders tonight. Questions? Call us.', 0)
rep('Who fixes boat lifts on Lake Oconee?', 'Where can I rent a pontoon on Lake Oconee?')
rep('What nobody else does for dock builders and marinas.', 'What nobody else does for marinas.')

# ---- calls
rep('<h2>Every call answered, even when you’re out on the water.</h2>', '<h2>Every call answered, even when the whole crew is on the docks.</h2>')
rep('takes the boat, the dock and what’s wrong,', 'takes the boat and what they need: a slip, a rental, fuel or service,')
rep('Urgent calls, like a lift stuck with a boat on it, can ring through to your cell', 'Urgent calls, like a boat taking on water in its slip, can ring through to your cell')
rep('Books the site visit on your Google calendar', 'Books rentals and service appointments on your Google calendar')
rep('Lift stuck · Greg Hollis', 'Taking on water · slip B14')
rep('Dock and lift · the Wards', 'Season slip · the Wards')
rep('Spring launch · J. Ortiz', 'Pontoon rental · J. Ortiz')

# ---- renewals and service quotes
rep('<h2>Dock quotes don’t go quiet.</h2>', '<h2>Slip renewals and service quotes don’t go quiet.</h2>')
rep('Most dock quotes aren’t turned down. They wait for the next weekend at the lake, then the one after. Add the quote in the app and pick a day.',
    'Most slip renewals and service quotes aren’t turned down. They wait for the next weekend at the lake, then the one after. Add it in the app and pick a day.')
rep('$22,400', '$3,200', 0)
rep('Floating dock and a 10,000 lb lift', 'Covered slip, April through October')
rep('Checking in on the quote for the new dock and lift.', 'Checking in on the covered slip for next season.', 0)

# ---- finished work
rep('Greg · 706-555-0148 · Lift repair', 'Greg · 706-555-0148 · Winterizing')
rep('A jammed lift back in service by noon on a holiday weekend. If yours groans on the way up, have it looked at before the season gets busy. Give us a call.',
    'Fourteen boats winterized this week and tucked in for the season. A few spots are still open for November, so call us before the first hard freeze.')

# ---- the rest of the page
rep('Three things nobody else does for dock builders and marinas.', 'Three things nobody else does for marinas.')
rep('the jobs dock builders and marinas kept losing the same way', 'the calls and customers marinas kept losing the same way')
rep('<h2>Plans for docks and marine</h2>', '<h2>Plans for marinas</h2>')
rep('A caller needs a boat mechanic, not you?', 'A caller needs a dock builder, not you?')
rep('Spring launch, winterizing and past-customer reminders', 'Spring launch, winterizing, slip renewal and past-customer reminders')
rep('Need crews? Help-wanted posts', 'Hiring dock hands for the season? Help-wanted posts')
rep('What marine owners ask first', 'What marina owners ask first')
rep('your rating next to the marine businesses you compete with', 'your rating next to the marinas you compete with', 0) if 'your rating next to the marine businesses you compete with' in s else None
rep('href="/marine"', 'href="/marinas"', 0) if 'href="/marine"' in s else None

# ---- Spanish, for the parts that changed and have a Spanish swap
m = re.search(r'(<script type="application/json" id="ao-es">)(.*?)(</script>)', s, re.S)
es = json.loads(m.group(2))
ES = {
    'header.hero .everyone': 'Always Open trabaja para todo tipo de negocio, en cualquier parte de EE. UU. Esta página cubre lo que más les importa a las marinas. <a href="index.html">Vea todo lo que hacemos</a>',
    'header.hero p.for': 'Para marinas: amarres, alquileres, combustible y servicio',
    'header.hero h1': 'Amarres, alquileres, el muelle de combustible y el taller. ¿El teléfono que suena todo el fin de semana? Atendido.',
    'header.hero .lede': 'Llevamos la parte de atrás de una marina mientras su equipo está en los muelles: cada llamada contestada, cada reseña respondida, renovaciones de amarres y cotizaciones de servicio con seguimiento, y días de alquiler vacíos llenados con su propia lista de clientes. Al teléfono, Max contesta con el nombre de su marina, da su horario, el horario del muelle de combustible y los precios de alquiler que usted fija, toma los datos del bote y de lo que necesitan, y le avisa al instante si no puede esperar. Cada alquiler, amarre y servicio se convierte en una solicitud de reseña y una publicación. Usted lo aprueba todo desde su teléfono. <b>Una página le muestra lo que se hizo y cuánto valió, al día en su app todo el mes y enviada a usted el día 2.</b>',
    '#aos-h': 'Lo que nadie más hace para las marinas. Toque y pruébelo.',
    'header.hero nav a:nth-child(3)': 'Renovaciones',
    'header.hero .lede-ph': 'Llamadas contestadas, reseñas respondidas, renovaciones con seguimiento y días de alquiler llenos, mientras su equipo está en los muelles.',
}
seen = set()
for e in es:
    if e['s'] in ES:
        e.pop('t', None); e.pop('p', None); e['h'] = ES[e['s']]; seen.add(e['s'])
missing = set(ES) - seen
if missing:
    sys.exit('no Spanish swap for: ' + ', '.join(sorted(missing)))
for e in es:   # anything else in Spanish that still names the dock builders
    v = e.get('h') or e.get('t') or e.get('p') or ''
    if re.search(r'constructores de muelles|talleres de botes', v):
        sys.exit('Spanish still says dock builders at ' + e['s'])
s = s[:m.start()] + m.group(1) + json.dumps(es, ensure_ascii=False) + m.group(3) + s[m.end():]

left = [w for w in ('dock builders', 'boat repair shops', 'lift repair', 'Lift repair', 'Docks and marine', 'docks and marine') if w in re.sub(r'<script.*?</script>', '', s, flags=re.S)]
if left:
    sys.exit('still on the page: ' + ', '.join(left))
(ROOT / 'public' / 'marinas.html').write_text(s)
print('wrote public/marinas.html')
