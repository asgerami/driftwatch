import { RULESET_VERSION, type ChangeDocument } from "@driftwatch/core";

export type { ChangeDocument };

import { prisma } from "./db";
import { absolute } from "./site";

export async function getChangeDocument(storyId: string): Promise<ChangeDocument | null> {
  const rows = await prisma.change.findMany({
    where: { storyId, publishedAt: { not: null }, run: { rulesetVer: RULESET_VERSION } },
    select: {
      ruleId: true,
      severity: true,
      method: true,
      path: true,
      operationId: true,
      componentName: true,
      fieldPath: true,
      jsonPointer: true,
      detail: true,
      before: true,
      after: true,
      affectedOperations: true,
      fingerprint: true,
      run: {
        select: {
          from: { select: { commitSha: true } },
          to: {
            select: {
              commitSha: true,
              providerTime: true,
              capturedAt: true,
              source: {
                select: { repo: true, filePath: true, url: true, provider: { select: { slug: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (rows.length === 0) return null;

  const first = rows[0]!;
  const { from, to } = first.run;
  const seen = new Set<string>();
  const facts: ChangeDocument["facts"] = [];
  for (const row of rows) {
    const key = `${row.fingerprint}|${row.method ?? ""}|${row.path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      ruleId: row.ruleId,
      severity: row.severity,
      method: row.method ?? undefined,
      path: row.path ?? undefined,
      operationId: row.operationId ?? undefined,
      componentName: row.componentName ?? undefined,
      fieldPath: row.fieldPath ?? undefined,
      jsonPointer: row.jsonPointer,
      detail: row.detail ?? undefined,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      affectedOperations: row.affectedOperations ?? undefined,
    });
  }

  const source = to.source;
  const spec: ChangeDocument["spec"] =
    source.repo && source.filePath && to.commitSha
      ? {
          kind: "git",
          repo: source.repo,
          filePath: source.filePath,
          fromSha: from.commitSha ?? undefined,
          toSha: to.commitSha,
        }
      : { kind: "hosted", url: source.url ?? "" };

  return {
    version: 1,
    id: storyId,
    url: absolute(`/changes/${storyId}`),
    provider: source.provider,
    severity: first.severity,
    ruleId: first.ruleId,
    shippedAt: (to.providerTime ?? to.capturedAt).toISOString(),
    facts,
    spec,
  };
}
