import "dotenv/config";

import { del } from "@vercel/blob";

import { prisma } from "../lib/prisma";

/**
 * Deletes every `ProjectSpec` blob (`specs/{projectId}/{specId}.md`) before the
 * `20260830120000_drop_server_side_ai` migration drops the table that points at
 * them. `ProjectSpec` is gone from the Prisma schema already, so this reads the
 * still-live table with a raw query.
 *
 * Run once, before `prisma migrate deploy` applies that migration:
 *   npx tsx scripts/cleanup-spec-blobs.ts
 */

async function main() {
  const specs = await prisma.$queryRaw<{ filePath: string }[]>`
    SELECT "filePath" FROM "ProjectSpec"
  `;

  console.log(`Found ${specs.length} spec blob(s) to delete.`);

  for (const { filePath } of specs) {
    await del(filePath);
    console.log(`  deleted  ${filePath}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
