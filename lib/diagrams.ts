import { NOT_TOMBSTONED } from "@/lib/diagram-lifecycle";
import { prisma } from "@/lib/prisma";
import type { DiagramSummary } from "@/types/diagram";

/**
 * Server-side diagram reads for the editor chrome. Route handlers own the
 * mutations; this module is the read path the server components use.
 *
 * Deliberately free of Clerk imports — identity arrives as an argument from
 * lib/access.ts, which keeps these queries runnable outside a request.
 */

// The sidebar renders name only; id doubles as the workspace route segment.
const SUMMARY_SELECT = { id: true, name: true } as const;

export async function getOwnedDiagrams(
  userId: string,
): Promise<DiagramSummary[]> {
  return prisma.diagram.findMany({
    where: { ownerId: userId, ...NOT_TOMBSTONED },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
}

