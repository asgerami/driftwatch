import {
  diffDocuments,
  normalizeSpec,
  type Change,
  type JsonObject,
  type Severity,
} from "@driftwatch/core";

import { defaultRef, ensureClone, fileExistsAt, fileHistory, readAtCommit } from "../acquire/git.js";
import { log } from "../log.js";
import { REGISTRY, sourceTier, type RegistryProvider, type RegistrySource } from "../registry.js";

const SEVERITY_ORDER: Severity[] = [
  "BREAKING",
  "DEPRECATION",
  "BEHAVIORAL",
  "ADDITIVE",
  "COSMETIC",
];

const COLOR: Record<Severity, string> = {
  BREAKING: "\x1b[31m",
  DEPRECATION: "\x1b[33m",
  BEHAVIORAL: "\x1b[34m",
  ADDITIVE: "\x1b[32m",
  COSMETIC: "\x1b[90m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[90m";

export interface PreviewOptions {
  /** Number of consecutive revision pairs to diff, most recent first. */
  pairs?: number;
  /** Show every change rather than a per-rule summary. */
  full?: boolean;
  /** Minimum severity to display. */
  min?: Severity;
}

function resolveTarget(target: string): [RegistryProvider, RegistrySource][] {
  const [slug, key] = target.split("/");
  const out: [RegistryProvider, RegistrySource][] = [];
  for (const provider of REGISTRY) {
    if (provider.slug !== slug) continue;
    for (const source of provider.sources) {
      if (!key || source.key === key) out.push([provider, source]);
    }
  }
  return out;
}

/**
 * Diff real consecutive revisions straight out of git, with no database.
 *
 * This is the fastest honest check on the ruleset. Synthetic fixtures prove
 * the rules fire; only real provider history shows whether they fire at a
 * rate anyone would tolerate in an inbox.
 */
export async function preview(
  target: string,
  options: PreviewOptions = {},
): Promise<void> {
  const pairs = options.pairs ?? 5;
  const minIndex = SEVERITY_ORDER.indexOf(options.min ?? "BEHAVIORAL");

  const targets = resolveTarget(target);
  if (targets.length === 0) {
    log.error(`unknown target "${target}" (try: stripe, stripe/api, github/rest)`);
    return;
  }

  for (const [provider, source] of targets) {
    const label = `${provider.slug}/${source.key}`;
    if (sourceTier(source) === "B") {
      log.warn(
        `${label}: hosted URL has no git history to preview — seed, then poll`,
      );
      continue;
    }
    if (!source.repo || !source.filePathCandidates?.length) {
      log.error(`${label}: missing repo or filePathCandidates`);
      continue;
    }

    const dir = await ensureClone(source.repo);
    const ref = await defaultRef(dir);

    let filePath: string | null = null;
    for (const candidate of source.filePathCandidates) {
      if (await fileExistsAt(dir, ref, candidate)) {
        filePath = candidate;
        break;
      }
    }
    if (!filePath) {
      log.error(`${label}: no candidate spec path resolved`);
      continue;
    }

    const history = await fileHistory(dir, ref, filePath, {
      followRenames: source.followRenames,
    });
    const window = history.slice(-(pairs + 1));
    if (window.length < 2) {
      log.warn(`${label}: not enough history to diff`);
      continue;
    }

    console.log(`\n${"─".repeat(76)}\n${label}  ${DIM}${source.repo}${RESET}`);

    const options_ = { volatilePointers: source.volatilePointers ?? [] };
    let previous: JsonObject | null = null;
    let previousRev = window[0]!;

    for (const [index, revision] of window.entries()) {
      const text = await readAtCommit(dir, revision.sha, revision.path);
      const normalized = await normalizeSpec(text, options_);
      const current = normalized.document;

      if (previous === null) {
        previous = current;
        previousRev = revision;
        continue;
      }

      const result = diffDocuments(previous, current);
      const date = revision.date.toISOString().slice(0, 10);
      const sha = revision.sha.slice(0, 8);

      const tally = SEVERITY_ORDER.filter((s) => result.counts[s] > 0)
        .map((s) => `${COLOR[s]}${result.counts[s]} ${s.toLowerCase()}${RESET}`)
        .join("  ");

      console.log(
        `\n${DIM}${previousRev.sha.slice(0, 8)} →${RESET} ${sha}  ${date}  ` +
          (tally || `${DIM}no change${RESET}`),
      );
      if (result.truncated) log.warn("  change cap reached; diff incomplete");

      const shown = result.changes.filter(
        (c) => SEVERITY_ORDER.indexOf(c.severity) <= minIndex,
      );

      if (options.full) {
        for (const change of shown.slice(0, 60)) printChange(change);
        if (shown.length > 60) console.log(`${DIM}  … ${shown.length - 60} more${RESET}`);
      } else {
        printGrouped(shown);
      }

      previous = current;
      previousRev = revision;
      void index;
    }
  }
}

function describe(change: Change): string {
  // A component change belongs to the schema, not to any one endpoint, so it
  // is named by the schema and quantified by how much of the API it reaches.
  const where = change.componentName
    ? `${change.componentName}${change.fieldPath ? `.${change.fieldPath}` : ""}` +
      (change.affectedOperations
        ? ` ${DIM}[${change.affectedOperations} ops]${RESET}`
        : "")
    : `${change.method ? `${change.method.toUpperCase()} ` : ""}${change.path ?? ""}` +
      (change.fieldPath ? ` ${DIM}·${RESET} ${change.fieldPath}` : "");

  const detail = change.detail ? ` ${DIM}(${change.detail})${RESET}` : "";
  return `${where}${detail}`;
}

function printChange(change: Change): void {
  const flip = change.directionFlip ? ` \x1b[35m[flip]\x1b[0m` : "";
  console.log(
    `  ${COLOR[change.severity]}▪${RESET} ${change.ruleId}${flip}  ${describe(change)}`,
  );
}

/**
 * Group by fingerprint, not by rule.
 *
 * The same inline enum can appear across many operations, and that is one
 * piece of news repeated, not many pieces of news. Grouping on the fact and
 * counting the sites is what turns a wall of output into something a person
 * reads over coffee.
 */
function printGrouped(changes: Change[]): void {
  const facts = new Map<string, Change[]>();
  for (const change of changes) {
    const list = facts.get(change.fingerprint) ?? [];
    list.push(change);
    facts.set(change.fingerprint, list);
  }

  const ordered = [...facts.values()].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a[0]!.severity) - SEVERITY_ORDER.indexOf(b[0]!.severity) ||
      b.length - a.length,
  );

  for (const list of ordered.slice(0, 25)) {
    const first = list[0]!;
    const flip = first.directionFlip ? " \x1b[35m[flip]\x1b[0m" : "";
    const sites =
      list.length > 1 ? ` ${DIM}at ${list.length} call sites${RESET}` : "";
    console.log(
      `  ${COLOR[first.severity]}▪${RESET} ${first.ruleId}${flip}${sites}`,
    );
    console.log(`      ${describe(first)}`);
  }

  if (ordered.length > 25) {
    console.log(`  ${DIM}… ${ordered.length - 25} more distinct changes${RESET}`);
  }
  const collapsed = changes.length - ordered.length;
  if (collapsed > 0) {
    console.log(
      `  ${DIM}(${ordered.length} distinct facts, ${collapsed} duplicate observations collapsed)${RESET}`,
    );
  }
}
