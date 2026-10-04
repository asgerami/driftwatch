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
}

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

  for (const fact of change.facts) {
    const direction = directionOf(fact.ruleId);
    reached = [];
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

    if (fact.fieldPath && direction !== "operation") {
      const path = segments(fact.fieldPath);
      const fields = direction === "request" ? requestFields : responseFields;
      const key = path.join(".");
      const existing = fields.get(key);
      if (existing) existing.operations = [...new Set([...existing.operations, ...reached])];
      else if (path.length > 0) fields.set(key, { path, operations: [...reached] });
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
  };
}
