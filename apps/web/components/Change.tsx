import type { AdditiveLine, ChangeView, ReleaseView } from "../lib/types";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "../lib/types";
import {
  additiveLineHeadline,
  requestNullableHeadline,
  requestPropertyHeadline,
} from "../lib/feed";

export function SeverityChip({ severity }: { severity: ChangeView["severity"] }) {
  return (
    <span className="chip" data-severity={severity}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
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
      direction flip
    </span>
  );
}

const LOCATIONS_SHOWN = 6;

function whereText(change: ChangeView): string {
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

export function ChangeItem({ change }: { change: ChangeView }) {
  const pattern = change.patterns.ts ?? change.patterns.py ?? change.patterns.go;

  return (
    <li className="change" id={change.id} data-severity={change.severity}>
      <div className="change-head">
        <SeverityChip severity={change.severity} />
        {change.directionFlip ? <FlipBadge /> : null}
        <span className="rule-id">{change.ruleId}</span>
      </div>
      <h3 className="change-title">{change.headline}</h3>
      <p className="change-body">{change.body.split("\n\n")[0]}</p>
      {change.locations && change.detail ? (
        <p className="change-detail">{change.detail}</p>
      ) : null}
      <div className="change-where">{whereText(change)}</div>
      {pattern ? <pre>{pattern}</pre> : null}
    </li>
  );
}

export function Tally({ counts }: { counts: ReleaseView["counts"] }) {
  const shown = SEVERITY_ORDER.filter((severity) => counts[severity] > 0);
  if (shown.length === 0) return null;

  return (
    <span className="tally">
      {shown.map((severity) => (
        <span key={severity} className="chip" data-severity={severity}>
          {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
        </span>
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
  const shown = line.fields.slice(0, 8);
  const more = line.fields.length - shown.length;
  return (
    <p className="additive-line" id={id}>
      <span className="chip" data-severity="ADDITIVE">
        Additive
      </span>
      <span>{headline}</span>
      {shown.length > 0 ? (
        <span className="additive-fields">
          {shown.join(", ")}
          {more > 0 ? ` +${more} more` : ""}
        </span>
      ) : null}
    </p>
  );
}

export function Release({ release }: { release: ReleaseView }) {
  return (
    <article className="release" id={release.id}>
      <header className="release-head">
        <span className="release-provider">
          {release.providerName}
          {release.sourceKey !== "api" ? ` · ${release.sourceKey}` : ""}
        </span>
        <span className="release-meta">
          {formatDate(release.shippedAt)}
          {release.commitSha ? ` · ${release.commitSha.slice(0, 8)}` : ""}
        </span>
        <Tally counts={release.counts} />
      </header>
      {release.providerNote ? <p className="provider-note">{release.providerNote}</p> : null}
      {release.changes.length > 0 ? (
        <ul className="changes">
          {release.changes.map((change) => (
            <ChangeItem key={change.id} change={change} />
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
        <p style={{ margin: 0 }}>
          Nothing published yet{scoped}. Tracking started recently, and changes
          appear from the next time the spec is updated.
        </p>
      </div>
    );
  }

  return (
    <div className="empty">
      <p>No changes published yet{scoped}.</p>
      <p style={{ marginBottom: 0 }}>
        Every change is checked by a person before it appears here, so the
        feed stays quiet rather than guess.{" "}
        <a href="/method">How changes are classified</a>.
      </p>
    </div>
  );
}
