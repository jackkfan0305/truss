import type { Identity } from "@/lib/access";
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

/**
 * Diagrams shared with this email by someone else. Collaborators are invited to
 * a *storyboard*, never to a diagram directly (see CONTEXT.md), so a diagram is
 * shared exactly when the storyboard it sits on is — which means a standalone
 * diagram is owner-only and never appears here.
 *
 * Owned diagrams are excluded so an owner who also invited themselves to their
 * own storyboard is not listed twice.
 */
export async function getSharedDiagrams(
  identity: Identity,
): Promise<DiagramSummary[]> {
  return prisma.diagram.findMany({
    where: {
      ownerId: { not: identity.userId },
      ...NOT_TOMBSTONED,
      storyboard: {
        OR: [
          { ownerId: identity.userId },
          ...(identity.email
            ? [{
                collaborators: {
                  // Emails are typed by hand in the share dialog, so match case-insensitively.
                  some: {
                    email: {
                      equals: identity.email,
                      mode: "insensitive" as const,
                    },
                  },
                },
              }]
            : []),
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
}
