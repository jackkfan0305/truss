import { prisma } from "@/lib/prisma";

/** The inverse, for every list and lookup that must not surface a tombstone. */
export const NOT_TOMBSTONED = { deletingAt: null, deletedAt: null } as const;

/**
 * The same rule applied to a row already in hand: the pair of columns that
 * defines "tombstoned" is named in exactly one file.
 */
export function isTombstoned(
  diagram: Readonly<{ deletingAt: Date | null; deletedAt: Date | null }>,
): boolean {
  return diagram.deletingAt !== null || diagram.deletedAt !== null;
}

/**
 * Tombstones a diagram. The row stays forever so its ID is never reused, and
 * it leaves its storyboard so no board renders a panel for it.
 *
 * Both stamps are written together: the two-step `deletingAt` then
 * `deletedAt` existed to retry deleting an external room, and there is no
 * external room any more (ADR 0005).
 */
export async function deleteDiagramResources(diagramId: string, ownerId: string): Promise<void> {
  const now = new Date();

  // The owner predicate closes the gap between route authorization and this
  // mutation.
  await prisma.diagram.update({
    where: { id: diagramId, ownerId },
    data: { deletingAt: now, deletedAt: now, name: "Deleted diagram", storyboardId: null },
  });
}
