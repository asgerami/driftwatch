import { describe, expect, it } from "vitest";

import { sourceHealth, type HealthInput } from "./health.js";

const now = new Date("2026-09-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function source(over: Partial<HealthInput>): HealthInput {
  return {
    active: true,
    lastFetchAt: hoursAgo(1),
    lastSuccessAt: hoursAgo(1),
    lastError: null,
    consecutiveFailures: 0,
    ...over,
  };
}

describe("sourceHealth", () => {
  it("is ok after a recent success", () => {
    expect(sourceHealth(source({}), now)).toEqual({ state: "ok", reason: null });
  });

  it("is failing after one failed attempt, and says why", () => {
    const health = sourceHealth(
      source({ consecutiveFailures: 1, lastError: "GET https://docs.hetzner.cloud/cloud.spec.json → 403" }),
      now,
    );
    expect(health.state).toBe("failing");
    expect(health.reason).toBe("failed once: GET https://docs.hetzner.cloud/cloud.spec.json → 403");
  });

  it("counts repeated failures", () => {
    const health = sourceHealth(source({ consecutiveFailures: 4, lastError: "timeout" }), now);
    expect(health.reason).toBe("failed 4 times in a row: timeout");
  });

  it("is stale when the last success is older than a day, even without an error", () => {
    const health = sourceHealth(source({ lastFetchAt: hoursAgo(30), lastSuccessAt: hoursAgo(30) }), now);
    expect(health).toEqual({ state: "stale", reason: "no successful fetch for 30h" });
  });

  it("is stale when it was polled but never succeeded", () => {
    expect(sourceHealth(source({ lastSuccessAt: null }), now).reason).toBe(
      "has never fetched successfully",
    );
  });

  it("does not alarm on a source nobody has polled yet, or one switched off", () => {
    expect(sourceHealth(source({ lastFetchAt: null, lastSuccessAt: null }), now).state).toBe("not polled");
    expect(sourceHealth(source({ active: false, consecutiveFailures: 9 }), now).state).toBe("ok");
  });
});
