import type ts from "typescript";
import { RULES, type ChangeDocument, type JsonObject } from "@driftwatch/core";

import { sortFindings, type Finding, type MatchedCall } from "../findings.js";
import { computeTargets, type FieldTarget, type TargetOperation, type Targets } from "../targets.js";
import { scanFields } from "./fields.js";
import { sourceFiles } from "./files.js";
import { parse, scanHttp } from "./http.js";
import { scanSdk } from "./sdk.js";

export interface ScanResult {
  change: ChangeDocument;
  targets: Targets;
  filesScanned: number;
  findings: Finding[];
  /** Parsed files, by repo-relative path, for `fix` to edit. */
  sources: Map<string, ts.SourceFile>;
}

/** Why a call on `op` breaks, in one line, from the change's own facts. */
function explain(change: ChangeDocument): (op: TargetOperation) => string {
  return (op) => {
    const fact = change.facts.find((f) => f.path === op.path) ?? change.facts[0]!;
    const rule = RULES[fact.ruleId];
    const where = fact.componentName
      ? `${fact.componentName}${fact.fieldPath ? `.${fact.fieldPath}` : ""}`
      : fact.fieldPath ?? `${op.method} ${op.path}`;
    return `${change.provider.name}: ${rule?.headline ?? fact.ruleId} (${where}). ${change.url}`;
  };
}

/** Why reading or sending `field` through `call` breaks. */
function explainField(change: ChangeDocument): (call: MatchedCall, field: FieldTarget) => string {
  return (call, field) => {
    const dotted = field.path.join(".");
    const normal = (p?: string) => (p ?? "").replace(/\[[^\]]*\]/g, "");
    const fact =
      change.facts.find((f) => normal(f.fieldPath) === dotted && f.path === call.op.path) ??
      change.facts.find((f) => normal(f.fieldPath) === dotted) ??
      change.facts[0]!;
    const rule = RULES[fact.ruleId];
    const where = fact.componentName ? `${fact.componentName}.${fact.fieldPath}` : fact.fieldPath;
    return `${change.provider.name}: ${rule?.headline ?? fact.ruleId} (${where}, via ${call.operation}). ${change.url}`;
  };
}

export async function scan(change: ChangeDocument, spec: JsonObject, repo: string): Promise<ScanResult> {
  const targets = computeTargets(change, spec);
  const files = await sourceFiles(repo);
  const why = explain(change);
  const findings: Finding[] = [];
  const matched: MatchedCall[] = [];
  const sources = files.map((file) => parse(file.path, file.text));
  for (const source of sources) {
    findings.push(...scanHttp(source, targets, why, matched));
    findings.push(...scanSdk(source, targets, change.provider.slug, why, matched));
  }
  findings.push(...scanFields(sources, matched, targets, explainField(change), repo));
  return {
    change,
    targets,
    filesScanned: files.length,
    findings: sortFindings(findings),
    sources: new Map(sources.map((s) => [s.fileName, s])),
  };
}
