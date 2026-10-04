import {
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULESET_VERSION,
  autoPublishDecision,
  groupStories,
  median,
  type ReleaseContext,
} from "@driftwatch/core";

import { prisma } from "./db.js";

/**
 * Apply the auto-publish policy (`@driftwatch/core` policy.ts) to the queue.
 *
 * Splits every pending story into "publish" and "held, because …". The policy
 * itself is pure; this module only gathers what it needs from the database:
 * the release a story belongs to, how big that release is next to the
 * source's others, and whether a person has ever reviewed the source.
 */

export interface PendingRow {
  id: string;
  fingerprint: string;
  ruleId: string;
  severity: string;
  componentName: string | null;
  fieldPath: string | null;
  detail: string | null;
  method: string | null;
  path: string | null;
  affectedOperations: number | null;
  runId: string;
  sourceId: string;
  sourceName: string;
}

export interface HeldStory {
  rows: PendingRow[];
  reason: string;
}

export interface Plan {
  publish: PendingRow[][];
  held: HeldStory[];
}

export async function planAutoPublish(): Promise<Plan> {
  const pending = await prisma.change.findMany({
    where: {
      publishedAt: null,
      reviewedAt: null,
      confidence: { gte: PUBLISH_CONFIDENCE_THRESHOLD },
      severity: { not: "COSMETIC" },
      run: { rulesetVer: RULESET_VERSION, to: { source: { active: true } } },
    },
    select: {
      id: true,
      fingerprint: true,
      ruleId: true,
      severity: true,
      componentName: true,
      fieldPath: true,
      detail: true,
      method: true,
      path: true,
      affectedOperations: true,
      runId: true,
      run: {
        select: {
          to: { select: { sourceId: true, source: { select: { key: true, provider: { select: { slug: true } } } } } },
        },
      },
    },
  });

  const rows: PendingRow[] = pending.map((row) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    ruleId: row.ruleId,
    severity: row.severity,
    componentName: row.componentName,
    fieldPath: row.fieldPath,
    detail: row.detail,
    method: row.method,
    path: row.path,
    affectedOperations: row.affectedOperations,
    runId: row.runId,
    sourceId: row.run.to.sourceId,
    sourceName: `${row.run.to.source.provider.slug}/${row.run.to.source.key}`,
  }));
  if (rows.length === 0) return { publish: [], held: [] };

  const sourceIds = [...new Set(rows.map((row) => row.sourceId))];

  // A source counts as reviewed once a person, not the policy, has published
  // or rejected anything from it. Rows decided before reviewedBy existed have
  // it null, and every one of those was a person.
  const reviewed = await prisma.change.findMany({
    where: {
      reviewedAt: { not: null },
      OR: [{ reviewedBy: null }, { reviewedBy: "human" }],
      run: { to: { sourceId: { in: sourceIds } } },
    },
    select: { run: { select: { to: { select: { sourceId: true } } } } },
    distinct: ["runId"],
  });
  const reviewedSources = new Set(reviewed.map((row) => row.run.to.sourceId));

  // Breaking facts per release, pending or not, to tell a spike from a
  // source that is simply always busy.
  const breaking = await prisma.change.findMany({
    where: {
      severity: "BREAKING",
      confidence: { gte: PUBLISH_CONFIDENCE_THRESHOLD },
      run: { rulesetVer: RULESET_VERSION, to: { sourceId: { in: sourceIds } } },
    },
    select: { runId: true, fingerprint: true, run: { select: { to: { select: { sourceId: true } } } } },
  });
  const factsPerRun = new Map<string, { sourceId: string; facts: Set<string> }>();
  for (const row of breaking) {
    const entry = factsPerRun.get(row.runId) ?? { sourceId: row.run.to.sourceId, facts: new Set<string>() };
    entry.facts.add(row.fingerprint);
    factsPerRun.set(row.runId, entry);
  }

  const contextFor = (runId: string, sourceId: string): ReleaseContext => {
    const others = [...factsPerRun.entries()]
      .filter(([id, entry]) => id !== runId && entry.sourceId === sourceId)
      .map(([, entry]) => entry.facts.size);
    return {
      breakingFacts: factsPerRun.get(runId)?.facts.size ?? 0,
      typicalBreakingFacts: median(others),
      sourceReviewed: reviewedSources.has(sourceId),
    };
  };

  const byRun = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row);
    byRun.set(row.runId, list);
  }

  const plan: Plan = { publish: [], held: [] };
  for (const [runId, runRows] of byRun) {
    const context = contextFor(runId, runRows[0]!.sourceId);
    for (const story of groupStories(runRows)) {
      const decision = autoPublishDecision(story[0]!, context);
      if (decision.publish) plan.publish.push(story);
      else plan.held.push({ rows: story, reason: decision.reason });
    }
  }
  return plan;
}
