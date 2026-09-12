import { normalizeSpec } from "@driftwatch/core";
import type { SpecSource } from "@prisma/client";

import { putText } from "./blobs.js";
import { prisma } from "./db.js";

export type IngestStatus = "stored" | "duplicate" | "failed";

export interface IngestResult {
  status: IngestStatus;
  contentHash?: string;
  snapshotId?: string;
  opCount?: number;
  warnings?: string[];
  error?: string;
}

export interface IngestInput {
  source: SpecSource;
  text: string;
  commitSha?: string;
  providerTime?: Date;
}

/**
 * Normalize, dedup, persist. The one write path into SpecSnapshot.
 *
 * Idempotent by (sourceId, contentHash): re-running a backfill over commits
 * already seen produces `duplicate` rows and changes nothing, so an
 * interrupted run is resumed by simply running it again.
 */
export async function ingestSpec({
  source,
  text,
  commitSha,
  providerTime,
}: IngestInput): Promise<IngestResult> {
  let normalized;
  try {
    normalized = await normalizeSpec(text, {
      volatilePointers: source.volatilePointers,
    });
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }

  const existing = await prisma.specSnapshot.findUnique({
    where: {
      sourceId_contentHash: {
        sourceId: source.id,
        contentHash: normalized.contentHash,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      status: "duplicate",
      contentHash: normalized.contentHash,
      snapshotId: existing.id,
    };
  }

  const [rawBlobKey, normBlobKey] = await Promise.all([
    putText(text),
    putText(normalized.canonical),
  ]);

  const snapshot = await prisma.specSnapshot.create({
    data: {
      providerId: source.providerId,
      sourceId: source.id,
      contentHash: normalized.contentHash,
      rawBlobKey,
      normBlobKey,
      oasVersion: normalized.oasVersion,
      byteSize: Buffer.byteLength(text, "utf8"),
      pathCount: normalized.stats.pathCount,
      opCount: normalized.stats.opCount,
      commitSha: commitSha ?? null,
      providerTime: providerTime ?? null,
    },
    select: { id: true },
  });

  return {
    status: "stored",
    contentHash: normalized.contentHash,
    snapshotId: snapshot.id,
    opCount: normalized.stats.opCount,
    warnings: normalized.warnings,
  };
}
