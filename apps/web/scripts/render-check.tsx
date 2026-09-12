import { renderToStaticMarkup } from "react-dom/server";
import { Release, EmptyFeed, ChangeItem } from "../components/Change";
import type { ChangeView, ReleaseView } from "../lib/types";

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

const emptyHtml = decode(renderToStaticMarkup(<EmptyFeed />));
check("empty state names the next command", emptyHtml.includes("pnpm w seed"));
check("empty state explains the review gate", emptyHtml.includes("publishedAt"));

const emptyProvider = decode(renderToStaticMarkup(<EmptyFeed providerSlug="twilio" />));
check("empty state is scoped when given a provider", emptyProvider.includes("for twilio"));

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

console.log(
  failures === 0
    ? `\n\x1b[32mall render checks passed\x1b[0m\n`
    : `\n\x1b[31m${failures} render check(s) failed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
