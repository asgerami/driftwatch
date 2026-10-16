import { describe, expect, it } from "vitest";

import { PICK_WINDOW_DAYS, rankDrafts, type PickCandidate } from "./pick.js";

const now = new Date("2026-10-16T12:00:00.000Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const draft = (over: Partial<PickCandidate>): PickCandidate => ({
  storyId: "x",
  providerSlug: "mux",
  shippedAt: daysAgo(1),
  ruleId: "response.property.removed",
  directionFlip: false,
  ...over,
});

describe("rankDrafts", () => {
  it("puts a flip in a widely used API ahead of a niche removal", () => {
    // Real pair from the waiting drafts: Stripe's dropped payment_method_types
    // against Mux's removed total_views.
    const ranked = rankDrafts(
      [
        draft({ storyId: "mux-2026-09-30-6b715699" }),
        draft({ storyId: "stripe-2026-09-23-a76f3bb4", providerSlug: "stripe", ruleId: "request.property.removed", directionFlip: true, shippedAt: daysAgo(3) }),
      ],
      { now },
    );
    expect(ranked.map((p) => p.draft.storyId)).toEqual(["stripe-2026-09-23-a76f3bb4", "mux-2026-09-30-6b715699"]);
    expect(ranked[0]!.reasons).toContain("direction flip: other tools call it safe");
  });

  it("prefers news: the same story loses ground each day it waits", () => {
    const [fresh, stale] = rankDrafts(
      [draft({ storyId: "old", shippedAt: daysAgo(6) }), draft({ storyId: "new", shippedAt: daysAgo(0) })],
      { now },
    );
    expect(fresh!.draft.storyId).toBe("new");
    expect(fresh!.score - stale!.score).toBe(3);
  });

  it("leaves out stories older than the drafting window", () => {
    expect(rankDrafts([draft({ shippedAt: daysAgo(PICK_WINDOW_DAYS + 1) })], { now })).toEqual([]);
  });

  it("rests a provider posted in the last two days", () => {
    const ranked = rankDrafts(
      [draft({ storyId: "openai", providerSlug: "openai" }), draft({ storyId: "vercel", providerSlug: "vercel" })],
      { now, recentlyPosted: [{ providerSlug: "openai", postedAt: new Date(now.getTime() - 60 * 60 * 1000) }] },
    );
    expect(ranked.map((p) => p.draft.storyId)).toEqual(["vercel"]);
  });

  it("ranks the same input the same way every time", () => {
    const input = [draft({ storyId: "b" }), draft({ storyId: "a" })];
    expect(rankDrafts(input, { now }).map((p) => p.draft.storyId)).toEqual(["a", "b"]);
    expect(rankDrafts([...input].reverse(), { now }).map((p) => p.draft.storyId)).toEqual(["a", "b"]);
  });
});
