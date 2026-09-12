import { defaultRef, ensureClone, listTree, readAtCommit } from "../acquire/git.js";
import { log } from "../log.js";
import { findProvider } from "../registry.js";

const SPEC_EXT = /\.(json|ya?ml)$/i;
const SPEC_HINT = /(openapi|swagger|spec|api|descriptions?)/i;

/** Peek at the head of a blob rather than parsing megabytes of JSON. */
const MARKER = /"?(openapi|swagger)"?\s*:/;

function human(bytes: number): string {
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * List the files in a provider's repo that actually look like OpenAPI
 * documents, largest first.
 *
 * This is the answer to "I am not certain that path is right". Instead of a
 * TODO in a comment, the uncertainty is a command you run.
 */
export async function discover(slug: string, limit = 40): Promise<void> {
  const provider = findProvider(slug);
  if (!provider) {
    log.error(`unknown provider "${slug}"`);
    return;
  }

  const seen = new Set<string>();

  for (const source of provider.sources) {
    if (seen.has(source.repo)) continue;
    seen.add(source.repo);

    const dir = await ensureClone(source.repo);
    const ref = await defaultRef(dir);
    const tree = await listTree(dir, ref);

    const candidates = tree
      .filter((e) => SPEC_EXT.test(e.path) && SPEC_HINT.test(e.path))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, limit);

    log.info(`${source.repo} @ ${ref} — ${candidates.length} candidate files`);

    for (const entry of candidates) {
      // Cheap confirmation: a real spec declares its version near the top.
      let confirmed = false;
      if (entry.bytes < 64 * 1024 * 1024) {
        try {
          const head = (await readAtCommit(dir, ref, entry.path)).slice(0, 4096);
          confirmed = MARKER.test(head);
        } catch {
          confirmed = false;
        }
      }
      const mark = confirmed ? "✓" : " ";
      console.log(`  ${mark} ${human(entry.bytes).padStart(8)}  ${entry.path}`);
    }

    console.log(
      `\n  ✓ marks files declaring openapi/swagger in the first 4KB.` +
        `\n  Put the one you want into filePathCandidates in registry.ts, then re-run seed.\n`,
    );
  }
}
