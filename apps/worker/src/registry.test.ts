import { describe, expect, it } from "vitest";

import { findProvider, historyOptions, sourceTier } from "./registry.js";

describe("sourceTier", () => {
  it("treats an explicit B as B", () => {
    expect(
      sourceTier({
        key: "cloud",
        label: "Cloud",
        tier: "B",
        url: "https://example.test/spec.json",
      }),
    ).toBe("B");
  });

  it("infers B from a url with no repo", () => {
    expect(
      sourceTier({
        key: "api",
        label: "API",
        url: "https://example.test/spec.json",
      }),
    ).toBe("B");
  });

  it("keeps a git source as A even if a url is also set", () => {
    expect(
      sourceTier({
        key: "api",
        label: "API",
        repo: "acme/openapi",
        url: "https://example.test/spec.json",
      }),
    ).toBe("A");
  });

  it("registers Hetzner Cloud as the first hosted source", () => {
    const hetzner = findProvider("hetzner");
    expect(hetzner).toBeDefined();
    expect(hetzner!.sources).toHaveLength(1);
    expect(sourceTier(hetzner!.sources[0]!)).toBe("B");
    expect(hetzner!.sources[0]!.url).toBe("https://docs.hetzner.cloud/cloud.spec.json");
  });
});

describe("history options", () => {
  it("keeps version-per-file providers on the current file", () => {
    // Adyen and Clerk keep one file per API version; Asana's history was
    // linked back to README.md by git's rename detection.
    for (const [slug, key] of [
      ["adyen", "checkout"],
      ["clerk", "backend"],
      ["asana", "api"],
    ] as const) {
      expect(historyOptions(slug, key)).toEqual({ followRenames: false });
    }
  });

  it("follows renames everywhere else, which Twilio's four moves need", () => {
    expect(historyOptions("twilio", "api_v2010")).toEqual({});
    expect(historyOptions("nope", "nope")).toEqual({});
  });
});

