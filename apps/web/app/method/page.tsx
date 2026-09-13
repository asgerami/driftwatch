import { RULES, PUBLISH_CONFIDENCE_THRESHOLD } from "@driftwatch/core";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Method · Driftwatch",
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

      <h2>Nothing publishes itself</h2>
      <p>
        A change below {PUBLISH_CONFIDENCE_THRESHOLD} confidence never reaches
        the feed, and cosmetic changes never do at any confidence. Everything
        else is held for human review first. Precision over recall, without
        apology: one false breaking change costs a reader permanently.
      </p>

      <h2>The ruleset</h2>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>Severity</th>
            <th>What it does to calling code</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((rule) => (
            <tr key={rule.id}>
              <td className="rule">
                {rule.id}
                {rule.directionFlip ? " ⇄" : ""}
              </td>
              <td>
                <span className="chip" data-severity={rule.severity}>
                  {rule.severity.toLowerCase()}
                </span>
              </td>
              <td>{rule.consequence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "var(--mute)", fontSize: "0.85rem", marginTop: "12px" }}>
        ⇄ marks a rule producer-side tools classify the other way.
      </p>
    </main>
  );
}
