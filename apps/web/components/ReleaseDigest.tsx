import type { Severity } from "@driftwatch/core";

import { additiveLineHeadline } from "../lib/feed";
import type { ReleaseView } from "../lib/types";
import { ArrowRight, SeverityMark } from "./Marks";
import { ProviderLogo } from "./ProviderLogo";

/** One line per release: its most serious change, and how many more it has. */
function lead(release: ReleaseView): { severity: Severity; headline: string; href: string; more: number } {
  const lines = [release.responseFieldAdds, release.requestPropertyAdds, release.requestNullableAdds].filter(
    Boolean,
  ).length;
  const releaseHref = `/apis/${release.providerSlug}#${release.id}`;
  // Changes arrive sorted, most severe first.
  const top = release.changes[0];
  if (top) {
    return {
      severity: top.severity,
      headline: top.headline,
      href: top.href ?? releaseHref,
      more: release.changes.length - 1 + lines,
    };
  }
  return {
    severity: "ADDITIVE",
    headline: release.responseFieldAdds ? additiveLineHeadline(release.responseFieldAdds) : "New fields",
    href: releaseHref,
    more: lines - 1,
  };
}

/**
 * The home page's latest releases, one row each. The full cards live on each
 * API's page; this is the glance a reader decides from.
 */
export function ReleaseDigest({ releases }: { releases: ReleaseView[] }) {
  return (
    <ul className="digest">
      {releases.map((release) => {
        const { severity, headline, href, more } = lead(release);
        return (
          <li key={release.id}>
            <a className="digest-row" href={href} data-severity={severity}>
              <span className="digest-provider">
                <ProviderLogo slug={release.providerSlug} name={release.providerName} size={18} />
                {release.providerName}
              </span>
              <SeverityMark severity={severity} pill />
              <span className="digest-title">
                {headline}
                {more > 0 ? <span className="digest-more"> and {more} more</span> : null}
              </span>
              <time className="digest-date" dateTime={release.shippedAt}>
                {release.shippedAt.slice(0, 10)}
              </time>
              <ArrowRight size={14} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
