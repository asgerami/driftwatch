import { renderToStaticMarkup } from "react-dom/server";
import { Release, EmptyFeed, ChangeItem } from "../components/Change";
import { StoryPage, whoIsAffected } from "../components/StoryPage";
import type { ChangeView, ReleaseView } from "../lib/types";
import { additiveLineHeadline, leadWithSignal, requestPropertyHeadline, splitCards } from "../lib/feed";

/**
 * Renders the presentation layer against fixtures and asserts on the markup.
 *
 * The pages read from Postgres, but the components take plain view models, so
 * the whole visual layer can be exercised with no database, no Prisma client
 * and no network. That separation is the only reason the site could be
 * verified before the first backfill exists.
 */

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const flipChange: ChangeView = {
  id: "c1",
  ruleId: "response.enum.value-added",
  severity: "BREAKING",
  directionFlip: true,
  headline: 'payment_method_types can now return "billie"',
  body: "Producer-side tools call this additive. It breaks exhaustive switches, strict parsers and generated client enums.\n\nAffects `invoices_payment_settings`.",
  patterns: {
    ts: 'switch (response.payment_method_types[0]) {\n  // no branch for "billie"\n}',
  },
  componentName: "invoices_payment_settings",
  affectedOperations: 457,
  fieldPath: "payment_method_types[]",
  detail: 'can now return "billie"',
  siteCount: 1,
  sampleSites: [],
};

const operationChange: ChangeView = {
  id: "c2",
  ruleId: "request.param.removed",
  severity: "BREAKING",
  directionFlip: true,
  headline: "expand is no longer accepted",
  body: "No error is raised. The value is ignored and your results change silently.",
  patterns: {},
  method: "post",
  path: "/v1/charges",
  fieldPath: "expand",
  siteCount: 9,
  sampleSites: ["POST /v1/charges", "GET /v1/charges/{id}"],
};

const additiveChange: ChangeView = {
  id: "c3",
  ruleId: "path.added",
  severity: "ADDITIVE",
  directionFlip: false,
  headline: "Endpoint added",
  body: "No action needed.",
  patterns: {},
  path: "/v1/new_thing",
  siteCount: 1,
  sampleSites: [],
};

const release: ReleaseView = {
  id: "r1",
  providerSlug: "stripe",
  providerName: "Stripe",
  sourceKey: "api",
  sourceLabel: "Stripe API",
  shippedAt: "2026-08-26T00:00:00.000Z",
  commitSha: "30d3391cabcdef",
  repo: "stripe/openapi",
  counts: { BREAKING: 2, DEPRECATION: 0, BEHAVIORAL: 0, ADDITIVE: 1, COSMETIC: 0 },
  changes: [flipChange, operationChange, additiveChange],
};

console.log("\nrender-check\n");

/**
 * React escapes quotes and ampersands in text, so comparing raw strings
 * against markup gives false failures for any headline containing an enum
 * value. Compare against decoded text instead.
 */
function decode(markup: string): string {
  return markup
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const releaseHtml = decode(renderToStaticMarkup(<Release release={release} />));

check("release renders the provider and date", releaseHtml.includes("Stripe") && releaseHtml.includes("2026-08-26"));
check("commit sha is abbreviated, not dumped whole", releaseHtml.includes("30d3391c") && !releaseHtml.includes("30d3391cabcdef"));
check("every change appears", release.changes.every((c) => releaseHtml.includes(c.headline)));
check("severity reaches the DOM for CSS to key on", releaseHtml.includes('data-severity="BREAKING"') && releaseHtml.includes('data-severity="ADDITIVE"'));
check("direction flips are badged", releaseHtml.includes("direction flip"));
check("a non-flip change is NOT badged", !decode(renderToStaticMarkup(<ChangeItem change={additiveChange} />)).includes("direction flip"));
check("component changes show their blast radius", releaseHtml.includes("reachable from 457 operations"));
check("operation changes show the call-site count", releaseHtml.includes("9 call sites"));
check("code patterns render when present", releaseHtml.includes("no branch for"));
check("only the first paragraph of the body is shown in the feed", releaseHtml.includes("Producer-side tools call this additive") && !releaseHtml.includes("Affects `invoices_payment_settings`"));
check("tally is rendered", releaseHtml.includes("2 breaking") && releaseHtml.includes("1 additive"));

const singular = decode(
  renderToStaticMarkup(<ChangeItem change={{ ...flipChange, affectedOperations: 1 }} />),
);
check("one operation is singular, not '1 operations'", singular.includes("reachable from 1 operation") && !singular.includes("1 operations"));

const DEV_COMMANDS = ["pnpm", "publishedAt", "backfill", "seed"];
const leaksDevCommands = (html: string) => DEV_COMMANDS.some((word) => html.includes(word));

const emptyHtml = decode(renderToStaticMarkup(<EmptyFeed />));
check("empty state is written for visitors, not operators", !leaksDevCommands(emptyHtml), emptyHtml);
check("empty state explains that a person reviews changes", emptyHtml.includes("checked by a person"));
check("empty state links to the method", emptyHtml.includes('href="/method"'));

const emptyProvider = decode(renderToStaticMarkup(<EmptyFeed providerName="Twilio" />));
check("empty state is scoped when given a provider", emptyProvider.includes("for Twilio"));

const emptyOne = decode(renderToStaticMarkup(<EmptyFeed providerName="Hetzner" snapshotCount={1} />));
check("one stored version explains tracking just started", emptyOne.includes("for Hetzner") && emptyOne.includes("next time the spec is updated"));
check("one stored version leaks no commands", !leaksDevCommands(emptyOne), emptyOne);

const emptyMany = decode(renderToStaticMarkup(<EmptyFeed providerName="Stripe" snapshotCount={7} />));
check("stored versions awaiting review leak no commands", !leaksDevCommands(emptyMany), emptyMany);

// Square's OpenAPI 3.0 migration: 797 request fields newly nullable in one release.
const nullableChanges: ChangeView[] = Array.from({ length: 5 }, (_, i) => ({
  ...additiveChange,
  id: `nullable-${i}`,
  ruleId: "request.property.became-nullable",
  headline: `Request field f${i} now accepts null`,
  fieldPath: `f${i}`,
}));
const splitNullable = splitCards(nullableChanges);
check("request fields newly accepting null collapse to one line", splitNullable.requestNullableAdds?.count === 5 && splitNullable.cards.length === 0);
const nullableHtml = decode(renderToStaticMarkup(<Release release={{ ...release, changes: [], requestNullableAdds: splitNullable.requestNullableAdds }} />));
check("the nullable line renders with its anchor", nullableHtml.includes("5 request fields now accept null") && nullableHtml.includes(`id="${release.id}-request-nullable"`), nullableHtml);

// /changes/<id>: everything the brief asks a change page for.
const storyView = {
  change: { ...flipChange, href: "/changes/stripe-2026-08-26-3f9a1c2e" },
  providerSlug: "stripe",
  providerName: "Stripe",
  sourceLabel: "Stripe API",
  shippedAt: "2026-08-26T17:04:00.000Z",
  detectedAt: "2026-08-26T18:17:00.000Z",
  publishedAt: "2026-08-27T09:00:00.000Z",
  sourceLink: {
    href: "https://github.com/stripe/openapi/compare/aaa...bbb",
    label: "stripe/openapi @ aaa…bbb",
  },
  facts: [
    { location: "payment_intent.allowed_payment_method_types[]", before: '"card", "ideal"', after: '"card", "ideal", "touch_n_go"' },
  ],
};
const storyHtml = decode(renderToStaticMarkup(<StoryPage story={storyView} />));
check("change page has the plain-English summary", storyHtml.includes(flipChange.headline) && storyHtml.includes("What changed"));
check("change page says who is affected", storyHtml.includes("Who is affected") && storyHtml.includes(whoIsAffected(storyView)));
check("change page shows before and after", storyHtml.includes('"card", "ideal", "touch_n_go"') && storyHtml.includes("Before and after"));
check("change page shows severity", storyHtml.includes('data-severity="BREAKING"'));
check("change page links the source diff", storyHtml.includes("https://github.com/stripe/openapi/compare/aaa...bbb"));
check("change page shows detected-at", storyHtml.includes("2026-08-26 18:17 UTC"));
check("change page links back to its API", storyHtml.includes('href="/apis/stripe"'));
check("who-is-affected names the reader for a response change", whoIsAffected(storyView).startsWith("Code that reads"));
const linkedCard = decode(renderToStaticMarkup(<ChangeItem change={{ ...flipChange, href: "/changes/x-1" }} />));
check("a card links its headline to the change page", linkedCard.includes('href="/changes/x-1"'));

// RSS items link to #<change id>, #<release>-fields and #<release>-request-fields.
check("each card carries its id as an anchor", release.changes.every((c) => releaseHtml.includes(`id="${c.id}"`)));
check("the release carries its id as an anchor", releaseHtml.includes(`id="${release.id}"`));

// A story groups several facts: one card, every place listed.
const story = decode(
  renderToStaticMarkup(
    <ChangeItem
      change={{
        ...flipChange,
        componentName: "payment_method",
        fieldPath: "type",
        detail: 'can now return "payto"',
        locations: ["payment_method.type", "mandate.type", "confirmation_token.type", "a.type", "b.type", "c.type", "d.type"],
      }}
    />,
  ),
);
check("a story lists how many places it occurs", story.includes("7 places:"), story);
check("a story lists the places and truncates the rest", story.includes("mandate.type") && story.includes("+1 more"), story);
check("a story shows its detail once", story.includes('can now return "payto"'));

const withNote = decode(
  renderToStaticMarkup(<Release release={{ ...release, providerNote: "Pinned API versions apply." }} />),
);
check("a provider note renders on its release", withNote.includes("Pinned API versions apply."));
check("no note renders when none is given", !releaseHtml.includes("provider-note"));

// A change with no optional fields at all must not render "undefined".
const bare: ChangeView = {
  id: "c4",
  ruleId: "schema.composition-changed",
  severity: "BEHAVIORAL",
  directionFlip: false,
  headline: "Schema composition changed",
  body: "Worth a look.",
  patterns: {},
  siteCount: 1,
  sampleSites: [],
};
const bareHtml = decode(renderToStaticMarkup(<ChangeItem change={bare} />));
check("a change with no location does not leak 'undefined'", !bareHtml.includes("undefined"), bareHtml);

const fieldAdds = Array.from({ length: 11 }, (_, i) => ({
  id: `f${i}`,
  ruleId: "response.property.added" as const,
  severity: "ADDITIVE" as const,
  directionFlip: false,
  headline: "New response field",
  body: "No action needed.",
  patterns: {},
  fieldPath: `field_${i}`,
  siteCount: 1,
  sampleSites: [],
}));

const split = splitCards([...release.changes, ...fieldAdds]);
check("path.added stays a card", split.cards.some((c) => c.ruleId === "path.added"));
check("eleven response field adds collapse to one line", split.responseFieldAdds?.count === 11 && !split.cards.some((c) => c.ruleId === "response.property.added"));
check("a single response field add stays a card", splitCards([fieldAdds[0]!]).cards.length === 1 && splitCards([fieldAdds[0]!]).responseFieldAdds === undefined);

const requestAdds = Array.from({ length: 9 }, (_, i) => ({
  id: `q${i}`,
  ruleId: "request.property.added" as const,
  severity: "ADDITIVE" as const,
  directionFlip: false,
  headline: `Request property field_${i} added`,
  body: "No action needed unless it is required.",
  patterns: {},
  fieldPath: `field_${i}`,
  siteCount: 1,
  sampleSites: [],
}));
const splitRequest = splitCards([...release.changes, ...requestAdds]);
check("path.added stays a card next to collapsed request properties", splitRequest.cards.some((c) => c.ruleId === "path.added"));
check("nine request property adds collapse to one line", splitRequest.requestPropertyAdds?.count === 9 && !splitRequest.cards.some((c) => c.ruleId === "request.property.added"));
check("a single request property add stays a card", splitCards([requestAdds[0]!]).cards.length === 1 && splitCards([requestAdds[0]!]).requestPropertyAdds === undefined);

const both = splitCards([...fieldAdds, ...requestAdds]);
check("response and request property adds collapse independently", both.responseFieldAdds?.count === 11 && both.requestPropertyAdds?.count === 9 && both.cards.length === 0);

const collapsedRelease: ReleaseView = {
  ...release,
  counts: { BREAKING: 2, DEPRECATION: 0, BEHAVIORAL: 0, ADDITIVE: 12, COSMETIC: 0 },
  changes: [flipChange, operationChange, additiveChange],
  responseFieldAdds: split.responseFieldAdds,
};
const collapsedHtml = decode(renderToStaticMarkup(<Release release={collapsedRelease} />));
check("the collapsed fields line carries the anchor RSS links to", collapsedHtml.includes(`id="${release.id}-fields"`));
check("collapsed additive is one line, not eleven cards", collapsedHtml.includes("11 new response fields") && (collapsedHtml.match(/New response field/g) ?? []).length === 0);
check("collapsed line lists a sample of fields", collapsedHtml.includes("field_0") && collapsedHtml.includes("+3 more"));
check("path.added and breaking cards still render next to the line", collapsedHtml.includes("Endpoint added") && collapsedHtml.includes("direction flip"));
check("additiveLineHeadline is plural-aware", additiveLineHeadline({ count: 1, fields: ["a"] }) === "1 new response field" && additiveLineHeadline({ count: 11, fields: [] }) === "11 new response fields");
check(
  "requestPropertyHeadline is plural-aware",
  requestPropertyHeadline({ count: 1, fields: ["a"] }) === "1 new request property" &&
    requestPropertyHeadline({ count: 9, fields: [] }) === "9 new request properties",
);

const requestCollapsedHtml = decode(
  renderToStaticMarkup(
    <Release
      release={{
        ...release,
        changes: [flipChange],
        requestPropertyAdds: { count: 9, fields: requestAdds.map((c) => c.fieldPath!) },
      }}
    />,
  ),
);
check("collapsed request properties render as one line", requestCollapsedHtml.includes("9 new request properties") && requestCollapsedHtml.includes("field_0"));

const additiveOnly: ReleaseView = {
  ...release,
  id: "r-add",
  shippedAt: "2026-09-12T00:00:00.000Z",
  counts: { BREAKING: 0, DEPRECATION: 0, BEHAVIORAL: 0, ADDITIVE: 11, COSMETIC: 0 },
  changes: [],
  responseFieldAdds: { count: 11, fields: ["a"] },
};
const olderBreak: ReleaseView = {
  ...release,
  id: "r-break",
  shippedAt: "2026-01-01T00:00:00.000Z",
};
const ranked = leadWithSignal([additiveOnly, olderBreak]);
check("an additive-only release does not lead the feed", ranked[0]?.id === "r-break" && ranked[1]?.id === "r-add");

console.log(
  failures === 0
    ? `\n\x1b[32mall render checks passed\x1b[0m\n`
    : `\n\x1b[31m${failures} render check(s) failed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
