import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Next reads .env from the app directory, but in this monorepo the file lives
 * at the repo root so the worker and the site share one configuration. Walk up
 * and load it before Next resolves anything.
 *
 * Shell values win, so a deploy platform's injected DATABASE_URL is never
 * overwritten by a developer's local file.
 */
function loadRootEnv(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        if (!key || key in process.env) continue;
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

loadRootEnv();

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@driftwatch/core"],
  webpack(config, { isServer }) {
    if (isServer) {
      // Prisma's Workers client loads its query compiler as
      // `import("./query_compiler_bg.wasm?module")`. Workers only run wasm
      // imported as a module, and webpack cannot parse it, so it stays an
      // external import, made absolute so it still resolves from Next's
      // output. OpenNext and Wrangler bundle it from there.
      const wasmModule = ({ request, context }, callback) =>
        request && /\.wasm\?module$/.test(request)
          ? callback(null, `import ${resolve(context, request)}`)
          : callback();
      config.externals = [wasmModule, ...(Array.isArray(config.externals) ? config.externals : [config.externals])];
    }
    return config;
  },
};
