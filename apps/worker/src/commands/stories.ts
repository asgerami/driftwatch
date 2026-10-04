import { RULESET_VERSION } from "@driftwatch/core";

import { prisma } from "../db.js";
import { assignStoryIds } from "../diffing.js";
import { log } from "../log.js";

/**
 * Give every fact at the current ruleset its story id. Runs diffed before
 * story ids existed have none; diff assigns them for every run since.
 * Idempotent: a second run changes nothing.
 */
export async function stories(): Promise<void> {
  const runs = await prisma.diffRun.findMany({
    where: { rulesetVer: RULESET_VERSION, error: null, finishedAt: { not: null } },
    select: { id: true },
  });
  let updated = 0;
  for (const run of runs) updated += await assignStoryIds(run.id);
  log.ok(`stories: ${runs.length} runs checked, ${updated} rows given a story id`);
}
