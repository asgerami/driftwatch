import type { Json, JsonObject } from "../types.js";

export type Direction = "request" | "response";

export interface RawChange {
  ruleId: string;
  jsonPointer: string;
  method?: string;
  path?: string;
  operationId?: string;
  /** Set when the change belongs to a shared component rather than one operation. */
  componentName?: string;
  /** How many operations can reach this component. */
  affectedOperations?: number;
  /** A few of those operations, for the feed to show. */
  affectedSample?: string[];
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
  location: {
    method?: string;
    path?: string;
    operationId?: string;
    componentName?: string;
    affectedOperations?: number;
    affectedSample?: string[];
  };
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

function isNullArm(arm: Json): boolean {
  if (!isObject(arm) || typeof arm["$ref"] === "string") return false;
  const types = typeSet(arm);
  return types.length === 1 && types[0] === "null";
}

/**
 * "This schema, or null" has two common spellings: OAS 3.0's
 * `allOf: [X, {nullable: true}]` and 3.1's `anyOf: [X, {type: "null"}]`
 * (or `oneOf`). They mean the same thing, but only `allOf` is flattened, so a
 * provider switching spelling read as every field of X removed and no longer
 * guaranteed. Found in real OpenAI history (Upload.file, 7140eb70 → 4399577e):
 * 16 false breaks from one edit. Rewrite the union form into the `allOf` form
 * so both sides reach the comparison in the same shape. Only an exact pair of
 * one schema and one null arm is rewritten; any other union is a real union.
 */
function isUnion(schema: JsonObject): boolean {
  return Array.isArray(schema["anyOf"]) || Array.isArray(schema["oneOf"]);
}

export function unwrapNullable(schema: JsonObject): JsonObject {
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const arms = schema[keyword];
    if (!Array.isArray(arms) || arms.length !== 2) continue;
    const nullIndex = arms.findIndex(isNullArm);
    if (nullIndex === -1) continue;
    const other = arms[1 - nullIndex]!;
    if (isNullArm(other)) continue;

    const rest: JsonObject = { ...schema };
    delete rest[keyword];
    const allOf = Array.isArray(rest["allOf"]) ? rest["allOf"] : [];
    return { ...rest, allOf: [...allOf, other], nullable: true };
  }
  return schema;
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
  /**
   * True when this schema is a property its parent did not require before.
   * Such a field never guaranteed a value, which changes what gaining null
   * means. Anything else (a root, array items, a required property) is
   * treated as guaranteed.
   */
  optionalInParent = false,
): void {
  if (depth > MAX_DEPTH) return;

  /**
   * Stop at every `$ref`. This is the single most important line in the diff.
   *
   * Following refs inline looks correct and is catastrophic in practice.
   * Stripe's schemas nest deeply through shared components, so one enum
   * gaining a value gets rediscovered along every path that can reach it:
   * measured on real history, a single change to `fpx.bank` surfaced 2319
   * times in one diff, and one pair produced 4528 "breaking" changes. No
   * inbox survives that.
   *
   * Shared components are diffed once each, by name, in `diffComponents`,
   * and carry the count of operations they affect. What remains here is the
   * inline portion of a schema, which genuinely does belong to its operation.
   */
  const beforeRef = isObject(beforeRaw) ? beforeRaw["$ref"] : undefined;
  const afterRef = isObject(afterRaw) ? afterRaw["$ref"] : undefined;
  if (typeof beforeRef === "string" || typeof afterRef === "string") {
    // Repointing a field at a different component IS an operation-level
    // change, and one the component diff cannot see.
    if (
      typeof beforeRef === "string" &&
      typeof afterRef === "string" &&
      beforeRef !== afterRef
    ) {
      // A repoint is usually a rename, not a retype. Providers split and
      // rename shared schemas constantly, and calling every one of those a
      // BREAKING type change at confidence 95 floods the feed with work
      // nobody has to do. Compare the two targets: an identical shape means
      // a rename, and anything else is genuinely ambiguous, so it lands as
      // BEHAVIORAL below the publish threshold rather than as a break.
      const identical = refTargetsMatch(ctx, beforeRef, afterRef);
      ctx.emit({
        ...ctx.location,
        fieldPath,
        ruleId: identical ? "cosmetic.schema-renamed" : "schema.ref-retargeted",
        jsonPointer: at,
        before: beforeRef,
        after: afterRef,
        detail: shortRef(beforeRef) + " \u2192 " + shortRef(afterRef),
      });
    }
    return;
  }

  const beforeResolved = deref(ctx.beforeDoc, beforeRaw ?? null);
  const afterResolved = deref(ctx.afterDoc, afterRaw ?? null);
  if (!beforeResolved || !afterResolved) return;

  // Rewrite the nullable spelling only when it makes the sides comparable. If
  // either side is still a genuine union, compare both as written: the
  // composition check below then reports the union change once, instead of
  // every field of the flattened side reading as removed. Real case:
  // FineTuningJob.error went `X | null` to `X | null | {}` (9654de53 →
  // 883357cf); unwrapping only the before side produced 6 false breaks.
  let beforeShape = unwrapNullable(beforeResolved);
  let afterShape = unwrapNullable(afterResolved);
  if (isUnion(beforeShape) || isUnion(afterShape)) {
    beforeShape = beforeResolved;
    afterShape = afterResolved;
  }
  const before = flattenAllOf(ctx.beforeDoc, beforeShape);
  const after = flattenAllOf(ctx.afterDoc, afterShape);

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

    if (onlyNullabilityGained) {
      // Direction decides everything here. On a response, gaining null is a
      // lost guarantee and the commonest way a consumer meets a surprise
      // null in production. On a REQUEST it is the opposite: you may now
      // send null where you could not before, and every existing payload is
      // still valid. Reporting that as a breaking retype was a false
      // positive found in real GitHub data (custom-property-value.value,
      // string -> null|string).
      //
      // A response field that was never required had no guarantee of a
      // value to lose: callers already handle it being absent, and null is a
      // far smaller step than a required field going missing. Found when
      // Square moved its spec from Swagger 2.0 to OpenAPI 3.0 (9bb37051) and
      // annotated 1759 fields nullable, 6 of them required: 841 "breaking"
      // changes from one format migration. Held for review, not published.
      emit({
        ...base,
        ruleId:
          direction === "request"
            ? "request.property.became-nullable"
            : optionalInParent
              ? "response.property.optional-now-nullable"
              : "response.property.became-optional",
        jsonPointer: at,
        before: beforeTypes.join("|"),
        after: afterTypes.join("|"),
        detail: "can now be null",
      });
    } else if (
      direction === "response" &&
      afterTypes.every((t) => beforeTypes.includes(t))
    ) {
      // A response that can return fewer types than before is a tighter
      // guarantee: everything it can return now, it could return already, so
      // existing handling still covers it. Found in real data: OpenAI's
      // ChatCompletionList.first_id and Stripe's expected_debit_date went
      // null|string → string, reported as breaking retypes at confidence 95.
      // On a request the same edit IS a break (you can no longer send the
      // dropped type) and stays type-changed below.
      //
      // Narrowed all the way to null is different: nothing throws, but the
      // value is gone. Twilio and Stripe both did this in ways that look like
      // generator artifacts, so it is held below the publish threshold.
      const alwaysNull = afterTypes.length === 1 && afterTypes[0] === "null";
      emit({
        ...base,
        ruleId: alwaysNull
          ? "response.property.now-always-null"
          : "response.property.type-narrowed",
        jsonPointer: at,
        before: beforeTypes.join("|"),
        after: afterTypes.join("|"),
        detail: `${beforeTypes.join("|")} → ${afterTypes.join("|")}`,
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
    // Losing the enum keyword altogether is a WIDENING, not the withdrawal
    // of every value. Real data made this obvious: Stripe's checkout
    // ui_mode reported "no longer accepts custom, embedded, form, hosted",
    // i.e. every value it ever had, which is never what a provider means.
    const constraintDropped = beforeEnum.length > 0 && afterEnum.length === 0;

    if (direction === "request") {
      if (constraintDropped) {
        emit({
          ...base,
          ruleId: "request.enum.constraint-removed",
          jsonPointer: `${at}/enum`,
          before: beforeEnum.join(", "),
          detail: "the documented value list is gone; more is accepted now",
        });
      } else {
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
      }
    } else if (constraintDropped) {
      // The mirror image on a response, and previously missed entirely:
      // an unconstrained field can return anything, so exhaustive handling
      // is now incomplete even though no single value was "added".
      emit({
        ...base,
        ruleId: "response.enum.constraint-removed",
        jsonPointer: `${at}/enum`,
        before: beforeEnum.join(", "),
        detail: "any value can now appear",
      });
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
      !beforeRequired.has(key),
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

/**
 * Do two `$ref` targets describe the same shape?
 *
 * Compared one level deep, with nested refs left as the strings they are.
 * A deep walk would have to chase cycles, and would call a real change
 * identical whenever a nested schema happened to be renamed too. Shallow and
 * certain beats deep and wrong here: the only job is separating "pure rename"
 * from "worth a human look".
 */
function refTargetsMatch(
  ctx: DiffContext,
  beforeRef: string,
  afterRef: string,
): boolean {
  const before = resolveRef(ctx.beforeDoc, beforeRef);
  const after = resolveRef(ctx.afterDoc, afterRef);
  if (!before || !after) return false;
  return JSON.stringify(before) === JSON.stringify(after);
}

export function shortRef(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

/** Component name if this is a local component-schema ref, else null. */
export function componentNameOf(ref: string): string | null {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length).replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Every component schema reachable from `schema`, following refs transitively.
 * Used to work out which operations an eventual component change affects.
 */
export function collectComponentRefs(
  doc: JsonObject,
  schema: Json | undefined,
  out: Set<string> = new Set(),
  visiting: Set<string> = new Set(),
  depth = 0,
): Set<string> {
  if (depth > MAX_DEPTH * 3 || schema === undefined || schema === null) return out;

  if (Array.isArray(schema)) {
    for (const item of schema) collectComponentRefs(doc, item, out, visiting, depth + 1);
    return out;
  }
  if (!isObject(schema)) return out;

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const name = componentNameOf(ref);
    if (name) {
      out.add(name);
      if (!visiting.has(name)) {
        visiting.add(name);
        const target = resolveRef(doc, ref);
        if (target) collectComponentRefs(doc, target, out, visiting, depth + 1);
      }
    }
    return out;
  }

  for (const value of Object.values(schema)) {
    collectComponentRefs(doc, value, out, visiting, depth + 1);
  }
  return out;
}

export function isPaginationField(fieldPath: string | undefined): boolean {
  if (!fieldPath) return false;
  const leaf = fieldPath.split(".").pop()!.toLowerCase();
  return PAGINATION_FIELDS.has(leaf);
}
