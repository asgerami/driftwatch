import { PrismaClient } from "@prisma/client";

/**
 * Lazily constructed.
 *
 * `PrismaClient` throws at construction if the client has not been generated,
 * and the CLI imports every command up front. Without this, `verify` and
 * `discover` — neither of which touches Postgres — would fail on a machine
 * that has not run `prisma generate` yet. Deferring construction to first
 * property access keeps the database-free commands database-free.
 */
let client: PrismaClient | null = null;

function instance(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env["PRISMA_DEBUG"]
        ? ["query", "warn", "error"]
        : ["warn", "error"],
    });
  }
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
