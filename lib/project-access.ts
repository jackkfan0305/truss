import { resolveIdentity, resolveIdentityEmail, resolveIdentitySource } from "@/lib/agent-identity";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/project-requests";
import type { ProjectAccess, ProjectRole } from "@/types/project";

export interface Identity {
  userId: string;
  /** Primary Clerk email. `null` when the user has none — collaboration is keyed on it. */
  email: string | null;
}

/**
 * Identity for the current request, or `null` when signed out and no valid
 * bearer token is present.
 *
 * A thin wrapper over `resolveIdentity` (`lib/agent-identity.ts`), the shared
 * chokepoint a bearer `trs_agent_...` token and the Clerk session cookie both
 * go through. `request` is optional because page loads (`app/editor/page.tsx`)
 * have no bearer channel to check — a browser navigation never carries a
 * custom Authorization header — and fall straight to the cookie path.
 */
export async function getCurrentIdentity(request?: Request): Promise<Identity | null> {
  return resolveIdentity(request);
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
  | { ok: true; role: ProjectRole; userId: string; ownerId: string }
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
 * `userId` and `ownerId` come back on success so callers that need them (the
 * member list, the task-run record) do not repeat a lookup this function has
 * already performed. They differ whenever the caller is a collaborator.
 *
 * Deletion tombstones answer 404 for every normal caller. The DELETE handler
 * alone opts into them so the original owner can retry failed room cleanup.
 *
 * `request` carries the identity source (bearer token or Clerk cookie) — see
 * `lib/agent-identity.ts`. `resolveIdentitySource` is used instead of the
 * full `resolveIdentity` so the owner path stays a single DB lookup with no
 * Clerk API call at all, for either identity source: the email resolver below
 * only runs once the collaborator branch is actually reached.
 */
export async function authorizeProject(
  request: Request,
  projectId: string,
  {
    requireOwner,
    allowDeletionStates = false,
  }: { requireOwner: boolean; allowDeletionStates?: boolean },
): Promise<Authorization> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { userId } = identitySource;

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
    return { ok: true, role: "owner", userId, ownerId: project.ownerId };
  }

  if (requireOwner) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // Only now is the email worth a second Clerk call.
  const email = await resolveIdentityEmail(identitySource);

  if (!email) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  const collaborator = await prisma.projectCollaborator.findFirst({
    where: { projectId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  return collaborator
    ? { ok: true, role: "collaborator", userId, ownerId: project.ownerId }
    : { ok: false, response: jsonError("Forbidden", 403) };
}
