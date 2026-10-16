import { PrismaNeonHTTP } from "@prisma/adapter-neon";

import { PrismaClient } from "../generated/prisma/client";

/**
 * The site's Prisma client, for Cloudflare Workers.
 *
 * No native query engine runs on Workers, so the client is Prisma's
 * TypeScript query compiler over Neon's HTTP driver (prisma/schema.prisma,
 * generator `web`). HTTP, not a pooled WebSocket: a Worker may not reuse one
 * request's socket in another, and each HTTP query is its own fetch. The site
 * only reads, plus one insert for the waitlist, so it never needs an
 * interactive transaction, the one thing HTTP mode cannot do.
 *
 * Built on first use, not at import: on Workers the environment is only
 * filled in once a request arrives.
 */
let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is not set");
    client = new PrismaClient({
      adapter: new PrismaNeonHTTP(url, {}),
      log: ["warn", "error"],
    });
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = Reflect.get(getClient(), property);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});
