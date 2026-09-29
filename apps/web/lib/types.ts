import type { Severity } from "@driftwatch/core";

/**
 * View models.
 *
 * Pages read from Postgres; components take only these. Keeping the two apart
 * means the presentation can be rendered and checked without a database,
 * which is the only reason the site could be verified at all before the
 * first backfill exists.
 */

export interface ChangeView {
  id: string;
  ruleId: string;
  severity: Severity;
  directionFlip: boolean;
  headline: string;
  body: string;
  patterns: { ts?: string; py?: string; go?: string };
  /** Where it lives: a component name, or a METHOD + path. */
  componentName?: string;
  affectedOperations?: number;
  method?: string;
  path?: string;
  fieldPath?: string;
  detail?: string;
  /** How many call sites share this fact. */
  siteCount: number;
  sampleSites: string[];
  /**
   * Every place this story occurs, when it groups more than one fact (the
   * same enum value in seven components, one field under 26 countries).
   * Absent for a single fact, which keeps its own location line.
   */
  locations?: string[];
}

/** Several new response fields, collapsed from individual cards. */
export interface AdditiveLine {
  /** Distinct facts, after fingerprint grouping. */
  count: number;
  /** Field labels, already ordered for display. */
  fields: string[];
}

export interface ReleaseView {
  /** Diff run id. */
  id: string;
  providerSlug: string;
  providerName: string;
  sourceKey: string;
  sourceLabel: string;
  /** When the provider shipped it. */
  shippedAt: string;
  commitSha?: string;
  repo?: string;
  counts: Record<Severity, number>;
  /** Cards. Property-adds may be collapsed into the lines below. */
  changes: ChangeView[];
  /** Several new response fields, as one line instead of N identical cards. */
  responseFieldAdds?: AdditiveLine;
  /** Several new request properties, as one line instead of N identical cards. */
  requestPropertyAdds?: AdditiveLine;
  /** Provider context a reader needs to judge a break, e.g. API version pinning. */
  providerNote?: string;
}

export interface ProviderView {
  slug: string;
  name: string;
  docsUrl?: string;
  sourceCount: number;
  snapshotCount: number;
  breakingCount: number;
  earliest?: string;
  latest?: string;
}

export const SEVERITY_ORDER: Severity[] = [
  "BREAKING",
  "DEPRECATION",
  "BEHAVIORAL",
  "ADDITIVE",
  "COSMETIC",
];

export const SEVERITY_LABEL: Record<Severity, string> = {
  BREAKING: "Breaking",
  DEPRECATION: "Deprecation",
  BEHAVIORAL: "Behavioral",
  ADDITIVE: "Additive",
  COSMETIC: "Cosmetic",
};
