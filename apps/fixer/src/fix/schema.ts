import type { JsonObject } from "@driftwatch/core";

/**
 * What the specs on either side of a change say about one field: whether a
 * removed field was renamed, whether it was optional, and what value a newly
 * required one documents. Everything a patch is allowed to rely on comes from
 * here, and every answer is "no" unless the specs say so plainly.
 */

function isObject(x: unknown): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const unescape = (t: string) => t.replace(/~1/g, "/").replace(/~0/g, "~");

export function deref(spec: JsonObject, node: unknown): unknown {
  let x = node;
  for (let i = 0; i < 10 && isObject(x) && typeof x["$ref"] === "string"; i++) {
    const ref = x["$ref"] as string;
    if (!ref.startsWith("#/")) return x;
    x = ref
      .slice(2)
      .split("/")
      .reduce<unknown>((at, t) => (isObject(at) ? at[unescape(t)] : undefined), spec);
  }
  return x;
}

/** `allOf` members merged into one object schema: later members win (CLAUDE.md note 8). */
function flatten(spec: JsonObject, node: unknown): unknown {
  const x = deref(spec, node);
  if (!isObject(x) || !Array.isArray(x["allOf"])) return x;
  const properties: JsonObject = {};
  const required = new Set<string>();
  const merged: JsonObject = { ...x };
  delete merged["allOf"];
  for (const member of [...(x["allOf"] as unknown[]), merged]) {
    const m = member === merged ? merged : flatten(spec, member);
    if (!isObject(m)) continue;
    if (isObject(m["properties"])) Object.assign(properties, m["properties"]);
    if (Array.isArray(m["required"])) for (const r of m["required"]) if (typeof r === "string") required.add(r);
  }
  return { ...merged, properties, required: [...required] };
}

/**
 * Walk a pointer the diff produced. The diff resolves `$ref`s and flattens
 * `allOf` as it walks, so the pointer does too.
 */
export function at(spec: JsonObject, pointer: string): unknown {
  let node: unknown = spec;
  for (const token of pointer.split("/").slice(1).map(unescape)) {
    if (Array.isArray(node)) {
      node = node[Number(token)];
      continue;
    }
    let x = deref(spec, node);
    if (isObject(x) && !(token in x)) x = flatten(spec, x);
    node = isObject(x) ? x[token] : undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** Keys that describe a schema without changing what it accepts or returns. */
const PROSE = new Set(["description", "title", "example", "examples", "externalDocs", "deprecated"]);

/** A schema's shape: refs resolved, prose and extensions dropped, keys sorted. */
function shape(spec: JsonObject, node: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  const x = deref(spec, node);
  if (Array.isArray(x)) return x.map((v) => shape(spec, v, depth + 1));
  if (!isObject(x)) return x;
  const out: JsonObject = {};
  for (const key of Object.keys(x).sort()) {
    if (PROSE.has(key) || key.startsWith("x-")) continue;
    out[key] = shape(spec, x[key], depth + 1) as JsonObject[string];
  }
  return out;
}

const sameShape = (a: JsonObject, x: unknown, b: JsonObject, y: unknown) =>
  JSON.stringify(shape(a, x)) === JSON.stringify(shape(b, y));

const words = (text: unknown) =>
  new Set(
    String(typeof text === "string" ? text : "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/**
 * Whether the spec describes the new field as the old one. Real renames keep
 * the description and change a word (Plaid's "Protect Session ID" became
 * "Device Session ID"); a replacement with different behaviour says so
 * (Stripe's `allowed_payment_method_types`: "Unlike `payment_method_types`,
 * this acts as a filter"), and has the same shape all the same.
 */
function describedAlike(a: unknown, b: unknown, from: string, to: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 && y.size === 0) return true;
  if (x.size === 0 || y.size === 0) return false;
  // Words that differ only because they name the field are no difference.
  const names = words(`${from} ${to}`.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "));
  const differ = [...x].filter((w) => !y.has(w)).concat([...y].filter((w) => !x.has(w)));
  if (differ.every((w) => names.has(w))) return true;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.75;
}

const stem = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/ies$/, "y")
    .replace(/(s|es)$/, "");

/** Names that read as the same thing: plural and singular, or one inside the other. */
function related(a: string, b: string): boolean {
  const x = stem(a);
  const y = stem(b);
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
}

const description = (spec: JsonObject, node: unknown): unknown => {
  const x = deref(spec, node);
  if (isObject(x) && x["description"] !== undefined) return x["description"];
  return isObject(node) ? node["description"] : undefined;
};

export type Removal =
  | { kind: "renamed"; to: string; description?: string }
  | { kind: "removed"; optional: boolean; description?: string }
  /** A same-shape field appeared beside it, described differently: maybe its replacement, maybe not. */
  | { kind: "replaced-maybe"; candidates: string[] }
  | { kind: "unknown"; reason: string };

/** Siblings of a removed property, or of a removed parameter, before and after. */
interface Siblings {
  name: string;
  before: Map<string, unknown>;
  after: Map<string, unknown>;
  required: boolean;
}

function propertySiblings(before: JsonObject, after: JsonObject, pointer: string): Siblings | string {
  const match = /^(.*)\/properties\/([^/]+)$/.exec(pointer);
  if (!match) return "the change does not point at a property";
  const [, parentPointer, token] = match;
  const name = unescape(token!);
  const parentBefore = flatten(before, at(before, parentPointer!));
  const parentAfter = flatten(after, at(after, parentPointer!));
  if (!isObject(parentBefore) || !isObject(parentAfter)) return "the parent schema is not in both specs";
  const props = (p: JsonObject) => new Map(Object.entries(isObject(p["properties"]) ? p["properties"] : {}));
  const required = Array.isArray(parentBefore["required"]) && parentBefore["required"].includes(name);
  return { name, before: props(parentBefore), after: props(parentAfter), required };
}

function parameterSiblings(before: JsonObject, after: JsonObject, pointer: string): Siblings | string {
  const match = /^(.*)\/parameters\/([^/]+)$/.exec(pointer);
  if (!match) return "the change does not point at a parameter";
  const [, opPointer, token] = match;
  const [location, ...rest] = unescape(token!).split(":");
  const name = rest.join(":");
  const params = (spec: JsonObject) => {
    const op = deref(spec, at(spec, opPointer!));
    const list = isObject(op) && Array.isArray(op["parameters"]) ? op["parameters"] : [];
    const map = new Map<string, unknown>();
    for (const p of list.map((x) => deref(spec, x))) {
      if (isObject(p) && p["in"] === location && typeof p["name"] === "string") map.set(p["name"], p);
    }
    return map;
  };
  const b = params(before);
  const old = b.get(name);
  if (!old) return "the parameter is not in the earlier spec";
  return { name, before: b, after: params(after), required: isObject(old) && old["required"] === true };
}

/** What became of a removed request or response field. */
export function classifyRemoval(before: JsonObject | undefined, after: JsonObject, pointer: string, isParameter: boolean): Removal {
  if (!before) return { kind: "unknown", reason: "no earlier spec to compare: a hosted source keeps no history, and a git change needs its earlier commit" };
  const s = isParameter ? parameterSiblings(before, after, pointer) : propertySiblings(before, after, pointer);
  if (typeof s === "string") return { kind: "unknown", reason: s };
  const old = s.before.get(s.name);
  if (old === undefined) return { kind: "unknown", reason: "the field is not in the earlier spec" };
  const added = [...s.after.keys()].filter((k) => !s.before.has(k));
  const removed = [...s.before.keys()].filter((k) => !s.after.has(k));
  const schemaOf = (p: unknown) => (isParameter && isObject(p) ? { schema: p["schema"], required: p["required"] } : p);

  const sameShaped = added.filter((k) => sameShape(before, schemaOf(old), after, schemaOf(s.after.get(k))));
  const oldDescription = description(before, old);
  if (sameShaped.length === 0) {
    // Stripe's `filters.countries` (a list) became `country` (one string):
    // no shape matches, but deleting the field would drop the filter.
    const kin = added.filter((k) => related(s.name, k));
    if (kin.length > 0) return { kind: "replaced-maybe", candidates: kin };
    return { kind: "removed", optional: !s.required, description: typeof oldDescription === "string" ? oldDescription : undefined };
  }
  const alike = sameShaped.filter((k) => describedAlike(oldDescription, description(after, s.after.get(k)), s.name, k));
  // One candidate, and it is not equally the heir of another removed field.
  if (alike.length === 1 && sameShaped.length === 1) {
    const to = alike[0]!;
    const rivals = removed.filter(
      (r) => r !== s.name && sameShape(before, schemaOf(s.before.get(r)), after, schemaOf(s.after.get(to))),
    );
    if (rivals.length === 0) return { kind: "renamed", to, description: typeof oldDescription === "string" ? oldDescription : undefined };
  }
  return { kind: "replaced-maybe", candidates: sameShaped };
}

export type Documented = { found: true; value: unknown; source: "const" | "enum" | "default" } | { found: false; reason: string };

/** Whether any deprecation note on the schema mentions this value. */
function deprecates(schema: JsonObject, value: unknown): boolean {
  if (schema["deprecated"] === true) return true;
  const text = JSON.stringify(value);
  return Object.entries(schema).some(([k, v]) => /deprecat/i.test(k) && JSON.stringify(v).includes(text));
}

/**
 * The one value the new spec documents for a newly required field: a `const`,
 * a single-value `enum`, or a `default`. Only the new spec counts: OpenAI made
 * `CreateImageRequest.model` required and dropped its old default, `dall-e-2`,
 * in the same release, because that model had been retired.
 */
export function documentedValue(after: JsonObject, schema: unknown): Documented {
  const x = flatten(after, schema);
  if (!isObject(x)) return { found: false, reason: "no schema for the field" };
  if (x["const"] !== undefined && !deprecates(x, x["const"])) return { found: true, value: x["const"], source: "const" };
  if (Array.isArray(x["enum"])) {
    const values = x["enum"].filter((v) => v !== null);
    if (values.length === 1 && !deprecates(x, values[0])) return { found: true, value: values[0], source: "enum" };
  }
  if (x["default"] !== undefined && !deprecates(x, x["default"])) return { found: true, value: x["default"], source: "default" };
  return { found: false, reason: "the spec documents no single value for it" };
}

/** The schema of a newly required field, from a fact pointing at `…/required` or at a parameter. */
export function requiredFieldSchema(after: JsonObject, pointer: string, name: string): unknown {
  const param = /^(.*)\/parameters\/([^/]+)\/required$/.exec(pointer) ?? /^(.*)\/parameters\/([^/]+)$/.exec(pointer);
  if (param) {
    const [location, ...rest] = unescape(param[2]!).split(":");
    const op = deref(after, at(after, param[1]!));
    const list = isObject(op) && Array.isArray(op["parameters"]) ? op["parameters"] : [];
    const p = list.map((x) => deref(after, x)).find((x) => isObject(x) && x["in"] === location && x["name"] === rest.join(":"));
    return isObject(p) ? p["schema"] : undefined;
  }
  const parent = flatten(after, at(after, pointer.replace(/\/required$/, "")));
  return isObject(parent) && isObject(parent["properties"]) ? parent["properties"][name] : undefined;
}
