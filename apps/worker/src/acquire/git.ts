import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { config, paths } from "../config.js";
import { log } from "../log.js";
import { withRetry } from "../retry.js";

const run = promisify(execFile);

// GitHub's api.github.com.json is tens of megabytes. The default 1MB buffer
// truncates it silently into a parse error that looks like a bad spec.
const MAX_BUFFER = 512 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

export function repoDir(repo: string): string {
  return join(paths.repos, repo.replace("/", "__"));
}

function remoteUrl(repo: string): string {
  // A token only raises the rate limit; these repos are public.
  return config.githubToken
    ? `https://x-access-token:${config.githubToken}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
}

/**
 * Clone once, reuse forever.
 *
 * `--filter=blob:none --no-checkout` is a partial clone: we get the full
 * commit and tree graph (which is all `git log` needs) without downloading
 * every historical version of every file. Blobs are fetched lazily by
 * `git show`, so we only ever pay for the spec files we actually read.
 * On github/rest-api-description that is the difference between a few
 * hundred megabytes and a few gigabytes.
 */
export async function ensureClone(repo: string): Promise<string> {
  const dir = repoDir(repo);

  if (existsSync(join(dir, ".git"))) {
    log.step(`fetching ${repo}`);
    await withRetry(() => git(dir, ["fetch", "--prune", "--quiet", "origin"]));
    return dir;
  }

  await mkdir(paths.repos, { recursive: true });
  log.step(`cloning ${repo} (partial, blobs on demand)`);
  await withRetry(async () => {
    // A clone that died halfway leaves a directory the next attempt would
    // refuse to clone into.
    await rm(dir, { recursive: true, force: true });
    await git(paths.repos, [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--quiet",
      remoteUrl(repo),
      dir,
    ]);
  });
  return dir;
}

export async function defaultRef(dir: string): Promise<string> {
  try {
    const out = await git(dir, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    return out.trim();
  } catch {
    return "origin/HEAD";
  }
}

export async function fileExistsAt(
  dir: string,
  ref: string,
  filePath: string,
): Promise<boolean> {
  try {
    await git(dir, ["cat-file", "-e", `${ref}:${filePath}`]);
    return true;
  } catch {
    return false;
  }
}

export interface TreeEntry {
  path: string;
  bytes: number;
}

/** Every blob at `ref`, with size. Used by `discover` to verify spec paths. */
export async function listTree(dir: string, ref: string): Promise<TreeEntry[]> {
  const out = await git(dir, ["ls-tree", "-r", "--long", ref]);
  const entries: TreeEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    // <mode> <type> <sha> <size>\t<path>
    const [meta, path] = line.split("\t");
    if (!meta || !path) continue;
    const size = Number(meta.trim().split(/\s+/)[3]);
    entries.push({ path, bytes: Number.isFinite(size) ? size : 0 });
  }
  return entries;
}

export interface Revision {
  sha: string;
  /** Committer date. This, not fetch time, is when the provider changed it. */
  date: Date;
  subject: string;
  /**
   * The file's path AT THIS COMMIT, which is not always the path today.
   * Carrying it is what makes rename-crossing history readable.
   */
  path: string;
}

const COMMIT_LINE = /^([0-9a-f]{40})\t(\S+)\t(.*)$/;

/**
 * Every commit that touched this file, oldest first.
 *
 * `--follow` keeps the trail across renames, which providers do more often
 * than you would hope — a spec moving from `spec.json` to `openapi/spec3.json`
 * would otherwise look like the API was deleted and a new one created.
 *
 * `--name-only` is not decoration: after a rename, `git show <sha>:<today's
 * path>` fails for commits older than the move, so each revision has to
 * remember the path it was written at.
 *
 * DO NOT add `--reverse` here. Git's `--follow` is a rename-detection hack
 * layered on history simplification, and the two interact badly: on
 * twilio/twilio-oai, whose spec has moved four times, `--follow --reverse`
 * silently returns 1 revision where `--follow` alone returns 168. It fails
 * quietly and looks like a provider that never changes anything. We take
 * git's newest-first order, which is correct, and reverse in JS.
 */
export async function fileHistory(
  dir: string,
  ref: string,
  filePath: string,
): Promise<Revision[]> {
  const out = await git(dir, [
    "log",
    ref,
    "--follow",
    "--name-only",
    "--format=%H%x09%cI%x09%s",
    "--",
    filePath,
  ]);

  const revisions: Revision[] = [];
  let pending: Omit<Revision, "path"> | null = null;

  const flush = (path: string) => {
    if (pending) revisions.push({ ...pending, path });
    pending = null;
  };

  for (const rawLine of out.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const match = COMMIT_LINE.exec(line);
    if (match) {
      // A commit with no name line (possible for merges) falls back to the
      // path we asked for rather than being dropped.
      if (pending) flush(filePath);
      pending = {
        sha: match[1]!,
        date: new Date(match[2]!),
        subject: match[3]!,
      };
      continue;
    }

    if (pending) flush(line);
  }
  if (pending) flush(filePath);

  // git emits newest-first; callers want to walk forward through time.
  return revisions.reverse();
}

/** Read the file as it existed at a commit. Triggers a lazy blob fetch. */
export async function readAtCommit(
  dir: string,
  sha: string,
  filePath: string,
): Promise<string> {
  return git(dir, ["show", `${sha}:${filePath}`]);
}
