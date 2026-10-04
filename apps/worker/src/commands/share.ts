import { writeFile } from "node:fs/promises";

import {
  RULES,
  RULESET_VERSION,
  renderImpact,
  shareDrafts,
  storyDetail,
  type Change,
} from "@driftwatch/core";

import { prisma } from "../db.js";
import { log } from "../log.js";
import { outputPath } from "./report.js";

/**
 * The share kit: draft posts for published breaking changes.
 *
 * `--generate` (run by the scheduled job) drafts every published breaking
 * story from the last DRAFT_WINDOW_DAYS that has no draft yet. Plain `share`
 * lists the drafts nobody has posted or skipped, each with an X compose link
 * pre-filled with the draft: one click opens it, a person still presses Post.
 * Nothing in Driftwatch posts on its own.
 */

const SITE_URL = (process.env["SITE_URL"] ?? "https://driftwatch.et").replace(/\/+$/, "");
/** Older stories are history, not news worth a post. */
const DRAFT_WINDOW_DAYS = 14;

export interface ShareOptions {
  generate?: boolean;
  posted?: string;
  skip?: string;
  limit?: number;
  out?: string;
}

export async function share(options: ShareOptions = {}): Promise<void> {
  if (options.posted || options.skip) {
    const storyId = (options.posted ?? options.skip)!;
    const result = await prisma.shareDraft.updateMany({
      where: { storyId },
      data: options.posted ? { postedAt: new Date() } : { skippedAt: new Date() },
    });
    if (result.count === 0) log.warn(`no draft for ${storyId}`);
    else log.ok(`${storyId}: marked ${options.posted ? "posted" : "skipped"}`);
    return;
  }
  if (options.generate) {
    await generate();
    return;
  }
  await list(options.limit ?? 10, options.out);
}

async function generate(): Promise<void> {
  const since = new Date(Date.now() - DRAFT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const drafted = new Set((await prisma.shareDraft.findMany({ select: { storyId: true } })).map((d) => d.storyId));

  const rows = await prisma.change.findMany({
    where: {
      severity: "BREAKING",
      publishedAt: { not: null },
      storyId: { not: null },
      run: { rulesetVer: RULESET_VERSION, to: { providerTime: { gte: since } } },
    },
    select: {
      storyId: true,
      ruleId: true,
      severity: true,
      confidence: true,
      directionFlip: true,
      fingerprint: true,
      jsonPointer: true,
      method: true,
      path: true,
      operationId: true,
      componentName: true,
      affectedOperations: true,
      fieldPath: true,
      detail: true,
      before: true,
      after: true,
      run: {
        select: {
          from: { select: { commitSha: true } },
          to: {
            select: {
              commitSha: true,
              providerTime: true,
              capturedAt: true,
              source: { select: { repo: true, url: true, provider: { select: { slug: true, name: true } } } },
            },
          },
        },
      },
    },
  });

  const stories = new Map<string, typeof rows>();
  for (const row of rows) {
    if (drafted.has(row.storyId!)) continue;
    const list = stories.get(row.storyId!) ?? [];
    list.push(row);
    stories.set(row.storyId!, list);
  }

  const watchedApis = await prisma.provider.count({ where: { sources: { some: { active: true } } } });
  let created = 0;
  for (const [storyId, list] of stories) {
    const first = list[0]!;
    const rule = RULES[first.ruleId];
    const impact = renderImpact({
      ...first,
      method: first.method ?? undefined,
      path: first.path ?? undefined,
      operationId: first.operationId ?? undefined,
      componentName: first.componentName ?? undefined,
      affectedOperations: first.affectedOperations ?? undefined,
      fieldPath: first.fieldPath ?? undefined,
      detail: first.detail ?? undefined,
      before: first.before as never,
      after: first.after as never,
      headline: rule?.headline ?? first.ruleId,
      consequence: rule?.consequence ?? "",
      publishable: true,
    } as Change);

    const { from, to } = first.run;
    const shippedAt = to.providerTime ?? to.capturedAt;
    const drafts = shareDrafts({
      providerName: to.source.provider.name,
      headline: impact.headline,
      consequence: rule?.consequence ?? "",
      ruleId: first.ruleId,
      directionFlip: first.directionFlip,
      detail: storyDetail(list),
      locations: [...new Set(list.map(locationOf))],
      shippedAt: shippedAt.toISOString(),
      changeUrl: `${SITE_URL}/changes/${storyId}`,
      sourceUrl: sourceUrlOf(to.source.repo, to.source.url, from.commitSha, to.commitSha),
      watchedApis,
    });

    await prisma.shareDraft.create({
      data: {
        storyId,
        providerSlug: to.source.provider.slug,
        shippedAt,
        xPost: drafts.x,
        title: drafts.title,
        body: drafts.body,
      },
    });
    created++;
  }
  log.ok(`share: ${created} new draft(s) for breaking changes shipped in the last ${DRAFT_WINDOW_DAYS} days`);
}

async function list(limit: number, out?: string): Promise<void> {
  const drafts = await prisma.shareDraft.findMany({
    where: { postedAt: null, skippedAt: null },
    orderBy: { shippedAt: "desc" },
    take: limit,
  });
  const waiting = await prisma.shareDraft.count({ where: { postedAt: null, skippedAt: null } });
  if (drafts.length === 0) {
    log.info("no drafts waiting");
    return;
  }

  const blocks = drafts.map((draft) =>
    [
      `## ${draft.storyId}`,
      "",
      "### X",
      "",
      draft.xPost,
      "",
      `Compose: https://x.com/intent/post?text=${encodeURIComponent(draft.xPost)}`,
      "",
      "### Hacker News / Reddit",
      "",
      `Title: ${draft.title}`,
      "",
      draft.body,
      "",
      `Done: pnpm w share --posted ${draft.storyId}    Not worth it: pnpm w share --skip ${draft.storyId}`,
    ].join("\n"),
  );
  const document = `# ${waiting} draft(s) waiting, newest ${drafts.length} shown\n\n${blocks.join("\n\n---\n\n")}\n`;

  if (out) {
    const path = outputPath(out);
    await writeFile(path, document);
    log.ok(`${drafts.length} draft(s) → ${path}`);
  } else {
    console.log(document);
  }
}

function locationOf(row: {
  componentName: string | null;
  method: string | null;
  path: string | null;
  fieldPath: string | null;
}): string {
  if (row.componentName) return row.fieldPath ? `${row.componentName}.${row.fieldPath}` : row.componentName;
  const op = [row.method?.toUpperCase(), row.path].filter(Boolean).join(" ");
  return row.fieldPath ? `${op} · ${row.fieldPath}` : op;
}

function sourceUrlOf(
  repo: string | null,
  url: string | null,
  fromSha: string | null,
  toSha: string | null,
): string | undefined {
  if (repo && fromSha && toSha) return `https://github.com/${repo}/compare/${fromSha}...${toSha}`;
  if (repo && toSha) return `https://github.com/${repo}/commit/${toSha}`;
  return url ?? undefined;
}
