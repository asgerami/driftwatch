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
  changes: ChangeView[];
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
