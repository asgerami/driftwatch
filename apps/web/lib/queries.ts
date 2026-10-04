import { cache } from "react";
import {
  RULES,
  RULESET_VERSION,
  groupStories,
  renderImpact,
  storyDetail,
  type Change as CoreChange,
  type Severity,
} from "@driftwatch/core";
import { prisma } from "./db";
import { leadWithSignal, splitCards } from "./feed";
import { providerNote } from "./providers";
import type { ChangeView, ProviderView, ReleaseView, StoryFact, StoryPageView } from "./types";

/**
 * Every read the site does.
 *
 * Only published changes are ever selected. A change exists in the database
 * from the moment it is diffed, but it reaches the feed only once a human has
 * set `publishedAt`, which is the review gate the whole product's credibility
 * rests on.
 */

const EMPTY_COUNTS: Record<Severity, number> = {
  BREAKING: 0,
  DEPRECATION: 0,
  BEHAVIORAL: 0,
  ADDITIVE: 0,
  COSMETIC: 0,
};

interface ChangeRow {
  id: string;
  ruleId: string;
  severity: Severity;
  confidence: number;
  directionFlip: boolean;
  fingerprint: string;
  method: string | null;
  path: string | null;
  operationId: string | null;
  jsonPointer: string;
  componentName: string | null;
  affectedOperations: number | null;
  fieldPath: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  storyId: string | null;
}

function toCoreChange(row: ChangeRow): CoreChange {
  return {
    ruleId: row.ruleId,
    jsonPointer: row.jsonPointer,
    severity: row.severity,
    confidence: row.confidence,
    directionFlip: row.directionFlip,
    fingerprint: row.fingerprint,
    method: row.method ?? undefined,
    path: row.path ?? undefined,
    operationId: row.operationId ?? undefined,
    componentName: row.componentName ?? undefined,
    affectedOperations: row.affectedOperations ?? undefined,
    fieldPath: row.fieldPath ?? undefined,
    detail: row.detail ?? undefined,
    before: row.before as never,
    after: row.after as never,
    headline: "",
    consequence: "",
    publishable: true,
  };
}

/**
 * Collapse rows into stories, one card each.
 *
 * Rows sharing a fingerprint are one fact seen at several call sites. Facts
 * sharing a story key (`@driftwatch/core` storyKeyOf) are one thing that
 * happened, seen in several places: a new enum value in seven components,
 * one field removed under 26 countries. Showing each separately is how a
 * feed becomes unreadable. Severity is part of the key, so nothing milder
 * can absorb a break.
 */
/**
 * Rows grouped by their stored story id, so a card and its /changes/<id> page
 * always hold the same facts. Rows from before story ids existed fall back to
 * grouping here.
 */
function storiesOf(rows: ChangeRow[]): ChangeRow[][] {
  const byId = new Map<string, ChangeRow[]>();
  const loose: ChangeRow[] = [];
  for (const row of rows) {
    if (!row.storyId) {
      loose.push(row);
      continue;
    }
    const list = byId.get(row.storyId) ?? [];
    list.push(row);
    byId.set(row.storyId, list);
  }
  return [...byId.values(), ...groupStories(loose)];
}

function groupIntoStories(rows: ChangeRow[]): ChangeView[] {
  const views: ChangeView[] = [];
  for (const list of storiesOf(rows)) {
    const first = list[0]!;
    const core = toCoreChange(first);
    const rule = ruleMetadata(first.ruleId);
    const impact = renderImpact({ ...core, ...rule });
    const facts = new Set(list.map((row) => row.fingerprint));
    const locations = [...new Set(list.map(locationOf))];

    views.push({
      id: first.storyId ?? first.id,
      href: first.storyId ? `/changes/${first.storyId}` : undefined,
      ruleId: first.ruleId,
      severity: first.severity,
      directionFlip: first.directionFlip,
      headline: impact.headline,
      body: impact.body,
      patterns: impact.patterns,
      componentName: first.componentName ?? undefined,
      affectedOperations:
        Math.max(0, ...list.map((row) => row.affectedOperations ?? 0)) || undefined,
      method: first.method ?? undefined,
      path: first.path ?? undefined,
      fieldPath: first.fieldPath ?? undefined,
      detail: storyDetail(list),
      siteCount: list.length,
      sampleSites: list
        .filter((r) => r.path)
        .slice(0, 5)
        .map((r) => `${r.method?.toUpperCase() ?? ""} ${r.path}`.trim()),
      locations: facts.size > 1 && locations.length > 1 ? locations : undefined,
    });
  }

  return views.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.locations?.length ?? 1) - (a.locations?.length ?? 1) ||
      (b.affectedOperations ?? b.siteCount) - (a.affectedOperations ?? a.siteCount),
  );
}

function locationOf(row: ChangeRow): string {
  if (row.componentName) {
    return row.fieldPath ? `${row.componentName}.${row.fieldPath}` : row.componentName;
  }
  const op = [row.method?.toUpperCase(), row.path].filter(Boolean).join(" ");
  return row.fieldPath ? `${op} · ${row.fieldPath}`.trim() : op;
}

function severityRank(severity: Severity): number {
  return ["BREAKING", "DEPRECATION", "BEHAVIORAL", "ADDITIVE", "COSMETIC"].indexOf(
    severity,
  );
}

/**
 * Headline and consequence come from the ruleset, never from the database.
 *
 * Storing rendered prose would freeze it at diff time; deriving it means
 * improving a rule's wording improves every past change with it.
 */
function ruleMetadata(ruleId: string): { headline: string; consequence: string } {
  const rule = RULES[ruleId];
  return {
    headline: rule?.headline ?? ruleId,
    consequence: rule?.consequence ?? "",
  };
}

const CHANGE_SELECT = {
  id: true,
  ruleId: true,
  severity: true,
  confidence: true,
  directionFlip: true,
  fingerprint: true,
  method: true,
  path: true,
  operationId: true,
  jsonPointer: true,
  componentName: true,
  affectedOperations: true,
  fieldPath: true,
  detail: true,
  before: true,
  after: true,
  storyId: true,
} as const;

interface RunRow {
  id: string;
  to: {
    providerTime: Date | null;
    capturedAt: Date;
    commitSha: string | null;
    source: {
      key: string;
      label: string;
      repo: string | null;
      provider: { slug: string; name: string };
    };
  };
  changes: ChangeRow[];
}

function toRelease(run: RunRow): ReleaseView {
  const grouped = groupIntoStories(run.changes);
  const counts = { ...EMPTY_COUNTS };
  for (const change of grouped) counts[change.severity]++;
  const { cards, responseFieldAdds, requestPropertyAdds, requestNullableAdds } = splitCards(grouped);

  return {
    id: run.id,
    providerSlug: run.to.source.provider.slug,
    providerName: run.to.source.provider.name,
    sourceKey: run.to.source.key,
    sourceLabel: run.to.source.label,
    shippedAt: (run.to.providerTime ?? run.to.capturedAt).toISOString(),
    commitSha: run.to.commitSha ?? undefined,
    repo: run.to.source.repo ?? undefined,
    counts,
    changes: cards,
    responseFieldAdds,
    requestPropertyAdds,
    requestNullableAdds,
    providerNote: counts.BREAKING > 0 ? providerNote(run.to.source.provider.slug) : undefined,
  };
}

const RUN_INCLUDE = {
  to: {
    select: {
      providerTime: true,
      capturedAt: true,
      commitSha: true,
      source: {
        select: {
          key: true,
          label: true,
          repo: true,
          provider: { select: { slug: true, name: true } },
        },
      },
    },
  },
  changes: {
    where: { publishedAt: { not: null } },
    select: CHANGE_SELECT,
  },
} as const;

/**
 * `next build` prerenders the ISR pages. With no database configured, or with
 * DRIFTWATCH_OFFLINE_BUILD set (which `pnpm check` does), they build empty and
 * fill on the first revalidate. `pnpm check` must not depend on the network:
 * prerendering the published feed from Neon over a slow connection took past
 * Next's 60s limit and failed the check. A real deploy leaves the flag unset
 * and prerenders fresh data. At runtime a missing DATABASE_URL still throws,
 * so a misconfigured deploy fails loudly instead of serving an empty feed that
 * looks like a quiet week.
 */
function buildingWithoutDatabase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" &&
    (!process.env.DATABASE_URL || process.env.DRIFTWATCH_OFFLINE_BUILD === "1")
  );
}

export async function recentReleases(
  limit = 20,
  providerSlug?: string,
  opts?: { preferSignal?: boolean },
): Promise<ReleaseView[]> {
  if (buildingWithoutDatabase()) return [];
  const take = opts?.preferSignal ? Math.max(limit * 3, 60) : limit;
  const runs = (await prisma.diffRun.findMany({
    where: {
      // Only the current ruleset's runs. Published facts carry forward on a
      // bump (apps/worker/src/diffing.ts), so an older run is superseded.
      rulesetVer: RULESET_VERSION,
      changes: { some: { publishedAt: { not: null } } },
      ...(providerSlug
        ? { to: { source: { provider: { slug: providerSlug } } } }
        : {}),
    },
    include: RUN_INCLUDE,
    orderBy: { to: { providerTime: "desc" } },
    take,
  })) as unknown as RunRow[];

  const releases = runs
    .map(toRelease)
    .filter(
      (release) => release.changes.length > 0 || release.responseFieldAdds,
    );

  if (opts?.preferSignal) return leadWithSignal(releases).slice(0, limit);
  return releases.slice(0, limit);
}

export const listProviders = cache(async function listProviders(): Promise<ProviderView[]> {
  if (buildingWithoutDatabase()) return [];
  const providers = (await prisma.provider.findMany({
    include: {
      sources: { select: { id: true } },
      snapshots: { select: { providerTime: true } },
    },
    orderBy: { slug: "asc" },
  })) as unknown as {
    slug: string;
    name: string;
    docsUrl: string | null;
    sources: { id: string }[];
    snapshots: { providerTime: Date | null }[];
  }[];

  const out: ProviderView[] = [];
  for (const provider of providers) {
    const times = provider.snapshots
      .map((s) => s.providerTime)
      .filter((t): t is Date => t !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    const breakingCount = await prisma.change.count({
      where: {
        severity: "BREAKING",
        publishedAt: { not: null },
        run: {
          rulesetVer: RULESET_VERSION,
          to: { source: { provider: { slug: provider.slug } } },
        },
      },
    });

    out.push({
      slug: provider.slug,
      name: provider.name,
      docsUrl: provider.docsUrl ?? undefined,
      sourceCount: provider.sources.length,
      snapshotCount: provider.snapshots.length,
      breakingCount,
      earliest: times[0]?.toISOString(),
      latest: times.at(-1)?.toISOString(),
    });
  }
  return out;
});

/**
 * One story's page: the card, the release it shipped in, and every fact.
 * Null when the id is unknown or nothing in it is published.
 */
export const getStory = cache(async function getStory(storyId: string): Promise<StoryPageView | null> {
  const rows = (await prisma.change.findMany({
    where: {
      storyId,
      publishedAt: { not: null },
      run: { rulesetVer: RULESET_VERSION },
    },
    select: {
      ...CHANGE_SELECT,
      publishedAt: true,
      run: {
        select: {
          from: { select: { commitSha: true, providerTime: true } },
          to: {
            select: {
              commitSha: true,
              providerTime: true,
              capturedAt: true,
              source: {
                select: {
                  key: true,
                  label: true,
                  repo: true,
                  url: true,
                  provider: { select: { slug: true, name: true, docsUrl: true } },
                },
              },
            },
          },
        },
      },
    },
  })) as unknown as (ChangeRow & {
    publishedAt: Date;
    run: {
      from: { commitSha: string | null; providerTime: Date | null };
      to: {
        commitSha: string | null;
        providerTime: Date | null;
        capturedAt: Date;
        source: {
          key: string;
          label: string;
          repo: string | null;
          url: string | null;
          provider: { slug: string; name: string; docsUrl: string | null };
        };
      };
    };
  })[];
  if (rows.length === 0) return null;

  const change = groupIntoStories(rows)[0]!;
  const { from, to } = rows[0]!.run;
  const source = to.source;
  const facts = new Map<string, StoryFact>();
  for (const row of rows) {
    const location = locationOf(row);
    const key = `${location}\u001f${row.fingerprint}`;
    if (facts.has(key)) continue;
    facts.set(key, {
      location,
      detail: row.detail ?? undefined,
      ...beforeAfter(row),
    });
  }

  return {
    change,
    providerSlug: source.provider.slug,
    providerName: source.provider.name,
    providerDocsUrl: source.provider.docsUrl ?? undefined,
    sourceLabel: source.label,
    shippedAt: (to.providerTime ?? to.capturedAt).toISOString(),
    detectedAt: to.capturedAt.toISOString(),
    publishedAt: rows[0]!.publishedAt.toISOString(),
    sourceLink: sourceLinkOf(source.repo, source.url, from.commitSha, to.commitSha),
    facts: [...facts.values()],
  };
});

/** A compare view for git sources, the spec URL for hosted ones. */
function sourceLinkOf(
  repo: string | null,
  url: string | null,
  fromSha: string | null,
  toSha: string | null,
): { href: string; label: string } | undefined {
  if (repo && fromSha && toSha) {
    return {
      href: `https://github.com/${repo}/compare/${fromSha}...${toSha}`,
      label: `${repo} @ ${fromSha.slice(0, 8)}…${toSha.slice(0, 8)}`,
    };
  }
  if (repo && toSha) {
    return { href: `https://github.com/${repo}/commit/${toSha}`, label: `${repo} @ ${toSha.slice(0, 8)}` };
  }
  if (url) return { href: url, label: url };
  return undefined;
}

/**
 * What a reader should see as before → after. For presence and requiredness
 * rules the stored before/after is just the field's name, which read as
 * "abuse → absent"; those get the state instead.
 */
function beforeAfter(row: ChangeRow): { before?: string; after?: string } {
  const id = row.ruleId;
  if (id.endsWith(".removed") && (id.includes("property") || id.includes("param"))) {
    return { before: "present", after: "absent" };
  }
  if (id.endsWith(".added") && (id.includes("property") || id.includes("param"))) {
    return { before: "absent", after: "present" };
  }
  if (id === "path.removed" || id === "operation.removed") return { before: "exists", after: "removed" };
  if (id === "path.added" || id === "operation.added") return { before: "absent", after: "exists" };
  if (id.endsWith("became-required") || id === "request.param.required-added") {
    return { before: "optional", after: "required" };
  }
  if (id === "response.property.became-optional" && row.detail === "no longer guaranteed present") {
    return { before: "always present", after: "may be missing" };
  }
  return { before: snippet(row.before), after: snippet(row.after) };
}

function snippet(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Every published story's id and when it was published, for the sitemap. */
export async function listPublishedStories(): Promise<{ id: string; publishedAt: string }[]> {
  if (buildingWithoutDatabase()) return [];
  const rows = await prisma.change.findMany({
    where: {
      storyId: { not: null },
      publishedAt: { not: null },
      run: { rulesetVer: RULESET_VERSION },
    },
    select: { storyId: true, publishedAt: true },
    distinct: ["storyId"],
    orderBy: { storyId: "asc" },
  });
  return rows.map((row) => ({ id: row.storyId!, publishedAt: row.publishedAt!.toISOString() }));
}

