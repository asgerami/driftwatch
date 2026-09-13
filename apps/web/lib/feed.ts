import type { AdditiveLine, ChangeView, ReleaseView } from "./types";

/**
 * Presentation rules for the feed.
 *
 * Kept out of the query layer so the same grouping can be checked without a
 * database, the same way the components are.
 */

/** Drowns a release when each occurrence is its own card. */
export const COLLAPSED_ADDITIVE_RULE = "response.property.added";

export function hasSignal(release: Pick<ReleaseView, "counts">): boolean {
  return (
    release.counts.BREAKING +
      release.counts.DEPRECATION +
      release.counts.BEHAVIORAL >
    0
  );
}

/**
 * Releases with a break, deprecation or behavioural shift lead.
 *
 * Relative date order inside each bucket is preserved, so this is a ranking,
 * not a reshuffle. Additive-only releases still appear; they just cannot
 * occupy the top of the home feed.
 */
export function leadWithSignal<T extends Pick<ReleaseView, "counts">>(
  releases: T[],
): T[] {
  const signal: T[] = [];
  const rest: T[] = [];
  for (const release of releases) {
    (hasSignal(release) ? signal : rest).push(release);
  }
  return [...signal, ...rest];
}

export function additiveLineHeadline(line: AdditiveLine): string {
  return `${line.count} new response field${line.count === 1 ? "" : "s"}`;
}

function fieldLabel(change: ChangeView): string {
  if (change.componentName && change.fieldPath) {
    return `${change.componentName}.${change.fieldPath}`;
  }
  if (change.fieldPath) return change.fieldPath;
  const op = [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
  return op || change.headline;
}

/**
 * Collapse `response.property.added` into one line when a release has several.
 *
 * `path.added` and `operation.added` stay as cards: those are the additive
 * facts worth a row of their own. A single new response field also stays a
 * card, now with a specific headline; the collapse is for the identical
 * eleven-card dump that was drowning the feed.
 */
export function splitCards(changes: ChangeView[]): {
  cards: ChangeView[];
  responseFieldAdds?: AdditiveLine;
} {
  const collapsed: ChangeView[] = [];
  const cards: ChangeView[] = [];
  for (const change of changes) {
    if (change.ruleId === COLLAPSED_ADDITIVE_RULE) collapsed.push(change);
    else cards.push(change);
  }

  if (collapsed.length < 2) {
    return { cards: [...cards, ...collapsed] };
  }

  const fields = collapsed.map(fieldLabel);
  return {
    cards,
    responseFieldAdds: { count: collapsed.length, fields },
  };
}
