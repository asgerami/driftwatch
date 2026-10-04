import { getChangeDocument } from "../../../../lib/changeDocument";

/** One published story as JSON, for `driftwatch scan --change <id>`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await getChangeDocument(id);
  if (!document) return Response.json({ error: "no published change with that id" }, { status: 404 });
  return Response.json(document, {
    headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
