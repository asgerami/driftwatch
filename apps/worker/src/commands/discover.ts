import { defaultRef, ensureClone, listTree, readAtCommit } from "../acquire/git.js";
import { fetchSpecUrl } from "../acquire/http.js";
import { log } from "../log.js";
import { findProvider, sourceTier } from "../registry.js";

const SPEC_EXT = /\.(json|ya?ml)$/i;

/**
 * A spec declares its version as a top-level key. Searched through the whole
 * text, not just its head: generators that sort keys put "swagger" after
 * megabytes of "definitions" (Slack's web API spec). Anchored to a line
 * start for YAML; in JSON, anywhere, since minified JSON has one line.
 */
const MARKER = /(^|[{,]\s*)"?(openapi|swagger)"?\s*:\s*["']?[23]\./m;

/**
 * Every content check in a blobless clone is its own fetch, so a repo with
 * thousands of JSON files (Datadog's client) would take the whole job. Check
 * the largest files only: a real spec is rarely small.
 */
const CONTENT_CHECKS = 60;

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
    const confirmed = MARKER.test(fetched.text);
    const mark = confirmed ? "✓" : " ";
    console.log(
      `\n${name}  hosted\n` +
        `  ${mark} ${human(Buffer.byteLength(fetched.text, "utf8")).padStart(8)}  ${url}`,
    );
    if (!confirmed) {
      log.warn("  body does not declare a top-level openapi/swagger version");
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

  // No filename filter: Plaid's spec is `2020-09-14.yml`, Resend's has no
  // "openapi" in its name either. Content decides.
  const files = tree.filter((e) => SPEC_EXT.test(e.path)).sort((a, b) => b.bytes - a.bytes);
  const checked = files.slice(0, CONTENT_CHECKS);

  const confirmed: typeof checked = [];
  for (const entry of checked) {
    if (entry.bytes > 64 * 1024 * 1024) continue;
    try {
      if (MARKER.test(await readAtCommit(dir, ref, entry.path))) confirmed.push(entry);
    } catch {
      // unreadable: not a candidate
    }
  }

  log.info(
    `${repo} @ ${ref} — ${confirmed.length} spec file(s) among the ${checked.length} largest of ${files.length} JSON/YAML files`,
  );
  for (const entry of confirmed.slice(0, limit)) {
    console.log(`  ✓ ${human(entry.bytes).padStart(8)}  ${entry.path}`);
  }

  console.log(
    `\n  ✓ files declare a top-level openapi or swagger version.` +
      `\n  Put the one you want into filePathCandidates in registry.ts, then re-run seed.\n`,
  );
}
