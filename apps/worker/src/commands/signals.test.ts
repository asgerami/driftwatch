import { describe, expect, it } from "vitest";

import { parsePrUrl } from "./pr.js";
import { formatSignals, type Signals } from "./signals.js";

const base: Signals = {
  days: 7,
  views: { available: true, total: 120, changePages: 70, apiPages: 30, top: [{ path: "/changes/stripe-x", count: 40 }] },
  feeds: { total: 9, byPath: [{ path: "/rss.xml", count: 6 }, { path: "/apis/stripe/rss.xml", count: 3 }] },
  waitlist: { total: 3, recent: 2, byApi: [{ api: "stripe", count: 3 }] },
  fixPrs: { opened: 2, merged: 1, closed: 0, open: 1, refreshFailures: 0 },
  health: { unhealthy: [], pendingReview: 4 },
};

describe("formatSignals", () => {
  it("prints every signal the brief asks for", () => {
    const out = formatSignals(base);
    expect(out).toContain("120 total · 70 on change pages · 30 on API pages");
    expect(out).toContain("Feed fetches (lower bound");
    expect(out).toContain("3 signups, 2 in the last 7 days");
    expect(out).toContain("2 opened · 1 merged · 0 closed unmerged · 1 still open");
    expect(out).toContain("every source fetching");
  });

  it("says why views are missing instead of printing zero", () => {
    const out = formatSignals({ ...base, views: { available: false, reason: "set CF_API_TOKEN" } });
    expect(out).toContain("unavailable: set CF_API_TOKEN");
    expect(out).not.toContain("0 total ·");
  });

  it("makes a failing source loud", () => {
    const out = formatSignals({
      ...base,
      health: { pendingReview: 0, unhealthy: [{ name: "hetzner/cloud", reason: "failed 3 times in a row: 403" }] },
    });
    expect(out).toContain("NOT FETCHING hetzner/cloud: failed 3 times in a row: 403");
  });
});

describe("parsePrUrl", () => {
  it("reads owner, repo and number", () => {
    expect(parsePrUrl("https://github.com/acme/billing/pull/42")).toEqual({ fullName: "acme/billing", number: 42 });
  });
  it("rejects anything that is not a PR URL", () => {
    expect(parsePrUrl("https://github.com/acme/billing/issues/42")).toBeNull();
    expect(parsePrUrl("https://gitlab.com/acme/billing/pull/42")).toBeNull();
  });
});
