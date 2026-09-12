import { recentReleases } from "../../../lib/queries";
import { SEVERITY_LABEL } from "../../../lib/types";

export const revalidate = 300;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
    .flatMap((release) =>
      release.changes.map((change) => {
        const title = `[${SEVERITY_LABEL[change.severity]}] ${release.providerName}: ${change.headline}`;
        const where = change.componentName
          ? `${change.componentName}${change.fieldPath ? `.${change.fieldPath}` : ""}`
          : [change.method?.toUpperCase(), change.path].filter(Boolean).join(" ");
        return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(`${origin}/${release.providerSlug}#${change.id}`)}</link>
      <guid isPermaLink="false">${escapeXml(change.id)}</guid>
      <pubDate>${new Date(release.shippedAt).toUTCString()}</pubDate>
      <category>${escapeXml(change.severity)}</category>
      <description>${escapeXml(`${change.body}\n\nRule: ${change.ruleId}\nAt: ${where}`)}</description>
    </item>`;
      }),
    )
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
