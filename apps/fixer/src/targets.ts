import { buildUsageIndex, type ChangeDocument, type JsonObject } from "@driftwatch/core";

/**
 * What a scan looks for, derived from a change and its spec.
 *
 * A fact names an operation directly, or a shared component; for the latter
 * the spec's usage index says which operations reach it, in the direction the
 * rule is about (a removed response field matters to the calls that receive
 * that component, not the ones that send it).
 */

export interface TargetOperation {
  method: string; // upper case
  path: string; // OpenAPI template, "/v1/customers/{customer}"
  /** From the spec; GitHub's ("repos/get-content") name Octokit's methods. */
  operationId?: string;
}

/** A field a change touches, and the operations whose payload carries it. */
export interface FieldTarget {
  /** From the fact's fieldPath, array and map markers dropped: "choices.message.refusal". */
  path: string[];
  /** "METHOD /path" keys, as `opKey` builds them. */
  operations: string[];
  /**
   * Per operation, the full paths from the payload root, when the field sits
   * in a shared component: Cloudflare's config is at `result`, so its
   * `integration.integration` is read as `result.integration.integration`.
   */
  absolute: Record<string, string[][]>;
}

export function opKey(op: { method: string; path: string }): string {
  return `${op.method} ${op.path}`;
}

export interface Targets {
  operations: TargetOperation[];
  /** API hosts from the spec's servers, e.g. "api.stripe.com". */
  hosts: string[];
  /** Path prefix the servers add, e.g. "/v1" for OpenAI. */
  basePaths: string[];
  /** Response fields that were removed or lost their guarantee. */
  responseFields: FieldTarget[];
  /** Request properties or parameters that changed. */
  requestFields: FieldTarget[];
  /** Per fact, in `change.facts` order: the operations it reaches, as `opKey`s. */
  byFact: string[][];
}

/**
 * Rules where sending the field is fine and leaving it out is the break: the
 * call is the finding, not a field in it.
 */
const MISSING_IS_THE_BREAK = new Set([
  "request.property.became-required",
  "request.param.became-required",
  "request.param.required-added",
]);

function directionOf(ruleId: string): "request" | "response" | "operation" {
  if (ruleId.startsWith("response.")) return "response";
  if (ruleId.startsWith("request.")) return "request";
  return "operation";
}

function segments(fieldPath: string): string[] {
  return fieldPath
    .split(".")
    .map((part) => part.replace(/(\[[^\]]*\])+$/, ""))
    .filter(Boolean);
}

export { MISSING_IS_THE_BREAK };

export function computeTargets(change: ChangeDocument, spec: JsonObject): Targets {
  const operations = new Map<string, TargetOperation>();
  let reached: string[] = [];
  const add = (method: string, path: string) => {
    const op = { method: method.toUpperCase(), path };
    operations.set(opKey(op), op);
    reached.push(opKey(op));
  };

  const usage = buildUsageIndex(spec);
  const responseFields = new Map<string, FieldTarget>();
  const requestFields = new Map<string, FieldTarget>();

  const byFact: string[][] = [];
  for (const fact of change.facts) {
    const direction = directionOf(fact.ruleId);
    reached = [];
    byFact.push(reached);
    if (fact.method && fact.path) add(fact.method, fact.path);
    else if (fact.path) add("*", fact.path);

    if (fact.componentName) {
      const entry = usage.get(fact.componentName);
      for (const label of entry?.operations ?? []) {
        const [method, ...rest] = label.split(" ");
        // A response rule concerns the operations that RETURN the component.
        // The usage index records directions per component, not per
        // operation, so a component used both ways keeps all its operations.
        if (direction === "operation" || entry!.directions.has(direction === "request" ? "request" : "response")) {
          add(method!, rest.join(" "));
        }
      }
    }

    if (fact.fieldPath && direction !== "operation" && !MISSING_IS_THE_BREAK.has(fact.ruleId)) {
      const path = segments(fact.fieldPath);
      const fields = direction === "request" ? requestFields : responseFields;
      const key = path.join(".");
      const field = fields.get(key) ?? { path, operations: [], absolute: {} };
      if (path.length === 0) continue;
      fields.set(key, field);
      for (const op of reached) {
        if (!field.operations.includes(op)) field.operations.push(op);
        if (!fact.componentName) continue;
        const [method, ...rest] = op.split(" ");
        for (const prefix of componentPaths(spec, method!, rest.join(" "), fact.componentName, direction)) {
          const full = [...prefix, ...path];
          const list = (field.absolute[op] ??= []);
          if (!list.some((p) => p.join(".") === full.join("."))) list.push(full);
        }
      }
    }
  }

  const servers = Array.isArray(spec["servers"]) ? (spec["servers"] as { url?: unknown }[]) : [];
  const hosts = new Set<string>();
  const basePaths = new Set<string>();
  for (const server of servers) {
    if (typeof server.url !== "string") continue;
    try {
      const url = new URL(server.url);
      hosts.add(url.host.toLowerCase());
      const base = url.pathname.replace(/\/+$/, "");
      if (base) basePaths.add(base);
    } catch {
      // relative or templated server URL: no host constraint from it
    }
  }

  const paths = (spec["paths"] ?? {}) as Record<string, Record<string, { operationId?: unknown }>>;
  for (const op of operations.values()) {
    const id = paths[op.path]?.[op.method.toLowerCase()]?.operationId;
    if (typeof id === "string") op.operationId = id;
  }

  return {
    operations: [...operations.values()],
    hosts: [...hosts],
    basePaths: [...basePaths],
    responseFields: [...responseFields.values()],
    requestFields: [...requestFields.values()],
    byFact,
  };
}

type Json = JsonObject[string];

function isObject(x: unknown): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function deref(spec: JsonObject, node: unknown): unknown {
  let x = node;
  for (let i = 0; i < 10 && isObject(x) && typeof x["$ref"] === "string"; i++) {
    const ref = x["$ref"] as string;
    if (!ref.startsWith("#/")) return x;
    x = ref
      .slice(2)
      .split("/")
      .reduce<unknown>((at, t) => (isObject(at) ? at[t.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), spec);
  }
  return x;
}

/** The payload schemas of an operation: 2xx responses, or the request body. */
function payloads(spec: JsonObject, method: string, path: string, direction: "request" | "response"): Json[] {
  const paths = isObject(spec["paths"]) ? spec["paths"] : {};
  const item = deref(spec, paths[path]);
  if (!isObject(item)) return [];
  const ops = method === "*" ? Object.values(item) : [item[method.toLowerCase()]];
  const out: Json[] = [];
  for (const op of ops.map((o) => deref(spec, o))) {
    if (!isObject(op)) continue;
    const holders =
      direction === "request"
        ? [op["requestBody"]]
        : Object.entries(isObject(op["responses"]) ? op["responses"] : {})
            .filter(([code]) => code.startsWith("2"))
            .map(([, r]) => r);
    for (const holder of holders.map((h) => deref(spec, h))) {
      if (!isObject(holder) || !isObject(holder["content"])) continue;
      for (const media of Object.values(holder["content"])) {
        if (isObject(media) && media["schema"] !== undefined) out.push(media["schema"]);
      }
    }
  }
  return out;
}

/**
 * Property-name paths from an operation's payload root to where `component`
 * is used, through properties, array items and compositions. Breadth first,
 * shortest paths, bounded: the usage index already said the component is
 * reachable, this only says where.
 */
export function componentPaths(
  spec: JsonObject,
  method: string,
  path: string,
  component: string,
  direction: "request" | "response",
): string[][] {
  const target = `#/components/schemas/${component.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  const found: string[][] = [];
  const queue: { node: unknown; at: string[]; seen: Set<string> }[] = payloads(spec, method, path, direction).map((node) => ({
    node,
    at: [],
    seen: new Set(),
  }));
  let steps = 0;
  while (queue.length > 0 && steps++ < 5000 && found.length < 8) {
    const { node, at, seen } = queue.shift()!;
    if (!isObject(node)) continue;
    const ref = node["$ref"];
    if (typeof ref === "string") {
      if (ref === target) {
        if (!found.some((p) => p.join(".") === at.join("."))) found.push(at);
        continue;
      }
      if (seen.has(ref) || at.length > 6) continue;
      queue.push({ node: deref(spec, node), at, seen: new Set([...seen, ref]) });
      continue;
    }
    if (isObject(node["properties"])) {
      for (const [key, child] of Object.entries(node["properties"])) queue.push({ node: child, at: [...at, key], seen });
    }
    for (const key of ["items", "additionalProperties"]) if (node[key] !== undefined) queue.push({ node: node[key], at, seen });
    for (const key of ["allOf", "anyOf", "oneOf"]) {
      const members = node[key];
      if (Array.isArray(members)) for (const m of members) queue.push({ node: m, at, seen });
    }
  }
  return found;
}
