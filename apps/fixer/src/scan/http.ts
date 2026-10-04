import ts from "typescript";

import type { Finding, MatchedCall } from "../findings.js";
import type { TargetOperation, Targets } from "../targets.js";

/**
 * Raw HTTP calls to an affected operation: fetch, axios and ky, including
 * axios.create / ky.create instances with a base URL.
 *
 * URLs are resolved statically as far as the file allows: string and template
 * literals, `+`, `const` strings and object properties in the same file, and
 * `new URL(path, base)`. Whatever cannot be resolved becomes a wildcard, and
 * the confidence drops with it. A call whose URL resolves to a different,
 * known host never matches, and a match needs at least one literal path
 * segment: a fully dynamic URL could be anything and is not reported.
 */

const WILD = "\u0001";
const VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

type Client = { kind: "axios" | "ky"; base: string };

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
}

/** `const NAME = <expr>` anywhere in the file. First declaration wins. */
function constants(source: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      node.parent &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const &&
      !out.has(node.name.text)
    ) {
      out.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function unwrap(expr: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    expr = expr.expression;
  }
  return expr;
}

function property(obj: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!obj) return undefined;
  obj = unwrap(obj);
  if (!ts.isObjectLiteralExpression(obj)) return undefined;
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && prop.name.text === name) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) return prop.name;
  }
  return undefined;
}

class Resolver {
  constructor(private readonly consts: Map<string, ts.Expression>) {}

  /** The expression as a string, with WILD for whatever is not knowable here. */
  resolve(expr: ts.Expression | undefined, depth = 0): string {
    if (!expr || depth > 6) return WILD;
    expr = unwrap(expr);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isTemplateExpression(expr)) {
      let out = expr.head.text;
      for (const span of expr.templateSpans) out += this.resolve(span.expression, depth + 1) + span.literal.text;
      return out;
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return this.resolve(expr.left, depth + 1) + this.resolve(expr.right, depth + 1);
    }
    if (ts.isIdentifier(expr)) {
      const init = this.consts.get(expr.text);
      return init ? this.resolve(init, depth + 1) : WILD;
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const init = this.consts.get(expr.expression.text);
      const value = property(init, expr.name.text);
      return value ? this.resolve(value, depth + 1) : WILD;
    }
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "URL") {
      const [path, base] = expr.arguments ?? [];
      const p = this.resolve(path, depth + 1);
      if (/^https?:\/\//.test(p)) return p;
      if (!base) return p;
      const b = this.resolve(base, depth + 1);
      // new URL("/x", base) replaces base's path; new URL("x", base) appends.
      if (p.startsWith("/")) {
        const origin = /^(https?:\/\/[^/]+)/.exec(b)?.[1];
        return origin ? origin + p : WILD + p;
      }
      return b.replace(/\/?$/, "/") + p;
    }
    return WILD;
  }

  method(expr: ts.Expression | undefined, fallback: string): string | undefined {
    if (!expr) return fallback;
    const value = this.resolve(expr);
    return value.includes(WILD) ? undefined : value.toUpperCase();
  }
}

/** Instances made with axios.create({ baseURL }) or ky.create/extend({ prefixUrl }). */
function clients(source: ts.SourceFile, consts: Map<string, ts.Expression>, resolver: Resolver): Map<string, Client> {
  const out = new Map<string, Client>([
    ["axios", { kind: "axios", base: "" }],
    ["ky", { kind: "ky", base: "" }],
  ]);
  for (const [name, init] of consts) {
    const expr = unwrap(init);
    if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) continue;
    const target = expr.expression.expression;
    const fn = expr.expression.name.text;
    if (!ts.isIdentifier(target)) continue;
    const parent = out.get(target.text);
    if (!parent) continue;
    if (parent.kind === "axios" && fn === "create") {
      const base = property(expr.arguments[0], "baseURL");
      out.set(name, { kind: "axios", base: base ? resolver.resolve(base) : "" });
    } else if (parent.kind === "ky" && (fn === "create" || fn === "extend")) {
      const base = property(expr.arguments[0], "prefixUrl");
      out.set(name, { kind: "ky", base: (parent.base ?? "") + (base ? resolver.resolve(base) : "") });
    }
  }
  return out;
}

function join(base: string, path: string): string {
  if (!base) return path;
  if (/^https?:\/\//.test(path)) return path;
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

interface Call {
  node: ts.CallExpression;
  url: string;
  method: string | undefined;
  body: MatchedCall["body"];
  /** A wrapper we do not know (`xfetch.post(url)`): counts only on the provider's own host. */
  wrapper?: boolean;
}

/** A callee that reads as a request: an HTTP verb, or a name about fetching. */
const REQUESTY = /fetch|request|http/i;
const NOT_REQUESTS = new Set(["console", "logger", "log", "debug"]);

function calleeName(callee: ts.Expression): { name: string; root?: string } | undefined {
  if (ts.isIdentifier(callee)) return { name: callee.text };
  if (ts.isPropertyAccessExpression(callee)) {
    let root: ts.Expression = callee.expression;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    return { name: callee.name.text, root: ts.isIdentifier(root) ? root.text : undefined };
  }
  return undefined;
}

function httpCalls(source: ts.SourceFile): Call[] {
  const consts = constants(source);
  const resolver = new Resolver(consts);
  const known = clients(source, consts, resolver);
  const calls: Call[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const [first, second] = node.arguments;

      // fetch(url, { method }) and globalThis/window/self.fetch
      const isFetch =
        (ts.isIdentifier(callee) && callee.text === "fetch") ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "fetch" &&
          ts.isIdentifier(callee.expression) &&
          ["globalThis", "window", "self"].includes(callee.expression.text));
      if (isFetch && first) {
        calls.push({ node, url: resolver.resolve(first), method: resolver.method(property(second, "method"), "GET"), body: "fetch" });
      } else if (ts.isIdentifier(callee) && known.has(callee.text) && first) {
        // axios(url | config, config?) and ky(url, options?)
        const client = known.get(callee.text)!;
        const config = first && ts.isObjectLiteralExpression(unwrap(first)) ? first : second;
        const url = config === first ? property(first, "url") : first;
        calls.push({
          node,
          url: join(client.base, resolver.resolve(url)),
          method: resolver.method(property(config, "method"), "GET"),
          body: client.kind === "axios" ? "data" : "fetch",
        });
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        known.has(callee.expression.text) &&
        first
      ) {
        const client = known.get(callee.expression.text)!;
        const fn = callee.name.text;
        if (VERBS.has(fn)) {
          calls.push({ node, url: join(client.base, resolver.resolve(first)), method: fn.toUpperCase(), body: client.kind === "axios" ? "data" : "fetch" });
        } else if (fn === "request" && client.kind === "axios") {
          calls.push({
            node,
            url: join(client.base, resolver.resolve(property(first, "url"))),
            method: resolver.method(property(first, "method"), "GET"),
            body: "data",
          });
        }
      } else if (first) {
        // A wrapper of the repo's own: window.api.xfetch.post(url, body).
        // anime.gf calls OpenAI this way, and nothing above sees it.
        const named = calleeName(callee);
        if (named && !NOT_REQUESTS.has(named.root ?? "") && (VERBS.has(named.name) || REQUESTY.test(named.name) || REQUESTY.test(named.root ?? ""))) {
          const url = resolver.resolve(first);
          if (/^https?:\/\/[^/\u0001]+/.test(url)) {
            calls.push({ node, url, method: VERBS.has(named.name) ? named.name.toUpperCase() : undefined, body: "unknown", wrapper: true });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

interface UrlParts {
  host?: string;
  segments: string[];
  /** The path's start is unknown (a base URL we could not resolve). */
  openStart: boolean;
}

function parts(url: string): UrlParts {
  let rest = url;
  let host: string | undefined;
  let openStart = false;
  const absolute = /^https?:\/\/([^/?#]*)(.*)$/.exec(rest);
  if (absolute) {
    host = absolute[1]!.includes(WILD) ? undefined : absolute[1]!.toLowerCase();
    openStart = host === undefined;
    rest = absolute[2]!;
  } else if (rest.startsWith(WILD)) {
    openStart = true;
    rest = rest.replace(/^\u0001+/, "");
  } else if (!rest.startsWith("/")) {
    // A relative path with no base: could be anything the caller prefixes.
    openStart = true;
  }
  rest = rest.split(/[?#]/)[0]!;
  return { host, segments: rest.split("/").filter(Boolean), openStart };
}

function isParam(segment: string): boolean {
  return /^\{[^}]+\}$/.test(segment);
}

/** null, or how confidently `url` names `op` (ignoring the HTTP method). */
function matchPath(url: UrlParts, op: TargetOperation, targets: Targets): "high" | "medium" | null {
  if (url.host && targets.hosts.length > 0 && !targets.hosts.includes(url.host)) return null;

  const candidates = [op.path, ...targets.basePaths.map((base) => base + op.path)].map((p) =>
    p.split("/").filter(Boolean),
  );
  let best: "high" | "medium" | null = null;
  for (const opSegments of candidates) {
    const u = url.segments;
    if (u.length < opSegments.length) continue;
    if (u.length > opSegments.length && !url.openStart) continue;

    let literalHits = 0;
    let wildHits = 0;
    let ok = true;
    for (let i = 1; i <= opSegments.length; i++) {
      const want = opSegments[opSegments.length - i]!;
      const have = u[u.length - i]!;
      if (isParam(want)) continue;
      if (have === want) literalHits++;
      else if (have.includes(WILD)) wildHits++;
      else {
        ok = false;
        break;
      }
    }
    if (!ok || literalHits === 0) continue;
    const exact = !url.openStart && url.host !== undefined && u.length === opSegments.length && wildHits === 0;
    const level = exact ? "high" : "medium";
    if (level === "high") return "high";
    best = "medium";
  }
  return best;
}

export function scanHttp(
  source: ts.SourceFile,
  targets: Targets,
  why: (op: TargetOperation) => string,
  matched: MatchedCall[] = [],
): Finding[] {
  if (targets.operations.length === 0) return [];
  const file = source.fileName;
  const text = source.text;
  const lines = text.split("\n");
  const findings: Finding[] = [];

  for (const call of httpCalls(source)) {
    const url = parts(call.url);
    if (call.wrapper && (!url.host || !targets.hosts.includes(url.host))) continue;
    let hit: { op: TargetOperation; confidence: Finding["confidence"] } | null = null;
    for (const op of targets.operations) {
      if (op.method !== "*" && call.method && call.method !== op.method) continue;
      const level = matchPath(url, op, targets);
      if (!level) continue;
      const confidence = level === "high" && call.method && !call.wrapper ? "high" : "medium";
      if (!hit || (confidence === "high" && hit.confidence !== "high")) hit = { op, confidence };
    }
    if (!hit) continue;

    const operation = `${hit.op.method === "*" ? call.method ?? "?" : hit.op.method} ${hit.op.path}`;
    matched.push({ node: call.node, op: hit.op, operation, body: call.body, confidence: hit.confidence });
    const start = source.getLineAndCharacterOfPosition(call.node.getStart(source));
    findings.push({
      file,
      line: start.line + 1,
      column: start.character + 1,
      snippet: (lines[start.line] ?? "").trim(),
      kind: "http",
      operation,
      confidence: hit.confidence,
      why: why(hit.op),
    });
  }
  return findings;
}
