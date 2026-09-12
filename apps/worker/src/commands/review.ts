import { RULES, type Severity } from "@driftwatch/core";

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

  const pending = (await prisma.change.findMany({
    where: {
      publishedAt: null,
      ...(options.severity ? { severity: options.severity } : {}),
      ...(providerFilter ? { run: { to: { source: providerFilter } } } : {}),
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

  if (pending.length === 0) {
    log.info("nothing pending review");
    return;
  }

  // Group to facts, not rows: one inline enum across nine operations is one
  // decision for a reviewer, not nine.
  const facts = new Map<string, PendingRow[]>();
  for (const row of pending) {
    const list = facts.get(row.fingerprint) ?? [];
    list.push(row);
    facts.set(row.fingerprint, list);
  }

  const ordered = [...facts.values()];
  console.log(
    `\n${ordered.length} distinct facts pending (${pending.length} rows)\n`,
  );

  for (const list of ordered.slice(0, limit)) {
    const first = list[0]!;
    const rule = RULES[first.ruleId];
    const flip = first.directionFlip ? " \x1b[35m[flip]\x1b[0m" : "";
    const where = first.componentName
      ? `${first.componentName}${first.fieldPath ? `.${first.fieldPath}` : ""}` +
        (first.affectedOperations ? ` [${first.affectedOperations} ops]` : "")
      : `${first.method?.toUpperCase() ?? ""} ${first.path ?? ""}`.trim() +
        (first.fieldPath ? ` · ${first.fieldPath}` : "");

    console.log(
      `${COLOR[first.severity] ?? ""}▪${RESET} ${first.ruleId}${flip} ` +
        `${DIM}conf ${first.confidence}${list.length > 1 ? ` · ${list.length} rows` : ""}${RESET}`,
    );
    console.log(`   ${rule?.headline ?? ""}`);
    console.log(`   ${DIM}${where}${first.detail ? ` (${first.detail})` : ""}${RESET}`);
  }

  if (ordered.length > limit) {
    console.log(`${DIM}… ${ordered.length - limit} more facts${RESET}`);
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

  log.ok(`published ${result.count} rows across ${ordered.length} distinct facts`);
}
