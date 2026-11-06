// Every card the app shows, on both apps (Build Brief 7, Part 3). The web app (apppage.js) marks each card's outer
// element with data-card="<id>"; the iPhone app (GatesHQ/alwaysopen-ios) draws the same card as `struct <ios>: View`.
// test/cards.test.js fails when the web app renders a data-card that is not listed here, and when an iPhone struct named
// here is missing or does not carry the card's words. wall: the website's "Real screens" frame (public/index.html
// data-w) this card is the picture of; head: the frame's headline words, which the web card must show on the demo
// (tools/wallcheck.mjs); words: what both apps must say, read from that frame. screen: where the card shows when it has
// something for the owner; rest: where its quiet (resting) version shows.
export const CARDS = [
  { id: 'storm', screen: 'today', rest: 'money', state: ['storm'], ios: 'StormCard', wall: 'storm', head: 'FLOOD WARNING', words: ['Edit first', 'Storm Desk is watching', 'Your post is written and waiting'] },
  { id: 'rivals', screen: 'money', state: ['rivals', 'map'], ios: 'RivalBoard', wall: 'rivals', head: 'YOU’RE', words: ['YOU’RE', 'the leader', 'To be #1', 'on rating', 'pace'] },
  { id: 'clockcard', screen: 'today', state: ['clock', 'live'], ios: 'ClockCard', wall: 'clock', head: 'caught closed', words: ['on a call now', 'caught closed', 'on the clock', 'to you'] },
  { id: 'timecard', screen: 'max', state: ['timecard'], ios: 'TimecardCard', wall: 'timecard', head: 'timecard', words: ['timecard', 'Example', 'What did the after-hours calls come from?'] },
  { id: 'radar', screen: 'today', rest: 'money', state: ['radar'], ios: 'RadarCard', wall: 'radar', head: 'RATES RISING', words: ['RATES RISING', 'Rate-Shock Radar is watching', 'Edit first', 'Unhappy reviews about rate increases are piling up at agencies in your town this month.'] },
  { id: 'guard', screen: 'today', state: ['items'], ios: 'GuardChecks', wall: 'guard', head: 'COMPLIANCE GUARD', words: ['COMPLIANCE GUARD', 'checked against your approved wording'] },
  { id: 'item', screen: 'today', state: ['items'], ios: 'ItemCard', words: ['Approve', 'Change the words'] },
  { id: 'call', screen: 'today', state: ['calls'], ios: 'CallCard', words: [] },
  { id: 'live', screen: 'today', state: ['live'], ios: 'LiveCallCard', words: [] },
  { id: 'monthnow', screen: 'today', state: ['monthNow'], ios: 'MonthNowCard', words: [] },
  { id: 'money', screen: 'money', state: ['money'], ios: 'MoneyCard', words: [] },
  { id: 'map', screen: 'customers', state: ['map'], ios: 'LiveMapCard', words: [] }
];
export const CARD_IDS = CARDS.map(c => c.id);
export const WALL = Object.fromEntries(CARDS.filter(c => c.wall).map(c => [c.wall, c]));
