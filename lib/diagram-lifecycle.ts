import { prisma } from "@/lib/prisma";

interface RoomLifecycle {
  deleteRoom: (roomId: string) => Promise<void>;
}

/**
 * Either stamp is a tombstone: the diagram is gone, only the cleanup state
 * differs. `deletingAt` alone means room deletion has not finished yet and the
 * owner may retry it.
 */
const TOMBSTONED = {
  OR: [{ deletingAt: { not: null } }, { deletedAt: { not: null } }],
};

/** The inverse, for every list and lookup that must not surface a tombstone. */
export const NOT_TOMBSTONED = { deletingAt: null, deletedAt: null } as const;

export async function cleanupTombstonedRoom(
  diagramId: string,
  rooms: Readonly<RoomLifecycle>,
): Promise<boolean> {
  const tombstone = await prisma.diagram.findFirst({
    where: { id: diagramId, ...TOMBSTONED },
    select: { id: true },
  });

  if (!tombstone) {
    return false;
  }

  await rooms.deleteRoom(diagramId);
  return true;
}

export async function deleteDiagramResources(
  diagramId: string,
  ownerId: string,
  rooms: Readonly<RoomLifecycle>,
): Promise<void> {
  // The owner predicate closes the gap between route authorization and this
  // mutation. The permanent row also reserves the ID before cleanup begins.
  //
  // Detaching from any parent storyboard is part of entering the tombstone: a
  // board must not keep rendering a panel for a diagram that is being deleted.
  await prisma.diagram.update({
    where: { id: diagramId, ownerId },
    data: {
      deletingAt: new Date(),
      name: "Deleted diagram",
      storyboardId: null,
    },
  });

  // Failure leaves a durable `deletingAt` tombstone. The diagram is
  // inaccessible, its ID cannot be reused, and the same owner-authorized
  // DELETE can retry.
  await rooms.deleteRoom(diagramId);

  await prisma.diagram.update({
    where: { id: diagramId, ownerId },
    data: { deletedAt: new Date() },
  });
}
