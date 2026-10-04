import { describe, expect, it } from "vitest";
import { groupStories, leafOf, parentOf, storyDetail, storyKeyOf, type StoryInput } from "./story.js";

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

describe("parent stories (real Vercel case, 2026-10-02)", () => {
  const removed = (fieldPath: string, componentName = "UserEvent") =>
    fact({ ruleId: "response.property.removed", componentName, fieldPath });

  it("collapses many fields removed from one parent into one story", () => {
    // newOwner went from 78 fields to 2 in one release.
    const fields = ["abuse", "billing", "avatar", "bio", "email", "softBlock", "limited"];
    const groups = groupStories(fields.map((f) => removed(`payload.newOwner.${f}`)));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(7);
  });

  it("keeps a few removed fields as separate stories", () => {
    const groups = groupStories(["a", "b", "c"].map((f) => removed(`payload.owner.${f}`)));
    expect(groups).toHaveLength(3);
  });

  it("keeps the same parent path under different components apart", () => {
    const one = ["a", "b", "c", "d", "e"].map((f) => removed(`data.${f}`, "Invoice"));
    const two = ["a", "b"].map((f) => removed(`data.${f}`, "Charge"));
    expect(groupStories([...one, ...two]).map((g) => g.length)).toEqual([5, 1, 1]);
  });

  it("still groups one field name across many parents (igic) by name", () => {
    const igic = ["at", "be", "bg", "cy", "cz", "de"].map((cc) =>
      fact({ ruleId: "request.property.removed", fieldPath: `country_options.${cc}.igic` }),
    );
    // Six parents with one field each: no parent reaches the threshold.
    expect(groupStories(igic)).toHaveLength(1);
  });

  it("parentOf drops the last segment", () => {
    expect(parentOf("payload.newOwner.abuse")).toBe("payload.newOwner");
    expect(parentOf("createdAt")).toBe("");
  });
});

