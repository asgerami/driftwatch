import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildQueries, findCandidates, group, type CodeHit, type RepoInfo } from "./candidates.js";
import { loadChange } from "./change.js";
import { FIXTURES } from "./eval.js";
import { loadSpec } from "./spec.js";
import { computeTargets } from "./targets.js";

async function targetsFor(name: string) {
  const dir = join(FIXTURES, name);
  const change = await loadChange(join(dir, "change.json"));
  return { change, targets: computeTargets(change, await loadSpec(change, join(dir, "spec.json"))) };
}

describe("candidates", () => {
  it("searches for the changed field, the SDK method and the path, each anchored on the provider", async () => {
    const { change, targets } = await targetsFor("plaid-protect");
    expect(buildQueries(change, targets).map((q) => [q.q, q.weight])).toEqual([
      ['"protect_session_id" "protectEventSend" plaid', 3],
      ['"protect_session_id" "protect/event/send" plaid', 3],
      ['"protect_session_id" plaid', 2],
      ['"protectEventSend" plaid', 1],
      ['"protect/event/send" plaid', 1],
    ]);
  });

  it("uses the longest literal run of a templated path, and skips generic names", async () => {
    const { change, targets } = await targetsFor("cloudflare-hyperdrive");
    const terms = buildQueries(change, targets).map((q) => q.term);
    expect(terms).toContain("hyperdrive/configs");
    expect(terms).not.toContain("integration"); // one plain word: read off everything
  });

  it("drops the provider's own repos, forks, tests, fixtures, non-source files and vendored code", async () => {
    const { change } = await targetsFor("plaid-protect");
    const hit = (repo: string, path: string, fork = false): CodeHit => ({ repo, path, fork });
    const grouped = group(change, [
      {
        query: { q: "a", term: "protect_session_id", weight: 2 },
        hits: [
          hit("plaid/plaid-node", "src/api.ts"),
          hit("acme/app", "src/protect.ts"),
          hit("acme/app", "node_modules/plaid/dist/api.js"),
          hit("acme/app", "types/plaid.d.ts"),
          hit("bob/app", "CHANGELOG.md"),
          hit("carol/app", "src/x.ts", true),
          hit("erin/app", "test/protect.test.ts"),
          hit("asgerami/driftwatch", "apps/fixer/fixtures/plaid-protect/repo/src/protect.ts"),
        ],
      },
      { query: { q: "b", term: "protectEventSend", weight: 1 }, hits: [hit("acme/app", "src/protect.ts"), hit("dave/web", "lib/fraud.js")] },
    ]);
    expect([...grouped.keys()]).toEqual(["acme/app", "dave/web"]);
    expect([...grouped.get("acme/app")!.terms]).toEqual(["protect_session_id", "protectEventSend"]);
  });

  it("ranks the field beside a call first, then by recent pushes, and drops archived repos", async () => {
    const { change, targets } = await targetsFor("plaid-protect");
    const hits: Record<string, string[]> = {
      '"protect_session_id" "protectEventSend" plaid': ["pair/app"],
      '"protect_session_id" plaid': ["old/app", "new/app", "gone/app"],
      '"protectEventSend" plaid': ["calls/app"],
    };
    const search = async (q: string): Promise<CodeHit[]> => (hits[q] ?? []).map((repo) => ({ repo, path: "src/a.ts", fork: false }));
    const meta: Record<string, RepoInfo> = {
      "pair/app": { archived: false, fork: false, stars: 0, pushedAt: "2025-01-01T00:00:00Z" },
      "old/app": { archived: false, fork: false, stars: 900, pushedAt: "2023-01-01T00:00:00Z" },
      "new/app": { archived: false, fork: false, stars: 3, pushedAt: "2026-09-01T00:00:00Z" },
      "gone/app": { archived: true, fork: false, stars: 50, pushedAt: "2026-09-02T00:00:00Z" },
      "calls/app": { archived: false, fork: false, stars: 5000, pushedAt: "2026-10-01T00:00:00Z" },
    };
    const { candidates } = await findCandidates(change, targets, 10, search, async (r) => meta[r], 0);
    expect(candidates.map((c) => [c.repo, c.score])).toEqual([
      ["pair/app", 3],
      ["new/app", 2],
      ["old/app", 2],
      ["calls/app", 1],
    ]);
  });
});
