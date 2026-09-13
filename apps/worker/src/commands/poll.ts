import { ensureClone, fileHistory, readAtCommit } from "../acquire/git.js";
import { fetchSpecUrl } from "../acquire/http.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { ingestSpec } from "../store.js";

/**
 * Fetch the current head of every active source and ingest it if the
 * normalized surface changed. This is what the cron runs.
 *
 * Tier A reads git HEAD. Tier B GETs the hosted URL. Both land in
 * `ingestSpec`; only acquisition differs.
 */
export async function poll(target?: string): Promise<void> {
  const sources = await prisma.specSource.findMany({
    where: { active: true },
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

    try {
      if (source.tier === "B") {
        if (!source.url) {
          log.warn(`${name}: tier B source is missing url`);
          continue;
        }
        const fetched = await fetchSpecUrl(source.url);
        const result = await ingestSpec({
          source,
          text: fetched.text,
          providerTime: fetched.providerTime,
        });
        if (result.status === "stored") {
          changed++;
          log.ok(`${name}: new surface (${result.opCount} ops)`);
        } else if (result.status === "duplicate") {
          log.step(`${name}: unchanged`);
        } else {
          log.error(`${name}: ${result.error}`);
        }
        continue;
      }

      if (!source.repo || !source.filePath) continue;

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
