import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const ACCELERATE_URL_PREFIX = "prisma+postgres://";

export const isAccelerateUrl = (url: string): boolean =>
  url.startsWith(ACCELERATE_URL_PREFIX);

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Accelerate is reached over its own protocol, not a driver adapter.
  return isAccelerateUrl(connectionString)
    ? new PrismaClient({ accelerateUrl: connectionString })
    : new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
};

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

// Reuse the client across dev hot reloads so we don't exhaust connections.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
