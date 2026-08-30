import type { Authorization, Identity } from "@/lib/access";
import { resolveIdentityEmail, resolveIdentitySource } from "@/lib/agent-identity";
import { isTombstoned, NOT_TOMBSTONED } from "@/lib/diagram-lifecycle";
import { jsonError } from "@/lib/api-requests";
import { prisma } from "@/lib/prisma";
import type { DiagramAccess } from "@/types/diagram";

/**
 * Collaboration is keyed on a *storyboard*, not a diagram (see CONTEXT.md), so
 * every collaborator check below reaches through `Diagram.storyboardId`. A
 * standalone diagram — the shape every agent-created diagram starts in — has no
 * parent to inherit from and so is owner-only.
 *
 * Emails are matched case-insensitively: they are typed by hand into the share
 * dialog, and the sidebar's shared read (`lib/diagrams.ts`) matches the same way.
 */
function collaboratesOn(email: string) {
  return {
    storyboard: {
      collaborators: {
        some: { email: { equals: email, mode: "insensitive" as const } },
      },
    },
  };
}

/**
 * The diagram behind `/editor/[roomId]`, or `null` when this identity may not
 * open it. Owner, or a collaborator on its parent storyboard.
 *
 * "Does not exist" and "not yours" deliberately collapse into the same `null`:
 * both render `AccessDenied`, so an outsider cannot probe which diagram IDs are
 * real. Callers must not distinguish them.
 */
export async function getAccessibleDiagram(
  diagramId: string,
  identity: Identity,
): Promise<DiagramAccess | null> {
  const diagram = await prisma.diagram.findFirst({
    where: {
      id: diagramId,
      ...NOT_TOMBSTONED,
      OR: [
        { ownerId: identity.userId },
        ...(identity.email ? [collaboratesOn(identity.email)] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      storyboardId: true,
      // Inviting and removing collaborators is a storyboard mutation, so the
      // share dialog has to gate on *that* owner. The two columns are
      // independent: a diagram you own can sit on someone else's board.
      storyboard: { select: { ownerId: true } },
    },
  });

  if (!diagram) {
    return null;
  }

  return {
    id: diagram.id,
    name: diagram.name,
    isOwner: diagram.ownerId === identity.userId,
    storyboardId: diagram.storyboardId,
    ownsStoryboard: diagram.storyboard?.ownerId === identity.userId,
  };
}

/**
 * The single authorization gate for every diagram route handler:
 * 401 unauthenticated → 404 unknown diagram → 403 insufficient role.
 *
 * Checked before any body is parsed, so a caller without access cannot probe
 * validation behaviour. `requireOwner` covers the mutations; without it a
 * collaborator on the parent storyboard passes too, which is what canvas
 * autosave needs.
 *
 * 404-before-403 leaks whether a diagram ID exists to any signed-in user. That
 * is accepted here because diagram IDs are also the public `/editor/[roomId]`
 * segment — but note it is the opposite trade-off from `getAccessibleDiagram`,
 * which hides existence because it answers unauthenticated page loads.
 *
 * `userId` and `ownerId` come back on success so callers that need them do not
 * repeat a lookup this function has already performed. They differ whenever the
 * caller is a collaborator.
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
export async function authorizeDiagram(
  request: Request,
  diagramId: string,
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

  const diagram = await prisma.diagram.findUnique({
    where: { id: diagramId },
    select: { ownerId: true, storyboardId: true, deletingAt: true, deletedAt: true },
  });

  if (!diagram) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (isTombstoned(diagram) && (!allowDeletionStates || diagram.ownerId !== userId)) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (diagram.ownerId === userId) {
    return { ok: true, role: "owner", userId, ownerId: diagram.ownerId };
  }

  if (requireOwner) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // A standalone diagram has no collaborator list to consult, so there is
  // nothing an email could match — refuse before spending a Clerk call.
  if (!diagram.storyboardId) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // Only now is the email worth a second Clerk call.
  const email = await resolveIdentityEmail(identitySource);

  if (!email) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  const collaborator = await prisma.storyboardCollaborator.findFirst({
    where: {
      storyboardId: diagram.storyboardId,
      email: { equals: email, mode: "insensitive" },
    },
    select: { id: true },
  });

  return collaborator
    ? { ok: true, role: "collaborator", userId, ownerId: diagram.ownerId }
    : { ok: false, response: jsonError("Forbidden", 403) };
}
