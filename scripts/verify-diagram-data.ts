import "dotenv/config";

import assert from "node:assert/strict";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { getAccessibleDiagram } from "../lib/diagram-access";
import { deleteDiagramResources } from "../lib/diagram-lifecycle";
import { getOwnedDiagrams } from "../lib/diagrams";
import { buildRoomId } from "../lib/room-id";

/**
 * Exercises the editor home's data layer against the live database: the
 * diagram ID create that POST /api/diagrams performs, and owner-only
 * access checks where only the diagram owner can open it. Neither can be checked
 * by types alone.
 *
 * Covers getAccessibleDiagram, which enforces that only the diagram owner can open it.
 */

const UNIQUE_VIOLATION = "P2002";

const OWNER_ID = "verify_owner";
const OTHER_OWNER_ID = "verify_other_owner";

const OWNER_BOARD_ID = "verify-owner-board";

async function seed() {
  await cleanup();

  await prisma.storyboard.create({
    data: {
      id: OWNER_BOARD_ID,
      ownerId: OWNER_ID,
      name: "Owner Board",
      diagrams: {
        create: [
          { id: "verify-owned-one", ownerId: OWNER_ID, name: "Owned One" },
          { id: "verify-owned-two", ownerId: OWNER_ID, name: "Owned Two" },
        ],
      },
    },
  });

  // A diagram with no storyboard at all: the shape every agent-created one
  // starts in.
  await prisma.diagram.create({
    data: { id: "verify-standalone", ownerId: OWNER_ID, name: "Standalone" },
  });

  // Owning the board is not owning the diagram. With collaborators gone, the
  // diagram's own ownerId is the only thing that grants access.
  await prisma.diagram.create({
    data: {
      id: "verify-foreign-on-owner-board",
      ownerId: OTHER_OWNER_ID,
      name: "Foreign",
      storyboardId: OWNER_BOARD_ID,
    },
  });
}

async function cleanup() {
  // Diagrams first: the storyboard relation is `SetNull`, so removing the
  // boards would orphan their diagrams rather than take them along.
  await prisma.diagram.deleteMany({
    where: { ownerId: { in: [OWNER_ID, OTHER_OWNER_ID] } },
  });
  await prisma.storyboard.deleteMany({
    where: { ownerId: { in: [OWNER_ID, OTHER_OWNER_ID] } },
  });
}

/**
 * POST /api/diagrams writes the create dialog's room ID as the primary key, and
 * answers 409 when it collides. Both halves are checked here.
 */
async function checkRoomIdCreate() {
  const roomId = buildRoomId("Checkout Service", "a1b2c3");
  assert.equal(roomId, "checkout-service-a1b2c3");

  const created = await prisma.diagram.create({
    data: { id: roomId, ownerId: OWNER_ID, name: "Checkout Service" },
  });
  assert.equal(created.id, roomId, "the room ID should become the diagram ID");
  assert.equal(
    created.storyboardId,
    null,
    "a diagram created without a board should be standalone, not rejected",
  );
  assert.equal(created.deletingAt, null, "a new diagram carries no tombstone");
  assert.equal(created.deletedAt, null, "a new diagram carries no tombstone");

  await assert.rejects(
    prisma.diagram.create({
      data: { id: roomId, ownerId: OTHER_OWNER_ID, name: "Collision" },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
    "a duplicate room ID must raise P2002 so the route can answer 409",
  );

  await prisma.diagram.delete({ where: { id: roomId } });
}

const CLEANUP_DIAGRAM_ID = "verify-room-cleanup-failure";

async function checkMissingDiagramFails() {
  await assert.rejects(
    deleteDiagramResources("verify-does-not-exist", OWNER_ID),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025",
    "a missing database row must fail deletion",
  );
}

async function seedCleanupFailureDiagram() {
  await prisma.diagram.create({
    data: {
      id: CLEANUP_DIAGRAM_ID,
      ownerId: OWNER_ID,
      name: "Cleanup Failure",
      storyboardId: OWNER_BOARD_ID,
      canvasJsonPath: "https://blob.example/verify-room-cleanup-failure.json",
    },
  });
}

async function checkDeletionTombstonesTheRow() {
  await deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID);

  const tombstone = await prisma.diagram.findUnique({
    where: { id: CLEANUP_DIAGRAM_ID },
    select: { ownerId: true, name: true, storyboardId: true, canvasJsonPath: true, deletingAt: true, deletedAt: true },
  });

  assert.ok(tombstone, "the tombstone row is permanent");
  assert.equal(tombstone.ownerId, OWNER_ID);
  assert.equal(tombstone.name, "Deleted diagram", "the name is scrubbed");
  assert.equal(tombstone.storyboardId, null, "a deleted diagram leaves its board");
  assert.equal(
    tombstone.canvasJsonPath,
    "https://blob.example/verify-room-cleanup-failure.json",
    "the artifact pointer is kept until blob deletion exists",
  );
  assert.notEqual(tombstone.deletingAt, null);
  assert.notEqual(tombstone.deletedAt, null, "with no external room there is nothing left to finish");
}

async function checkTombstoneIsHiddenAndReserved() {
  assert.equal(
    await getAccessibleDiagram(CLEANUP_DIAGRAM_ID, { userId: OWNER_ID }),
    null,
    "a deleting diagram must not remain accessible",
  );
  assert.equal(
    (await getOwnedDiagrams(OWNER_ID)).some(
      (diagram) => diagram.id === CLEANUP_DIAGRAM_ID,
    ),
    false,
    "a deleting diagram must disappear from diagram lists",
  );

  await assert.rejects(
    prisma.diagram.create({
      data: {
        id: CLEANUP_DIAGRAM_ID,
        ownerId: OTHER_OWNER_ID,
        name: "Must Not Reuse",
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION,
    "a deletion tombstone must permanently reserve the diagram and room ID",
  );
}

async function checkDeletionRetryIsHarmless() {
  await deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID);
  assert.ok(await prisma.diagram.findUnique({ where: { id: CLEANUP_DIAGRAM_ID } }));
}

async function checkDiagramResourceDeletion() {
  await checkMissingDiagramFails();
  await seedCleanupFailureDiagram();
  await checkDeletionTombstonesTheRow();
  await checkTombstoneIsHiddenAndReserved();
  await checkDeletionRetryIsHarmless();
}

async function checkDiagramAccess() {
  const owner = { userId: OWNER_ID };
  const stranger = { userId: OTHER_OWNER_ID };

  assert.deepEqual(
    await getAccessibleDiagram("verify-owned-one", owner),
    { id: "verify-owned-one", name: "Owned One" },
    "the owner opens their own diagram",
  );
  assert.deepEqual(
    await getAccessibleDiagram("verify-standalone", owner),
    { id: "verify-standalone", name: "Standalone" },
    "a standalone diagram opens for its owner",
  );
  assert.equal(
    await getAccessibleDiagram("verify-owned-one", stranger),
    null,
    "nobody else opens a diagram, whatever board it sits on",
  );
  assert.equal(
    await getAccessibleDiagram("verify-foreign-on-owner-board", owner),
    null,
    "owning the storyboard does not open a diagram someone else owns",
  );
  assert.equal(
    await getAccessibleDiagram("verify-does-not-exist", owner),
    null,
    "an unknown diagram answers the same null as a foreign one",
  );
}


/**
 * Deleting a storyboard takes its collaborators with it but leaves its diagrams
 * standing — `SetNull`, not `Cascade`. A diagram outlives the plan it was drawn
 * for, which is the whole point of the nullable parent.
 */
async function checkStoryboardDeleteDetachesDiagrams() {
  await prisma.storyboard.delete({ where: { id: OWNER_BOARD_ID } });

  const orphan = await prisma.diagram.findUnique({
    where: { id: "verify-owned-one" },
    select: { storyboardId: true },
  });
  assert.deepEqual(
    orphan,
    { storyboardId: null },
    "deleting a storyboard must detach its diagrams, never delete them",
  );
}

async function main() {
  await seed();

  const owned = await getOwnedDiagrams(OWNER_ID);
  assert.deepEqual(
    owned.map((diagram) => diagram.id).sort(),
    ["verify-owned-one", "verify-owned-two", "verify-standalone"],
    "getOwnedDiagrams returned the wrong set",
  );

  assert.deepEqual(await getOwnedDiagrams("verify_nobody"), [], "unknown owner");

  await checkDiagramAccess();
  await checkRoomIdCreate();
  await checkDiagramResourceDeletion();
  await checkTombstoneIsHiddenAndReserved();
  await checkStoryboardDeleteDetachesDiagrams();

  console.log("✅ Diagram data layer verified against the database");
}

main()
  .catch((error) => {
    console.error("❌ Diagram read verification failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
