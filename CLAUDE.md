# Working on Driftwatch

Consumer-side breaking-change radar for third-party APIs. It watches the
OpenAPI specs a team *depends on* and reports what a vendor broke.

Every other diff tool in this space (oasdiff, Bump.sh, Specway, Optic) is
producer-side: you point it at your own spec to avoid breaking your own
customers. Driftwatch points the other way. That inversion is the product, not
a detail, and several rules invert with it.

## Do not undo these

Each of these looks wrong at first glance and was measured against real
provider history. If you are about to "fix" one, read the note first.

**1. Schema walks stop at every `$ref`.** (`packages/core/src/diff/schema.ts`)

Following refs inline looks obviously correct. It is catastrophic. Stripe's
schemas nest deeply through shared components, so one enum gaining a value gets
rediscovered along every path that reaches it. Measured: a single `fpx.bank`
change surfaced **2319 times** in one diff, and one release pair produced
**4528** "breaking" changes. Shared components are diffed once each in
`diffComponents`, per direction they are used in, carrying the count of
operations that reach them. The same release now yields 6.

**2. `--follow` cannot be combined with `--reverse`.** (`apps/worker/src/acquire/git.ts`)

Git's `--follow` is a rename-detection hack layered on history simplification.
On `twilio/twilio-oai`, whose spec has moved four times, `--follow --reverse`
returns **1** revision where `--follow` alone returns **168**. It fails
silently and looks exactly like a provider that never ships changes. Take
git's newest-first order and reverse in JS.

**3. `bundle()`, never `dereference()`.** (`packages/core/src/normalize/index.ts`)

Dereferencing a real spec produces circular JS objects (Stripe's Charge
references Customer references Charge) which cannot be serialized or hashed.
Bundling also means a shared component change surfaces once rather than at
every inlining call site.

**4. Severity is a pure lookup. No model participates.** (`packages/core/src/diff/rules.ts`)

The same pair of specs always yields the same classification, so a wrong call
is a findable bug rather than an unreproducible generation. `renderImpact`
writes prose and code patterns from templates for the same reason. `enrich()`
is the only seam where a model may rewrite body prose; it cannot touch
headlines, and severity is not in scope at all. Publishing how severity is
decided (`/method` renders the live ruleset) is the product's main claim in a
category where the only thing being sold is trust.

**5. Fingerprints are sha256 hex.** (`fingerprintOf`)

An earlier version joined parts with a NUL byte. Postgres refuses `0x00` in a
text column, so **every** `change.createMany` failed and not one change was
ever persisted, while all 43 unit tests passed. Never build a key by
concatenating with control characters. NUL is also stripped at the write
boundary in `diffing.ts`, since JSON permits it inside a string and a provider
description could carry one.

Endpoint-surface rules (`path.*`, `operation.*`) also hash method and path
(`LOCATION_KEYED_RULES`). Without them every endpoint removed in a release was
one fact, so a review decision on one carried to the others; GitHub's 11 moved
enterprise endpoints came up as "1 distinct fact". Every other fingerprint is
unchanged, and a test pins the old formula, because decisions are carried
across ruleset bumps by fingerprint and a silent change would unpublish the
feed. Rows stored before the change need `pnpm w refingerprint` (idempotent,
endpoint rules only: recomputing the rest from jsonb, which reorders keys, is
not safe).

**6. Direction is load-bearing, and three rules invert.**

On a request, losing a property and gaining a requirement are the breaks. On a
response, losing a property and losing a guarantee are. Running the walker with
the wrong direction produces a plausible, completely wrong severity. The three
flips (`directionFlip: true`) are why anyone subscribes:

- `response.property.became-optional` — safe for a producer, a null deref for you
- `response.enum.value-added` — additive for a producer, breaks exhaustive switches
- `request.param.removed` — raises no error at all; results quietly change

**7. Relaxations are not breaks.** Found only by running against real data:

- A dropped `enum` keyword is a **widening**, not the withdrawal of every
  value. Stripe's `ui_mode` reported "no longer accepts custom, embedded, form,
  hosted", every value it had ever had. On a *response* the same edit is the
  opposite and must be caught: an unconstrained field can return anything.
- A **request** field gaining null is a relaxation; existing payloads still
  work. On a response it is a lost guarantee.
- A `$ref` repoint is usually a **rename**. Targets are compared: identical
  shape is cosmetic, anything else is BEHAVIORAL at confidence 80, below the
  publish threshold on purpose.
- **A response narrowing its type is a tighter guarantee.** OpenAI's
  `ChatCompletionList.first_id` and Stripe's `expected_debit_date` went
  `null|string → string` and were called breaking retypes at confidence 95.
  Everything a narrowed response can return it could already return, so it
  is `response.property.type-narrowed` (additive). Narrowed all the way to
  `null` is `response.property.now-always-null`, behavioral at 80: nothing
  throws but the value is gone, and the real cases (Twilio, Stripe) look like
  generator artifacts. On a request, narrowing is still a break.
- **An optional response field gaining null has no guarantee to lose.**
  Square's move from Swagger 2.0 to OpenAPI 3.0 annotated 1759 fields
  nullable, 6 of them required: 841 "breaking" changes from one format
  migration. A field its parent did not require is now
  `response.property.optional-now-nullable`, behavioral at 80 (held). A
  required field, array items, or a root schema gaining null is still
  `response.property.became-optional`, BREAKING. Real case: OpenAI's required
  `EvalRun.model` went `string → string|null`.
- **Two spellings of "X or null" are one schema.** OAS 3.0's
  `allOf: [X, {nullable: true}]` and 3.1's `anyOf`/`oneOf: [X, {type: "null"}]`
  mean the same thing, but only `allOf` is flattened, so OpenAI switching
  spelling on `Upload.file` read as 16 breaking changes. `unwrapNullable`
  rewrites the union form, but only when neither side is left as a genuine
  union: rewriting one side of `X | null` → `X | null | {}` produced 6 new
  false breaks, where the raw forms give one composition change.

**8. `allOf` members are never sorted.** Later members override earlier ones,
so order carries meaning. `enum`, `required`, `security`, `tags` and
`parameters` (by name and location) are sorted, because those are sets and
generators shuffle them constantly.

**9. Order snapshots by `providerTime`, never `capturedAt`.** A backfill writes
four years of history in one afternoon; fetch time would scramble the sequence.

**10. A failed `DiffRun` is deleted and redone.** The
`(fromId, toId, rulesetVer)` uniqueness that makes re-running free also means a
failure would otherwise be skipped forever, leaving a permanent hole in the
history with no way to fill it short of wiping the database. The same goes
for a run with no `finishedAt`: a killed process records no error, and a
cancelled re-diff left a PagerDuty run with no rows that every later pass
skipped. The workflow's concurrency group guarantees no live job owns it.

**11. The Prisma client loads lazily, via `createRequire`.**
(`apps/worker/src/db.ts`) Before `prisma generate` has run, a static ESM import
of `@prisma/client` fails while the module graph is being built and takes down
the whole CLI, including `verify`, `preview` and `discover`, none of which need
a database. Same reason `config.ts` does not require `DATABASE_URL` at import.

**12. A relative `DATA_DIR` anchors to the repo root**, not `process.cwd()`.
pnpm runs filtered scripts inside their own package, so a cwd-relative path
would give `pnpm w` and a root-run command two different caches, and a second
multi-gigabyte clone of every provider repo.

**13. Spec blobs live in R2 when it is configured.** (`apps/worker/src/blobs.ts`)
The scheduled job runs on a GitHub Actions runner whose disk is wiped after
every run, and `diff` reads the previous version's normalized blob back, so
local disk cannot be the store there. Postgres holds only the keys. Keys are
identical on both backends. All three `R2_*` settings or none: a partial set
throws rather than falling back to local disk, because a silent fallback on a
runner stores every blob somewhere about to be thrown away. Git clones still
live under `DATA_DIR`; they are cheap to rebuild (partial, blobless).

**14. Neon URLs carry `connect_timeout=30`.** Neon's free tier suspends after
about 5 minutes idle and wakes in a few seconds; Prisma's default connect
timeout is 5 seconds. Without the parameter, the first command after any pause
fails with a connection error, and the scheduled job (every 6 hours) always
starts after a pause. It showed up as a persist test failing at 5.16s and a
`seed` that failed once and then worked.

**15. Review and the feed read only the current `RULESET_VERSION`.** A bump
re-diffs every pair and keeps the old runs, so without the filter a fixed false
positive would sit in review beside its correction, and publishing would
publish both. Human decisions survive a bump: `diffPair` carries `publishedAt`
forward for a fact published on the same pair under an earlier ruleset with the
same fingerprint and severity. Anything new or reclassified goes back to review.
Rejections carry forward the same way: `review --reject <text>` sets
`reviewedAt` without `publishedAt`, for facts no rule can see are wrong. First
use: GitHub moved its enterprise-team endpoints from the `api.github.com`
description into `ghec` on 2026-09-22, which reads as 10 removed endpoints. Because the site filters
on its own version, a bump must be re-diffed *before* it is merged, or the live
feed is empty until the next scheduled run: see "Bumping RULESET_VERSION" in
`docs/DEPLOY.md`.

**16. `security` is a list of alternatives.** Any one entry is enough; the
schemes inside one entry are required together. Flattening the list into one
scheme→scopes map read "you may now also use an API key" as "authentication
scheme changed", BREAKING at 90. A change breaks a caller only if an old
alternative's credentials meet no new one. An operation that declared no
security before is still skipped: providers often start documenting auth that
was always required.

**17. Every rule in the catalog has a test that fires it.** A test in
`diff.test.ts` enforces it. `cosmetic.description-changed` sat in the catalog,
emitted by nothing, while `/method` told readers description edits were
stored as cosmetic; they are ignored entirely.

**18. A conditional GET sets its own `Cache-Control: max-age=0`.**
(`apps/worker/src/acquire/http.ts`) The Fetch standard puts a request carrying
`If-None-Match`/`If-Modified-Since` into cache mode "no-store", which appends
`Cache-Control: no-cache` unless the request sets one. Hetzner's server answers
no-cache with a full 200 and ignores the validators, so every poll downloaded
3.5MB it already had while curl, sending the same validators, got a 304.

**19. Every poll records each source's health, and a person is told.**
`lastFetchAt`, `lastSuccessAt`, `lastChangeAt`, `lastError` and
`consecutiveFailures` on `SpecSource`; `health.ts` calls a source failing after
one failed attempt and stale after 24h without success. `pnpm w report` lists
unhealthy sources and stories waiting for review, and the scheduled job keeps
one GitHub issue (label `review-queue`) in sync with it, commenting when the
counts change so it notifies. Before this, a failing source was logged once
and forgotten, and twelve new facts sat unreviewed for a day.

**20. Version-per-file specs set `followRenames: false`.** (`registry.ts`)
Adyen keeps `CheckoutService-v71.json`, `-v72.json`; Clerk keeps one dated file
per version. Git's rename detection stitched those into one history, so a
version upgrade callers opt into would read as breaking changes to the version
they are on. It also linked Asana's spec to `README.md`. With the flag,
history keeps only revisions written at the current path. A new major version
is a registry change.

**21. A spec that stopped being maintained is removed, not tracked.** Slack's
`slack-api-specs` has not changed since 2020; everything it produced was five
years old and describes an API Slack has since moved on from. Removing a source
from the registry makes `seed` deactivate it, and `review`/`report` skip
inactive sources.


**22. Share drafts are templates, and nothing posts itself.**
(`packages/core/src/impact/share.ts`) The same reason as note 4: a template
cannot claim a fact the diff did not find, and a post under the founder's name
is the last place for an invented one. `pnpm w share` lists drafts with an X
compose link; a person presses Post. Never add an automatic poster.

**23. The fixer finds; a person decides.** (`apps/fixer`) It reads a change
from `/api/changes/<id>` and the provider's spec at that change's commit, and
recomputes affected operations with core's usage index rather than storing
them. A match needs at least one literal path segment, and a known host that
is not the provider's never matches, so a dynamic `fetch(url)` is never
reported. A call through a wrapper of the repo's own (`window.api.xfetch.post(url)`,
anime.gf's way of calling OpenAI) counts only when its URL is on the
provider's host and the function reads as a request (an HTTP verb, or
fetch/request/http in its name), and only ever at medium. SDK calls count only on a known client (a value created from the
provider's official package, in the file or in a module of the repo's own
that exports it or a function returning it: `lib/stripe.ts`, `initStripe()`); method names come from `operationId` where the
SDK is generated from it (GitHub, Plaid) and from the path's REST shape
otherwise (Stripe, OpenAI). Field access is traced from a matched call's
value, never matched by name alone: through `await`, `.json()` (fetch, ky),
`.data` (axios, Octokit), `.then`, destructuring, and a function's return
into its callers in any file that imports it: resolved by the compiler with
the nearest tsconfig.json or jsconfig.json (`paths` aliases like `@/lib`,
monorepo packages), through barrel re-exports, default and namespace imports
(`scan/modules.ts`). Matching relative paths only missed every read behind
an alias, silently. A name-only read is a
`low` guess, and only on a parameter or class field in a file the trace
reached, for a distinctive name: a local that came from another call is the
trace's to follow, and `id` or `email` is read off everything. It never opens
a pull request (brief, M4 and section 8).

**24. `fix` patches only what both specs say plainly.** (`apps/fixer/src/fix`)
A removed field is a **rename** only with exactly one new sibling of the same
shape (refs resolved, prose dropped) whose description matches bar the words of
the names: Plaid's `protect_session_id` → `device_session_id`, Cloudflare's
`integration` → `provider`. Stripe Checkout's `allowed_payment_method_types`
has the same shape as the `payment_method_types` it sits beside, and says
"Unlike `payment_method_types`, this acts as a filter": not a rename. A new
field with a related name and another shape (`filters.countries` →
`country`) blocks a **removal** too, since deleting the old one would drop the
filter. A removal also needs the field optional before and a value with no
call in it. A newly required field is **added** only with a value the *new*
spec documents (const, one-value enum, default, never a deprecated one):
OpenAI made image `model` required and dropped its `dall-e-2` default in the
same release, because that model was retired. Decisions key on operation and
field: one release removed `payment_method_types` from PaymentIntents and
maybe replaced it on Checkout. Every patch is typechecked with the repo's own
config; one that introduces an error is dropped and listed, never shipped.
Fixture specs are real, cut down with `scripts/trim-spec.ts`. `pr-body` is
templates over `fix --json`, for the same reason as note 4: a maintainer is
asked to trust it.

## Layout

```
packages/core/          pure, no I/O, no database
  normalize/            parse · upgrade swagger2 · bundle · canonicalize · hash
  diff/                 structural diff · usage index · ruleset · classify
  impact/               headline · explanation · breaking code pattern
apps/worker/            the pipeline CLI
  registry.ts           seed list with ordered filePathCandidates
  acquire/git.ts        partial clone, rename-aware history, read-at-commit
  acquire/http.ts       hosted URL fetch for tier B
  blobs.ts              content-addressed blob store: R2, or DATA_DIR/blobs
  store.ts              the ONE write path into SpecSnapshot
  diffing.ts            the ONE write path into DiffRun and Change
apps/web/
  lib/queries.ts        Prisma reads to plain view models
  lib/feeds.ts          RSS 2.0 and JSON Feed 1.1 from release views (pure)
  lib/waitlist.ts       the only gate for /watch submissions (pure)
  lib/site.ts           SITE_URL: feeds, canonicals and sitemap never use the request host
  app/                  /, /apis/<api>, /changes/<storyId>, /watch, feeds, sitemap
  components/           pure presentation, no data access
  scripts/              render-check: verifies the UI with no database
apps/mcp/               stdio MCP server over /api/feed.json
apps/fixer/             `driftwatch` CLI (M4): scan a repo for code a published change breaks
  src/scan/             finders (http: fetch/axios/ky; sdk: official SDK clients), file walk, TS parsing
  src/fix/              spec verdicts (rename, removal, documented value), edits, diff, typecheck, repo tests
  src/prbody.ts         PR title and description from `fix --json`, templates only
  src/candidates.ts     public repos worth scanning for a change, from GitHub code search (lists only)
  src/eval.ts           precision/recall against fixtures/ (markers: `driftwatch-expect: <kind>[, <kind>]`)
  fixtures/             consumer repos + the real change and specs each is scanned for; expected.patch per fixed one
  scripts/trim-spec.ts  cut a real normalized spec down to a fixture
prisma/schema.prisma    full model, including the unbuilt GitHub App tables
```

Presentation is split from data access on purpose. It is what lets the whole
visual layer be checked without a database.

## Commands

| Command | Needs a database |
| --- | --- |
| `pnpm w verify [slug]` | no |
| `pnpm w preview <target>` | no |
| `pnpm w discover <slug>` | no |
| `pnpm w seed` / `backfill` / `diff` / `review` / `poll` / `status` / `report` / `share` / `signals` / `pr log` | yes |
| `pnpm check` (build and test everything) | no |

`pnpm w verify` and `pnpm w preview` are the real integration tests. They run
against live provider repos. **Every bug worth finding in this project so far
was found by them, not by the unit tests.** Run `preview` after any ruleset
change and read the output before trusting it.

## Conventions

- **Never add Claude attribution to commits.** No `Co-Authored-By`, no
  "generated with" trailers, no attribution lines of any kind.
- A pre-commit hook runs build and tests. A type error reached a commit once.
- `packages/core` has a `prepare` script so `pnpm install` builds `dist/`. The
  worker and the site import core by that dist path, so a stale `dist` means
  you are running old rules.
- Changes below confidence 85, and all cosmetic ones, never reach the feed.
  Above that, the auto-publish policy (`packages/core/src/diff/policy.ts`,
  rendered on `/method`) publishes the shapes verified many times over and
  holds the shapes behind every false positive found so far: endpoint or
  operation removals, authentication changes, everything in a spike release,
  and a new source's first stories. Held stories reach a person through the
  `review-queue` issue. Precision over recall, without apology: one false
  breaking change costs a subscriber permanently. A new kind of false positive
  means a new held shape in the policy, with its real case in the test.

## Known gaps

1. **Postgres persist test exists.** `apps/worker/src/persist.test.ts` hits
   the real write path. It is skipped when `DATABASE_URL` is unset so
   `pnpm check` still runs without Postgres.
2. **Feed additive collapse shipped.** `response.property.added` and
   `request.property.added` each collapse to one line per release when a
   release has two or more; `path.added` and `operation.added` stay as cards;
   additive headlines are specific; home ranks releases with a break,
   deprecation or behavioural shift first.
3. **Stories group repeated facts.** (`packages/core/src/diff/story.ts`)
   A year of Stripe produced 214 distinct breaking facts but only 109 things
   that happened: one new enum value lands in up to 7 components, one
   correction removed `igic` under 26 countries, and a field that stops being
   required *and* becomes nullable fires `became-optional` twice. `storyKeyOf`
   decides what `review` approves as one decision and the feed shows as one
   card. It never changes severity, which is part of every key, and every fact
   is still stored on its own for the GitHub App. The opposite shape groups too:
   five or more fields removed (or no longer guaranteed) under one parent in
   one release are one story about that parent. Vercel cut a user-event
   payload's `newOwner` from 78 fields to 2, which was 76 cards.
4. **Verified.** `request.param.removed` on GitHub's classroom `page` /
   `per_page` was not a walker bug. Commits `33438507 → 1048c01d` dropped the
   `$ref`s from three operations while the shared parameter components stayed,
   still referenced by 250+ other operations. Resolving `$ref`s before compare
   made that look like a withdrawal. Those drops are now
   `request.param.unlisted` (cosmetic, never published). A parameter that
   vanishes from the whole API is still `request.param.removed`.
5. **Tier B acquisition shipped.** `acquire/http.ts` GETs a hosted spec URL.
   Seed, poll, backfill, verify and discover branch on tier. The first B
   source is Hetzner Cloud (`https://docs.hetzner.cloud/cloud.spec.json`).
   Hosted sources have no git history: the first snapshot is "now".
7. **A break hidden behind a component rename is not reported.** Components
   are diffed by name, so when a provider renames `Pet` to `Animal` and drops
   a field in the same release, the two are never compared: the repoint is
   `schema.ref-retargeted` at 80 (held) and the removal goes unreported.
   Precision-safe, a recall gap. The fix is diffing old and new targets at the
   repoint (once per pair, not per site, see note 1). `refactor.test.ts` pins
   the current behaviour and flips when it is fixed.
6. **The GitHub App is deliberately not built.** It is the revenue half, and
   building it before the feed proves anyone cares is how this becomes a
   portfolio project with a business model nobody asked for. The signal to wait
   for is one person saying the digest caught something before it hit their
   production.

## When changing the ruleset

1. Add or edit the rule in `packages/core/src/diff/rules.ts`.
2. Add a test in `diff.test.ts`, ideally built from a real case.
3. Run `pnpm w preview stripe -n 6` and read the output. Synthetic fixtures
   prove a rule fires; only real history shows whether it fires at a rate
   anyone would tolerate in an inbox.
4. Bump `RULESET_VERSION` if classifications changed. That re-diffs stored
   pairs without destroying the previous run's history.
