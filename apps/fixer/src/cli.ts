#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Command } from "commander";

import { findCandidates } from "./candidates.js";
import { loadChange } from "./change.js";
import type { Finding } from "./findings.js";
import { fix, type FixResult } from "./fix/index.js";
import { prBody, type FixReport } from "./prbody.js";
import { runTests, type TestRun } from "./fix/tests.js";
import { scan } from "./scan/index.js";
import { loadSpec, loadSpecBefore } from "./spec.js";
import { computeTargets } from "./targets.js";

/**
 * driftwatch: the concierge fixer (brief, M4). Finds where a repo calls an API
 * a published change affects. It never opens pull requests: a person reviews
 * every finding and opens any PR themselves.
 */

/**
 * Paths are the caller's: `pnpm --filter @driftwatch/fixer cli` runs inside
 * apps/fixer, and pnpm passes the directory it was run from as INIT_CWD.
 */
const fromCaller = (path: string) => resolve(process.env["INIT_CWD"] ?? process.cwd(), path);
const changeRef = (ref: string) => (/^https?:\/\//.test(ref) || !ref.endsWith(".json") ? ref : fromCaller(ref));
const maybe = (path?: string) => (path ? fromCaller(path) : undefined);

const program = new Command();
program.name("driftwatch").description("Find code a published API change breaks").version("0.1.0");

program
  .command("scan")
  .requiredOption("--change <id|url|file>", "a change id from driftwatch.et/changes/<id>, its JSON URL, or a JSON file")
  .requiredOption("--repo <path>", "the repository to scan")
  .option("--spec <file>", "use this spec file instead of fetching the provider's")
  .option("--json", "print findings as JSON")
  .action(async (opts: { change: string; repo: string; spec?: string; json?: boolean }) => {
    const change = await loadChange(changeRef(opts.change));
    const spec = await loadSpec(change, maybe(opts.spec));
    const result = await scan(change, spec, fromCaller(opts.repo));
    if (opts.json) {
      console.log(JSON.stringify(result.findings, null, 2));
      return;
    }
    console.log(report(result.findings, result.filesScanned, change.url, result.targets.operations.length));
  });

program
  .command("fix")
  .description("patch the mechanical cases: renamed fields, removed optional fields, newly required fields with a documented value")
  .requiredOption("--change <id|url|file>", "a change id from driftwatch.et/changes/<id>, its JSON URL, or a JSON file")
  .requiredOption("--repo <path>", "the repository to patch")
  .option("--spec <file>", "the spec after the change, instead of fetching it")
  .option("--spec-before <file>", "the spec before the change, instead of fetching it")
  .option("--out <file>", "write the unified diff here (apply with git apply)")
  .option("--write", "write the patched files into the repo, then run its tests; a failing run restores them")
  .option("--json", "print the result as JSON (input for pr-body)")
  .action(
    async (opts: { change: string; repo: string; spec?: string; specBefore?: string; out?: string; write?: boolean; json?: boolean }) => {
      const repo = fromCaller(opts.repo);
      const change = await loadChange(changeRef(opts.change));
      const [after, before] = await Promise.all([loadSpec(change, maybe(opts.spec)), loadSpecBefore(change, maybe(opts.specBefore))]);
      const result = await fix(change, after, before, repo);
      if (opts.out) await writeFile(fromCaller(opts.out), result.diff);

      let tests: TestRun | undefined;
      if (opts.write && result.patches.length > 0) {
        const originals = new Map<string, string>();
        for (const file of Object.keys(result.files)) originals.set(file, await readFile(join(repo, file), "utf8"));
        for (const [file, text] of Object.entries(result.files)) await writeFile(join(repo, file), text);
        tests = await runTests(repo);
        if (tests.ran && !tests.passed) {
          for (const [file, text] of originals) await writeFile(join(repo, file), text);
        }
      }

      if (opts.json) {
        const { files: _files, ...rest } = result;
        console.log(JSON.stringify({ ...rest, tests: tests ?? null }, null, 2));
      } else {
        console.log(fixReport(result, tests, opts));
      }
      if (tests?.ran && !tests.passed) process.exitCode = 1;
    },
  );

program
  .command("candidates")
  .description("list public repos likely to call what a change affects, from GitHub code search (needs gh, signed in)")
  .requiredOption("--change <id|url|file>", "a change id from driftwatch.et/changes/<id>, its JSON URL, or a JSON file")
  .option("--spec <file>", "use this spec file instead of fetching the provider's")
  .option("--limit <n>", "how many repos to list", "15")
  .option("--json", "print the result as JSON")
  .action(async (opts: { change: string; spec?: string; limit: string; json?: boolean }) => {
    const change = await loadChange(changeRef(opts.change));
    const targets = computeTargets(change, await loadSpec(change, maybe(opts.spec)));
    const { queries, candidates } = await findCandidates(change, targets, Number(opts.limit) || 15);
    if (opts.json) {
      console.log(JSON.stringify({ queries, candidates }, null, 2));
      return;
    }
    const lines = [change.url, `Searched: ${queries.map((q) => q.q).join("  ·  ")}`, ""];
    if (candidates.length === 0) lines.push("No candidates: nothing outside the provider's own repos matched.");
    candidates.forEach((c, i) => {
      lines.push(`${String(i + 1).padStart(2)}. ${c.repo}  ★${c.stars}  pushed ${c.pushedAt.slice(0, 10)}`);
      lines.push(`    matched ${c.terms.map((t) => `"${t}"`).join(", ")} in ${c.files.slice(0, 3).join(", ")}${c.files.length > 3 ? ` (+${c.files.length - 3})` : ""}`);
      lines.push(`    gh workflow run inspect -f command=scan -f args="${c.repo} ${change.id}"`);
    });
    lines.push("", "A match is a reason to scan, not a finding. Scan, read, and keep it to a handful of PRs per change.");
    console.log(lines.join("\n"));
  });

program
  .command("pr-body")
  .description("write the pull request title and description for a fix, from `fix --json` output")
  .requiredOption("--fix <file>", "the JSON `driftwatch fix --json` printed")
  .option("--out <file>", "write the description here instead of printing it")
  .action(async (opts: { fix: string; out?: string }) => {
    const report = JSON.parse(await readFile(fromCaller(opts.fix), "utf8")) as FixReport;
    const { title, body } = prBody(report);
    if (opts.out) {
      await writeFile(fromCaller(opts.out), body);
      console.log(`Title: ${title}\nDescription written to ${opts.out}`);
    } else {
      console.log(`Title: ${title}\n\n${body}`);
    }
  });

function fixReport(r: FixResult, tests: TestRun | undefined, opts: { out?: string; write?: boolean }): string {
  const lines = [r.change.url, `${r.patches.length} patch(es), ${r.skipped.length} finding(s) not patched, ${r.findings.length} other finding(s)`, ""];
  if (r.typecheck) {
    const t = r.typecheck;
    lines.push(
      `Typecheck (${t.configured ? "the repo's tsconfig.json" : "strict defaults, no tsconfig.json"}, ${t.filesChecked} files): ` +
        `${t.introduced.length === 0 ? "no new errors" : `${t.introduced.length} new error(s)`}` +
        (t.baselineErrors > 0 ? `; ${t.baselineErrors} before the patch, ${t.errors} after` : ""),
    );
    if (t.unresolvedModules.length > 0) {
      lines.push(`  Not resolved, so calls into them were not typechecked: ${t.unresolvedModules.join(", ")}. Install dependencies for a real check.`);
    }
    lines.push("");
  }
  if (r.patches.length > 0) {
    lines.push("Patches");
    for (const p of r.patches) lines.push(`  ${p.file}:${p.line}  ${p.summary}`);
    lines.push("");
  }
  if (r.dropped.length > 0) {
    lines.push("Dropped: would not typecheck");
    for (const d of r.dropped) {
      lines.push(`  ${d.patch.file}:${d.patch.line}  ${d.patch.summary}`);
      for (const e of d.errors.slice(0, 3)) lines.push(`    ${e}`);
    }
    lines.push("");
  }
  if (r.skipped.length > 0) {
    lines.push("Not patched: needs a person");
    for (const s of r.skipped) {
      lines.push(`  ${s.finding.file}:${s.finding.line}  [${s.finding.confidence}] ${s.reason}`);
      lines.push(`    ${s.finding.snippet}`);
    }
    lines.push("");
  }
  if (r.findings.length > 0) {
    lines.push("Other findings (scan for details)");
    for (const f of r.findings) lines.push(`  ${f.file}:${f.line}  [${f.confidence}] ${f.kind}${f.operation ? ` ${f.operation}` : ""}`);
    lines.push("");
  }
  if (tests) {
    lines.push(
      tests.ran
        ? `Tests (${tests.command}): ${tests.passed ? "passed" : "FAILED, patched files restored"}`
        : `Tests not run: ${tests.reason}`,
    );
    if (tests.ran && !tests.passed && tests.output) lines.push(tests.output);
    lines.push("");
  } else if (opts.write && r.patches.length === 0) {
    lines.push("Nothing written.", "");
  }
  if (r.diff) {
    if (opts.out) lines.push(`Diff written to ${opts.out}`);
    else lines.push(r.diff);
  }
  return lines.join("\n");
}

function report(findings: Finding[], files: number, url: string, operations: number): string {
  const lines = [`${url}`, `${operations} affected operation(s), ${files} file(s) scanned, ${findings.length} finding(s)`, ""];
  for (const f of findings) {
    lines.push(`[${f.confidence}] ${f.file}:${f.line}  ${f.kind}${f.operation ? `  ${f.operation}` : ""}`);
    lines.push(`    ${f.snippet}`);
    lines.push(`    ${f.why}`);
    lines.push("");
  }
  if (findings.length === 0) lines.push("Nothing found. Low-confidence matches would still be listed, so this repo likely does not call the affected operations directly.");
  return lines.join("\n");
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`driftwatch: ${(err as Error).message}`);
  process.exitCode = 1;
});
