import { RULES, type ChangeDocument, type JsonObject } from "@driftwatch/core";

import { sortFindings, type Finding } from "../findings.js";
import { computeTargets, type TargetOperation, type Targets } from "../targets.js";
import { sourceFiles } from "./files.js";
import { scanHttp } from "./http.js";
import { scanSdk } from "./sdk.js";

export interface ScanResult {
  change: ChangeDocument;
  targets: Targets;
  filesScanned: number;
  findings: Finding[];
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

export async function scan(change: ChangeDocument, spec: JsonObject, repo: string): Promise<ScanResult> {
  const targets = computeTargets(change, spec);
  const files = await sourceFiles(repo);
  const why = explain(change);
  const findings: Finding[] = [];
  for (const file of files) {
    findings.push(...scanHttp(file.path, file.text, targets, why));
    findings.push(...scanSdk(file.path, file.text, targets, change.provider.slug, why));
  }
  return { change, targets, filesScanned: files.length, findings: sortFindings(findings) };
}
