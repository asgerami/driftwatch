import type { StoryPageView } from "../lib/types";
import { FlipBadge, SeverityChip } from "./Change";

/**
 * /changes/<id>: one story, everything a reader needs to act on it.
 *
 * Pure presentation, like the rest of components/, so render-check can
 * verify it without a database.
 */

function formatDay(iso: string): string {
  return iso.slice(0, 10);
}

function formatTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Who has to care, from the rule's direction and where the change lives. */
export function whoIsAffected(story: StoryPageView): string {
  const { change, providerName } = story;
  const reading = change.ruleId.startsWith("response.") || change.ruleId.startsWith("schema.");
  const sending = change.ruleId.startsWith("request.");
  const verb = reading
    ? "Code that reads"
    : sending
      ? "Code that sends"
      : "Code that calls";

  if (change.componentName) {
    const reach = change.affectedOperations
      ? `, used by ${change.affectedOperations} ${providerName} operation${change.affectedOperations === 1 ? "" : "s"}`
      : "";
    return `${verb} ${providerName}'s ${change.componentName} objects${reach}.`;
  }
  const op = [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
  if (op) {
    const field = change.fieldPath && (reading || sending) ? ` (${change.fieldPath})` : "";
    return `${verb} ${op}${field}.`;
  }
  return `Any ${providerName} integration using the places listed below.`;
}

export function StoryPage({ story }: { story: StoryPageView }) {
  const { change } = story;
  const pattern = change.patterns.ts ?? change.patterns.py ?? change.patterns.go;
  const paragraphs = change.body.split("\n\n").filter(Boolean);

  return (
    <main className="prose story">
      <p className="story-crumbs">
        <a href={`/apis/${story.providerSlug}`}>{story.providerName}</a>
        {" · "}
        {story.sourceLabel}
        {" · "}
        {formatDay(story.shippedAt)}
      </p>

      <div className="change-head">
        <SeverityChip severity={change.severity} />
        {change.directionFlip ? <FlipBadge /> : null}
        <span className="rule-id">{change.ruleId}</span>
      </div>
      <h1 className="story-title">{change.headline}</h1>

      <h2>What changed</h2>
      {paragraphs.map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
      {change.detail ? <p className="change-detail">{change.detail}</p> : null}

      <h2>Who is affected</h2>
      <p>{whoIsAffected(story)}</p>

      <h2>Before and after</h2>
      <ul className="story-facts">
        {story.facts.map((fact, i) => (
          <li key={i}>
            <code>{fact.location}</code>
            {fact.before !== undefined || fact.after !== undefined ? (
              <span className="story-delta">
                {" "}
                <span className="before">{fact.before ?? "absent"}</span>
                {" → "}
                <span className="after">{fact.after ?? "absent"}</span>
              </span>
            ) : null}
            {fact.detail && fact.detail !== change.detail ? (
              <span className="story-fact-detail"> · {fact.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {pattern ? (
        <>
          <p>Code that breaks:</p>
          <pre>{pattern}</pre>
        </>
      ) : null}

      <h2>Source</h2>
      <dl className="story-meta">
        <dt>Severity</dt>
        <dd>{change.severity.toLowerCase()}</dd>
        <dt>Shipped</dt>
        <dd>{formatTime(story.shippedAt)}</dd>
        <dt>Detected</dt>
        <dd>{formatTime(story.detectedAt)}</dd>
        <dt>Spec</dt>
        <dd>
          {story.sourceLink ? (
            <a href={story.sourceLink.href} rel="noreferrer noopener">
              {story.sourceLink.label}
            </a>
          ) : (
            "not available"
          )}
        </dd>
      </dl>
      <p className="story-footnote">
        Read from {story.providerName}&rsquo;s published OpenAPI spec, not from
        live traffic. <a href="/method">How severity is decided</a>.
      </p>
    </main>
  );
}
