import { countFeedFetch } from "../../lib/feedFetch";
import { RSS_HEADERS, feedEntries, renderRss } from "../../lib/feeds";
import { recentReleases } from "../../lib/queries";

// Runs per request so every feed fetch is counted; a statically regenerated
// route would only run once per revalidation. On Workers nothing caches in
// front of it, so the count is exact.
export const dynamic = "force-dynamic";

/** Every API, newest first: the feed to subscribe to for everything. */
export async function GET() {
  await countFeedFetch("/rss.xml");
  const releases = await recentReleases(60);
  const xml = renderRss(
    {
      title: "Driftwatch: every API",
      description: "Breaking changes in the third-party APIs Driftwatch watches, read from the calling end.",
      homePath: "/",
      feedPath: "/rss.xml",
    },
    feedEntries(releases),
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
