import type { StoryPageView } from "../lib/types";
import { FlipBadge } from "./Change";
import { Inline } from "./Inline";
import { ArrowUpRight, FeedIcon, SeverityMark } from "./Marks";

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
  const anyDelta = story.facts.some((fact) => fact.before !== undefined || fact.after !== undefined);

  return (
    <main className="shell">
      <header className="story-head">
        <p className="crumbs">
          <a href={`/apis/${story.providerSlug}`}>{story.providerName}</a>
          {" / "}
          {story.sourceLabel}
          {" / "}
          <time dateTime={story.shippedAt}>{formatDay(story.shippedAt)}</time>
        </p>
        <div className="marks">
          <SeverityMark severity={change.severity} />
          {change.directionFlip ? <FlipBadge /> : null}
        </div>
        <h1 className="story-title">{change.headline}</h1>
      </header>

      <div className="read">
        <article className="read-main">
          <h2>What changed</h2>
          {paragraphs.map((paragraph, i) => (
            <p key={i}>
              <Inline text={paragraph} />
            </p>
          ))}
          {change.detail ? <p className="change-detail">{change.detail}</p> : null}

          <h2>Who is affected</h2>
          <p>{whoIsAffected(story)}</p>

          <h2>Before and after</h2>
          <table className="corrections">
            <thead>
              <tr>
                <th scope="col">Where</th>
                {anyDelta ? (
                  <>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </>
                ) : (
                  <th scope="col">Change</th>
                )}
              </tr>
            </thead>
            <tbody>
              {story.facts.map((fact, i) => {
                const note = fact.detail && fact.detail !== change.detail ? fact.detail : undefined;
                return (
                  <tr key={i}>
                    <td className="loc">{fact.location}</td>
                    {anyDelta ? (
                      <>
                        <td>
                          <span className="before">{fact.before ?? "absent"}</span>
                        </td>
                        <td>
                          <span className="after">{fact.after ?? "absent"}</span>
                          {note ? <span className="correction-note">{note}</span> : null}
                        </td>
                      </>
                    ) : (
                      <td>{note ?? change.detail ?? "Changed"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pattern ? (
            <>
              <h2>Code that breaks</h2>
              <pre>{pattern}</pre>
            </>
          ) : null}

          <p className="footnote">
            Read from {story.providerName}&rsquo;s published OpenAPI spec, not from
            live traffic. <a href="/method">How severity is decided</a>.
          </p>
        </article>

        <aside className="aside" aria-label="About this change">
          <div className="aside-card">
            <dl className="facts">
              <dt>Severity</dt>
              <dd>
                <SeverityMark severity={change.severity} />
              </dd>
              <dt>Shipped</dt>
              <dd>
                <time dateTime={story.shippedAt}>{formatTime(story.shippedAt)}</time>
              </dd>
              <dt>Detected</dt>
              <dd>
                <time dateTime={story.detectedAt}>{formatTime(story.detectedAt)}</time>
              </dd>
              <dt>Spec</dt>
              <dd>
                {story.sourceLink ? (
                  <a className="link-arrow" href={story.sourceLink.href} rel="noreferrer noopener">
                    {story.sourceLink.label}
                    <ArrowUpRight size={13} />
                  </a>
                ) : (
                  "not available"
                )}
              </dd>
              <dt>Feed</dt>
              <dd>
                <a className="link-arrow" href={`/apis/${story.providerSlug}/rss.xml`}>
                  <FeedIcon size={13} /> {story.providerName} RSS
                </a>
              </dd>
            </dl>
          </div>
          <div className="aside-cta">
            <p>Get a pull request when a change like this hits code in your repo.</p>
            <a className="btn" href="/watch">
              Watch my repo
            </a>
          </div>
        </aside>
      </div>
    </main>
  );
}
