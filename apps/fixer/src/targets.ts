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
}

export interface Targets {
  operations: TargetOperation[];
  /** API hosts from the spec's servers, e.g. "api.stripe.com". */
  hosts: string[];
  /** Path prefix the servers add, e.g. "/v1" for OpenAI. */
  basePaths: string[];
  /** Response fields that were removed or lost their guarantee. */
  responseFields: string[];
  /** Request properties or parameters that changed. */
  requestFields: string[];
}

function directionOf(ruleId: string): "request" | "response" | "operation" {
  if (ruleId.startsWith("response.")) return "response";
  if (ruleId.startsWith("request.")) return "request";
  return "operation";
}

function leaf(fieldPath: string): string {
  return (fieldPath.split(".").pop() ?? fieldPath).replace(/\[[^\]]*\]$/, "");
}

export function computeTargets(change: ChangeDocument, spec: JsonObject): Targets {
  const operations = new Map<string, TargetOperation>();
  const add = (method: string, path: string) =>
    operations.set(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path });

  const usage = buildUsageIndex(spec);
  const responseFields = new Set<string>();
  const requestFields = new Set<string>();

  for (const fact of change.facts) {
    const direction = directionOf(fact.ruleId);
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

    if (fact.fieldPath) {
      (direction === "request" ? requestFields : responseFields).add(leaf(fact.fieldPath));
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

  return {
    operations: [...operations.values()],
    hosts: [...hosts],
    basePaths: [...basePaths],
    responseFields: [...responseFields],
    requestFields: [...requestFields],
  };
}
