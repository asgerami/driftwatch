/**
 * Whether a source is fetching.
 *
 * The brief's rule: never let a source go stale silently. `status` prints this
 * per source and the review-queue issue lists every source that is not ok.
 */

/** Four missed polls at the 6-hour cadence. */
export const STALE_AFTER_HOURS = 24;

export type HealthState = "ok" | "failing" | "stale" | "not polled";

export interface HealthInput {
  active: boolean;
  lastFetchAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface Health {
  state: HealthState;
  /** One line a person can act on, or null when ok. */
  reason: string | null;
}

export function sourceHealth(source: HealthInput, now: Date = new Date()): Health {
  if (!source.active) return { state: "ok", reason: null };
  if (!source.lastFetchAt) return { state: "not polled", reason: null };

  if (source.consecutiveFailures > 0) {
    const times = source.consecutiveFailures === 1 ? "once" : `${source.consecutiveFailures} times in a row`;
    return {
      state: "failing",
      reason: `failed ${times}: ${source.lastError ?? "unknown error"}`,
    };
  }

  const hoursSince = source.lastSuccessAt
    ? (now.getTime() - source.lastSuccessAt.getTime()) / 3_600_000
    : Infinity;
  if (hoursSince > STALE_AFTER_HOURS) {
    return {
      state: "stale",
      reason: source.lastSuccessAt
        ? `no successful fetch for ${Math.floor(hoursSince)}h`
        : "has never fetched successfully",
    };
  }

  return { state: "ok", reason: null };
}
