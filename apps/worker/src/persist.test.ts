import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { prisma, disconnect } from "./db.js";
import { diffPair } from "./diffing.js";
import { ingestSpec } from "./store.js";

/**
 * Hits the real write path against Postgres.
 *
 * Unit tests in core never open a database. The first version of this
 * pipeline passed all 43 of them while every `change.createMany` failed
 * because fingerprints contained a NUL byte Postgres refuses. This file
 * exists so that class of bug cannot hide again.
 *
 * Skipped when DATABASE_URL is unset so `pnpm check` still runs on a
 * machine that has not started Postgres. In this repo the Cloud Agent
 * environment always has one.
 */

function spec(over: {
  path?: string;
  properties: Record<string, unknown>;
  extraPaths?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "persist-test", version: "1" },
    paths: {
      [over.path ?? "/pets"]: {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: over.properties,
                  },
                },
              },
            },
          },
        },
      },
      ...(over.extraPaths ?? {}),
    },
  });
}

const hasDatabase = Boolean(process.env["DATABASE_URL"]);

describe.skipIf(!hasDatabase)("persist path against Postgres", () => {
  const slug = `persist-test-${randomUUID().slice(0, 8)}`;
  const ids: { providerId?: string } = {};

  afterAll(async () => {
    if (ids.providerId) {
      await prisma.provider.delete({ where: { id: ids.providerId } }).catch(() => undefined);
    }
    await disconnect();
  });

  it("ingests, dedups, diffs, and actually writes Change rows", async () => {
    const provider = await prisma.provider.create({
      data: { slug, name: "Persist Test" },
    });
    ids.providerId = provider.id;

    const source = await prisma.specSource.create({
      data: {
        providerId: provider.id,
        key: "api",
        label: "Persist Test API",
        tier: "A",
        repo: "example/persist-test",
        filePath: "openapi.json",
      },
    });

    const beforeText = spec({ properties: { id: { type: "string" } } });
    const afterText = spec({
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        ["evil\u0000field"]: { type: "string" },
      },
      extraPaths: {
        "/vets": {
          post: {
            responses: {
              "200": { description: "ok" },
            },
          },
        },
      },
    });

    const first = await ingestSpec({
      source,
      text: beforeText,
      commitSha: "aaa111",
      providerTime: new Date("2024-01-01T00:00:00Z"),
    });
    expect(first.status).toBe("stored");
    expect(first.snapshotId).toBeTruthy();

    const dup = await ingestSpec({
      source,
      text: beforeText,
      commitSha: "aaa111-again",
      providerTime: new Date("2024-01-02T00:00:00Z"),
    });
    expect(dup.status).toBe("duplicate");
    expect(dup.snapshotId).toBe(first.snapshotId);

    const second = await ingestSpec({
      source,
      text: afterText,
      commitSha: "bbb222",
      providerTime: new Date("2024-02-01T00:00:00Z"),
    });
    expect(second.status).toBe("stored");
    expect(second.snapshotId).not.toBe(first.snapshotId);

    const from = await prisma.specSnapshot.findUniqueOrThrow({
      where: { id: first.snapshotId! },
      select: {
        id: true,
        normBlobKey: true,
        contentHash: true,
        providerTime: true,
        commitSha: true,
      },
    });
    const to = await prisma.specSnapshot.findUniqueOrThrow({
      where: { id: second.snapshotId! },
      select: {
        id: true,
        normBlobKey: true,
        contentHash: true,
        providerTime: true,
        commitSha: true,
      },
    });

    const created = await diffPair(from, to);
    expect(created.status).toBe("created");
    expect(created.changeCount).toBeGreaterThan(0);

    const rows = await prisma.change.findMany({ where: { runId: created.runId } });
    expect(rows.length).toBe(created.changeCount);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.fingerprint))).toBe(true);
    expect(rows.some((row) => row.ruleId === "response.property.added")).toBe(true);
    expect(rows.some((row) => row.ruleId === "path.added" || row.ruleId === "operation.added")).toBe(
      true,
    );
    // NUL in a property name must not take down createMany.
    expect(rows.every((row) => !row.fieldPath?.includes("\u0000"))).toBe(true);
    expect(rows.every((row) => !row.jsonPointer.includes("\u0000"))).toBe(true);

    const again = await diffPair(from, to);
    expect(again.status).toBe("existing");
    expect(again.runId).toBe(created.runId);

    await prisma.diffRun.update({
      where: { id: created.runId! },
      data: { error: "transient failure" },
    });

    const redone = await diffPair(from, to);
    expect(redone.status).toBe("created");
    expect(redone.runId).not.toBe(created.runId);
    const redoneRows = await prisma.change.findMany({ where: { runId: redone.runId } });
    expect(redoneRows.length).toBe(created.changeCount);

    const leftover = await prisma.diffRun.findUnique({ where: { id: created.runId! } });
    expect(leftover).toBeNull();

    // A ruleset bump: pretend the redone run came from an older ruleset, with
    // one fact already published. Re-diffing under the current version must
    // keep that fact published and send the rest back to review.
    await prisma.diffRun.update({
      where: { id: redone.runId! },
      data: { rulesetVer: "0.0.0-persist-test" },
    });
    const kept = redoneRows.find((row) => row.ruleId === "response.property.added")!;
    const publishedAt = new Date("2024-03-01T00:00:00Z");
    await prisma.change.updateMany({
      where: { runId: redone.runId!, fingerprint: kept.fingerprint },
      data: { reviewedAt: publishedAt, publishedAt },
    });

    const bumped = await diffPair(from, to);
    expect(bumped.status).toBe("created");
    const bumpedRows = await prisma.change.findMany({ where: { runId: bumped.runId } });
    const carried = bumpedRows.filter((row) => row.publishedAt !== null);
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((row) => row.fingerprint === kept.fingerprint)).toBe(true);
    expect(carried[0]!.publishedAt!.toISOString()).toBe(publishedAt.toISOString());
    expect(bumpedRows.some((row) => row.publishedAt === null)).toBe(true);

    // A rejection must survive a bump too, or every rejected fact would come
    // back for review after each ruleset change.
    const rejected = bumpedRows.find((row) => row.publishedAt === null)!;
    const rejectedAt = new Date("2024-04-01T00:00:00Z");
    await prisma.change.updateMany({
      where: { runId: bumped.runId!, fingerprint: rejected.fingerprint },
      data: { reviewedAt: rejectedAt },
    });
    await prisma.diffRun.update({
      where: { id: bumped.runId! },
      data: { rulesetVer: "0.0.1-persist-test" },
    });
    const again2 = await diffPair(from, to);
    const again2Rows = await prisma.change.findMany({ where: { runId: again2.runId } });
    const stillRejected = again2Rows.filter((row) => row.fingerprint === rejected.fingerprint);
    expect(stillRejected.length).toBeGreaterThan(0);
    expect(stillRejected.every((row) => row.reviewedAt?.toISOString() === rejectedAt.toISOString())).toBe(true);
    expect(stillRejected.every((row) => row.publishedAt === null)).toBe(true);
    const stillPublished = again2Rows.filter((row) => row.fingerprint === kept.fingerprint);
    expect(stillPublished.every((row) => row.publishedAt !== null)).toBe(true);

    // A pair split by a later backfill. Publish the "name" field on A→C, then
    // insert B (which adds only that field) between them. A→B is a new pair
    // no decision was made on, but A→C spans it, so the decision carries.
    const nameAddedAt = new Date("2024-05-01T00:00:00Z");
    await prisma.change.updateMany({
      where: { runId: again2.runId!, ruleId: "response.property.added", fieldPath: "name" },
      data: { reviewedAt: nameAddedAt, publishedAt: nameAddedAt },
    });
    const middle = await ingestSpec({
      source,
      text: spec({ properties: { id: { type: "string" }, name: { type: "string" } } }),
      commitSha: "abc150",
      providerTime: new Date("2024-01-15T00:00:00Z"),
    });
    expect(middle.status).toBe("stored");
    const mid = await prisma.specSnapshot.findUniqueOrThrow({
      where: { id: middle.snapshotId! },
      select: { id: true, normBlobKey: true, contentHash: true, providerTime: true, commitSha: true },
    });
    const split = await diffPair(from, mid);
    expect(split.status).toBe("created");
    const splitRows = await prisma.change.findMany({ where: { runId: split.runId } });
    const name = splitRows.filter((row) => row.fieldPath === "name");
    expect(name.length).toBeGreaterThan(0);
    expect(name.every((row) => row.publishedAt?.toISOString() === nameAddedAt.toISOString())).toBe(true);
    // A hosted Postgres (Neon) costs tens of milliseconds per round trip, and
    // this test makes dozens. The 5s default only fits a local database.
  }, 120_000);
});
