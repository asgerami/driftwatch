import { ensureClone, fileHistory, readAtCommit } from "../acquire/git.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { ingestSpec } from "../store.js";

/**
 * Fetch the current head of every active source and ingest it if the
 * normalized surface changed. This is what the cron runs.
 *
 * Tier B (hosted URL) lands here too once those sources exist; the ingest
 * path is identical, only acquisition differs.
 */
export async function poll(target?: string): Promise<void> {
  const sources = await prisma.specSource.findMany({
    where: { active: true, tier: "A" },
    include: { provider: true },
  });

  const selected = sources.filter(
    (s) => !target || target === s.provider.slug || target === `${s.provider.slug}/${s.key}`,
  );

  if (selected.length === 0) {
    log.warn("no active sources to poll — run `pnpm w seed` first");
    return;
  }

  let changed = 0;

  for (const source of selected) {
    const name = `${source.provider.slug}/${source.key}`;
    if (!source.repo || !source.filePath) continue;

    try {
      const dir = await ensureClone(source.repo);
      const revisions = await fileHistory(
        dir,
        source.ref ?? "origin/HEAD",
        source.filePath,
      );
      const head = revisions.at(-1);

      if (!head) {
        log.warn(`${name}: no history for ${source.filePath}`);
        continue;
      }

      const text = await readAtCommit(dir, head.sha, head.path);
      const result = await ingestSpec({
        source,
        text,
        commitSha: head.sha,
        providerTime: head.date,
      });

      if (result.status === "stored") {
        changed++;
        log.ok(
          `${name}: new surface at ${head.sha.slice(0, 8)} (${result.opCount} ops)`,
        );
      } else if (result.status === "duplicate") {
        log.step(`${name}: unchanged`);
      } else {
        log.error(`${name}: ${result.error}`);
      }
    } catch (err) {
      // One unreachable provider must never abort the whole poll.
      log.error(`${name}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  log.info(`poll complete — ${changed} source(s) changed`);
}
