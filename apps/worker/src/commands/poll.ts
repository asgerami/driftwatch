import { ensureClone, fileHistory, readAtCommit } from "../acquire/git.js";
import { fetchSpecUrlIfChanged } from "../acquire/http.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { ingestSpec } from "../store.js";

/**
 * Fetch the current head of every active source and ingest it if the
 * normalized surface changed. This is what the cron runs.
 *
 * Tier A reads git HEAD. Tier B GETs the hosted URL, conditionally, so an
 * unchanged spec answers 304. Both land in `ingestSpec`; only acquisition
 * differs.
 *
 * Every attempt is recorded on the source (lastFetchAt, lastSuccessAt,
 * lastChangeAt, lastError, consecutiveFailures). Before this, a source that
 * failed was logged once and forgotten, and could go stale indefinitely
 * without anyone noticing.
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
  let failed = 0;

  for (const source of selected) {
    const name = `${source.provider.slug}/${source.key}`;
    const startedAt = new Date();

    try {
      const outcome = await pollOne(source);
      await prisma.specSource.update({
        where: { id: source.id },
        data: {
          lastFetchAt: startedAt,
          lastSuccessAt: startedAt,
          lastError: null,
          consecutiveFailures: 0,
          ...(outcome.stored ? { lastChangeAt: startedAt } : {}),
          ...(outcome.validators ?? {}),
        },
      });
      if (outcome.stored) changed++;
      log[outcome.stored ? "ok" : "step"](`${name}: ${outcome.message}`);
    } catch (err) {
      // One unreachable provider must never abort the whole poll.
      failed++;
      const message = (err as Error).message.split("\n")[0] ?? "unknown error";
      await prisma.specSource.update({
        where: { id: source.id },
        data: {
          lastFetchAt: startedAt,
          lastError: message.slice(0, 500),
          consecutiveFailures: { increment: 1 },
        },
      });
      log.error(`${name}: ${message}`);
    }
  }

  log.info(`poll complete — ${changed} source(s) changed, ${failed} failed`);
  if (failed === selected.length) {
    // Every source failing is the poller's problem, not the providers'.
    throw new Error(`every polled source failed (${failed})`);
  }
}

interface PollOutcome {
  stored: boolean;
  message: string;
  validators?: { etag: string | null; lastModified: string | null };
}

type Source = Awaited<ReturnType<typeof prisma.specSource.findMany>>[number];

async function pollOne(source: Source): Promise<PollOutcome> {
  if (source.tier === "B") {
    if (!source.url) throw new Error("tier B source is missing url");
    const fetched = await fetchSpecUrlIfChanged(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
    });
    if (!fetched) return { stored: false, message: "unchanged (304)" };

    const result = await ingestSpec({
      source,
      text: fetched.text,
      providerTime: fetched.providerTime,
    });
    if (result.status === "failed") throw new Error(result.error);
    return {
      stored: result.status === "stored",
      message: result.status === "stored" ? `new surface (${result.opCount} ops)` : "unchanged",
      validators: { etag: fetched.etag, lastModified: fetched.lastModified },
    };
  }

  if (!source.repo || !source.filePath) throw new Error("tier A source is missing repo or filePath");

  const dir = await ensureClone(source.repo);
  const revisions = await fileHistory(dir, source.ref ?? "origin/HEAD", source.filePath);
  const head = revisions.at(-1);
  if (!head) throw new Error(`no history for ${source.filePath}`);

  const text = await readAtCommit(dir, head.sha, head.path);
  const result = await ingestSpec({
    source,
    text,
    commitSha: head.sha,
    providerTime: head.date,
  });
  if (result.status === "failed") throw new Error(result.error);
  return {
    stored: result.status === "stored",
    message:
      result.status === "stored"
        ? `new surface at ${head.sha.slice(0, 8)} (${result.opCount} ops)`
        : "unchanged",
  };
}
