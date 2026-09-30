import { prisma } from "../db.js";
import { log } from "../log.js";
import { REGISTRY, sourceTier } from "../registry.js";
import { defaultRef, ensureClone, fileExistsAt } from "../acquire/git.js";

/**
 * Upsert the registry into Postgres, resolving each source's real file path
 * against the cloned repo (tier A) or recording its hosted URL (tier B).
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
        category: provider.category,
        docsUrl: provider.docsUrl,
      },
      update: { name: provider.name, category: provider.category, docsUrl: provider.docsUrl },
    });

    for (const source of provider.sources) {
      const tier = sourceTier(source);

      if (tier === "B") {
        if (!source.url) {
          unresolved++;
          log.warn(`${provider.slug}/${source.key}: tier B source is missing url`);
          continue;
        }
        await prisma.specSource.upsert({
          where: { providerId_key: { providerId: row.id, key: source.key } },
          create: {
            providerId: row.id,
            key: source.key,
            label: source.label,
            tier: "B",
            url: source.url,
            repo: null,
            ref: null,
            filePath: null,
            active: true,
            volatilePointers: source.volatilePointers ?? [],
          },
          update: {
            label: source.label,
            tier: "B",
            url: source.url,
            repo: null,
            ref: null,
            filePath: null,
            active: true,
            volatilePointers: source.volatilePointers ?? [],
          },
        });
        resolved++;
        log.ok(`${provider.slug}/${source.key} → ${source.url}`);
        continue;
      }

      if (!source.repo || !source.filePathCandidates?.length) {
        unresolved++;
        log.warn(
          `${provider.slug}/${source.key}: tier A source needs repo and filePathCandidates`,
        );
        continue;
      }

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

  // A source dropped from the registry stops polling. Its history stays, so
  // putting it back is a registry change, not a re-backfill.
  const registered = new Set(
    REGISTRY.flatMap((provider) => provider.sources.map((source) => `${provider.slug}/${source.key}`)),
  );
  const stored = await prisma.specSource.findMany({
    where: { active: true },
    select: { id: true, key: true, provider: { select: { slug: true } } },
  });
  for (const source of stored) {
    const name = `${source.provider.slug}/${source.key}`;
    if (registered.has(name)) continue;
    await prisma.specSource.update({ where: { id: source.id }, data: { active: false } });
    log.warn(`${name}: no longer in the registry, deactivated`);
  }

  log.info(`seed complete — ${resolved} resolved, ${unresolved} unresolved`);
}
