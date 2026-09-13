/**
 * Client for the published JSON feed.
 *
 * The MCP server does not open Postgres. It reads what the site already
 * publishes, so a coding agent pointed at a deployed Driftwatch instance
 * sees the same reviewed facts a human would.
 */

export const DEFAULT_FEED_URL =
  process.env.DRIFTWATCH_FEED_URL ?? "http://localhost:3000/api/feed.json";

export type Severity =
  | "BREAKING"
  | "DEPRECATION"
  | "BEHAVIORAL"
  | "ADDITIVE"
  | "COSMETIC";

export const SEVERITY_ORDER: Severity[] = [
  "BREAKING",
  "DEPRECATION",
  "BEHAVIORAL",
  "ADDITIVE",
  "COSMETIC",
];

export interface FeedChange {
  id: string;
  ruleId: string;
  severity: Severity;
  directionFlip: boolean;
  headline: string;
  body: string;
  componentName?: string;
  affectedOperations?: number;
  method?: string;
  path?: string;
  fieldPath?: string;
  detail?: string;
  siteCount: number;
}

export interface FeedRelease {
  id: string;
  providerSlug: string;
  providerName: string;
  sourceKey: string;
  sourceLabel: string;
  shippedAt: string;
  commitSha?: string;
  repo?: string;
  counts: Record<Severity, number>;
  changes: FeedChange[];
  responseFieldAdds?: { count: number; fields: string[] };
}

export interface FeedDocument {
  version: string;
  generatedAt: string;
  note: string;
  releases: FeedRelease[];
}

export interface FetchFeedOptions {
  url?: string;
  provider?: string;
  limit?: number;
  /** Rank breaks ahead of additive-only releases. */
  preferSignal?: boolean;
}

export function feedUrl(options: FetchFeedOptions = {}): string {
  const base = options.url ?? DEFAULT_FEED_URL;
  const url = new URL(base);
  if (options.provider) url.searchParams.set("provider", options.provider);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.preferSignal) url.searchParams.set("signal", "1");
  return url.toString();
}

export async function fetchFeed(options: FetchFeedOptions = {}): Promise<FeedDocument> {
  const target = feedUrl(options);
  const response = await fetch(target, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`GET ${target} → ${response.status} ${response.statusText}`.trim());
  }
  const body = (await response.json()) as FeedDocument;
  if (!Array.isArray(body.releases)) {
    throw new Error(`GET ${target} did not return a feed document`);
  }
  return body;
}

export function atLeast(severity: Severity, minimum: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(minimum);
}

export function hasSignal(release: Pick<FeedRelease, "counts">): boolean {
  return (
    release.counts.BREAKING +
      release.counts.DEPRECATION +
      release.counts.BEHAVIORAL >
    0
  );
}

export function filterReleases(
  releases: FeedRelease[],
  minimum: Severity,
): FeedRelease[] {
  const out: FeedRelease[] = [];
  for (const release of releases) {
    const changes = release.changes.filter((c) => atLeast(c.severity, minimum));
    const keepAdds = atLeast("ADDITIVE", minimum) ? release.responseFieldAdds : undefined;
    if (changes.length === 0 && !keepAdds) continue;
    out.push({ ...release, changes, responseFieldAdds: keepAdds });
  }
  return out;
}
