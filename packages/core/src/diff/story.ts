/**
 * Which facts are the same story for a reader.
 *
 * A fingerprint identifies one fact: one rule, at one place, with one before
 * and after. Readers need something coarser. Real Stripe history, one year of
 * it, produced 214 distinct breaking facts where a person would count about
 * half that many things that happened:
 *
 *   - a new payment method ("payto") added to the same enum in 7 components
 *   - `igic` removed from 26 countries' tax options in one correction
 *   - one field that stopped being required AND became nullable, which is
 *     `response.property.became-optional` firing twice for one field
 *
 * Every one of those facts is true, and each is still stored and fingerprinted
 * on its own; the GitHub App needs every call site. This key only decides what
 * a reviewer approves as one decision and what the feed shows as one card.
 *
 * Severity is part of every key, so grouping can never hide a break inside a
 * milder card, and severity itself is never touched here.
 */

export interface StoryInput {
  ruleId: string;
  severity: string;
  fingerprint: string;
  fieldPath?: string | null;
  detail?: string | null;
}

/** The detail IS the story: which values appeared or were withdrawn. */
const BY_VALUES = new Set(["response.enum.value-added", "request.enum.value-removed"]);

/** Same rule on the same field name, wherever it sits. */
const BY_FIELD = new Set([
  "response.property.removed",
  "request.property.removed",
  "response.property.became-optional",
  "request.property.became-required",
]);

/** Same field name AND the same retype; a different retype is different news. */
const BY_FIELD_AND_DETAIL = new Set([
  "response.property.type-changed",
  "request.property.type-changed",
]);

/**
 * The last segment of a field path, without array or map markers.
 * `country_options.at.igic` → `igic`, `line_items[].dynamic_tax_rates` →
 * `dynamic_tax_rates`, `metadata[key]` → `metadata`.
 */
export function leafOf(fieldPath: string): string {
  const last = fieldPath.split(".").pop() ?? fieldPath;
  return last.replace(/\[[^\]]*\]$/g, "");
}

export function storyKeyOf(change: StoryInput): string {
  const { ruleId, severity, fieldPath, detail } = change;

  if (BY_VALUES.has(ruleId) && detail) {
    return `${ruleId}|${severity}|values|${detail}`;
  }
  if (fieldPath && BY_FIELD.has(ruleId)) {
    return `${ruleId}|${severity}|field|${leafOf(fieldPath)}`;
  }
  if (fieldPath && BY_FIELD_AND_DETAIL.has(ruleId)) {
    return `${ruleId}|${severity}|field|${leafOf(fieldPath)}|${detail ?? ""}`;
  }
  return `${ruleId}|${severity}|fact|${change.fingerprint}`;
}

/**
 * Group items by story, keeping first-seen order of both stories and members.
 */
export function groupStories<T extends StoryInput>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = storyKeyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/**
 * One detail line for a story. A field that both stopped being required and
 * became nullable reads "no longer guaranteed present; can now be null".
 */
export function storyDetail(items: StoryInput[]): string | undefined {
  const details = [...new Set(items.map((item) => item.detail).filter(Boolean))];
  return details.length > 0 ? details.join("; ") : undefined;
}
