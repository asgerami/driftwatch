#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Command } from "commander";

import { loadChange } from "./change.js";
import type { Finding } from "./findings.js";
import { fix, type FixResult } from "./fix/index.js";
import { runTests, type TestRun } from "./fix/tests.js";
import { scan } from "./scan/index.js";
import { loadSpec, loadSpecBefore } from "./spec.js";

/**
 * driftwatch: the concierge fixer (brief, M4). Finds where a repo calls an API
 * a published change affects. It never opens pull requests: a person reviews
 * every finding and opens any PR themselves.
 */

const program = new Command();
program.name("driftwatch").description("Find code a published API change breaks").version("0.1.0");

program
  .command("scan")
  .requiredOption("--change <id|url|file>", "a change id from driftwatch.et/changes/<id>, its JSON URL, or a JSON file")
  .requiredOption("--repo <path>", "the repository to scan")
  .option("--spec <file>", "use this spec file instead of fetching the provider's")
  .option("--json", "print findings as JSON")
  .action(async (opts: { change: string; repo: string; spec?: string; json?: boolean }) => {
    const change = await loadChange(opts.change);
    const spec = await loadSpec(change, opts.spec);
    const result = await scan(change, spec, resolve(opts.repo));
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
      const repo = resolve(opts.repo);
      const change = await loadChange(opts.change);
      const [after, before] = await Promise.all([loadSpec(change, opts.spec), loadSpecBefore(change, opts.specBefore)]);
      const result = await fix(change, after, before, repo);
      if (opts.out) await writeFile(opts.out, result.diff);

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
