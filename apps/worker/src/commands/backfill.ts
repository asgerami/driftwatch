import type { Provider, SpecSource } from "@prisma/client";

import { ensureClone, fileHistory, readAtCommit } from "../acquire/git.js";
import { fetchSpecUrl } from "../acquire/http.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { historyOptions } from "../registry.js";
import { ingestSpec } from "../store.js";

export interface BackfillOptions {
  /** "stripe" or "stripe/api". Omit for every active source. */
  target?: string;
  /** Stop after this many commits per git source. Ignored for hosted URLs. */
  limit?: number;
  /** Only commits on or after this date. Ignored for hosted URLs. */
  since?: Date;
}

function matches(target: string | undefined, slug: string, key: string): boolean {
  if (!target) return true;
  return target === slug || target === `${slug}/${key}`;
}

/**
 * Walk each git source's history oldest-first and ingest every distinct
 * version of the spec. Hosted (tier B) sources have no history: one GET
 * of the current URL, then the same ingest path.
 *
 * This is the cold-start unlock. A provider that has tracked its spec in git
 * for four years hands us four years of history in one pass, so the feed
 * launches with an archive instead of an empty page.
 *
 * Safe to interrupt and re-run: ingest dedups on (sourceId, contentHash).
 */
export async function backfill(options: BackfillOptions = {}): Promise<void> {
  const sources = await prisma.specSource.findMany({
    where: { active: true },
    include: { provider: true },
    orderBy: [{ providerId: "asc" }, { key: "asc" }],
  });

  const selected = sources.filter((s) =>
    matches(options.target, s.provider.slug, s.key),
  );

  if (selected.length === 0) {
    log.warn(
      options.target
        ? `no active source matches "${options.target}"`
        : "no active sources — run `pnpm w seed` first",
    );
    return;
  }

  for (const source of selected) {
    const name = `${source.provider.slug}/${source.key}`;
    if (source.tier === "B") {
      await backfillHosted(source);
      continue;
    }
    if (!source.repo || !source.filePath) {
      log.warn(`${name}: missing repo or filePath, skipping`);
      continue;
    }

    const dir = await ensureClone(source.repo);
    let revisions = await fileHistory(
      dir,
      source.ref ?? "origin/HEAD",
      source.filePath,
      historyOptions(source.provider.slug, source.key),
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

async function backfillHosted(
  source: SpecSource & { provider: Provider },
): Promise<void> {
  const name = `${source.provider.slug}/${source.key}`;
  if (!source.url) {
    log.warn(`${name}: tier B source is missing url`);
    return;
  }

  log.info(`${name}: fetching ${source.url}`);
  try {
    const fetched = await fetchSpecUrl(source.url);
    const result = await ingestSpec({
      source,
      text: fetched.text,
      providerTime: fetched.providerTime,
    });
    if (result.status === "stored") {
      log.ok(`${name}: 1 stored, 0 duplicate, 0 failed (${result.opCount} ops)`);
      for (const warning of result.warnings ?? []) {
        log.warn(`  ${warning}`);
      }
    } else if (result.status === "duplicate") {
      log.ok(`${name}: 0 stored, 1 duplicate, 0 failed`);
    } else {
      log.warn(`${name}: 0 stored, 0 duplicate, 1 failed (${result.error})`);
    }
  } catch (err) {
    log.warn(`${name}: ${(err as Error).message.split("\n")[0]}`);
  }
}
