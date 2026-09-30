import { writeFile, rm } from "node:fs/promises";

import {
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULES,
  RULESET_VERSION,
  groupStories,
  storyDetail,
  type Severity,
} from "@driftwatch/core";

import { prisma } from "../db.js";
import { sourceHealth, type Health } from "../health.js";
import { log } from "../log.js";

/**
 * What needs a person: stories waiting for review, and sources not fetching.
 *
 * The scheduled job turns this into a GitHub issue, because a review gate
 * nobody is told about is a queue that grows forever: twelve new facts sat
 * unnoticed for a day after the first publish.
 *
 * Writes nothing when nothing needs attention, so the job can close the issue.
 */

export interface StoryLine {
  severity: Severity;
  ruleId: string;
  where: string;
  places: number;
  detail?: string;
}

export interface UnhealthySource {
  name: string;
  health: Health;
}

export interface Report {
  title: string;
  body: string;
}

const STORIES_SHOWN = 50;

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function buildReport(stories: StoryLine[], unhealthy: UnhealthySource[]): Report | null {
  if (stories.length === 0 && unhealthy.length === 0) return null;

  const parts: string[] = [];
  if (stories.length > 0) parts.push(`${stories.length} ${stories.length === 1 ? "story" : "stories"} to review`);
  if (unhealthy.length > 0) {
    parts.push(`${unhealthy.length} ${unhealthy.length === 1 ? "source" : "sources"} not fetching`);
  }
  const title = `Driftwatch: ${parts.join(", ")}`;

  const lines: string[] = [];
  if (unhealthy.length > 0) {
    lines.push("## Sources not fetching", "");
    for (const { name, health } of unhealthy) {
      lines.push(`- **${name}** (${health.state}): ${health.reason ?? ""}`);
    }
    lines.push("");
  }

  if (stories.length > 0) {
    lines.push(`## Waiting for review`, "");
    lines.push("| Severity | Rule | Where | Detail |", "| --- | --- | --- | --- |");
    for (const story of stories.slice(0, STORIES_SHOWN)) {
      const where = story.places > 1 ? `${story.where} (+${story.places - 1} more)` : story.where;
      lines.push(
        `| ${story.severity} | \`${story.ruleId}\` | ${cell(where)} | ${cell(story.detail ?? "")} |`,
      );
    }
    if (stories.length > STORIES_SHOWN) {
      lines.push("", `…and ${stories.length - STORIES_SHOWN} more.`);
    }
    lines.push(
      "",
      "Read them with `pnpm w review`. Publish with `pnpm w review --publish`; " +
        "reject a false positive with `pnpm w review --reject <text>`.",
    );
  }

  lines.push("", "_Updated by the scheduled poll job. Closed automatically when empty._");
  return { title, body: lines.join("\n") };
}

const SEVERITY_RANK: Record<string, number> = {
  BREAKING: 0,
  DEPRECATION: 1,
  BEHAVIORAL: 2,
  ADDITIVE: 3,
  COSMETIC: 4,
};

export async function report(options: { out?: string } = {}): Promise<void> {
  const pending = await prisma.change.findMany({
    where: {
      publishedAt: null,
      reviewedAt: null,
      confidence: { gte: PUBLISH_CONFIDENCE_THRESHOLD },
      severity: { not: "COSMETIC" },
      run: { rulesetVer: RULESET_VERSION },
    },
    select: {
      ruleId: true,
      severity: true,
      fingerprint: true,
      componentName: true,
      method: true,
      path: true,
      fieldPath: true,
      detail: true,
      run: { select: { to: { select: { source: { select: { key: true, provider: { select: { slug: true } } } } } } } },
    },
  });

  const stories: StoryLine[] = groupStories(pending)
    .map((list) => {
      const first = list[0]!;
      const source = first.run.to.source;
      const places = new Set(list.map(whereOf)).size;
      return {
        severity: first.severity as Severity,
        ruleId: first.ruleId,
        where: `${source.provider.slug}: ${whereOf(first)}`,
        places,
        detail: storyDetail(list) ?? RULES[first.ruleId]?.headline,
      };
    })
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));

  const sources = await prisma.specSource.findMany({
    include: { provider: { select: { slug: true } } },
    orderBy: [{ provider: { slug: "asc" } }, { key: "asc" }],
  });
  const now = new Date();
  const unhealthy: UnhealthySource[] = sources
    .map((source) => ({ name: `${source.provider.slug}/${source.key}`, health: sourceHealth(source, now) }))
    .filter(({ health }) => health.state === "failing" || health.state === "stale");

  const built = buildReport(stories, unhealthy);

  if (!built) {
    log.ok("nothing needs attention");
    if (options.out) {
      await rm(options.out, { force: true });
      await rm(`${options.out}.title`, { force: true });
    }
    return;
  }

  if (options.out) {
    await writeFile(options.out, built.body);
    await writeFile(`${options.out}.title`, built.title);
    log.info(`${built.title} → ${options.out}`);
  } else {
    console.log(`# ${built.title}\n\n${built.body}`);
  }
}

function whereOf(row: {
  componentName: string | null;
  method: string | null;
  path: string | null;
  fieldPath: string | null;
}): string {
  if (row.componentName) {
    return row.fieldPath ? `${row.componentName}.${row.fieldPath}` : row.componentName;
  }
  const op = [row.method?.toUpperCase(), row.path].filter(Boolean).join(" ");
  return row.fieldPath ? `${op} · ${row.fieldPath}` : op;
}
