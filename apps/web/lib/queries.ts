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
import type { ChangeView, ProviderView, ReleaseView } from "./types";

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
function groupIntoStories(rows: ChangeRow[]): ChangeView[] {
  const views: ChangeView[] = [];
  for (const list of groupStories(rows)) {
    const first = list[0]!;
    const core = toCoreChange(first);
    const rule = ruleMetadata(first.ruleId);
    const impact = renderImpact({ ...core, ...rule });
    const facts = new Set(list.map((row) => row.fingerprint));
    const locations = [...new Set(list.map(locationOf))];

    views.push({
      id: first.id,
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

export async function listProviders(): Promise<ProviderView[]> {
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
}
