import { prisma } from "../db.js";
import { blobStoreName } from "../blobs.js";
import { sourceHealth } from "../health.js";

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

/** What is actually in the database. Run this after a backfill. */
export async function status(): Promise<void> {
  const sources = await prisma.specSource.findMany({
    include: {
      provider: true,
      _count: { select: { snapshots: true } },
    },
    orderBy: [{ provider: { slug: "asc" } }, { key: "asc" }],
  });

  if (sources.length === 0) {
    console.log("No sources. Run `pnpm w seed`.");
    return;
  }

  console.log(
    `\n${pad("SOURCE", 26)}${pad("TIER", 6)}${"SNAPSHOTS".padStart(9)}  ${pad("EARLIEST", 12)}${pad("LATEST", 12)}${pad("LAST OK", 18)}${pad("HEALTH", 12)}FILE`,
  );
  console.log("-".repeat(130));
  const now = new Date();
  const problems: string[] = [];

  for (const source of sources) {
    const name = `${source.provider.slug}/${source.key}`;

    const [earliest, latest] = await Promise.all([
      prisma.specSnapshot.findFirst({
        where: { sourceId: source.id },
        orderBy: { providerTime: "asc" },
        select: { providerTime: true },
      }),
      prisma.specSnapshot.findFirst({
        where: { sourceId: source.id },
        orderBy: { providerTime: "desc" },
        select: { providerTime: true, opCount: true },
      }),
    ]);

    const health = sourceHealth(source, now);
    const iso = (d: Date | null | undefined) =>
      d ? d.toISOString().slice(0, 10) : "—";

    console.log(
      pad(source.active ? name : `${name} (off)`, 26) +
        pad(source.tier, 6) +
        String(source._count.snapshots).padStart(9) +
        "  " +
        pad(iso(earliest?.providerTime), 12) +
        pad(iso(latest?.providerTime), 12) +
        pad(source.lastSuccessAt ? source.lastSuccessAt.toISOString().slice(0, 16).replace("T", " ") : "—", 18) +
        pad(health.state, 12) +
        (source.tier === "B" ? (source.url ?? "—") : (source.filePath ?? "—")),
    );
    if (health.reason) problems.push(`  ${name}: ${health.reason}`);
  }

  if (problems.length > 0) {
    console.log(`\n${problems.length} source(s) not fetching:\n${problems.join("\n")}`);
  }

  const total = await prisma.specSnapshot.count();
  const distinctOps = await prisma.specSnapshot.aggregate({
    _max: { opCount: true },
  });
  console.log(
    `\n${total} snapshots stored. Largest surface seen: ${distinctOps._max.opCount ?? 0} operations.`,
  );
  console.log(`Blob store: ${blobStoreName()}\n`);
}
