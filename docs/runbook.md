# Always Open runbook

Written for a Christopher who has been away from this for three months. Plain words, one page. Everything here is
done from the Mac in the GatesHQ folder, the Cloudflare dashboard, or the GitHub Actions tab of
`christophergates88/alwaysopen`. Never paste a secret into a chat, a commit or an issue.

## What runs where

| Thing | Where | What it does |
| --- | --- | --- |
| The Worker | Cloudflare, `alwaysopenoffice.com` | The website, the owner app (`/app/<code>`), Max's webhooks, every check and cron |
| The database | Cloudflare D1, `alwaysopen` | Everything. 30 days of point-in-time restore built in |
| Max's calls | Twilio ConversationRelay, one CallRoom (Durable Object) per live call | Speech in and out; Claude thinks, Workers AI is the backup |
| The iPhone app | App Store (Always Open Office), source in `alwaysopen-ios` | Talks to the Worker with the owner's link code |
| Deploys | GitHub Actions on every push to `main` | Tests, phone check, deploy, live check, rollback, alert-email check |
| Alerts | ntfy push to your phone, and email for problems | `src/ops.js` |

## Where every secret lives (names, never values)

Set on the Worker with `wrangler secret put <NAME>` from the Mac, or with the `Set ... key.command` files in GatesHQ.
`LEADS_KEY` (the ops key: /health detail, /ops routes, the deploy's checks; also a GitHub Actions secret), `VOICE_KEY`
(Max's webhook addresses), `NTFY_URL` (your phone), `IP_SALT`, `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SID`, `NTFY_TOKEN` (the paid ntfy account's access token, set with `Set ntfy token.command`), `STRIPE_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `PLACES_KEY`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `META_*`. GitHub holds
`CLOUDFLARE_API_TOKEN` and `LEADS_KEY`. Plain settings (towns, counties, renewals, the sending address) are in
`wrangler.toml`.

## The first thing to check when something is wrong

1. Open `https://alwaysopenoffice.com/health`. `ok` means the Worker, the database, Stripe, the keys and the
   10-minute cron are all fine. `not ok: ...` names what is not.
2. With the ops key: `curl -H "x-key: $LEADS_KEY" https://alwaysopenoffice.com/health` lists every check and the
   last run of every job.
3. The ops board (`/ops?t=...`, the link is in your morning HQ note) shows the same, plus the last errors.
4. Cloudflare dashboard, Workers and Pages, `alwaysopen`, Logs: live request logs if you need them.

## What each alert means and what to do first

| Alert | Means | First thing to check |
| --- | --- | --- |
| `health:cron` | The 10-minute checks stopped | Cloudflare dashboard: is the Worker deployed and the cron trigger present? Last deploy on GitHub |
| `health:d1` | The database did not answer | Cloudflare status page, then D1 in the dashboard |
| `health:stripe` | Stripe rejected the key or is down | Stripe dashboard, API keys |
| `health:email` | The email binding is missing | The deploy fell back to `wrangler.noemail.toml`; fix Email Routing and redeploy |
| `health:max-line` | A Max key is missing | `wrangler secret list`, set the missing one |
| `health:apple-push` | Owners are not getting pushes | Apple key in App Store Connect; `APNS_KEY`, `APNS_KEY_ID` |
| `health:ntfy` | Your phone pushes are not arriving, or ntfy turned down the account token | ntfy.sh status, the ntfy app on your phone; for the token, make a new one at ntfy.sh (Account, Access tokens) and run `Set ntfy token.command` |
| `health:twilio-numbers` | A live number points elsewhere and Twilio would not let the hourly check point it back (it fixes the usual case itself; the only alert loud at night) | Twilio console, Phone Numbers, Voice webhook; or `POST /ops/twilio-setup` with the key to repoint all of them |
| `health:google-connections` | A Google connection was refused | The owner has a reconnect card; if several at once, the Google Cloud consent screen is in Testing |
| `health:backup` | No backup in 8 days | `POST /ops/backup` with the key; check the email or the R2 bucket |
| `crash:<route>` | Something threw; the visitor saw a plain page | The Errors tab on the ops board; the route tells you which page |
| `cron:<job>` | A background job threw | The ops board's Worker jobs line shows the note |
| `max-call` | A Max call errored; the caller got the voicemail backup | Twilio console, Monitor, Calls, then the call in the owner's app |
| `voicemail`, `cron:voicemail` | A voicemail could not be delivered, or the sweep could not read Twilio | The ops board's Worker jobs line; the sweep tries each call three times |
| `cron:missed-texts` | The sweep for texts that missed the site could not read Twilio | Twilio status; it tries again in 10 minutes |
| `drill` | The 4 AM test call to Max failed twice | The call on the ops board (calls from the test number on Always Open's line); Claude's status; the voice log |
| `max-backup` | Claude failed two checks in a row, so every call is on the backup model | console.anthropic.com (credits, status); it switches back by itself when Claude answers |
| `line-cap:<client>` | 120 minutes in a day on one line | The calls in the owner's app: storm or real rush? Raise `DAY_MINUTE_CAP` in `src/minutes.js` if real |
| `quiet-line:<client>` | A busy line had no calls for a week | Twilio number webhook, then ask the owner about forwarding |
| `quiet-profile:<client>` | A profile's reviews stopped | The owner's reconnect card, then the profile's managers in Google |
| `deploy` | A deploy failed or rolled back | The Actions tab; the alert says which check failed |
| `stripe-webhook`, `stripe-checkout` | Stripe calls failing | Stripe dashboard, Webhooks, recent deliveries |
| `minutes-invoice` | An overage could not be billed | The business has no Stripe customer; bill by hand |
| `mail-send` | An email could not be sent | Email Routing in Cloudflare for `alwaysopenoffice.com` |
| `social` | Today’s Always Open Facebook post did not go up | The ops board line for Facebook; reconnect the Page from the board link if the token died; `POST /ops/social-post` with the key puts it up now |
| `hear-max` | The Hear Max call left no recording, or saving it failed | Open the Hear Max page from the ops board and call again |
| `photo-post` | A client’s photo could not be turned into a post after 3 tries | Open the photo link in the alert and write the post by hand in HQ |

The same problem alerts at most once every 3 hours, with a count of the ones held back. From 10 PM to 7 AM Eastern
every push arrives silently (no sound, no buzz) and the 7 AM push lists what came overnight; the email goes either way.
Loud at night only: a number that no longer reaches us (`health:twilio-numbers`) and Twilio about to run out of money.
A 7 AM push says "all good" every morning; if it does not arrive, that is itself the alarm, and the outside monitor
backs it up. Plain `/health` (what the outside monitor reads) only goes red for the site, the database, the keys, the
10-minute jobs and the phone numbers; `/health?all=1` shows everything, as the ops board does.

## When Max can't take a call

Every number's Twilio fallback is a voicemail served by Twilio itself (`twimlets.com`), so a caller can leave a message
even with Cloudflare completely down; it never rings the owner's cell. Our own code plays the same voicemail if it
fails mid-answer or Max's connection drops. When Twilio finishes a recording it tells `/voice/vm/<key>`, and every 10
minutes `src/voicemail.js` asks Twilio for calls to our numbers that never got a write-up. Each one reaches the owner
like a normal Max call, with the words of the voicemail; a caller who left nothing gets the missed-call text only if
the call was in the last 30 minutes. The recording is deleted from Twilio once its words are saved. You get one push
("N calls missed Max") whenever the sweep delivers something, which means the site or Max was down for a while.
The hourly check puts the voicemail fallback on any number that still has an old one, and points any number of ours
whose calls or texts point somewhere else back at Max (you get a quiet push saying so). To use a number for anything
else, take its line off the air first.

Texts are covered the same way: every 10 minutes `smsSweep` (src/sms.js) asks Twilio for texts to our numbers that
never reached the site and handles them as if they had just arrived (inbox, owner push, STOP). Automatic answers to
HELP or START are not sent that late.

## Checks and balances (src/checks.js)

Every 10 minutes, each at its own pace, with the open items in the 7 AM push:

- **Drafts waiting on an owner**: reminders at 1 day and 3 days (a review under 4 stars after 6 hours), by push, or by
  email to owners who signed up online and have no app. Clients with drafts older than 3 days are in the 7 AM push.
- **New clients never set up**: a line with no real call gets the forwarding steps on day 2 and day 5; you hear on day 7.
- **Client messages**: an automatic "Got it, Katie will reply by …", a push to you after 4 business hours unanswered,
  the 7 AM push after a business day. Answer in HQ so it shows in their app (an answer is any reply that isn't the
  automatic one).
- **Spending**: Claude use on calls, minutes and texts in the last 24 hours against a normal day; 3x is `spend:<kind>`.
  Texts also have a hard ceiling in `sms.js`: 60 automatic texts an hour per business, 400 in all (`text-ceiling`).
- **Paying and served** (daily): Stripe's status for every subscription. Canceled in Stripe but still on is turned off;
  paying but switched off, or unpaid for two weeks and still served, is a note for you. It also keeps the Stripe webhook
  listening for every event the site handles, including chargebacks (`stripe-dispute`, with the deadline and the
  client's history).
- **Delivery**: texts carriers stopped delivering (`text-delivery`, error 30007 is filtering) and the domain's SPF and
  DMARC records (`mail-records`).

## The 4 AM test call and the backup switch

Every night at 4 AM Eastern, `src/drill.js` calls Always Open's own line from a test number of ours (listed as a tester,
so the call is a test: no lead, no push) and judges Max's write-up: he answered, heard the caller, replied, and wrote
down what they wanted. A failure is tried again 15 minutes later; a second one is the `drill` alert, and the 7 AM push
says how the test went either way. The test number is bought once (about $1.15 a month), only after Christopher said
yes: `drill_meta` row `buy` = `approved`.

If Claude fails two of its checks in a row, every call goes to the backup model for two hours (`drill_meta`
`backup-until`), and Claude is checked every 10 minutes until it answers again, which switches it back.

## Hear Max, the money card and grade letters

- **Hear Max** (`src/hearmax.js`): the website plays one staged call. Open the Hear Max page from the ops board on your
  phone, type the number you will call from, tap Ready, and call (706) 460-2226 within 30 minutes. Max answers as the
  demo plumbing line and only that call is recorded; the MP3 is kept in D1 and Twilio's copy is deleted. A newer good
  call replaces it; "Take it down" on the same page hides the player. No customer call is ever recorded.
- **What Max caught** (`src/money.js`): after-hours calls that became leads × the owner's win rate × average job, the
  same figure in the app, the monthly report and the ops board. No average job, no dollars.
- **Review asks for Always Open** (`src/ourreviews.js`): a month in, owners clearly getting value get one text (or email)
  asking for a Google review of us, three a day at most. Off until `ALWAYS_OPEN_REVIEW_LINK` is set in `wrangler.toml`.
  Replies come to your phone; a complaint arrives at high priority.
- **Spanish on the site** (`tools/phone-es.mjs`): the ES/EN switch in the header swaps the hero, the menu, the cards'
  frame, the grade form, the six features, plans and the request form (the sample conversations in the cards stay
  English). Edit the Spanish there and run `node tools/phone.mjs`; the phone check flips every page to Spanish too.
  A lead from the Spanish page is marked Spanish, and that owner's Max line starts in Spanish.
- **Grade letters** (`src/letter.js`): on `/audit/tool`, "Make the letter" under an audit, or the "Grade letters to
  print" box for up to ten. One page each on Letter paper; competitors only as an average.

## Facebook and Instagram

Two separate things share one Meta app:

- **Always Open’s own Page and Instagram** post on their own: Monday, Wednesday and Friday in the 10 AM hour, a branded
  card from `public/social` and a caption Claude writes from the week’s real numbers (`src/social.js`). Connected once
  from the ops board link (`/meta/connect?hq=...`); this works before Meta’s review because you are an admin of the app.
  Messages to the Page come to your phone. The cards are remade with `node tools/social/make.mjs`.
- **Clients’ Pages** wait for Meta’s app review (`launch.js` checks hourly and flips the switch; the website drops its
  “Coming soon” labels by itself). Once on, owners connect their Page in the app and every approved photo post goes
  to Google, Facebook and Instagram. A photo an owner sends becomes a drafted post within ten minutes (`src/posts.js`);
  with Full Max’s “Posts from your photos” switch on, it goes without the tap.

## How to roll back a deploy

1. Actions tab, the failed run, read the "Check the live site" step: it says what it saw and whether it already
   rolled back.
2. By hand, from the Mac in `GatesHQ/alwaysopen`: `npx wrangler@4 rollback` and pick the previous version.
   Or in the Cloudflare dashboard: Workers, `alwaysopen`, Deployments, the previous one, Rollback.
3. Fix the commit, push to `main`, watch the run go green.

## How to pause a line

- The owner can: Max tab, the switch at the top. Callers then ring through to the transfer number or hear a short
  message.
- You can, for any line, with the ops key: the HQ phone line card, or in D1: `UPDATE voice_lines SET hq_on = 0
  WHERE client_id = '<id>'` (the owner sees "paused on our side" and cannot turn it back on until `hq_on = 1`).
- If Twilio itself must stop: Twilio console, the number, set Voice to the fallback URL only.

## How to put the site in a "we're having trouble" state

Push a commit that makes `serve()` in `src/index.js` return `crashResponse(path)` first thing for everything except
`/voice/` and `/health`. Visitors see "Something went wrong on our side, call (706) 460-2226"; callers still get
Max or the fallback; the deploy check will not roll it back because `/health` still answers. Revert when done.

## Backups and restore

Every Sunday in the small hours a gzip of the data tables goes to the `BACKUPS` R2 bucket, or, until R2 is turned
on in the Cloudflare dashboard, to your email as an attachment. `GET /ops/backup` with the key says when the last one
ran; `POST` runs one now. How to restore, and the drill that proves it, is in `docs/restore.md`.

## The outside accounts that must stay paid or renewed

Cloudflare (the Worker, D1, Email Routing; domain `alwaysopenoffice.com` renews Oct 24, 2027), Twilio (prepaid
balance: auto-recharge on, the Worker warns at $25 and $10), Anthropic (API credits: the Worker warns when a call is
refused for credit), Apple Developer Program (Oct 7, 2027), Google Cloud (Places key, OAuth: keep the consent screen
published), Stripe (nothing to renew), ntfy (free topic), the outside uptime monitor (free account, watches
`/health`). The Worker reminds you 30, 7 and 1 days before each date in `RENEWALS` in `wrangler.toml`.

## If you cannot be reached

Email alerts go to `MAIL_TO` in `wrangler.toml`. Add a second address there if someone else should get them, and
give them this file.
