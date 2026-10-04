#!/usr/bin/env node
import { resolve } from "node:path";

import { Command } from "commander";

import { loadChange } from "./change.js";
import type { Finding } from "./findings.js";
import { scan } from "./scan/index.js";
import { loadSpec } from "./spec.js";

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
