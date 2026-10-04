import {
  additiveLineHeadline,
  requestNullableHeadline,
  requestPropertyHeadline,
} from "./feed";
import { absolute } from "./site";
import { SEVERITY_LABEL, type AdditiveLine, type ReleaseView } from "./types";

/**
 * Feed documents, built from the same release views the pages render.
 *
 * Pure, so render-check can validate both formats without a database. One
 * entry per story card, plus one per collapsed line of additive fields.
 * Entry ids are story ids, which survive ruleset bumps: a re-diff must not
 * show every subscriber every item again.
 */

export interface FeedEntry {
  id: string;
  url: string;
  title: string;
  summary: string;
  published: string;
  category: string;
}

export interface FeedMeta {
  title: string;
  description: string;
  /** Site path of the page this feed mirrors. */
  homePath: string;
  /** Site path of the feed itself. */
  feedPath: string;
}

export function feedEntries(releases: ReleaseView[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const release of releases) {
    for (const change of release.changes) {
      const where = change.componentName
        ? `${change.componentName}${change.fieldPath ? `.${change.fieldPath}` : ""}`
        : [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
      entries.push({
        id: change.href ? absolute(change.href) : `${release.id}:${change.id}`,
        url: change.href ? absolute(change.href) : absolute(`/apis/${release.providerSlug}`),
        title: `[${SEVERITY_LABEL[change.severity]}] ${release.providerName}: ${change.headline}`,
        summary: `${change.body.split("\n\n")[0]}\n\nRule: ${change.ruleId}${where ? `\nAt: ${where}` : ""}`,
        published: release.shippedAt,
        category: change.severity,
      });
    }

    // A collapsed line has no story of its own; its id is built from the
    // release's source and ship time, which a re-diff does not change.
    const lines: [AdditiveLine | undefined, string, (line: AdditiveLine) => string][] = [
      [release.responseFieldAdds, "fields", additiveLineHeadline],
      [release.requestPropertyAdds, "request-fields", requestPropertyHeadline],
      [release.requestNullableAdds, "request-nullable", requestNullableHeadline],
    ];
    for (const [line, anchor, headline] of lines) {
      if (!line) continue;
      const stable = `${release.providerSlug}-${release.sourceKey}-${release.shippedAt}-${anchor}`;
      entries.push({
        id: absolute(`/apis/${release.providerSlug}#${stable}`),
        url: absolute(`/apis/${release.providerSlug}#${release.id}-${anchor}`),
        title: `[${SEVERITY_LABEL.ADDITIVE}] ${release.providerName}: ${headline(line)}`,
        summary: line.fields.join(", "),
        published: release.shippedAt,
        category: "ADDITIVE",
      });
    }
  }
  return entries;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 forbids most control characters, and a provider description
    // can carry one.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** RSS 2.0, with the atom:link self reference validators expect. */
export function renderRss(meta: FeedMeta, entries: FeedEntry[]): string {
  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <guid isPermaLink="${entry.id === entry.url ? "true" : "false"}">${escapeXml(entry.id)}</guid>
      <pubDate>${new Date(entry.published).toUTCString()}</pubDate>
      <category>${escapeXml(entry.category)}</category>
      <description>${escapeXml(entry.summary)}</description>
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(absolute(meta.homePath))}</link>
    <atom:link href="${escapeXml(absolute(meta.feedPath))}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(meta.description)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

/** JSON Feed 1.1 (https://www.jsonfeed.org/version/1.1/). */
export function renderJsonFeed(meta: FeedMeta, entries: FeedEntry[]): Record<string, unknown> {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: meta.title,
    home_page_url: absolute(meta.homePath),
    feed_url: absolute(meta.feedPath),
    description: meta.description,
    language: "en",
    items: entries.map((entry) => ({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      content_text: entry.summary,
      date_published: new Date(entry.published).toISOString(),
      tags: [entry.category],
    })),
  };
}

export const RSS_HEADERS = {
  "content-type": "application/rss+xml; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=3600",
};

export const JSON_FEED_HEADERS = {
  "content-type": "application/feed+json; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=3600",
};
