import { createRequire } from "node:module";
import type { PrismaClient } from "@prisma/client";

import { requireDatabaseUrl } from "./config.js";

/**
 * Loaded on first use, not at import time.
 *
 * Before `prisma generate` has run, `@prisma/client` exports nothing, and a
 * static ESM import of it fails while the module graph is being built. That
 * takes down the whole CLI — including `verify`, `discover` and `preview`,
 * none of which touch Postgres — with an error about a missing named export
 * that says nothing about the real cause.
 *
 * The type import above is erased at compile time, so it costs nothing at
 * runtime. The require happens only when something actually reads a property
 * off `prisma`.
 */
const require = createRequire(import.meta.url);

let client: PrismaClient | null = null;

function instance(): PrismaClient {
  if (client) return client;

  // Fail with a sentence that says what to do, not a connection stack trace.
  requireDatabaseUrl();

  let PrismaClientCtor: new (options?: unknown) => PrismaClient;
  try {
    const mod = require("@prisma/client") as {
      PrismaClient?: new (options?: unknown) => PrismaClient;
    };
    if (!mod.PrismaClient) throw new Error("PrismaClient is not exported");
    PrismaClientCtor = mod.PrismaClient;
  } catch (err) {
    throw new Error(
      `The Prisma client is not available (${(err as Error).message}). ` +
        `Run "pnpm generate" first. Commands that do not need a database ` +
        `(verify, discover, preview) work without it.`,
    );
  }

  client = new PrismaClientCtor({
    log: process.env["PRISMA_DEBUG"] ? ["query", "warn", "error"] : ["warn", "error"],
  });
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(instance(), property, receiver);
    return typeof value === "function" ? value.bind(instance()) : value;
  },
});

export async function disconnect(): Promise<void> {
  if (client) await client.$disconnect();
}
