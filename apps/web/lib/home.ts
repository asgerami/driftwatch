import { whereText } from "../components/Change";
import type { WindowItem } from "../components/ProductWindow";
import { providerMark } from "../components/ProviderLogo";
import type { ReleaseView } from "./types";

const RANK = { BREAKING: 0, DEPRECATION: 1, BEHAVIORAL: 2, ADDITIVE: 3, COSMETIC: 4 } as const;

/** The product window's inbox: the latest published changes, breaks first. */
export function windowItems(releases: ReleaseView[], limit = 6): WindowItem[] {
  const items: (WindowItem & { order: number })[] = [];
  const seen = new Set<string>();
  releases.forEach((release, r) => {
    for (const change of release.changes) {
      if (!change.href || change.severity === "ADDITIVE" || change.severity === "COSMETIC") continue;
      const key = `${release.providerSlug}|${change.headline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: change.id,
        href: change.href,
        providerSlug: release.providerSlug,
        providerName: release.providerName,
        markPath: providerMark(release.providerSlug)?.path,
        shippedAt: release.shippedAt,
        severity: change.severity,
        headline: change.headline,
        body: change.body.split("\n\n")[0] ?? "",
        where: whereText(change),
        pattern: change.patterns.ts ?? change.patterns.py ?? change.patterns.go,
        directionFlip: change.directionFlip,
        order: RANK[change.severity] * 1000 + r,
      });
    }
  });
  return items
    .sort((a, b) => a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...item }) => item);
}
