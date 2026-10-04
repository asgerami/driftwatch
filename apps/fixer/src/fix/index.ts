import { join, resolve } from "node:path";

import type { ChangeDocument, JsonObject } from "@driftwatch/core";

import type { Finding } from "../findings.js";
import { scan } from "../scan/index.js";
import { applyEdits, unifiedDiff } from "./edit.js";
import { plan, type Patch, type Skipped } from "./plan.js";
import { typecheck, type TypecheckResult } from "./typecheck.js";

export type { Patch, Skipped } from "./plan.js";

export interface FixResult {
  change: ChangeDocument;
  /** Patches that typecheck, in file order. */
  patches: Omit<Patch, "edit">[];
  /** Patches that would have introduced a type error, with the errors. */
  dropped: { patch: Omit<Patch, "edit">; errors: string[] }[];
  /** Findings that get no patch, and why. */
  skipped: Skipped[];
  /** Findings no patch kind applies to (reads of a field that is simply gone, calls). */
  findings: Finding[];
  typecheck: TypecheckResult | null;
  /** A unified diff of every kept patch, for `git apply`. */
  diff: string;
  /** Patched file contents, by repo-relative path. */
  files: Record<string, string>;
}

function patchedFiles(repo: string, sources: Map<string, { text: string }>, patches: Patch[]): Map<string, string> {
  const byFile = new Map<string, Patch[]>();
  for (const p of patches) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  const out = new Map<string, string>();
  for (const [file, list] of byFile) {
    out.set(resolve(join(repo, file)), applyEdits(sources.get(file)!.text, list.map((p) => p.edit)));
  }
  return out;
}

const strip = ({ edit: _edit, ...rest }: Patch) => rest;

export async function fix(
  change: ChangeDocument,
  after: JsonObject,
  before: JsonObject | undefined,
  repo: string,
): Promise<FixResult> {
  const result = await scan(change, after, repo);
  const { patches: planned, skipped } = plan(change, result, after, before);

  let kept = planned;
  const dropped: FixResult["dropped"] = [];
  let check: TypecheckResult | null = null;
  if (planned.length > 0) {
    check = typecheck(repo, patchedFiles(repo, result.sources, planned));
    if (check.introduced.length > 0) {
      // Find the patches responsible, one at a time, and keep the rest.
      kept = [];
      for (const patch of planned) {
        const alone = typecheck(repo, patchedFiles(repo, result.sources, [patch]));
        if (alone.introduced.length === 0) kept.push(patch);
        else dropped.push({ patch: strip(patch), errors: alone.introduced });
      }
      check = kept.length > 0 ? typecheck(repo, patchedFiles(repo, result.sources, kept)) : check;
    }
  }

  const byFile = new Map<string, Patch[]>();
  for (const p of kept) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  const diff = [...byFile.keys()]
    .sort()
    .map((file) => unifiedDiff(file, result.sources.get(file)!.text, byFile.get(file)!.map((p) => p.edit)))
    .join("");
  const files: Record<string, string> = {};
  for (const [file, list] of byFile) files[file] = applyEdits(result.sources.get(file)!.text, list.map((p) => p.edit));

  const handled = new Set([...planned.map((p) => p.finding), ...skipped.map((s) => s.finding)]);
  return {
    change,
    patches: kept.map(strip).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    dropped,
    skipped,
    findings: result.findings.filter((f) => !handled.has(f)),
    typecheck: check,
    diff,
    files,
  };
}
