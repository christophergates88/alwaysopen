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

// "$149", "$59", "$29"
export const dollars = c => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: (c % 100) ? 2 : 0 });
export const perMinute = () => 'about ' + Math.round(MAX.moreCents / MAX.moreMinutes) + ' cents a minute';

// What Max says about prices and plans on Always Open's own line. Synced into its voice_lines row by the cron, so
// his copy can never drift from this file again.
export function ownLineFacts() {
  const p = PLANS;
  return {
    prices: 'Starter is ' + dollars(p.Starter.cents) + ' a month, Growth is ' + dollars(p.Growth.cents) + ' a month, and Pro is ' + dollars(p.Pro.cents) + ' a month, about $' + p.Starter.perDay + ', $' + p.Growth.perDay + ' and $' + p.Pro.perDay + ' a day. There is no setup fee and no contract; it is ' + PROMISES.contract + ', and if the first month isn\'t worth it, it is refunded. ' +
      'Max, this phone assistant, comes with every plan with ' + MAX.includedMinutes + ' minutes a month; ' + MAX.moreMinutes + ' more minutes are ' + dollars(MAX.moreCents) + ' a month, ' + perMinute() + ', and past their minutes it is ' + MAX.overCentsPerMinute + ' cents a minute. The free audit costs nothing.',
    plans: 'Every plan, Starter included, has a booking and quote page customers can use any hour. Growth adds review requests after every job, posts from their photos, matching listings, every lead logged, and competitor watch. Pro adds their own business number with missed-call text-back and reminders for quotes, appointments and invoices; texting starts once carriers approve the number, ' + PROMISES.textingApproval + '. A client cancels from the app, any month, with no fee; ' + PROMISES.support + ' from our team can help with that too.'
  };
}
