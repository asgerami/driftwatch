import { RULESET_VERSION, diffDocuments, type Change } from "@driftwatch/core";
import type { JsonObject } from "@driftwatch/core";

import { getText } from "./blobs.js";
import { prisma } from "./db.js";
import { log } from "./log.js";

export const DIFF_ENGINE = `driftwatch-core@${RULESET_VERSION}`;

export interface SnapshotRef {
  id: string;
  normBlobKey: string;
  contentHash: string;
  providerTime: Date | null;
  commitSha: string | null;
}

export interface DiffPersistResult {
  status: "created" | "existing" | "failed";
  runId?: string;
  changeCount?: number;
  breaking?: number;
  error?: string;
}

async function loadNormalized(snapshot: SnapshotRef): Promise<JsonObject> {
  return JSON.parse(await getText(snapshot.normBlobKey)) as JsonObject;
}

/**
 * Diff one consecutive pair and persist the result.
 *
 * Keyed on (fromId, toId, rulesetVer), so re-running is free and bumping the
 * ruleset version re-classifies a pair without destroying the previous run's
 * history. That is what makes it safe to iterate on rules against years of
 * backfilled data.
 */
export async function diffPair(
  from: SnapshotRef,
  to: SnapshotRef,
): Promise<DiffPersistResult> {
  const existing = await prisma.diffRun.findUnique({
    where: {
      fromId_toId_rulesetVer: {
        fromId: from.id,
        toId: to.id,
        rulesetVer: RULESET_VERSION,
      },
    },
    select: { id: true, error: true },
  });

  if (existing) {
    // A run that failed must not be treated as done. The uniqueness key makes
    // re-running free, but it also means a transient failure would be skipped
    // forever on every subsequent pass, leaving a permanent hole in the
    // history with no way to fill it short of wiping the database.
    if (!existing.error) return { status: "existing", runId: existing.id };
    await prisma.diffRun.delete({ where: { id: existing.id } });
  }

  const run = await prisma.diffRun.create({
    data: {
      fromId: from.id,
      toId: to.id,
      engine: DIFF_ENGINE,
      rulesetVer: RULESET_VERSION,
    },
    select: { id: true },
  });

  try {
    const [beforeDoc, afterDoc] = await Promise.all([
      loadNormalized(from),
      loadNormalized(to),
    ]);

    const result = diffDocuments(beforeDoc, afterDoc);

    if (result.changes.length > 0) {
      await prisma.change.createMany({
        data: result.changes.map((change) => toRow(run.id, change)),
      });
      await carryForwardPublished(run.id, from.id, to.id);
    }

    await prisma.diffRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        error: result.truncated ? "change cap reached; diff is incomplete" : null,
      },
    });

    return {
      status: "created",
      runId: run.id,
      changeCount: result.changes.length,
      breaking: result.counts.BREAKING,
    };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.diffRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), error: message },
    });
    return { status: "failed", runId: run.id, error: message };
  }
}

/**
 * Keep human review decisions across a ruleset bump.
 *
 * Review and the feed read only runs at the current RULESET_VERSION, so a rule
 * fix replaces the previous classification instead of sitting beside it. On
 * its own that would empty the feed on every bump until someone re-published
 * years of history. A fact published for this same pair under an earlier
 * ruleset, with the same fingerprint and the same severity, stays published.
 * Anything new or reclassified goes back to review, which is the point.
 */
async function carryForwardPublished(
  runId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  const published = await prisma.change.findMany({
    where: {
      publishedAt: { not: null },
      run: { fromId, toId, rulesetVer: { not: RULESET_VERSION } },
    },
    select: { fingerprint: true, severity: true, reviewedAt: true, publishedAt: true },
    distinct: ["fingerprint", "severity"],
  });

  for (const prior of published) {
    await prisma.change.updateMany({
      where: {
        runId,
        fingerprint: prior.fingerprint,
        severity: prior.severity,
        publishedAt: null,
      },
      data: { reviewedAt: prior.reviewedAt, publishedAt: prior.publishedAt },
    });
  }
}

/**
 * Postgres rejects NUL (0x00) anywhere in a text column.
 *
 * Our own fingerprint separator caused this once. It can also arrive from a
 * provider's spec, since JSON permits \u0000 in a string and a description or
 * example could carry one. Strip it at the write boundary so one malformed
 * upstream byte cannot take down a whole diff run.
 */
function clean<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes("\u0000") ? value.replace(/\u0000/g, "") : value) as T;
  }
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        clean(k),
        clean(v),
      ]),
    ) as T;
  }
  return value;
}

function toRow(runId: string, change: Change) {
  return {
    runId,
    ruleId: change.ruleId,
    severity: change.severity,
    confidence: change.confidence,
    directionFlip: change.directionFlip,
    fingerprint: clean(change.fingerprint),
    method: clean(change.method) ?? null,
    path: clean(change.path) ?? null,
    operationId: clean(change.operationId) ?? null,
    jsonPointer: clean(change.jsonPointer),
    componentName: clean(change.componentName) ?? null,
    affectedOperations: change.affectedOperations ?? null,
    fieldPath: clean(change.fieldPath) ?? null,
    detail: clean(change.detail) ?? null,
    before: (change.before === undefined ? null : clean(change.before)) as never,
    after: (change.after === undefined ? null : clean(change.after)) as never,
    // Nothing auto-publishes. Every change is held for review until the
    // confidence thresholds have been tuned against real backfilled data.
    publishedAt: null,
    reviewedAt: null,
  };
}

/**
 * Diff every consecutive snapshot pair for a source, oldest first.
 *
 * Pairs are consecutive by `providerTime`, never by insertion order: a
 * backfill writes four years of history in one afternoon, and ordering by
 * `capturedAt` would diff them in essentially random sequence.
 */
export async function diffSource(
  sourceId: string,
  label: string,
  limit?: number,
): Promise<void> {
  const snapshots = (await prisma.specSnapshot.findMany({
    where: { sourceId },
    orderBy: [{ providerTime: "asc" }, { capturedAt: "asc" }],
    select: {
      id: true,
      normBlobKey: true,
      contentHash: true,
      providerTime: true,
      commitSha: true,
    },
  })) as SnapshotRef[];

  if (snapshots.length < 2) {
    log.warn(`${label}: needs at least 2 snapshots, has ${snapshots.length}`);
    return;
  }

  const pairs: [SnapshotRef, SnapshotRef][] = [];
  for (let i = 1; i < snapshots.length; i++) {
    pairs.push([snapshots[i - 1]!, snapshots[i]!]);
  }
  const selected = limit ? pairs.slice(-limit) : pairs;

  log.info(`${label}: diffing ${selected.length} consecutive pairs`);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let breaking = 0;

  for (const [from, to] of selected) {
    const result = await diffPair(from, to);
    if (result.status === "created") {
      created++;
      breaking += result.breaking ?? 0;
      if ((result.breaking ?? 0) > 0) {
        log.step(
          `${label} ${to.commitSha?.slice(0, 8) ?? "?"} ` +
            `${to.providerTime?.toISOString().slice(0, 10) ?? ""} ` +
            `— ${result.breaking} breaking of ${result.changeCount}`,
        );
      }
    } else if (result.status === "existing") {
      skipped++;
    } else {
      failed++;
      log.warn(`${label}: ${result.error}`);
    }
  }

  log.ok(
    `${label}: ${created} runs created, ${skipped} already done, ${failed} failed, ${breaking} breaking changes found`,
  );
}
