import type { AdditiveLine, ChangeView, ReleaseView } from "../lib/types";
import { SEVERITY_LABEL, SEVERITY_ORDER } from "../lib/types";
import { additiveLineHeadline, requestPropertyHeadline } from "../lib/feed";
import { stationId } from "../lib/stations";

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

function whereText(change: ChangeView): string {
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

export function ChangeItem({
  change,
  compact = false,
}: {
  change: ChangeView;
  compact?: boolean;
}) {
  const pattern = compact
    ? undefined
    : (change.patterns.ts ?? change.patterns.py ?? change.patterns.go);

  return (
    <li className="change" data-severity={change.severity}>
      <div className="change-head">
        <SeverityChip severity={change.severity} />
        {change.directionFlip ? <FlipBadge /> : null}
        <span className="rule-id">{change.ruleId}</span>
      </div>
      <h3 className="change-title">{change.headline}</h3>
      <p className="change-body">{change.body.split("\n\n")[0]}</p>
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
}: {
  line: AdditiveLine;
  headline: string;
}) {
  const shown = line.fields.slice(0, 8);
  const more = line.fields.length - shown.length;
  return (
    <p className="additive-line">
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

export function Release({
  release,
  compact = false,
}: {
  release: ReleaseView;
  compact?: boolean;
}) {
  const changes = compact ? release.changes.slice(0, 2) : release.changes;
  const hidden = compact ? Math.max(0, release.changes.length - changes.length) : 0;

  return (
    <article className="release">
      <header className="release-head">
        <span className="station">{stationId(release.providerSlug)}</span>
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
      {changes.length > 0 ? (
        <ul className="changes">
          {changes.map((change) => (
            <ChangeItem key={change.id} change={change} compact={compact} />
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <p className="additive-line">
          <a href={`/${release.providerSlug}`}>
            +{hidden} more on {stationId(release.providerSlug)}
          </a>
        </p>
      ) : null}
      {release.responseFieldAdds ? (
        <AdditiveLineRow
          line={release.responseFieldAdds}
          headline={additiveLineHeadline(release.responseFieldAdds)}
        />
      ) : null}
      {release.requestPropertyAdds ? (
        <AdditiveLineRow
          line={release.requestPropertyAdds}
          headline={requestPropertyHeadline(release.requestPropertyAdds)}
        />
      ) : null}
    </article>
  );
}

/**
 * Shown until the first backfill has been reviewed and published.
 *
 * An empty state that tells you the exact next command is worth more than a
 * shrug, because for the first week of this project's life it is the page
 * you will see most.
 */
export function EmptyFeed({
  providerSlug,
  snapshotCount,
}: {
  providerSlug?: string;
  snapshotCount?: number;
}) {
  const scoped = providerSlug ? ` for ${providerSlug}` : "";

  if ((snapshotCount ?? 0) === 1) {
    return (
      <div className="empty">
        <p>
          Nothing published yet{scoped}. One spec version is stored. Diff needs
          two consecutive surfaces, so poll or backfill until a second one
          appears, then <code>pnpm w diff</code> and{" "}
          <code>pnpm w review</code>.
        </p>
        <p style={{ marginBottom: 0 }}>
          Hosted URL sources have no git history: the first snapshot is now,
          and the next change is the first pair.
        </p>
      </div>
    );
  }

  if ((snapshotCount ?? 0) > 1) {
    return (
      <div className="empty">
        <p>
          Nothing published yet{scoped}. {snapshotCount} spec versions are
          stored. Changes appear here only after a human sets{" "}
          <code>publishedAt</code>, which is the review gate.
        </p>
        <p style={{ marginBottom: 0 }}>
          To open it: <code>pnpm w diff</code> → <code>pnpm w review --publish</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="empty">
      <p>
        Nothing published yet{scoped}. Changes appear here only after a human
        sets <code>publishedAt</code>, which is the review gate.
      </p>
      <p style={{ marginBottom: 0 }}>
        To fill it: <code>pnpm w seed</code> → <code>pnpm w backfill</code> →{" "}
        <code>pnpm w diff</code> → <code>pnpm w review</code>.
      </p>
    </div>
  );
}
