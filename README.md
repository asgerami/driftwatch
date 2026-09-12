# Driftwatch

A consumer-side breaking-change radar for third-party APIs.

Every OpenAPI diff tool on the market is producer-side: you point it at your own
spec, in your own CI, to stop yourself from breaking your own customers.
Driftwatch points the other way. It watches the specs you *depend on* and tells
you when a vendor broke you.

This repo currently implements **stages 1 and 2** of the pipeline: acquisition
and normalization. Diffing, classification and the feed come next.

```
acquire → normalize → diff → classify → render
   ▲          ▲         ○       ○          ○
   this slice           not yet
```

## Quick start

```bash
pnpm install
cp .env.example .env

pnpm db:up          # postgres on :5433
pnpm generate       # prisma client
pnpm db:push        # apply schema

pnpm w verify       # no DB needed: resolve paths, walk history, normalize HEAD
pnpm w seed         # clone repos, resolve spec paths, write providers
pnpm w backfill -n 25   # walk git history, ingest distinct versions
pnpm w status       # see what landed
```

`verify` is the fastest way to confirm the whole acquisition path works. It
needs no database. Current output against the live repos:

```
stripe/api             1225 revisions  2017-09-05 → 2026-08-26   594 ops
openai/api              275 revisions  2022-01-19 → 2026-09-11   338 ops
twilio/api_v2010        168 revisions  2020-08-18 → 2026-09-09   197 ops
twilio/messaging_v1     147 revisions  2020-08-18 → 2026-09-09    58 ops
github/rest             926 revisions  2020-07-27 → 2026-09-12  1229 ops

2741 revisions available to backfill across 4 providers.
```

Nine years of Stripe history, on day one, before a single subscriber exists.
That is the whole argument for starting with tier A.

`seed` clones four repos with `--filter=blob:none`, so the first run pulls the
commit graph but not every historical blob. Expect a few minutes and a few
hundred megabytes under `.data/`.

Start with `-n 25` per source. Dropping the limit walks the full history, which
on `github/rest-api-description` is thousands of commits against a spec of tens
of megabytes and will take a while.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm w verify [slug]` | Resolve paths, walk history, normalize HEAD, check hash stability. No database. |
| `pnpm w seed` | Clone registry repos, resolve each spec's real path, upsert providers and sources |
| `pnpm w discover <slug>` | List files in a provider's repo that look like OpenAPI documents |
| `pnpm w backfill [target]` | Walk git history oldest-first, ingest every distinct version |
| `pnpm w poll [target]` | Fetch current head, ingest only if the normalized surface changed |
| `pnpm w status` | Snapshot counts, date range and resolved file path per source |

`target` is a provider slug (`stripe`) or a specific source (`twilio/messaging_v1`).

## How it works

### Acquisition is tier A only, for now

A spec tracked in a public git repo hands you its own history. That is the
cold-start unlock: the feed launches with an archive rather than an empty page.
Four providers are seeded, all verified as publishing OpenAPI in public repos:

| Provider | Repo |
| --- | --- |
| Stripe | `stripe/openapi` |
| OpenAI | `openai/openai-openapi` |
| Twilio | `twilio/twilio-oai` |
| GitHub | `github/rest-api-description` |

The exact **file path** inside each repo is not documented anywhere and does
move, so `registry.ts` declares ordered `filePathCandidates` and `seed` resolves
the first one that actually exists at HEAD. A wrong guess fails loudly at seed
time. When it does, `pnpm w discover <slug>` lists every spec-shaped file in the
repo with sizes, marking the ones that declare `openapi:` or `swagger:` in their
first 4KB.

Clones are partial (`--filter=blob:none --no-checkout`). Blobs arrive lazily via
`git show`, so you only pay for the spec files you actually read.

History uses `--follow`, and each revision carries **the path it was written
at**. This is not hypothetical: Twilio's core spec has lived at four different
paths, `json/twilio_api.json` → `spec/twilio_api.json` →
`spec/json/twilio_api.json` → `spec/json/twilio_api_v2010.json`. Without
per-revision paths, every commit before a move fails to read and the rename
looks like the API being deleted and a new one appearing.

One trap worth knowing about, documented in `acquire/git.ts`: **`--follow`
cannot be combined with `--reverse`.** On `twilio/twilio-oai` that pairing
returns 1 revision where `--follow` alone returns 168. It fails silently and
looks exactly like a provider that never ships changes. We take git's
newest-first order and reverse in JS.

### Normalization is where the noise dies

One false `BREAKING` and a subscriber is gone for good. Providers regenerate
specs from source annotations, and generators are not stable: key order shifts,
parameter lists reorder, enum values come out in a different sequence. None of
that is a change to the API.

`@driftwatch/core` therefore, in order:

1. Parses JSON or YAML (OpenAI publishes YAML, Stripe JSON).
2. Upgrades Swagger 2.0 to OAS 3 via `swagger2openapi`, in patch mode, because
   real-world 2.0 documents carry small spec violations.
3. **Bundles** `$ref`s rather than dereferencing them. Dereferencing a real
   provider spec produces circular objects — Stripe's Charge references Customer
   references Charge — which cannot be serialized or hashed. Bundling also means
   a change to a shared component surfaces once instead of at every call site
   that would have inlined it.
4. Strips per-source volatile JSON Pointers (build stamps, rotating example ids).
5. Sorts object keys recursively, and sorts the arrays that are semantically
   sets: `enum`, `required`, `security`, `tags`, and `parameters` by its
   `(in, name)` identity. `allOf` is deliberately left alone, because later
   members override earlier ones and order is load-bearing.
6. Hashes the canonical serialization with sha256.

That hash is the dedup key. Two snapshots with the same hash are the same API
surface regardless of the bytes on disk.

`packages/core/src/normalize/normalize.test.ts` encodes this as tests. If one of
them fails, the feed is about to publish a false positive.

### Storage

Blobs are content-addressed and gzipped under `.data/blobs/<ab>/<hash>.json.gz`,
both raw and normalized. A provider republishing an identical document costs
nothing. Swap `blobs.ts` for object storage when this outgrows one box; nothing
upstream knows where the bytes live.

`SpecSnapshot` is unique on `(sourceId, contentHash)`, which makes ingest
idempotent. An interrupted backfill is resumed by running it again.

Snapshots order by `providerTime` (the commit date), never `capturedAt`. A
backfill fetches four years of history in one afternoon; ordering by fetch time
would scramble it.

## Layout

```
packages/core/          normalize · canonicalize · hash   (pure, tested)
apps/worker/
  registry.ts           the seed list and its candidate paths
  acquire/git.ts        partial clone, rename-aware history, read-at-commit
  store.ts              the one write path into SpecSnapshot
  commands/             seed · discover · backfill · poll · status
prisma/schema.prisma    full model, including the not-yet-used diff tables
```

The Prisma schema defines the whole system up front — `DiffRun`, `Change`,
`Impact`, and the GitHub App tables — even though only the acquisition path is
exercised today. Those land without a destructive migration.

## Next

1. Wire in [oasdiff](https://github.com/oasdiff/oasdiff) for the structural diff.
   Do not write this from scratch; its ruleset is mature and open source.
2. Layer the consumer-direction classifier on top. Three rules invert when you
   sit on the calling end, and those three are the reason anyone subscribes:
   a response property becoming optional, a new enum value in a response, and a
   removed request parameter that throws no error at all.
3. Impact rendering. Severity stays deterministic; a model writes only the prose
   and the breaking code pattern.
