/**
 * Build-only: load `*.wasm?module` imports in Node the way Workers does.
 *
 * Prisma's Workers client imports its query compiler as
 * `import("./query_compiler_bg.wasm?module")` and expects a compiled
 * WebAssembly.Module, which is what Workers and Wrangler provide. `next build`
 * pre-renders pages in Node, which would load the file as an instance, and the
 * client fails. This hook gives Node the same module, so the build renders
 * pages from real data. Loaded through NODE_OPTIONS by `build:cf`; the Worker
 * never runs it.
 */
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    if (!/\.wasm\?module$/.test(url)) return nextLoad(url, context);
    const path = fileURLToPath(url.replace(/\?module$/, ""));
    return {
      format: "module",
      shortCircuit: true,
      source: [
        'import { readFileSync } from "node:fs";',
        `export default new WebAssembly.Module(readFileSync(${JSON.stringify(path)}));`,
      ].join("\n"),
    };
  },
});
