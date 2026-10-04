import { describe, expect, it } from "vitest";

import { RULES } from "./rules.js";
import { ALWAYS_HELD_RULES, autoPublishDecision, isSpike, median, type ReleaseContext } from "./policy.js";

const ordinary: ReleaseContext = { breakingFacts: 6, typicalBreakingFacts: 5, sourceReviewed: true };

describe("auto-publish policy", () => {
  it("publishes the shapes verified many times over", () => {
    for (const ruleId of [
      "response.enum.value-added",
      "response.property.removed",
      "response.property.became-optional",
      "request.property.became-required",
      "response.property.added",
      "operation.deprecated",
    ]) {
      expect(autoPublishDecision({ ruleId, severity: RULES[ruleId]!.severity }, ordinary)).toEqual({ publish: true });
    }
  });

  it("holds endpoint removals: Clerk withdrew documented endpoints, GitHub moved them", () => {
    const decision = autoPublishDecision({ ruleId: "path.removed", severity: "BREAKING" }, ordinary);
    expect(decision.publish).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining("withdrawn or moved") });
    expect(autoPublishDecision({ ruleId: "operation.removed", severity: "BREAKING" }, ordinary).publish).toBe(false);
  });

  it("holds every authentication change: Square's converter wrote a malformed one", () => {
    for (const ruleId of ["security.scope-added", "security.scheme-changed", "security.requirement-removed"]) {
      expect(autoPublishDecision({ ruleId, severity: RULES[ruleId]!.severity }, ordinary)).toMatchObject({
        publish: false,
        reason: "authentication change",
      });
    }
  });

  it("holds a spike: Square's format migration had 841 breaking facts", () => {
    const square = { breakingFacts: 841, typicalBreakingFacts: 2, sourceReviewed: true };
    expect(isSpike(square)).toBe(true);
    expect(autoPublishDecision({ ruleId: "response.enum.value-added", severity: "BREAKING" }, square)).toMatchObject({
      publish: false,
      reason: expect.stringContaining("841 breaking facts"),
    });
  });

  it("does not call a large release a spike for a source that is always large", () => {
    expect(isSpike({ breakingFacts: 30, typicalBreakingFacts: 12, sourceReviewed: true })).toBe(false);
    expect(isSpike({ breakingFacts: 20, typicalBreakingFacts: 1, sourceReviewed: true })).toBe(false);
  });

  it("holds everything from a source no person has reviewed", () => {
    const fresh = { ...ordinary, sourceReviewed: false };
    expect(autoPublishDecision({ ruleId: "response.property.added", severity: "ADDITIVE" }, fresh).publish).toBe(false);
  });

  it("only names rules that exist", () => {
    for (const id of ALWAYS_HELD_RULES) expect(RULES[id]).toBeDefined();
  });

  it("median", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});
