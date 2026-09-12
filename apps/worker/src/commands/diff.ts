import { prisma } from "../db.js";
import { diffSource } from "../diffing.js";
import { log } from "../log.js";

/**
 * Diff every stored snapshot pair for the selected sources.
 *
 * Run after `backfill`. Safe to re-run: each (from, to, ruleset) pair is
 * computed once, so this only ever picks up new snapshots.
 */
export async function diff(target?: string, limit?: number): Promise<void> {
  const sources = await prisma.specSource.findMany({
    where: { active: true },
    include: { provider: true },
    orderBy: [{ providerId: "asc" }, { key: "asc" }],
  });

  const selected = sources.filter(
    (s) =>
      !target || target === s.provider.slug || target === `${s.provider.slug}/${s.key}`,
  );

  if (selected.length === 0) {
    log.warn(
      target
        ? `no active source matches "${target}"`
        : "no active sources — run `pnpm w seed` and `pnpm w backfill` first",
    );
    return;
  }

  for (const source of selected) {
    await diffSource(source.id, `${source.provider.slug}/${source.key}`, limit);
  }
}
