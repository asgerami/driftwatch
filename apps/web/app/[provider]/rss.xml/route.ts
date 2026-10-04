/** Feed readers subscribed to the old /<provider>/rss.xml follow a 308. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const target = new URL(`/apis/${encodeURIComponent(provider)}/rss.xml`, request.url);
  return Response.redirect(target, 308);
}
