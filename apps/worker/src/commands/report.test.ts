import { describe, expect, it } from "vitest";

import { buildReport } from "./report.js";

describe("buildReport", () => {
  it("returns nothing when nothing needs attention, so the issue can close", () => {
    expect(buildReport([], [])).toBeNull();
  });

  it("titles with counts and lists both sections", () => {
    const report = buildReport(
      [
        {
          severity: "BREAKING",
          ruleId: "response.property.became-optional",
          where: "openai: EvalRun.model",
          places: 1,
          detail: "can now be null",
        },
        {
          severity: "BREAKING",
          ruleId: "request.property.removed",
          where: "stripe: POST /v1/tax/registrations · country_options.at.igic",
          places: 27,
        },
      ],
      [{ name: "hetzner/cloud", health: { state: "failing", reason: "failed once: GET … → 403" } }],
    )!;

    expect(report.title).toBe("Driftwatch: 2 stories to review, 1 source not fetching");
    expect(report.body).toContain("**hetzner/cloud** (failing): failed once");
    expect(report.body).toContain("openai: EvalRun.model | can now be null");
    expect(report.body).toContain("(+26 more)");
    expect(report.body).toContain("pnpm w review --publish");
  });

  it("escapes pipes so a detail cannot break the table", () => {
    const report = buildReport(
      [{ severity: "BREAKING", ruleId: "response.property.type-changed", where: "x", places: 1, detail: "integer|null → object" }],
      [],
    )!;
    expect(report.body).toContain("integer\\|null → object");
  });

  it("uses singulars", () => {
    const report = buildReport([{ severity: "ADDITIVE", ruleId: "path.added", where: "x", places: 1 }], [])!;
    expect(report.title).toBe("Driftwatch: 1 story to review");
  });
});
