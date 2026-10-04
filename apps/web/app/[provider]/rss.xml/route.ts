/**
 * Feed readers subscribed to the old /<provider>/rss.xml follow a 308.
 *
 * A relative Location: on Netlify, request.url carries the deploy's internal
 * hostname, so an absolute redirect built from it sent readers there instead
 * of back to the domain they used.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  return new Response(null, {
    status: 308,
    headers: { location: `/apis/${encodeURIComponent(provider)}/rss.xml` },
  });
}
