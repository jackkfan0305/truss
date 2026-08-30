import "dotenv/config";

import { prisma } from "../lib/prisma";

const SEED_OWNER_ID = "user_seed_owner";

const storyboards = [
  {
    name: "Event-Driven Order Pipeline",
    description: "Queue-backed order intake with retries and a dead letter path.",
    collaborators: ["ada@example.com", "grace@example.com"],
    diagrams: ["Order Intake Topology"],
  },
  {
    name: "Serverless Image Processing",
    description: "On-demand resize and transcode behind object storage.",
    collaborators: ["linus@example.com"],
    diagrams: ["Transcode Fan-Out"],
  },
  {
    name: "Modular Monolith Starter",
    description: null,
    collaborators: [],
    diagrams: [],
  },
];

// A diagram is valid with no storyboard pointing at it (CONTEXT.md), which is
// the shape every agent-created diagram starts in. Seed one so the standalone
// path is exercised too.
const standaloneDiagrams = ["Scratch Architecture"];

async function main() {
  // Idempotent: only ever touches rows this script created. Diagrams first —
  // the storyboard relation is `SetNull`, so deleting the boards would orphan
  // their diagrams rather than remove them.
  const { count: removedDiagrams } = await prisma.diagram.deleteMany({
    where: { ownerId: SEED_OWNER_ID },
  });
  const { count: removedStoryboards } = await prisma.storyboard.deleteMany({
    where: { ownerId: SEED_OWNER_ID },
  });

  if (removedDiagrams > 0 || removedStoryboards > 0) {
    console.log(
      `Removed ${removedStoryboards} seed storyboard(s) and ${removedDiagrams} seed diagram(s)`,
    );
  }

  for (const { name, description, collaborators, diagrams } of storyboards) {
    const storyboard = await prisma.storyboard.create({
      data: {
        name,
        description,
        ownerId: SEED_OWNER_ID,
        collaborators: { create: collaborators.map((email) => ({ email })) },
        diagrams: {
          create: diagrams.map((diagramName) => ({
            name: diagramName,
            ownerId: SEED_OWNER_ID,
          })),
        },
      },
    });

    console.log(
      `Seeded storyboard ${storyboard.name} (${collaborators.length} collaborators, ${diagrams.length} diagrams)`,
    );
  }

  for (const name of standaloneDiagrams) {
    const diagram = await prisma.diagram.create({
      data: { name, ownerId: SEED_OWNER_ID },
    });

    console.log(`Seeded standalone diagram ${diagram.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
