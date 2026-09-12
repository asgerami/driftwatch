export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface NormalizeOptions {
  /**
   * JSON Pointers (RFC 6901) removed before hashing. Use for values that
   * change on every publish without the API surface changing: build stamps,
   * rotating example ids, generator version strings.
   */
  volatilePointers?: string[];
  /** Base path or URL, so external `$ref`s can be resolved during bundling. */
  basePath?: string;
}

export interface SpecStats {
  pathCount: number;
  opCount: number;
  schemaCount: number;
}

export interface NormalizedSpec {
  /** Canonical form: upgraded to OAS 3.x, bundled, volatile keys stripped, keys sorted. */
  document: JsonObject;
  /** Deterministic JSON serialization of `document`. */
  canonical: string;
  /** sha256 of `canonical`. The dedup key. */
  contentHash: string;
  /** Version as declared by the source document, before any upgrade. */
  sourceVersion: string;
  /** Version after normalization. */
  oasVersion: string;
  upgradedFromSwagger2: boolean;
  bundled: boolean;
  stats: SpecStats;
  warnings: string[];
}
