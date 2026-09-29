import { recentReleases } from "../../../lib/queries";

export const revalidate = 300;

/**
 * Machine-readable feed.
 *
 * Quietly the most strategic surface here: wrapped as an MCP server, a coding
 * agent can ask mid-task whether anything the repo depends on has broken, and
 * get a typed answer instead of a blog post.
 *
 * `?signal=1` ranks releases with a break, deprecation or behavioural shift
 * first — the default chronological order is for humans reading history.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const preferSignal =
    url.searchParams.get("signal") === "1" || url.searchParams.get("signal") === "true";

  const releases = await recentReleases(limit, provider, { preferSignal });

  return Response.json(
    {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      note: "Spec-derived. Severity is assigned by a deterministic ruleset; see /method.",
      releases,
    },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        // Netlify's CDN keys its cache on the path plus only the query
        // parameters named here. Without this, ?provider=stripe was served
        // whichever response was cached first for /api/feed.json, which is
        // every provider: the MCP tool asked for Stripe and got OpenAI.
        "netlify-vary": "query=provider|limit|signal",
      },
    },
  );
}
