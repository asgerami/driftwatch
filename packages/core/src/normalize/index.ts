import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import swagger2openapi from "swagger2openapi";

import {
  HTTP_METHODS,
  type Json,
  type JsonObject,
  type NormalizeOptions,
  type NormalizedSpec,
  type SpecStats,
} from "../types.js";
import {
  canonicalizeDocument,
  serializeCanonical,
  stripPointers,
} from "./canonicalize.js";

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON or YAML. Both appear in the wild; OpenAI publishes YAML, Stripe JSON. */
export function parseSpecText(text: string): JsonObject {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) throw new Error("spec root is not an object");
    return parsed;
  }
  const parsed = parseYaml(text);
  if (!isObject(parsed)) throw new Error("spec root is not an object");
  return parsed as JsonObject;
}

export function detectVersion(doc: JsonObject): string {
  if (typeof doc["openapi"] === "string") return doc["openapi"];
  if (typeof doc["swagger"] === "string") return doc["swagger"];
  throw new Error("document declares neither `openapi` nor `swagger`");
}

export function collectStats(doc: JsonObject): SpecStats {
  const paths = isObject(doc["paths"]) ? doc["paths"] : {};
  let opCount = 0;
  for (const key of Object.keys(paths)) {
    const item = paths[key];
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      if (isObject(item[method])) opCount++;
    }
  }

  const components = isObject(doc["components"]) ? doc["components"] : {};
  const schemas = isObject(components["schemas"]) ? components["schemas"] : {};
  const definitions = isObject(doc["definitions"]) ? doc["definitions"] : {};

  return {
    pathCount: Object.keys(paths).length,
    opCount,
    schemaCount: Object.keys(schemas).length + Object.keys(definitions).length,
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function upgradeIfSwagger2(
  doc: JsonObject,
  warnings: string[],
): Promise<{ doc: JsonObject; upgraded: boolean }> {
  if (typeof doc["swagger"] !== "string") return { doc, upgraded: false };

  const result = await swagger2openapi.convertObj(doc as never, {
    patch: true, // tolerate the small spec violations real-world 2.0 docs carry
    warnOnly: true,
    resolve: false,
  });

  const converted = (result as { openapi?: unknown }).openapi;
  if (!isObject(converted)) {
    warnings.push("swagger 2.0 upgrade returned no document; kept original");
    return { doc, upgraded: false };
  }
  return { doc: converted, upgraded: true };
}

/**
 * `bundle`, deliberately not `dereference`.
 *
 * Dereferencing a real provider spec produces circular JS objects — Stripe's
 * Charge references Customer which references Charge — and those cannot be
 * serialized or hashed. Bundling pulls in external documents while leaving
 * internal `$ref`s intact, which is both safe and what the diff layer wants:
 * oasdiff resolves references itself, and a change to a shared component
 * should surface once rather than at every call site that inlines it.
 */
async function bundleRefs(
  doc: JsonObject,
  basePath: string | undefined,
  warnings: string[],
): Promise<{ doc: JsonObject; bundled: boolean }> {
  try {
    const input = basePath
      ? ({ path: basePath, ...structuredClone(doc) } as never)
      : (structuredClone(doc) as never);
    const bundled = await $RefParser.bundle(input);
    if (!isObject(bundled)) return { doc, bundled: false };
    return { doc: bundled as JsonObject, bundled: true };
  } catch (err) {
    // A spec with unreachable external refs still has a diffable local
    // surface. Record it and carry on rather than dropping the snapshot.
    warnings.push(
      `bundle failed, using unbundled document: ${(err as Error).message}`,
    );
    return { doc, bundled: false };
  }
}

/**
 * Stage 2 of the pipeline. Pure, deterministic, and the only thing standing
 * between the diff engine and a firehose of phantom changes.
 */
export async function normalizeSpec(
  text: string,
  options: NormalizeOptions = {},
): Promise<NormalizedSpec> {
  const warnings: string[] = [];

  const parsed = parseSpecText(text);
  const sourceVersion = detectVersion(parsed);

  const { doc: upgraded, upgraded: upgradedFromSwagger2 } =
    await upgradeIfSwagger2(parsed, warnings);

  const { doc: resolved, bundled } = await bundleRefs(
    upgraded,
    options.basePath,
    warnings,
  );

  const stripped = stripPointers(resolved, options.volatilePointers ?? []);
  const document = canonicalizeDocument(stripped);
  const canonical = serializeCanonical(document);

  const oasVersion =
    typeof document["openapi"] === "string"
      ? document["openapi"]
      : sourceVersion;

  const stats = collectStats(document);
  if (stats.opCount === 0) {
    warnings.push("normalized document declares zero operations");
  }

  return {
    document,
    canonical,
    contentHash: sha256(canonical),
    sourceVersion,
    oasVersion,
    upgradedFromSwagger2,
    bundled,
    stats,
    warnings,
  };
}

export { canonicalizeDocument, serializeCanonical, stripPointers, parsePointer } from "./canonicalize.js";
export type { Json, JsonObject };
