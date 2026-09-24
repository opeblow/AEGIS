import { PrismaClient } from "@prisma/client";
import { getEnv } from "../config/env.js";

declare global {
  var __aegisPrisma: PrismaClient | undefined;
}

/**
 * Prisma requires a schema to exist before `@prisma/client` can be generated.
 * Phase 1 keeps the schema intentionally minimal (a single version/meta row)
 * only so the client and migration workflow are wired up correctly.
 */
function createPrismaClient(): PrismaClient {
  const env = getEnv();
  return new PrismaClient({
    datasources: {
      db: { url: env.DATABASE_URL },
    },
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * In development `tsx watch` can reload modules and would otherwise create a
 * new connection pool on every reload. Reuse a single client per process.
 */
export const prisma: PrismaClient =
  globalThis.__aegisPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__aegisPrisma = prisma;
}

/**
 * Best-effort connectivity probe used by the readiness endpoint and tests.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default prisma;
