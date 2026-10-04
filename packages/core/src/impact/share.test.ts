import { describe, expect, it } from "vitest";

import { TITLE_LIMIT, X_LIMIT, shareDrafts, xLength, type ShareInput } from "./share.js";

const vercel: ShareInput = {
  providerName: "Vercel",
  headline: "Response field abuse removed",
  consequence:
    "Reads of this field return undefined, and the failure surfaces wherever that value is used rather than at the call.",
  ruleId: "response.property.removed",
  directionFlip: false,
  locations: ["POST /v11/projects · abuse", "GET /v9/projects/{idOrName} · abuse"],
  shippedAt: "2026-10-03T05:20:00.000Z",
  changeUrl: "https://driftwatch.et/changes/vercel-2026-10-03-4007d59c",
  sourceUrl: "https://openapi.vercel.sh/",
  watchedApis: 21,
};

describe("share drafts", () => {
  it("lead with the fact and link the change page", () => {
    const { x, title, body } = shareDrafts(vercel);
    expect(x.startsWith("Vercel API, 2026-10-03: Response field abuse removed.")).toBe(true);
    expect(x.endsWith(vercel.changeUrl)).toBe(true);
    expect(title).toBe("Vercel: Response field abuse removed (2026-10-03)");
    expect(body).toContain(`Details: ${vercel.changeUrl}`);
    expect(body).toContain("Spec diff: https://openapi.vercel.sh/");
  });

  it("disclose who is posting, on HN and Reddit", () => {
    expect(shareDrafts(vercel).body).toContain("Disclosure: I run Driftwatch");
  });

  it("say why a direction flip matters", () => {
    const flip = shareDrafts({ ...vercel, directionFlip: true, ruleId: "response.enum.value-added" });
    expect(flip.x).toContain("From the calling end, it is.");
    expect(flip.body).toContain("From the calling end, it is.");
  });

  it("fit X's limit and keep the link, however long the facts", () => {
    const long = shareDrafts({
      ...vercel,
      headline: `Response field ${"very_long_name_".repeat(20)} removed`,
      detail: `can now return ${'"value", '.repeat(30)}`,
      locations: Array.from({ length: 76 }, (_, i) => `UserEvent.payload.newOwner.field${i}`),
    });
    expect(xLength(long.x)).toBeLessThanOrEqual(X_LIMIT);
    expect(long.x.endsWith(vercel.changeUrl)).toBe(true);
    expect(long.title.length).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(long.body).toContain("- and 71 more");
  });

  it("don't repeat a detail the headline already says", () => {
    // Real case: Mux, 'text_type can now return "chapters" (can now return "chapters")'.
    const mux = shareDrafts({
      ...vercel,
      providerName: "Mux",
      headline: 'text_type can now return "chapters"',
      detail: 'can now return "chapters"',
    });
    expect(mux.x).not.toContain("(can now return");
    expect(mux.body).not.toContain("(can now return");
  });

  it("count URLs the way X does", () => {
    expect(xLength(`a https://example.com/${"x".repeat(100)}`)).toBe(2 + 23);
  });
});
