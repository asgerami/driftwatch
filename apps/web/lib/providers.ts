/**
 * Context a reader needs to judge a provider's breaking changes.
 *
 * Shown once per release that contains a break. Kept to facts about how the
 * provider versions its API, never commentary on a particular change.
 */
const NOTES: Record<string, string> = {
  stripe:
    "Stripe's published spec describes its newest API version. Accounts are " +
    "pinned to the version they signed up on, so a change like this reaches " +
    "your integration when you upgrade that version, not the day Stripe ships it.",
};

export function providerNote(slug: string): string | undefined {
  return NOTES[slug];
}
