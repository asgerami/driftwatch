import { countFeedFetch } from "../../lib/feedFetch";
import { JSON_FEED_HEADERS, feedEntries, renderJsonFeed } from "../../lib/feeds";
import { recentReleases } from "../../lib/queries";

// Runs per request so every feed fetch is counted; a statically regenerated
// route would only run once per revalidation. On Workers nothing caches in
// front of it, so the count is exact.
export const dynamic = "force-dynamic";

/**
 * JSON Feed 1.1 for every API. /api/feed.json stays as it is: it is the
 * richer, Driftwatch-specific document the MCP server reads.
 */
export async function GET() {
  await countFeedFetch("/feed.json");
  const releases = await recentReleases(60);
  const feed = renderJsonFeed(
    {
      title: "Driftwatch: every API",
      description: "Breaking changes in the third-party APIs Driftwatch watches, read from the calling end.",
      homePath: "/",
      feedPath: "/feed.json",
    },
    feedEntries(releases),
  );
  return new Response(JSON.stringify(feed), { headers: JSON_FEED_HEADERS });
}
