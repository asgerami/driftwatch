import {
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULES,
  RULESET_VERSION,
  groupStories,
  storyDetail,
  type Severity,
} from "@driftwatch/core";

import { prisma } from "../db.js";
import { log } from "../log.js";

const COLOR: Record<string, string> = {
  BREAKING: "\x1b[31m",
  DEPRECATION: "\x1b[33m",
  BEHAVIORAL: "\x1b[34m",
  ADDITIVE: "\x1b[32m",
  COSMETIC: "\x1b[90m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[90m";

export interface ReviewOptions {
  severity?: Severity;
  limit?: number;
  /** Actually publish what is listed. Without it this is read-only. */
  publish?: boolean;
  /**
   * Include changes the ruleset holds back: anything below the confidence
   * threshold, plus cosmetic ones. Useful for tuning; never for publishing.
   */
  all?: boolean;
}

interface PendingRow {
  id: string;
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  confidence: number;
  directionFlip: boolean;
  componentName: string | null;
  affectedOperations: number | null;
  method: string | null;
  path: string | null;
  fieldPath: string | null;
  detail: string | null;
}

/**
 * The review gate.
 *
 * Nothing auto-publishes. For the first months the thresholds are guesses,
 * and one false breaking change costs a subscriber permanently, so a person
 * looks at every fact before it reaches anyone's inbox. This command is
 * read-only unless `--publish` is passed.
 */
export async function review(
  target?: string,
  options: ReviewOptions = {},
): Promise<void> {
  const limit = options.limit ?? 40;

  const providerFilter = target
    ? target.includes("/")
      ? {
          provider: { slug: target.split("/")[0]! },
          key: target.split("/")[1]!,
        }
      : { provider: { slug: target } }
    : undefined;

  // The gate the ruleset already computed. Confidence is not a measure of how
  // bad a change is, it is how sure we are the change is real, so anything
  // ambiguous is stored and withheld rather than mailed to subscribers.
  const gate = options.all
    ? {}
    : {
        confidence: { gte: PUBLISH_CONFIDENCE_THRESHOLD },
        severity: { not: "COSMETIC" as Severity },
      };

  const pending = (await prisma.change.findMany({
    where: {
      publishedAt: null,
      ...gate,
      ...(options.severity ? { severity: options.severity } : {}),
      run: {
        rulesetVer: RULESET_VERSION,
        ...(providerFilter ? { to: { source: providerFilter } } : {}),
      },
    },
    select: {
      id: true,
      fingerprint: true,
      ruleId: true,
      severity: true,
      confidence: true,
      directionFlip: true,
      componentName: true,
      affectedOperations: true,
      method: true,
      path: true,
      fieldPath: true,
      detail: true,
    },
    orderBy: [{ severity: "asc" }, { ruleId: "asc" }],
  })) as PendingRow[];

  const withheld = options.all
    ? 0
    : await prisma.change.count({
        where: {
          publishedAt: null,
          OR: [
            { confidence: { lt: PUBLISH_CONFIDENCE_THRESHOLD } },
            { severity: "COSMETIC" },
          ],
          run: {
            rulesetVer: RULESET_VERSION,
            ...(providerFilter ? { to: { source: providerFilter } } : {}),
          },
        },
      });

  if (pending.length === 0) {
    log.info(
      withheld > 0
        ? `nothing pending review (${withheld} rows held below the confidence threshold; --all to see them)`
        : "nothing pending review",
    );
    return;
  }

  // Group to stories, not rows or facts: one inline enum across nine
  // operations is one fact, and one new enum value across seven components is
  // one story. Either way it is one decision for a reviewer.
  const ordered = groupStories(pending);
  const factCount = new Set(pending.map((row) => row.fingerprint)).size;
  console.log(
    `\n${ordered.length} stories pending (${factCount} distinct facts, ${pending.length} rows)` +
      (withheld > 0
        ? `, ${withheld} more held below confidence ${PUBLISH_CONFIDENCE_THRESHOLD} \u2014 --all to see them`
        : "") +
      "\n",
  );

  for (const list of ordered.slice(0, limit)) {
    const first = list[0]!;
    const rule = RULES[first.ruleId];
    const flip = first.directionFlip ? " \x1b[35m[flip]\x1b[0m" : "";
    const places = [...new Set(list.map(whereOf))];
    const detail = storyDetail(list);

    console.log(
      `${COLOR[first.severity] ?? ""}▪${RESET} ${first.ruleId}${flip} ` +
        `${DIM}conf ${first.confidence}${list.length > 1 ? ` · ${list.length} rows` : ""}${RESET}`,
    );
    console.log(`   ${rule?.headline ?? ""}${detail ? ` ${DIM}(${detail})${RESET}` : ""}`);
    for (const place of places.slice(0, 4)) console.log(`   ${DIM}${place}${RESET}`);
    if (places.length > 4) console.log(`   ${DIM}… ${places.length - 4} more places${RESET}`);
  }

  if (ordered.length > limit) {
    console.log(`${DIM}… ${ordered.length - limit} more stories${RESET}`);
  }

  if (!options.publish) {
    console.log(
      `\n${DIM}Read-only. Re-run with --publish to publish these ${pending.length} rows.${RESET}\n`,
    );
    return;
  }

  const now = new Date();
  const result = await prisma.change.updateMany({
    where: { id: { in: pending.map((row) => row.id) } },
    data: { reviewedAt: now, publishedAt: now },
  });

  log.ok(`published ${result.count} rows across ${ordered.length} stories`);
}

function whereOf(row: PendingRow): string {
  return row.componentName
    ? `${row.componentName}${row.fieldPath ? `.${row.fieldPath}` : ""}` +
        (row.affectedOperations ? ` [${row.affectedOperations} ops]` : "")
    : `${row.method?.toUpperCase() ?? ""} ${row.path ?? ""}`.trim() +
        (row.fieldPath ? ` · ${row.fieldPath}` : "");
}
