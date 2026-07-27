import { auth, currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import type { ProjectSummary } from "@/types/project";

export interface Identity {
  userId: string;
  /** Primary Clerk email. `null` when the user has none — collaboration is keyed on it. */
  email: string | null;
}

/**
 * Clerk identity for the current request, or `null` when signed out.
 *
 * Two calls, not one: `auth()` reads the session token for the user ID, but the
 * default token carries no email claim, and `ProjectCollaborator` is keyed on
 * email — so `currentUser()` is needed for the shared-project lookup.
 */
export async function getCurrentIdentity(): Promise<Identity | null> {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  const user = await currentUser();

  return { userId, email: user?.primaryEmailAddress?.emailAddress ?? null };
}

/**
 * The project behind `/editor/[roomId]`, or `null` when this identity may not
 * open it. Owner or collaborator only.
 *
 * "Does not exist" and "not yours" deliberately collapse into the same `null`:
 * both render `AccessDenied`, so an outsider cannot probe which project IDs are
 * real. Callers must not distinguish them.
 */
export async function getAccessibleProject(
  projectId: string,
  identity: Identity,
): Promise<ProjectSummary | null> {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: identity.userId },
        // Collaboration is keyed on email, matched case-insensitively to match
        // the sidebar's shared-project read (lib/projects.ts).
        ...(identity.email
          ? [
              {
                collaborators: {
                  some: {
                    email: { equals: identity.email, mode: "insensitive" as const },
                  },
                },
              },
            ]
          : []),
      ],
    },
    select: { id: true, name: true },
  });
}
