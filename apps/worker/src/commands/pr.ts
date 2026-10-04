import { prisma } from "../db.js";
import { log } from "../log.js";

/**
 * Log a fix PR opened by hand (concierge, before any GitHub App), so the
 * signals script can follow it to merged or closed. Repos logged this way get
 * installationId "concierge": no App installation exists for them.
 */

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)\/?$/;

export function parsePrUrl(url: string): { fullName: string; number: number } | null {
  const match = PR_URL.exec(url.trim());
  return match ? { fullName: match[1]!, number: Number(match[2]) } : null;
}

export async function logPr(url: string, storyId: string): Promise<void> {
  const parsed = parsePrUrl(url);
  if (!parsed) {
    log.error(`not a GitHub pull request URL: ${url}`);
    process.exitCode = 1;
    return;
  }
  const story = await prisma.change.findFirst({ where: { storyId }, select: { id: true } });
  if (!story) {
    log.error(`no change with story id ${storyId} (the id in driftwatch.et/changes/<id>)`);
    process.exitCode = 1;
    return;
  }

  const repo = await prisma.repo.upsert({
    where: { fullName: parsed.fullName },
    create: { fullName: parsed.fullName, installationId: "concierge", defaultBranch: "unknown" },
    update: {},
  });
  const existing = await prisma.fixPr.findFirst({ where: { repoId: repo.id, prNumber: parsed.number } });
  if (existing) {
    log.info(`${parsed.fullName}#${parsed.number} is already logged`);
    return;
  }
  await prisma.fixPr.create({
    data: { repoId: repo.id, changeId: storyId, prNumber: parsed.number, state: "OPENED" },
  });
  log.ok(`logged ${parsed.fullName}#${parsed.number} for ${storyId}; pnpm w signals tracks it from here`);
}
