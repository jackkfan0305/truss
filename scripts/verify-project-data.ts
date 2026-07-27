import "dotenv/config";

import assert from "node:assert/strict";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { getAccessibleProject } from "../lib/project-access";
import { getOwnedProjects, getSharedProjects } from "../lib/projects";
import { buildRoomId } from "../lib/room-id";

/**
 * Exercises the editor home's data layer against the live database: the Prisma
 * relation filter and case-insensitive email match in getSharedProjects, plus
 * the room-ID-as-primary-key create that POST /api/projects performs. Neither
 * can be checked by types alone.
 *
 * Also covers getAccessibleProject, which is what stands between a signed-in
 * stranger and someone else's workspace.
 */

const UNIQUE_VIOLATION = "P2002";

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

/**
 * The `/editor/[roomId]` gate. Everything that is not owner-or-collaborator must
 * come back `null`, including a project that does not exist.
 */
async function checkProjectAccess() {
  const owner = { userId: OWNER_ID, email: "owner@example.com" };
  const collaborator = {
    userId: "verify_collaborator",
    // Clerk reports the address as typed; the row was stored uppercased.
    email: COLLABORATOR_EMAIL.toLowerCase(),
  };
  const stranger = { userId: "verify_stranger", email: "stranger@example.com" };

  const asOwner = await getAccessibleProject("verify-owned-one", owner);
  assert.deepEqual(
    asOwner,
    { id: "verify-owned-one", name: "Owned One", isOwner: true },
    "the owner should reach their own project, id and name only",
  );

  const asCollaborator = await getAccessibleProject(
    "verify-shared",
    collaborator,
  );
  assert.deepEqual(
    asCollaborator,
    { id: "verify-shared", name: "Shared With Me", isOwner: false },
    "a collaborator reaches a shared project despite the email casing, but is not the owner",
  );

  assert.equal(
    await getAccessibleProject("verify-shared", stranger),
    null,
    "a signed-in stranger must not reach someone else's project",
  );

  assert.equal(
    await getAccessibleProject("verify-shared", {
      userId: collaborator.userId,
      email: null,
    }),
    null,
    "no primary email means no collaborator access",
  );

  assert.equal(
    await getAccessibleProject("verify-does-not-exist", owner),
    null,
    "an unknown project ID is indistinguishable from a forbidden one",
  );

  assert.equal(
    await getAccessibleProject("verify-unrelated", collaborator),
    null,
    "being a collaborator elsewhere grants nothing here",
  );
}

/**
 * The invite/remove writes behind the share dialog. The duplicate rule and the
 * project-scoped delete are enforced by the schema and the query, not by types.
 */
async function checkCollaboratorMutations() {
  const invited = await prisma.projectCollaborator.create({
    data: { projectId: "verify-owned-one", email: "teammate@example.com" },
  });

  await assert.rejects(
    prisma.projectCollaborator.create({
      data: { projectId: "verify-owned-one", email: "teammate@example.com" },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION,
    "inviting the same email twice must raise P2002 so the route answers 409",
  );

  // Same email, different project: allowed.
  await prisma.projectCollaborator.create({
    data: { projectId: "verify-owned-two", email: "teammate@example.com" },
  });

  // The DELETE handler scopes by projectId as well as id. Without that scope
  // this call would succeed and let an owner delete another project's row.
  const wrongProject = await prisma.projectCollaborator.deleteMany({
    where: { id: invited.id, projectId: "verify-owned-two" },
  });
  assert.equal(
    wrongProject.count,
    0,
    "a collaborator row must not be deletable through another project's ID",
  );

  const rightProject = await prisma.projectCollaborator.deleteMany({
    where: { id: invited.id, projectId: "verify-owned-one" },
  });
  assert.equal(rightProject.count, 1, "the owning project should delete its row");

  assert.equal(
    (
      await prisma.projectCollaborator.deleteMany({
        where: { id: invited.id, projectId: "verify-owned-one" },
      })
    ).count,
    0,
    "a second delete finds nothing, which is the route's 404",
  );
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

  await checkProjectAccess();
  await checkCollaboratorMutations();
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
