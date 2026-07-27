import "dotenv/config";

import { prisma } from "../lib/prisma";

const SEED_OWNER_ID = "user_seed_owner";

const projects = [
  {
    name: "Event-Driven Order Pipeline",
    description: "Queue-backed order intake with retries and a dead letter path.",
    collaborators: ["ada@example.com", "grace@example.com"],
  },
  {
    name: "Serverless Image Processing",
    description: "On-demand resize and transcode behind object storage.",
    collaborators: ["linus@example.com"],
  },
  {
    name: "Modular Monolith Starter",
    description: null,
    collaborators: [],
  },
];

async function main() {
  // Idempotent: only ever touches rows this script created.
  const { count } = await prisma.project.deleteMany({
    where: { ownerId: SEED_OWNER_ID },
  });

  if (count > 0) {
    console.log(`Removed ${count} existing seed project(s)`);
  }

  const seededProjects = await Promise.all(
    projects.map(({ name, description, collaborators }) =>
      prisma.project.create({
        data: {
          name,
          description,
          ownerId: SEED_OWNER_ID,
          collaborators: {
            create: collaborators.map((email) => ({ email })),
          },
        },
      }),
    ),
  );

  for (const [index, project] of seededProjects.entries()) {
    console.log(
      `Seeded project ${project.name} (${projects[index].collaborators.length} collaborators)`,
    );
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
