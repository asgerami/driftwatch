# Driftwatch

A consumer-side breaking-change radar for third-party APIs.

Every OpenAPI diff tool on the market is producer-side: you point it at your own
spec, in your own CI, to stop yourself from breaking your own customers.
Driftwatch points the other way. It watches the specs you *depend on* and tells
you when a vendor broke you.

```
acquire → normalize → diff → classify → render → publish
   ●          ●         ●        ●         ●         ●
```

The pipeline is complete end to end. What is not built yet is the GitHub App
that opens fix PRs, which is deliberately the second thing.

## Quick start

```bash
pnpm install          # also builds packages/core via its prepare script
cp .env.example .env

pnpm w verify            # no DB: resolve paths, walk history, normalize HEAD
pnpm w preview stripe    # no DB: diff real revisions and print them

pnpm db:up               # postgres on :5433
pnpm generate            # prisma client
pnpm db:push             # apply schema

pnpm w seed              # clone repos, resolve spec paths, write providers
pnpm w backfill -n 25    # walk git history, ingest distinct versions
pnpm w diff              # diff consecutive pairs, persist typed changes
pnpm w review            # inspect what is pending (read-only)
pnpm w review --publish  # open the gate
pnpm web                 # the feed on :3000
node apps/mcp/dist/index.js   # stdio MCP over that feed (after pnpm install)
```

`verify` and `preview` need no database and no Prisma client, so they are the
fastest way to confirm the whole acquisition and diff path works.

## What it finds

`pnpm w verify`, against the live repos:

```
stripe/api             1225 revisions  2017-09-05 → 2026-08-26   594 ops
openai/api              275 revisions  2022-01-19 → 2026-09-11   338 ops
twilio/api_v2010        168 revisions  2020-08-18 → 2026-09-09   197 ops
twilio/messaging_v1     147 revisions  2020-08-18 → 2026-09-09    58 ops
github/rest             926 revisions  2020-07-27 → 2026-09-12  1229 ops

2741 revisions available to backfill across 4 providers.
```

Nine years of Stripe history on day one, before a single subscriber exists.
That is the whole argument for starting with tier A.

`pnpm w preview`, on real consecutive releases:

```
stripe/api   2026-08-26   11 breaking  64 additive
  ▪ response.enum.value-added [flip]
      payment_intent.allowed_payment_method_types[] [579 ops] (can now return "touch_n_go")
  ▪ response.property.removed
      …three_d_secure.cryptogram [48 ops]
  ▪ response.property.type-changed
      terminal.location.address [19 ops] (address → address_api_resource_terminal)

openai/api   2026-09-11   1 breaking
  ▪ response.enum.value-added [flip]
      SessionTurnErrorCodeResource [6 ops] (can now return "credit_balance_exhausted")

github/rest  2026-09-11   2 behavioral
  ▪ response.status-code.added
      GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number} (410 is now documented)
```

## Commands

| Command | Needs DB | What it does |
| --- | --- | --- |
| `pnpm w verify [slug]` | no | Resolve paths or hosted URLs, normalize HEAD, check hash stability |
| `pnpm w preview <target>` | no | Diff real revisions straight from git and print them |
| `pnpm w discover <slug>` | no | List spec-shaped files in a repo, or confirm a hosted URL |
| `pnpm w seed` | yes | Upsert providers. Clone repos for A; record hosted URLs for B |
| `pnpm w backfill [target]` | yes | Walk git history (or fetch a hosted URL) and ingest distinct versions |
| `pnpm w diff [target]` | yes | Diff consecutive pairs, persist typed changes |
| `pnpm w review [target]` | yes | The publish gate. Read-only without `--publish` |
| `pnpm w poll [target]` | yes | Fetch current head, ingest only if the surface changed |
| `pnpm w status` | yes | Snapshot counts, date range, resolved path or URL per source |
| `node apps/mcp/dist/index.js` | no | Stdio MCP server. Reads `/api/feed.json`, not Postgres |

`target` is a provider slug (`stripe`) or a source (`twilio/messaging_v1`).

The live feed is at [driftwatch.et](https://driftwatch.et), and the MCP server
reads it by default. Point `DRIFTWATCH_FEED_URL` at
`http://localhost:3000/api/feed.json` to use a local site instead. Invoke the
built binary directly so
the stdio channel stays JSON-RPC — `pnpm mcp` prints a script banner and
breaks the protocol:

```json
{
  "mcpServers": {
    "driftwatch": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"],
      "env": { "DRIFTWATCH_FEED_URL": "https://driftwatch.et/api/feed.json" }
    }
  }
}
```

The server never opens Postgres. It reads the same published JSON a human
sees, so an unpublished change cannot leak through a side channel.

## How it works

### Acquisition

A spec tracked in a public git repo (tier A) hands you its own history. That
is the cold-start unlock: the feed launches with an archive rather than an
empty page. A spec that only exists at a hosted URL (tier B) has no history;
the first snapshot is "now", and ingest is otherwise identical.

| Provider | Source |
| --- | --- |
| Stripe | `stripe/openapi` |
| OpenAI | `openai/openai-openapi` |
| Twilio | `twilio/twilio-oai` |
| GitHub | `github/rest-api-description` |
| Hetzner | `https://docs.hetzner.cloud/cloud.spec.json` (tier B) |

The exact **file path** inside each repo is documented nowhere and does move, so
`registry.ts` declares ordered `filePathCandidates` and `seed` resolves the
first that exists at HEAD. A wrong guess fails loudly at seed time, and
`pnpm w discover <slug>` then lists every spec-shaped file with sizes, marking
those that declare `openapi:` or `swagger:` in their first 4KB.

Clones are partial (`--filter=blob:none --no-checkout`). Blobs arrive lazily via
`git show`, so you only pay for the spec files you actually read.

History uses `--follow`, and each revision carries **the path it was written
at**. Twilio's core spec has lived at four paths, `json/twilio_api.json` →
`spec/twilio_api.json` → `spec/json/twilio_api.json` →
`spec/json/twilio_api_v2010.json`. Without per-revision paths, every commit
before a move fails to read.

> One trap, documented in `acquire/git.ts`: **`--follow` cannot be combined with
> `--reverse`.** On `twilio/twilio-oai` that pairing returns 1 revision where
> `--follow` alone returns 168. It fails silently and looks exactly like a
> provider that never ships changes.

### Normalization is where the noise dies

One false `BREAKING` and a subscriber is gone for good. Generators are not
stable: key order shifts, parameter lists reorder, enum values come out in a
different sequence. None of that is a change to the API.

`@driftwatch/core` therefore parses JSON or YAML, upgrades Swagger 2.0 in patch
mode, **bundles** `$ref`s rather than dereferencing them (dereferencing a real
spec produces circular objects that cannot be hashed), strips per-source
volatile pointers, sorts object keys and the arrays that are semantically sets
(`enum`, `required`, `security`, `tags`, and `parameters` by `(in, name)`), then
hashes. `allOf` is deliberately left alone, because later members override
earlier ones.

### Shared components are diffed once, not once per call site

The most important decision in the codebase, and it was found by running the
first implementation against real history rather than fixtures.

Following `$ref`s inline looks correct. In practice Stripe's schemas nest
deeply through shared components, so one enum gaining a value gets rediscovered
along every path that can reach it. Measured: a single change to `fpx.bank`
surfaced **2319 times** in one diff, and one release pair produced **4528**
"breaking" changes.

Schema walks now stop at every `$ref`. Components are diffed once each, per
direction they are used in, and carry the number of operations that can reach
them. The same release now yields **6** breaking changes, each a distinct real
fact. Roughly a 750x reduction with no loss of signal.

Repointing a field at a *different* component is still caught at the operation
level, because the component diff cannot see it.

### Relaxations are not breaks

Three false positives that only real provider data exposed, each fixed with a
rule of its own:

- **A dropped `enum` is a widening.** Stripe's checkout `ui_mode` reported "no
  longer accepts custom, embedded, form, hosted", every value it had ever had.
  The keyword had simply been removed, which accepts *more*, not less. On a
  response the same edit is the opposite and was previously missed entirely:
  an unconstrained field can return anything.
- **A request field gaining `null` is a relaxation.** GitHub's
  `custom-property-value.value` went `string` to `null|string` and was called a
  breaking retype. You can now send null where you could not before; every
  existing payload still works. On a response, the same edit is still a lost
  guarantee.
- **A `$ref` repoint is usually a rename.** Providers split and rename shared
  schemas constantly. Targets are now compared: identical shape is cosmetic,
  anything else is `BEHAVIORAL` at confidence 80, which sits below the publish
  threshold on purpose. This alone removed 5 of the 11 "breaking" changes in
  Stripe's 2026-08-26 release.

### The consumer direction

Producer tools ask "does this break my callers?" Three rules invert on the
calling end, and they are why anyone subscribes:

1. `response.property.became-optional` — safe for a producer, a null
   dereference waiting to happen for you. Also fires when a field merely
   becomes nullable.
2. `response.enum.value-added` — additive for a producer. Breaks exhaustive
   switches, strict parsers and generated client enums.
3. `request.param.removed` — raises no error at all. The provider ignores the
   argument and your results quietly change.

The full ruleset lives in `packages/core/src/diff/rules.ts` and is rendered
live on the site's `/method` page, so the published explanation cannot drift
from the actual behaviour.

### Severity is deterministic

Assigned by a pure lookup in the ruleset. No model participates, so the same
pair of specs always yields the same classification and a wrong call is a bug
in a rule rather than an unreproducible generation.

Impact rendering (headline, explanation, breaking code pattern) is templated
for the same reason: a template cannot invent a field that does not exist.
`enrich()` is the seam where a model may later rewrite body prose. It cannot
touch the headline, and severity is not in scope at all.

### Nothing publishes itself

Changes below 85 confidence never reach the feed, cosmetic changes never do at
any confidence, and everything else waits for `pnpm w review --publish`.
Precision over recall, without apology.

## Layout

```
packages/core/
  normalize/     parse · upgrade · bundle · canonicalize · hash
  diff/          structural diff · usage index · ruleset · classify
  impact/        headline · explanation · breaking code pattern
apps/worker/
  registry.ts    the seed list and its candidate paths
  acquire/git.ts partial clone, rename-aware history, read-at-commit
  store.ts       the one write path into SpecSnapshot
  diffing.ts     the one write path into DiffRun/Change
  commands/      verify · preview · discover · seed · backfill · diff · review · poll · status
apps/web/
  lib/           Prisma queries → plain view models
  components/    pure presentation, no data access
  scripts/       render-check: verifies the UI with no database
prisma/          full model, including the GitHub App tables
```

`pnpm check` builds and tests everything. A pre-commit hook runs it, because a
type error reached a commit once already.

`packages/core` compiles to `dist/`, and the worker and site import it by that
path. Its `prepare` script builds it, which pnpm runs for every workspace
project on install, so a fresh clone works with nothing but `pnpm install`.
Without that, the first command after cloning fails with a module-not-found on
a file no one has been told to build.

## Testing

- **55 unit tests** in `packages/core` covering normalization determinism,
  every direction flip, ref cycles, `allOf` flattening and impact rendering.
- **Worker tests** covering HTTP acquisition, the registry, and a real
  Postgres persist round-trip.
- **Render checks** in `apps/web` exercising the presentation layer with no
  database, no Prisma client and no network.
- **`pnpm w verify` and `pnpm w preview`** are the integration tests, and they
  run against live provider repos rather than fixtures. Both bugs worth finding
  so far were found by them, not by the unit tests.

## Next

1. **The GitHub App.** Fingerprint which providers, endpoints and response
   fields a repo actually touches, then open a PR when a published change
   intersects it. The static analysis is the same technique as AegisPulse's
   Babel AST traversal. Metric is PRs *merged*, not opened. Wait for one
   person to say the digest caught something before it hit their production.
2. **Observed responses.** Everything here is spec-derived, which means it is
   diffing documentation, not behaviour. Watching real response shapes is a
   much larger product and the natural direction after the feed proves itself.
