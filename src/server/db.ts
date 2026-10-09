import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton (moved from src/lib/db.ts — server code only).
 *
 * Lives under src/server so the client bundle can never reach it; route
 * handlers obtain persistence exclusively through the composition root
 * (src/server/composition.ts).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging is a development aid — in production it would drag
    // performance and leak full JSON blob parameters into the logs.
    log: process.env.NODE_ENV === "production" ? ["error"] : ["query"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
