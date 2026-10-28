#!/usr/bin/env python3
"""Builds the industry pages (hvac, plumbing, dental, auto-repair) from builders.html.
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
    s = rep(s, '<h1>The next job calls while you’re building this one.</h1>', '<h1>' + d['h1'] + '</h1>')
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
        s = rep(s, 'tap Finished a job. The review request is written, and one tap sends it from your phone to a customer who agreed.', 'tap Finished a visit. The review request is written, with no treatment details, and one tap sends it from your phone to a patient who agreed.')
    # the math
    s = rep(s, '<h2>One job can cover the whole year.</h2>', '<h2>' + d['m_h2'] + '</h2>')
    s = rep(s, 'Your jobs are big, so the math is short. Put in your own numbers.', d['m_lead'])
    s = rep(s, '<label for="m-job">A typical job, start to finish', '<label for="m-job">' + d['m_label'])
    s = rep(s, 'value="25000" size="8"', 'value="' + str(d['m_job']) + '" size="8"')
    s = rep(s, 'value="20" size="4"', 'value="' + str(d['m_margin']) + '" size="4"')
    s = rep(s, '<p>One job like that leaves you</p>', '<p>' + d['m_one'] + '</p>')
    keep = int(d['m_job'] * d['m_margin'] / 100)
    s = rep(s, '<strong id="m-keep">$5,000</strong>', '<strong id="m-keep">$' + format(keep, ',') + '</strong>')
    s = rep(s, 'That covers <b>16 months</b> of Growth, or <b>10 months</b> of Pro.', 'That covers <b>' + str(max(0, keep // 299)) + ' months</b> of Growth, or <b>' + str(max(0, keep // 499)) + ' months</b> of Pro.')
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
    for a, b in d.get('extra', []):
        s = rep(s, a, b)
    if d.get('regulated'):
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
  title='HVAC companies', who='heating and air companies', biz='Sample Heating and Air', rivals='HVAC companies', plans_for='heating and air', ask_who='HVAC owners',
  meta='Always Open for HVAC companies: Max answers the calls you miss on a service call, maintenance and estimate follow-ups go out on the day you pick, and every finished job turns into a review request. You approve it all from your phone.',
  h1='July. 98 degrees. Their AC quit at 6 PM. They called four companies. One answered.',
  lede='Max answers your calls in your company’s name, tells callers your hours and service area, takes the address and what the system is doing, and tries your phone if it’s an emergency. Estimates get a follow-up on the day you pick, and every finished job turns into a review request and a post. <b>You approve it all from your phone.</b>',
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
  title='Plumbers', who='plumbers and drain companies', biz='Sample Plumbing', rivals='plumbers', plans_for='plumbers', ask_who='plumbers',
  meta='Always Open for plumbers: Max answers the calls you miss under a sink, estimates get a follow-up on the day you pick, and every finished job turns into a review request. You approve it all from your phone.',
  h1='Sunday, 11:12 PM. A customer’s water heater just quit. They called three places. One answered.',
  lede='Max answers your calls in your company’s name, tells callers your hours and service area, takes the address and what’s going on, and tries your phone if it’s an emergency. Estimates get a follow-up on the day you pick, and every finished job turns into a review request and a post. <b>You approve it all from your phone.</b>',
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
  meta='Always Open for dental practices: Max answers the calls the front desk misses, takes a message with no treatment details, and every review gets a careful reply checked by Compliance Guard. You approve it all from your phone.',
  h1='Monday, 7:50 AM. A cracked tooth. Your phones open at eight.',
  lede='Max answers your calls in your practice’s name, gives your hours and location, and takes a message with the caller’s name, number and what they need, nothing more. He never discusses fees, treatment or insurance. Every review gets a careful reply that Compliance Guard checks before you see it. <b>You approve it all from your phone.</b>',
  day_aria='Sample: three things on a practice owner\'s phone during one day. At 7:50 AM Max took a call from a caller with a cracked tooth who wants the first opening. At 1:15 PM an appointment confirmation is due. At 4:30 PM a reply to a five-star review is ready for approval.',
  day_cards=card('7:50 AM', 'Max took a call', 'First opening', 'A caller with a cracked tooth', '<p>Asked for the first opening today. Left a name and number. No other details taken.</p>', ['Call back', 'Text'], hot=True) + '\n        ' +
            card('1:15 PM', 'Confirmation', 'Due today', 'Thursday 9:00 AM visit', '<div class="bub">Hi, this is Sample Family Dental. A quick note that your visit is Thursday at 9:00 AM. Reply C to confirm, or call us to move it.</div>', ['Text them', 'Call'], due=True) + '\n        ' +
            card('4:30 PM', 'Reply ready for your OK', 'Guard: passed', '★★★★★ from a patient', '<p>“Gentle, on time, and they explained each step before doing it.”</p>', ['Approve', 'Edit']),
  calls_h2='Every call answered, even when the front desk is with a patient.', takes='a message with the caller’s name, number and what they need, nothing more', urgent='a knocked-out tooth', books='the visit',
  log_aria='Sample call log for a made-up dental practice: a cracked-tooth call taken by Max, a confirmation due, a booked visit, and a hang-up that got a text back. No patient details.',
  log_rows='\n'.join([row('r', 'Cracked tooth · first opening', 'Max took the call, 7:50 AM Mon', 'red', 'New'), row('w', 'Confirmation · Thursday 9:00 AM', 'Due today', 'warn', 'Due'), row('', 'New patient visit', 'Thursday, 9:00 AM', 'ok', 'Booked'), row('', 'Missed call · 706-555-0177', 'Hung up; texted back in seconds', 'ok', 'Texted')]),
  nav_q='Confirmations', nav_f='Reviews', q_h2='Confirmations and reminders don’t get forgotten.', q_lead='Empty chairs are mostly forgotten appointments. Add the visit in the app and the confirmation goes out on the day you pick, to patients who agreed to texts. No treatment details, ever.',
  q_aria='Sample confirmation in the Always Open app: a Thursday 9:00 AM visit, due today, with a drafted text ready to send. No treatment details.',
  q_mock=fu('Confirmation', 'Due today', 'Thursday 9:00 AM', '', 'New patient visit', ['Text them', 'Call'], 'Hi, this is Sample Family Dental. A quick note that your visit is Thursday at 9:00 AM. Reply C to confirm, or call us to move it.'),
  f_h2='Every review gets a careful reply.',
  f_mock='<div class="ask"><b>Finished a visit</b><span>A patient · 706-555-0148</span><label><i><svg aria-hidden="true"><use href="#chk"/></svg></i><span>They agreed to get one text from us.</span></label></div>\n        <div class="photo"><span>Your photo</span></div>\n        <div><small>Reply · Guard: passed · waiting for your OK</small><p style="font-size:14.5px;margin-top:4px">Thank you for the kind words. We are glad the visit went smoothly. We look forward to seeing you next time.</p></div>',
  m_h2='One new patient a month can cover it.', m_lead='A practice is built on patients who stay. Put in your own numbers.', m_label='What a new patient is worth to you in a year', m_job=1200, m_margin=40, m_one='One new patient like that leaves you',
  extra=[('data-label="Finished jobs"', 'data-label="Reviews"'), ('When a job wraps up, tap Finished a visit.', 'When a visit wraps up, tap Finished a visit.'),
         ('A review request after every finished job', 'A review request after every visit, for patients who agreed'),
         ('Posts from your job photos for Google, Facebook and Instagram', 'Posts from your office photos for Google, Facebook and Instagram'),
         ('Three days after the job, Max calls the customer: did it hold up? A yes becomes the review ask, a no reaches you first', 'Review replies checked by Compliance Guard before they reach you'),
         ('Storm Desk: when a warning hits your county, a storm-day post is ready', 'A weather-closure post is ready when a warning hits your county'),
         ('<span>Every customer asked, not just the happy ones</span>', '<span>Every patient who agreed is asked, not just the happy ones, and never with treatment details</span>'),
         ('Posts for Google, Facebook and Instagram from your job photos', 'Posts for Google, Facebook and Instagram from your office photos, never patients')],
 ),
 'auto-repair': dict(
  title='Auto repair shops', who='auto repair shops', biz='Sample Auto', rivals='shops', plans_for='auto repair', ask_who='shop owners',
  meta='Always Open for auto repair shops: Max answers the calls you miss with your hands in an engine bay, estimates get a follow-up on the day you pick, and every finished repair turns into a review request. You approve it all from your phone.',
  h1='Her car won’t start in the school pickup line. She’s calling you.',
  lede='Max answers your calls in your shop’s name, gives your hours and location, takes the year, make and what the car is doing, and tries your phone if someone is stranded. Estimates get a follow-up on the day you pick, and every finished repair turns into a review request and a post. <b>You approve it all from your phone.</b>',
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
}

if __name__ == '__main__':
    for k, d in PAGES.items():
        build(k, d)
