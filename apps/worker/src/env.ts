import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Load the repo-root .env into process.env.
 *
 * Node only reads .env with an explicit --env-file flag, and that flag would
 * have to be repeated on every script in every package. In a monorepo the file
 * also lives at the root while commands run from inside apps/, so a plain
 * relative path does not find it. Walk up instead.
 *
 * Existing environment variables always win, so a value exported in the shell
 * or injected by a deploy platform is never clobbered by a stale local file.
 */
export function loadEnv(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      applyEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function applyEnvFile(path: string): void {
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
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
}
