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
    // A hosted Postgres (Neon) costs tens of milliseconds per round trip, and
    // this test makes dozens. The 5s default only fits a local database.
  }, 60_000);
});
