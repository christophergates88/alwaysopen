// Always Open's prices and promises, in one place (Brief 2, Part 5). Billing, the app, Max's own line, the welcome letter,
// the social writer and the site generators read these; test/facts.test.js fails when a page or a file says otherwise.
// On Nov 4, 2026 Max quoted $149 for extra minutes after the site said $59, because his line kept its own copy.

export const PLANS = {
  Starter: { cents: 14900, perDay: 5, blurb: 'Every review answered, your Google profile kept current, Max answering your calls (300 minutes a month), a booking and quote page, a monthly report and your own app.' },
  Growth: { cents: 29900, perDay: 10, blurb: 'Starter, plus review requests after every job, posts from your photos, every lead logged, competitor watch and Storm Desk.' },
  Pro: { cents: 49900, perDay: 16, blurb: 'Growth, plus your own business number, missed-call text-back, and reminders for quotes, appointments and invoices.' }
};
export const MAX = { includedMinutes: 300, moreMinutes: 300, moreCents: 5900, overCentsPerMinute: 25, blurb: '300 more minutes of Max a month, for when your phone rings more than the 300 that come with every plan.' };
export const ADDONS = {
  'More Max minutes': { cents: MAX.moreCents },
  'Google Ads management': { cents: 29900, pctOfSpend: 15 },
  'A new website': { onceCents: 79900, cents: 2900 },
  'Website chat': { cents: 4900 },
  'Help-wanted posts': { cents: 9900 },
  'Review alerts beyond Google': { cents: 4900 }
};
export const PROMISES = { refundDays: 30, setupFeeCents: 0, contract: 'month to month', reportDay: 2, support: 'Katie', supportReply: 'one business day', textingApproval: 'about two weeks', setup: 'about a week' };

// Who Always Open is, for "who's Katie?" / "what's your team?" / "where are you based?" (Brief 3, Part 8b). Max had no
// answer on Christopher's Nov 5 call and deferred to the callback twice. Christopher approved the wording and his name.
export const TEAM = { place: 'central Georgia, near Lake Oconee', founder: 'Christopher Gates', support: PROMISES.support, size: 'a small team' };   // Christopher said on Nov 5: have Max say he runs it
// What Always Open does, as Max says it on its own line, day to day first and the monthly page last (Part 8c: the old
// text told him to lead with the report, so "tell me about Always Open" got the report and not "you see every call live").
export const SERVICES_DAY_FIRST = 'Day to day: every missed call is answered by a phone assistant like me, and the owner gets the caller\'s name, number and what they need on their phone right away, in the Always Open app. When a caller asks something only the owner knows (can someone come today, a price for their job), the assistant texts the owner the question while the caller is still on the line and passes the answer on in the same call; it is called Shoulder Tap, and insurance, medical and legal offices get a message and a call back as before. Every Google review is answered, the Google profile is kept current, and quotes and invoices that went quiet get followed up. Customers can book or ask for a quote on a page any hour. Review replies and posts wait for the owner\'s OK in the app. There is also one page that shows what it all did and what it was worth: it is live in the app all month, updating as things happen, and on the 2nd a copy of last month\'s is sent to the owner. It is not a once-a-month report; never call it that. Say the day-to-day part first, in your own words, and the page last. Owners are usually already out working, so never say they can "get back to work." It works on the number they already have, through call forwarding.';
// The description as it was before Part 8c, report first, with two retired claims corrected (it said "every Google and
// Facebook review" and "an app where the owner approves anything that goes out in their name"; test/wording.test.js
// retired both, but that test reads files, and this text lived only in the database). The baseline for 8c's blind test.
export const SERVICES_REPORT_FIRST = 'We handle the stuff that keeps a business open around the clock, like answering reviews and missed calls and following up with customers, so the owner can stay on the job they\'re already doing, and on the 2nd of every month they get one page that shows what it all did and what it was worth; say that much first, in your own words. Owners are usually already out working, so never say they can "get back to work." If they want detail: every Google review answered, the Google profile kept current, missed calls answered by a phone assistant like me, follow-ups on quotes and invoices, a one-page monthly report, and an app where the owner approves review replies and posts. It works on the number they already have, through call forwarding.';
// Part 8c lost its text-only blind test 8 to 9, but on Christopher's own call (Nov 5, 2026, 5:57 PM) the report-first
// opening made him ask twice whether he'd see anything before the 2nd of the month. Real callers win: day-to-day first.
export const SERVICES_DAY_FIRST_LIVE = true;

// "$149", "$59", "$29"
export const dollars = c => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: (c % 100) ? 2 : 0 });
export const perMinute = () => 'about ' + Math.round(MAX.moreCents / MAX.moreMinutes) + ' cents a minute';

// What Max says about prices and plans on Always Open's own line. Synced into its voice_lines row by the cron, so
// his copy can never drift from this file again.
export function ownLineFacts() {
  const p = PLANS;
  return {
    prices: 'Starter is ' + dollars(p.Starter.cents) + ' a month, Growth is ' + dollars(p.Growth.cents) + ' a month, and Pro is ' + dollars(p.Pro.cents) + ' a month, about $' + p.Starter.perDay + ', $' + p.Growth.perDay + ' and $' + p.Pro.perDay + ' a day. There is no setup fee and no contract; it is ' + PROMISES.contract + ', and if the first month isn\'t worth it, it is refunded. ' +
      'Max, this phone assistant (you: say "I come with every plan"), comes with every plan with ' + MAX.includedMinutes + ' minutes a month; ' + MAX.moreMinutes + ' more minutes are ' + dollars(MAX.moreCents) + ' a month, ' + perMinute() + ', and past their minutes it is ' + MAX.overCentsPerMinute + ' cents a minute. The free audit costs nothing.',
    about: 'Always Open is ' + TEAM.size + ' based in ' + TEAM.place + ', run by ' + TEAM.founder + '. ' + TEAM.support + ' handles client support and calls people back within ' + PROMISES.supportReply + '; she can tell them more about the team. Max, this phone assistant, answers for every client and for Always Open itself. Nothing else about anyone on the team is shared.',
    services: SERVICES_DAY_FIRST_LIVE ? SERVICES_DAY_FIRST : SERVICES_REPORT_FIRST,
    // Brief 5 (Nov 5, 2026): after the S.I. line, straight to the caller ("Sorry, legal stuff" sounded like a shrug), and
    // the check-in when a caller goes quiet asks, it doesn't tease ("See? Told you I was good. Left you speechless.").
    greeting2: 'What can I do for you?',
    nudge: 'Still there? I can tell you what we do, what it costs, or how it works on your number.',
    plans: 'Every plan, Starter included, has a booking and quote page customers can use any hour. Growth adds review requests after every job, posts from their photos, matching listings, every lead logged, and competitor watch. Pro adds their own business number with missed-call text-back and reminders for quotes, appointments and invoices; texting starts once carriers approve the number, ' + PROMISES.textingApproval + '. A client cancels from the app, any month, with no fee; ' + PROMISES.support + ' from our team can help with that too.'
  };
}
