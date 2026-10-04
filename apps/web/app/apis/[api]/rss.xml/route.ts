import { RSS_HEADERS, feedEntries, renderRss } from "../../../../lib/feeds";
import { listProviders, recentReleases } from "../../../../lib/queries";

export const revalidate = 300;

/**
 * Per-API RSS.
 *
 * Cheap to build and it lands in the team Slack channels where the people who
 * would pay for the GitHub App already are.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ api: string }> }) {
  const { api } = await params;
  const provider = (await listProviders()).find((p) => p.slug === api);
  if (!provider) return new Response("Unknown API", { status: 404 });

  const xml = renderRss(
    {
      title: `Driftwatch — ${provider.name}`,
      description: `Breaking changes in the ${provider.name} API, read from the calling end.`,
      homePath: `/apis/${api}`,
      feedPath: `/apis/${api}/rss.xml`,
    },
    feedEntries(await recentReleases(50, api)),
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
