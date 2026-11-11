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
`TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SID`, `LOB_KEY` (mailed letters, set with `Set Lob key.command`), `NTFY_TOKEN` (the paid ntfy account's access token, set with `Set ntfy token.command`), `STRIPE_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `PLACES_KEY`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `META_*`. GitHub holds
`CLOUDFLARE_API_TOKEN` and `LEADS_KEY`. Plain settings (towns, counties, renewals, the sending address) are in
`wrangler.toml`.

The ops key goes in the `x-key` header and nowhere else: no route takes it in the address (Nov 11, 2026; `/leads`,
`/storms` and `/radar` used to). The ops board uses dated links and a device cookie instead (`src/opsboard.js`).

On the Mac the ops key lives in the Keychain (login keychain, item "Always Open ops key", account `alwaysopen`), not in
a file. `GatesHQ/alwaysopen/opskey.sh` prints it for the `.command` files; `aopush.py` asks the Keychain itself (and
`dayplans`, `textpilot` and `wifisense` get it from `aopush`). It was moved out of `alwaysopen/deploy.sh` and its three
old copies by `Move ops key to Keychain.command` (result in `GatesHQ/opskey-move-result.txt`). Until that has been run
on a Mac, every reader falls back to the old file. To see the key: Keychain Access, search "Always Open ops key".

## Security headers (src/headers.js)

Every answer says https-only for a year (`strict-transport-security`) and `nosniff`; every page carries a content
policy. The public pages get `SITE_CSP`, which names exactly what they load: our own files, Google Fonts, Cloudflare's
visitor counter and, for the map, MapLibre from cdnjs with OpenFreeMap tiles. **A public page that starts loading from
a new place must be added there**, or browsers will refuse it: `tools/phonecheck.mjs` serves the pages with the same
policy and fails the deploy on any refusal, and `test/headers.test.js` checks every outside address the pages name.
The client app keeps its own stricter policy (`CSP` in `src/app.js`). `/.well-known/security.txt` is answered by the
Worker; `public/sitemap.xml` lists the public pages (add a new page there; the test fails if one is missing).

## Always Open HQ: the one page (src/opshq.js, at /ops and /ops/hq)

Everything that can need Christopher is on this page and nowhere else (Nov 11, 2026: "there's too many small places
something could be"). The top says how many things need him, then a tally that always shows all five kinds with a
count, so a zero is a checked zero: clients waiting on a reply (answer box), replies and posts approved for Google
(Copy and open Google, then Posted), requests to call back (Talking, Won, Lost), this week's to-dos (Done), and things
that are off (failing checks, a low Twilio balance, crashed pages, each in plain words with what to do). Folded below:
clients, calls, closed requests, how things stand, who is drifting, the switches (Outreach, the map), and a link to
the numbers. It reads the site's own tables each time it opens. An answer typed there is saved as Katie's and shows
in the client's app as "Always Open". The old to-do board (/ops) is this page; the old Google posting page (/ops/post)
sends you to its Google part; every push and the Monday email open it. `Open Always Open HQ.command` opens it from the
Mac. A new kind of thing that needs him goes into this page's list (gather() in opshq.js, or boardItems() in
opsboard.js), never onto a page of its own.

The older HQ page on claude.ai (filled by the scheduled task below) still holds a few tools this page does not: adding
a client by hand, the approved wording for regulated clients, and the monthly report numbers.

## The Always Open check (a Claude scheduled task, outside the Worker)

Four times a day it files new signups, leads, calls and app activity into Always Open HQ and writes the daily summary.
It writes a heartbeat each run; when the heartbeat is over 14 hours old the site says so once a day, as a normal push
(`checkHeartbeat` in `src/funding.js`). It is not an emergency: the site drafts review replies itself, and every lead,
signup, call and client message reaches Christopher by push and email as it happens. To restart it: claude.ai,
Scheduled tasks, turn on "Always Open check" (or tell Claude to).

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
| `health:email` | The email binding is missing | Check Email Routing for alwaysopenoffice.com in Cloudflare, then redeploy |
| `health:max-line` | A Max key is missing | `wrangler secret list`, set the missing one |
| `health:apple-push` | Owners are not getting pushes | Apple key in App Store Connect; `APNS_KEY`, `APNS_KEY_ID` |
| `health:ntfy` | Your phone pushes are not arriving, or ntfy turned down the account token | ntfy.sh status, the ntfy app on your phone; for the token, make a new one at ntfy.sh (Account, Access tokens) and run `Set ntfy token.command` |
| `health:twilio-numbers` | A live number points elsewhere and Twilio would not let the hourly check point it back (it fixes the usual case itself; the only alert loud at night) | Twilio console, Phone Numbers, Voice webhook; or `POST /ops/twilio-setup` with the key to repoint all of them |
| `health:google-connections` | A Google connection was refused | The owner has a reconnect card; if several at once, the Google Cloud consent screen is in Testing |
| `health:backup` | No backup in 8 days | `POST /ops/backup` with the key; check the email or the R2 bucket |
| `crash:<route>` | Something threw; the visitor saw a plain page | "Errors this week" on the ops board; the route tells you which page |
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

## The client app's long screens fold (src/apppage.js `fold`)

Max and Money keep each group of switches behind one row: the group's name, one line saying where it stands ("5 of 8
on.", "Max books an open time. A visit takes 1 hour."), and an arrow. A tap opens it in place; nothing moves to another
screen, so it is still four screens and one column. Open by itself only when it needs the owner: What Max knows while
the hours are empty, and Teach Max when he heard new things on a call. A fold stays how the owner left it for the visit,
so Save never shuts the group they are in. Never folded: the on/off card, the timecard, minutes, Calls, Tell Max
something, and every card the website shows off (`data-card`). `tools/appcheck.mjs` holds the rules: each closed row
says where it stands and is 48 px or taller, everything inside is measured with the folds open, the eleven owner tasks
still take the tab and at most one more tap, and Max stays under 4,200 px closed (it was 8,600 flat).

## What Max says about himself

Every call opens with the disclosure in `src/disclosure.js` ("I'm an S.I. assistant, and this call may be recorded."),
the one place that sentence lives: the line and the owner's app both read it. An owner's own greeting is played as they
wrote it when it already says both things (an assistant of some kind, and that calls are recorded); otherwise the
disclosure goes in after their first sentence. A greeting that says Max is not an AI, claims to be a person, or says
calls aren't recorded is refused when saved and never played. The website, terms and privacy page describe this
sentence: change them together.

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
- **Sales call-backs we promised**: a real caller on Always Open's own line (Max tells them Katie will call), or a
  mailed letter's "Call me", gets one high push about 90 business minutes later, on weekdays 9 AM to 7 PM, with the
  number. Test calls from your own phone never count.

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
- **Review asks for Always Open** (`src/ourreviews.js`): a month in, every client gets one text (or email) asking for a
  Google review of us (never only the happy ones: Google forbids that), three a day at most. Off until `ALWAYS_OPEN_REVIEW_LINK` is set in `wrangler.toml`.
  Replies come to your phone; a complaint arrives at high priority.
- **Spanish on the site** (`tools/phone-es.mjs`): the ES/EN switch in the header swaps the hero, the menu, the cards'
  frame, the grade form, the six features, plans and the request form (the sample conversations in the cards stay
  English). Edit the Spanish there and run `node tools/phone.mjs`; the phone check flips every page to Spanish too.
  A lead from the Spanish page is marked Spanish, and that owner's Max line starts in Spanish.
- **Grade letters** (`src/letter.js`): on `/audit/tool`, "Make the letter" under an audit, or the "Grade letters to
  print" box for up to ten. One page each on Letter paper; competitors only as an average.
- **Mailed grade letters** (`src/mail.js`, `src/qr.js`): the Prospector adds businesses to `mail_queue`
  (`POST /ops/mail-queue` with the key). Every 10 minutes on weekdays, 10 AM to 3 PM Eastern, the Worker grades the next
  ones fresh and mails a color letter through Lob (lob.com) to each graded C, D or F, signed by the team, with a QR code
  to that business's private live audit (`/your-audit/<token>`). Skipped: A and B grades, clients, anyone already a
  lead, anyone mailed in the last six months, no street address on Google. Caps: 5 a day and $60 a month by default
  (about $1.42 a letter), set by `Turn on mailed letters.command` (`POST /ops/mail-on`). Needs `LOB_KEY` and `BUSINESS_ADDRESS`
  (the return address). A `test_` key makes up to three proofs in Lob's dashboard and mails nothing; their codes open
  real audit pages, so scanning one tests the push. The live key puts those businesses back in line for a real letter. The letter's page
  exists only while Lob makes it; nothing from Google is kept. The first scan of a code pushes "X just scanned their
  letter" at high priority; the 7 AM push lists letters landing that day and any scanned. To stop it, delete the
  `enabled` row in `mail_meta` or remove `LOB_KEY`.

## Storm Desk (src/stormdesk.js)

Nationwide, by each client's own location. Every active Growth or Pro client is placed once (their map address, else
their town through OpenStreetMap) and turned into a National Weather Service county and forecast zone
(`storm_watch`; a place that can't be found is tried again daily). Every 10 minutes the active warnings for each state
with clients are matched to those zones; a match pushes you and sends the "Always Open storm alert" email with a
`Clients:` line, and the Always Open check drafts the storm posts for them. `STORM_COUNTIES` in `wrangler.toml` (the
old Georgia list) still matches for clients that exist only in HQ.

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

## Shoulder Tap (src/tap.js)

When a caller asks something only the owner knows, Max says he is checking, ends his reply with `[ASK: question]`, and
the owner gets the question by text, push and on the live card in the app. A reply text (or the app's answer box) is said
to the caller in the same call. No answer in 75 seconds: Max promises a call back as before. Late answers go on the call.

- Who has it: every line that is not regulated, since Nov 10, 2026 (`TAP_LIVE = "1"` in wrangler.toml [vars]). Set it
  to "0" and deploy to go back to per-line opt-in (`features: ["tap"]`, or `testFeatures: ["tap"]` for test calls).
- Never on regulated lines (insurance, medical, legal). Daytime only (the business's call hours) unless a test call or the
  owner's own setting is "any time" (`owner_set.tap`: off, day, always).
- Limits: 2 asks a call, 12 an hour per business. The owner's texts come from the business's own number when its texting
  is approved, else from Always Open's number with the business named. On the Always Open line Max asks Christopher
  (OPS_TEXT_TO).
- Practice calls: a voice_log row of kind `rehearse-request` with `features: ["tap"]`, `who`, and turns like
  `{"owner": "Yes, by 3"}` (empty for no answer). Results are `rehearse` rows.
- Turn it off for one line: add `"off": ["tap"]` to that line's facts. The owner has their own switch on the Max tab.
  For everyone: `TAP_LIVE = "0"` and a deploy.

## Outreach calls to businesses (src/outreach.js)

Live since Nov 10, 2026 (Carter read the B2B plan; Christopher said go). Max calls a client's own list of business
landlines with one sentence the owner wrote, and asks if they want a call; yes becomes a lead, stop is for good.
Tightened the same afternoon, after Christopher asked whether it met the commercial-landline rules.

- Pro only (or the `outreach` extra in `app_clients.feats`), never a regulated client. Growth and Starter see what it
  does and an "Ask about Pro" button.
- Three switches, all needed: `OUTREACH_LIVE` in src/outreach.js (true), Christopher's kill switch
  (`billing_config` row `outreach_enabled` = '1'; '0' stops every outreach call at the next tick), and the owner's own
  switch, which only turns on after the owner signs the Outreach terms and gives the business's legal name and a
  call-back number (their own, not the line Max calls from).
- The terms (`TERMS`, version `TERMS_VERSION`, now `2026-11-10b`): the client is the caller/seller, warranties about
  the list, release, indemnity, limits, not legal advice. Signatures are in `outreach_terms` (name typed, time, text
  hash, IP hash, browser). Changing the wording means a new `TERMS_VERSION`, and every owner signs again before calls
  resume.
- The call: "an automated assistant calling for <legal name>", then "To stop these calls, say stop or press 9 at any
  time", then the owner's sentence, the owner's call-back number and one yes/no question. No voicemail. Not recorded.
- Every number is checked with Twilio Lookup (line type and caller ID, about 2 cents) when the list is added and again
  right before the call. Called only if it is a landline or fixed internet line AND its caller ID type is BUSINESS.
- The Do Not Call check: our own copy of the National Do Not Call Registry (`src/dnclist.js`, tables `dnc_slices` and
  `dnc_loads`), at import and again right before a call when the last check is over a day old. Always Open is
  registered at telemarketing.donotcall.gov as an Exempt Organization (business-to-business calls, and calls to people
  who asked for them), so the whole list is free; the SAN is in the account there. **Every month**: log in, download
  the full list (all area codes, flat text), then double-click **Load Do Not Call list.command** in the GatesHQ folder
  (`GatesHQ/tools/dncload.mjs`, from `tools/dncload.mjs` here; it posts to `/ops/dnc-list` with the ops key, and its
  last run is in `GatesHQ/dnc-load-result.txt`). `GET /ops/dnc-list` with the key says how old the copy is. No copy, a
  copy more than 30 days old, or an area code it doesn't have: that number is not called, and while numbers wait a
  "health:outreach-dnc" alert goes out once a day. From day 24 a "health:outreach-dnc-due" reminder goes out once a
  day while Outreach has numbers waiting. The paid DNCScrub check (state lists, known litigators) is still wired in and
  runs on top only if the Worker secret `DNC_LOGIN_ID` is ever set; Christopher passed on paying for it (Nov 10, 2026).
- Every call is in `outreach_calls` (sid, exact words, every check and when, who answered, the outcome, seconds). Keep
  it: the Telemarketing Sales Rule wants five years of records.
- A machine (or an answer Twilio can't place) hears only "a telemarketing call ... on behalf of <legal name>, press 9 or
  call <number>" (the abandoned-call message), never the sentence. Person-or-machine is decided fast
  (MachineDetectionSpeechEndThreshold 900 ms) so a person hears Max within two seconds of their hello.
- No calls on federal holidays (and the day after Thanksgiving), and only when 9 to 5 holds in every time zone of the
  area code. A list's source is asked for; a bought list is always held. Office and cleaning supplies are refused.
- The public side: `/stop-calls` (anyone can stop a number, for every client, 20 a day per connection) and the written
  policy at `/do-not-call` (public/do-not-call.html). Its promise of training means: read it before working on Outreach.
- Never: cell phones, home lines, unknown or unlisted caller IDs, toll-free, hospitals, clinics, doctors, care homes,
  schools, police, fire, 911 and other emergency lines (`SENSITIVE`), area codes in California, Florida, Indiana,
  Minnesota and Oklahoma, and in the eight states with their own do-not-call lists (Colorado, Louisiana, Massachusetts,
  Missouri, Pennsylvania, Tennessee, Texas, Wyoming) (`BLOCKED_STATES`), weekends, outside 9 to 5 where the number is, a number this client called
  in the last 30 days, a number any client called in the last 7, anyone who said stop (for every client, including a
  business that calls the line back and says "take us off your list"), an ended client or a paused line.
- Limits: 3 calls per client every 10 minutes, 30 per run in all, 50 per client a day.
- Lists and sentences are read automatically (the rules, then Claude Haiku). Plainly personal or sensitive names are
  skipped on their own. Only a list or sentence that needs a person's look is held (`outreach_review`), and Christopher
  gets one push with a link to `/ops/outreach-review?id=...` (ops board token or cookie): Approve lets it call, Reject
  calls nobody. `/ops/outreach-review` with no id lists what is waiting.
- Stop everything now: `UPDATE billing_config SET v = '0' WHERE k = 'outreach_enabled'`.

## How to roll back a deploy

1. Actions tab, the failed run, read the "Check the live site" step: it says what it saw and whether it already
   rolled back.
2. By hand, from the Mac in `GatesHQ/alwaysopen`: `npx wrangler@4 rollback` and pick the previous version.
   Or in the Cloudflare dashboard: Workers, `alwaysopen`, Deployments, the previous one, Rollback.
3. Fix the commit, push to `main`, watch the run go green.

## How to pause a line

- The owner can: Max tab, the switch at the top. Callers then ring through to the transfer number or hear a short
  message.
- You can, for any line, with the ops key: the HQ phone line card, or in D1: `UPDATE voice_lines SET on_air = 0
  WHERE client_id = '<id>'` (the owner sees "paused on our side" and cannot turn it back on until `on_air = 1`).
- If Twilio itself must stop: Twilio console, the number, set Voice to the fallback URL only.

## How to put the site in a "we're having trouble" state

Push a commit that makes `serve()` in `src/index.js` return `crashResponse(path)` first thing for everything except
`/voice/`, `/health` and `/app/`. Visitors see "Something went wrong on our side, call (706) 460-2226"; callers still
get Max or the fallback. The deploy's live check looks for page text on `/` and `/insurance`, so it WILL roll this back:
run the deploy with that check's page list emptied in `.github/workflows/deploy.yml` (same commit), and put it back when
you revert.

## Backups and restore

Every Sunday in the small hours a gzip of the data tables goes to the `BACKUPS` R2 bucket, or, until R2 is turned
on in the Cloudflare dashboard, to your email as an attachment. `GET /ops/backup` with the key says when the last one
ran; `POST` runs one now. How to restore, and the drill that proves it, is in `docs/restore.md`.

## The outside accounts that must stay paid or renewed

Cloudflare (the Worker, D1, Email Routing; domain `alwaysopenoffice.com` renews Oct 24, 2027), Twilio (prepaid
balance: auto-recharge on, the Worker warns at $25 and $10), Anthropic (API credits: the Worker warns when a call is
refused for credit), Apple Developer Program (Oct 7, 2027), Google Cloud (Places key, OAuth: keep the consent screen
published), Stripe (nothing to renew), ntfy (paid plan), Lob (mailed letters: pay per letter, card on file), the outside uptime monitor (free account, watches
`/health`). The Worker reminds you 30, 7 and 1 days before each date in `RENEWALS` in `wrangler.toml`.

## If you cannot be reached

Email alerts go to `MAIL_TO` in `wrangler.toml`. Add a second address there if someone else should get them, and
give them this file.
