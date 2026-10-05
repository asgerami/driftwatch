import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ChangeDocument } from "@driftwatch/core";

import { SDK_PACKAGES, signaturesFor } from "./scan/sdk.js";
import type { Targets } from "./targets.js";

/**
 * Public repos worth scanning for a change: GitHub code search for what the
 * scan would match, ranked. It only lists. Each candidate still needs a scan
 * and a person reading it before any PR (brief, M4: a handful per change).
 *
 * Queries are few and specific, each anchored on the provider's name, because
 * code search allows ten a minute and a bare `"create"` matches the world.
 * Leads are a distinctive changed field ("protect_session_id"), an SDK method
 * the change reaches ("protectEventSend"), and the longest literal run of an
 * affected path ("hyperdrive/configs"); a field and a call in one file is the
 * strongest lead, since that is code a fix would touch.
 */

const MAX_QUERIES = 6;
/** SDKs generated from operationIds; the rest name methods by the path's REST shape. */
const OPERATION_ID_SDKS = new Set(["github", "plaid"]);

/**
 * A name specific enough to search for: snake_case or camelCase. A long plain
 * word ("integration") reads as distinctive to the scan, which only looks
 * inside traced values, but matches half of GitHub.
 */
function searchable(name: string): boolean {
  return name.includes("_") || /[a-z][A-Z]/.test(name);
}
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = /(^|\/)(node_modules|dist|build|vendor|\.next|out|coverage)\//;
/** Tests, fixtures and mocks are not where a fix goes (and Driftwatch's own fixtures match everything). */
const NOT_CALLERS = /(^|\/)(fixtures?|__fixtures__|__tests__|__mocks__|mocks?|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export interface Query {
  q: string;
  /** What it looks for, for the report. */
  term: string;
  /** 3: the changed field beside an affected call; 2: the field; 1: a call. */
  weight: number;
}

/** The literal run of path segments most likely to appear verbatim in code. */
function pathTerm(path: string): string | undefined {
  const runs: string[][] = [[]];
  for (const s of path.split("/").filter(Boolean)) {
    if (/^\{.+\}$/.test(s)) runs.push([]);
    else runs[runs.length - 1]!.push(s);
  }
  const best = runs.filter((r) => r.length >= 2 || (r.length === 1 && searchable(r[0]!))).sort((a, b) => b.length - a.length)[0];
  return best?.join("/");
}

export function buildQueries(change: ChangeDocument, targets: Targets): Query[] {
  const anchor = change.provider.slug;
  const fields: string[] = [];
  const calls: string[] = [];
  const add = (list: string[], t: string | undefined) => {
    if (t && !list.includes(t)) list.push(t);
  };

  for (const f of [...targets.responseFields, ...targets.requestFields]) {
    const leaf = f.path[f.path.length - 1]!;
    if (searchable(leaf)) add(fields, leaf);
  }
  if (SDK_PACKAGES[anchor]) {
    for (const op of targets.operations.slice(0, 3)) {
      const high = signaturesFor(op).filter((s) => s.confidence === "high");
      const sig = OPERATION_ID_SDKS.has(anchor) ? high[0] : high.find((s) => s.namespaces !== null && s.namespaces.length > 0);
      if (!sig) continue;
      // The last two namespaces and the method: `hyperdrive.configs.create`,
      // not the account segment Cloudflare's SDK takes as a parameter.
      if (sig.namespaces === null) add(calls, searchable(sig.method) ? sig.method : undefined);
      else add(calls, [...sig.namespaces.slice(-2), sig.method].join("."));
    }
  }
  for (const op of targets.operations.slice(0, 3)) add(calls, pathTerm(op.path));

  const anchored = (terms: string[]) => {
    const quoted = terms.map((t) => `"${t}"`).join(" ");
    return terms.some((t) => t.toLowerCase().includes(anchor)) ? quoted : `${quoted} ${anchor}`;
  };
  // The repos worth a PR send or read the changed field through an affected
  // call, so the two together come first; either alone is a weaker lead.
  const queries: Query[] = [];
  for (const f of fields.slice(0, 2)) {
    for (const c of calls.slice(0, 2)) queries.push({ term: `${f} + ${c}`, q: anchored([f, c]), weight: 3 });
  }
  for (const f of fields.slice(0, 2)) queries.push({ term: f, q: anchored([f]), weight: 2 });
  for (const c of calls) queries.push({ term: c, q: anchored([c]), weight: 1 });
  return queries.slice(0, MAX_QUERIES);
}

export interface CodeHit {
  repo: string;
  path: string;
  fork: boolean;
}

export interface RepoInfo {
  archived: boolean;
  fork: boolean;
  stars: number;
  pushedAt: string;
}

export interface Candidate {
  repo: string;
  /** The weights of the distinct queries it matched, summed. */
  score: number;
  stars: number;
  pushedAt: string;
  terms: string[];
  files: string[];
}

/** Repos the provider owns: its SDKs and spec repos match every query. */
function providerOwners(change: ChangeDocument): Set<string> {
  const owners = new Set([change.provider.slug.toLowerCase()]);
  if (change.spec.kind === "git") owners.add(change.spec.repo.split("/")[0]!.toLowerCase());
  return owners;
}

/** Hits grouped by repo, the provider's own and forks dropped, most-matched first. */
type Grouped = Map<string, { terms: Set<string>; files: Set<string>; score: number }>;

export function group(change: ChangeDocument, results: { query: Query; hits: CodeHit[] }[]): Grouped {
  const owners = providerOwners(change);
  const byRepo: Grouped = new Map();
  for (const { query, hits } of results) {
    for (const hit of hits) {
      if (hit.fork || !SOURCE.test(hit.path) || hit.path.endsWith(".d.ts") || SKIPPED_DIRS.test(hit.path) || NOT_CALLERS.test(hit.path)) continue;
      if (owners.has(hit.repo.split("/")[0]!.toLowerCase())) continue;
      const entry = byRepo.get(hit.repo) ?? { terms: new Set<string>(), files: new Set<string>(), score: 0 };
      if (!entry.terms.has(query.term)) entry.score += query.weight;
      entry.terms.add(query.term);
      entry.files.add(hit.path);
      byRepo.set(hit.repo, entry);
    }
  }
  return new Map([...byRepo].sort((a, b) => b[1].score - a[1].score || b[1].files.size - a[1].files.size));
}

/** Final order: archived repos out (they take no PRs), then by score, then most recently pushed. */
export function rank(grouped: Grouped, info: Map<string, RepoInfo>): Candidate[] {
  const out: Candidate[] = [];
  for (const [repo, g] of grouped) {
    const meta = info.get(repo);
    if (!meta || meta.archived || meta.fork) continue;
    out.push({ repo, score: g.score, stars: meta.stars, pushedAt: meta.pushedAt, terms: [...g.terms], files: [...g.files].sort() });
  }
  return out.sort((a, b) => b.score - a.score || b.pushedAt.localeCompare(a.pushedAt));
}

const exec = promisify(execFile);

async function gh<T>(args: string[]): Promise<T> {
  const { stdout } = await exec("gh", ["api", ...args], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One code search, retried once after a minute if the rate limit says so. */
export async function searchCode(q: string): Promise<CodeHit[]> {
  type Item = { path: string; repository: { full_name: string; fork: boolean } };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await gh<{ items: Item[] }>(["-X", "GET", "search/code", "-f", `q=${q}`, "-f", "per_page=100"]);
      return res.items.map((i) => ({ repo: i.repository.full_name, path: i.path, fork: i.repository.fork }));
    } catch (err) {
      if (attempt === 0 && /rate limit|403|429/i.test(String((err as { stderr?: string }).stderr ?? err))) {
        await sleep(61_000);
        continue;
      }
      throw new Error(`GitHub code search failed for ${q}: ${String((err as { stderr?: string }).stderr ?? err).trim()}`);
    }
  }
}

export async function repoInfo(repo: string): Promise<RepoInfo | undefined> {
  try {
    const r = await gh<{ archived: boolean; fork: boolean; stargazers_count: number; pushed_at: string }>([`repos/${repo}`]);
    return { archived: r.archived, fork: r.fork, stars: r.stargazers_count, pushedAt: r.pushed_at };
  } catch {
    return undefined;
  }
}

export async function findCandidates(
  change: ChangeDocument,
  targets: Targets,
  limit: number,
  search = searchCode,
  info = repoInfo,
  pause = 7_000,
): Promise<{ queries: Query[]; candidates: Candidate[] }> {
  const queries = buildQueries(change, targets);
  const results: { query: Query; hits: CodeHit[] }[] = [];
  for (const [i, query] of queries.entries()) {
    if (i > 0) await sleep(pause); // code search: ten requests a minute
    results.push({ query, hits: await search(query.q) });
  }
  const grouped = group(change, results);
  const metas = new Map<string, RepoInfo>();
  for (const repo of [...grouped.keys()].slice(0, limit * 2)) {
    const meta = await info(repo);
    if (meta) metas.set(repo, meta);
  }
  return { queries, candidates: rank(grouped, metas).slice(0, limit) };
}
