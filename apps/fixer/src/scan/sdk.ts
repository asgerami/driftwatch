import ts from "typescript";

import type { Finding } from "../findings.js";
import type { TargetOperation, Targets } from "../targets.js";
import { parse } from "./http.js";

/**
 * Official SDK calls to an affected operation.
 *
 * A call counts only on a known client: a value created from the provider's
 * official package (`new Stripe(…)`, `new OpenAI(…)`, `new Octokit(…)`,
 * `require("stripe")(key)`, `github.getOctokit(token)`), held in a variable,
 * a class field, or a constructor parameter typed with the SDK's class.
 * `store.paymentIntents.create()` on anything else is not Stripe.
 *
 * Which method calls which operation:
 *   - operationId, when the SDK is generated from it: GitHub's "repos/get"
 *     is Octokit's repos.get; Plaid's "linkTokenCreate" is client.linkTokenCreate.
 *   - otherwise the REST shape of the path, the convention Stripe's and
 *     OpenAI's SDKs follow: POST /v1/payment_intents → paymentIntents.create,
 *     GET …/{id} → retrieve, POST …/{id}/confirm → confirm,
 *     POST /chat/completions → chat.completions.create.
 *   - octokit.request("GET /repos/{owner}/{repo}") names the route itself.
 */

/** Official npm packages per provider slug. */
export const SDK_PACKAGES: Record<string, string[]> = {
  stripe: ["stripe"],
  openai: ["openai"],
  github: ["@octokit/rest", "octokit", "@octokit/core", "@actions/github"],
  plaid: ["plaid"],
  square: ["square"],
  twilio: ["twilio"],
  sendgrid: ["@sendgrid/mail", "@sendgrid/client"],
  resend: ["resend"],
  discord: ["discord.js", "@discordjs/rest"],
  asana: ["asana"],
  box: ["box-node-sdk", "box-typescript-sdk-gen"],
  cloudflare: ["cloudflare"],
  vercel: ["@vercel/sdk"],
  clerk: ["@clerk/backend", "@clerk/clerk-sdk-node"],
  mux: ["@mux/mux-node"],
  pagerduty: ["@pagerduty/pdjs"],
  datadog: ["@datadog/datadog-api-client"],
};

/** Namespaces some SDKs put in front of the resource path. */
const OPTIONAL_PREFIXES = new Set(["rest", "beta", "api", "v1", "v2"]);

export function camel(text: string): string {
  return text.replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
}

function pascal(text: string): string {
  const c = camel(text);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

interface Signature {
  namespaces: string[] | null; // null: any namespaces (operationId-named methods)
  method: string;
  confidence: "high" | "medium";
}

/** Every SDK method name that plausibly calls `op`. */
export function signaturesFor(op: TargetOperation): Signature[] {
  const out: Signature[] = [];
  if (op.operationId) {
    const [group, name] = op.operationId.includes("/") ? op.operationId.split("/", 2) : [undefined, op.operationId];
    out.push({ namespaces: group ? [camel(group)] : null, method: camel(name!), confidence: "high" });
  }

  const segments = op.path.split("/").filter(Boolean);
  if (segments[0] && /^v\d+(beta\d*)?$/.test(segments[0])) segments.shift();
  const isParam = (s: string) => /^\{.+\}$/.test(s);
  const literals = segments.filter((s) => !isParam(s)).map(camel);
  if (literals.length === 0) return out;
  const last = segments[segments.length - 1]!;
  const beforeLast = segments[segments.length - 2];
  const verb = op.method;

  if (isParam(last)) {
    const methods = verb === "GET" ? ["retrieve", "get"] : verb === "DELETE" ? ["del", "delete"] : ["update"];
    for (const method of methods) out.push({ namespaces: literals, method, confidence: "high" });
  } else if (beforeLast && isParam(beforeLast)) {
    // An action or sub-collection on one item: POST …/{id}/confirm,
    // GET /customers/{id}/sources, GET /threads/{id}/messages.
    const action = camel(last);
    const parent = literals.slice(0, -1);
    if (verb === "POST") out.push({ namespaces: parent, method: action, confidence: "high" });
    out.push({ namespaces: literals, method: verb === "GET" ? "list" : "create", confidence: "medium" });
    out.push({ namespaces: parent, method: `${verb === "GET" ? "list" : "create"}${pascal(last)}`, confidence: "medium" });
  } else {
    out.push({ namespaces: literals, method: verb === "GET" ? "list" : verb === "POST" ? "create" : camel(verb.toLowerCase()), confidence: "high" });
  }
  return out;
}

function stripPrefixes(namespaces: string[]): string[] {
  let i = 0;
  while (i < namespaces.length - 1 && OPTIONAL_PREFIXES.has(namespaces[i]!)) i++;
  return namespaces.slice(i);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Identifiers imported from the provider's packages (default, named, namespace, require). */
function sdkImports(source: ts.SourceFile, packages: string[]): Set<string> {
  const names = new Set<string>();
  const fromSdk = (spec: ts.Expression) => ts.isStringLiteral(spec) && packages.includes(spec.text);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && fromSdk(node.moduleSpecifier) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) names.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) names.add(el.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "require" &&
      node.initializer.arguments[0] &&
      fromSdk(node.initializer.arguments[0])
    ) {
      if (ts.isIdentifier(node.name)) names.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) for (const el of node.name.elements) if (ts.isIdentifier(el.name)) names.add(el.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** The root identifier of an expression like `new Stripe(k)`, `github.getOctokit(t)`, `require("stripe")(k)`. */
function createsClient(expr: ts.Expression, imports: Set<string>, packages: string[]): boolean {
  let e: ts.Expression = expr;
  while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (!ts.isNewExpression(e) && !ts.isCallExpression(e)) return false;
  let callee: ts.Expression = e.expression;
  // require("stripe")(key)
  if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "require") {
    const arg = callee.arguments[0];
    return !!arg && ts.isStringLiteral(arg) && packages.includes(arg.text);
  }
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && imports.has(callee.text);
}

function typeNamesSdk(type: ts.TypeNode | undefined, imports: Set<string>): boolean {
  if (!type || !ts.isTypeReferenceNode(type)) return false;
  let name: ts.EntityName = type.typeName;
  while (ts.isQualifiedName(name)) name = name.left;
  return imports.has(name.text);
}

/** Variables and `this.` fields holding a client. */
function sdkClients(source: ts.SourceFile, imports: Set<string>, packages: string[]): { vars: Set<string>; fields: Set<string> } {
  const vars = new Set<string>();
  const fields = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if ((node.initializer && createsClient(node.initializer, imports, packages)) || typeNamesSdk(node.type, imports)) {
        vars.add(node.name.text);
      }
    }
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      if ((node.initializer && createsClient(node.initializer, imports, packages)) || typeNamesSdk(node.type, imports)) {
        fields.add(node.name.text);
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && typeNamesSdk(node.type, imports)) {
      vars.add(node.name.text);
      // constructor(private readonly stripe: Stripe) is also this.stripe
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword)) {
        fields.add(node.name.text);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      createsClient(node.right, imports, packages)
    ) {
      fields.add(node.left.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { vars, fields };
}

/** `a.b.c.d(…)` → { root: "a" | "this.a", names: ["b","c","d"] }. */
function chain(callee: ts.Expression): { root: string; names: string[] } | null {
  const names: string[] = [];
  let e = callee;
  while (ts.isPropertyAccessExpression(e)) {
    names.unshift(e.name.text);
    e = e.expression;
    if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return { root: `this.${e.name.text}`, names };
    }
  }
  if (ts.isIdentifier(e)) return { root: e.text, names };
  return null;
}

export function scanSdk(
  file: string,
  text: string,
  targets: Targets,
  providerSlug: string,
  why: (op: TargetOperation) => string,
): Finding[] {
  const packages = SDK_PACKAGES[providerSlug];
  if (!packages || targets.operations.length === 0) return [];
  if (!packages.some((pkg) => text.includes(pkg))) return [];

  const source = parse(file, text);
  const imports = sdkImports(source, packages);
  // require("stripe")(key) creates a client with no import binding at all.
  const inlineRequire = packages.some((pkg) => new RegExp(`require\\(\\s*["']${pkg.replace(/[/.]/g, "\\$&")}["']\\s*\\)\\s*\\(`).test(text));
  if (imports.size === 0 && !inlineRequire) return [];
  const { vars, fields } = sdkClients(source, imports, packages);
  const isClient = (root: string) => (root.startsWith("this.") ? fields.has(root.slice(5)) : vars.has(root));

  const signatures = targets.operations.map((op) => ({ op, signatures: signaturesFor(op) }));
  const lines = text.split("\n");
  const findings: Finding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const c = chain(node.expression);
      if (c && c.names.length > 0 && isClient(c.root)) {
        const method = c.names[c.names.length - 1]!;
        const namespaces = stripPrefixes(c.names.slice(0, -1));
        let hit: { op: TargetOperation; confidence: "high" | "medium" } | null = null;

        if (method === "request" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          // octokit.request("GET /repos/{owner}/{repo}")
          const [verb, route] = node.arguments[0].text.split(" ");
          const op = targets.operations.find((o) => o.path === route && (o.method === "*" || o.method === verb?.toUpperCase()));
          if (op) hit = { op, confidence: "high" };
        } else {
          for (const { op, signatures: sigs } of signatures) {
            for (const sig of sigs) {
              if (sig.method !== method) continue;
              if (sig.namespaces !== null && !sameList(namespaces, sig.namespaces)) continue;
              if (!hit || (sig.confidence === "high" && hit.confidence !== "high")) hit = { op, confidence: sig.confidence };
            }
          }
        }

        if (hit) {
          const start = source.getLineAndCharacterOfPosition(node.getStart(source));
          findings.push({
            file,
            line: start.line + 1,
            column: start.character + 1,
            snippet: (lines[start.line] ?? "").trim(),
            kind: "sdk",
            operation: `${hit.op.method} ${hit.op.path}`,
            confidence: hit.confidence,
            why: why(hit.op),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
