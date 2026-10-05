import type { ChangeDocument } from "@driftwatch/core";

import type { FixResult } from "./fix/index.js";
import type { TestRun } from "./fix/tests.js";

/**
 * The pull request description for a fix, from templates (CLAUDE.md note 4:
 * a model writes no part of what a maintainer is asked to trust). The brief
 * asks for four things, in this order: what changed upstream with a link,
 * what the patch changes, how it was verified, and one line saying
 * Driftwatch found it. A person reads it before opening the PR.
 */

/** What `driftwatch fix --json` prints. */
export type FixReport = Omit<FixResult, "files"> & { tests: TestRun | null };

const SITE = "https://driftwatch.et";

const code = (s: string) => `\`${s.replace(/`/g, "")}\``;

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** A link to the spec diff itself, when the source is a git repo. */
function specLink(change: ChangeDocument): string | undefined {
  if (change.spec.kind !== "git") return undefined;
  const { repo, fromSha, toSha } = change.spec;
  return fromSha
    ? `https://github.com/${repo}/compare/${fromSha.slice(0, 12)}...${toSha.slice(0, 12)}`
    : `https://github.com/${repo}/commit/${toSha.slice(0, 12)}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function quote(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, "")}…` : flat;
  return `> ${cut}`;
}

function title(r: FixReport): string {
  const provider = r.change.provider.name;
  const kinds = unique(r.patches.map((p) => p.kind));
  const fields = unique(r.patches.map((p) => p.field.split(".").pop()!));
  if (kinds.length === 1 && fields.length === 1) {
    const p = r.patches[0]!;
    if (p.kind === "rename") return `Rename ${code(fields[0]!)} to ${code(p.to ?? "")}, after ${provider}'s API change`;
    if (p.kind === "remove") return `Stop sending ${code(fields[0]!)}, which ${provider} no longer accepts`;
    return `Send ${code(fields[0]!)}, which ${provider} now requires`;
  }
  return `Update for ${provider}'s API change of ${day(r.change.shippedAt)}`;
}

function upstream(r: FixReport): string[] {
  const { change } = r;
  const provider = change.provider.name;
  const lines = [`### What changed upstream`, ""];
  // One sentence per field, with the operations it was patched on.
  const groups = new Map<string, { kind: string; field: string; to?: string; value?: unknown; ops: string[] }>();
  for (const p of r.patches) {
    const key = `${p.kind}|${p.field}|${p.to ?? ""}`;
    const g = groups.get(key) ?? { kind: p.kind, field: p.field, to: p.to, value: p.value, ops: [] };
    if (p.finding.operation && !g.ops.includes(p.finding.operation)) g.ops.push(p.finding.operation);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const where = g.ops.length > 0 ? ` on ${g.ops.map(code).join(", ")}` : "";
    const renamed = [...g.field.split(".").slice(0, -1), g.to ?? ""].join(".");
    if (g.kind === "rename") lines.push(`- ${provider} renamed ${code(g.field)} to ${code(renamed)}${where}.`);
    else if (g.kind === "remove") lines.push(`- ${provider} no longer accepts ${code(g.field)}${where}.`);
    else lines.push(`- ${provider} now requires ${code(g.field)}${where}. Its spec documents one value for it, ${code(JSON.stringify(g.value))}.`);
  }
  lines.push("");

  // What the provider said about a removed field: what leaving it out means.
  const contexts = new Map<string, { field: string; op: string; text: string }>();
  for (const p of r.patches) {
    if (p.kind !== "remove" || !p.context) continue;
    const op = p.finding.operation ?? "the call";
    const key = `${p.field}|${op}`;
    if (!contexts.has(key)) contexts.set(key, { field: p.field, op, text: p.context });
  }
  for (const c of [...contexts.values()].slice(0, 3)) {
    lines.push(`Before the change, ${provider}'s spec described ${code(c.field)} on ${code(c.op)} as:`, "", quote(c.text), "");
  }

  const links = [`[The change on Driftwatch](${change.url})`];
  const spec = specLink(change);
  if (spec) links.push(`[the spec diff](${spec})`);
  lines.push(`Shipped ${day(change.shippedAt)}. ${links.join(", ")}.`, "");
  return lines;
}

function changes(r: FixReport): string[] {
  const lines = [`### What this PR changes`, ""];
  for (const p of r.patches) lines.push(`- ${code(`${p.file}:${p.line}`)}: ${p.summary}`);
  lines.push("");
  const removals = r.patches.filter((p) => p.kind === "remove");
  if (removals.length > 0) {
    lines.push(
      `Removing a field changes what the request does: the API now applies its own behaviour where the field used to decide. Please check that is what you want.`,
      "",
    );
  }
  const left = [
    ...r.dropped.map((d) => ({ at: `${d.patch.file}:${d.patch.line}`, why: `${d.patch.summary} would not typecheck: ${(d.errors[0] ?? "type error").replace(/^[^:]+: /, "")}` })),
    ...r.skipped.filter((s) => s.finding.confidence !== "low").map((s) => ({ at: `${s.finding.file}:${s.finding.line}`, why: s.reason })),
  ];
  if (left.length > 0) {
    lines.push(`Not changed, and worth a look:`, "");
    for (const l of left.slice(0, 10)) lines.push(`- ${code(l.at)}: ${l.why}`);
    if (left.length > 10) lines.push(`- and ${left.length - 10} more`);
    lines.push("");
  }
  return lines;
}

function verified(r: FixReport): string[] {
  const lines = [`### How it was verified`, ""];
  const t = r.typecheck;
  if (t && t.filesChecked === 0) {
    lines.push(`- No TypeScript to typecheck; the changed JavaScript was parsed for syntax errors${t.introduced.length === 0 ? " (none)" : ""}. Not run against the code's behaviour.`);
  } else if (t) {
    const config = t.configured ? "the repo's `tsconfig.json`" : "strict defaults (no `tsconfig.json`)";
    const counts = t.baselineErrors > 0 ? ` (${t.baselineErrors} before, ${t.errors} after)` : "";
    lines.push(`- Typechecked with ${config}: ${t.introduced.length === 0 ? "no new errors" : `${t.introduced.length} new error(s)`}${counts}.`);
    if (t.unresolvedModules.length > 0) {
      lines.push(`- Not resolved during the typecheck, so calls into them were not checked: ${t.unresolvedModules.map(code).join(", ")}.`);
    }
  }
  const tests = r.tests;
  if (tests?.ran) lines.push(`- ${code(tests.command ?? "tests")}: ${tests.passed ? "passed" : "failed"}.`);
  else if (tests) lines.push(`- Tests not run: ${tests.reason}.`);
  else lines.push(`- The repo's tests were not run.`);
  lines.push(`- How ${r.change.provider.name}'s change was classified: ${SITE}/method`, "");
  return lines;
}

export function prBody(r: FixReport): { title: string; body: string } {
  if (r.patches.length === 0) throw new Error("no patches in this fix: nothing to describe");
  const body = [
    ...upstream(r),
    ...changes(r),
    ...verified(r),
    `<sub>Found by [Driftwatch](${SITE}), which watches the API specs projects depend on. A person reviewed this patch before opening the PR.</sub>`,
    "",
  ].join("\n");
  return { title: title(r), body };
}
