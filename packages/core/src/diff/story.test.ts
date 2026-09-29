import { describe, expect, it } from "vitest";
import { groupStories, leafOf, storyDetail, storyKeyOf, type StoryInput } from "./story.js";

let n = 0;
function fact(over: Partial<StoryInput> & { ruleId: string }): StoryInput {
  return { severity: "BREAKING", fingerprint: `fp${n++}`, ...over };
}

describe("leafOf", () => {
  it("drops parents and array or map markers", () => {
    expect(leafOf("country_options.at.igic")).toBe("igic");
    expect(leafOf("line_items[].dynamic_tax_rates")).toBe("dynamic_tax_rates");
    expect(leafOf("payment_method_types")).toBe("payment_method_types");
    expect(leafOf("items[]")).toBe("items");
    expect(leafOf("metadata[key]")).toBe("metadata");
  });
});

describe("stories (real Stripe cases, 2025-11 → 2026-09)", () => {
  it("one enum value added in many components is one story", () => {
    const payto = ["confirmation_tokens_resource_payment_method_preview", "payment_method", "mandate"].map(
      (componentName) =>
        fact({ ruleId: "response.enum.value-added", fieldPath: `${componentName}.type`, detail: 'can now return "payto"' }),
    );
    const other = fact({ ruleId: "response.enum.value-added", fieldPath: "type", detail: 'can now return "upi"' });
    expect(groupStories([...payto, other]).map((g) => g.length)).toEqual([3, 1]);
  });

  it("igic removed under 26 countries is one story", () => {
    const igic = ["at", "be", "bg", "cy"].map((cc) =>
      fact({ ruleId: "request.property.removed", fieldPath: `country_options.${cc}.igic` }),
    );
    expect(groupStories(igic)).toHaveLength(1);
  });

  it("a field that lost its guarantee two ways is one story with both details", () => {
    const both = [
      fact({ ruleId: "response.property.became-optional", fieldPath: "brand", detail: "no longer guaranteed present" }),
      fact({ ruleId: "response.property.became-optional", fieldPath: "brand", detail: "can now be null" }),
    ];
    const groups = groupStories(both);
    expect(groups).toHaveLength(1);
    expect(storyDetail(groups[0]!)).toBe("no longer guaranteed present; can now be null");
  });

  it("different fields removed from one endpoint stay separate", () => {
    const refunds = ["amount", "charge", "reason"].map((field) =>
      fact({ ruleId: "request.property.removed", fieldPath: field }),
    );
    expect(groupStories(refunds)).toHaveLength(3);
  });

  it("the same field retyped two different ways is two stories", () => {
    const a = fact({ ruleId: "response.property.type-changed", fieldPath: "count", detail: "integer → string" });
    const b = fact({ ruleId: "response.property.type-changed", fieldPath: "x.count", detail: "integer → object" });
    const c = fact({ ruleId: "response.property.type-changed", fieldPath: "y.count", detail: "integer → string" });
    expect(groupStories([a, b, c]).map((g) => g.length)).toEqual([2, 1]);
  });

  it("never merges across severities", () => {
    const breaking = fact({ ruleId: "request.property.removed", fieldPath: "a.igic", severity: "BREAKING" });
    const milder = fact({ ruleId: "request.property.removed", fieldPath: "b.igic", severity: "BEHAVIORAL" });
    expect(groupStories([breaking, milder])).toHaveLength(2);
  });

  it("leaves every other rule at one card per fact", () => {
    const paths = [fact({ ruleId: "path.removed" }), fact({ ruleId: "path.removed" })];
    expect(groupStories(paths)).toHaveLength(2);
    const same = fact({ ruleId: "path.removed" });
    expect(groupStories([same, { ...same }])).toHaveLength(1);
    expect(storyKeyOf(same)).toContain(same.fingerprint);
  });
});
