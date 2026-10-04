import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadChange } from "./change.js";
import type { Finding } from "./findings.js";
import { sourceFiles } from "./scan/files.js";
import { scan } from "./scan/index.js";
import { loadSpec } from "./spec.js";

/**
 * Scan precision and recall against the fixture repos (M4 acceptance).
 *
 * Each fixture is a small consumer repo plus the change and spec it is
 * scanned for. Expected findings are marked in the source itself, on the
 * line the finding should point at: `// driftwatch-expect: <kind>`. Every
 * other line is an expected non-finding, which is what precision measures.
 */

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const MARKER = /driftwatch-expect:\s*(http|sdk|field)/g;

export interface Score {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export interface FixtureResult {
  name: string;
  byKind: Record<string, Score>;
  missed: string[];
  unexpected: string[];
}

function score(tp: number, fp: number, fn: number): Score {
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

export async function evaluateFixture(name: string): Promise<FixtureResult> {
  const dir = join(FIXTURES, name);
  const repo = join(dir, "repo");
  const change = await loadChange(join(dir, "change.json"));
  const spec = await loadSpec(change, join(dir, "spec.json"));
  const { findings } = await scan(change, spec, repo);

  const expected = new Set<string>();
  for (const file of await sourceFiles(repo)) {
    file.text.split("\n").forEach((line, i) => {
      for (const match of line.matchAll(MARKER)) expected.add(`${match[1]}|${file.path}:${i + 1}`);
    });
  }
  const found = new Set(findings.map((f: Finding) => `${f.kind}|${f.file}:${f.line}`));

  const byKind: Record<string, Score> = {};
  for (const kind of ["http", "sdk", "field"]) {
    const e = [...expected].filter((k) => k.startsWith(`${kind}|`));
    const f = [...found].filter((k) => k.startsWith(`${kind}|`));
    if (e.length === 0 && f.length === 0) continue;
    const tp = f.filter((k) => expected.has(k)).length;
    byKind[kind] = score(tp, f.length - tp, e.length - tp);
  }
  return {
    name,
    byKind,
    missed: [...expected].filter((k) => !found.has(k)),
    unexpected: [...found].filter((k) => !expected.has(k)),
  };
}

export async function evaluateAll(): Promise<{ fixtures: FixtureResult[]; total: Record<string, Score> }> {
  const names = (await readdir(FIXTURES, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const fixtures = await Promise.all(names.map(evaluateFixture));
  const total: Record<string, Score> = {};
  for (const kind of ["http", "sdk", "field"]) {
    const scores = fixtures.map((f) => f.byKind[kind]).filter((s): s is Score => s !== undefined);
    if (scores.length === 0) continue;
    const sum = (key: "truePositives" | "falsePositives" | "falseNegatives") => scores.reduce((a, s) => a + s[key], 0);
    total[kind] = score(sum("truePositives"), sum("falsePositives"), sum("falseNegatives"));
  }
  return { fixtures, total };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

// `pnpm --filter @driftwatch/fixer eval` prints the report.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { fixtures, total } = await evaluateAll();
  for (const fixture of fixtures) {
    console.log(fixture.name);
    for (const [kind, s] of Object.entries(fixture.byKind)) {
      console.log(`  ${kind.padEnd(5)} precision ${pct(s.precision).padStart(4)}  recall ${pct(s.recall).padStart(4)}  (${s.truePositives} found, ${s.falsePositives} wrong, ${s.falseNegatives} missed)`);
    }
    for (const m of fixture.missed) console.log(`  MISSED      ${m}`);
    for (const u of fixture.unexpected) console.log(`  UNEXPECTED  ${u}`);
  }
  console.log("\ntotal");
  for (const [kind, s] of Object.entries(total)) {
    console.log(`  ${kind.padEnd(5)} precision ${pct(s.precision).padStart(4)}  recall ${pct(s.recall).padStart(4)}  (${s.truePositives} found, ${s.falsePositives} wrong, ${s.falseNegatives} missed)`);
  }
}
