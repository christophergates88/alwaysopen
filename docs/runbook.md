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
`TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SID`, `STRIPE_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
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
| `health:ntfy` | Your phone pushes are not arriving | ntfy.sh status, the ntfy app on your phone |
| `health:twilio-numbers` | A live number no longer points at us | Twilio console, Phone Numbers, Voice webhook; or `POST /ops/twilio-setup` with the key to repoint all of them |
| `health:google-connections` | A Google connection was refused | The owner has a reconnect card; if several at once, the Google Cloud consent screen is in Testing |
| `health:backup` | No backup in 8 days | `POST /ops/backup` with the key; check the email or the R2 bucket |
| `crash:<route>` | Something threw; the visitor saw a plain page | The Errors tab on the ops board; the route tells you which page |
| `cron:<job>` | A background job threw | The ops board's Worker jobs line shows the note |
| `max-call` | A Max call errored | Twilio console, Monitor, Calls, then the call in the owner's app |
| `line-cap:<client>` | 120 minutes in a day on one line | The calls in the owner's app: storm or real rush? Raise `DAY_MINUTE_CAP` in `src/minutes.js` if real |
| `quiet-line:<client>` | A busy line had no calls for a week | Twilio number webhook, then ask the owner about forwarding |
| `quiet-profile:<client>` | A profile's reviews stopped | The owner's reconnect card, then the profile's managers in Google |
| `deploy` | A deploy failed or rolled back | The Actions tab; the alert says which check failed |
| `stripe-webhook`, `stripe-checkout` | Stripe calls failing | Stripe dashboard, Webhooks, recent deliveries |
| `minutes-invoice` | An overage could not be billed | The business has no Stripe customer; bill by hand |
| `mail-send` | An email could not be sent | Email Routing in Cloudflare for `alwaysopenoffice.com` |
| `social` | Today’s Always Open Facebook post did not go up | The ops board line for Facebook; reconnect the Page from the board link if the token died; `POST /ops/social-post` with the key puts it up now |
| `photo-post` | A client’s photo could not be turned into a post after 3 tries | Open the photo link in the alert and write the post by hand in HQ |

Problems arrive once per kind every 15 minutes with a count of the ones held back. A 7 AM push says "all good"
every morning; if it does not arrive, that is itself the alarm, and the outside monitor backs it up.

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
