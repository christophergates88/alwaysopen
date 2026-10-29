#!/usr/bin/env python3
"""Builds the industry pages (hvac, plumbing, dental, auto-repair, marine, salons, restaurants) from builders.html.
Run from the repo root: python3 tools/industry.py. Every sample number stays labeled Sample."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / 'public' / 'builders.html').read_text()

def rep(s, old, new, count=1):
    if old not in s:
        sys.exit('missing: ' + old[:80])
    return s.replace(old, new, count)

def build(key, d):
    s = SRC
    s = rep(s, '<title>Builders and remodelers · Always Open</title><link rel="canonical" href="https://alwaysopenoffice.com/builders">',
            '<title>' + d['title'] + ' · Always Open</title><link rel="canonical" href="https://alwaysopenoffice.com/' + key + '">')
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="' + d['meta'] + '">', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="' + d['meta'] + '">', s, count=1)
    s = rep(s, 'This page covers what matters most to builders and remodelers.', 'This page covers what matters most to ' + d['who'] + '.')
    s = rep(s, '<p class="for">For builders, remodelers and contractors</p>', '<p class="for">For ' + d['who'] + '</p>')
    s = rep(s, '<h1>The next job, a new review and a quiet estimate, handled while you build this one.</h1>', '<h1>' + d['h1'] + '</h1>')
    s = re.sub(r'<p class="lede">.*?</p>', '<p class="lede">' + d['lede'] + '</p>', s, count=1, flags=re.S)
    # the day band: three cards
    s = re.sub(r'<div class="day" role="img" aria-label="[^"]*">', '<div class="day" role="img" aria-label="' + d['day_aria'] + '">', s, count=1)
    s = re.sub(r'<div class="ev"><time>10:42 AM</time>.*?<p class="sample">Sample: made-up builder and customers.</p>', d['day_cards'] + '\n        <p class="sample">Sample: made-up business and customers.</p>', s, count=1, flags=re.S)
    # calls
    s = rep(s, '<h2>Every call answered, even when you’re on a roof.</h2>', '<h2>' + d['calls_h2'] + '</h2>')
    s = rep(s, 'takes the details for an estimate, and sends it all to your phone in seconds', 'takes ' + d['takes'] + ', and sends it all to your phone in seconds')
    s = rep(s, '<span>Urgent calls, like a leak, can ring through to your cell</span>', '<span>Urgent calls, like ' + d['urgent'] + ', can ring through to your cell</span>')
    s = rep(s, '<span>Books the site visit on your Google calendar, set up with you (on request)</span>', '<span>Books ' + d['books'] + ' on your Google calendar, set up with you (on request)</span>')
    if d.get('regulated'):
        s = rep(s, '<span>Shares only the prices you give him, and never makes one up</span>', '<span>Never discusses fees, treatment or what insurance covers. He takes a message, and Compliance Guard checks every word we write for you</span>')
    s = re.sub(r'<div class="stage"><div class="mock" role="img" aria-label="Sample lead log[^"]*">', '<div class="stage"><div class="mock" role="img" aria-label="' + d['log_aria'] + '">', s, count=1)
    s = rep(s, '<div class="mh"><b>This week · Sample Builders</b><small>4 leads</small></div>', '<div class="mh"><b>This week · ' + d['biz'] + '</b><small>4 leads</small></div>')
    s = re.sub(r'<div class="lr"><i class="r"></i>.*?</div>\n        </div>', d['log_rows'] + '\n        </div>', s, count=1, flags=re.S)
    # quotes / follow-ups
    s = rep(s, '<h2>Quotes don’t go quiet.</h2>', '<h2>' + d['q_h2'] + '</h2>')
    s = re.sub(r'<p class="lead">Most quotes aren’t turned down\..*?</p>', '<p class="lead">' + d['q_lead'] + '</p>', s, count=1, flags=re.S)
    s = re.sub(r'<div class="stage"><div class="mock" role="img" aria-label="Sample follow-up[^"]*">', '<div class="stage"><div class="mock" role="img" aria-label="' + d['q_aria'] + '">', s, count=1)
    s = re.sub(r'<div class="fu">.*?<small>Sent from your phone, or by us for you</small></div>', d['q_mock'], s, count=1, flags=re.S)
    # finished jobs
    s = rep(s, '<h2>Finished jobs turn into reviews and posts.</h2>', '<h2>' + d['f_h2'] + '</h2>')
    s = re.sub(r'<div class="ask"><b>Finished a job</b>.*?</div></div>\n    </div>\n  </div>\n</section>', d['f_mock'] + '</div></div>\n    </div>\n  </div>\n</section>', s, count=1, flags=re.S)
    if d.get('regulated'):
        # Regulated practices never hand us patient details: no review requests, follow-ups, texting or photos from the app.
        s = rep(s, 'When a job wraps up, tap Finished a job. The review request is written, and one tap sends it from your phone to a customer who agreed. Send us a photo, and it comes back as a Google post written for you, ready for your OK.',
                'When a review comes in, the reply is drafted from wording you approved once, checked by Compliance Guard, and waits for your OK. It never confirms that someone is a patient, and it never mentions a visit or treatment.')
        s = rep(s, 'aria-label="Sample: a finished-job request for a customer who agreed to one text, and a job photo of a new deck turned into a post waiting for approval."', 'aria-label="Sample: a five-star review and the reply drafted for it, checked by Compliance Guard and waiting for approval."')
    # only here: three Pro scenes, reworded for the trade; regulated practices get none of them (all three are Pro)
    if d.get('regulated'):
        s = re.sub(r'<section class="sec band alt only" id="only".*?</section>\n\n', '', s, count=1, flags=re.S)
        s = rep(s, '<a href="#only">Only here</a>', '')
    else:
        o = d.get('only', {})
        s = rep(s, 'Three things nobody else does for builders.', 'Three things nobody else does for ' + o.get('who', d['who']) + '.')
        s = rep(s, 'These are the parts built for the jobs builders kept losing the same way.', 'These are the parts built for the jobs ' + o.get('who', d['who']) + ' kept losing the same way.')
        s = s.replace('Do y’all do electrical? My panel keeps tripping.', o.get('ask', 'Do y’all do electrical? My panel keeps tripping.'))
        s = s.replace('We don’t do electrical, but Lane Electric, two miles from here, is on Always Open too.', o.get('answer', 'We don’t do electrical, but Lane Electric, two miles from here, is on Always Open too.'))
        s = s.replace('Put through to Lane Electric', 'Put through to ' + o.get('to', 'Lane Electric'))
        s = s.replace('does not do electrical and puts them through to Lane Electric', 'does not do ' + o.get('trade', 'electrical') + ' and puts them through to ' + o.get('to', 'Lane Electric'))
        s = s.replace('did the deck hold up?', 'did the ' + o.get('job', 'deck') + ' hold up?')
        s = s.replace('three days after a deck job', 'three days after a ' + o.get('job', 'deck') + ' job')
        s = s.replace('Sam’s on a job in Greensboro. He’ll call you at 4:15.', o.get('busy', 'Sam’s on a job in Greensboro.') + ' ' + o.get('will', 'He’ll call you at 4:15.'))
        s = s.replace('Panel tripping · 478-555-0142', o.get('cb', 'Panel tripping') + ' · 478-555-0142')
    # the math
    s = rep(s, '<h2>One job can cover the whole year.</h2>', '<h2>' + d['m_h2'] + '</h2>')
    s = rep(s, 'Your jobs are big, so the math is short. Put in your own numbers.', d['m_lead'])
    s = rep(s, '<label for="m-job">A typical job, start to finish', '<label for="m-job">' + d['m_label'])
    s = rep(s, 'value="25000" size="8"', 'value="' + str(d['m_job']) + '" size="8"')
    s = rep(s, 'value="20" size="4"', 'value="' + str(d['m_margin']) + '" size="4"')
    s = rep(s, '<p>One job like that leaves you</p>', '<p>' + d['m_one'] + '</p>')
    keep = int(d['m_job'] * d['m_margin'] / 100)
    s = rep(s, '<strong id="m-keep">$5,000</strong>', '<strong id="m-keep">$' + format(keep, ',') + '</strong>')
    mo = lambda n: str(n) + (' month' if n == 1 else ' months')
    g, p = keep // 299, keep // 499
    cover = 'That’s most of a month of Growth.' if g < 1 else 'That covers <b>' + mo(g) + '</b> of Growth' + (', or <b>' + mo(p) + '</b> of Pro.' if p >= 1 else '.')
    s = rep(s, 'That covers <b>16 months</b> of Growth, or <b>10 months</b> of Pro.', cover)
    s = s.replace('a job photo of a new deck turned into a post', d.get('photo_of', 'a job photo') + ' turned into a post')   # regulated pages rewrote it already
    # plans and questions
    s = rep(s, '<h2>Plans for builders</h2>', '<h2>Plans for ' + d['plans_for'] + '</h2>')
    s = rep(s, '<h2>What builders ask first</h2>', '<h2>What ' + d['ask_who'] + ' ask first</h2>')
    if d.get('regulated'):
        s = re.sub(r'<details><summary>What does Max say when someone asks what a job costs\?</summary><p>.*?</p></details>',
                   '<details><summary>What does Max say when someone asks about fees, treatment or insurance?</summary><p>He does not get into any of it. He takes a message with the caller’s name, number and what they need, and lets them know the office will call. Compliance Guard checks every reply and post we write for you, and nothing goes out without your OK.</p></details>', s, count=1, flags=re.S)
    s = rep(s, 'your rating next to the builders you compete with', 'your rating next to the ' + d['rivals'] + ' you compete with')
    if d.get('regulated'):
        s = re.sub(r'\s*<li><svg aria-hidden="true"><use href="#chk"/></svg><span>Call-backs with a time on them[^<]*</span></li>', '', s)
        s = re.sub(r'\s*<li><svg aria-hidden="true"><use href="#chk"/></svg><span>A caller needs the electrician[^<]*</span></li>', '', s)
    for e in d.get('extra', []):
        s = rep(s, e[0], e[1], e[2] if len(e) > 2 else 1)
    if d.get('regulated'):
        s = re.sub(r'\s*<li><svg aria-hidden="true"><use href="#chk"/></svg><span>On Pro, a missed call also gets a text back[^<]*</span></li>', '', s)
        s = re.sub(r'\s*<li><svg aria-hidden="true"><use href="#chk"/></svg><span>Why callers who didn’t book walked[^<]*</span></li>', '', s)
        s = re.sub(r'\s*<div class="plan">\s*<h3>Pro</h3>.*?<a class="btn line" href="index.html#contact">Choose Pro</a>\s*</div>', '', s, count=1, flags=re.S)
        s = re.sub(r'(<p id="m-cover">That covers <b>\d+ months?</b> of Growth), or <b>\d+ months?</b> of Pro\.', r'\1.', s, count=1)
        s = rep(s, "(p >= 1 ? ', or <b>' + months(p) + '</b> of Pro.' : '.')", "'.'")
        s = rep(s, '<small>Growth is $299 a month and Pro is $499 a month. Max comes with both, with 300 minutes a month.</small>', '<small>Growth is $299 a month, and Max comes with it, with 300 minutes a month.</small>')
        s = rep(s, '<h3>Every customer gets asked</h3><p>Not just the ones who seem happy. It’s the fair way, and it’s what Google’s rules require. Nobody gets offered anything for a review.</p>',
                '<h3>Replies that protect privacy</h3><p>Every reply comes from wording you approved, and never confirms that someone is a patient. Nobody is ever offered anything for a review.</p>')
        s = re.sub(r'<details><summary>Do you text my customers\?</summary><p>.*?</p></details>',
                   '<details><summary>Do you text my patients?</summary><p>No. Max takes messages, and you call or text patients back from your own phone. We never text for a practice and never handle patient records.</p></details>', s, count=1, flags=re.S)
        s = rep(s, 'Your hours, service area and the best number for urgent calls. And a sample reply approved so we sound like you.', 'Your hours, the best number for urgent calls, and your reply wording approved once.')
        # regulated businesses never hand us customer data, so nothing is texted for them by us
        s = s.replace('<small>Sent from your phone, or by us for you</small>', '<small>Sent from your phone</small>')
        s = s.replace(' If they said yes to texts, we send it for you from your business number.', '')
    # nav wording
    s = rep(s, '<a href="#quotes">Quotes</a>', '<a href="#quotes">' + d['nav_q'] + '</a>')
    s = rep(s, '<a href="#finished">Finished jobs</a>', '<a href="#finished">' + d['nav_f'] + '</a>')
    bad = re.findall(r'\b(AI|local|Chris)\b', re.sub(r'<script.*?</script>', '', s, flags=re.S))
    bad = [b for b in bad if b != 'AI' or True]
    if bad:
        # AI is allowed nowhere on these pages; the hero headline with it lives on the home page only
        print(key, 'contains', sorted(set(bad)), file=sys.stderr)
    (ROOT / 'public' / (key + '.html')).write_text(s)
    print('wrote public/' + key + '.html')

def card(time, kind, tag, title, body, acts, hot=False, due=False):
    k = '<div class="k">' + kind + (' <em' + (' class="due"' if due else '') + '>' + tag + '</em>' if tag else '') + '</div>'
    return '<div class="ev"><time>' + time + '</time><div class="card' + (' hot' if hot else '') + '">' + k + '<b class="t">' + title + '</b>' + body + '<div class="acts">' + ''.join(('<span class="alt">' if i else '<span>') + a + '</span>' for i, a in enumerate(acts)) + '</div></div></div>'

def row(cls, title, sub, pill, label):
    return '          <div class="lr"><i' + (' class="' + cls + '"' if cls else '') + '></i><div><b>' + title + '</b><span>' + sub + '</span></div><span class="pill ' + pill + '">' + label + '</span></div>'

def fu(kind, tag, name, amt, note, acts, bub):
    return ('<div class="fu">\n          <div class="h"><span class="pill red">' + kind + '</span><span>' + tag + '</span></div>\n          <div class="n"><b>' + name + '</b><span>' + amt + '</span></div>\n          <small>' + note + '</small>\n          <div class="acts"><span>' + acts[0] + '</span><span class="alt">' + acts[1] + '</span></div>\n        </div>\n        <div class="sms"><div class="bub">' + bub + '</div><small>Sent from your phone</small></div>')

PAGES = {
 'hvac': dict(
  only=dict(who='heating and air companies', ask='Do y’all do electrical? My breaker keeps tripping.', answer='We don’t do electrical, but Lane Electric, two miles from here, is on Always Open too.', job='new system', busy='Sam’s on a call in Greensboro.', cb='Breaker tripping'),
  title='HVAC companies', who='heating and air companies', biz='Sample Heating and Air', rivals='HVAC companies', plans_for='heating and air', ask_who='HVAC owners',
  meta='Always Open runs the back side of an HVAC company: every call answered, every review replied to, maintenance and estimate follow-ups on the day you pick, and slow days filled from your own customers. You approve it all from your phone.',
  h1='July, 98 degrees, and you’re up in an attic. The calls, the reviews, the quotes? We’ve got them.',
  lede='We run the back side of a heating and air company while you’re on the job: every call answered, every review replied to, quotes followed up, and open days filled from your own customer list. On the phone, Max answers in your company’s name, tells callers your hours and service area, takes the address and what the system is doing, and tries your phone if it’s an emergency. Estimates get a follow-up on the day you pick, and every finished job turns into a review request and a post. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on an HVAC owner\'s phone during one summer day. At 6:04 PM Max took a call from Dana Reyes whose AC stopped cooling. At 1:15 PM a follow-up on a $7,900 system estimate is due, with the text already written. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('6:04 PM', 'Max took a call', 'Urgent', 'Dana Reyes', '<p>AC stopped cooling about an hour ago, house is at 84. Two kids and a dog. Asked if anyone can come tonight.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'The Parkers · $7,900 system', '<div class="bub">Hi Lynn, this is Sam with Sample Heating and Air. Checking in on the estimate for the new system. Any questions I can answer?</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★★★★ from the Reyes family', '<p>“Came out the same night and had us cool by nine. Explained everything.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even when you’re in an attic.', takes='the address, the system and what it’s doing', urgent='no cooling in July or no heat in January', books='the service call',
  log_aria='Sample lead log for a made-up HVAC company: a no-cooling call taken by Max, a system estimate followed up, a booked maintenance visit, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'No cooling · Dana Reyes', 'Max took the call, 6:04 PM Tue', 'red', 'New'), row('w', 'System estimate · the Parkers', 'Follow-up due today', 'warn', 'Due'), row('', 'Fall tune-up · J. Ortiz', 'Thursday, 8:00 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Estimates', nav_f='Finished jobs', q_h2='Estimates don’t go quiet.', q_lead='Most system estimates aren’t turned down. They’re forgotten while the window unit limps along. Add the estimate in the app and pick a day. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: an estimate for the Parkers, $7,900, due today, with a drafted text ready to send.',
  q_mock=fu('Estimate', 'Due today', 'The Parkers', '$7,900', '3-ton system, replace furnace and coil', ['Text them', 'Call'], 'Hi Lynn, this is Sam with Sample Heating and Air. Checking in on the estimate for the new system. Any questions I can answer?'),
  f_h2='Finished jobs turn into reviews and posts.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Dana · 706-555-0148 · AC repair</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>She agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">A new system in before the first real heat wave. If yours is limping, a tune-up now beats a breakdown in July. Give us a call.</p></div>',
  m_h2='One system can cover the whole year.', m_lead='A replacement is a big ticket, so the math is short. Put in your own numbers.', m_label='A typical system replacement', m_job=8500, m_margin=30, m_one='One replacement like that leaves you',
 ),
 'plumbing': dict(
  only=dict(who='plumbers', ask='Do y’all do electrical? My water heater keeps tripping the breaker.', answer='We don’t do electrical, but Lane Electric, two miles from here, is on Always Open too.', job='water heater', busy='Sam’s under a house in Greensboro.', cb='Breaker tripping'),
  title='Plumbers', who='plumbers and drain companies', biz='Sample Plumbing', rivals='plumbers', plans_for='plumbers', ask_who='plumbers',
  meta='Always Open runs the back side of a plumbing company: every call answered, every review replied to, estimates followed up on the day you pick, and slow days filled from your own customers. You approve it all from your phone.',
  h1='You’re under a sink. A new call, a new review, a quote gone quiet. We’ve got all three.',
  lede='We run the back side of a plumbing company while you’re on the job: every call answered, every review replied to, quotes followed up, and open days filled from your own customer list. On the phone, Max answers in your company’s name, tells callers your hours and service area, takes the address and what’s going on, and tries your phone if it’s an emergency. Estimates get a follow-up on the day you pick, and every finished job turns into a review request and a post. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a plumber\'s phone during one day. At 11:12 PM Max took a call from Marcus Hill about a burst water heater. At 1:15 PM a follow-up on a $4,200 repipe estimate is due, with the text already written. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('11:12 PM', 'Max took a call', 'Urgent', 'Marcus Hill', '<p>Water heater let go, water in the garage, main is shut off. Asked how early someone can come.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'The Nguyens · $4,200 repipe', '<div class="bub">Hi Anh, this is Sam with Sample Plumbing. Checking in on the estimate for the repipe. Any questions I can answer?</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★★★★ from Marcus H.', '<p>“Here first thing Monday, new heater in by noon, and he cleaned up after himself.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even when you’re under a sink.', takes='the address and what’s going on', urgent='a burst pipe or a sewer backup', books='the service call',
  log_aria='Sample lead log for a made-up plumber: a burst water heater call taken by Max, a repipe estimate followed up, a booked drain cleaning, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'Water heater · Marcus Hill', 'Max took the call, 11:12 PM Sun', 'red', 'New'), row('w', 'Repipe estimate · the Nguyens', 'Follow-up due today', 'warn', 'Due'), row('', 'Drain cleaning · J. Ortiz', 'Thursday, 8:00 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Estimates', nav_f='Finished jobs', q_h2='Estimates don’t go quiet.', q_lead='Most estimates aren’t turned down. They’re forgotten. Add the estimate in the app and pick a day. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: an estimate for the Nguyens, $4,200, due today, with a drafted text ready to send.',
  q_mock=fu('Estimate', 'Due today', 'The Nguyens', '$4,200', 'Repipe, two baths and kitchen', ['Text them', 'Call'], 'Hi Anh, this is Sam with Sample Plumbing. Checking in on the estimate for the repipe. Any questions I can answer?'),
  f_h2='Finished jobs turn into reviews and posts.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Marcus · 706-555-0148 · Water heater</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>He agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">A new water heater in before the old one picked its moment. If yours is past ten years, it is worth a look. Give us a call.</p></div>',
  m_h2='One repipe can cover the whole year.', m_lead='Emergency calls add up, and the big jobs are big. Put in your own numbers.', m_label='A typical larger job', m_job=4200, m_margin=35, m_one='One job like that leaves you',
 ),
 'dental': dict(
  regulated=True,
  title='Dental practices', who='dental practices', biz='Sample Family Dental', rivals='practices', plans_for='dental practices', ask_who='practice owners',
  meta='Always Open runs the back side of a dental practice: calls the front desk misses answered with no treatment details, every review replied to with Compliance Guard checking each word, and appointments confirmed. You approve it all from your phone.',
  h1='7:50 AM. A cracked tooth is calling, a review needs a reply, Tuesday isn’t confirmed. Handled.',
  lede='We run the back side of a dental practice while you’re with a patient: every call answered, every review replied to, and appointments confirmed. On the phone, Max answers in your practice’s name, gives your hours and location, and takes a message with the caller’s name, number and what they need, nothing more. He never discusses fees, treatment or insurance. Every review gets a careful reply that Compliance Guard checks before you see it. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a practice owner\'s phone during one day. At 7:50 AM Max took a call from a caller with a cracked tooth who wants the first opening. At 1:15 PM a message from a patient who wants to move a Thursday visit. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('7:50 AM', 'Max took a call', 'First opening', 'A caller with a cracked tooth', '<p>Asked for the first opening today. Left a name and number. No other details taken.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Message', 'Taken by Max', 'Thursday 9:00 AM visit', '<p>Wants to move it to next week. Left a name and number, nothing else.</p>', ['Call back', 'Text'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', 'Guard: passed', '★★★★★ from a patient', '<p>“Gentle, on time, and they explained each step before doing it.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even when the front desk is with a patient.', takes='a message with the caller’s name, number and what they need, nothing more', urgent='a knocked-out tooth', books='the visit',
  log_aria='Sample call log for a made-up dental practice: a cracked-tooth call, a patient moving a visit, a new-patient question, and a hang-up to call back. No patient details.',
  log_rows='\n'.join([row('r', 'Cracked tooth · first opening', 'Max took the call, 7:50 AM Mon', 'red', 'New'), row('w', 'Wants to move · Thursday visit', 'Max took the message, 9:40 PM', 'warn', 'Call back'), row('', 'New patient · asking about cleanings', 'Max took the message, 6:15 PM', 'ok', 'New'), row('', 'Missed call · 706-555-0177', 'Hung up before leaving a message', 'warn', 'Call back')]),
  nav_q='After hours', nav_f='Reviews', q_h2='After-hours calls about visits reach you, not voicemail.', q_lead='Patients who call after hours to confirm, move or cancel reach Max. He takes the name, number and what they need, nothing more, and it is on your phone in seconds. Your own reminder system keeps sending reminders; we never see patient records.',
  q_aria='Sample message in the Always Open app: a patient who called after hours to move a Thursday 9:00 AM visit, with a call-back text ready to send from your phone. No treatment details.',
  q_mock=fu('Message', 'Taken by Max', 'Thursday 9:00 AM visit', '', 'Wants to move it to next week', ['Call back', 'Text'], 'Hi, this is Sample Family Dental returning your call about Thursday. We can see you Tuesday at 10 or Wednesday at 2. Which works?'),
  f_h2='Every review gets a careful reply.',
  f_mock='<div class="ask"><b>New review</b><span>★★★★★ · “Gentle, on time, and they explained each step.”</span></div>\n        <div><small>Reply · Guard: passed · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">Thank you for the kind words. We are glad to hear it, and we look forward to seeing you next time.</p></div>',
  m_h2='One new patient a month can cover it.', m_lead='A practice is built on patients who stay. Put in your own numbers.', m_label='What a new patient is worth to you in a year', m_job=1200, m_margin=40, m_one='One new patient like that leaves you',
  extra=[
         # What we do: Max only takes the message, and only what dental plans include
         ('<li><b>Full Max</b><span>: if you want the routine to go out on its own</span></li>', ''),
         ('<ul><li><b>Max answers, day and night</b><span>: in your name, from the facts you approve, and rings you if it’s urgent</span></li><li><b>Call-backs on time</b><span>: a set time from your calendar, not “someone will call you”</span></li><li><b>English and Spanish</b><span>: on every plan, with no add-on</span></li></ul>', '<ul><li><b>Max takes the message</b><span>: name, number and what they need; never fees, treatment or insurance</span></li><li><b>Every message on your phone</b><span>: in seconds, with the caller’s number</span></li><li><b>English and Spanish</b><span>: on every plan, with no add-on</span></li></ul>'),
         ('<article class="pillar"><h3>Follow-ups that don’t go quiet</h3><ul><li><b>Quotes and invoices</b><span>: followed up on the day you pick</span></li><li><b>Three-day check-in</b><span>: after every job; a no reaches you before it becomes a review</span></li><li><b>Review requests</b><span>: plus appointment confirmations and seasonal reminders</span></li></ul><a href="/#only">See the check-in <span aria-hidden="true">&rarr;</span></a></article>', '<article class="pillar"><h3>Follow-ups that don’t go quiet</h3><ul><li><b>Appointment follow-ups</b><span>: confirmations and reminders, with the text written for you</span></li><li><b>Seasonal reminders</b><span>: to patients who said yes to texts</span></li><li><b>Holiday hours</b><span>: and closures posted on Google, after your OK</span></li></ul><a href="#plans">What’s in each plan <span aria-hidden="true">&rarr;</span></a></article>'),
         ('<ul><li><b>Fill my week</b><span>: an open day is offered to past customers who are due; the first yes is booked</span></li><li><b>Online booking</b><span>: and quote requests, taken any hour</span></li><li><b>Past-customer reminders</b><span>: and referral asks</span></li></ul>', '<ul><li><b>Fill my week</b><span>: an open day is offered to past patients who said yes to texts; the first yes is booked</span></li><li><b>Visit requests</b><span>: taken any hour, and every message logged</span></li><li><b>Appointment confirmations</b><span>: so fewer chairs sit empty</span></li></ul>'),
         ('<ul><li><b>The map</b><span>: every Always Open business, closest first; nobody pays to be on it</span></li><li><b>Hand-offs</b><span>: a caller who needs another trade goes to the nearest member, and theirs send work back</span></li><li><b>Storm Desk</b><span>: a post ready the minute a weather warning hits your county</span></li></ul>', '<ul><li><b>The map</b><span>: every Always Open business, closest first; nobody pays to be on it</span></li><li><b>Storm Desk</b><span>: a weather-closure post ready the minute a warning hits your county</span></li></ul>'),
         ('data-label="Finished jobs"', 'data-label="Reviews"'),
         ('A review request after every finished job', 'Replies from wording you approve once, checked by Compliance Guard'),
         ('Posts from your job photos for Google, Facebook and Instagram<span class="soon" data-launch="meta">Coming soon</span>', 'Holiday hours and closures posted on Google, after your OK'),
         ('Quote requests taken any hour, and every lead logged', 'Visit requests taken any hour, and every message logged'),
         ('<span>Quotes, invoices and appointments, each with its own reminder</span>', '<span>Every message on your phone in seconds, with the caller’s number</span>'),
         ('<span>One tap opens Messages with the text ready, from your own phone</span>', '<span>One tap to call back or text, from your own phone</span>'),
         ('<span>Invoice and payment reminders, so money doesn’t sit</span>', '<span>No treatment, insurance or billing details taken, ever</span>'),
         ('Three days after the job, Max calls the customer: did it hold up? A yes becomes the review ask, a no reaches you first', 'Appointment confirmations the day before, with the text written for you'),
         ('Storm Desk: when a warning hits your county, a storm-day post is ready', 'A weather-closure post is ready when a warning hits your county'),
         ('<span>Every customer asked, not just the happy ones</span>', '<span>Replies never confirm that someone is a patient</span>'),
         ('Posts for Google, Facebook and Instagram from your job photos<span class="soon" data-launch="meta">Coming soon</span>', 'Holiday hours and closures posted on Google, after your OK')],
 ),
 'auto-repair': dict(
  only=dict(who='auto repair shops', ask='Do y’all do windshields? Mine’s got a crack across it.', answer='We don’t do glass, but Lake Auto Glass, two miles from here, is on Always Open too.', to='Lake Auto Glass', trade='glass', job='brake job', busy='Sam’s got a car on the lift.', cb='Cracked windshield'),
  title='Auto repair shops', who='auto repair shops', biz='Sample Auto', rivals='shops', plans_for='auto repair', ask_who='shop owners',
  meta='Always Open runs the back side of an auto repair shop: every call answered, every review replied to, estimates followed up on the day you pick, and open bays filled from your own customers. You approve it all from your phone.',
  h1='You’re under a car. A new call, a new review, an estimate gone quiet. We’ve got all three.',
  lede='We run the back side of a repair shop while you’re on the job: every call answered, every review replied to, quotes followed up, and open days filled from your own customer list. On the phone, Max answers in your shop’s name, gives your hours and location, takes the year, make and what the car is doing, and tries your phone if someone is stranded. Estimates get a follow-up on the day you pick, and every finished repair turns into a review request and a post. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a shop owner\'s phone during one day. At 3:05 PM Max took a call from Priya Shah whose car will not start. At 1:15 PM a follow-up on a $1,450 brake and rotor estimate is due, with the text already written. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('3:05 PM', 'Max took a call', 'Stranded', 'Priya Shah', '<p>2016 Highlander, cranks but won’t start, in the pickup line at the elementary school. Asked about a tow and when you could look at it.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'D. Brooks · $1,450 brakes', '<div class="bub">Hi Dan, this is Sam at Sample Auto. Checking in on the estimate for the brakes and rotors. Any questions I can answer?</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★★★★ from Priya S.', '<p>“Got the car in the same afternoon, called with the price before touching it, done by five.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even with your hands in an engine bay.', takes='the year, make and what the car is doing', urgent='someone stranded on the road', books='the drop-off',
  log_aria='Sample lead log for a made-up repair shop: a no-start call taken by Max, a brake estimate followed up, a booked oil change, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'Won’t start · Priya Shah', 'Max took the call, 3:05 PM Tue', 'red', 'New'), row('w', 'Brakes estimate · D. Brooks', 'Follow-up due today', 'warn', 'Due'), row('', 'Oil and tires · J. Ortiz', 'Thursday, 8:00 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Estimates', nav_f='Finished repairs', q_h2='Estimates don’t go quiet.', q_lead='Most estimates aren’t turned down. They’re driven on for another month. Add the estimate in the app and pick a day. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: an estimate for D. Brooks, $1,450, due today, with a drafted text ready to send.',
  q_mock=fu('Estimate', 'Due today', 'D. Brooks', '$1,450', 'Front brakes and rotors, 2014 F-150', ['Text them', 'Call'], 'Hi Dan, this is Sam at Sample Auto. Checking in on the estimate for the brakes and rotors. Any questions I can answer?'),
  f_h2='Finished repairs turn into reviews and posts.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Priya · 706-555-0148 · No-start, starter</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>She agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">A starter swapped the same afternoon and a mom back in the pickup line by three. If yours cranks slow on cold mornings, that is the warning. Give us a call.</p></div>',
  m_h2='A few repairs can cover the whole year.', m_lead='Tickets are smaller than a roof, so count a few. Put in your own numbers.', m_label='A typical repair ticket', m_job=900, m_margin=45, m_one='One ticket like that leaves you',
 ),
 'marine': dict(
  only=dict(who='dock builders and marinas', ask='Do y’all do seawalls? Mine’s washing out.', answer='We don’t do seawalls, but Oconee Shoreline, two miles from here, is on Always Open too.', to='Oconee Shoreline', trade='seawalls', job='lift repair', busy='Sam’s out on the water.', cb='Seawall washing out'),
  title='Docks and marine', who='dock builders, boat repair shops and marinas', biz='Sample Marine', rivals='marine businesses', plans_for='docks and marine', ask_who='marine owners',
  meta='Always Open runs the back side of dock builders, boat repair shops and marinas: every call answered, every review replied to, quotes followed up on the day you pick, and slow weeks filled from your own customers. You approve it all from your phone.',
  h1='Out on the water all weekend. The calls, the reviews, the quotes back at the dock? Handled.',
  lede='We run the back side of a dock and marine business while you’re on the job: every call answered, every review replied to, quotes followed up, and open days filled from your own customer list. On the phone, Max answers in your company’s name, gives your hours and service area, takes the boat, the dock and what’s wrong, and tries your phone if it can’t wait. Dock and repair quotes get a follow-up on the day you pick, and every finished job turns into a review request and a post. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a marine owner’s phone during one spring day. At 9:12 AM Max took a call from Greg Hollis whose boat lift jammed with the boat on it. At 1:15 PM a follow-up on a $22,400 dock and lift quote is due, with the text already written. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('9:12 AM', 'Max took a call', 'Urgent', 'Greg Hollis', '<p>Boat lift stuck halfway up with the pontoon on it. Family is in for the holiday weekend. Asked if anyone can come out today.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'The Wards · $22,400 dock', '<div class="bub">Hi Beth, this is Sam with Sample Marine. Checking in on the quote for the new dock and lift. Any questions I can answer?</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★★★★ from Greg H.', '<p>“Had the lift running by noon on a holiday weekend. Saved our trip.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even when you’re out on the water.', takes='the boat, the dock and what’s wrong', urgent='a lift stuck with a boat on it', books='the site visit',
  log_aria='Sample lead log for a made-up marine company: a jammed lift call taken by Max, a dock quote followed up, a booked spring launch, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'Lift stuck · Greg Hollis', 'Max took the call, 9:12 AM Sat', 'red', 'New'), row('w', 'Dock and lift · the Wards', 'Follow-up due today', 'warn', 'Due'), row('', 'Spring launch · J. Ortiz', 'Thursday, 8:00 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Quotes', nav_f='Finished jobs', q_h2='Dock quotes don’t go quiet.', q_lead='Most dock quotes aren’t turned down. They wait for the next weekend at the lake, then the one after. Add the quote in the app and pick a day. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: a quote for the Wards, $22,400, due today, with a drafted text ready to send.',
  q_mock=fu('Quote', 'Due today', 'The Wards', '$22,400', 'Floating dock and a 10,000 lb lift', ['Text them', 'Call'], 'Hi Beth, this is Sam with Sample Marine. Checking in on the quote for the new dock and lift. Any questions I can answer?'),
  f_h2='Finished jobs turn into reviews and posts.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Greg · 706-555-0148 · Lift repair</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>He agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">A jammed lift back in service by noon on a holiday weekend. If yours groans on the way up, have it looked at before the season gets busy. Give us a call.</p></div>',
  m_h2='One dock can cover the whole year.', m_lead='Docks are big jobs, so the math is short. Put in your own numbers.', m_label='A typical dock or lift job', m_job=18000, m_margin=25, m_one='One job like that leaves you',
  photo_of='a job photo of a repaired boat lift',
  extra=[('including the days you’re under a house', 'including the days you’re under a dock'),
         ('A caller needs the electrician, not you?', 'A caller needs a boat mechanic, not you?'),
         ('<span>Seasonal and past-customer reminders</span>', '<span>Spring launch, winterizing and past-customer reminders</span>')],
 ),
 'salons': dict(
  only=dict(who='salons and studios', ask='Do y’all do lash extensions?', answer='We don’t do lashes, but Lake Lash Studio, two doors down, is on Always Open too.', to='Lake Lash Studio', trade='lashes', job='color', busy='Jess is mid-color.', will='She’ll call you at 4:15.', cb='Lash extensions'),
  title='Salons, spas and gyms', who='salons, spas, gyms and groomers', biz='Sample Salon', rivals='salons', plans_for='salons and studios', ask_who='salon and studio owners',
  meta='Always Open runs the back side of salons, spas, gyms and groomers: every call answered, every review replied to, appointments confirmed, and open chairs filled from your own clients. You approve it all from your phone.',
  h1='Your hands are full. The phone rings, a review lands, Thursday has open chairs. We’ve got it.',
  lede='We run the back side of a salon or studio while your hands are busy: every call answered, every review replied to, quotes followed up, and open days filled from your own customer list. On the phone, Max answers in your business’s name, gives your hours and the prices you set, takes the caller’s name, the service and the day they want, and sends it to your phone in seconds. Appointments get a confirmation on the day you pick, and every visit can turn into a review request and a post. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a salon owner’s phone during one day. At 11:20 AM Max took a call from Ana Ruiz who wants a color correction before a wedding. At 1:15 PM a confirmation for Maria’s Thursday appointment is due, with the text already written. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('11:20 AM', 'Max took a call', 'New client', 'Ana Ruiz', '<p>Wants a color correction before a wedding on the 14th. Saturday morning if possible, any stylist.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'Maria L. · Thursday 10 AM', '<div class="bub">Hi Maria, this is Jess at Sample Salon, confirming your appointment on Thursday at 10 AM. Reply here if you need to change it.</div>', ['Text her', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★★★★ from Ana R.', '<p>“Fixed a color two other places would not touch. I finally like my hair again.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even in the middle of a cut.', takes='the name, the service and the day they want', urgent='a bride whose appointment is today', books='the appointment',
  log_aria='Sample lead log for a made-up salon: a new-client call taken by Max, an appointment confirmation due, a booked cut, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'Color correction · Ana Ruiz', 'Max took the call, 11:20 AM Tue', 'red', 'New'), row('w', 'Confirm · Maria L.', 'Thursday 10 AM, text due today', 'warn', 'Due'), row('', 'Cut and style · J. Ortiz', 'Saturday, 9:30 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Appointments', nav_f='After a visit', q_h2='Fewer no-shows, fewer empty chairs.', q_lead='A forgotten appointment is an hour you can’t sell twice. Add the appointment in the app and pick the day to confirm. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: Maria Lopez’s color and cut on Thursday, confirmation due today, with a drafted text ready to send.',
  q_mock=fu('Appointment', 'Due today', 'Maria Lopez', '$180', 'Color and cut, Thursday 10 AM', ['Text her', 'Call'], 'Hi Maria, this is Jess at Sample Salon, confirming your appointment on Thursday at 10 AM. Reply here if you need to change it.'),
  f_h2='Every visit can turn into a review and a post.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Ana · 706-555-0148 · Color correction</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>She agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo, with her OK</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">A color correction finished just in time for a wedding. If your color has gone brassy or uneven, book a consultation and we’ll talk it through.</p></div>',
  m_h2='One new regular can cover months.', m_lead='Visits are small, but regulars come back all year. Put in your own numbers.', m_label='What a regular spends in a year', m_job=1200, m_margin=50, m_one='One new regular like that leaves you',
  photo_of='a photo of a finished color',
  extra=[('When a job wraps up, tap Finished a job.', 'After a visit, tap Finished a job.'),
         ('from your job photos', 'from your photos', -1),
         ('Quote requests taken any hour, and every lead logged', 'Booking requests taken any hour, and every lead logged'),
         ('Three days after the job, Max calls the customer: did it hold up?', 'A few days after a visit, Max calls the client: did it hold up?'),
         ('A caller needs the electrician, not you? Max can put them through to one nearby on Always Open, and theirs can send you work back.', 'A caller wants a service you don’t offer? Max can put them through to a business nearby on Always Open, and theirs can send you clients back.'),
         ('<span>Seasonal and past-customer reminders</span>', '<span>Rebooking and past-client reminders</span>'),
         ('Need crews?', 'Hiring?'),
         ('You can read it on the tailgate.', 'You can read it between clients.'),
         ('including the days you’re under a house', 'including the days you’re booked solid'),
         ('What does Max say when someone asks what a job costs?', 'What does Max say when someone asks what a service costs?'),
         ('takes the details for an estimate and a good time for you to call back', 'takes what they want and a good time for you to call back'),
         ('Your hours, service area and the best number for urgent calls.', 'Your hours, your services and prices, and the best number for urgent calls.')],
 ),
 'restaurants': dict(
  only=dict(who='restaurants and shops', ask='Do y’all do wedding cakes?', answer='We don’t do cakes, but Oconee Bakery, two blocks over, is on Always Open too.', to='Oconee Bakery', trade='cakes', job='catering order', busy='Sam’s on the line for lunch.', cb='Wedding cake'),
  title='Restaurants and shops', who='restaurants, cafes and shops', biz='Sample Kitchen', rivals='restaurants', plans_for='restaurants and shops', ask_who='restaurant and shop owners',
  meta='Always Open runs the back side of restaurants, cafes and shops: every call answered, every review replied to, catering quotes followed up, and slow nights filled from your own regulars. You approve it all from your phone.',
  h1='Friday, 7 PM, every table full. The phone, the reviews, next week’s slow Tuesday: we’ve got them.',
  lede='We run the back side of a restaurant or shop while the floor is full: every call answered, every review replied to, catering quotes followed up, and slow nights filled from your own customer list. On the phone, Max answers in your business’s name, gives your hours, holiday hours and directions from what you tell him, takes large-party and catering requests, and sends them to your phone in seconds. Catering quotes get a follow-up on the day you pick, every review gets an answer, and your specials go up as Google posts. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a restaurant owner’s phone during one day. At 7:08 PM Max took a call from Lauren Pike about an office lunch for 40. At 1:15 PM a follow-up on a $1,850 catering quote is due, with the text already written. At 4:30 PM a reply to a two-star review is ready for approval.',
  day_cards=card('7:08 PM', 'Max took a call', 'Catering', 'Lauren Pike', '<p>Office lunch for 40 next Thursday, half vegetarian. Wants a quote by Monday.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Follow-up', 'Due today', 'Riverside Realty · $1,850', '<div class="bub">Hi Tom, this is Sam at Sample Kitchen. Checking in on the catering quote for your open house. Any questions I can answer?</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', '', '★★ from Mark D.', '<p>“Food was great, but we waited 40 minutes for a table we had reserved.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even in the Friday rush.', takes='the date, the headcount and what they need', urgent='a catering order for today', books='tastings and event walkthroughs',
  log_aria='Sample lead log for a made-up restaurant: a catering call taken by Max, a catering quote followed up, a booked event walkthrough, and a hang-up that got a text back.',
  log_rows='\n'.join([row('r', 'Lunch for 40 · Lauren Pike', 'Max took the call, 7:08 PM Fri', 'red', 'New'), row('w', 'Catering · Riverside Realty', 'Follow-up due today', 'warn', 'Due'), row('', 'Rehearsal dinner · J. Ortiz', 'Walkthrough Thursday, 3:00 PM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Catering', nav_f='Reviews and posts', q_h2='Catering quotes don’t go quiet.', q_lead='Most catering quotes aren’t turned down. They get buried under the next event. Add the quote in the app and pick a day. That morning your phone reminds you, and the text is already written. If they said yes to texts, we send it for you from your business number.',
  q_aria='Sample follow-up in the Always Open app: a catering quote for Riverside Realty, $1,850, due today, with a drafted text ready to send.',
  q_mock=fu('Quote', 'Due today', 'Riverside Realty', '$1,850', 'Open house lunch for 60, delivered Saturday', ['Text them', 'Call'], 'Hi Tom, this is Sam at Sample Kitchen. Checking in on the catering quote for your open house. Any questions I can answer?'),
  f_h2='Every review answered. Every special posted.',
  f_mock='<div class="ask"><b>Finished a job</b><span>Lauren · 706-555-0148 · Lunch for 40</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>She agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Post · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">Thursday’s special: shrimp and grits with a cup of gumbo, 11 to 2. Call ahead for orders of ten or more.</p></div>',
  m_h2='One catering order can cover a month.', m_lead='Plates are small, so count a catering order. Put in your own numbers.', m_label='A typical catering order', m_job=1500, m_margin=35, m_one='One order like that leaves you',
  photo_of='a photo of a daily special',
  extra=[('When a job wraps up, tap Finished a job. The review request is written, and one tap sends it from your phone to a customer who agreed. Send us a photo, and it comes back as a Google post written for you, ready for your OK.',
          'Every review gets a reply written for you, and bad ones reach you the same day. After a catering order or a special-order pickup, tap Finished a job, and one tap sends a review request to a customer who agreed. Send us a photo of the special, and it comes back as a Google post, ready for your OK.'),
         ('from your job photos', 'from your photos', -1),
         ('Quote requests taken any hour, and every lead logged', 'Catering and large-party requests taken any hour, and every lead logged'),
         ('\n          <li><svg aria-hidden="true"><use href="#chk"/></svg><span>Three days after the job, Max calls the customer: did it hold up? A yes becomes the review ask, a no reaches you first</span></li>', ''),
         ('A caller needs the electrician, not you? Max can put them through to one nearby on Always Open, and theirs can send you work back.', 'A caller wants something you don’t carry? Max can put them through to a business nearby on Always Open, and theirs can send you customers back.'),
         ('<span>Seasonal and past-customer reminders</span>', '<span>Holiday, catering-season and past-customer reminders</span>'),
         ('Need crews?', 'Hiring?'),
         ('You can read it on the tailgate.', 'You can read it before the lunch rush.'),
         ('including the days you’re under a house', 'including the Friday nights you’re on the line'),
         ('What does Max say when someone asks what a job costs?', 'What does Max say when someone asks what catering costs?'),
         ('takes the details for an estimate and a good time for you to call back', 'takes the date, the headcount and a good time for you to call back'),
         ('Your hours, service area and the best number for urgent calls.', 'Your hours, holiday hours and the best number for urgent calls.')],
 ),
}

if __name__ == '__main__':
    for k, d in PAGES.items():
        build(k, d)
