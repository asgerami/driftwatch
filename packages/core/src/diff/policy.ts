/**
 * Which reviewed-shaped stories publish without a person.
 *
 * Until October 2026 a person approved every story. The queue reached 2334
 * stories in four days, and nearly all were shapes already checked against
 * real specs many times over: new enum values, new fields, fields removed or
 * made nullable. The false positives found so far all came from a few
 * shapes, and those are what stay with a person:
 *
 *   - Endpoint or operation removed. Clerk documented endpoints for a month
 *     and withdrew them; GitHub moved endpoints into another spec file. Both
 *     read exactly like removals, and "requests now 404" was not true.
 *   - Any authentication change. Square's Swagger 2.0 → OpenAPI 3.0
 *     converter wrote a malformed security entry that read as a scheme swap.
 *   - Any story in a release with an unusual number of breaking facts.
 *     Square's format migration (841) and Vercel's 78 → 2 field cut both
 *     arrived as spikes. A big release deserves a person even when it is real.
 *   - Everything from a source no person has reviewed yet, so each new API's
 *     first stories are read before any of its output publishes itself.
 *
 * Pure, like the ruleset: the same queue always yields the same decisions,
 * and /method renders these constants so the policy is public.
 */

export const AUTO_PUBLISH_POLICY = "auto-1";

/** Rules that always wait for a person, whatever the release looks like. */
export const ALWAYS_HELD_RULES: ReadonlySet<string> = new Set([
  "path.removed",
  "operation.removed",
  "security.scope-added",
  "security.scheme-changed",
  "security.alternative-removed",
  "security.requirement-removed",
]);

/** A release is a spike above this many breaking facts... */
export const SPIKE_FLOOR = 25;
/** ...and above this multiple of the source's typical release. */
export const SPIKE_MULTIPLE = 4;

export interface PolicyStory {
  ruleId: string;
  severity: string;
}

export interface ReleaseContext {
  /** Distinct breaking facts in this release. */
  breakingFacts: number;
  /** Median breaking facts across the source's other releases. */
  typicalBreakingFacts: number;
  /** Has a person ever published or rejected anything from this source? */
  sourceReviewed: boolean;
}

export type PolicyDecision = { publish: true } | { publish: false; reason: string };

export function isSpike(release: ReleaseContext): boolean {
  return (
    release.breakingFacts > SPIKE_FLOOR &&
    release.breakingFacts > SPIKE_MULTIPLE * release.typicalBreakingFacts
  );
}

export function autoPublishDecision(
  story: PolicyStory,
  release: ReleaseContext,
): PolicyDecision {
  if (!release.sourceReviewed) {
    return { publish: false, reason: "first stories from this source: a person reads them once" };
  }
  if (ALWAYS_HELD_RULES.has(story.ruleId)) {
    return {
      publish: false,
      reason: story.ruleId.startsWith("security.")
        ? "authentication change"
        : "endpoint removal: may be withdrawn or moved, not removed",
    };
  }
  if (isSpike(release)) {
    return {
      publish: false,
      reason: `unusually large release (${release.breakingFacts} breaking facts, typically ${release.typicalBreakingFacts})`,
    };
  }
  return { publish: true };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
