# Restoring the Always Open database

Two ways back, in the order to try them.

## 1. Point-in-time restore (D1 Time Travel, any moment in the last 30 days)

This rewinds the live database in place. Do it only when the data is actually wrong (a bad migration, a deleted
table), not for a Worker problem.

From the Mac, in `GatesHQ/alwaysopen`:

```
npx wrangler@4 d1 time-travel info alwaysopen --timestamp="2026-10-28T20:00:00Z"
```

That prints the bookmark for that moment. Then:

```
npx wrangler@4 d1 time-travel restore alwaysopen --bookmark=<the bookmark>
```

Everything written after that moment is gone, including calls and leads, so pick the latest moment before the
damage and tell the owners whose data moved. The Worker keeps running; no deploy is needed.

## 2. From the weekly copy (when the account itself is gone)

The weekly file is `alwaysopen-<date>.jsonl.gz`: one JSON object per line, `{ "table": "...", "row": { ... } }`, for
every data table (never tokens or keys). To load it into a fresh database:

1. Create the database and the tables: `npx wrangler@4 d1 create alwaysopen` and deploy the Worker once; the Worker
   creates its tables on first use. Or run `test/fixtures/schema.sql` against it.
2. Turn the copy into a SQLite file and the inserts (Node 22, from the Mac, in `GatesHQ/alwaysopen`):

```
node tools/restore.mjs alwaysopen-2026-11-01.jsonl.gz restored.sqlite --sql
npx wrangler@4 d1 execute alwaysopen --remote --file=restore.sql --yes
```

   The first line prints the row count per table and leaves `restored.sqlite` you can open with any SQLite viewer.

3. Owners reconnect Google (tokens are never in the copy) and the iPhone app re-registers for pushes on its next
   open. Max's lines, calls, leads, jobs, bookings and billing are all back.

## The drill

The "Restore drill" workflow in GitHub Actions downloads today's copy from the Worker, restores it into a fresh
database with `tools/restore.mjs`, and compares row counts with the live database table by table. It never touches
the live database. (Exporting straight from D1 with `wrangler d1 export` needs the GitHub token to have the D1 Edit
permission in Cloudflare; the drill does not depend on it.) Run it from the Actions tab (Run workflow) or:

```
gh api -X POST repos/christophergates88/alwaysopen/actions/workflows/restore-drill.yml/dispatches -f ref=main
```

Run it once a quarter. Each run's table of counts is on the run's summary page.

| Date | Result |
| --- | --- |
| 2026-10-28 | First run, see the note below once it finishes |
