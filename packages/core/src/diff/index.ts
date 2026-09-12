import { HTTP_METHODS, type Json, type JsonObject } from "../types.js";
import {
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULES,
  UNPUBLISHED_SEVERITIES,
  ruleFor,
  type Severity,
} from "./rules.js";
import {
  diffSchema,
  isObject,
  isPaginationField,
  pointer,
  resolveRef,
  type DiffContext,
  type Direction,
  type RawChange,
} from "./schema.js";

export interface Change extends RawChange {
  severity: Severity;
  confidence: number;
  directionFlip: boolean;
  headline: string;
  consequence: string;
  publishable: boolean;
}

export interface DiffResult {
  changes: Change[];
  /** Set when the change cap was hit; the diff is then incomplete. */
  truncated: boolean;
  counts: Record<Severity, number>;
}

export const RULESET_VERSION = "1.0.0";

/** A single pair of specs should never produce more than this. */
const MAX_CHANGES = 5000;

function operationsOf(pathItem: JsonObject): [string, JsonObject][] {
  const out: [string, JsonObject][] = [];
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (isObject(operation)) out.push([method, operation]);
  }
  return out;
}

function paramKey(param: JsonObject): string | null {
  const name = param["name"];
  const location = param["in"];
  if (typeof name !== "string" || typeof location !== "string") return null;
  return `${location}:${name}`;
}

function indexParameters(
  doc: JsonObject,
  raw: Json | undefined,
): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    let param = entry;
    if (isObject(param) && typeof param["$ref"] === "string") {
      const resolved = resolveRef(doc, param["$ref"]);
      if (!resolved) continue;
      param = resolved;
    }
    if (!isObject(param)) continue;
    const key = paramKey(param);
    if (key) map.set(key, param);
  }
  return map;
}

/** Path parameters are required by definition, whatever the spec says. */
function isParamRequired(param: JsonObject): boolean {
  if (param["in"] === "path") return true;
  return param["required"] === true;
}

function mediaSchemas(container: Json | undefined): Map<string, Json> {
  const out = new Map<string, Json>();
  if (!isObject(container)) return out;
  const content = container["content"];
  if (!isObject(content)) return out;
  for (const [mediaType, body] of Object.entries(content)) {
    if (isObject(body) && body["schema"] !== undefined) {
      out.set(mediaType, body["schema"]!);
    }
  }
  return out;
}

function scopesOf(security: Json | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!Array.isArray(security)) return out;
  for (const requirement of security) {
    if (!isObject(requirement)) continue;
    for (const [scheme, scopes] of Object.entries(requirement)) {
      const set = out.get(scheme) ?? new Set<string>();
      if (Array.isArray(scopes)) {
        for (const scope of scopes) {
          if (typeof scope === "string") set.add(scope);
        }
      }
      out.set(scheme, set);
    }
  }
  return out;
}

/**
 * Structural diff of two normalized OpenAPI documents.
 *
 * Both inputs must have been through `normalizeSpec`. Diffing raw documents
 * produces phantom changes from key reordering, and diffing across OAS major
 * versions without the upgrade step produces nonsense.
 */
export function diffDocuments(
  beforeDoc: JsonObject,
  afterDoc: JsonObject,
): DiffResult {
  const raw: RawChange[] = [];
  let truncated = false;

  const emit = (change: RawChange) => {
    if (raw.length >= MAX_CHANGES) {
      truncated = true;
      return;
    }
    raw.push(change);
  };

  const beforePaths = isObject(beforeDoc["paths"]) ? beforeDoc["paths"] : {};
  const afterPaths = isObject(afterDoc["paths"]) ? afterDoc["paths"] : {};

  for (const path of Object.keys(beforePaths)) {
    const beforeItem = beforePaths[path];
    if (!isObject(beforeItem)) continue;

    if (!(path in afterPaths)) {
      emit({ ruleId: "path.removed", jsonPointer: `/paths${pointer(path)}`, path });
      continue;
    }
    const afterItem = afterPaths[path];
    if (!isObject(afterItem)) continue;

    const beforeOps = new Map(operationsOf(beforeItem));
    const afterOps = new Map(operationsOf(afterItem));

    for (const [method, beforeOp] of beforeOps) {
      const at = `/paths${pointer(path)}${pointer(method)}`;
      const afterOp = afterOps.get(method);

      if (!afterOp) {
        emit({ ruleId: "operation.removed", jsonPointer: at, path, method });
        continue;
      }
      diffOperation({
        beforeDoc,
        afterDoc,
        beforeOp,
        afterOp,
        beforeItem,
        afterItem,
        path,
        method,
        at,
        emit,
      });
    }

    for (const [method] of afterOps) {
      if (beforeOps.has(method)) continue;
      emit({
        ruleId: "operation.added",
        jsonPointer: `/paths${pointer(path)}${pointer(method)}`,
        path,
        method,
      });
    }
  }

  for (const path of Object.keys(afterPaths)) {
    if (path in beforePaths) continue;
    emit({ ruleId: "path.added", jsonPointer: `/paths${pointer(path)}`, path });
  }

  return classify(raw, truncated);
}

interface OperationDiffInput {
  beforeDoc: JsonObject;
  afterDoc: JsonObject;
  beforeOp: JsonObject;
  afterOp: JsonObject;
  beforeItem: JsonObject;
  afterItem: JsonObject;
  path: string;
  method: string;
  at: string;
  emit: (change: RawChange) => void;
}

function diffOperation(input: OperationDiffInput): void {
  const {
    beforeDoc,
    afterDoc,
    beforeOp,
    afterOp,
    beforeItem,
    afterItem,
    path,
    method,
    at,
    emit,
  } = input;

  const operationId =
    typeof afterOp["operationId"] === "string"
      ? afterOp["operationId"]
      : typeof beforeOp["operationId"] === "string"
        ? beforeOp["operationId"]
        : undefined;

  const location = { path, method, operationId };

  const context = (direction: Direction): DiffContext => ({
    beforeDoc,
    afterDoc,
    direction,
    emit,
    // Fresh per operation: a shared component that changed is relevant to
    // every operation that returns it, and the feed groups them later.
    seen: new Set<string>(),
    location,
  });

  // ── deprecation ─────────────────────────────────────────────────────
  const wasDeprecated = beforeOp["deprecated"] === true;
  const isDeprecated = afterOp["deprecated"] === true;
  if (!wasDeprecated && isDeprecated) {
    emit({ ...location, ruleId: "operation.deprecated", jsonPointer: `${at}/deprecated` });
  } else if (wasDeprecated && !isDeprecated) {
    emit({ ...location, ruleId: "operation.undeprecated", jsonPointer: `${at}/deprecated` });
  }

  // ── parameters ──────────────────────────────────────────────────────
  // Path-level parameters apply to every operation under the path.
  const beforeParams = new Map([
    ...indexParameters(beforeDoc, beforeItem["parameters"]),
    ...indexParameters(beforeDoc, beforeOp["parameters"]),
  ]);
  const afterParams = new Map([
    ...indexParameters(afterDoc, afterItem["parameters"]),
    ...indexParameters(afterDoc, afterOp["parameters"]),
  ]);

  for (const [key, beforeParam] of beforeParams) {
    const name = key.split(":").slice(1).join(":");
    const paramAt = `${at}/parameters/${key}`;
    const afterParam = afterParams.get(key);

    if (!afterParam) {
      emit({
        ...location,
        ruleId: "request.param.removed",
        jsonPointer: paramAt,
        fieldPath: name,
        before: key,
      });
      continue;
    }

    if (!isParamRequired(beforeParam) && isParamRequired(afterParam)) {
      emit({
        ...location,
        ruleId: "request.param.became-required",
        jsonPointer: `${paramAt}/required`,
        fieldPath: name,
        after: key,
      });
    }

    // Parameter defaults (where pagination silently changes shape) are
    // handled inside diffSchema, which already keys pagination detection off
    // the field name we pass as `name`. Checking here as well emitted the
    // same change twice, which is exactly the duplicate noise the feed
    // cannot afford.
    diffSchema(
      beforeParam["schema"],
      afterParam["schema"],
      context("request"),
      `${paramAt}/schema`,
      name,
    );
  }

  for (const [key, afterParam] of afterParams) {
    if (beforeParams.has(key)) continue;
    const name = key.split(":").slice(1).join(":");
    emit({
      ...location,
      ruleId: isParamRequired(afterParam)
        ? "request.param.required-added"
        : "request.param.optional-added",
      jsonPointer: `${at}/parameters/${key}`,
      fieldPath: name,
      after: key,
    });
  }

  // ── request body ────────────────────────────────────────────────────
  const beforeBody = mediaSchemas(beforeOp["requestBody"]);
  const afterBody = mediaSchemas(afterOp["requestBody"]);
  for (const [mediaType, beforeSchema] of beforeBody) {
    const afterSchema = afterBody.get(mediaType);
    if (afterSchema === undefined) continue;
    diffSchema(
      beforeSchema,
      afterSchema,
      context("request"),
      `${at}/requestBody/content${pointer(mediaType)}/schema`,
    );
  }

  // ── responses ───────────────────────────────────────────────────────
  const beforeResponses = isObject(beforeOp["responses"]) ? beforeOp["responses"] : {};
  const afterResponses = isObject(afterOp["responses"]) ? afterOp["responses"] : {};

  for (const code of Object.keys(beforeResponses)) {
    const responseAt = `${at}/responses${pointer(code)}`;
    if (!(code in afterResponses)) {
      emit({
        ...location,
        ruleId: "response.status-code.removed",
        jsonPointer: responseAt,
        before: code,
        detail: `${code} no longer documented`,
      });
      continue;
    }

    const beforeMedia = mediaSchemas(beforeResponses[code]);
    const afterMedia = mediaSchemas(afterResponses[code]);
    for (const [mediaType, beforeSchema] of beforeMedia) {
      const afterSchema = afterMedia.get(mediaType);
      if (afterSchema === undefined) continue;
      diffSchema(
        beforeSchema,
        afterSchema,
        context("response"),
        `${responseAt}/content${pointer(mediaType)}/schema`,
      );
    }
  }

  for (const code of Object.keys(afterResponses)) {
    if (code in beforeResponses) continue;
    emit({
      ...location,
      ruleId: "response.status-code.added",
      jsonPointer: `${at}/responses${pointer(code)}`,
      after: code,
      detail: `${code} is now documented`,
    });
  }

  // ── security ────────────────────────────────────────────────────────
  const beforeSecurity = scopesOf(beforeOp["security"] ?? beforeDoc["security"]);
  const afterSecurity = scopesOf(afterOp["security"] ?? afterDoc["security"]);

  for (const [scheme, afterScopes] of afterSecurity) {
    const beforeScopes = beforeSecurity.get(scheme);
    if (!beforeScopes) {
      if (beforeSecurity.size > 0) {
        emit({
          ...location,
          ruleId: "security.scheme-changed",
          jsonPointer: `${at}/security`,
          before: [...beforeSecurity.keys()].join(", "),
          after: scheme,
        });
      }
      continue;
    }
    const added = [...afterScopes].filter((s) => !beforeScopes.has(s));
    if (added.length > 0) {
      emit({
        ...location,
        ruleId: "security.scope-added",
        jsonPointer: `${at}/security`,
        before: [...beforeScopes].sort().join(", "),
        after: [...afterScopes].sort().join(", "),
        detail: `requires ${added.join(", ")}`,
      });
    }
  }

  for (const [scheme] of beforeSecurity) {
    if (afterSecurity.has(scheme)) continue;
    emit({
      ...location,
      ruleId: "security.requirement-removed",
      jsonPointer: `${at}/security`,
      before: scheme,
    });
  }
}

/**
 * Attach severity and confidence from the rule catalog.
 *
 * Deliberately a pure lookup. No model participates in this decision, so the
 * same pair of specs always yields the same severities, and a false BREAKING
 * is a bug in a rule rather than an unreproducible generation.
 */
export function classify(raw: RawChange[], truncated = false): DiffResult {
  const counts: Record<Severity, number> = {
    BREAKING: 0,
    DEPRECATION: 0,
    BEHAVIORAL: 0,
    ADDITIVE: 0,
    COSMETIC: 0,
  };

  const changes = raw.map((change): Change => {
    const rule = ruleFor(change.ruleId);
    counts[rule.severity]++;
    return {
      ...change,
      severity: rule.severity,
      confidence: rule.confidence,
      directionFlip: rule.directionFlip === true,
      headline: rule.headline,
      consequence: rule.consequence,
      publishable:
        rule.confidence >= PUBLISH_CONFIDENCE_THRESHOLD &&
        !UNPUBLISHED_SEVERITIES.has(rule.severity),
    };
  });

  return { changes, truncated, counts };
}

export { RULES, ruleFor, PUBLISH_CONFIDENCE_THRESHOLD } from "./rules.js";
export type { Severity, Rule } from "./rules.js";
export type { RawChange, Direction } from "./schema.js";
export { diffSchema, flattenAllOf, resolveRef, pointer } from "./schema.js";
