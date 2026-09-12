import { PrismaClient } from "@prisma/client";

/**
 * One client per process, kept on globalThis so Next's dev-mode module
 * reloading does not open a new pool on every edit and exhaust Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
