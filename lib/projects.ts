import type { Identity } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import type { ProjectSummary } from "@/types/project";

/**
 * Server-side project reads for the editor chrome. Route handlers own the
 * mutations; this module is the read path the server components use.
 *
 * Deliberately free of Clerk imports — identity arrives as an argument from
 * lib/project-access.ts, which keeps these queries runnable outside a request
 * (see scripts/verify-project-reads.ts).
 */

// The sidebar renders name only; id doubles as the workspace route segment.
const SUMMARY_SELECT = { id: true, name: true } as const;

export async function getOwnedProjects(
  userId: string,
): Promise<ProjectSummary[]> {
  return prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
}

/**
 * Projects shared with this email by someone else. Owned projects are excluded
 * so an owner who also invited themselves is not listed twice.
 */
export async function getSharedProjects(
  identity: Identity,
): Promise<ProjectSummary[]> {
  if (!identity.email) {
    return [];
  }

  return prisma.project.findMany({
    where: {
      ownerId: { not: identity.userId },
      collaborators: {
        // Emails are typed by hand in the share dialog, so match case-insensitively.
        some: { email: { equals: identity.email, mode: "insensitive" } },
      },
    },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
}
