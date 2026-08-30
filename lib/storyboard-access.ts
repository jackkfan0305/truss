import { resolveIdentityEmail, resolveIdentitySource } from "@/lib/agent-identity";
import type { Authorization } from "@/lib/access";
import { jsonError } from "@/lib/api-requests";
import { prisma } from "@/lib/prisma";

/**
 * The authorization gate for every storyboard route handler:
 * 401 unauthenticated → 404 unknown storyboard → 403 insufficient role.
 *
 * Same contract and same ordering as `authorizeDiagram`, against the model
 * that actually holds collaborators. A storyboard has no deletion tombstone —
 * only a diagram reserves its ID against room reuse — so there is no
 * `allowDeletionStates` counterpart here.
 *
 * The email lookup stays lazy for the same reason it is there: the owner path
 * must cost one indexed read and no Clerk round trip.
 */
export async function authorizeStoryboard(
  request: Request,
  storyboardId: string,
  { requireOwner }: { requireOwner: boolean },
): Promise<Authorization> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { userId } = identitySource;

  const storyboard = await prisma.storyboard.findUnique({
    where: { id: storyboardId },
    select: { ownerId: true },
  });

  if (!storyboard) {
    return { ok: false, response: jsonError("Storyboard not found", 404) };
  }

  if (storyboard.ownerId === userId) {
    return { ok: true, role: "owner", userId, ownerId: storyboard.ownerId };
  }

  if (requireOwner) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  // Only now is the email worth a second Clerk call.
  const email = await resolveIdentityEmail(identitySource);

  if (!email) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  const collaborator = await prisma.storyboardCollaborator.findFirst({
    where: { storyboardId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  return collaborator
    ? { ok: true, role: "collaborator", userId, ownerId: storyboard.ownerId }
    : { ok: false, response: jsonError("Forbidden", 403) };
}
