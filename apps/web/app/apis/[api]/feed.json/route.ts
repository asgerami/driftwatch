import { JSON_FEED_HEADERS, feedEntries, renderJsonFeed } from "../../../../lib/feeds";
import { listProviders, recentReleases } from "../../../../lib/queries";

export const revalidate = 300;

/** Per-API JSON Feed 1.1. */
export async function GET(_request: Request, { params }: { params: Promise<{ api: string }> }) {
  const { api } = await params;
  const provider = (await listProviders()).find((p) => p.slug === api);
  if (!provider) return new Response("Unknown API", { status: 404 });

  const feed = renderJsonFeed(
    {
      title: `Driftwatch — ${provider.name}`,
      description: `Breaking changes in the ${provider.name} API, read from the calling end.`,
      homePath: `/apis/${api}`,
      feedPath: `/apis/${api}/feed.json`,
    },
    feedEntries(await recentReleases(50, api)),
  );
  return new Response(JSON.stringify(feed), { headers: JSON_FEED_HEADERS });
}
