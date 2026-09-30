import type { AdditiveLine, ChangeView, ReleaseView } from "./types";

/**
 * Presentation rules for the feed.
 *
 * Kept out of the query layer so the same grouping can be checked without a
 * database, the same way the components are.
 */

/** Drowns a release when each occurrence is its own card. */
export const COLLAPSED_RESPONSE_RULE = "response.property.added";
export const COLLAPSED_REQUEST_RULE = "request.property.added";
/**
 * Square's move to OpenAPI 3.0 marked 797 request fields nullable in one
 * release: additive, harmless, and 797 cards.
 */
export const COLLAPSED_NULLABLE_RULE = "request.property.became-nullable";

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

export function requestNullableHeadline(line: AdditiveLine): string {
  return `${line.count} request ${line.count === 1 ? "field now accepts" : "fields now accept"} null`;
}

export function requestPropertyHeadline(line: AdditiveLine): string {
  return `${line.count} new request ${line.count === 1 ? "property" : "properties"}`;
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
 * Collapse noisy additive property-adds into one line each.
 *
 * `path.added` and `operation.added` stay as cards: those are the additive
 * facts worth a row of their own. A single new field also stays a card.
 * The collapse is for the identical eleven-card dump that was drowning
 * the feed — first response fields, then request properties (Stripe's
 * `country_options.*.igic` dump is the same shape on the request side).
 */
export function splitCards(changes: ChangeView[]): {
  cards: ChangeView[];
  responseFieldAdds?: AdditiveLine;
  requestPropertyAdds?: AdditiveLine;
  requestNullableAdds?: AdditiveLine;
} {
  const response: ChangeView[] = [];
  const request: ChangeView[] = [];
  const nullable: ChangeView[] = [];
  const cards: ChangeView[] = [];
  for (const change of changes) {
    if (change.ruleId === COLLAPSED_RESPONSE_RULE) response.push(change);
    else if (change.ruleId === COLLAPSED_REQUEST_RULE) request.push(change);
    else if (change.ruleId === COLLAPSED_NULLABLE_RULE) nullable.push(change);
    else cards.push(change);
  }

  return {
    cards: [
      ...cards,
      ...(response.length < 2 ? response : []),
      ...(request.length < 2 ? request : []),
      ...(nullable.length < 2 ? nullable : []),
    ],
    responseFieldAdds:
      response.length >= 2 ? { count: response.length, fields: response.map(fieldLabel) } : undefined,
    requestPropertyAdds:
      request.length >= 2 ? { count: request.length, fields: request.map(fieldLabel) } : undefined,
    requestNullableAdds:
      nullable.length >= 2 ? { count: nullable.length, fields: nullable.map(fieldLabel) } : undefined,
  };
}
