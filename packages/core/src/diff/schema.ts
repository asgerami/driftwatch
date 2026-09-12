import type { Json, JsonObject } from "../types.js";

export type Direction = "request" | "response";

export interface RawChange {
  ruleId: string;
  jsonPointer: string;
  method?: string;
  path?: string;
  operationId?: string;
  /** Dotted access path as calling code would write it: "customer.address". */
  fieldPath?: string;
  before?: Json;
  after?: Json;
  /** One clause of extra specificity, appended to the rule's headline. */
  detail?: string;
}

export interface DiffContext {
  beforeDoc: JsonObject;
  afterDoc: JsonObject;
  direction: Direction;
  emit: (change: RawChange) => void;
  /** Per-operation, so a shared component is reported for each operation that uses it. */
  seen: Set<string>;
  location: { method?: string; path?: string; operationId?: string };
}

const MAX_DEPTH = 14;

export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function pointer(...tokens: (string | number)[]): string {
  return tokens.map((t) => `/${escapeToken(String(t))}`).join("");
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Internal refs only. Bundling has already inlined anything external. */
export function resolveRef(doc: JsonObject, ref: string): JsonObject | null {
  if (!ref.startsWith("#/")) return null;
  let cursor: Json = doc;
  for (const raw of ref.slice(2).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(cursor)) return null;
    const next: Json | undefined = cursor[token];
    if (next === undefined) return null;
    cursor = next;
  }
  return isObject(cursor) ? cursor : null;
}

function deref(doc: JsonObject, schema: Json, depth = 0): JsonObject | null {
  if (!isObject(schema)) return null;
  const ref = schema["$ref"];
  if (typeof ref !== "string" || depth > MAX_DEPTH) {
    return isObject(schema) ? schema : null;
  }
  const target = resolveRef(doc, ref);
  return target ? deref(doc, target, depth + 1) : null;
}

/**
 * Merge `allOf` members into one schema.
 *
 * `allOf` is an intersection, so a property introduced by any member is a
 * property of the whole. Without flattening, moving a field between an inline
 * schema and an `allOf` member reads as the field being deleted and a
 * different one added, which is a false BREAKING of exactly the kind that
 * costs a subscriber.
 */
export function flattenAllOf(
  doc: JsonObject,
  schema: JsonObject,
  depth = 0,
): JsonObject {
  const members = schema["allOf"];
  if (!Array.isArray(members) || depth > MAX_DEPTH) return schema;

  const properties: JsonObject = {};
  const required: string[] = [];
  const merged: JsonObject = { ...schema };
  delete merged["allOf"];

  const absorb = (part: JsonObject) => {
    const props = part["properties"];
    if (isObject(props)) Object.assign(properties, props);
    const req = part["required"];
    if (Array.isArray(req)) {
      for (const r of req) if (typeof r === "string") required.push(r);
    }
    for (const key of ["type", "format", "enum", "items", "nullable", "default"]) {
      if (merged[key] === undefined && part[key] !== undefined) {
        merged[key] = part[key]!;
      }
    }
  };

  absorb(schema);
  for (const member of members) {
    const resolved = deref(doc, member, depth);
    if (resolved) absorb(flattenAllOf(doc, resolved, depth + 1));
  }

  if (Object.keys(properties).length > 0) merged["properties"] = properties;
  if (required.length > 0) merged["required"] = [...new Set(required)].sort();
  return merged;
}

function typeSet(schema: JsonObject): string[] {
  const type = schema["type"];
  const types = Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : typeof type === "string"
      ? [type]
      : [];
  // OAS 3.0 spells nullability as a sibling flag; 3.1 puts "null" in the type.
  if (schema["nullable"] === true && !types.includes("null")) types.push("null");
  return types.sort();
}

function isNullable(schema: JsonObject): boolean {
  return typeSet(schema).includes("null");
}

function enumSet(schema: JsonObject): string[] {
  const values = schema["enum"];
  if (!Array.isArray(values)) return [];
  return values.map((v) => JSON.stringify(v)).sort();
}

function requiredSet(schema: JsonObject): Set<string> {
  const req = schema["required"];
  if (!Array.isArray(req)) return new Set();
  return new Set(req.filter((r): r is string => typeof r === "string"));
}

function join(fieldPath: string | undefined, key: string): string {
  return fieldPath ? `${fieldPath}.${key}` : key;
}

/**
 * Recursive schema comparison.
 *
 * `direction` is not cosmetic: on a request, losing a property and gaining a
 * requirement are the breaks; on a response, losing a property and losing a
 * guarantee are. Running this with the wrong direction produces a plausible
 * and completely wrong severity.
 */
export function diffSchema(
  beforeRaw: Json | undefined,
  afterRaw: Json | undefined,
  ctx: DiffContext,
  at: string,
  fieldPath?: string,
  depth = 0,
): void {
  if (depth > MAX_DEPTH) return;

  const beforeRef = isObject(beforeRaw) ? beforeRaw["$ref"] : undefined;
  const afterRef = isObject(afterRaw) ? afterRaw["$ref"] : undefined;
  if (typeof beforeRef === "string" || typeof afterRef === "string") {
    const key = `${ctx.direction}|${beforeRef ?? ""}|${afterRef ?? ""}`;
    if (ctx.seen.has(key)) return;
    ctx.seen.add(key);
  }

  const beforeResolved = deref(ctx.beforeDoc, beforeRaw ?? null);
  const afterResolved = deref(ctx.afterDoc, afterRaw ?? null);
  if (!beforeResolved || !afterResolved) return;

  const before = flattenAllOf(ctx.beforeDoc, beforeResolved);
  const after = flattenAllOf(ctx.afterDoc, afterResolved);

  const { direction, emit, location } = ctx;
  const base = { ...location, fieldPath };

  // ── type ────────────────────────────────────────────────────────────
  const beforeTypes = typeSet(before);
  const afterTypes = typeSet(after);
  if (
    beforeTypes.length > 0 &&
    afterTypes.length > 0 &&
    beforeTypes.join(",") !== afterTypes.join(",")
  ) {
    // A response value merely becoming nullable is a lost guarantee, not a
    // retype, and it is the single most common way a consumer gets a
    // surprise null in production.
    const onlyNullabilityGained =
      !isNullable(before) &&
      isNullable(after) &&
      beforeTypes.join(",") === afterTypes.filter((t) => t !== "null").join(",");

    if (onlyNullabilityGained && direction === "response") {
      emit({
        ...base,
        ruleId: "response.property.became-optional",
        jsonPointer: at,
        before: beforeTypes.join("|"),
        after: afterTypes.join("|"),
        detail: "can now be null",
      });
    } else {
      emit({
        ...base,
        ruleId:
          direction === "request"
            ? "request.property.type-changed"
            : "response.property.type-changed",
        jsonPointer: at,
        before: beforeTypes.join("|"),
        after: afterTypes.join("|"),
        detail: `${beforeTypes.join("|")} → ${afterTypes.join("|")}`,
      });
    }
  }

  // `format` narrows a type. int64 becoming string is the classic ID migration.
  const beforeFormat = before["format"];
  const afterFormat = after["format"];
  if (
    typeof beforeFormat === "string" &&
    typeof afterFormat === "string" &&
    beforeFormat !== afterFormat
  ) {
    emit({
      ...base,
      ruleId:
        direction === "request"
          ? "request.property.type-changed"
          : "response.property.type-changed",
      jsonPointer: `${at}/format`,
      before: beforeFormat,
      after: afterFormat,
      detail: `format ${beforeFormat} → ${afterFormat}`,
    });
  }

  // ── enum ────────────────────────────────────────────────────────────
  const beforeEnum = enumSet(before);
  const afterEnum = enumSet(after);
  if (beforeEnum.length > 0 || afterEnum.length > 0) {
    if (direction === "request") {
      const withdrawn = beforeEnum.filter((v) => !afterEnum.includes(v));
      if (withdrawn.length > 0) {
        emit({
          ...base,
          ruleId: "request.enum.value-removed",
          jsonPointer: `${at}/enum`,
          before: beforeEnum.join(", "),
          after: afterEnum.join(", "),
          detail: `no longer accepts ${withdrawn.join(", ")}`,
        });
      }
    } else {
      // Direction flip 2.
      const introduced = afterEnum.filter((v) => !beforeEnum.includes(v));
      if (introduced.length > 0 && beforeEnum.length > 0) {
        emit({
          ...base,
          ruleId: "response.enum.value-added",
          jsonPointer: `${at}/enum`,
          before: beforeEnum.join(", "),
          after: afterEnum.join(", "),
          detail: `can now return ${introduced.join(", ")}`,
        });
      }
    }
  }

  // ── default ─────────────────────────────────────────────────────────
  const beforeDefault = before["default"];
  const afterDefault = after["default"];
  if (
    beforeDefault !== undefined &&
    afterDefault !== undefined &&
    JSON.stringify(beforeDefault) !== JSON.stringify(afterDefault)
  ) {
    emit({
      ...base,
      ruleId: isPaginationField(fieldPath)
        ? "pagination.default-changed"
        : "default.value-changed",
      jsonPointer: `${at}/default`,
      before: beforeDefault,
      after: afterDefault,
      detail: `${JSON.stringify(beforeDefault)} → ${JSON.stringify(afterDefault)}`,
    });
  }

  // ── required ────────────────────────────────────────────────────────
  const beforeRequired = requiredSet(before);
  const afterRequired = requiredSet(after);

  if (direction === "request") {
    for (const key of afterRequired) {
      if (!beforeRequired.has(key)) {
        emit({
          ...base,
          ruleId: "request.property.became-required",
          jsonPointer: `${at}/required`,
          fieldPath: join(fieldPath, key),
          after: key,
        });
      }
    }
  } else {
    // Direction flip 1.
    for (const key of beforeRequired) {
      if (!afterRequired.has(key)) {
        emit({
          ...base,
          ruleId: "response.property.became-optional",
          jsonPointer: `${at}/required`,
          fieldPath: join(fieldPath, key),
          before: key,
          detail: "no longer guaranteed present",
        });
      }
    }
  }

  // ── properties ──────────────────────────────────────────────────────
  const beforeProps = isObject(before["properties"]) ? before["properties"] : {};
  const afterProps = isObject(after["properties"]) ? after["properties"] : {};

  for (const key of Object.keys(beforeProps)) {
    const childPointer = `${at}/properties${pointer(key)}`;
    const childField = join(fieldPath, key);

    if (!(key in afterProps)) {
      emit({
        ...base,
        ruleId:
          direction === "request"
            ? "request.property.removed"
            : "response.property.removed",
        jsonPointer: childPointer,
        fieldPath: childField,
        before: key,
      });
      continue;
    }
    diffSchema(
      beforeProps[key]!,
      afterProps[key]!,
      ctx,
      childPointer,
      childField,
      depth + 1,
    );
  }

  for (const key of Object.keys(afterProps)) {
    if (key in beforeProps) continue;
    emit({
      ...base,
      ruleId:
        direction === "request"
          ? "request.property.added"
          : "response.property.added",
      jsonPointer: `${at}/properties${pointer(key)}`,
      fieldPath: join(fieldPath, key),
      after: key,
    });
  }

  // ── arrays and maps ─────────────────────────────────────────────────
  if (before["items"] !== undefined || after["items"] !== undefined) {
    diffSchema(
      before["items"],
      after["items"],
      ctx,
      `${at}/items`,
      fieldPath ? `${fieldPath}[]` : undefined,
      depth + 1,
    );
  }
  if (isObject(before["additionalProperties"]) || isObject(after["additionalProperties"])) {
    diffSchema(
      before["additionalProperties"],
      after["additionalProperties"],
      ctx,
      `${at}/additionalProperties`,
      fieldPath ? `${fieldPath}[key]` : undefined,
      depth + 1,
    );
  }

  // ── composition ─────────────────────────────────────────────────────
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const beforeArm = before[keyword];
    const afterArm = after[keyword];
    if (!Array.isArray(beforeArm) && !Array.isArray(afterArm)) continue;

    const beforeLen = Array.isArray(beforeArm) ? beforeArm.length : 0;
    const afterLen = Array.isArray(afterArm) ? afterArm.length : 0;

    if (beforeLen !== afterLen) {
      emit({
        ...base,
        ruleId: "schema.composition-changed",
        jsonPointer: `${at}/${keyword}`,
        before: beforeLen,
        after: afterLen,
        detail: `${keyword}: ${beforeLen} → ${afterLen} variants`,
      });
      continue;
    }
    // Same arity: compare positionally. Canonicalization has already sorted
    // what it safely can, so this is the best available alignment.
    for (let i = 0; i < beforeLen; i++) {
      diffSchema(
        (beforeArm as Json[])[i]!,
        (afterArm as Json[])[i]!,
        ctx,
        `${at}/${keyword}/${i}`,
        fieldPath,
        depth + 1,
      );
    }
  }
}

const PAGINATION_FIELDS = new Set([
  "limit",
  "per_page",
  "perpage",
  "page_size",
  "pagesize",
  "count",
  "max_results",
  "maxresults",
  "page_limit",
]);

export function isPaginationField(fieldPath: string | undefined): boolean {
  if (!fieldPath) return false;
  const leaf = fieldPath.split(".").pop()!.toLowerCase();
  return PAGINATION_FIELDS.has(leaf);
}
