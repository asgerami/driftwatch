import ts from "typescript";

import type { Finding, MatchedCall } from "../findings.js";
import { opKey, type FieldTarget, type Targets } from "../targets.js";
import { exportNames, ModuleGraph, type Binding } from "./modules.js";

/**
 * Field access: code that reads a changed response field, or sends a changed
 * request field, through a call the HTTP or SDK finder matched.
 *
 * Best effort, by data flow over syntax alone. The finder starts at each
 * matched call and follows its value: through `await`, into variables and
 * destructuring, through `.json()` and axios's `.data`, `.then` callbacks,
 * array callbacks and `for…of`, and out of a function that returns it, into
 * its callers in the same file and in files that import it, however they
 * resolve (modules.ts). Depth limits keep this cheap and bounded.
 *
 * high: traced from the call, and the path read matches the fact's field path.
 * medium: traced, but only the field's name matches (the change sits under a
 *   shared component, so the full path from the body is not known), or the
 *   call itself was a medium match.
 * low: the name is read in a file that makes an affected call, on a value the
 *   finder could not trace (a parameter, a class field). Never patched.
 *
 * Request fields are found in object literals passed to the matched call.
 */

const MAX_HOPS = 3;
const ARRAY_CALLBACKS = new Set(["map", "forEach", "filter", "find", "findLast", "some", "every", "flatMap"]);
const SAME_SHAPE = new Set(["filter", "find", "findLast", "slice", "at", "reverse", "sort", "toSorted", "toReversed"]);
/** Wrapper keys an HTTP client's config puts around the payload. */
const PAYLOAD_KEYS = new Set(["data", "body", "json", "params", "searchParams", "query", "form"]);

type Layer = "fetch" | "data" | "body";

interface State {
  layer: Layer;
  /** Property names read from the body so far, array indices dropped. */
  path: string[];
  call: MatchedCall;
  hops: number;
}

interface Context {
  sources: Map<string, ts.SourceFile>;
  modules: ModuleGraph;
  why: (call: MatchedCall, field: FieldTarget) => string;
  responseFields: FieldTarget[];
  findings: Map<string, Finding>;
  /** Functions already followed into their callers, per call, so recursion ends. */
  followed: Set<string>;
  /** Files a traced value reaches, for guesses: the file of the call or of a caller. */
  reached: Map<ts.SourceFile, MatchedCall>;
  /** Every expression the trace followed: a guess never second-guesses one. */
  traced: Set<ts.Node>;
}

const position = (node: ts.Node) => `${node.getSourceFile().fileName}:${node.getStart()}`;

function report(
  ctx: Context,
  node: ts.Node,
  call: MatchedCall,
  field: FieldTarget,
  confidence: Finding["confidence"],
  direction: "request" | "response" = "response",
) {
  const source = node.getSourceFile();
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const key = `${source.fileName}:${start.line}:${start.character}`;
  const existing = ctx.findings.get(key);
  const rank = { high: 0, medium: 1, low: 2 };
  if (existing && rank[existing.confidence] <= rank[confidence]) return;
  ctx.findings.set(key, {
    file: source.fileName,
    line: start.line + 1,
    column: start.character + 1,
    snippet: (source.text.split("\n")[start.line] ?? "").trim(),
    kind: "field",
    operation: call.operation,
    field: field.path.join("."),
    direction,
    confidence,
    why: ctx.why(call, field),
  });
}

function applies(field: FieldTarget, call: MatchedCall): boolean {
  return field.operations.includes(opKey(call.op));
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A read of `path` off the body: report it if it is a changed field. */
function check(ctx: Context, node: ts.Node, path: string[], s: State) {
  const name = path[path.length - 1];
  for (const field of ctx.responseFields) {
    if (field.path[field.path.length - 1] !== name || !applies(field, s.call)) continue;
    const absolute = field.absolute[opKey(s.call.op)] ?? [];
    const exact = same(field.path, path) || absolute.some((full) => same(full, path));
    // Where the spec places the component in this payload is known, and this
    // is not it: Cloudflare's `result.integration` is the parent object, not
    // the `integration` field inside it.
    if (!exact && absolute.length > 0) continue;
    report(ctx, node, s.call, field, exact && s.call.confidence === "high" ? "high" : "medium");
  }
}

/** Step outward past wrappers that leave the value as it is. */
function climb(node: ts.Node): ts.Node {
  let n = node;
  while (
    n.parent &&
    (ts.isAwaitExpression(n.parent) ||
      ts.isParenthesizedExpression(n.parent) ||
      ts.isNonNullExpression(n.parent) ||
      ts.isAsExpression(n.parent) ||
      ts.isTypeAssertionExpression(n.parent) ||
      ts.isSatisfiesExpression(n.parent))
  ) {
    n = n.parent;
  }
  return n;
}

function accessedName(p: ts.Node, n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(p) && p.expression === n) return p.name.text;
  if (ts.isElementAccessExpression(p) && p.expression === n && ts.isStringLiteralLike(p.argumentExpression)) {
    return p.argumentExpression.text;
  }
  return undefined;
}

function firstParam(fn: ts.Node | undefined): ts.ParameterDeclaration | undefined {
  if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return fn.parameters[0];
  return undefined;
}

/** Follow the value of expression `e`, in state `s`, to wherever it is read. */
function follow(ctx: Context, e: ts.Node, s: State) {
  const n = climb(e);
  ctx.traced.add(e);
  ctx.traced.add(n);
  const p = n.parent;
  if (!p) return;

  const name = accessedName(p, n);
  if (name !== undefined) {
    const callee = ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : undefined;
    if (name === "then" && callee) return followThen(ctx, callee, s);
    if (s.layer === "fetch") {
      if (name === "json" && callee) follow(ctx, callee, { ...s, layer: "body" });
      return; // res.ok, res.status: not the body
    }
    if (s.layer === "data") {
      if (name === "data") follow(ctx, p, { ...s, layer: "body" });
      return; // .status, .headers
    }
    if (callee && ARRAY_CALLBACKS.has(name)) {
      const param = firstParam(callee.arguments[0]);
      if (param) bind(ctx, param.name, s, callee.arguments[0]!);
      if (SAME_SHAPE.has(name)) follow(ctx, callee, s);
      return;
    }
    if (callee && SAME_SHAPE.has(name)) return follow(ctx, callee, s);
    if (callee) return; // a method on the body: not a field
    const path = [...s.path, name];
    check(ctx, ts.isPropertyAccessExpression(p) ? p.name : ts.isElementAccessExpression(p) ? p.argumentExpression : p, path, s);
    return follow(ctx, p, { ...s, path });
  }

  // body.items[0]: indices do not change the path.
  if (ts.isElementAccessExpression(p) && p.expression === n) return follow(ctx, p, s);

  if (ts.isVariableDeclaration(p) && p.initializer === n) return bind(ctx, p.name, s, scopeOf(p));

  if (ts.isBinaryExpression(p) && p.right === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) {
    return track(ctx, p.left.text, p.end, scopeOf(p), s);
  }

  if (ts.isForOfStatement(p) && p.expression === n && ts.isVariableDeclarationList(p.initializer)) {
    const declaration = p.initializer.declarations[0];
    if (declaration) bind(ctx, declaration.name, s, p.statement);
    return;
  }

  if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n)) return followReturn(ctx, p, s);
}

/** `x.then(r => …)`: the callback's parameter is the settled value. */
function followThen(ctx: Context, call: ts.CallExpression, s: State) {
  const callback = call.arguments[0];
  const param = firstParam(callback);
  if (!param || !callback) return;
  bind(ctx, param.name, s, callback);
  // `.then(r => r.json())` and `.then(r => r.data)` hand the body on.
  if (ts.isArrowFunction(callback) && !ts.isBlock(callback.body) && ts.isIdentifier(param.name)) {
    const body = climbInner(callback.body);
    const r = param.name.text;
    if (s.layer === "fetch" && ts.isCallExpression(body) && isMember(body.expression, r, "json")) {
      follow(ctx, call, { ...s, layer: "body" });
    } else if (s.layer === "data" && isMember(body, r, "data")) {
      follow(ctx, call, { ...s, layer: "body" });
    }
  }
}

export function climbInner(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAwaitExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x;
}

function isMember(e: ts.Node, object: string, name: string): boolean {
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === object && e.name.text === name;
}

function scopeOf(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n && !ts.isBlock(n) && !ts.isSourceFile(n) && !ts.isFunctionLike(n) && !ts.isCaseClause(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

/** A binding receives the value: a name to track, or a pattern to read. */
function bind(ctx: Context, name: ts.BindingName, s: State, scope: ts.Node) {
  if (ts.isIdentifier(name)) return track(ctx, name.text, name.end, scope, s);
  if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) if (ts.isBindingElement(element)) bind(ctx, element.name, s, scope);
    return;
  }
  for (const element of name.elements) {
    const key = element.propertyName
      ? ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
        ? element.propertyName.text
        : undefined
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    if (key === undefined || element.dotDotDotToken) continue;
    if (s.layer === "data") {
      if (key === "data") bind(ctx, element.name, { ...s, layer: "body" }, scope);
    } else if (s.layer === "body") {
      const path = [...s.path, key];
      check(ctx, element.propertyName ?? element.name, path, s);
      bind(ctx, element.name, { ...s, path }, scope);
    }
  }
}

/** Every later read of variable `name` inside `scope`. */
function track(ctx: Context, name: string, after: number, scope: ts.Node, s: State) {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && node.getStart() > after && isRead(node)) follow(ctx, node, s);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

function isRead(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isBindingElement(p) || ts.isPropertyDeclaration(p)) && p.name === id) return false;
  if (ts.isVariableDeclaration(p) && p.name === id) return false;
  if (ts.isParameter(p) && p.name === id) return false;
  return true;
}

/** The function that returns the value, and the calls that receive it. */
function followReturn(ctx: Context, at: ts.Node, s: State) {
  if (s.hops >= MAX_HOPS) return;
  let fn: ts.Node | undefined = at;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  if (!fn) return;

  let name: string | undefined;
  if (ts.isFunctionDeclaration(fn) && fn.name) name = fn.name.text;
  else if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    name = fn.parent.name.text;
  }
  if (!name) return;

  const source = fn.getSourceFile();
  const key = `${position(fn)}|${position(s.call.node)}|${s.layer}|${s.path.join(".")}`;
  if (ctx.followed.has(key)) return;
  ctx.followed.add(key);

  const next = { ...s, hops: s.hops + 1 };
  for (const call of callsTo(source, [{ kind: "name", local: name }])) follow(ctx, call, next);

  const exported = exportNames(fn, name);
  if (exported.size === 0) return;
  for (const other of ctx.sources.values()) {
    if (other === source) continue;
    const bindings = ctx.modules.bindings(other, source.fileName, exported);
    if (bindings.length === 0) continue;
    for (const call of callsTo(other, bindings)) {
      if (!ctx.reached.has(other)) ctx.reached.set(other, s.call);
      follow(ctx, call, next);
    }
  }
}

/** Calls through any of the bindings: `name(…)`, or `ns.member(…)`. */
function callsTo(source: ts.SourceFile, bindings: Binding[]): ts.CallExpression[] {
  const names = new Set(bindings.filter((b) => b.kind === "name").map((b) => b.local));
  const members = new Set(bindings.filter((b) => b.kind === "namespace").map((b) => `${b.local}.${(b as { member: string }).member}`));
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isIdentifier(e) && names.has(e.text)) calls.push(node);
      else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && members.has(`${e.expression.text}.${e.name.text}`)) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** Request fields: keys of object literals passed to the matched call. */
function requestFields(ctx: Context, call: MatchedCall, fields: FieldTarget[]) {
  const relevant = fields.filter((f) => applies(f, call));
  if (relevant.length === 0) return;

  const visitLiteral = (literal: ts.ObjectLiteralExpression, prefix: string[]) => {
    for (const property of literal.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : undefined;
      if (name === undefined) continue;
      let path = [...prefix, name];
      if (path.length > 1 && PAYLOAD_KEYS.has(path[0]!)) path = path.slice(1);
      for (const field of relevant) {
        if (field.path[field.path.length - 1] !== name) continue;
        const exact = same(field.path, path) || (field.absolute[opKey(call.op)] ?? []).some((full) => same(full, path));
        report(ctx, property.name, call, field, exact && call.confidence === "high" ? "high" : "medium", "request");
      }
      if (ts.isPropertyAssignment(property)) visitValue(property.initializer, [...prefix, name]);
    }
  };
  const visitValue = (e: ts.Expression, prefix: string[]) => {
    const x = climbInner(e);
    if (ts.isObjectLiteralExpression(x)) return visitLiteral(x, prefix);
    // JSON.stringify({…}), new URLSearchParams({…}): the literal is the payload.
    if ((ts.isCallExpression(x) || ts.isNewExpression(x)) && x.arguments?.[0]) return visitValue(x.arguments[0], prefix.slice(0, -1));
    if (ts.isIdentifier(x)) {
      const literal = constLiteral(x);
      if (literal) visitLiteral(literal, prefix);
    }
  };
  for (const arg of call.node.arguments) visitValue(arg, []);
}

/** `const payload = {…}` declared in an enclosing scope, before use. */
export function constLiteral(id: ts.Identifier): ts.ObjectLiteralExpression | undefined {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement) || statement.pos > id.pos) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer && ts.isObjectLiteralExpression(climbInner(d.initializer))) {
          return climbInner(d.initializer) as ts.ObjectLiteralExpression;
        }
      }
    }
  }
  return undefined;
}

/**
 * Generic names are read off everything, so an untraced read is only worth a
 * guess when the name is distinctive: snake_case, camelCase, or long.
 */
function distinctive(name: string): boolean {
  return name.includes("_") || /[a-z][A-Z]/.test(name) || name.length >= 10;
}

function bindsName(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  return name.elements.some((e) => ts.isBindingElement(e) && bindsName(e.name, text));
}

/**
 * Whether a value comes from outside what the finder can see: a parameter or
 * a class field. A value from a local variable came from somewhere the trace
 * would have followed had it been an affected call, so it is not guessed at.
 */
function untraced(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  for (;;) {
    x = climbInner(x);
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
      if (x.expression.kind === ts.SyntaxKind.ThisKeyword) return true;
      x = x.expression;
    } else break;
  }
  if (!ts.isIdentifier(x)) return false;
  const id = x;
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n) && n.parameters.some((p) => bindsName(p.name, id.text))) return true;
    if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.some((st) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => bindsName(d.name, id.text)))) {
      return false;
    }
  }
  return false;
}

/** Untraced reads in files that make an affected call or receive its result. */
function guesses(ctx: Context, matched: MatchedCall[]) {
  const files = new Map(ctx.reached);
  for (const call of matched) if (!files.has(call.node.getSourceFile())) files.set(call.node.getSourceFile(), call);
  for (const [source, call] of files) {
    const fields = ctx.responseFields.filter((f) => applies(f, call) && distinctive(f.path[f.path.length - 1]!));
    if (fields.length === 0) continue;
    const visit = (node: ts.Node) => {
      let name: ts.Node | undefined;
      if (ts.isPropertyAccessExpression(node) && !ctx.traced.has(node.expression) && untraced(node.expression)) name = node.name;
      else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        // function f({ field }), or const { field } = param
        const holder = node.parent.parent;
        if (ts.isParameter(holder) || (ts.isVariableDeclaration(holder) && holder.initializer && untraced(holder.initializer))) {
          name = node.propertyName ?? node.name;
        }
      }
      if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
        const field = fields.find((f) => f.path[f.path.length - 1] === name.text);
        if (field) report(ctx, name, call, field, "low");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

export function scanFields(
  sources: ts.SourceFile[],
  matched: MatchedCall[],
  targets: Targets,
  why: (call: MatchedCall, field: FieldTarget) => string,
  repo = process.cwd(),
): Finding[] {
  if (targets.responseFields.length === 0 && targets.requestFields.length === 0) return [];
  const byName = new Map(sources.map((s) => [s.fileName, s]));
  const ctx: Context = {
    sources: byName,
    modules: new ModuleGraph(repo, byName),
    why,
    responseFields: targets.responseFields,
    findings: new Map(),
    followed: new Set(),
    reached: new Map(),
    traced: new Set(),
  };
  for (const call of matched) {
    requestFields(ctx, call, targets.requestFields);
    if (targets.responseFields.some((f) => applies(f, call))) {
      follow(ctx, call.node, { layer: call.body === "direct" ? "body" : call.body, path: [], call, hops: 0 });
    }
  }
  guesses(ctx, matched);
  return [...ctx.findings.values()];
}
