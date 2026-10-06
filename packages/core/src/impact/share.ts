/**
 * Draft posts for a published breaking change: one for X, one for Hacker
 * News or Reddit. A person posts them, edited or not; nothing here posts.
 *
 * Templates, not a model, for the reason the impact prose is templated: a
 * template cannot state a fact the diff did not find. Each draft leads with
 * the fact and links the permanent change page.
 */

import type { ProviderNote } from "./providers.js";

export interface ShareInput {
  providerName: string;
  /** e.g. "Response field abuse removed". */
  headline: string;
  /** The rule's consequence: what it does to calling code. */
  consequence: string;
  ruleId: string;
  directionFlip: boolean;
  /** Detail line of the story, e.g. 'can now return "touch_n_go"'. */
  detail?: string;
  /** Every place it happened, already formatted. */
  locations: string[];
  /** When the provider shipped it (ISO). */
  shippedAt: string;
  /** Absolute URL of /changes/<id>. */
  changeUrl: string;
  /** Spec diff or hosted spec, when there is one. */
  sourceUrl?: string;
  /** How the provider versions its API, when a reader needs it to judge the break. */
  providerNote?: ProviderNote;
}

export interface ShareDrafts {
  /** Fits X's 280-character limit, counting the link as X does (23). */
  x: string;
  /** Fits Hacker News's 80-character title limit. */
  title: string;
  /** Markdown-light body for HN or Reddit, ending with a disclosure. */
  body: string;
}

export const X_LIMIT = 280;
/** X shortens every URL to a 23-character t.co link. */
export const X_URL_WEIGHT = 23;
export const TITLE_LIMIT = 80;

/** Length as X counts it: each http(s) URL weighs 23 characters. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(X_URL_WEIGHT)).length;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

const FLIP_LINE =
  "Producer-side diff tools call this non-breaking. From the calling end, it is.";

export function shareDrafts(input: ShareInput): ShareDrafts {
  const day = input.shippedAt.slice(0, 10);
  // Enum headlines already carry their detail ('type can now return "x"').
  const detail = input.detail && !input.headline.includes(input.detail) ? input.detail : undefined;
  const where =
    input.locations.length > 1
      ? `${input.locations.length} places, including ${input.locations[0]}`
      : input.locations[0];

  // X: fact, place, why it matters, link. Trim the middle, never the link.
  const fact = `${input.providerName} API, ${day}: ${input.headline}${detail ? ` (${detail})` : ""}.`;
  const why = input.directionFlip ? FLIP_LINE : firstSentence(input.consequence);
  const note = input.providerNote ? `\n\n${input.providerNote.short}` : "";
  const tail = `\n\n${input.changeUrl}`;
  const budget = X_LIMIT - xLength(tail);
  // Shed the place, then the why, before the provider's note: without the
  // note a Stripe reader rightly answers that their pinned version is fine.
  let lead = `${fact}${where ? `\n${where}.` : ""}\n\n${why}${note}`;
  if (lead.length > budget) lead = `${fact}\n\n${why}${note}`;
  if (lead.length > budget) lead = `${fact}${note}`;
  if (lead.length > budget) lead = clip(fact, budget);
  const x = `${lead}${tail}`;

  const title = clip(`${input.providerName}: ${input.headline} (${day})`, TITLE_LIMIT);

  const shown = input.locations.slice(0, 5);
  const more = input.locations.length - shown.length;
  const body = [
    `${input.providerName}'s published OpenAPI spec changed on ${day}: ${input.headline}${detail ? ` (${detail})` : ""}.`,
    "",
    "Where:",
    ...shown.map((location) => `- ${location}`),
    ...(more > 0 ? [`- and ${more} more`] : []),
    "",
    `Why it matters: ${input.consequence}`,
    // Flip rules' consequences mostly say it themselves; say it once.
    ...(input.directionFlip && !/producer-side/i.test(input.consequence) ? ["", FLIP_LINE] : []),
    ...(input.providerNote ? ["", `Note: ${input.providerNote.note}`] : []),
    "",
    ...(input.sourceUrl ? [`Spec diff: ${input.sourceUrl}`] : []),
    `Details: ${input.changeUrl}`,
    "",
    `Disclosure: I run Driftwatch, which reads the published OpenAPI specs of the APIs teams depend on, from the calling side, and flags changes that break calling code. Classified by a fixed rule (${input.ruleId}), no model involved; how it decides: https://driftwatch.et/method`,
  ].join("\n");

  return { x, title, body };
}
