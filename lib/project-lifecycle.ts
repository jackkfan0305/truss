import { prisma } from "@/lib/prisma";

interface RoomLifecycle {
  deleteRoom: (roomId: string) => Promise<void>;
}

export async function cleanupTombstonedRoom(
  projectId: string,
  rooms: Readonly<RoomLifecycle>,
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  const isTombstone =
    project?.status === "DELETING" || project?.status === "DELETED";

  if (!isTombstone) {
    return false;
  }

  await rooms.deleteRoom(projectId);
  return true;
}

export async function deleteProjectResources(
  projectId: string,
  ownerId: string,
  rooms: Readonly<RoomLifecycle>,
): Promise<void> {
  // The owner predicate closes the gap between route authorization and this
  // mutation. The permanent row also reserves the ID before cleanup begins.
  await prisma.$transaction([
    prisma.projectCollaborator.deleteMany({ where: { projectId } }),
    prisma.project.update({
      where: { id: projectId, ownerId },
      data: {
        status: "DELETING",
        name: "Deleted project",
        description: null,
      },
    }),
  ]);

  // Failure leaves a durable DELETING tombstone. The project is inaccessible,
  // its ID cannot be reused, and the same owner-authorized DELETE can retry.
  await rooms.deleteRoom(projectId);

  await prisma.project.update({
    where: { id: projectId, ownerId },
    data: { status: "DELETED" },
  });
}
