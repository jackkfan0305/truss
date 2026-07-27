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

  const projects = await prisma.project.findMany({
    include: { _count: { select: { collaborators: true } } },
    orderBy: { createdAt: "asc" },
  });

  console.log("✅ Connected");
  console.log(`Connection mode: ${mode}`);
  console.log(`Projects: ${projects.length}`);

  for (const project of projects) {
    console.log(
      `  - ${project.name} [${project.status}] (${project._count.collaborators} collaborators)`,
    );
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
