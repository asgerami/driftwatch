/**
 * Which waiting share draft is worth a person's one post today.
 *
 * Pure ranking over drafts the worker has already checked are still
 * published. It only chooses; a person still presses Post (CLAUDE.md note 22).
 * The weights are a judgement about reach, written down so they can be argued
 * with: an API more developers call reaches more readers, a direction flip is
 * the product's whole claim, and a break in what callers send fails loudly.
 */

export interface PickCandidate {
  storyId: string;
  providerSlug: string;
  /** When the provider shipped it (ISO). */
  shippedAt: string;
  ruleId: string;
  directionFlip: boolean;
}

export interface Pick<T extends PickCandidate> {
  draft: T;
  score: number;
  /** Why it scored as it did, for the person deciding. */
  reasons: string[];
}

/** Rough size of each provider's developer audience, 1 to 10. */
const REACH: Record<string, number> = {
  stripe: 10,
  openai: 10,
  github: 9,
  vercel: 7,
  cloudflare: 7,
  twilio: 6,
  plaid: 5,
  clerk: 5,
  resend: 5,
  discord: 5,
  square: 4,
  zoom: 4,
  datadog: 4,
  sendgrid: 3,
  pagerduty: 3,
  mux: 3,
  asana: 3,
  jira: 3,
  box: 2,
  adyen: 2,
  hetzner: 2,
};
const DEFAULT_REACH = 2;

/** Breaks in what a caller sends fail on the next request, which readers feel. */
const LOUD_RULES = new Set([
  "request.property.removed",
  "request.property.became-required",
  "request.property.type-changed",
  "request.param.became-required",
  "request.param.required-added",
  "request.enum.value-removed",
  "path.removed",
  "operation.removed",
]);

const DAY = 24 * 60 * 60 * 1000;
/** Older than this is history, not news. Matches the drafting window. */
export const PICK_WINDOW_DAYS = 14;
/** A provider posted this recently is skipped, so the feed is not one API's. */
export const PROVIDER_REST_DAYS = 2;

export function rankDrafts<T extends PickCandidate>(
  drafts: T[],
  options: { now: Date; recentlyPosted?: { providerSlug: string; postedAt: Date }[] },
): Pick<T>[] {
  const now = options.now.getTime();
  const resting = new Set(
    (options.recentlyPosted ?? [])
      .filter((p) => now - p.postedAt.getTime() < PROVIDER_REST_DAYS * DAY)
      .map((p) => p.providerSlug),
  );

  return drafts
    .map((draft): Pick<T> | undefined => {
      const age = (now - new Date(draft.shippedAt).getTime()) / DAY;
      if (age > PICK_WINDOW_DAYS || resting.has(draft.providerSlug)) return undefined;
      const reach = REACH[draft.providerSlug] ?? DEFAULT_REACH;
      const reasons = [`reach ${reach}`];
      let score = reach;
      if (draft.directionFlip) {
        score += 3;
        reasons.push("direction flip: other tools call it safe");
      }
      if (LOUD_RULES.has(draft.ruleId)) {
        score += 2;
        reasons.push("breaks what callers send");
      }
      const days = Math.max(0, Math.floor(age));
      score -= days * 0.5;
      reasons.push(days === 0 ? "shipped in the last 24 hours" : `shipped ${days} day${days === 1 ? "" : "s"} ago`);
      return { draft, score, reasons };
    })
    .filter((p): p is Pick<T> => p !== undefined)
    .sort((a, b) => b.score - a.score || b.draft.shippedAt.localeCompare(a.draft.shippedAt) || a.draft.storyId.localeCompare(b.draft.storyId));
}
