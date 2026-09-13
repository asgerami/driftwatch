import { normalizeSpec } from "@driftwatch/core";

import {
  defaultRef,
  ensureClone,
  fileExistsAt,
  fileHistory,
  listTree,
  readAtCommit,
} from "../acquire/git.js";
import { fetchSpecUrl } from "../acquire/http.js";
import { log } from "../log.js";
import {
  REGISTRY,
  findProvider,
  sourceTier,
  type RegistryProvider,
  type RegistrySource,
} from "../registry.js";

/**
 * End-to-end check of acquisition and normalization, with no database.
 *
 * For each git source: resolve the spec path, walk history, read HEAD,
 * normalize it, and confirm the hash is stable across two runs. For a hosted
 * URL, fetch once and check the same hash stability. Run it after touching
 * the registry or the normalizer, and periodically — providers move their
 * spec files, and this is what catches that before the feed goes quiet.
 */
export async function verify(slug?: string): Promise<void> {
  const providers: RegistryProvider[] = slug
    ? ([findProvider(slug)].filter(Boolean) as RegistryProvider[])
    : REGISTRY;

  if (providers.length === 0) {
    log.error(`unknown provider "${slug}"`);
    return;
  }

  let failures = 0;
  let totalRevisions = 0;

  for (const provider of providers) {
    for (const source of provider.sources) {
      const name = `${provider.slug}/${source.key}`;

      if (sourceTier(source) === "B") {
        const failed = await verifyHosted(name, source);
        if (failed) failures++;
        continue;
      }

      if (!source.repo || !source.filePathCandidates?.length) {
        failures++;
        log.error(`${name}: tier A source needs repo and filePathCandidates`);
        continue;
      }

      console.log(`\n${name}  (${source.repo})`);

      try {
        const dir = await ensureClone(source.repo);
        const ref = await defaultRef(dir);

        let resolved: string | null = null;
        for (const candidate of source.filePathCandidates) {
          if (await fileExistsAt(dir, ref, candidate)) {
            resolved = candidate;
            break;
          }
        }

        if (!resolved) {
          failures++;
          log.error(`  no candidate path exists at ${ref}`);
          const tree = await listTree(dir, ref);
          const guesses = tree
            .filter((e) => /\.(json|ya?ml)$/i.test(e.path) && /(openapi|swagger|spec)/i.test(e.path))
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 5);
          for (const guess of guesses) {
            console.log(`    ${(guess.bytes / 1024).toFixed(0).padStart(7)} KB  ${guess.path}`);
          }
          continue;
        }

        const history = await fileHistory(dir, ref, resolved);
        if (history.length === 0) {
          failures++;
          log.error(`  ${resolved} resolved but has no history`);
          continue;
        }

        totalRevisions += history.length;

        const first = history[0]!;
        const head = history.at(-1)!;
        console.log(
          `  ${history.length} revisions  ${first.date.toISOString().slice(0, 10)} → ${head.date.toISOString().slice(0, 10)}`,
        );

        const renames = new Set(history.map((r) => r.path));
        if (renames.size > 1) {
          console.log(`  ${renames.size} historical paths: ${[...renames].join(", ")}`);
        }

        const text = await readAtCommit(dir, head.sha, head.path);
        const options = { volatilePointers: source.volatilePointers ?? [] };

        const started = Date.now();
        const normalized = await normalizeSpec(text, options);
        const elapsed = Date.now() - started;

        console.log(
          `  ${(text.length / 1_048_576).toFixed(1)} MB → OAS ${normalized.oasVersion}, ` +
            `${normalized.stats.pathCount} paths / ${normalized.stats.opCount} ops / ` +
            `${normalized.stats.schemaCount} schemas in ${elapsed}ms`,
        );

        // A hash that is not reproducible makes every diff meaningless.
        const again = await normalizeSpec(text, options);
        if (again.contentHash !== normalized.contentHash) {
          failures++;
          log.error("  normalization is NOT deterministic");
        } else {
          log.ok(`  ${normalized.contentHash.slice(0, 16)}… stable`);
        }

        for (const warning of normalized.warnings) log.warn(`  ${warning}`);
      } catch (err) {
        failures++;
        log.error(`  ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }

  console.log(
    `\n${totalRevisions} revisions available to backfill across ${providers.length} provider(s).`,
  );
  if (failures > 0) {
    log.error(`${failures} source(s) failed verification`);
    process.exitCode = 1;
  } else {
    log.ok("all sources verified");
  }
}

async function verifyHosted(name: string, source: RegistrySource): Promise<boolean> {
  if (!source.url) {
    log.error(`${name}: tier B source is missing url`);
    return true;
  }

  console.log(`\n${name}  (${source.url})`);
  try {
    const fetched = await fetchSpecUrl(source.url);
    const options = { volatilePointers: source.volatilePointers ?? [] };
    const started = Date.now();
    const normalized = await normalizeSpec(fetched.text, options);
    const elapsed = Date.now() - started;

    console.log(
      `  hosted  Last-Modified ${fetched.providerTime.toISOString().slice(0, 10)}  ` +
        `${(fetched.text.length / 1_048_576).toFixed(1)} MB → OAS ${normalized.oasVersion}, ` +
        `${normalized.stats.pathCount} paths / ${normalized.stats.opCount} ops / ` +
        `${normalized.stats.schemaCount} schemas in ${elapsed}ms`,
    );

    const again = await normalizeSpec(fetched.text, options);
    if (again.contentHash !== normalized.contentHash) {
      log.error("  normalization is NOT deterministic");
      return true;
    }
    log.ok(`  ${normalized.contentHash.slice(0, 16)}… stable`);
    for (const warning of normalized.warnings) log.warn(`  ${warning}`);
    return false;
  } catch (err) {
    log.error(`  ${(err as Error).message.split("\n")[0]}`);
    return true;
  }
}
