import { auth, currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/project-requests";
import type { ProjectAccess, ProjectRole } from "@/types/project";

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
): Promise<ProjectAccess | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: { notIn: ["DELETING", "DELETED"] },
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
    select: { id: true, name: true, ownerId: true },
  });

  if (!project) {
    return null;
  }

  return {
    id: project.id,
    name: project.name,
    isOwner: project.ownerId === identity.userId,
  };
}

export type Authorization =
  | { ok: true; role: ProjectRole; ownerId: string }
  | { ok: false; response: Response };

/**
 * The single authorization gate for every project route handler:
 * 401 unauthenticated → 404 unknown project → 403 insufficient role.
 *
 * Checked before any body is parsed, so a caller without access cannot probe
 * validation behaviour. `requireOwner` covers the mutations; without it a
 * collaborator passes too, which is what the read-only share list needs.
 *
 * 404-before-403 leaks whether a project ID exists to any signed-in user. That
 * is accepted here because project IDs are also the public `/editor/[roomId]`
 * segment — but note it is the opposite trade-off from `getAccessibleProject`,
 * which hides existence because it answers unauthenticated page loads.
 *
 * `ownerId` comes back on success so callers that need it (the member list)
 * do not repeat the lookup this function already performed.
 *
 * Deletion tombstones answer 404 for every normal caller. The DELETE handler
 * alone opts into them so the original owner can retry failed room cleanup.
 */
export async function authorizeProject(
  projectId: string,
  {
    requireOwner,
    allowDeletionStates = false,
  }: { requireOwner: boolean; allowDeletionStates?: boolean },
): Promise<Authorization> {
  const { userId } = await auth();

  if (!userId) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, status: true },
  });

  if (!project) {
    return { ok: false, response: jsonError("Project not found", 404) };
  }

  const isDeletionState =
    project.status === "DELETING" || project.status === "DELETED";

  if (
    isDeletionState &&
    (!allowDeletionStates || project.ownerId !== userId)
  ) {
    return { ok: false, response: jsonError("Project not found", 404) };
  }

  if (project.ownerId === userId) {
    return { ok: true, role: "owner", ownerId: project.ownerId };
  }

  if (requireOwner) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // Only now is the email worth a second Clerk call.
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  if (!email) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  const collaborator = await prisma.projectCollaborator.findFirst({
    where: { projectId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  return collaborator
    ? { ok: true, role: "collaborator", ownerId: project.ownerId }
    : { ok: false, response: jsonError("Forbidden", 403) };
}
