import { rm, writeFile } from "node:fs/promises";

import {
  RULES,
  RULESET_VERSION,
  composeUrl,
  providerNote,
  rankDrafts,
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
 * story from the last DRAFT_WINDOW_DAYS that has no draft yet. With
 * `--refresh` it also rewrites every draft still waiting (neither posted nor
 * skipped) from the current templates, however old; a posted draft is a
 * record of what was said and is never touched. Plain `share`
 * lists the drafts nobody has posted or skipped, each with an X compose link
 * pre-filled with the draft: one click opens it, a person still presses Post.
 * `--pick` (run daily by the share workflow) chooses the one waiting draft
 * most worth posting today, with two runners-up, for the share-today issue.
 * Nothing in Driftwatch posts on its own.
 */

const SITE_URL = (process.env["SITE_URL"] ?? "https://driftwatch.et").replace(/\/+$/, "");
/** Older stories are history, not news worth a post. */
const DRAFT_WINDOW_DAYS = 14;

export interface ShareOptions {
  generate?: boolean;
  refresh?: boolean;
  pick?: boolean;
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
    await generate(options.refresh === true);
    return;
  }
  if (options.pick) {
    await pick(options.out);
    return;
  }
  await list(options.limit ?? 10, options.out);
}

async function generate(refresh: boolean): Promise<void> {
  const existing = await prisma.shareDraft.findMany({
    select: { storyId: true, shippedAt: true, postedAt: true, skippedAt: true },
  });
  const waiting = existing.filter((d) => !d.postedAt && !d.skippedAt);
  // Without --refresh every drafted story is left alone; with it, only the
  // ones a person already posted or skipped.
  const drafted = new Set((refresh ? existing.filter((d) => d.postedAt || d.skippedAt) : existing).map((d) => d.storyId));
  const windowStart = new Date(Date.now() - DRAFT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  let since = windowStart;
  if (refresh) {
    for (const draft of waiting) if (draft.shippedAt < since) since = draft.shippedAt;
  }
  const isWaiting = new Set(waiting.map((d) => d.storyId));

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

  let created = 0;
  let rewritten = 0;
  for (const [storyId, list] of stories) {
    // An older story is only here to refresh its waiting draft, never to start one.
    if (!isWaiting.has(storyId) && (list[0]!.run.to.providerTime ?? list[0]!.run.to.capturedAt) < windowStart) continue;
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
      providerNote: providerNote(to.source.provider.slug),
    });

    const text = { xPost: drafts.x, title: drafts.title, body: drafts.body };
    if (isWaiting.has(storyId)) {
      await prisma.shareDraft.update({ where: { storyId }, data: text });
      rewritten++;
    } else {
      await prisma.shareDraft.create({
        data: { storyId, providerSlug: to.source.provider.slug, shippedAt, ...text },
      });
      created++;
    }
  }
  log.ok(
    `share: ${created} new draft(s) for breaking changes shipped in the last ${DRAFT_WINDOW_DAYS} days` +
      (refresh ? `, ${rewritten} waiting draft(s) rewritten` : ""),
  );
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
      `Compose: ${composeUrl(draft.xPost)}`,
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

const REPO_URL = "https://github.com/asgerami/driftwatch";
const RUNNERS_UP = 2;

/**
 * Today's draft for the share-today issue. With `out`, the body goes to <out>
 * and the issue title to <out>.title, and both are removed when there is
 * nothing worth posting, which closes the issue (as `report` does).
 */
/** The next best, from other providers than the pick where there are any. */
function runnersUp<T extends { draft: { providerSlug: string } }>(ranked: T[]): T[] {
  const [top, ...rest] = ranked;
  if (!top) return [];
  const chosen: T[] = [];
  const seen = new Set([top.draft.providerSlug]);
  for (const p of rest) {
    if (chosen.length === RUNNERS_UP) break;
    if (!seen.has(p.draft.providerSlug)) {
      chosen.push(p);
      seen.add(p.draft.providerSlug);
    }
  }
  for (const p of rest) {
    if (chosen.length === RUNNERS_UP) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  return chosen;
}

async function pick(out?: string): Promise<void> {
  const waiting = await prisma.shareDraft.findMany({ where: { postedAt: null, skippedAt: null } });
  // Only stories still published under the current ruleset: a draft whose
  // story was later rejected must never be put in front of a person to post.
  const facts = await prisma.change.findMany({
    where: {
      storyId: { in: waiting.map((d) => d.storyId) },
      publishedAt: { not: null },
      run: { rulesetVer: RULESET_VERSION },
    },
    select: { storyId: true, ruleId: true, directionFlip: true },
  });
  const factOf = new Map(facts.map((f) => [f.storyId!, f]));
  const recentlyPosted = (
    await prisma.shareDraft.findMany({
      where: { postedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { providerSlug: true, postedAt: true },
    })
  ).map((d) => ({ providerSlug: d.providerSlug, postedAt: d.postedAt! }));

  const ranked = rankDrafts(
    waiting.flatMap((d) => {
      const fact = factOf.get(d.storyId);
      return fact ? [{ ...d, shippedAt: d.shippedAt.toISOString(), ruleId: fact.ruleId, directionFlip: fact.directionFlip }] : [];
    }),
    { now: new Date(), recentlyPosted },
  );

  const write = async (body: string | undefined, title?: string) => {
    if (!out) {
      console.log(body ?? "nothing worth posting today");
      return;
    }
    const path = outputPath(out);
    if (body === undefined) {
      await Promise.all([rm(path, { force: true }), rm(`${path}.title`, { force: true })]);
      log.info("share: nothing worth posting today");
      return;
    }
    await Promise.all([writeFile(path, body), writeFile(`${path}.title`, title!)]);
    log.ok(`share: today's pick → ${path}`);
  };

  const top = ranked[0];
  if (!top) return write(undefined);

  const mark = (action: "posted" | "skip", storyId: string) =>
    `${REPO_URL}/actions/workflows/share.yml (Run workflow → ${action} → ${storyId})`;
  const draft = top.draft;
  const body = [
    `## Post this today`,
    "",
    `**[Open it on X, ready to post](${composeUrl(draft.xPost)})**`,
    "",
    "```",
    draft.xPost,
    "```",
    "",
    `Why this one: ${top.reasons.join(", ")}.`,
    `Change page: ${SITE_URL}/changes/${draft.storyId}`,
    "",
    `Posted it? Mark it so tomorrow's pick moves on: ${mark("posted", draft.storyId)}, or locally \`pnpm w share --posted ${draft.storyId}\`.`,
    `Not worth it? ${mark("skip", draft.storyId)}, or \`pnpm w share --skip ${draft.storyId}\`.`,
    "",
    "<details><summary>Hacker News / Reddit version</summary>",
    "",
    `**${draft.title}**`,
    "",
    draft.body,
    "",
    "</details>",
    "",
    ...(ranked.length > 1
      ? [
          "## Or one of these",
          "",
          ...runnersUp(ranked)
            .map((p) => `- [${p.draft.xPost.split("\n")[0]}](${composeUrl(p.draft.xPost)}) · \`${p.draft.storyId}\` · ${p.reasons.join(", ")}`),
          "",
        ]
      : []),
    `_${ranked.length} draft(s) worth posting. Picked by the share workflow; nothing posts itself._`,
    "",
  ].join("\n");
  const headline = draft.xPost.split("\n")[0]!.replace(/\.$/, "");
  await write(body, `Post today: ${headline.length > 90 ? `${headline.slice(0, 89)}…` : headline}`);
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
