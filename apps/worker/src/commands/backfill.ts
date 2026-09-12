import { ensureClone, fileHistory, readAtCommit } from "../acquire/git.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { ingestSpec } from "../store.js";

export interface BackfillOptions {
  /** "stripe" or "stripe/api". Omit for every active tier A source. */
  target?: string;
  /** Stop after this many commits per source. */
  limit?: number;
  /** Only commits on or after this date. */
  since?: Date;
}

function matches(target: string | undefined, slug: string, key: string): boolean {
  if (!target) return true;
  return target === slug || target === `${slug}/${key}`;
}

/**
 * Walk each source's git history oldest-first and ingest every distinct
 * version of the spec.
 *
 * This is the cold-start unlock. A provider that has tracked its spec in git
 * for four years hands us four years of history in one pass, so the feed
 * launches with an archive instead of an empty page.
 *
 * Safe to interrupt and re-run: ingest dedups on (sourceId, contentHash).
 */
export async function backfill(options: BackfillOptions = {}): Promise<void> {
  const sources = await prisma.specSource.findMany({
    where: { tier: "A", active: true },
    include: { provider: true },
    orderBy: [{ providerId: "asc" }, { key: "asc" }],
  });

  const selected = sources.filter((s) =>
    matches(options.target, s.provider.slug, s.key),
  );

  if (selected.length === 0) {
    log.warn(
      options.target
        ? `no active tier A source matches "${options.target}"`
        : "no active tier A sources — run `pnpm w seed` first",
    );
    return;
  }

  for (const source of selected) {
    const name = `${source.provider.slug}/${source.key}`;
    if (!source.repo || !source.filePath) {
      log.warn(`${name}: missing repo or filePath, skipping`);
      continue;
    }

    const dir = await ensureClone(source.repo);
    let revisions = await fileHistory(
      dir,
      source.ref ?? "origin/HEAD",
      source.filePath,
    );

    if (options.since) {
      revisions = revisions.filter((r) => r.date >= options.since!);
    }
    if (options.limit && revisions.length > options.limit) {
      // Keep the most recent N, but still process oldest-first.
      revisions = revisions.slice(-options.limit);
    }

    log.info(`${name}: ${revisions.length} revisions to walk`);

    let stored = 0;
    let duplicate = 0;
    let failed = 0;

    for (const [index, revision] of revisions.entries()) {
      let text: string;
      try {
        text = await readAtCommit(dir, revision.sha, revision.path);
      } catch (err) {
        failed++;
        log.warn(
          `${name} ${revision.sha.slice(0, 8)}: unreadable (${(err as Error).message.split("\n")[0]})`,
        );
        continue;
      }

      const result = await ingestSpec({
        source,
        text,
        commitSha: revision.sha,
        providerTime: revision.date,
      });

      if (result.status === "stored") {
        stored++;
        log.step(
          `${name} ${revision.sha.slice(0, 8)} ${revision.date.toISOString().slice(0, 10)} ` +
            `— ${result.opCount} ops — ${revision.subject.slice(0, 52)}`,
        );
        for (const warning of result.warnings ?? []) {
          log.warn(`  ${warning}`);
        }
      } else if (result.status === "duplicate") {
        duplicate++;
      } else {
        failed++;
        log.warn(`${name} ${revision.sha.slice(0, 8)}: ${result.error}`);
      }

      if ((index + 1) % 50 === 0) {
        log.info(
          `${name}: ${index + 1}/${revisions.length} (${stored} stored, ${duplicate} dup, ${failed} failed)`,
        );
      }
    }

    log.ok(
      `${name}: ${stored} stored, ${duplicate} duplicate, ${failed} failed`,
    );
  }
}
