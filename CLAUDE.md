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

**8. `allOf` members are never sorted.** Later members override earlier ones,
so order carries meaning. `enum`, `required`, `security`, `tags` and
`parameters` (by name and location) are sorted, because those are sets and
generators shuffle them constantly.

**9. Order snapshots by `providerTime`, never `capturedAt`.** A backfill writes
four years of history in one afternoon; fetch time would scramble the sequence.

**10. A failed `DiffRun` is deleted and redone.** The
`(fromId, toId, rulesetVer)` uniqueness that makes re-running free also means a
failure would otherwise be skipped forever, leaving a permanent hole in the
history with no way to fill it short of wiping the database.

**11. The Prisma client loads lazily, via `createRequire`.**
(`apps/worker/src/db.ts`) Before `prisma generate` has run, a static ESM import
of `@prisma/client` fails while the module graph is being built and takes down
the whole CLI, including `verify`, `preview` and `discover`, none of which need
a database. Same reason `config.ts` does not require `DATABASE_URL` at import.

**12. A relative `DATA_DIR` anchors to the repo root**, not `process.cwd()`.
pnpm runs filtered scripts inside their own package, so a cwd-relative path
would give `pnpm w` and a root-run command two different caches, and a second
multi-gigabyte clone of every provider repo.

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
  store.ts              the ONE write path into SpecSnapshot
  diffing.ts            the ONE write path into DiffRun and Change
apps/web/
  lib/queries.ts        Prisma reads to plain view models
  components/           pure presentation, no data access
  scripts/              render-check: verifies the UI with no database
apps/mcp/               stdio MCP server over /api/feed.json
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
| `pnpm w seed` / `backfill` / `diff` / `review` / `poll` / `status` | yes |
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
- Nothing auto-publishes. Changes below confidence 85, and all cosmetic ones,
  never reach the feed; everything else waits for `pnpm w review --publish`.
  Precision over recall, without apology: one false breaking change costs a
  subscriber permanently.

## Known gaps

1. **Postgres persist test exists.** `apps/worker/src/persist.test.ts` hits
   the real write path. It is skipped when `DATABASE_URL` is unset so
   `pnpm check` still runs without Postgres.
2. **Feed additive collapse shipped.** `response.property.added` collapses to
   one line per release when a release has two or more; `path.added` and
   `operation.added` stay as cards; additive headlines are specific; home
   ranks releases with a break, deprecation or behavioural shift first.
3. **Verified.** `request.param.removed` on GitHub's classroom `page` /
   `per_page` was not a walker bug. Commits `33438507 → 1048c01d` dropped the
   `$ref`s from three operations while the shared parameter components stayed,
   still referenced by 250+ other operations. Resolving `$ref`s before compare
   made that look like a withdrawal. Those drops are now
   `request.param.unlisted` (cosmetic, never published). A parameter that
   vanishes from the whole API is still `request.param.removed`.
4. **Tier B acquisition shipped.** `acquire/http.ts` GETs a hosted spec URL.
   Seed, poll, backfill, verify and discover branch on tier. The first B
   source is Hetzner Cloud (`https://docs.hetzner.cloud/cloud.spec.json`).
   Hosted sources have no git history: the first snapshot is "now".
5. **The GitHub App is deliberately not built.** It is the revenue half, and
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
