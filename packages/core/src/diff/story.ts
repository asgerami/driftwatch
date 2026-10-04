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
  componentName?: string | null;
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

/** Rules where a parent losing many fields at once reads as one event. */
const BY_PARENT = new Set([
  "response.property.removed",
  "request.property.removed",
  "response.property.became-optional",
]);

/**
 * Distinct fields under one parent before they collapse into a parent story.
 * Below it, the per-field-name grouping above applies (igic under 26
 * countries is one field name under many parents, the opposite shape).
 */
export const PARENT_STORY_MIN_FIELDS = 5;

/** `payload.newOwner.abuse` → `payload.newOwner`; a top-level field has no parent path. */
export function parentOf(fieldPath: string): string {
  const cut = fieldPath.lastIndexOf(".");
  return cut === -1 ? "" : fieldPath.slice(0, cut);
}

function parentKey(item: StoryInput): string | null {
  if (!item.fieldPath || !BY_PARENT.has(item.ruleId)) return null;
  return `${item.ruleId}|${item.severity}|parent|${item.componentName ?? ""}|${parentOf(item.fieldPath)}`;
}

/**
 * Group items by story, keeping first-seen order of both stories and members.
 *
 * One pass first counts, per parent object, how many distinct fields a
 * removal-type rule touched. Vercel cut a user-event payload's `newOwner` from
 * 78 fields to 2 in one release: 76 true facts, which as 76 cards buried the
 * one thing that happened. At PARENT_STORY_MIN_FIELDS or more, they are one
 * story about the parent.
 */
export function groupStories<T extends StoryInput>(items: T[]): T[][] {
  const fieldsPerParent = new Map<string, Set<string>>();
  for (const item of items) {
    const key = parentKey(item);
    if (!key) continue;
    const fields = fieldsPerParent.get(key) ?? new Set<string>();
    fields.add(item.fieldPath!);
    fieldsPerParent.set(key, fields);
  }

  const groups = new Map<string, T[]>();
  for (const item of items) {
    const parent = parentKey(item);
    const key =
      parent && (fieldsPerParent.get(parent)?.size ?? 0) >= PARENT_STORY_MIN_FIELDS
        ? parent
        : storyKeyOf(item);
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
