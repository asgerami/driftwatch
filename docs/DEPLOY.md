# Deploying Driftwatch

Everything runs on free tiers. Nothing here needs a server you maintain.

| Part | Where | Free limit | Expected use |
| --- | --- | --- | --- |
| Poll and diff every 6 hours | GitHub Actions (`.github/workflows/poll.yml`) | 2,000 min/month on a private repo, unlimited on a public one | About 2 min per run, ~250 min/month |
| Database | Neon Postgres | 0.5 GB | Metadata and changes only; spec files are in R2 |
| Spec files (blobs) | Cloudflare R2 | 10 GB, 1M writes and 10M reads a month | About 1 MB per stored version |
| Website | Netlify | Commercial use allowed | Small |

Free-tier limits change. Check them when something starts failing.

## Secrets

The same values go in three places: your local `.env`, GitHub Actions secrets,
and Netlify environment variables. Only the site needs a subset.

| Name | What | `.env` | GitHub | Netlify |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Neon connection string, pooled (host contains `-pooler`), plus `&connect_timeout=30` | yes | yes | yes |
| `DIRECT_URL` | Same, without `-pooler`. Used by `prisma db push` | yes | yes | no |
| `R2_BASE_URL` | `https://<account-id>.r2.cloudflarestorage.com/<bucket>` | yes | yes | no |
| `R2_ACCESS_KEY_ID` | R2 API token, Object Read & Write on the bucket | yes | yes | no |
| `R2_SECRET_ACCESS_KEY` | Shown once when the token is created | yes | yes | no |

**Keep `connect_timeout=30` on both Neon URLs.** Neon's free tier suspends the
database after about 5 minutes idle and takes a few seconds to wake. Prisma
gives up connecting after 5 seconds by default, so without it the first
command after a pause fails with a connection error. The scheduled job runs
every 6 hours, so it always finds the database asleep.

Copy the GitHub ones from `.env` with the `gh` CLI, from the repo root:

```bash
for k in DATABASE_URL DIRECT_URL R2_BASE_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  grep -E "^$k=" .env | sed -E "s/^$k=//; s/^\"//; s/\"$//" | gh secret set "$k"
done
gh secret list
```

Or add them by hand under the repo's **Settings → Secrets and variables → Actions**.

## First-time setup

1. **Schema.** `pnpm db:push` creates the tables. Run it again after any change
   to `prisma/schema.prisma`; the scheduled job never changes the schema itself.
2. **Providers.** `pnpm w seed` writes the registry into the database. Rerun it
   after editing `apps/worker/src/registry.ts`.
3. **History (optional).** `pnpm w backfill -n 20` then `pnpm w diff` imports
   recent versions so the feed launches with content. Keep `-n` modest:
   every version is about 1 MB in R2 and a row in Neon.
4. **Schedule.** Push `.github/workflows/poll.yml` to the default branch.
   Scheduled workflows only run from there. Trigger one by hand under
   **Actions → poll → Run workflow** to check it.

## Netlify

Live at https://driftwatch.et (custom domain; `www.` and `http://` redirect to
it) and https://driftwatchhq.netlify.app.

1. **Add new site → Import an existing project**, pick `asgerami/driftwatch`.
2. Build settings:
   - Base directory: *(empty)*
   - Package directory: `apps/web`
   - Build command: `pnpm generate && pnpm --filter @driftwatch/web... run build`
     (the `...` also builds `packages/core`, which the site imports)
   - Publish directory: `apps/web/.next`
3. Environment variables: `DATABASE_URL` (the pooled one, with
   `connect_timeout=30`, no surrounding quotes) and `NODE_VERSION` = `22`.
   Not `DIRECT_URL` or the `R2_*` keys: the site reads neither.
4. Netlify detects Next.js and installs its adapter. `prisma/schema.prisma`
   includes the `rhel-openssl-3.0.x` engine its server functions need.

Every PR gets a deploy preview at `deploy-preview-<n>--driftwatchhq.netlify.app`,
reading the production database.

`/api/feed.json` sends `netlify-vary: query=provider|limit|signal`. Without it
Netlify's CDN cached one response per path and ignored `?provider=`.

## Analytics and email (both free, both off until configured)

**Analytics: Cloudflare Web Analytics.** Free with no limit, no cookies, no
personal data, so no consent banner. Uses the Cloudflare account R2 already
needs.

Set up: driftwatch.et's token is in `apps/web/app/layout.tsx` (it is public,
shipped in every page). It loads on production builds only (Netlify's
`CONTEXT=production`), so previews don't count as visits. Stats are in the
Cloudflare dashboard under **Analytics & Logs → Web Analytics**. A fork sets
`NEXT_PUBLIC_CF_BEACON_TOKEN` instead.

**Email: Resend.** Free for 3,000 emails a month, 100 a day. Used for one
thing today: a single confirmation when someone joins the waitlist (not when
they resubmit). A failed send is logged and never fails the signup.

1. Sign up at resend.com, then **Domains → Add domain** → `driftwatch.et`.
2. Add the DNS records it lists (SPF, DKIM, and the MX for bounces) wherever
   driftwatch.et's DNS is managed, and wait for "Verified".
3. **API Keys → Create**, permission "Sending access", domain driftwatch.et.
4. Netlify environment variables: `RESEND_API_KEY` = the key, and
   `EMAIL_FROM` = `Driftwatch <hello@driftwatch.et>`.

Until both are set, nothing is sent.

## Bumping RULESET_VERSION

The site shows only runs at its own `RULESET_VERSION`. Merge a bump before the
database has runs at the new version and the live feed is empty until the next
scheduled diff. Order:

1. Push the branch, then run the job from it:
   `gh workflow run poll --ref <branch>`. It re-diffs every stored pair with the
   new rules, carrying published and rejected decisions forward.
2. Compare the old and new versions' facts (the query in the PR that bumped to
   1.2.0 is a starting point) and read anything that changed.
3. `pnpm w review` for anything new, then merge. Netlify deploys the site
   already matching the database.

## Publishing

The scheduled job runs `pnpm w review --auto`: the auto-publish policy
publishes what it allows and holds the rest (endpoint removals, auth changes,
spike releases, a new source's first stories). Held stories are listed, with
the reason, in the `review-queue` issue. To deal with them locally:

```bash
pnpm w review                     # what is pending
pnpm w review --reject "<text>"   # a false positive: reviewed, never published
pnpm w review --publish           # publish everything still pending
```

Every decision records who made it in `Change.reviewedBy`: `human`, or the
policy version (`auto-1`).

## Sharing

The scheduled job drafts two posts for every breaking change published in the
last 14 days: one for X (fits 280 characters, counting the link as X does) and
one for Hacker News or Reddit (an 80-character title, and a body ending with a
disclosure that you run Driftwatch). Templates, not a model, so a draft can't
state anything the diff didn't find. Nothing is ever posted automatically.

```bash
pnpm w share                       # newest 10 unposted drafts, each with an X compose link
pnpm w share -n 30 --out drafts.md # more, as a file to copy from
pnpm w share --posted <storyId>    # after posting
pnpm w share --skip <storyId>      # not worth posting
```

## Signals

`pnpm w signals` (`-d 30` for a month) prints what the week-6 decision rests
on: page views of change and API pages, feed fetches, waitlist signups per
API, fix PRs, and any source not fetching.

- **Page views** come from Cloudflare Web Analytics and need a token in `.env`:
  Cloudflare → My Profile → API Tokens → Create Token → Custom token, with
  permission *Account → Account Analytics → Read*. Set `CF_API_TOKEN`. The
  account id is read from `R2_BASE_URL`.
- **Feed fetches** are counted by the feed routes themselves (`FeedFetch`): a
  lower bound, since Netlify's CDN answers repeats within 5 minutes.
- **Fix PRs**: log each one you open with
  `pnpm w pr log https://github.com/<owner>/<repo>/pull/<n> --change <storyId>`;
  signals re-reads its state from GitHub each run.

## Fixing a repo by hand (M4)

The `driftwatch` CLI (`apps/fixer`) never opens a pull request. You do.

1. Clone the repo you mean to fix and install its dependencies, so the
   typecheck sees the real SDK types.
2. `pnpm --filter @driftwatch/fixer cli scan --change <storyId> --repo <path>`
   lists every affected call and field read, with a confidence label.
3. `pnpm --filter @driftwatch/fixer cli fix --change <storyId> --repo <path> --out fix.patch`
   writes a patch for the mechanical cases and lists everything else with the
   reason it was not patched. `--write` applies it and runs the repo's tests,
   restoring the files if they fail.
4. Read the patch and the "Not patched" list. Most of a real fix is the list.
5. Open the PR yourself, then log it: `pnpm w pr log <url> --change <storyId>`.

## When something breaks

- **The `review-queue` issue** is the first place to look. The scheduled job
  opens it when stories are waiting for review or a source is failing or stale
  (no success for 24h), comments when the counts change, and closes it when
  both are clear. `pnpm w report` prints the same thing locally.
- **`pnpm w status`** shows snapshot counts per source and which blob store is
  in use. The job prints it at the end of every run.
- **"R2 is partly configured"** means one of the three `R2_*` values is missing.
  This is deliberate: falling back to the runner's disk would lose every blob.
- **"Can't reach database server"** on the first command after a pause: the
  Neon URL is missing `connect_timeout=30` (see Secrets).
- **A source fails** (for example a hosted URL returning 403): the others still
  run. Check the job log for the line naming it.
