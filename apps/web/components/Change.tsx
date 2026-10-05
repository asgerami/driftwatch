import type { AdditiveLine, ChangeView, ReleaseView } from "../lib/types";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "../lib/types";
import {
  additiveLineHeadline,
  requestNullableHeadline,
  requestPropertyHeadline,
} from "../lib/feed";
import { Inline } from "./Inline";
import { Chevron, FlipIcon, SeverityMark } from "./Marks";

export function SeverityChip({ severity }: { severity: ChangeView["severity"] }) {
  return <SeverityMark severity={severity} />;
}

/**
 * The direction-flip marker.
 *
 * Worth its own badge: these are the changes every producer-side tool in the
 * category classifies the other way, so it is the single clearest statement
 * of what this feed is for.
 */
export function FlipBadge() {
  return (
    <span
      className="flip"
      title="Producer-side tools classify this as non-breaking. From the calling end it is not."
    >
      <FlipIcon size={14} />
      direction flip: their tools call this safe
    </span>
  );
}

const LOCATIONS_SHOWN = 6;

export function whereText(change: ChangeView): string {
  const locations = change.locations;
  if (locations && locations.length > 1) {
    const shown = locations.slice(0, LOCATIONS_SHOWN).join(", ");
    const more = locations.length - LOCATIONS_SHOWN;
    return `${locations.length} places: ${shown}${more > 0 ? ` +${more} more` : ""}`;
  }
  if (change.componentName) {
    const field = change.fieldPath ? `.${change.fieldPath}` : "";
    const reach = change.affectedOperations
      ? ` · reachable from ${change.affectedOperations} operation${change.affectedOperations === 1 ? "" : "s"}`
      : "";
    return `${change.componentName}${field}${reach}`;
  }
  const op = [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
  const field = change.fieldPath ? ` · ${change.fieldPath}` : "";
  const sites =
    change.siteCount > 1 ? ` · ${change.siteCount} call sites` : "";
  return `${op}${field}${sites}`;
}

export function ChangeItem({ change, repeat = false }: { change: ChangeView; repeat?: boolean }) {
  const pattern = change.patterns.ts ?? change.patterns.py ?? change.patterns.go;

  return (
    <li className="change" id={change.id} data-severity={change.severity}>
      <div className="marks">
        <SeverityChip severity={change.severity} />
        {change.directionFlip ? <FlipBadge /> : null}
      </div>
      <h3 className="change-title">
        {change.href ? <a href={change.href}>{change.headline}</a> : change.headline}
      </h3>
      {repeat ? null : (
        <p className="change-body">
          <Inline text={change.body.split("\n\n")[0] ?? ""} />
        </p>
      )}
      {change.locations && change.detail ? (
        <p className="change-detail">{change.detail}</p>
      ) : null}
      <div className="change-where">{whereText(change)}</div>
      {pattern ? (
        <details className="disclose">
          <summary>
            <Chevron size={13} />
            Code that breaks
          </summary>
          <pre>{pattern}</pre>
        </details>
      ) : null}
    </li>
  );
}

export function Tally({ counts }: { counts: ReleaseView["counts"] }) {
  const shown = SEVERITY_ORDER.filter((severity) => counts[severity] > 0);
  if (shown.length === 0) return null;

  return (
    <span className="tally">
      {shown.map((severity) => (
        <SeverityMark
          key={severity}
          severity={severity}
          text={`${counts[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`}
        />
      ))}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function AdditiveLineRow({
  line,
  headline,
  id,
}: {
  line: AdditiveLine;
  headline: string;
  /** Anchor the RSS feed links to. */
  id: string;
}) {
  return (
    <div className="additive-line" id={id} data-severity="ADDITIVE">
      <details className="disclose">
        <summary>
          <Chevron size={13} />
          <SeverityMark severity="ADDITIVE" text="" />
          {headline}
        </summary>
        {line.fields.length > 0 ? (
          <ul className="field-list">
            {line.fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </div>
  );
}

export function Release({ release }: { release: ReleaseView }) {
  const source = release.sourceKey !== "api" ? release.sourceLabel : undefined;
  return (
    <article className="release" id={release.id}>
      <header className="release-side">
        <a className="release-provider" href={`/apis/${release.providerSlug}`}>
          {release.providerName}
        </a>
        {source ? <span className="release-source">{source}</span> : null}
        <span className="release-meta">
          <time dateTime={release.shippedAt}>{formatDate(release.shippedAt)}</time>
          {release.commitSha ? ` · ${release.commitSha.slice(0, 8)}` : ""}
        </span>
        <Tally counts={release.counts} />
      </header>
      <div className="release-main">
        {release.providerNote ? <p className="provider-note">{release.providerNote}</p> : null}
        {release.changes.length > 0 ? (
          <ul className="changes">
            {release.changes.map((change, i) => (
              // Four fields removed in one release share one explanation: say it once.
              <ChangeItem
                key={change.id}
                change={change}
                repeat={i > 0 && release.changes[i - 1]!.body === change.body}
              />
            ))}
          </ul>
        ) : null}
        {release.responseFieldAdds ? (
          <AdditiveLineRow
            line={release.responseFieldAdds}
            headline={additiveLineHeadline(release.responseFieldAdds)}
            id={`${release.id}-fields`}
          />
        ) : null}
        {release.requestPropertyAdds ? (
          <AdditiveLineRow
            line={release.requestPropertyAdds}
            headline={requestPropertyHeadline(release.requestPropertyAdds)}
            id={`${release.id}-request-fields`}
          />
        ) : null}
        {release.requestNullableAdds ? (
          <AdditiveLineRow
            line={release.requestNullableAdds}
            headline={requestNullableHeadline(release.requestNullableAdds)}
            id={`${release.id}-request-nullable`}
          />
        ) : null}
      </div>
    </article>
  );
}

/**
 * Shown when nothing is published for a page yet.
 *
 * This is a public page. It says what will appear here and why it is empty,
 * never which command to run: the review gate is how the feed earns trust,
 * so an empty page is honest, not broken.
 */
export function EmptyFeed({
  providerName,
  snapshotCount,
}: {
  providerName?: string;
  snapshotCount?: number;
}) {
  const scoped = providerName ? ` for ${providerName}` : "";

  if ((snapshotCount ?? 0) === 1) {
    return (
      <div className="empty">
        <p>
          Nothing published yet{scoped}. Tracking started recently, and changes
          appear from the next time the spec is updated.
        </p>
      </div>
    );
  }

  return (
    <div className="empty">
      <p>No changes published yet{scoped}.</p>
      <p>
        Every change is checked by a person before it appears here, so the
        feed stays quiet rather than guess.{" "}
        <a href="/method">How changes are classified</a>.
      </p>
    </div>
  );
}
