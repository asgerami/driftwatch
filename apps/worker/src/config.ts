import { dirname, isAbsolute, resolve } from "node:path";

import { loadEnv } from "./env.js";

// Must run before anything below reads process.env.
export const envFile = loadEnv();

/**
 * The repo root, taken as wherever .env was found.
 *
 * A relative DATA_DIR must anchor here, not to the current directory. pnpm
 * runs a filtered script inside its package, so `./.data` would mean
 * apps/worker/.data from `pnpm w` and ./.data from the repo root: two caches,
 * and a second multi-gigabyte clone of every provider repo the first time
 * someone runs a command from the other place.
 */
const repoRoot = envFile ? dirname(envFile) : process.cwd();

function dataDirOf(value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

/**
 * DATABASE_URL is deliberately NOT required here.
 *
 * Prisma reads it from the environment itself, and demanding it at import
 * time would take down `verify`, `preview` and `discover` — none of which
 * touch Postgres — on a machine that has not set it up yet. Commands that
 * need it call `requireDatabaseUrl()` and get a useful message.
 */
export const config = {
  dataDir: dataDirOf(process.env["DATA_DIR"] ?? "./.data"),
  githubToken: process.env["GITHUB_TOKEN"] ?? "",
  databaseUrl: process.env["DATABASE_URL"] ?? "",
};

export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and start Postgres " +
        "with `pnpm db:up`. Commands that need no database: verify, preview, discover.",
    );
  }
  return config.databaseUrl;
}

export const paths = {
  repos: resolve(config.dataDir, "repos"),
  blobs: resolve(config.dataDir, "blobs"),
};
