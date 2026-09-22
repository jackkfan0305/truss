import "dotenv/config";

import { isAccelerateUrl, prisma } from "../lib/prisma";

function checkUrlBranching() {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["prisma+postgres://accelerate.prisma-data.net/?api_key=x", true],
    ["postgres://user:pw@db.prisma.io:5432/postgres", false],
    ["postgresql://user:pw@localhost:5432/truss", false],
  ];

  for (const [url, expected] of cases) {
    if (isAccelerateUrl(url) !== expected) {
      throw new Error(
        `isAccelerateUrl misrouted ${url.split("://")[0]}:// — expected ${expected}`,
      );
    }
  }
}

async function main() {
  checkUrlBranching();

  const mode = isAccelerateUrl(process.env.DATABASE_URL ?? "")
    ? "Accelerate"
    : "direct (adapter-pg)";

  const storyboards = await prisma.storyboard.findMany({
    include: { _count: { select: { collaborators: true, diagrams: true } } },
    orderBy: { createdAt: "asc" },
  });
  const diagrams = await prisma.diagram.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, storyboardId: true, deletingAt: true, deletedAt: true },
  });

  console.log("✅ Connected");
  console.log(`Connection mode: ${mode}`);
  console.log(`Storyboards: ${storyboards.length}`);

  for (const storyboard of storyboards) {
    console.log(
      `  - ${storyboard.name} (${storyboard._count.collaborators} collaborators, ${storyboard._count.diagrams} diagrams)`,
    );
  }

  console.log(`Diagrams: ${diagrams.length}`);

  for (const diagram of diagrams) {
    const parent = diagram.storyboardId ?? "standalone";
    const state = diagram.deletedAt
      ? "deleted"
      : diagram.deletingAt
        ? "deleting"
        : "live";
    console.log(`  - ${diagram.name} [${state}] (${parent})`);
  }
}

main()
  .catch((error) => {
    console.error("❌ Prisma verification failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
