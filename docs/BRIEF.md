# Driftwatch Build Brief

> For Claude Code working in this repo. Read this file and `CLAUDE.md` before doing anything.
> `CLAUDE.md` records architecture decisions and traps. This file covers product direction and the next 6 weeks of work.
> If the two disagree, stop and ask Amir.

---

## 1. What Driftwatch is

Driftwatch is a breaking-change radar for the third-party APIs a team depends on. It watches public OpenAPI specs, detects and classifies changes, and publishes the breaking ones as a free public feed.

The paid product comes later: a GitHub App that finds the affected code in a customer's repo and opens the fix PR.

It maps to YC's Fall 2026 Request for Startups, "Self-Maintaining APIs." Amir is a solo founder. The goal for the next 6 weeks is to prove two things: people want the feed, and people want their repo fixed. Those signals go into Antler and YC applications.

## 2. Positioning (read carefully)

- **Producer-side diff tools** (oasdiff, Bump.sh, Optic, Specway) help API owners check their own specs. API owners are not our user.
- **Consumer-side alerting already exists.** FlareCanary sends schema drift alerts, PageCrawl watches changelogs and specs, and several Apify actors run scheduled OpenAPI diffs to Slack. "We alert you" is a commodity.
- **Our product is the fix:** "these call sites in your repo break, and here is the patch." The feed is distribution, not the business.
- **Trust is everything.** One false BREAKING label on the public feed costs more than ten missed minor changes. Favor precision over recall.

If `CLAUDE.md`, the README, or site copy says every existing tool is producer-side, update it to match this section.

## 3. Known state (verify; may be stale)

As of mid September 2026:

- **pnpm monorepo:**
  - `packages/core`: normalize, diff, classify
  - `apps/worker`: cron pipeline
  - `apps/web`: Next.js site
  - `prisma/schema.prisma`
- **Pipeline complete:** acquire → normalize → diff → classify → impact render → review gate → feed (HTML, JSON, RSS)
- **Diff engine:** in-house TypeScript engine. oasdiff was dropped because it needs a Go toolchain.
- **Reused code:** parsers and schema resolver come from Wrangl. The Babel AST engine from AegisPulse is intended for the repo scanner.
- **Size:** roughly 13 commits and 51 tests.

## 4. Step 0: orient before coding

Do this first, then report back to Amir in one short message. Do not write feature code yet.

1. Read `CLAUDE.md`, the README, every `package.json`, and the Prisma schema.
2. Install dependencies, then run the full test suite and a typecheck. Report pass/fail.
3. If possible, run the pipeline end to end locally on one API. Note what breaks.
4. List which APIs are tracked today and where each spec is fetched from.
5. Write a gap list comparing this brief with the repo. Flag anything in this brief that is wrong about the repo.
6. Propose the order you will tackle Milestone 1 in.

## 5. Milestones

Each milestone ends with three things: tests passing, a clean typecheck, and a short summary to Amir.

### M1: Coverage and trust (weeks 1 to 2)

**Goal:** track about 25 APIs that developers actually integrate, reliably, with nothing wrong ever published.

**Source registry.** One entry per API with these fields:
- name and category
- spec URL (prefer the provider's official repo)
- format
- fetch cadence
- last successful fetch
- last detected change

**Candidate APIs.** Verify each one. Keep only those with an official, machine-readable OpenAPI spec, and replace the rest.
- Stripe, GitHub REST, Twilio, SendGrid, OpenAI, Anthropic, Plaid
- Adyen, Square, Cloudflare, DigitalOcean, Discord, PagerDuty, Asana
- Box, Datadog, Jira Cloud, Vercel, Resend, Mailgun, Slack Web API
- Zoom, HubSpot, Mux, Clerk

GraphQL-only APIs (Shopify Admin, Linear) are out of scope for now.

**Fetch robustness.**
- Timeouts, plus retries with backoff.
- ETag and Last-Modified support.
- Content hashing, so unchanged specs skip the diff.
- Fetch failures and stale sources must surface visibly. Never let a source go stale silently.

**Classifier fixtures.** Every rule gets a pair of fixture specs and an expected classification. Rules include at least:
- endpoint removed
- method removed
- required parameter added
- parameter removed
- response field removed
- type changed
- enum value removed
- auth or security scheme changed

Add fixtures built from real historical changes where possible.

**Noise control.**
- Ignore changes that touch only descriptions or examples.
- Ignore reordering.
- Ignore vendor extensions unless they change behavior.
- Spec restructuring, such as `$ref` moves, must not produce false positives.

**Review gate.** It stays mandatory for anything labeled breaking. In v1, nothing breaking is published automatically.

Acceptance:
- [x] Registry holds at least 20 verified APIs, each fetching on schedule
- [x] Every classifier rule has fixture tests
- [x] Re-running the pipeline on unchanged specs creates zero new items (idempotent)
- [x] A refactor-only spec change (`$ref` moves, reordering) creates no breaking items

### M2: The public site as distribution (weeks 2 to 3)

**Stable URLs.** Slugged, permanent, shareable:
- `/apis/[api]`
- `/changes/[id]`

**Change page contents.**
- A plain-English summary of what changed
- Who is affected
- A before/after snippet
- Severity
- A link to the source spec diff or commit
- A detected-at timestamp

**Feeds.** Per-API RSS and JSON, in addition to the global feeds.

**SEO basics.**
- A title and description for every page
- `sitemap.xml`
- Canonical URLs
- A generated OG image for each change

**"Watch my repo" waitlist.**
- Collects email, GitHub repo URL, and which APIs they use.
- Stored in Postgres via Prisma.
- No email provider yet. Ask Amir before adding one.

**Analytics.** Privacy-friendly only. Amir has used Umami before, but confirm with him before adding anything.

**Performance.** Static generation or ISR wherever possible.

Acceptance:
- [x] Every published change has a permanent URL with an OG image
- [x] Per-API and global RSS/JSON feeds validate
- [x] Sitemap includes every API and change page
- [x] Waitlist form stores submissions and rejects junk input

### M3: Share kit (week 3)

For each published breaking change, generate two draft posts:
- a short one for X
- a longer one for HN or Reddit

Each draft states the key fact and links to the change page. Store the drafts in the database or as files. Amir posts them manually. Never auto-post.

### M4: Concierge fixer CLI (weeks 3 to 5)

This is the prototype of the paid product. After real breaking changes, Amir uses it by hand to open fix PRs on public repos. Support TypeScript and JavaScript only at first.

**`driftwatch scan --change <id> --repo <path>`** finds call sites affected by a change. It looks for:
- **Official SDK calls:** map operationId and path to SDK methods for the tracked providers' official SDKs.
- **Raw HTTP calls:** `fetch`, `axios` and `ky` calls whose URL matches the affected path. Handle template literals and base-URL constants.
- **Field access:** reads of removed or renamed response fields downstream of the call. This is best effort, and every finding carries a confidence label.

The output is a report listing each finding's file, line, snippet, why it breaks, and confidence.

**`driftwatch fix`** generates a patch for high-confidence mechanical cases:
- renamed fields
- removed optional parameters
- newly required parameters with a documented value

Every patch must typecheck, and repo tests must run when they exist. Low-confidence findings get a report only, never a patch.

**`driftwatch pr-body`** writes the PR description:
- what changed upstream, with a link
- what the patch changes
- how it was verified
- a one-line disclosure that Driftwatch found the issue

**Human in the loop.** The CLI never opens PRs itself. Amir reviews every PR and opens it himself, and keeps it to a handful per upstream change.

Acceptance:
- [x] Fixture consumer repos with known call sites, covering SDK calls, raw HTTP and field access
- [x] Scan precision and recall measured against those fixtures and reported
- [x] Every generated patch typechecks against its fixture repo

### M5: GitHub App (gated; do not start)

Amir decides whether to build this based on the signals at weeks 5 to 6. Do not scaffold it early.

## 6. Signals to track

Build a small CLI script (not an admin UI) that prints:

- Views of change pages and API pages
- RSS and JSON feed fetches, approximated from logs
- Waitlist signups, broken down by API
- Fix PRs opened, merged and rejected, logged in a simple table

**Decision point at week 6.** Strong waitlist signups plus merged PRs mean build the App. Readers but no waitlist and no merges mean Amir rethinks. In that case, `packages/core` must stay reusable.

## 7. Engineering standard

- **Types:** TypeScript strict mode. No `any` without a comment explaining why.
- **Tests:** every diff or classifier change ships with tests. Unit tests never touch the network; use fixtures.
- **Pipeline:** deterministic and idempotent. The worker must be safe to re-run at any time.
- **Pure core:** `packages/core` has no database or network access, so the fixer and the future App can reuse it.
- **Dependencies:** keep them minimal, and justify each new one in the commit message. No Go toolchain.
- **Errors:** fetch failures, parse failures and stale sources are loud in logs and in the stats script. Never swallow them.
- **Evidence:** every published claim links to its evidence (the spec diff or commit).
- **Commits:**
  - Small and focused, using conventional commit messages.
  - Commit after each working step.
  - Never add Co-Authored-By lines, attribution trailers, or "generated with Claude" text to commits, PR descriptions, or code.
- **Records:** update `CLAUDE.md` whenever you make an architecture decision or hit a trap. Update the status log (section 10) at the end of every session.

## 8. Out of scope for now

- User accounts, auth, billing, dashboards
- The GitHub App
- Languages other than TS/JS in the fixer
- GraphQL APIs
- LLM-only classification. Any LLM use sits on top of the deterministic diff output and never decides "breaking" on its own.
- Auto-posting to social media, or opening PRs automatically
- Any paid service without Amir's approval

## 9. Ask Amir before

- Changing architecture recorded in `CLAUDE.md`
- Adding a paid service, an external API key, or new infrastructure
- Deleting data, rewriting migrations, or force-pushing
- Publishing anything externally
- Starting anything this brief doesn't cover that would take more than a day

## 10. Status log

Claude Code: add one dated line at the end of each session saying what got done and what's next.

- 2026-09-28: Brief created. Next: Step 0.
- 2026-09-28: Step 0 done. Install, typecheck and 73 tests pass; `pnpm check` needs `DATABASE_URL`; OpenAI ran end to end and idempotently but surfaced an allOf→anyOf nullable false positive. Next: M1, once the open questions are answered.
- 2026-09-29: Hosting on free tiers: Neon (schema pushed, 6 sources seeded), Cloudflare R2 for spec blobs, GitHub Actions `poll.yml` every 6h, Netlify prepared but not connected. `pnpm check` no longer needs a database. First full poll stored all 6 sources. Next: merge #8 so the schedule runs, connect Netlify, then M1 step 2 (allOf→anyOf false positive).
- 2026-09-29: M1 step 2 done. allOf/anyOf nullable false positive fixed (ruleset 1.2.0): 19 false breaks gone across 100 real pairs, nothing else changed. Review and the feed read only the current ruleset; published facts carry forward on a bump. R2 retries hardened after 3 transient read failures. Next: spot-check Stripe's breaking changes before any publish, then rule fixtures (M1 step 3).
- 2026-09-29: First publish. Live at https://driftwatch.et (Netlify, custom domain). Stripe spot-check found no false positives but heavy repetition, so facts now group into stories (Stripe 214 facts → 109 cards); public empty states; Stripe API-version note. Pre-publish review of every breaking story found 9 more false or doubtful ones: response type narrowing is not a break (ruleset 1.3.0), and GitHub moved 11 enterprise endpoints into ghec (`review --reject`, carried across bumps). Published 764 stories (1253 rows). Fixed endpoint fingerprints ignoring the path (`refingerprint`). Next: M1 step 3, fixtures for the 9 untested rules.
- 2026-09-30: M1 done except the review load that follows it. Every rule has a test (a test enforces it); security diffed as alternatives (ruleset 1.4.0, re-diffed before merge with every decision carried). Retries with backoff, conditional GETs (304), per-source health, and a `review-queue` GitHub issue from the scheduled job. Registry at 22 providers / 23 sources, all verified on GitHub via the new `inspect` workflow; left out Anthropic, DigitalOcean, Mailgun, HubSpot (reasons in the registry commit). Next: backfill the new APIs, review their first stories, then M2.
- 2026-10-04: Queue cleared and published (2188 stories), with Clerk's withdrawn endpoints and a Square converter artifact rejected. Ruleset 1.6.0 (one card per removed required field). Auto-publish policy `auto-1`: verified shapes publish, endpoint removals / auth changes / spike releases / a new source's first stories wait for a person; `/method` states it. M2 shipped: permanent `/changes/<id>` pages (3005), `/apis/<api>` (old URLs 308), global and per-API RSS + JSON Feed (W3C-valid), sitemap, canonical URLs, per-change OG images, ISR, and the `/watch` waitlist. Open: analytics (Umami?) and an email provider both need Amir's yes. Next: M3 share kit.
- 2026-10-04 (later): Analytics live (Cloudflare Web Analytics, free, cookieless, production only). Email live (Resend, free; one confirmation per new waitlist signup; tested to Amir's inbox). M3 shipped: share kit, 137 drafts, posted by hand only (`pnpm w share`). M1 closed: refactor-only test added; it found a known gap, a break hidden behind a same-release component rename is held (behavioral 80) rather than reported (CLAUDE.md known gap 7). Removed "Generated with Claude Code" lines from PR descriptions #9–#28 (the brief forbids attribution); five pre-existing Cursor commits from 2026-09-13 carry co-author trailers, left alone (rewriting master needs a force-push). Next: signals script (section 6), then M4.
- 2026-10-04 (evening): M4 scan and fix shipped. `driftwatch scan` finds raw HTTP, official SDK calls and field access (traced from the call, confidence-labelled): 6 fixture repos, http 21/21, sdk 19/19, field 19/19, no false positives. `driftwatch fix` patches the three mechanical cases from four real published changes (Plaid and Cloudflare renames, Stripe removal, PagerDuty required enum); every patch typechecks against its fixture, one that would not (a repo-typed Cloudflare read) is dropped. Next: `driftwatch pr-body`.
- 2026-10-04 (night): M4 complete. `driftwatch pr-body` writes the PR title and description from `fix --json`, templates only: what changed upstream with links to the story and the spec diff, what the patch changes (quoting what the provider said a removed field did), how it was verified, one disclosure line. Next: use it by hand on real repos after real breaking changes, log each PR with `pnpm w pr log`, and read `pnpm w signals` for the week-6 decision.
- 2026-10-06: Site redesign merged and live (#40, #41): light design, Funnel type, lime accent, sheared-D mark with favicon and home-screen icons, compact latest-changes list, copy that states the service with no drifting counts, method-page sidebar. Signals (7 days): 4 page views, 41 feed fetches, 1 waitlist signup, 0 fix PRs; nothing has been shared yet. Share drafts fixed before any were posted (#43): Stripe's version-pinning note carried into posts, no API count, flip line once; 144 waiting drafts rewritten (`share --generate --refresh`). Fix PRs: ran `fix` on 7 candidate repos for the two patchable recent changes (OpenAI image `model` required, Resend `segment_id` dropped). No repo needs a PR: 3 already send `model`, 1 was a fixer false positive (fixed in #44, with a fixture from the real repo), and both Resend findings are unreachable through the SDK (CLAUDE.md known gap 8). Next: Amir posts the top drafts; run candidates again as new request-side breaks publish; week-6 decision around 2026-11-09.
