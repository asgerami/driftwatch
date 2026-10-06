/**
 * Context a reader needs to judge a provider's breaking changes.
 *
 * Shown once per release that contains a break, and carried into share
 * drafts: a Stripe developer who reads "no longer accepted" without it
 * rightly replies that their pinned version is untouched. Kept to facts about
 * how the provider versions its API, never commentary on a particular change.
 */
export interface ProviderNote {
  /** The full note, for the site and long posts. */
  note: string;
  /** One line that fits beside a post on X. */
  short: string;
}

const NOTES: Record<string, ProviderNote> = {
  stripe: {
    note:
      "Stripe's published spec describes its newest API version. Accounts are " +
      "pinned to the version they signed up on, so a change like this reaches " +
      "your integration when you upgrade that version, not the day Stripe ships it.",
    short: "Stripe pins each account to an API version: this reaches you when you upgrade.",
  },
};

export function providerNote(slug: string): ProviderNote | undefined {
  return NOTES[slug];
}
