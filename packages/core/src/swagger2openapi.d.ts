/**
 * `swagger2openapi` ships no type declarations and there is no @types package.
 * Only `convertObj` is used, so the surface is declared narrowly here rather
 * than pulling the whole module in as `any`.
 */
declare module "swagger2openapi" {
  interface ConvertOptions {
    /** Tolerate small spec violations that real-world 2.0 documents carry. */
    patch?: boolean;
    /** Collect problems instead of throwing on them. */
    warnOnly?: boolean;
    /** Resolve external references during conversion. */
    resolve?: boolean;
    [key: string]: unknown;
  }

  interface ConvertResult {
    openapi: unknown;
    warnings?: unknown[];
    [key: string]: unknown;
  }

  export function convertObj(
    swagger: unknown,
    options: ConvertOptions,
  ): Promise<ConvertResult>;

  const _default: { convertObj: typeof convertObj };
  export default _default;
}
