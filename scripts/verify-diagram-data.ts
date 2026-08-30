import "dotenv/config";

import assert from "node:assert/strict";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { getAccessibleDiagram } from "../lib/diagram-access";
import {
  cleanupTombstonedRoom,
  deleteDiagramResources,
} from "../lib/diagram-lifecycle";
import { getOwnedDiagrams, getSharedDiagrams } from "../lib/diagrams";
import { buildRoomId } from "../lib/room-id";

/**
 * Exercises the editor home's data layer against the live database: the Prisma
 * relation filter and case-insensitive email match in getSharedDiagrams, plus
 * the room-ID-as-primary-key create that POST /api/diagrams performs. Neither
 * can be checked by types alone.
 *
 * The filter is now a *two-hop* one — a diagram is shared when the storyboard
 * it sits on is — so it is worth more here than it was when collaborators hung
 * off the diagram itself.
 *
 * Also covers getAccessibleDiagram, which is what stands between a signed-in
 * stranger and someone else's workspace.
 */

const UNIQUE_VIOLATION = "P2002";

const OWNER_ID = "verify_owner";
const OTHER_OWNER_ID = "verify_other_owner";
const COLLABORATOR_EMAIL = "Collaborator@Example.com";

const OWNER_BOARD_ID = "verify-owner-board";
const SHARED_BOARD_ID = "verify-shared-board";
const UNRELATED_BOARD_ID = "verify-unrelated-board";

async function seed() {
  await cleanup();

  await prisma.storyboard.create({
    data: {
      id: OWNER_BOARD_ID,
      ownerId: OWNER_ID,
      name: "Owner Board",
      // The owner invited themselves: they must not show up as a collaborator
      // on their own diagrams, which would list them twice.
      collaborators: { create: { email: COLLABORATOR_EMAIL } },
      diagrams: {
        create: [
          { id: "verify-owned-one", ownerId: OWNER_ID, name: "Owned One" },
          { id: "verify-owned-two", ownerId: OWNER_ID, name: "Owned Two" },
        ],
      },
    },
  });

  // A diagram with no storyboard at all — the shape every agent-created one
  // starts in, and the one this split exists to make valid.
  await prisma.diagram.create({
    data: {
      id: "verify-standalone",
      ownerId: OWNER_ID,
      name: "Standalone",
    },
  });

  await prisma.storyboard.create({
    data: {
      id: SHARED_BOARD_ID,
      ownerId: OTHER_OWNER_ID,
      name: "Shared Board",
      // Stored in a different case than Clerk reports it.
      collaborators: { create: { email: COLLABORATOR_EMAIL.toUpperCase() } },
      diagrams: {
        create: {
          id: "verify-shared",
          ownerId: OTHER_OWNER_ID,
          name: "Shared With Me",
        },
      },
    },
  });

  await prisma.storyboard.create({
    data: {
      id: UNRELATED_BOARD_ID,
      ownerId: OTHER_OWNER_ID,
      name: "Unrelated Board",
      collaborators: { create: { email: "someone-else@example.com" } },
      diagrams: {
        create: {
          id: "verify-unrelated",
          ownerId: OTHER_OWNER_ID,
          name: "Not Mine",
        },
      },
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

async function checkActiveRoomIsPreserved() {
  let roomDeletionAttempted = false;

  assert.equal(
    await cleanupTombstonedRoom("verify-owned-one", {
      deleteRoom: async () => {
        roomDeletionAttempted = true;
      },
    }),
    false,
    "an active diagram's room must never be removed by the auth fence",
  );
  assert.equal(roomDeletionAttempted, false);
}

async function checkMissingDiagramPreservesRoom() {
  let roomDeletionAttempted = false;

  await assert.rejects(
    deleteDiagramResources("verify-does-not-exist", OWNER_ID, {
      deleteRoom: async () => {
        roomDeletionAttempted = true;
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025",
    "a missing database row must fail deletion",
  );
  assert.equal(
    roomDeletionAttempted,
    false,
    "a database deletion failure must not destroy Liveblocks data",
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

async function checkCleanupFailureLeavesTombstone() {
  const cleanupFailure = new Error("Liveblocks unavailable");

  await assert.rejects(
    deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID, {
      deleteRoom: async () => {
        throw cleanupFailure;
      },
    }),
    cleanupFailure,
  );

  const deleting = await prisma.diagram.findUnique({
    where: { id: CLEANUP_DIAGRAM_ID },
    select: {
      name: true,
      storyboardId: true,
      canvasJsonPath: true,
      deletingAt: true,
      deletedAt: true,
    },
  });

  assert.ok(deleting, "the tombstone row must survive a failed cleanup");
  assert.equal(deleting.name, "Deleted diagram", "the name must be scrubbed");
  assert.equal(
    deleting.storyboardId,
    null,
    "a deleting diagram must detach from its board rather than keep a panel there",
  );
  assert.equal(
    deleting.canvasJsonPath,
    "https://blob.example/verify-room-cleanup-failure.json",
    "the artifact pointer is retained until blob deletion exists",
  );
  assert.notEqual(deleting.deletingAt, null, "deletingAt marks the tombstone");
  assert.equal(
    deleting.deletedAt,
    null,
    "deletedAt is only stamped once room cleanup succeeds",
  );
}

async function checkStoryboardKeepsItsCollaborators() {
  assert.equal(
    await prisma.storyboardCollaborator.count({
      where: { storyboardId: OWNER_BOARD_ID },
    }),
    1,
    "deleting one diagram must not strip its board of collaborators",
  );
}

async function checkTombstoneIsHiddenAndReserved() {
  assert.equal(
    await getAccessibleDiagram(CLEANUP_DIAGRAM_ID, {
      userId: OWNER_ID,
      email: null,
    }),
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

async function checkAuthFenceCleansTombstone() {
  let roomDeletionAttempted = false;
  assert.equal(
    await cleanupTombstonedRoom(CLEANUP_DIAGRAM_ID, {
      deleteRoom: async () => {
        roomDeletionAttempted = true;
      },
    }),
    true,
    "the auth fence must remove a room recreated after tombstoning",
  );
  assert.equal(roomDeletionAttempted, true);
}

async function checkDeletionRetryFinalizesTombstone() {
  let roomDeletionAttempted = false;
  await deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID, {
    deleteRoom: async () => {
      roomDeletionAttempted = true;
    },
  });
  assert.equal(
    roomDeletionAttempted,
    true,
    "retrying a deletion must retry Liveblocks cleanup",
  );

  const finalized = await prisma.diagram.findUnique({
    where: { id: CLEANUP_DIAGRAM_ID },
    select: {
      id: true,
      ownerId: true,
      name: true,
      storyboardId: true,
      canvasJsonPath: true,
      deletedAt: true,
    },
  });

  assert.ok(finalized, "the tombstone row is permanent");
  assert.equal(finalized.ownerId, OWNER_ID, "the owner stays for cleanup retries");
  assert.equal(finalized.name, "Deleted diagram");
  assert.equal(finalized.storyboardId, null);
  assert.equal(
    finalized.canvasJsonPath,
    "https://blob.example/verify-room-cleanup-failure.json",
    "final tombstone must preserve any artifact pointer until blob deletion exists",
  );
  assert.notEqual(finalized.deletedAt, null, "deletedAt finalizes the tombstone");
}

async function checkDiagramResourceDeletion() {
  await checkActiveRoomIsPreserved();
  await checkMissingDiagramPreservesRoom();
  await seedCleanupFailureDiagram();
  await checkCleanupFailureLeavesTombstone();
  await checkStoryboardKeepsItsCollaborators();
  await checkTombstoneIsHiddenAndReserved();
  await checkAuthFenceCleansTombstone();
  await checkDeletionRetryFinalizesTombstone();
}

/**
 * The `/editor/[roomId]` gate. Everything that is not owner-or-collaborator must
 * come back `null`, including a diagram that does not exist.
 */
async function checkDiagramAccess() {
  const owner = { userId: OWNER_ID, email: "owner@example.com" };
  const collaborator = {
    userId: "verify_collaborator",
    // Clerk reports the address as typed; the row was stored uppercased.
    email: COLLABORATOR_EMAIL.toLowerCase(),
  };
  const stranger = { userId: "verify_stranger", email: "stranger@example.com" };

  assert.deepEqual(
    await getAccessibleDiagram("verify-owned-one", owner),
    {
      id: "verify-owned-one",
      name: "Owned One",
      isOwner: true,
      storyboardId: OWNER_BOARD_ID,
      ownsStoryboard: true,
    },
    "the owner should reach their own diagram, with the board sharing hangs off",
  );

  assert.deepEqual(
    await getAccessibleDiagram("verify-standalone", owner),
    {
      id: "verify-standalone",
      name: "Standalone",
      isOwner: true,
      storyboardId: null,
      ownsStoryboard: false,
    },
    "a diagram with no parent storyboard is still a valid, readable diagram",
  );

  assert.deepEqual(
    await getAccessibleDiagram("verify-shared", collaborator),
    {
      id: "verify-shared",
      name: "Shared With Me",
      isOwner: false,
      storyboardId: SHARED_BOARD_ID,
      ownsStoryboard: false,
    },
    "a collaborator on the parent board reaches the diagram despite email casing",
  );

  // Owning a diagram is not owning the board it sits on, and only the latter
  // may invite. The share dialog gates on `ownsStoryboard` for exactly this.
  await prisma.diagram.update({
    where: { id: "verify-standalone" },
    data: { storyboardId: SHARED_BOARD_ID },
  });
  assert.deepEqual(
    await getAccessibleDiagram("verify-standalone", owner),
    {
      id: "verify-standalone",
      name: "Standalone",
      isOwner: true,
      storyboardId: SHARED_BOARD_ID,
      ownsStoryboard: false,
    },
    "a diagram you own on a board you do not own must not report storyboard ownership",
  );
  await prisma.diagram.update({
    where: { id: "verify-standalone" },
    data: { storyboardId: null },
  });

  assert.equal(
    await getAccessibleDiagram("verify-standalone", collaborator),
    null,
    "a standalone diagram has no collaborator list, so it is owner-only",
  );

  assert.equal(
    await getAccessibleDiagram("verify-shared", stranger),
    null,
    "a signed-in stranger must not reach someone else's diagram",
  );

  assert.equal(
    await getAccessibleDiagram("verify-shared", {
      userId: collaborator.userId,
      email: null,
    }),
    null,
    "no primary email means no collaborator access",
  );

  assert.equal(
    await getAccessibleDiagram("verify-does-not-exist", owner),
    null,
    "an unknown diagram ID is indistinguishable from a forbidden one",
  );

  assert.equal(
    await getAccessibleDiagram("verify-unrelated", collaborator),
    null,
    "being a collaborator elsewhere grants nothing here",
  );
}

/**
 * The invite/remove writes behind the share dialog. The duplicate rule and the
 * storyboard-scoped delete are enforced by the schema and the query, not by
 * types.
 */
async function checkCollaboratorMutations() {
  const invited = await prisma.storyboardCollaborator.create({
    data: { storyboardId: OWNER_BOARD_ID, email: "teammate@example.com" },
  });

  await assert.rejects(
    prisma.storyboardCollaborator.create({
      data: { storyboardId: OWNER_BOARD_ID, email: "teammate@example.com" },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION,
    "inviting the same email twice must raise P2002 so the route answers 409",
  );

  // Same email, different storyboard: allowed.
  await prisma.storyboardCollaborator.create({
    data: { storyboardId: UNRELATED_BOARD_ID, email: "teammate@example.com" },
  });

  // The DELETE handler scopes by storyboardId as well as id. Without that
  // scope this call would succeed and let an owner delete another board's row.
  assert.equal(
    (
      await prisma.storyboardCollaborator.deleteMany({
        where: { id: invited.id, storyboardId: UNRELATED_BOARD_ID },
      })
    ).count,
    0,
    "a collaborator row must not be deletable through another storyboard's ID",
  );

  assert.equal(
    (
      await prisma.storyboardCollaborator.deleteMany({
        where: { id: invited.id, storyboardId: OWNER_BOARD_ID },
      })
    ).count,
    1,
    "the owning storyboard should delete its row",
  );

  assert.equal(
    (
      await prisma.storyboardCollaborator.deleteMany({
        where: { id: invited.id, storyboardId: OWNER_BOARD_ID },
      })
    ).count,
    0,
    "a second delete finds nothing, which is the route's 404",
  );

  await prisma.storyboardCollaborator.deleteMany({
    where: { storyboardId: UNRELATED_BOARD_ID, email: "teammate@example.com" },
  });
}

/**
 * Deleting a storyboard takes its collaborators with it but leaves its diagrams
 * standing — `SetNull`, not `Cascade`. A diagram outlives the plan it was drawn
 * for, which is the whole point of the nullable parent.
 */
async function checkStoryboardDeleteDetachesDiagrams() {
  await prisma.storyboard.delete({ where: { id: SHARED_BOARD_ID } });

  assert.equal(
    await prisma.storyboardCollaborator.count({
      where: { storyboardId: SHARED_BOARD_ID },
    }),
    0,
    "collaborators should cascade on storyboard delete",
  );

  const orphan = await prisma.diagram.findUnique({
    where: { id: "verify-shared" },
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

  const identity = { userId: OWNER_ID, email: COLLABORATOR_EMAIL.toLowerCase() };
  const shared = await getSharedDiagrams(identity);
  assert.deepEqual(
    shared.map((diagram) => diagram.id),
    ["verify-shared"],
    "getSharedDiagrams should match email case-insensitively and exclude own diagrams",
  );

  assert.deepEqual(
    await getSharedDiagrams({ userId: OWNER_ID, email: null }),
    [],
    "no email means nothing shared",
  );

  assert.deepEqual(await getOwnedDiagrams("verify_nobody"), [], "unknown owner");

  // The sidebar only ever needs these two fields.
  assert.deepEqual(Object.keys(shared[0]).sort(), ["id", "name"]);

  await checkDiagramAccess();
  await checkCollaboratorMutations();
  await checkRoomIdCreate();
  await checkDiagramResourceDeletion();
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
