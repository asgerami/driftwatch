import { describe, expect, it } from "vitest";
import { renderImpact } from "./index.js";
import type { Change } from "../diff/index.js";

function change(over: Partial<Change>): Change {
  return {
    ruleId: "response.property.removed",
    jsonPointer: "/x",
    severity: "BREAKING",
    confidence: 100,
    directionFlip: false,
    headline: "h",
    consequence: "c",
    publishable: true,
    fingerprint: "f",
    ...over,
  } as Change;
}

describe("renderImpact", () => {
  it("renders a property access for a removed response field", () => {
    const out = renderImpact(change({ fieldPath: "customer.address" }));
    expect(out.headline).toBe("Response field address removed");
    expect(out.patterns.ts).toContain("response.customer.address");
  });

  it("walks array hops in the field path", () => {
    const out = renderImpact(change({ fieldPath: "data[].customer.id" }));
    expect(out.patterns.ts).toContain("response.data[0].customer.id");
  });

  it("bracket-quotes keys that are not valid identifiers", () => {
    const out = renderImpact(change({ fieldPath: "meta.content-type" }));
    expect(out.patterns.ts).toContain('["content-type"]');
  });

  it("lists the new values for an added response enum", () => {
    const out = renderImpact(
      change({
        ruleId: "response.enum.value-added",
        fieldPath: "payment_method_types[]",
        detail: 'can now return "billie", "alipay"',
        directionFlip: true,
      }),
    );
    expect(out.headline).toContain('"billie"');
    expect(out.patterns.ts).toContain("no branch for");
    expect(out.body).toContain("`billie`");
  });

  it("names the component and blast radius when the change is shared", () => {
    const out = renderImpact(
      change({ componentName: "Charge", affectedOperations: 241, fieldPath: "iin" }),
    );
    expect(out.body).toContain("`Charge`");
    expect(out.body).toContain("241 operations");
  });

  it("says a removed request parameter is silent", () => {
    const out = renderImpact(
      change({ ruleId: "request.param.removed", fieldPath: "expand", path: "/v1/charges" }),
    );
    expect(out.body).toContain("Grep for it");
  });

  it("spells out a pagination default change in both directions", () => {
    const out = renderImpact(
      change({
        ruleId: "pagination.default-changed",
        fieldPath: "per_page",
        before: 100,
        after: 30,
        path: "/repos",
      }),
    );
    expect(out.headline).toContain("30");
    expect(out.patterns.ts).toContain("previously 100");
  });

  it("always produces a headline and body, even for an untemplated rule", () => {
    const out = renderImpact(change({ ruleId: "schema.composition-changed", severity: "BEHAVIORAL" }));
    expect(out.headline.length).toBeGreaterThan(0);
    expect(out.body.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const c = change({ fieldPath: "a.b.c" });
    expect(JSON.stringify(renderImpact(c))).toBe(JSON.stringify(renderImpact(c)));
  });

  it("names added endpoints and operations instead of a generic headline", () => {
    expect(
      renderImpact(
        change({
          ruleId: "path.added",
          severity: "ADDITIVE",
          path: "/v1/billing_portal/sessions",
          headline: "Endpoint added",
        }),
      ).headline,
    ).toBe("/v1/billing_portal/sessions added");

    expect(
      renderImpact(
        change({
          ruleId: "operation.added",
          severity: "ADDITIVE",
          method: "post",
          path: "/v1/charges",
          headline: "Operation added",
        }),
      ).headline,
    ).toBe("POST /v1/charges added");
  });

  it("names the field for additive property changes", () => {
    expect(
      renderImpact(
        change({
          ruleId: "response.property.added",
          severity: "ADDITIVE",
          fieldPath: "invoice.hosted_invoice_url",
          headline: "New response field",
        }),
      ).headline,
    ).toBe("Response field hosted_invoice_url added");

    expect(
      renderImpact(
        change({
          ruleId: "request.property.added",
          severity: "ADDITIVE",
          fieldPath: "expand",
          headline: "New request property",
        }),
      ).headline,
    ).toBe("Request property expand added");

    expect(
      renderImpact(
        change({
          ruleId: "request.param.optional-added",
          severity: "ADDITIVE",
          fieldPath: "limit",
          headline: "New optional parameter",
        }),
      ).headline,
    ).toBe("limit is now optional");
  });
});
