import type { ChangeDocument, JsonObject } from "@driftwatch/core";
import ts from "typescript";

import type { Finding } from "../findings.js";
import { climbInner, constLiteral } from "../scan/fields.js";
import type { ScanResult } from "../scan/index.js";
import type { Edit } from "./edit.js";
import { classifyRemoval, documentedValue, requiredFieldSchema, type Removal } from "./schema.js";

/**
 * Which findings get a patch, and what it is. The brief allows three
 * mechanical cases and nothing else:
 *
 *   rename  a removed field the specs show was renamed (same shape, same
 *           description bar a word, the only candidate)
 *   remove  a request field the API no longer accepts, optional before, with
 *           no new field beside it that might replace it
 *   add     a newly required request field the new spec documents one value
 *           for (const, single-value enum, or default)
 *
 * Only high-confidence findings are patched. Everything else is listed with
 * the reason it was not, which is most of the output on a real repo, and the
 * point: a person reads it.
 */

export type PatchKind = "rename" | "remove" | "add";

export interface Patch {
  file: string;
  line: number;
  kind: PatchKind;
  /** The changed field, dotted. */
  field: string;
  /** One line, what the patch does: "rename `integration` to `provider`". */
  summary: string;
  finding: Finding;
  /** What the earlier spec said about a removed field, for the PR body. */
  context?: string;
  /** rename: the new name. */
  to?: string;
  /** add: the value sent. */
  value?: unknown;
  edit: Edit;
}

export interface Skipped {
  finding: Finding;
  reason: string;
}

const REMOVAL_RULES = new Set(["response.property.removed", "request.property.removed", "request.param.removed"]);
const REQUIRED_RULES = new Set(["request.property.became-required", "request.param.became-required", "request.param.required-added"]);

const segments = (fieldPath: string) =>
  fieldPath
    .split(".")
    .map((p) => p.replace(/(\[[^\]]*\])+$/, ""))
    .filter(Boolean);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function nodeAt(source: ts.SourceFile, line: number, column: number): ts.Node | undefined {
  const pos = source.getPositionOfLineAndCharacter(line - 1, column - 1);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (node.getStart(source) <= pos && pos < node.getEnd()) {
      if (node.getStart(source) === pos) found = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  return found;
}

/** Quote like the file does. */
function quote(source: ts.SourceFile, text: string): string {
  const singles = (source.text.match(/'/g) ?? []).length;
  const doubles = (source.text.match(/"/g) ?? []).length;
  if (singles > doubles && !text.includes("'")) return `'${text.replace(/\\/g, "\\\\")}'`;
  return JSON.stringify(text);
}

function literal(source: ts.SourceFile, value: unknown): string {
  return typeof value === "string" ? quote(source, value) : JSON.stringify(value);
}

function propertyKey(source: ts.SourceFile, name: string): string {
  return IDENTIFIER.test(name) ? name : quote(source, name);
}

/** Expressions whose removal drops nothing but the value: no calls, no assignments. */
function pure(e: ts.Expression): boolean {
  const x = climbInner(e);
  if (ts.isIdentifier(x) || ts.isLiteralExpression(x) || ts.isNoSubstitutionTemplateLiteral(x)) return true;
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(x.kind)) return true;
  if (ts.isPropertyAccessExpression(x)) return pure(x.expression);
  if (ts.isPrefixUnaryExpression(x)) return pure(x.operand);
  if (ts.isArrayLiteralExpression(x)) return x.elements.every((el) => !ts.isSpreadElement(el) && pure(el));
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.every((p) => ts.isShorthandPropertyAssignment(p) || (ts.isPropertyAssignment(p) && pure(p.initializer)));
  }
  if (ts.isTemplateExpression(x)) return x.templateSpans.every((s) => pure(s.expression));
  return false;
}

/** Rename the field at a finding's position, whatever form the code reads or writes it in. */
function renameEdit(source: ts.SourceFile, node: ts.Node, from: string, to: string): Edit | string {
  const p = node.parent;
  const replace = (n: ts.Node, text: string): Edit => ({ start: n.getStart(source), end: n.getEnd(), text });
  if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(p) && p.name === node) {
    return IDENTIFIER.test(to) ? replace(node, to) : `\`${to}\` is not an identifier`;
  }
  if (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(p)) {
    return replace(node, quote(source, to));
  }
  if (ts.isBindingElement(p)) {
    if (p.propertyName === node) return replace(node, propertyKey(source, to));
    if (p.name === node && ts.isIdentifier(node)) return replace(node, `${propertyKey(source, to)}: ${from}`);
  }
  if (ts.isPropertyAssignment(p) && p.name === node) {
    return replace(node, ts.isStringLiteral(node) ? quote(source, to) : propertyKey(source, to));
  }
  if (ts.isShorthandPropertyAssignment(p) && p.name === node) {
    return replace(node, `${propertyKey(source, to)}: ${from}`);
  }
  return "the field is read in a form the fixer does not rewrite";
}

/** Delete a property from its object literal, with the comma that goes with it. */
function removeEdit(source: ts.SourceFile, node: ts.Node): Edit | string {
  const property = node.parent;
  if (!(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) || property.name !== node) {
    return "the field is not a property in an object literal";
  }
  if (ts.isPropertyAssignment(property) && !pure(property.initializer)) {
    return "its value is computed by a call, and deleting it would drop that call too";
  }
  const literal = property.parent as ts.ObjectLiteralExpression;
  const list = literal.properties;
  const i = list.indexOf(property);
  if (list.length === 1) return { start: literal.getStart(source), end: literal.getEnd(), text: "{}" };

  // On a line of its own: remove exactly that line, comment and all, and
  // leave the lines around it (and their comments) alone.
  const text = source.text;
  const lineStart = text.lastIndexOf("\n", property.getStart(source) - 1) + 1;
  let end = property.getEnd();
  if (text[end] === ",") end++;
  const lineEnd = text.indexOf("\n", end);
  const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
  if (/^\s*$/.test(text.slice(lineStart, property.getStart(source))) && /^\s*(\/\/.*)?$/.test(rest) && lineEnd !== -1) {
    return { start: lineStart, end: lineEnd + 1, text: "" };
  }
  if (i < list.length - 1) return { start: property.getStart(source), end: list[i + 1]!.getStart(source), text: "" };
  return { start: list[i - 1]!.getEnd(), end: property.getEnd(), text: "" };
}

/** The object literal a call sends: an SDK's params, fetch's body, axios's data, ky's json. */
function payloadOf(call: ts.CallExpression): ts.ObjectLiteralExpression | string {
  const unwrap = (e: ts.Expression): ts.ObjectLiteralExpression | undefined => {
    const x = climbInner(e);
    if (ts.isObjectLiteralExpression(x)) return x;
    if (ts.isIdentifier(x)) return constLiteral(x);
    // JSON.stringify({…}), new URLSearchParams({…})
    if ((ts.isCallExpression(x) || ts.isNewExpression(x)) && x.arguments?.[0]) return unwrap(x.arguments[0]);
    return undefined;
  };
  const names = (o: ts.ObjectLiteralExpression) =>
    o.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : ""));
  for (const arg of [...call.arguments].reverse()) {
    const o = unwrap(arg);
    if (!o) continue;
    const keys = names(o);
    const wrapper = ["body", "json", "data"].find((k) => keys.includes(k));
    if (wrapper) {
      const prop = o.properties.find((p) => ts.isPropertyAssignment(p) && names(o)[o.properties.indexOf(p)] === wrapper);
      const inner = prop && ts.isPropertyAssignment(prop) ? unwrap(prop.initializer) : undefined;
      return inner ?? `the request body is not an object literal the fixer can see`;
    }
    if (keys.some((k) => ["method", "headers", "url"].includes(k))) return "the call sends no body";
    return o;
  }
  return "the call passes no object literal to add the field to";
}

/** Insert `key: value` into an object literal, in its own formatting. */
function insertEdit(source: ts.SourceFile, o: ts.ObjectLiteralExpression, key: string, value: string): Edit {
  const entry = `${key}: ${value}`;
  const list = o.properties;
  if (list.length === 0) return { start: o.getStart(source), end: o.getEnd(), text: `{ ${entry} }` };
  const last = list[list.length - 1]!;
  const trailingComma = list.hasTrailingComma;
  const multiline =
    source.getLineAndCharacterOfPosition(last.getStart(source)).line !== source.getLineAndCharacterOfPosition(o.getStart(source)).line;
  if (multiline) {
    const lineStart = source.getPositionOfLineAndCharacter(source.getLineAndCharacterOfPosition(last.getStart(source)).line, 0);
    const indent = source.text.slice(lineStart, last.getStart(source));
    if (trailingComma) {
      const comma = source.text.indexOf(",", last.getEnd());
      return { start: comma + 1, end: comma + 1, text: `\n${indent}${entry},` };
    }
    return { start: last.getEnd(), end: last.getEnd(), text: `,\n${indent}${entry}` };
  }
  return { start: last.getEnd(), end: last.getEnd(), text: `, ${entry}` };
}

export interface Plan {
  patches: Patch[];
  skipped: Skipped[];
}

export function plan(change: ChangeDocument, result: ScanResult, after: JsonObject, before: JsonObject | undefined): Plan {
  const patches: Patch[] = [];
  const skipped: Skipped[] = [];

  // What became of each removed field, from the specs. Facts that disagree
  // about one field (one says renamed, another removed) get no patch.
  // Keyed by operation and field: Stripe's `payment_method_types` was simply
  // removed from PaymentIntents and maybe replaced on Checkout, in one release.
  const removals = new Map<string, Removal>();
  change.facts.forEach((fact, i) => {
    if (!REMOVAL_RULES.has(fact.ruleId) || !fact.fieldPath) return;
    const field = segments(fact.fieldPath).join(".");
    const verdict = classifyRemoval(before, after, fact.jsonPointer, fact.ruleId === "request.param.removed");
    for (const op of result.targets.byFact[i] ?? []) {
      const key = `${op}|${field}`;
      const previous = removals.get(key);
      if (!previous) removals.set(key, verdict);
      else if (JSON.stringify({ ...previous, description: undefined }) !== JSON.stringify({ ...verdict, description: undefined })) {
        removals.set(key, { kind: "unknown", reason: "the facts for this field disagree about what became of it" });
      }
    }
  });
  const removalFor = (f: Finding) => {
    const path = f.operation?.split(" ").slice(1).join(" ");
    return removals.get(`${f.operation}|${f.field}`) ?? removals.get(`* ${path}|${f.field}`);
  };

  for (const finding of result.findings) {
    if (finding.kind !== "field" || !finding.field) continue;
    const removal = removalFor(finding);
    if (!removal) continue;
    if (finding.confidence !== "high") {
      skipped.push({ finding, reason: `${finding.confidence} confidence: reported, never patched` });
      continue;
    }
    const source = result.sources.get(finding.file);
    const node = source && nodeAt(source, finding.line, finding.column);
    if (!source || !node) {
      skipped.push({ finding, reason: "could not find the code again" });
      continue;
    }
    const from = finding.field.split(".").pop()!;
    if (removal.kind === "renamed") {
      const edit = renameEdit(source, node, from, removal.to);
      if (typeof edit === "string") skipped.push({ finding, reason: edit });
      else patches.push({ file: finding.file, line: finding.line, kind: "rename", field: finding.field, summary: `rename \`${from}\` to \`${removal.to}\``, finding, context: removal.description, to: removal.to, edit });
    } else if (removal.kind === "removed" && finding.direction === "request") {
      if (!removal.optional) {
        skipped.push({ finding, reason: "it was required before, so removing it changes what the call means" });
        continue;
      }
      const edit = removeEdit(source, node);
      if (typeof edit === "string") skipped.push({ finding, reason: edit });
      else patches.push({ file: finding.file, line: finding.line, kind: "remove", field: finding.field, summary: `stop sending \`${from}\``, finding, context: removal.description, edit });
    } else if (removal.kind === "removed") {
      skipped.push({ finding, reason: "the field is gone from the response with no replacement: what to read instead needs a person" });
    } else if (removal.kind === "replaced-maybe") {
      skipped.push({
        finding,
        reason: `${removal.candidates.map((c) => `\`${c}\``).join(", ")} appeared beside it and may replace it, but the spec does not describe it as the same field`,
      });
    } else {
      skipped.push({ finding, reason: removal.reason });
    }
  }

  // Newly required fields: added to the calls that do not send them yet.
  change.facts.forEach((fact, i) => {
    if (!REQUIRED_RULES.has(fact.ruleId) || !fact.fieldPath) return;
    const path = segments(fact.fieldPath);
    const name = typeof fact.after === "string" ? fact.after : path[path.length - 1]!;
    const documented = documentedValue(after, requiredFieldSchema(after, fact.jsonPointer, name));
    const ops = new Set(result.targets.byFact[i] ?? []);
    for (const finding of result.findings) {
      if ((finding.kind !== "http" && finding.kind !== "sdk") || !finding.operation || !ops.has(finding.operation)) continue;
      if (finding.confidence !== "high") {
        skipped.push({ finding, reason: `${finding.confidence} confidence: reported, never patched` });
        continue;
      }
      const source = result.sources.get(finding.file);
      let node = source && nodeAt(source, finding.line, finding.column);
      while (node && !ts.isCallExpression(node)) node = node.parent;
      if (!source || !node) {
        skipped.push({ finding, reason: "could not find the call again" });
        continue;
      }
      let target: ts.ObjectLiteralExpression | string = payloadOf(node as ts.CallExpression);
      for (const segment of path.slice(0, -1)) {
        if (typeof target === "string") break;
        const prop = target.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === segment,
        );
        const inner = prop && climbInner(prop.initializer);
        target = inner && ts.isObjectLiteralExpression(inner) ? inner : inner && ts.isIdentifier(inner) ? constLiteral(inner) ?? `\`${segment}\` is not an object literal the fixer can see` : `the call does not send \`${segment}\``;
      }
      if (typeof target === "string") {
        skipped.push({ finding, reason: target });
        continue;
      }
      if (target.properties.some((p) => ts.isSpreadAssignment(p))) {
        skipped.push({ finding, reason: "the payload is spread from elsewhere, so whether it already sends the field is unknown" });
        continue;
      }
      const leaf = path[path.length - 1]!;
      // A call that already sends the field is not affected, whatever the spec
      // documents. Checked before giving up for want of a value: a call with
      // `model: model || "dall-e-3"` was reported as missing it.
      if (target.properties.some((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === leaf)) continue;
      if (!documented.found) {
        skipped.push({ finding, reason: `\`${fact.fieldPath}\` is now required and ${documented.reason}` });
        continue;
      }
      patches.push({
        file: finding.file,
        line: source.getLineAndCharacterOfPosition(target.getStart(source)).line + 1,
        kind: "add",
        field: path.join("."),
        summary: `send \`${leaf}: ${JSON.stringify(documented.value)}\`, the value the spec documents (${documented.source})`,
        finding,
        value: documented.value,
        edit: insertEdit(source, target, propertyKey(source, leaf), literal(source, documented.value)),
      });
    }
  });

  // One edit per place: two facts can land on the same code.
  const seen = new Set<string>();
  return {
    patches: patches.filter((p) => {
      const k = `${p.file}:${p.edit.start}:${p.edit.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    skipped,
  };
}
