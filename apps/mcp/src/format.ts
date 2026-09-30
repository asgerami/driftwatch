import {
  type FeedRelease,
  type Severity,
  filterReleases,
  hasSignal,
} from "./feed.js";

/** Enough for an agent to grep its code for each place, without a wall of text. */
const LOCATIONS_SHOWN = 10;

function where(change: FeedRelease["changes"][number]): string {
  const locations = change.locations;
  if (locations && locations.length > 1) {
    const shown = locations.slice(0, LOCATIONS_SHOWN).join(", ");
    const more = locations.length - LOCATIONS_SHOWN;
    return `${locations.length} places: ${shown}${more > 0 ? ` +${more} more` : ""}`;
  }
  if (change.componentName && change.fieldPath) {
    return `${change.componentName}.${change.fieldPath}`;
  }
  if (change.componentName) return change.componentName;
  const op = [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
  if (op && change.fieldPath) return `${op} · ${change.fieldPath}`;
  return op || change.fieldPath || change.ruleId;
}

function tally(release: FeedRelease): string {
  const parts: string[] = [];
  for (const key of ["BREAKING", "DEPRECATION", "BEHAVIORAL", "ADDITIVE"] as const) {
    const n = release.counts[key];
    if (n > 0) parts.push(`${n} ${key.toLowerCase()}`);
  }
  return parts.join(", ") || "no published signal";
}

/**
 * Compact prose a coding agent can read mid-task.
 *
 * Headlines stay; long consequence bodies are dropped. The agent asked
 * whether something broke, not for a digest essay.
 */
export function formatReleases(
  releases: FeedRelease[],
  minimum: Severity = "BEHAVIORAL",
): string {
  const shown = filterReleases(releases, minimum);
  if (shown.length === 0) {
    return `No published changes at ${minimum} or worse.`;
  }

  const lines: string[] = [];
  for (const release of shown) {
    const day = release.shippedAt.slice(0, 10);
    const flag = hasSignal(release) ? "" : " (additive only)";
    lines.push(
      `${release.providerName} ${release.sourceKey}  ${day}  ${tally(release)}${flag}`,
    );
    for (const change of release.changes) {
      const flip = change.directionFlip ? " [flip]" : "";
      lines.push(`  ▪ ${change.severity}${flip}  ${change.headline}`);
      lines.push(`      ${change.ruleId}  ${where(change)}`);
      if (change.locations && change.detail) lines.push(`      ${change.detail}`);
    }
    if (release.responseFieldAdds) {
      lines.push(
        `  ▪ ADDITIVE  ${release.responseFieldAdds.count} new response field` +
          (release.responseFieldAdds.count === 1 ? "" : "s"),
      );
    }
    if (release.requestPropertyAdds) {
      lines.push(
        `  ▪ ADDITIVE  ${release.requestPropertyAdds.count} new request ` +
          (release.requestPropertyAdds.count === 1 ? "property" : "properties"),
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function formatBreakingSummary(releases: FeedRelease[]): string {
  const hits = filterReleases(releases, "BEHAVIORAL").filter(hasSignal);
  if (hits.length === 0) {
    return "Nothing breaking, deprecated, or behaviourally shifted in the published feed.";
  }
  return formatReleases(hits, "BEHAVIORAL");
}
