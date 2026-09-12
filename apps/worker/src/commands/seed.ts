import { prisma } from "../db.js";
import { log } from "../log.js";
import { REGISTRY } from "../registry.js";
import { defaultRef, ensureClone, fileExistsAt } from "../acquire/git.js";

/**
 * Upsert the registry into Postgres, resolving each source's real file path
 * against the cloned repo.
 *
 * The candidate list exists because published spec paths are not documented
 * anywhere and do move. Resolving here means a wrong guess surfaces as a
 * loud seed failure with a `discover` hint, not as a source that quietly
 * produces zero snapshots forever.
 */
export async function seed(): Promise<void> {
  let resolved = 0;
  let unresolved = 0;

  for (const provider of REGISTRY) {
    const row = await prisma.provider.upsert({
      where: { slug: provider.slug },
      create: {
        slug: provider.slug,
        name: provider.name,
        docsUrl: provider.docsUrl,
      },
      update: { name: provider.name, docsUrl: provider.docsUrl },
    });

    for (const source of provider.sources) {
      const dir = await ensureClone(source.repo);
      const ref = await defaultRef(dir);

      let filePath: string | null = null;
      for (const candidate of source.filePathCandidates) {
        if (await fileExistsAt(dir, ref, candidate)) {
          filePath = candidate;
          break;
        }
      }

      const active = filePath !== null;
      if (active) {
        resolved++;
        log.ok(`${provider.slug}/${source.key} → ${filePath}`);
      } else {
        unresolved++;
        log.warn(
          `${provider.slug}/${source.key}: none of ` +
            `[${source.filePathCandidates.join(", ")}] exist at ${ref}. ` +
            `Marked inactive. Run: pnpm w discover ${provider.slug}`,
        );
      }

      await prisma.specSource.upsert({
        where: { providerId_key: { providerId: row.id, key: source.key } },
        create: {
          providerId: row.id,
          key: source.key,
          label: source.label,
          tier: "A",
          repo: source.repo,
          ref,
          filePath,
          active,
          volatilePointers: source.volatilePointers ?? [],
        },
        update: {
          label: source.label,
          repo: source.repo,
          ref,
          // Only widen: never flip an already-working source off because a
          // transient fetch failure made a path look missing.
          ...(active ? { filePath, active: true } : {}),
          volatilePointers: source.volatilePointers ?? [],
        },
      });
    }
  }

  log.info(`seed complete — ${resolved} resolved, ${unresolved} unresolved`);
}
