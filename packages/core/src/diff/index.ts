import { createHash } from "node:crypto";

import { HTTP_METHODS, type Json, type JsonObject } from "../types.js";
import {
  PUBLISH_CONFIDENCE_THRESHOLD,
  RULES,
  UNPUBLISHED_SEVERITIES,
  ruleFor,
  type Severity,
} from "./rules.js";
import {
  collectComponentRefs,
  diffSchema,
  isObject,
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
  /** Identity of the underlying FACT, independent of where it was observed. */
  fingerprint: string;
}

/**
 * Two changes share a fingerprint when they are the same fact seen in
 * different places.
 *
 * An inline enum that appears in nine operations is one piece of news, not
 * nine. The feed groups on this; the database keeps every occurrence so the
 * GitHub App can still tell a specific repo which of its call sites is hit.
 *
 * Hashed rather than concatenated, for two reasons. A fixed 64-char value
 * indexes far better than an unbounded key built from field paths and enum
 * lists. And the parts are joined with a separator that must never appear in
 * the data: an earlier version used NUL, which is exactly the one byte
 * Postgres refuses in a text column, so every insert failed with
 * "invalid byte sequence for encoding UTF8: 0x00". Hashing removes the
 * question entirely, since the output is always hex.
 */
export function fingerprintOf(change: RawChange): string {
  const parts = [
    change.ruleId,
    change.componentName ?? "",
    change.fieldPath ?? "",
    JSON.stringify(change.before ?? null),
    JSON.stringify(change.after ?? null),
    change.detail ?? "",
  ];
  // For endpoint-surface rules the location IS the fact, and none of the
  // parts above carry it: every endpoint removed in a release shared one
  // fingerprint, so a review decision on one could carry to another. Found
  // when GitHub's 11 moved enterprise endpoints came up as "1 distinct fact".
  // Appended only for these rules, so every other fingerprint is unchanged.
  if (LOCATION_KEYED_RULES.has(change.ruleId)) {
    parts.push(change.method ?? "", change.path ?? "");
  }
  return createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
}

/**
 * Rules whose fingerprint includes method and path (since ruleset 1.3.0).
 * Stored rows from before that need `pnpm w refingerprint`.
 */
export const LOCATION_KEYED_RULES: ReadonlySet<string> = new Set([
  "path.removed",
  "path.added",
  "operation.removed",
  "operation.added",
  "operation.deprecated",
  "operation.undeprecated",
]);

export interface DiffResult {
  changes: Change[];
  /** Set when the change cap was hit; the diff is then incomplete. */
  truncated: boolean;
  counts: Record<Severity, number>;
}

export const RULESET_VERSION = "1.7.0";

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

/**
 * Every `in:name` currently declared anywhere: shared parameter components
 * and every path/operation parameter list.
 *
 * Needed because resolving `$ref`s before compare makes "this operation
 * stopped listing a still-shared parameter" look identical to "the argument
 * was withdrawn". GitHub's classroom endpoints dropped `$ref`s to `page` and
 * `per-page` while 250+ other operations kept them; that is documentation,
 * not a break.
 */
function collectDeclaredParamKeys(doc: JsonObject): Set<string> {
  const keys = new Set<string>();
  const add = (raw: Json | undefined) => {
    for (const key of indexParameters(doc, raw).keys()) keys.add(key);
  };

  const components = isObject(doc["components"]) ? doc["components"] : {};
  const parameters = isObject(components["parameters"]) ? components["parameters"] : {};
  for (const param of Object.values(parameters)) {
    if (!isObject(param)) continue;
    const resolved =
      typeof param["$ref"] === "string"
        ? (resolveRef(doc, param["$ref"]) ?? param)
        : param;
    if (!isObject(resolved)) continue;
    const key = paramKey(resolved);
    if (key) keys.add(key);
  }

  const paths = isObject(doc["paths"]) ? doc["paths"] : {};
  for (const item of Object.values(paths)) {
    if (!isObject(item)) continue;
    add(item["parameters"]);
    for (const [, operation] of operationsOf(item)) add(operation["parameters"]);
  }
  return keys;
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

/** One entry of a `security` list: every scheme in it is required, with these scopes. */
type Requirement = Map<string, Set<string>>;

/**
 * A `security` list is a set of ALTERNATIVES, any one of which is enough; the
 * schemes inside one alternative are all required together. `[]` means no
 * authentication. Flattening the list into one scheme→scopes map, as an
 * earlier version did, turned "you may now also use an API key" into
 * "authentication scheme changed", BREAKING at confidence 90.
 */
function requirementsOf(security: Json | undefined): Requirement[] {
  if (!Array.isArray(security)) return [];
  if (security.length === 0) return [new Map()];
  const out: Requirement[] = [];
  for (const entry of security) {
    if (!isObject(entry)) continue;
    const requirement: Requirement = new Map();
    for (const [scheme, scopes] of Object.entries(entry)) {
      const set = new Set<string>();
      if (Array.isArray(scopes)) {
        for (const scope of scopes) if (typeof scope === "string") set.add(scope);
      }
      requirement.set(scheme, set);
    }
    out.push(requirement);
  }
  return out;
}

/** Can a caller holding `held` credentials meet `need`? */
function satisfies(held: Requirement, need: Requirement): boolean {
  for (const [scheme, scopes] of need) {
    const heldScopes = held.get(scheme);
    if (!heldScopes) return false;
    for (const scope of scopes) if (!heldScopes.has(scope)) return false;
  }
  return true;
}

function schemesOf(requirement: Requirement): string {
  return [...requirement.keys()].sort().join(" + ");
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

  // Shared components first, once each, using the AFTER document's usage graph
  // to say how much of the API each one touches.
  diffComponents(beforeDoc, afterDoc, emit);

  const beforePaths = isObject(beforeDoc["paths"]) ? beforeDoc["paths"] : {};
  const afterPaths = isObject(afterDoc["paths"]) ? afterDoc["paths"] : {};
  const afterDeclaredParams = collectDeclaredParamKeys(afterDoc);

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
        afterDeclaredParams,
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

export interface ComponentUsage {
  /** Directions this component is reachable in. A schema can be both. */
  directions: Set<Direction>;
  /** "GET /v1/charges" entries that can reach it. */
  operations: Set<string>;
}

/**
 * Which operations reach which shared components, and in which direction.
 *
 * Direction is not decorative here: the same component used in a response and
 * in a request body has opposite breaking rules, so a component reachable both
 * ways is diffed twice and classified separately each time.
 */
export function buildUsageIndex(doc: JsonObject): Map<string, ComponentUsage> {
  const index = new Map<string, ComponentUsage>();

  const record = (name: string, direction: Direction, operation: string) => {
    const entry = index.get(name) ?? {
      directions: new Set<Direction>(),
      operations: new Set<string>(),
    };
    entry.directions.add(direction);
    entry.operations.add(operation);
    index.set(name, entry);
  };

  const paths = isObject(doc["paths"]) ? doc["paths"] : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const [method, operation] of operationsOf(item)) {
      const label = `${method.toUpperCase()} ${path}`;

      const requestSources: Json[] = [
        item["parameters"],
        operation["parameters"],
        operation["requestBody"],
      ].filter((v): v is Json => v !== undefined);
      for (const source of requestSources) {
        for (const name of collectComponentRefs(doc, source)) {
          record(name, "request", label);
        }
      }

      if (operation["responses"] !== undefined) {
        for (const name of collectComponentRefs(doc, operation["responses"])) {
          record(name, "response", label);
        }
      }
    }
  }

  return index;
}

/** How many operations to name in the feed before saying "and N more". */
const AFFECTED_SAMPLE_SIZE = 5;

/**
 * Diff shared component schemas, once per component per direction it is used.
 *
 * This is where the bulk of real API change lives, and reporting it here
 * rather than at every call site is the difference between a readable feed
 * and thousands of duplicates of the same fact.
 */
function diffComponents(
  beforeDoc: JsonObject,
  afterDoc: JsonObject,
  emit: (change: RawChange) => void,
): void {
  const beforeComponents = isObject(beforeDoc["components"])
    ? beforeDoc["components"]
    : {};
  const afterComponents = isObject(afterDoc["components"]) ? afterDoc["components"] : {};
  const beforeSchemas = isObject(beforeComponents["schemas"])
    ? beforeComponents["schemas"]
    : {};
  const afterSchemas = isObject(afterComponents["schemas"])
    ? afterComponents["schemas"]
    : {};

  const usage = buildUsageIndex(afterDoc);

  for (const name of Object.keys(beforeSchemas)) {
    if (!(name in afterSchemas)) continue; // dangling refs surface at usage sites
    const entry = usage.get(name);
    if (!entry) continue; // unreferenced component: nobody can observe it

    const operations = [...entry.operations].sort();
    const location = {
      componentName: name,
      affectedOperations: operations.length,
      affectedSample: operations.slice(0, AFFECTED_SAMPLE_SIZE),
    };

    for (const direction of entry.directions) {
      diffSchema(
        beforeSchemas[name]!,
        afterSchemas[name]!,
        { beforeDoc, afterDoc, direction, emit, location },
        `/components/schemas${pointer(name)}`,
      );
    }
  }
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
  afterDeclaredParams: Set<string>;
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
    afterDeclaredParams,
  } = input;

  const operationId =
    typeof afterOp["operationId"] === "string"
      ? afterOp["operationId"]
      : typeof beforeOp["operationId"] === "string"
        ? beforeOp["operationId"]
        : undefined;

  const location = { path, method, operationId };

  // Schema walks stop at every `$ref`, so what these see is the inline
  // portion of the operation's own schemas. Shared components were already
  // diffed once each by diffComponents.
  const context = (direction: Direction): DiffContext => ({
    beforeDoc,
    afterDoc,
    direction,
    emit,
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
        ruleId: afterDeclaredParams.has(key)
          ? "request.param.unlisted"
          : "request.param.removed",
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
  // A caller authenticates with one of the old alternatives; which one is
  // unknown. The change breaks them only if that alternative's credentials no
  // longer meet ANY new alternative. An operation that declared no security
  // before is skipped, as it always has been: providers routinely start
  // documenting auth that was always required, and reporting every such
  // operation as newly locked would be a wave of false breaks.
  const beforeRequirements = requirementsOf(beforeOp["security"] ?? beforeDoc["security"]);
  const afterRequirements = requirementsOf(afterOp["security"] ?? afterDoc["security"]);
  const brokenSchemes = new Set<string>();

  if (afterRequirements.length > 0) {
    for (const held of beforeRequirements) {
      if (held.size === 0) continue;
      if (afterRequirements.some((need) => satisfies(held, need))) continue;

      // Same schemes, more scopes: the credential is right, the grant is not.
      const sameSchemes = afterRequirements.find(
        (need) => need.size > 0 && [...need.keys()].every((scheme) => held.has(scheme)),
      );
      if (sameSchemes) {
        const missing = [...sameSchemes].flatMap(([scheme, scopes]) =>
          [...scopes].filter((scope) => !held.get(scheme)?.has(scope)),
        );
        emit({
          ...location,
          ruleId: "security.scope-added",
          jsonPointer: `${at}/security`,
          before: schemesOf(held),
          after: schemesOf(sameSchemes),
          detail: `requires ${[...new Set(missing)].sort().join(", ")}`,
        });
      } else if (
        beforeRequirements.some(
          (other) => other.size > 0 && afterRequirements.some((need) => satisfies(other, need)),
        )
      ) {
        // Another way in still works. Only callers of the withdrawn option
        // break; calling it "scheme changed" told everyone to rework auth.
        // Datadog's POST /api/v2/events dropped OAuth beside API + app keys.
        const remaining = afterRequirements.map(schemesOf).join(" or ");
        emit({
          ...location,
          ruleId: "security.alternative-removed",
          jsonPointer: `${at}/security`,
          before: schemesOf(held),
          after: remaining,
          detail: `${schemesOf(held)} no longer accepted; ${remaining} still is`,
        });
      } else {
        emit({
          ...location,
          ruleId: "security.scheme-changed",
          jsonPointer: `${at}/security`,
          before: schemesOf(held),
          after: afterRequirements.map(schemesOf).join(" or "),
          detail: `${schemesOf(held)} → ${afterRequirements.map(schemesOf).join(" or ")}`,
        });
      }
      for (const scheme of held.keys()) brokenSchemes.add(scheme);
    }
  }

  // A scheme no alternative asks for any more. Only a relaxation when it was
  // not part of a break already reported above; otherwise a swap would read
  // as two facts, "changed" and "removed".
  const stillAsked = new Set(afterRequirements.flatMap((need) => [...need.keys()]));
  const wasAsked = new Set(beforeRequirements.flatMap((held) => [...held.keys()]));
  for (const scheme of [...wasAsked].sort()) {
    if (stillAsked.has(scheme) || brokenSchemes.has(scheme)) continue;
    if (afterRequirements.length === 0) continue;
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
      fingerprint: fingerprintOf(change),
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
export {
  diffSchema,
  flattenAllOf,
  resolveRef,
  pointer,
  collectComponentRefs,
  componentNameOf,
} from "./schema.js";
