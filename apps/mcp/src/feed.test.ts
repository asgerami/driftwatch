import { afterEach, describe, expect, it, vi } from "vitest";

import { feedUrl, fetchFeed, filterReleases, hasSignal } from "./feed.js";
import { formatBreakingSummary, formatReleases } from "./format.js";
import type { FeedDocument, FeedRelease } from "./feed.js";

const sample: FeedRelease = {
  id: "r1",
  providerSlug: "stripe",
  providerName: "Stripe",
  sourceKey: "api",
  sourceLabel: "Stripe API",
  shippedAt: "2026-08-26T00:00:00.000Z",
  commitSha: "abc",
  repo: "stripe/openapi",
  counts: {
    BREAKING: 1,
    DEPRECATION: 0,
    BEHAVIORAL: 0,
    ADDITIVE: 2,
    COSMETIC: 0,
  },
  changes: [
    {
      id: "c1",
      ruleId: "response.enum.value-added",
      severity: "BREAKING",
      directionFlip: true,
      headline: 'allowed_payment_method_types can now return "touch_n_go"',
      body: "breaks exhaustive switches",
      componentName: "payment_intent",
      fieldPath: "allowed_payment_method_types[]",
      siteCount: 1,
    },
    {
      id: "c2",
      ruleId: "path.added",
      severity: "ADDITIVE",
      directionFlip: false,
      headline: "Endpoint added",
      body: "No action needed.",
      path: "/v1/new_thing",
      siteCount: 1,
    },
  ],
};

const additiveOnly: FeedRelease = {
  ...sample,
  id: "r2",
  providerSlug: "github",
  providerName: "GitHub",
  sourceKey: "rest",
  counts: {
    BREAKING: 0,
    DEPRECATION: 0,
    BEHAVIORAL: 0,
    ADDITIVE: 11,
    COSMETIC: 0,
  },
  changes: [],
  responseFieldAdds: { count: 11, fields: ["a", "b"] },
};

describe("feedUrl", () => {
  it("adds provider, limit and signal query params", () => {
    expect(
      feedUrl({
        url: "https://example.test/api/feed.json",
        provider: "stripe",
        limit: 10,
        preferSignal: true,
      }),
    ).toBe("https://example.test/api/feed.json?provider=stripe&limit=10&signal=1");
  });
});

describe("fetchFeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a feed document", async () => {
    const doc: FeedDocument = {
      version: "1.0",
      generatedAt: "2026-09-13T00:00:00.000Z",
      note: "spec-derived",
      releases: [sample],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        expect(String(input)).toContain("signal=1");
        return new Response(JSON.stringify(doc), { status: 200 });
      }),
    );
    const got = await fetchFeed({ url: "https://example.test/api/feed.json", preferSignal: true });
    expect(got.releases).toHaveLength(1);
    expect(got.releases[0]!.providerSlug).toBe("stripe");
  });

  it("fails loudly on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    await expect(fetchFeed({ url: "https://example.test/api/feed.json" })).rejects.toThrow(/503/);
  });
});

describe("formatReleases", () => {
  it("drops additive cards when the floor is BEHAVIORAL", () => {
    const text = formatReleases([sample, additiveOnly], "BEHAVIORAL");
    expect(text).toContain("Stripe");
    expect(text).toContain("[flip]");
    expect(text).not.toContain("Endpoint added");
    expect(text).not.toContain("GitHub");
  });

  it("keeps additive-only releases when the floor is ADDITIVE", () => {
    const text = formatReleases([additiveOnly], "ADDITIVE");
    expect(text).toContain("11 new response fields");
    expect(text).toContain("additive only");
  });

  it("summarises collapsed request properties", () => {
    const text = formatReleases(
      [
        {
          ...additiveOnly,
          responseFieldAdds: undefined,
          requestPropertyAdds: { count: 9, fields: ["a"] },
        },
      ],
      "ADDITIVE",
    );
    expect(text).toContain("9 new request properties");
  });
});

describe("stories", () => {
  it("lists every place a grouped story occurs, not just the first", () => {
    // Real case: Stripe removed igic under 27 countries' tax options at once.
    const countries = ["at", "be", "bg", "cy", "cz", "de", "dk", "ee", "es", "fi", "fr", "gr"];
    const story: FeedRelease = {
      ...sample,
      changes: [
        {
          ...sample.changes[0]!,
          ruleId: "request.property.removed",
          headline: "igic is no longer accepted",
          method: "post",
          path: "/v1/tax/registrations",
          fieldPath: "country_options.at.igic",
          componentName: undefined,
          detail: undefined,
          locations: countries.map((cc) => `POST /v1/tax/registrations · country_options.${cc}.igic`),
        },
      ],
    };
    const text = formatReleases([story], "BEHAVIORAL");
    expect(text).toContain("12 places:");
    expect(text).toContain("country_options.fi.igic");
    expect(text).toContain("+2 more");
  });

  it("keeps the single-fact location line when there is no story", () => {
    expect(formatReleases([sample], "BEHAVIORAL")).not.toContain("places:");
  });
});

describe("formatBreakingSummary", () => {
  it("says so when nothing broke", () => {
    expect(formatBreakingSummary([additiveOnly])).toMatch(/Nothing breaking/);
  });

  it("lists the flips when something did", () => {
    expect(formatBreakingSummary([sample])).toContain("touch_n_go");
  });
});

describe("filter helpers", () => {
  it("treats a break as signal and additive-only as not", () => {
    expect(hasSignal(sample)).toBe(true);
    expect(hasSignal(additiveOnly)).toBe(false);
    expect(filterReleases([sample, additiveOnly], "BREAKING")).toHaveLength(1);
  });
});
