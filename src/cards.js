// Every card the app shows, on both apps (Build Brief 7, Part 3). The web app (apppage.js) marks each card's outer
// element with data-card="<id>"; the iPhone app (GatesHQ/alwaysopen-ios) draws the same card as `struct <ios>: View`.
// test/cards.test.js fails when the web app renders a data-card that is not listed here, and when an iPhone struct named
// here is missing or does not carry the card's words. wall: the website's "Real screens" frame (public/index.html
// data-w) this card is the picture of; words: what both apps must say, read from that frame.
export const CARDS = [
  { id: 'storm', screen: 'today', state: ['storm'], ios: 'StormCard', wall: 'storm', words: ['FLOOD WARNING', 'YOUR GOOGLE POST', 'Edit first', 'Storm Desk is watching'] },
  { id: 'rivals', screen: 'money', state: ['rivals', 'map'], ios: 'RivalBoard', wall: 'rivals', words: ['YOU’RE #', 'the leader', 'To be #1', 'Check now'] },
  { id: 'clockcard', screen: 'today', state: ['clock', 'live'], ios: 'ClockCard', wall: 'clock', words: ['clock', 'on a call now', 'caught closed'] },
  { id: 'timecard', screen: 'max', state: ['timecard'], ios: 'TimecardCard', wall: 'timecard', words: ['timecard', 'Example'] },
  { id: 'radar', screen: 'money', state: ['radar'], ios: 'RadarCard', wall: 'radar', words: ['RATES RISING', 'Rate-Shock Radar is watching', 'Edit first'] },
  { id: 'guard', screen: 'today', state: ['items'], ios: 'GuardChecks', wall: 'guard', words: ['COMPLIANCE GUARD', 'Change the words'] },
  { id: 'item', screen: 'today', state: ['items'], ios: 'ItemCard', words: ['Approve'] },
  { id: 'call', screen: 'today', state: ['calls'], ios: 'CallCard', words: [] },
  { id: 'live', screen: 'today', state: ['live'], ios: 'LiveCallCard', words: [] },
  { id: 'monthnow', screen: 'today', state: ['monthNow'], ios: 'MonthNowCard', words: [] },
  { id: 'money', screen: 'money', state: ['money'], ios: 'MoneyCard', words: [] },
  { id: 'map', screen: 'customers', state: ['map'], ios: 'LiveMapCard', words: [] }
];
export const CARD_IDS = CARDS.map(c => c.id);
export const WALL = Object.fromEntries(CARDS.filter(c => c.wall).map(c => [c.wall, c]));
