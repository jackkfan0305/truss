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
  // The storyboard relation is `SetNull`; deleting both seed-owned row sets in
  // one transaction keeps cleanup atomic while the diagram delete still runs
  // before the relation can be cleared.
  const [{ count: removedDiagrams }, { count: removedStoryboards }] =
    await prisma.$transaction([
      prisma.diagram.deleteMany({ where: { ownerId: SEED_OWNER_ID } }),
      prisma.storyboard.deleteMany({ where: { ownerId: SEED_OWNER_ID } }),
    ]);

  if (removedDiagrams > 0 || removedStoryboards > 0) {
    console.log(
      `Removed ${removedStoryboards} seed storyboard(s) and ${removedDiagrams} seed diagram(s)`,
    );
  }

  const seededStoryboards = await Promise.all(
    storyboards.map(async ({ name, description, collaborators, diagrams }) => {
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

      return { storyboard, collaborators, diagrams };
    }),
  );

  for (const { storyboard, collaborators, diagrams } of seededStoryboards) {
    console.log(
      `Seeded storyboard ${storyboard.name} (${collaborators.length} collaborators, ${diagrams.length} diagrams)`,
    );
  }

  const seededStandaloneDiagrams = await Promise.all(
    standaloneDiagrams.map((name) =>
      prisma.diagram.create({
        data: { name, ownerId: SEED_OWNER_ID },
      }),
    ),
  );

  for (const diagram of seededStandaloneDiagrams) {
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
