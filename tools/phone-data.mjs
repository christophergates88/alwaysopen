// What each page's playable "Only here" cards say. Every business, caller and number here is made up and labeled Sample.
// A card: { key, title, tag, why, intro: [lines], choices: [{ label, then: [lines] }], call?: true }
// A line: ['in', text] the caller or customer · ['out', text] Max or the business · ['sys', text] a status line
//         ['ai', text] an answer assistant · ['note', label, title, text, 'hot' | 'ok'] what lands on the owner's phone
//         ['draft', text] a reply the owner wrote

const TAG = { every: 'Every plan', growth: 'Growth', pro: 'Pro' };
const WHY = {
  max: 'Max answers in your business’s name, gives the prices you’ve approved, and sends you the job.',
  handoff: 'A caller needs work you don’t do. Max puts them through to a business nearby on Always Open, and theirs can send you work back.',
  check: 'Three days after the job, Max calls: did it hold up? A yes becomes the review ask. A no reaches you first, before it becomes a review.',
  cb: 'No more “someone will call you.” Max names a time from your calendar. If you miss it, he calls them to set a new one.',
  fill: 'A day is wide open. Past customers who are due, and said yes to texts, get offered it. The first yes is booked.',
  storm: 'When a weather warning hits your county, a storm-day post is drafted that minute. You approve it from wherever you are.',
  ai: 'Customers ask answer assistants who to call. Once a month we ask them about you, and fix whatever they get wrong, where it comes from.'
};

// The seven cards for a trade, from a few facts about it.
function tradeCards(v) {
  const he = v.he || 'he', He = he[0].toUpperCase() + he.slice(1), his = v.his || 'his';
  const cards = [];
  cards.push({
    key: 'max', title: 'Max answers', tag: TAG.every, why: v.maxWhy || WHY.max, call: true,
    intro: [['sys', v.callTime + ' · call to ' + v.biz], ['out', 'Thanks for calling ' + v.biz + '. I’m Max, an automated assistant, and this call may be recorded. How can I help?'], ['in', v.problem]],
    choices: [
      { label: v.priceLabel || 'Ask what it costs', then: [['in', v.priceQ], ['out', v.priceA], ['in', v.yes], ['note', 'On ' + v.owner + '’s phone · new job', v.job[0], v.job[1], 'ok']] },
      { label: 'Ask for a person', then: [['in', 'Can I talk to a real person?'], ['out', v.personA || ('Sure. I’m trying ' + v.owner + '’s cell now. If ' + he + ' can’t pick up, ' + he + '’ll call you back ' + (v.cbWhen || 'first thing in the morning') + '.')], ['sys', 'Ringing ' + v.owner + ' · ' + v.callTime.split(' ').slice(1).join(' ')], ['note', 'On ' + v.owner + '’s phone' + (v.urgent ? ' · urgent' : ''), v.person[0], v.person[1], v.urgent ? 'hot' : '']] }
    ]
  });
  cards.push({
    key: 'handoff', title: 'Hand-offs between businesses', tag: TAG.pro, why: WHY.handoff,
    intro: [['in', v.other.ask], ['out', 'We don’t do ' + v.other.what + ', but ' + v.other.name + ', ' + (v.other.dist || 'two miles from here') + ', is on Always Open too. Want me to put you through?']],
    choices: [
      { label: 'Put me through', then: [['in', 'Yeah, please.'], ['sys', 'Put through to ' + v.other.name + ' · 2:14 PM'], ['note', 'The next week', v.other.name + ' sent you a job', v.other.back, 'ok']] },
      { label: 'No thanks', then: [['in', 'No thanks.'], ['out', 'No problem. ' + v.other.name + ' is at 478-555-0177 if you change your mind.']] }
    ]
  });
  cards.push({
    key: 'check', title: 'The three-day check-in', tag: TAG.pro, why: v.checkWhy || WHY.check,
    intro: [['sys', 'Max called Dana · Thursday 11:20 AM'], ['out', 'Hi Dana, it’s Max with ' + v.biz + '. Quick one: ' + v.check.q + ' Press 1 if it did, 2 if something’s not right.']],
    choices: [
      { label: 'Press 1', then: [['sys', 'Dana pressed 1'], ['out', 'Glad to hear it. Thanks, Dana.'], ['note', 'Next', 'Review request sent to Dana', 'One text, because she said yes to texts.', 'ok']] },
      { label: 'Press 2', then: [['sys', 'Dana pressed 2'], ['out', 'I’m sorry. I’m letting ' + v.owner + ' know right now, and ' + he + '’ll call you today.'], ['note', 'On ' + v.owner + '’s phone · urgent', 'Dana: ' + v.check.bad, 'Call her before it turns into a review.', 'hot']] }
    ]
  });
  cards.push({
    key: 'cb', title: 'Call-backs with a time on them', tag: TAG.pro, why: WHY.cb,
    intro: [['in', 'Can the owner call me back?'], ['out', v.busy + ' ' + He + '’ll call you at 4:15. Does that work?']],
    choices: [
      { label: '4:15 works', then: [['in', '4:15 is fine.'], ['note', 'On ' + v.owner + '’s phone', 'Call Priya at 4:15 PM', v.cbWhy + ' · 478-555-0142', 'ok']] },
      { label: 'Ask for later', then: [['in', 'Could it be after 6?'], ['out', 'Sure. ' + v.owner + ' will call you at 6:15.'], ['note', 'On ' + v.owner + '’s phone', 'Call Priya at 6:15 PM', v.cbWhy + ' · moved from 4:15', 'ok']] }
    ]
  });
  if (v.fill) cards.push({
    key: 'fill', title: 'Fill my week', tag: TAG.pro, why: WHY.fill,
    intro: [['sys', v.fill.day + ' is wide open on ' + v.owner + '’s calendar'], ['out', 'Hi Dana, this is ' + v.biz + '. ' + v.owner + ' has ' + v.fill.slot + ' open and thought of you: ' + v.fill.reason + '. Want it? Reply YES or a better time.']],
    choices: [
      { label: 'Reply YES', then: [['in', 'YES'], ['sys', 'Booked · ' + v.fill.slot + ' · on your Google calendar']] },
      { label: 'Ask for another day', then: [['in', 'Could Friday afternoon work?'], ['out', 'Friday at 2 PM works. You’re booked, Dana.'], ['sys', 'Booked · Friday at 2 PM · on your Google calendar']] }
    ]
  });
  cards.push({
    key: 'storm', title: 'Storm Desk', tag: TAG.growth, why: WHY.storm,
    intro: [['sys', 'Severe thunderstorm warning · Putnam County · 3:12 PM'], ['note', 'Post · waiting for your OK', v.storm.title || 'Storm tonight in Putnam County', v.storm.post]],
    choices: [
      { label: 'Approve', then: [['sys', 'You tapped Approve · 3:13 PM'], ['note', v.biz + ' on Google · just now', v.storm.title || 'Storm tonight in Putnam County', 'Live where people search tonight.', 'ok']] },
      { label: 'Edit first', then: [['sys', 'You added one line'], ['note', 'Post · edited', v.storm.title || 'Storm tonight in Putnam County', v.storm.post + ' ' + v.storm.extra], ['sys', 'Posted to your Google profile · 3:15 PM']] }
    ]
  });
  cards.push({
    key: 'ai', title: 'What assistants say about you', tag: TAG.growth, why: WHY.ai,
    intro: [['sys', 'A customer asks an answer assistant'], ['in', v.ai.q], ['ai', v.ai.wrong]],
    choices: [
      { label: 'Run this month’s check', then: [['note', 'This month’s check', v.ai.fixT, v.ai.fixP, 'hot'], ['in', v.ai.q2], ['ai', v.ai.right]] }
    ]
  });
  return cards;
}

const PLUMB = {
  owner: 'Sam', callTime: 'Sun 11:12 PM', urgent: true,
  problem: 'My water heater just quit, and there’s water in the garage.',
  priceQ: 'What does it cost to come out?', priceA: 'The service call is $89, and it goes toward the repair. Sam can be there at 8 tomorrow morning. Want that time?', yes: 'Yes, 8 works.',
  job: ['Marcus Hill · water heater', 'Tomorrow 8:00 AM · water in the garage'],
  person: ['Marcus Hill · water heater', 'Water in the garage. Wants a person tonight.'],
  other: { ask: 'Do y’all do electrical? My water heater keeps tripping the breaker.', what: 'electrical', name: 'Lane Electric', back: 'A water heater swap two streets over. They sent the caller to you.' },
  check: { q: 'did the water heater hold up?', bad: 'the water heater is leaking again.' },
  busy: 'Sam’s under a house in Greensboro.', cbWhy: 'Breaker tripping',
  fill: { day: 'Thursday', slot: 'Thursday at 9 AM', reason: 'your water heater is due for its yearly flush' },
  storm: { post: 'If a limb takes out a line or a pipe bursts, we’re answering the phone all night. Stay safe and call us any time.', extra: 'Sump pump questions too.' }
};

export const PAGES = {
  index: {
    heading: 'What nobody else does. Tap to try it.',
    sub: 'Each card plays out a call, a text or a post for a made-up plumber. Tap a choice and watch what happens.',
    short: 'Max answers your calls, reviews get answered, and quotes get followed up. You approve it all from your phone.',
    chips: true,
    cards: tradeCards(Object.assign({}, PLUMB, { biz: 'Sinclair Plumbing',
      ai: { q: 'What’s the number for Sinclair Plumbing in Eatonton?', wrong: '478-555-0100, according to Yelp.', fixT: 'Wrong phone on Yelp', fixP: 'That’s the old number. We fixed it on Yelp.', q2: 'Who’s a good plumber in Eatonton?', right: 'Sinclair Plumbing, 478-555-0142. They answer around the clock.' } }))
  },
  plumbing: {
    plural: 'plumbers', short: 'Max answers in your company’s name, takes the address and what’s wrong, and tries your phone if it’s an emergency.', chips: true, type: 'Contractor or trade',
    cards: tradeCards(Object.assign({}, PLUMB, { biz: 'Sample Plumbing',
      ai: { q: 'What’s the number for Sample Plumbing in Eatonton?', wrong: '478-555-0100, according to Yelp.', fixT: 'Wrong phone on Yelp', fixP: 'That’s the old number. We fixed it on Yelp.', q2: 'Who’s a good plumber in Eatonton?', right: 'Sample Plumbing, 478-555-0142. They answer around the clock.' } }))
  },
  hvac: {
    plural: 'heating and air companies', short: 'Max answers in your company’s name, takes the address and what’s wrong, and tries your phone when a house has no heat or AC.', chips: true, type: 'Contractor or trade',
    cards: tradeCards({
      biz: 'Sample Heating and Air', owner: 'Sam', callTime: 'Sat 6:10 PM', urgent: true,
      problem: 'Our AC quit, and it’s 91 degrees in the house.',
      priceQ: 'What does it cost to come out?', priceA: 'The service call is $99, and it goes toward the repair. Sam can be there at 7:30 tomorrow morning. Want that time?', yes: 'Yes, please.',
      job: ['Lisa Grant · AC out', 'Tomorrow 7:30 AM · 91 degrees inside'], person: ['Lisa Grant · AC out', '91 degrees inside. Wants a person tonight.'],
      other: { ask: 'Do y’all do electrical? My breaker keeps tripping.', what: 'electrical', name: 'Lane Electric', back: 'A heat pump tune-up on Pine Street. They sent the caller to you.' },
      check: { q: 'did the new system hold up?', bad: 'the new system keeps short-cycling.' },
      busy: 'Sam’s on a call in Greensboro.', cbWhy: 'Breaker tripping',
      fill: { day: 'Thursday', slot: 'Thursday at 9 AM', reason: 'your system is due for its fall tune-up' },
      storm: { post: 'If the power blinks and your AC or heat won’t come back on, call us. We’re answering the phone all night.', extra: 'Ask us about surge protection, too.' },
      ai: { q: 'Who can fix my AC tonight in Eatonton?', wrong: 'Sample Heating and Air is listed at 478-555-0100.', fixT: 'Wrong phone on Yelp', fixP: 'That’s the old number. We fixed it on Yelp.', q2: 'Who can fix my AC tonight in Eatonton?', right: 'Sample Heating and Air, 478-555-0142. They answer around the clock.' }
    })
  },
  builders: {
    plural: 'builders', short: 'Max answers in your company’s name, takes the details for an estimate, and books the site visit.', chips: true, type: 'Contractor or trade',
    cards: tradeCards({
      biz: 'Sample Builders', owner: 'Sam', callTime: 'Tue 7:40 PM',
      problem: 'We want to add a screened porch before spring.',
      priceLabel: 'Ask for a ballpark', priceQ: 'Roughly what does a porch run?', priceA: 'Most screened porches Sam builds run $18,000 to $30,000. He can come measure Thursday at 4. Want that time?', yes: 'Thursday at 4 is good.',
      job: ['The Parkers · screened porch', 'Site visit Thursday 4:00 PM'], person: ['The Parkers · screened porch', 'Want to talk it through. Call back tomorrow.'],
      other: { ask: 'Do y’all do electrical? My panel keeps tripping.', what: 'electrical', name: 'Lane Electric', back: 'A kitchen remodel on Oak Street. They sent the caller to you.' },
      check: { q: 'did the deck hold up?', bad: 'a deck board is already lifting.' },
      busy: 'Sam’s on a job in Greensboro.', cbWhy: 'Porch estimate',
      fill: { day: 'Thursday', slot: 'Thursday morning', reason: 'your deck is due for its yearly seal' },
      storm: { post: 'If a limb comes down on your roof or deck tonight, call us. We’re answering all night and can tarp first thing.', extra: 'Stay off ladders until it passes.' },
      ai: { q: 'Who builds screened porches near Eatonton?', wrong: 'Sample Builders may be closed. One listing says “permanently closed.”', fixT: 'An old listing says closed', fixP: 'A duplicate listing said closed. We had it removed.', q2: 'Who builds screened porches near Eatonton?', right: 'Sample Builders, 478-555-0142. They build porches and decks around Lake Oconee.' }
    })
  },
  'auto-repair': {
    plural: 'auto repair shops', short: 'Max answers in your shop’s name, takes the car and what’s wrong, and books the bay.', chips: true, type: 'Contractor or trade',
    cards: tradeCards({
      biz: 'Sample Auto', owner: 'Sam', callTime: 'Wed 3:05 PM', urgent: true, cbWhen: 'within the hour',
      problem: 'My car won’t start, and I’m in the school pickup line.',
      priceQ: 'What does it cost to look at it?', priceA: 'A diagnostic is $95, and it goes toward the repair. Sam has a bay open at 4:30 today. Want it?', yes: 'Yes. I’ll get a jump and come in.',
      job: ['Keisha Moore · won’t start', 'Today 4:30 PM · diagnostic'], person: ['Keisha Moore · won’t start', 'Stuck in the school pickup line. Wants a person.'],
      other: { ask: 'Do y’all do windshields? Mine’s got a crack across it.', what: 'glass', name: 'Lake Auto Glass', back: 'A brake job for a work van. They sent the caller to you.' },
      check: { q: 'did the brake job hold up?', bad: 'the brakes are squealing again.' },
      busy: 'Sam’s got a car on the lift.', cbWhy: 'Cracked windshield',
      fill: { day: 'Thursday', slot: 'Thursday at 9 AM', reason: 'your car is due for an oil change' },
      storm: { post: 'Storms tonight. If a limb hits your car or you get stuck, call us. We’re answering the phone all night.', extra: 'We can line up a tow first thing.' },
      ai: { q: 'Is Sample Auto open Saturdays?', wrong: 'No. Sample Auto is closed on weekends, according to Facebook.', fixT: 'Wrong hours on Facebook', fixP: 'They’re open Saturday 8 to noon. We fixed it on Facebook.', q2: 'Who can look at my car Saturday in Eatonton?', right: 'Sample Auto is open Saturday 8 to noon. 478-555-0142.' }
    })
  },
  marine: {
    plural: 'dock builders and marinas', short: 'Max answers while you’re out on the water, takes the dock and what’s wrong, and tries your phone if it’s urgent.', chips: true, type: 'Dock, marine or outdoor',
    cards: tradeCards({
      biz: 'Sample Marine', owner: 'Sam', callTime: 'Sat 5:48 PM', urgent: true,
      problem: 'Our boat lift jammed with the boat on it.',
      priceQ: 'Can someone come this weekend?', priceA: 'Sam’s crew can be there at 8 tomorrow. The service call is $125. Want that time?', yes: 'Yes, 8 is great.',
      job: ['The Kellers · lift jammed', 'Tomorrow 8:00 AM · boat on the lift'], person: ['The Kellers · lift jammed', 'Boat stuck on the lift. Wants a person.'],
      other: { ask: 'Do y’all do seawalls? Mine’s washing out.', what: 'seawalls', name: 'Oconee Shoreline', back: 'A dock repair on the north end. They sent the caller to you.' },
      check: { q: 'did the lift repair hold up?', bad: 'the lift is sticking again.' },
      busy: 'Sam’s out on the water.', cbWhy: 'Seawall washing out',
      fill: { day: 'Thursday', slot: 'Thursday at 9 AM', reason: 'your lift is due for its spring service' },
      storm: { title: 'Storm tonight on the lake', post: 'If your dock or lift takes a hit tonight, call us. We’re answering all night and out first thing.', extra: 'Tie down cushions and covers now.' },
      ai: { q: 'What’s the number for Sample Marine?', wrong: '478-555-0100, according to Yelp.', fixT: 'Wrong phone on Yelp', fixP: 'That’s the old number. We fixed it on Yelp.', q2: 'Who fixes boat lifts on Lake Oconee?', right: 'Sample Marine, 478-555-0142. They answer around the clock.' }
    })
  },
  salons: {
    plural: 'salons and studios', short: 'Max answers in your salon’s name in the middle of a cut, books the visit, and sends it to your phone.', chips: true, type: 'Salon, spa or fitness',
    cards: tradeCards({
      biz: 'Sample Salon', owner: 'Jess', he: 'she', his: 'her', callTime: 'Tue 8:15 PM',
      problem: 'Do you have anything Saturday for a cut and color?',
      priceQ: 'What does a cut and color cost?', priceA: 'A cut and color starts at $120. Jess has Saturday at 10. Want it?', yes: 'Yes, book it.',
      job: ['Maria Lopez · cut and color', 'Saturday 10:00 AM · new client'], person: ['Maria Lopez · cut and color', 'New client. Wants to talk before booking.'],
      other: { ask: 'Do y’all do lash extensions?', what: 'lashes', name: 'Lake Lash Studio', dist: 'two doors down', back: 'A wedding party, six updos. They sent the caller to you.' },
      check: { q: 'did the color hold up?', bad: 'the color is already fading.' }, checkWhy: 'A few days after a visit, Max calls: did it hold up? A yes becomes the review ask. A no reaches you first, before it becomes a review.',
      busy: 'Jess is mid-color.', cbWhy: 'Lash extensions',
      fill: { day: 'Thursday', slot: 'Thursday at 2 PM', reason: 'it’s been six weeks since your color' },
      storm: { title: 'Storms this afternoon', post: 'If you need to move your visit because of the weather, call us. We’re answering all day and will fit you in.', extra: 'No fee for weather changes.' },
      ai: { q: 'Is Sample Salon open Sundays?', wrong: 'Yes. Sample Salon is open Sundays 10 to 4, according to Yelp.', fixT: 'Wrong hours on Yelp', fixP: 'They’re closed Sundays. We fixed it on Yelp.', q2: 'Where can I get color Saturday near Eatonton?', right: 'Sample Salon is open Saturday 9 to 5. 478-555-0142.' }
    })
  },
  restaurants: {
    plural: 'restaurants and shops', short: 'Max answers in the Friday rush, takes catering requests and questions, and sends them to your phone.', chips: true, type: 'Restaurant or shop',
    cards: tradeCards({
      biz: 'Sample Kitchen', owner: 'Sam', callTime: 'Fri 7:05 PM',
      problem: 'Do you cater? We need lunch for forty on Tuesday.',
      priceLabel: 'Ask for a ballpark', priceQ: 'Roughly what does that cost?', priceA: 'Catering for forty runs $14 to $18 a person. Sam can call you tomorrow at 10 to set the menu. Want that time?', yes: '10 is perfect.',
      job: ['Office lunch for 40', 'Call back tomorrow 10:00 AM · Tuesday order'], person: ['Office lunch for 40', 'Wants to talk menu. Call back tomorrow.'],
      other: { ask: 'Do y’all do wedding cakes?', what: 'cakes', name: 'Oconee Bakery', dist: 'two blocks over', back: 'A rehearsal dinner for 30. They sent the caller to you.' },
      check: { q: 'did the catering order go the way you wanted?', bad: 'the order came out short.' }, checkWhy: 'A few days after a catering order, Max calls: how did it go? A yes becomes the review ask. A no reaches you first, before it becomes a review.',
      busy: 'Sam’s on the line for lunch.', cbWhy: 'Wedding cake',
      storm: { title: 'Closing at 8 tonight', post: 'Storms are on the way, so we’re closing at 8. Delivery runs until 7:30. Stay dry.', extra: 'Regular hours tomorrow.' },
      ai: { q: 'Is Sample Kitchen open Mondays?', wrong: 'No. Sample Kitchen is closed Mondays, according to Tripadvisor.', fixT: 'Wrong hours on Tripadvisor', fixP: 'They’re open Mondays now. We fixed it on Tripadvisor.', q2: 'Where can I get lunch Monday in Eatonton?', right: 'Sample Kitchen is open Monday 11 to 9. 478-555-0142.' }
    })
  },
  dental: {
    plural: 'dental practices', short: 'Max answers when the front desk can’t, takes the name, number and what they need, nothing more, and sends it to your phone.', chips: false, type: 'Medical, dental or vet',
    cards: [
      { key: 'max', title: 'Max answers', tag: TAG.every, call: true,
        why: 'Max takes the name, number and what they need, nothing more, and never talks fees, treatment or insurance.',
        intro: [['sys', 'Sun 9:40 PM · call to Sample Family Dental'], ['out', 'Thanks for calling Sample Family Dental. I’m Max, an automated assistant, and this call may be recorded. How can I help?'], ['in', 'I cracked a tooth at dinner. Can I get in tomorrow?']],
        choices: [
          { label: 'Ask for the first opening', then: [['in', 'Can I get the first opening?'], ['out', 'I’ll mark this urgent. The front desk will call you at 8, when the office opens. What’s the best number?'], ['in', '478-555-0142.'], ['note', 'On the front desk’s phone · urgent', 'Cracked tooth · first opening', 'Called 9:40 PM · 478-555-0142', 'hot']] },
          { label: 'Ask for a person', then: [['in', 'Can I talk to someone now?'], ['out', 'The office is closed, so I’m trying the doctor’s on-call cell now, the way the practice asked.'], ['sys', 'Ringing the on-call cell · 9:41 PM'], ['note', 'On the on-call phone · urgent', 'Cracked tooth', 'Called 9:40 PM · 478-555-0142', 'hot']] }
        ] },
      { key: 'guard', title: 'Compliance Guard', tag: TAG.every,
        why: 'Every word is checked before it goes out in your name. Replies never confirm that someone is a patient.',
        intro: [['sys', 'New 5-star review from Dana R.'], ['draft', 'Thanks, Dana. So glad your crown went well. See you at your cleaning in March.']],
        choices: [{ label: 'Check it with Compliance Guard', then: [['note', 'Compliance Guard · stopped', 'This says Dana is a patient', '“Your crown” and “your cleaning” say she was treated here.', 'hot'], ['draft', 'Thank you for the kind words, Dana. We’re glad to hear it.'], ['sys', 'Ready for your OK']] }] },
      { key: 'storm', title: 'Storm Desk', tag: TAG.growth, why: WHY.storm,
        intro: [['sys', 'Severe thunderstorm warning · Putnam County · 3:12 PM'], ['note', 'Post · waiting for your OK', 'Storms tonight', 'If we open late tomorrow because of the weather, we’ll post it here first.']],
        choices: [
          { label: 'Approve', then: [['sys', 'You tapped Approve · 3:13 PM'], ['note', 'Sample Family Dental on Google · just now', 'Storms tonight', 'Live where patients look first.', 'ok']] },
          { label: 'Edit first', then: [['sys', 'You added one line'], ['note', 'Post · edited', 'Storms tonight', 'If we open late tomorrow because of the weather, we’ll post it here first. Call us to move a visit.'], ['sys', 'Posted to your Google profile · 3:15 PM']] }
        ] }
    ]
  },
  insurance: {
    modes: ['Independent', 'With a carrier'], plural: 'insurance agencies', short: 'Max takes messages after hours and never talks policies, rates or claims. Compliance Guard checks every word we write for you.', chips: false, type: 'Insurance agency',
    cards: [
      { key: 'max', title: 'Max takes the message', tag: TAG.every, call: true,
        why: 'Max takes a name, number and a good time to call back, and never talks policies, rates or claims.',
        intro: [['sys', 'Tue 7:12 PM · call to Sample Agency'], ['out', 'Thanks for calling Sample Agency. I’m Max, an automated assistant, and this call may be recorded. How can I help?'], ['in', 'I’m adding my 16-year-old as a driver. Can someone call me?']],
        choices: [
          { label: 'Ask about the cost', then: [['in', 'How much will that add to my rate?'], ['out', 'I can’t talk about rates or coverage, but I’ll have Priya call you. Is tomorrow after 10 good?'], ['in', 'After 10 works.'], ['note', 'On Priya’s phone', 'Dana Whitfield · new driver', 'Call back tomorrow after 10 · 478-555-0142', 'ok']] },
          { label: 'Ask for a person', then: [['in', 'Can I talk to someone tonight?'], ['out', 'The office is closed, so I’ll take a message. Priya will call you first thing tomorrow.'], ['note', 'On Priya’s phone', 'Dana Whitfield · new driver', 'Call back first thing · 478-555-0142', 'ok']] }
        ] },
      { key: 'guard', title: 'Compliance Guard', tag: TAG.every,
        why: 'Every reply and post is checked before it goes out in your name. Nothing says who is a client, and nothing quotes a rate.',
        intro: [['sys', 'New 5-star review from Dana W.'], ['draft', 'Thanks, Dana. Glad we saved you $400 on your auto policy.']],
        choices: [{ label: 'Check it with Compliance Guard', then: [['note', 'Compliance Guard · stopped', 'Names her policy and a savings claim', '“Your auto policy” says she’s a client. “Saved you $400” is a rate claim.', 'hot'], ['draft', 'Thank you for the kind words, Dana. We’re glad we could help.'], ['sys', 'Ready for your OK']] }] },
      { key: 'radar', title: 'Rate-Shock Radar', tag: TAG.every,
        why: 'Every week we read new public reviews for agencies in your town. When rate complaints climb, you hear first, with a reply and a post ready.',
        intro: [['sys', 'Weekly check · agencies in Eatonton'], ['note', 'Rate-Shock Radar', 'Rate complaints doubled this week', '12 new reviews in town mention rate increases.', 'hot']],
        choices: [{ label: 'See what’s ready', then: [['note', 'Ready for your OK', 'A calm reply for rate reviews', 'Already through Compliance Guard.', 'ok'], ['note', 'Ready for your OK', 'Post: what moves rates', 'Educational. No numbers, no quotes.', 'ok']] }] },
      { key: 'storm', title: 'Storm Desk', tag: TAG.growth, why: WHY.storm,
        intro: [['sys', 'Severe thunderstorm warning · Putnam County · 3:12 PM'], ['note', 'Post · waiting for your OK', 'Storm tonight in Putnam County', 'Stay safe tonight. Once it passes, photos of any damage are a good first step. Call us in the morning with questions.']],
        choices: [
          { label: 'Approve', then: [['sys', 'Compliance Guard passed it'], ['note', 'Sample Agency on Google · just now', 'Storm tonight in Putnam County', 'Live where people search tonight.', 'ok']] },
          { label: 'Edit first', then: [['sys', 'You added one line'], ['note', 'Post · edited', 'Storm tonight in Putnam County', 'Stay safe tonight. Once it passes, photos of any damage are a good first step. Our office opens at 8.'], ['sys', 'Compliance Guard passed it · posted 3:15 PM']] }
        ],
        carrier: { why: 'When a weather warning hits your county, a storm-day post is drafted that minute. If your company approves posts first, it goes to them before it goes live.',
          choices: [
            { label: 'Approve', then: [['sys', 'Compliance Guard passed it'], ['note', 'Sent to your company for approval', 'Storm tonight in Putnam County', 'Your compliance contact gets it with your OK already on it.', 'ok'], ['sys', 'Approved by your company · posted 4:40 PM']] },
            { label: 'Edit first', then: [['sys', 'You added one line'], ['note', 'Post · edited', 'Storm tonight in Putnam County', 'Stay safe tonight. Once it passes, photos of any damage are a good first step. Our office opens at 8.'], ['sys', 'Compliance Guard passed it · sent to your company for approval']] }
          ] } },
      { key: 'ai', title: 'What assistants say about you', tag: TAG.growth, why: WHY.ai,
        intro: [['sys', 'A customer asks an answer assistant'], ['in', 'What’s the number for Sample Agency in Eatonton?'], ['ai', '478-555-0100, according to Yelp.']],
        choices: [{ label: 'Run this month’s check', then: [['note', 'This month’s check', 'Wrong phone on Yelp', 'That’s the old number. We fixed it on Yelp.', 'hot'], ['in', 'Who’s an insurance agent in Eatonton?'], ['ai', 'Sample Agency, 478-555-0142.']] }],
        carrier: { why: 'Customers ask answer assistants who to call. Once a month we ask them about you. What we can fix, we fix. What your company controls, we send you to pass along.',
          choices: [{ label: 'Run this month’s check', then: [['note', 'This month’s check', 'Wrong phone on Yelp', 'That listing is managed by your company. We sent you the fix to pass along.', 'hot'], ['sys', 'You forwarded it · fixed the next week'], ['in', 'Who’s an insurance agent in Eatonton?'], ['ai', 'Sample Agency, 478-555-0142.']] }] } }
    ]
  }
};

// Each folded section on a phone: a one-line summary under its heading.
export const FOLDS = {
  index: {
    try: 'Our own line. Call it and test him.',
    day: 'What happens at 2 AM, 7 AM and 4:45 PM while you work.',
    only: 'The cards above, written out in full, plus what you can add.',
    what: 'Reviews, your Google profile, posts and follow-ups, in detail.',
    all: 'Everything that comes with every plan, in one list.',
    audit: 'What the free audit covers, with a sample report.',
    worth: 'Put in what one job is worth and see what covers a month.',
    compare: 'How we differ from software you have to run yourself.',
    rules: 'No fake reviews, every customer asked, you approve what matters.',
    regulated: 'How insurance agencies and practices use us safely.',
    'addons-all': 'Google Ads, a new website, more Max minutes and more.',
    faq: 'Contracts, cancelling, who you’re dealing with, and more.'
  },
  trade: {
    calls: 'How calls, follow-ups and reviews work for a business like yours.',
    only: 'The cards above, written out in full.',
    math: 'Put in one job and see how many months it covers.',
    rules: 'No fake reviews, every customer asked, you approve what matters.',
    questions: 'Answers to what owners ask first.'
  },
  dental: {
    calls: 'How Max answers, and what reaches the front desk.',
    math: 'Put in one new patient and see how many months it covers.',
    rules: 'No fake reviews, replies that protect privacy, you approve what matters.',
    questions: 'Answers to what practice owners ask first.'
  },
  insurance: {
    guard: 'Write a reply and watch Compliance Guard check it.',
    radar: 'A heads-up when rate complaints start climbing in your town.',
    max: 'How Max takes messages after hours, and what he never discusses.',
    posts: 'Educational posts you approve, plus your profile and monthly page.',
    record: 'Every public review, reply and post, kept on file.',
    privacy: 'Nothing private comes in, and replies say nothing private.',
    questions: 'Answers to what agency owners ask first.'
  }
};
