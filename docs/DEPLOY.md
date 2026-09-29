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

Not yet verified end to end. Settings to start from:

1. **Add new site → Import an existing project**, pick `asgerami/driftwatch`.
2. Build settings:
   - Base directory: *(empty)*
   - Package directory: `apps/web`
   - Build command: `pnpm generate && pnpm --filter @driftwatch/web build`
   - Publish directory: `apps/web/.next`
3. Environment variable: `DATABASE_URL` (the pooled one).
4. Deploy. Netlify detects Next.js and installs its adapter.

`prisma/schema.prisma` already includes the `rhel-openssl-3.0.x` engine the
site's server functions need on Netlify.

## Publishing

Nothing reaches the site until a human approves it:

```bash
pnpm w review            # what is pending
pnpm w review --publish  # publish it
```

Run it locally; it reads the same Neon database the job writes.

## When something breaks

- **`pnpm w status`** shows snapshot counts per source and which blob store is
  in use. The job prints it at the end of every run.
- **"R2 is partly configured"** means one of the three `R2_*` values is missing.
  This is deliberate: falling back to the runner's disk would lose every blob.
- **"Can't reach database server"** on the first command after a pause: the
  Neon URL is missing `connect_timeout=30` (see Secrets).
- **A source fails** (for example a hosted URL returning 403): the others still
  run. Check the job log for the line naming it.
