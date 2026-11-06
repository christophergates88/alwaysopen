// Every Always Open alert to Christopher in plain English: what happened, and exactly what to do. No cloudflare imports,
// so the morning push, the money watch and tests can all use it.
import { neonEmail } from './neonmail.js';
const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const scrub = s => one(s)
  .replace(/\b(sk|rk|pk|whsec|xoxb|xoxp|ghp|AKIA)[_-][A-Za-z0-9_-]{8,}/g, '[key]')
  .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '[key]')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]')
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4}\b/g, '[phone]');

// ---------- every alert in plain English ----------
// Each alert type says what happened in everyday words and exactly what to do. When only Christopher can do it, the
// step is his; when it's a code or setup fix, the step is a line to send Claude. Nothing here has keys or customer details.
const JOBS = { radar: 'Rate-Shock Radar', rivals: 'Competitor Watch', board: 'the Monday checklist', silence: 'the quiet-line check', maxweek: 'Max\'s weekly grades',
  storm: 'Storm Desk', numbers: 'the numbers page', app: 'the client app', invoices: 'invoice reminders', map: 'the map', business: 'jobs and quotes', referrals: 'referrals',
  callbacks: 'callback reminders', checkins: 'three-day check-in calls', 'calls-out': 'Max\'s outbound calls', fullmax: 'Full Max', 'texting-registration': 'texting registration',
  funding: 'the money watch', 'launch-watch': 'the Google and Meta approval watch', 'google-profile': 'Google profile posting', 'max-line-setup': 'new client phone lines',
  'texts-for-owners': 'appointment texts', 'assistants-check': 'the assistants check', 'monthly-report': 'the monthly report', 'fill-my-week': 'Fill my week',
  'google-connections': 'the Google connection check', 'lead-follow-ups': 'lead follow-up emails', 'phone-push': 'phone alerts', voicemail: 'voicemail', 'missed-texts': 'missed-call texts',
  'test-call': 'the 4 AM test call', checks: 'the promise checks', 'mailed-letters': 'mailed letters', 'audit-retry': 'free audit retries', 'slow-checks': 'the hourly checks',
  backup: 'the weekly backup', morning: 'the 7 AM all-clear', minutes: 'Max\'s minutes', social: 'Always Open\'s Facebook posts', 'photo-posts': 'photo posts',
  'our-review-asks': 'review asks', 'hear-max': 'Hear Max', voice: 'Max\'s phone line', 'season-posts': 'the insurance season posts', 'google-queue': 'the Google posting reminder', demo: 'the demo account\'s nightly refresh' };
const claude = s => 'Tell Claude: "' + s + '"';
const HEALTH = {
  d1: ['Always Open\'s database stopped answering', 'Nothing can be saved or loaded until it\'s back.', 'Nothing yet. Cloudflare usually fixes it within minutes. If you get this again in an hour, ' + claude('Always Open\'s database is down.'), true],
  email: ['Alert emails can\'t be sent', 'Website requests and alerts aren\'t reaching your inbox.', claude('Always Open email is broken, fix it.'), true],
  texting: ['Texting is turned off', 'The Twilio login is missing, so no texts go out.', claude('the Twilio login is missing on Always Open.'), true],
  'max-line': ['Max\'s phone line is missing a setting', 'Calls may not reach Max.', claude('Max\'s line setup is broken, fix it now.'), true],
  stripe: ['Payments can\'t be checked', 'Stripe isn\'t answering, so signups and billing may fail.', claude('Stripe stopped answering Always Open.'), false],
  'apple-push': ['Owners aren\'t getting iPhone alerts', 'Apple turned down our push key.', claude('Apple push for Always Open is broken.'), false],
  ntfy: ['Your phone alerts aren\'t getting through', 'The push service is refusing our alerts.', 'Make a new access token in the ntfy app (Account, Access tokens), then on your Mac tap "Set ntfy token".', false],
  'twilio-numbers': ['Callers can\'t reach Max on a number', 'A Max number is pointed somewhere else or isn\'t in the account.', claude('a Max number isn\'t answering, fix it now.'), true],
  backup: ['The weekly backup didn\'t happen', 'There\'s no fresh copy of the data.', claude('the Always Open backup didn\'t run.'), false],
  'google-connections': ['A client\'s Google connection is broken', 'Their reviews or calendar stopped syncing.', 'Nothing yet. The owner has a Reconnect button in their app. If it\'s still broken in 2 days, call them.', false],
  cron: ['Always Open\'s background jobs stopped', 'Reminders, checks and follow-ups aren\'t running.', claude('Always Open\'s background jobs stopped running.'), true]
};
const KINDS = [
  [/^stripe-dispute/, () => ['A client disputed a charge', 'Stripe opened a dispute.', 'Open Stripe, Disputes, and answer it before the deadline.']],
  [/^stripe-checkout/, () => ['Someone couldn\'t finish signing up', 'Checkout failed.', claude('signup checkout is failing.')]],
  [/^stripe/, () => ['A payment update from Stripe failed', 'A billing change may not have been saved.', claude('a Stripe update failed, check it.')]],
  [/^max-backup/, () => ['Max switched to his backup brain', 'Calls are answered, but he sounds less natural.', claude('Max is on his backup model, why?')]],
  [/^max-call/, () => ['A call to Max went wrong', 'One call didn\'t go through cleanly.', claude('a Max call failed, check it.')]],
  [/^voicemail/, () => ['A caller got voicemail instead of Max', 'Max couldn\'t take the call, so the backup did.', claude('a caller hit voicemail, check why.')]],
  [/^(test-call|drill)/, () => ['The 4 AM test call to Max failed', 'The nightly test of the phone line didn\'t pass.', claude('the 4 AM test call failed.')]],
  [/^hear-max/, () => ['The Hear Max sample didn\'t record', 'The website\'s sample call has no recording.', 'Open the Hear Max page and call again.']],
  [/^mail/, () => ['An email couldn\'t be sent', 'One email didn\'t go out.', claude('Always Open emails are failing.')]],
  [/^text-ceiling/, () => ['Texting hit its daily safety limit', 'No more texts go out today.', 'Nothing, unless it\'s a real busy day. Then ' + claude('raise the texting limit.')]],
  [/^text-delivery/, () => ['Texts aren\'t being delivered', 'Carriers are blocking some of our texts.', claude('texts aren\'t delivering, fix it.')]],
  [/^line-cap/, () => ['A client\'s line hit its call limit', 'Extra calls go to voicemail.', claude('a Max line hit its limit.')]],
  [/^deploy/, () => ['The latest update didn\'t go live', 'The site is still on the last good version.', claude('the Always Open deploy failed.')]],
  [/^quiet-line/, () => ['A client\'s phone line went quiet', 'No calls this week on a line that usually rings.', 'Call the owner and ask if they turned off call forwarding.']],
  [/^quiet-profile/, () => ['A client\'s Google reviews stopped coming in', 'No new reviews seen in two weeks.', 'Ask the owner to tap Reconnect Google in their app.']],
  [/^google-connection/, () => ['A client\'s Google connection broke', 'The owner was asked to reconnect.', 'Nothing yet. If it\'s still broken in 2 days, call them.']],
  [/^minutes-invoice/, () => ['Extra minutes couldn\'t be billed', 'A client used more minutes than their plan, and the charge didn\'t go on their bill.', 'Bill the extra minutes by hand in Stripe (details below).']],
  [/^referral-credit/, () => ['A referral discount didn\'t apply', 'It will try again on its own.', 'Nothing yet. If you get this again tomorrow, ' + claude('a referral credit keeps failing.')]],
  [/^social/, () => ['Today\'s Always Open Facebook post didn\'t go up', 'The Page connection may have dropped.', 'Reconnect the Facebook Page from the Monday checklist page.']],
  [/^photo-post/, () => ['A client\'s photo post couldn\'t be written', 'Their photo is saved; the post wasn\'t made.', claude('a photo post failed, check it.')]],
  [/^spend/, () => ['Spending spike', 'Far more was used in a day than normal.', 'Check Twilio usage. If it isn\'t a busy day, ' + claude('spending spiked, check it.')]],
  [/^mail-records/, () => ['Emails may be landing in spam', 'Mail records are missing for our domain.', claude('add the missing mail records.')]],
  [/^crash/, k => ['Part of the website crashed', 'The ' + k.slice(6) + ' page threw an error.', claude('the ' + k.slice(6) + ' page is crashing.')]],
  [/^funding|^check-run/, () => ['A paid service needs attention', 'See below.', claude('check the Always Open money watch.')]]
];
export function explainAlert(type, detail) {
  const k = one(type);
  if (k.startsWith('health:')) {
    const h = HEALTH[k.slice(7)];
    if (h) return { title: h[0], what: h[1], doThis: h[2], urgent: !!h[3] };
  }
  if (k.startsWith('cron:')) {
    const job = JOBS[k.slice(5)] || k.slice(5);
    return { title: 'A background job crashed: ' + job, what: 'It will try again in 10 minutes.', doThis: 'Nothing if this is the only one. If it keeps coming, ' + claude(job + ' keeps crashing.'), urgent: false };
  }
  for (const [re, f] of KINDS) if (re.test(k)) { const r = f(k); return { title: r[0], what: r[1], doThis: r[2], urgent: false }; }
  return { title: 'Something in Always Open needs a look', what: scrub(detail).slice(0, 140), doThis: claude('check the "' + k + '" alert.'), urgent: false };
}
const etWhen = t => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function alertEmail(ex, o) {
  const lines = [{ k: 'What happened', v: ex.what, bad: true }];
  if (o.detail && o.detail !== ex.what) lines.push({ k: 'Details', v: o.detail });
  if (o.who) lines.push({ k: 'Client', v: o.who });
  lines.push({ k: 'When', v: etWhen(o.at || Date.now()) });
  if (o.more) lines.push({ k: 'Repeats', v: o.more });
  return neonEmail({ tone: 'bad', sign: ex.urgent ? 'BROKEN' : '1 THING', title: ex.title, who: 'alerts', doThis: [ex.doThis], lines, preheader: ex.doThis });
}

