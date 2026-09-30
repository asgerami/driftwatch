import { defaultRef, ensureClone, listTree, readAtCommit } from "../acquire/git.js";
import { fetchSpecUrl } from "../acquire/http.js";
import { log } from "../log.js";
import { findProvider, sourceTier } from "../registry.js";

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
 * documents, largest first. For a hosted source, fetch the URL and confirm
 * it declares openapi/swagger.
 *
 * This is the answer to "I am not certain that path is right". Instead of a
 * TODO in a comment, the uncertainty is a command you run.
 */
export async function discover(target: string, limit = 40): Promise<void> {
  // A candidate not yet in the registry: "owner/repo" or a hosted URL.
  if (/^https?:\/\//.test(target)) {
    await discoverUrl(target, target);
    return;
  }
  if (target.includes("/")) {
    await discoverRepo(target, limit);
    return;
  }

  const provider = findProvider(target);
  if (!provider) {
    log.error(`unknown provider "${target}"; pass owner/repo or a URL to explore a candidate`);
    return;
  }

  const seen = new Set<string>();
  for (const source of provider.sources) {
    if (sourceTier(source) === "B") {
      if (!source.url) {
        log.error(`${provider.slug}/${source.key}: tier B source is missing url`);
        continue;
      }
      await discoverUrl(`${provider.slug}/${source.key}`, source.url);
      continue;
    }
    if (!source.repo) {
      log.error(`${provider.slug}/${source.key}: missing repo`);
      continue;
    }
    if (seen.has(source.repo)) continue;
    seen.add(source.repo);
    await discoverRepo(source.repo, limit);
  }
}

async function discoverUrl(name: string, url: string): Promise<void> {
  try {
    const fetched = await fetchSpecUrl(url);
    const confirmed = MARKER.test(fetched.text.slice(0, 4096));
    const mark = confirmed ? "✓" : " ";
    console.log(
      `\n${name}  hosted\n` +
        `  ${mark} ${human(Buffer.byteLength(fetched.text, "utf8")).padStart(8)}  ${url}`,
    );
    if (!confirmed) {
      log.warn("  body does not declare openapi/swagger in the first 4KB");
    }
  } catch (err) {
    log.error(`${name}: ${(err as Error).message.split("\n")[0]}`);
  }
}

async function discoverRepo(repo: string, limit: number): Promise<void> {
  let dir: string;
  try {
    dir = await ensureClone(repo);
  } catch (err) {
    log.error(`${repo}: ${(err as Error).message.split("\n")[0]}`);
    return;
  }
  const ref = await defaultRef(dir);
  const tree = await listTree(dir, ref);

  const candidates = tree
    .filter((e) => SPEC_EXT.test(e.path) && SPEC_HINT.test(e.path))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);

  log.info(`${repo} @ ${ref} — ${candidates.length} candidate files`);

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
