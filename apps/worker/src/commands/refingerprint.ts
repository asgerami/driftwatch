import { LOCATION_KEYED_RULES, fingerprintOf, type RawChange } from "@driftwatch/core";

import { prisma } from "../db.js";
import { log } from "../log.js";

/**
 * Recompute stored fingerprints for the rules whose formula changed.
 *
 * Endpoint-surface rules (path.*, operation.*) key on method and path since
 * ruleset 1.3.0. Rows written before that share one fingerprint per rule per
 * run, and review decisions are carried across ruleset bumps by fingerprint,
 * so they must be rewritten in place, keeping every reviewedAt/publishedAt.
 *
 * Deliberately limited to those rules. Every other fingerprint is unchanged,
 * and recomputing them from stored values would not be safe: `before` and
 * `after` are jsonb, which does not preserve object key order, so a
 * recomputed hash could differ from the original for no real reason.
 *
 * Idempotent: a second run finds nothing to change.
 */
export async function refingerprint(): Promise<void> {
  const rows = await prisma.change.findMany({
    where: { ruleId: { in: [...LOCATION_KEYED_RULES] } },
    select: {
      id: true,
      ruleId: true,
      fingerprint: true,
      componentName: true,
      fieldPath: true,
      detail: true,
      before: true,
      after: true,
      method: true,
      path: true,
    },
  });

  const byFingerprint = new Map<string, string[]>();
  for (const row of rows) {
    const next = fingerprintOf({
      ruleId: row.ruleId,
      componentName: row.componentName ?? undefined,
      fieldPath: row.fieldPath ?? undefined,
      detail: row.detail ?? undefined,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      method: row.method ?? undefined,
      path: row.path ?? undefined,
    } as RawChange);
    if (next === row.fingerprint) continue;
    const ids = byFingerprint.get(next) ?? [];
    ids.push(row.id);
    byFingerprint.set(next, ids);
  }

  let updated = 0;
  for (const [fingerprint, ids] of byFingerprint) {
    const result = await prisma.change.updateMany({
      where: { id: { in: ids } },
      data: { fingerprint },
    });
    updated += result.count;
  }

  log.ok(
    `refingerprint: ${rows.length} endpoint-rule rows checked, ${updated} updated, ` +
      `${rows.length - updated} already current`,
  );
}
