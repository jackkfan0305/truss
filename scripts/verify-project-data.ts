import "dotenv/config";

import assert from "node:assert/strict";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { getOwnedProjects, getSharedProjects } from "../lib/projects";
import { buildRoomId } from "../lib/room-id";

/**
 * Exercises the editor home's data layer against the live database: the Prisma
 * relation filter and case-insensitive email match in getSharedProjects, plus
 * the room-ID-as-primary-key create that POST /api/projects performs. Neither
 * can be checked by types alone.
 */

const OWNER_ID = "verify_owner";
const OTHER_OWNER_ID = "verify_other_owner";
const COLLABORATOR_EMAIL = "Collaborator@Example.com";

async function seed() {
  await cleanup();

  await prisma.project.create({
    data: { id: "verify-owned-one", ownerId: OWNER_ID, name: "Owned One" },
  });
  await prisma.project.create({
    data: { id: "verify-owned-two", ownerId: OWNER_ID, name: "Owned Two" },
  });

  // Shared with the collaborator, but stored in a different case than Clerk reports.
  await prisma.project.create({
    data: {
      id: "verify-shared",
      ownerId: OTHER_OWNER_ID,
      name: "Shared With Me",
      collaborators: { create: { email: COLLABORATOR_EMAIL.toUpperCase() } },
    },
  });

  // Someone else's project that names a different collaborator.
  await prisma.project.create({
    data: {
      id: "verify-unrelated",
      ownerId: OTHER_OWNER_ID,
      name: "Not Mine",
      collaborators: { create: { email: "someone-else@example.com" } },
    },
  });

  // The owner invited themselves: must not appear twice.
  await prisma.project.create({
    data: {
      id: "verify-self-invited",
      ownerId: OWNER_ID,
      name: "Self Invited",
      collaborators: { create: { email: COLLABORATOR_EMAIL } },
    },
  });
}

function cleanup() {
  return prisma.project.deleteMany({
    where: { ownerId: { in: [OWNER_ID, OTHER_OWNER_ID] } },
  });
}

/**
 * POST /api/projects writes the create dialog's room ID as the primary key, and
 * answers 409 when it collides. Both halves are checked here.
 */
async function checkRoomIdCreate() {
  const roomId = buildRoomId("Checkout Service", "a1b2c3");
  assert.equal(roomId, "checkout-service-a1b2c3");

  const created = await prisma.project.create({
    data: { id: roomId, ownerId: OWNER_ID, name: "Checkout Service" },
  });
  assert.equal(created.id, roomId, "the room ID should become the project ID");
  assert.equal(created.status, "DRAFT", "status should default");

  await assert.rejects(
    prisma.project.create({
      data: { id: roomId, ownerId: OTHER_OWNER_ID, name: "Collision" },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
    "a duplicate room ID must raise P2002 so the route can answer 409",
  );

  await prisma.project.delete({ where: { id: roomId } });
}

async function main() {
  await seed();

  const owned = await getOwnedProjects(OWNER_ID);
  assert.deepEqual(
    owned.map((project) => project.id).sort(),
    ["verify-owned-one", "verify-owned-two", "verify-self-invited"],
    "getOwnedProjects returned the wrong set",
  );

  const identity = { userId: OWNER_ID, email: COLLABORATOR_EMAIL.toLowerCase() };
  const shared = await getSharedProjects(identity);
  assert.deepEqual(
    shared.map((project) => project.id),
    ["verify-shared"],
    "getSharedProjects should match email case-insensitively and exclude own projects",
  );

  assert.deepEqual(
    await getSharedProjects({ userId: OWNER_ID, email: null }),
    [],
    "no email means nothing shared",
  );

  assert.deepEqual(await getOwnedProjects("verify_nobody"), [], "unknown owner");

  // The sidebar only ever needs these two fields.
  assert.deepEqual(Object.keys(shared[0]).sort(), ["id", "name"]);

  await checkRoomIdCreate();

  // Cascade: deleting a project takes its collaborator rows with it.
  await prisma.project.delete({ where: { id: "verify-shared" } });
  assert.equal(
    await prisma.projectCollaborator.count({
      where: { projectId: "verify-shared" },
    }),
    0,
    "collaborators should cascade on project delete",
  );

  console.log("✅ Project data layer verified against the database");
}

main()
  .catch((error) => {
    console.error("❌ Project read verification failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
