import { recentReleases } from "../../../lib/queries";
import { SEVERITY_LABEL } from "../../../lib/types";
import { additiveLineHeadline, requestPropertyHeadline } from "../../../lib/feed";

export const revalidate = 300;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rssItem(fields: {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  category: string;
  description: string;
}): string {
  return `    <item>
      <title>${escapeXml(fields.title)}</title>
      <link>${escapeXml(fields.link)}</link>
      <guid isPermaLink="false">${escapeXml(fields.guid)}</guid>
      <pubDate>${new Date(fields.pubDate).toUTCString()}</pubDate>
      <category>${escapeXml(fields.category)}</category>
      <description>${escapeXml(fields.description)}</description>
    </item>`;
}

/**
 * Per-provider RSS.
 *
 * Cheap to build and it lands in the team Slack channels where the people who
 * would pay for the GitHub App already are.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = new URL(request.url).origin;
  const releases = await recentReleases(50, provider);

  const items = releases
    .flatMap((release) => {
      const changeItems = release.changes.map((change) => {
        const title = `[${SEVERITY_LABEL[change.severity]}] ${release.providerName}: ${change.headline}`;
        const where = change.componentName
          ? `${change.componentName}${change.fieldPath ? `.${change.fieldPath}` : ""}`
          : [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
        return rssItem({
          title,
          link: `${origin}/${release.providerSlug}#${change.id}`,
          guid: change.id,
          pubDate: release.shippedAt,
          category: change.severity,
          description: `${change.body}\n\nRule: ${change.ruleId}\nAt: ${where}`,
        });
      });

      if (release.responseFieldAdds) {
        const line = release.responseFieldAdds;
        changeItems.push(
          rssItem({
            title: `[${SEVERITY_LABEL.ADDITIVE}] ${release.providerName}: ${additiveLineHeadline(line)}`,
            link: `${origin}/${release.providerSlug}#${release.id}-fields`,
            guid: `${release.id}-response-fields`,
            pubDate: release.shippedAt,
            category: "ADDITIVE",
            description: line.fields.join(", "),
          }),
        );
      }

      if (release.requestPropertyAdds) {
        const line = release.requestPropertyAdds;
        changeItems.push(
          rssItem({
            title: `[${SEVERITY_LABEL.ADDITIVE}] ${release.providerName}: ${requestPropertyHeadline(line)}`,
            link: `${origin}/${release.providerSlug}#${release.id}-request-fields`,
            guid: `${release.id}-request-fields`,
            pubDate: release.shippedAt,
            category: "ADDITIVE",
            description: line.fields.join(", "),
          }),
        );
      }

      return changeItems;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`Driftwatch — ${releases[0]?.providerName ?? provider}`)}</title>
    <link>${escapeXml(`${origin}/${provider}`)}</link>
    <description>Breaking changes in the ${escapeXml(provider)} API, read from the calling end.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
