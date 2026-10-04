import { RSS_HEADERS, feedEntries, renderRss } from "../../lib/feeds";
import { recentReleases } from "../../lib/queries";

export const revalidate = 300;

/** Every API, newest first: the feed to subscribe to for everything. */
export async function GET() {
  const releases = await recentReleases(60);
  const xml = renderRss(
    {
      title: "Driftwatch — every API",
      description: "Breaking changes in the third-party APIs Driftwatch watches, read from the calling end.",
      homePath: "/",
      feedPath: "/rss.xml",
    },
    feedEntries(releases),
  );
  return new Response(xml, { headers: RSS_HEADERS });
}
