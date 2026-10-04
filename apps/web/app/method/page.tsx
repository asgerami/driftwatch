import type { Metadata } from "next";
import {
  ALWAYS_HELD_RULES,
  AUTO_PUBLISH_POLICY,
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULES,
  SPIKE_FLOOR,
  SPIKE_MULTIPLE,
} from "@driftwatch/core";

export const metadata: Metadata = {
  title: "How changes are classified",
  description:
    "Every rule Driftwatch uses to call an API change breaking, and which changes publish without a person. Deterministic, no model involved.",
  alternates: { canonical: "/method" },
};

const ordered = Object.values(RULES).sort(
  (a, b) =>
    ["BREAKING", "DEPRECATION", "BEHAVIORAL", "ADDITIVE", "COSMETIC"].indexOf(
      a.severity,
    ) -
      ["BREAKING", "DEPRECATION", "BEHAVIORAL", "ADDITIVE", "COSMETIC"].indexOf(
        b.severity,
      ) || a.id.localeCompare(b.id),
);

/**
 * The method page.
 *
 * Publishing exactly how severity is decided is not documentation, it is the
 * product's main claim. In a category where the only thing being sold is
 * trust, being auditable is the differentiator a competitor cannot match by
 * shipping faster.
 */
export default function MethodPage() {
  return (
    <main className="prose">
      <h1>How this is decided</h1>

      <h2>Severity is deterministic</h2>
      <p>
        Every change is classified by a fixed rule, not by a language model.
        The same pair of specs always produces the same severities, so a wrong
        call is a bug in a rule that can be found and fixed, rather than an
        unreproducible generation.
      </p>
      <p>
        A model is used for one thing only: rewriting explanatory prose where
        the templates read thin. It never assigns severity, and it never sets
        the headline.
      </p>

      <h2>The three direction flips</h2>
      <p>
        Producer-side tools ask &ldquo;does this break my callers?&rdquo; This
        feed sits on the calling end, where three rules invert. They are the
        reason it exists.
      </p>
      <ol>
        <li>
          A response property <strong>becoming optional</strong> is safe for a
          producer and a null dereference waiting to happen for you.
        </li>
        <li>
          A <strong>new enum value in a response</strong> is additive for a
          producer. It breaks exhaustive switches, strict parsers and generated
          client enums.
        </li>
        <li>
          A <strong>removed request parameter</strong> raises no error at all.
          The provider ignores it, your results change, and nothing goes red.
        </li>
      </ol>

      <h2>What we are actually reading</h2>
      <p>
        Specifications, not behaviour. Some providers update their spec weeks
        after shipping, and some never do. Everything here is spec-derived, and
        a change that never reached the spec will never reach this feed.
      </p>
      <p>
        Shared schemas are diffed once each, not once per endpoint that
        references them, and the number of operations a component reaches is
        shown alongside it. Following references inline instead produced 4528
        &ldquo;breaking&rdquo; changes for a single Stripe release, the same
        enum reported 2319 times.
      </p>

      <h2>What publishes without a person</h2>
      <p>
        A change below {PUBLISH_CONFIDENCE_THRESHOLD} confidence never reaches
        the feed, and cosmetic changes never do at any confidence. Precision
        over recall, without apology: one false breaking change costs a reader
        permanently.
      </p>
      <p>
        Above that line, a person used to approve every change. Nearly all of
        them turned out to be the same few shapes, checked against the real
        specs many times over, so those now publish on their own. Every false
        alarm found so far came from a handful of other shapes, and those still
        wait for a person:
      </p>
      <ul>
        <li>
          <strong>Endpoint or operation removed</strong> (
          {[...ALWAYS_HELD_RULES].filter((id) => !id.startsWith("security.")).map((id, i) => (
            <span key={id}>
              {i > 0 ? ", " : ""}
              <code>{id}</code>
            </span>
          ))}
          ). Providers withdraw endpoints they documented early and move
          others into separate spec files, and both look exactly like a removal.
        </li>
        <li>
          <strong>Any authentication change</strong>. A spec converter once
          wrote a malformed security entry that read as a new auth scheme.
        </li>
        <li>
          <strong>Everything in an unusually large release</strong>: more than{" "}
          {SPIKE_FLOOR} breaking changes and more than {SPIKE_MULTIPLE}× that
          API&rsquo;s typical release. Format migrations look like this, and so
          do real overhauls worth a second look.
        </li>
        <li>
          <strong>The first changes from a newly added API</strong>, until a
          person has read them once.
        </li>
      </ul>
      <p>
        Each published change records whether a person or the policy (
        <code>{AUTO_PUBLISH_POLICY}</code>) published it.
      </p>

      <h2>The ruleset</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--rule-strong)" }}>
              Rule
            </th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--rule-strong)" }}>
              Severity
            </th>
            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--rule-strong)" }}>
              What it does to calling code
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((rule) => (
            <tr key={rule.id}>
              <td
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--rule)",
                  fontFamily: "var(--f-mono)",
                  fontSize: "0.78rem",
                  whiteSpace: "nowrap",
                  verticalAlign: "top",
                }}
              >
                {rule.id}
                {rule.directionFlip ? " ⇄" : ""}
              </td>
              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--rule)", verticalAlign: "top" }}>
                <span className="chip" data-severity={rule.severity}>
                  {rule.severity.toLowerCase()}
                </span>
              </td>
              <td
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--rule)",
                  color: "var(--ink-2)",
                  verticalAlign: "top",
                }}
              >
                {rule.consequence}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "var(--ink-3)", fontSize: "0.85rem", marginTop: "12px" }}>
        ⇄ marks a rule producer-side tools classify the other way.
      </p>
    </main>
  );
}
